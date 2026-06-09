import { create } from "zustand";
import type { CachedImage, Chapter, GenerationQueueItem, GenerationStatus } from "@/types";
import { LUMINA_CONFIG } from "@/config";
import { findImageAtPosition } from "@/utils/imagePosition";

function slotHasCachedImage(cache: Record<string, CachedImage>, slotKey: string): boolean {
  return Object.values(cache).some((img) => img.visualSlotKey === slotKey);
}

interface ImageStore {
  currentImage: CachedImage | null;
  currentThemes: string[];
  isTransitioning: boolean;
  imageCache: Record<string, CachedImage>;
  queue: GenerationQueueItem[];
  isGenerating: boolean;
  /** Slot currently being generated — only one API call at a time. */
  activeGenerationSlot: string | null;
  navigationJumpUntil: number;
  regenerateCooldownUntil: number;

  markNavigationJump: () => void;
  markRegenerateCooldown: () => void;
  pruneQueueOutsideWindow: (wordPosition: number, aheadWords: number, behindWords?: number) => void;

  setCurrentImage: (image: CachedImage | null) => void;
  setCurrentThemes: (themes: string[]) => void;
  setIsTransitioning: (transitioning: boolean) => void;

  addToCache: (image: CachedImage) => void;
  getCachedImage: (sceneId: string) => CachedImage | undefined;
  getCachedImageForSlot: (slotKey: string) => CachedImage | undefined;
  getCachedImageAtPosition: (position: number, chapters: Chapter[]) => CachedImage | undefined;

  /** Returns false if another slot is generating or this slot already has an image. */
  claimGenerationSlot: (slotKey: string, allowReplace?: boolean) => boolean;
  releaseGenerationSlot: () => void;

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
  activeGenerationSlot: null,
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
    set((state) => {
      const next: Record<string, CachedImage> = { ...state.imageCache };
      if (image.visualSlotKey) {
        for (const [key, cached] of Object.entries(next)) {
          if (cached.visualSlotKey === image.visualSlotKey && cached.id !== image.id) {
            delete next[key];
          }
        }
      }
      next[image.sceneId] = image;
      return { imageCache: next };
    }),

  getCachedImage: (sceneId) => get().imageCache[sceneId],

  getCachedImageForSlot: (slotKey) => {
    const cache = get().imageCache;
    return Object.values(cache).find((img) => img.visualSlotKey === slotKey);
  },

  getCachedImageAtPosition: (position, chapters) =>
    findImageAtPosition(
      Object.values(get().imageCache),
      position,
      chapters,
      undefined,
      LUMINA_CONFIG.VISUAL_POSITION_MATCH_TOLERANCE
    ),

  claimGenerationSlot: (slotKey, allowReplace = false) => {
    const state = get();
    if (state.isGenerating || state.activeGenerationSlot) return false;
    if (!allowReplace && slotHasCachedImage(state.imageCache, slotKey)) return false;
    set({ activeGenerationSlot: slotKey });
    return true;
  },

  releaseGenerationSlot: () => set({ activeGenerationSlot: null }),

  enqueue: (item) =>
    set((state) => {
      const existing = state.queue.find((q) => q.sceneId === item.sceneId);
      if (existing?.status === "generating" || existing?.status === "complete") {
        return state;
      }

      if (item.visualSlotKey) {
        if (slotHasCachedImage(state.imageCache, item.visualSlotKey)) return state;
        if (state.activeGenerationSlot === item.visualSlotKey) return state;
        const slotBusy = state.queue.some(
          (q) =>
            q.visualSlotKey === item.visualSlotKey &&
            (q.status === "pending" || q.status === "generating")
        );
        if (slotBusy) return state;
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
    const state = get();
    for (const item of state.queue) {
      if (item.status !== "pending") continue;
      if (item.visualSlotKey && slotHasCachedImage(state.imageCache, item.visualSlotKey)) {
        continue;
      }
      if (item.visualSlotKey && state.activeGenerationSlot === item.visualSlotKey) {
        continue;
      }
      return item;
    }
    return undefined;
  },

  updateQueueItemStatus: (sceneId, status) =>
    set((state) => ({
      queue: state.queue.map((q) => (q.sceneId === sceneId ? { ...q, status } : q)),
    })),

  setIsGenerating: (isGenerating) => set({ isGenerating }),

  clearQueue: () => set({ queue: [] }),

  clearImageCache: () => {
    console.info("[ImageStore] clearImageCache");
    set({ imageCache: {}, currentImage: null, currentThemes: [], activeGenerationSlot: null });
  },

  clearImagesForUnmount: () => {
    console.info("[ImageStore] clearImagesForUnmount");
    set({
      currentImage: null,
      currentThemes: [],
      isTransitioning: false,
      imageCache: {},
      queue: [],
      isGenerating: false,
      activeGenerationSlot: null,
      navigationJumpUntil: 0,
      regenerateCooldownUntil: 0,
    });
  },
}));
