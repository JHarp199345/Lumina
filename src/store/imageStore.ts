import { create } from "zustand";
import type { CachedImage, GenerationQueueItem, GenerationStatus } from "@/types";

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

  setCurrentImage: (image: CachedImage | null) => void;
  setCurrentThemes: (themes: string[]) => void;
  setIsTransitioning: (transitioning: boolean) => void;

  addToCache: (image: CachedImage) => void;
  getCachedImage: (sceneId: string) => CachedImage | undefined;

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

  setCurrentImage: (currentImage) => set({ currentImage }),
  setCurrentThemes: (currentThemes) => set({ currentThemes }),
  setIsTransitioning: (isTransitioning) => set({ isTransitioning }),

  addToCache: (image) =>
    set((state) => ({ imageCache: { ...state.imageCache, [image.sceneId]: image } })),

  getCachedImage: (sceneId) => get().imageCache[sceneId],

  enqueue: (item) =>
    set((state) => ({
      queue: [...state.queue.filter((q) => q.sceneId !== item.sceneId), item].sort(
        (a, b) => a.priority - b.priority
      ),
    })),

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

  clearImageCache: () => set({ imageCache: {}, currentImage: null, currentThemes: [] }),

  clearImagesForUnmount: () =>
    set({
      currentImage: null,
      currentThemes: [],
      isTransitioning: false,
      imageCache: {},
      queue: [],
      isGenerating: false,
    }),
}));
