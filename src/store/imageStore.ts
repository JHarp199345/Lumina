import { create } from "zustand";
import type { CachedImage, Chapter, GenerationQueueItem, GenerationStatus } from "@/types";
import { LUMINA_CONFIG } from "@/config";
import { findImageAtPosition } from "@/utils/imagePosition";

interface ImageStore {
  // Current displayed image
  currentImage: CachedImage | null;
  currentThemes: string[];
  isTransitioning: boolean;

  // Cache (in-memory index)
  imageCache: Record<string, CachedImage>; // keyed by sceneId

  // Generation queue
  queue: GenerationQueueItem[];
  isGenerating: boolean;
  /** Set when the reader jumps (TOC, gallery, etc.) — suppresses gap-fill churn. */
  navigationJumpUntil: number;
  /** After regenerate-all: block auto-queue until the reader advances forward. */
  regenerateCooldownUntil: number;

  markNavigationJump: () => void;
  markRegenerateCooldown: () => void;
  pruneQueueOutsideWindow: (wordPosition: number, aheadWords: number, behindWords?: number) => void;

  setCurrentImage: (image: CachedImage | null) => void;
  setCurrentThemes: (themes: string[]) => void;
  setIsTransitioning: (transitioning: boolean) => void;

  addToCache: (image: CachedImage) => void;
  getCachedImage: (sceneId: string) => CachedImage | undefined;
  getCachedImageAtPosition: (position: number, chapters: Chapter[]) => CachedImage | undefined;

  enqueue: (item: GenerationQueueItem) => void;
  dequeue: () => GenerationQueueItem | undefined;
  updateQueueItemStatus: (sceneId: string, status: GenerationStatus) => void;
  setIsGenerating: (generating: boolean) => void;
  clearQueue: () => void;
  clearImageCache: () => void;
  clearImagesForUnmount: () => void;
}

export const useImageStore = create<ImageStore>()((set, get) => ({
  currentImage: null,
  currentThemes: [],
  isTransitioning: false,
  imageCache: {},
  queue: [],
  isGenerating: false,
  navigationJumpUntil: 0,
  regenerateCooldownUntil: 0,

  markNavigationJump: () =>
    set({ navigationJumpUntil: Date.now() + 4000 }),

  markRegenerateCooldown: () =>
    set({ regenerateCooldownUntil: Date.now() + 60_000 }),

  pruneQueueOutsideWindow: (wordPosition, aheadWords, behindWords = 0) =>
    set((state) => ({
      queue: state.queue.filter((item) => {
        if (item.status === "generating") return true;
        if (typeof item.wordPosition !== "number") return false;
        const delta = item.wordPosition - wordPosition;
        return delta >= -behindWords && delta <= aheadWords;
      }),
    })),

  setCurrentImage: (currentImage) => {
    console.info("[ImageStore] setCurrentImage:", currentImage?.sceneId ?? "null");
    set({ currentImage });
  },
  setCurrentThemes: (currentThemes) => set({ currentThemes }),
  setIsTransitioning: (isTransitioning) => set({ isTransitioning }),

  addToCache: (image) =>
    set((state) => ({ imageCache: { ...state.imageCache, [image.sceneId]: image } })),

  getCachedImage: (sceneId) => get().imageCache[sceneId],

  getCachedImageAtPosition: (position, chapters) =>
    findImageAtPosition(
      Object.values(get().imageCache),
      position,
      chapters,
      undefined,
      LUMINA_CONFIG.VISUAL_POSITION_MATCH_TOLERANCE
    ),

  enqueue: (item) =>
    set((state) => {
      const existing = state.queue.find((q) => q.sceneId === item.sceneId);
      if (existing?.status === "generating" || existing?.status === "complete") {
        return state;
      }
      const queue = existing
        ? state.queue.map((q) =>
            q.sceneId === item.sceneId && q.status === "pending"
              ? { ...q, priority: Math.min(q.priority, item.priority), description: item.description }
              : q
          )
        : [...state.queue, item];
      return { queue: queue.sort((a, b) => a.priority - b.priority) };
    }),

  dequeue: () => {
    const { queue } = get();
    const pending = queue.find((q) => q.status === "pending");
    return pending;
  },

  updateQueueItemStatus: (sceneId, status) =>
    set((state) => ({
      queue: state.queue.map((q) => (q.sceneId === sceneId ? { ...q, status } : q)),
    })),

  setIsGenerating: (isGenerating) => set({ isGenerating }),

  clearQueue: () => set({ queue: [] }),

  clearImageCache: () => {
    console.info("[ImageStore] clearImageCache");
    set({ imageCache: {}, currentImage: null, currentThemes: [] });
  },

  clearImagesForUnmount: () =>
    {
      console.info("[ImageStore] clearImagesForUnmount");
      set({
      currentImage: null,
      currentThemes: [],
      isTransitioning: false,
      imageCache: {},
      queue: [],
      isGenerating: false,
      navigationJumpUntil: 0,
      regenerateCooldownUntil: 0,
      });
    },
}));
