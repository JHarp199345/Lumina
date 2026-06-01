import { create } from "zustand";
import type { ReadingProgress } from "@/types";

interface ReaderStore {
  currentCfi: string;
  currentChapterIndex: number;
  percentComplete: number;
  wordPosition: number; // estimated word position in book

  setCurrentCfi: (cfi: string) => void;
  setCurrentChapterIndex: (index: number) => void;
  setPercentComplete: (percent: number) => void;
  setWordPosition: (position: number) => void;

  loadProgress: (progress: ReadingProgress) => void;
}

export const useReaderStore = create<ReaderStore>()((set) => ({
  currentCfi: "",
  currentChapterIndex: 0,
  percentComplete: 0,
  wordPosition: 0,

  setCurrentCfi: (currentCfi) => set({ currentCfi }),
  setCurrentChapterIndex: (currentChapterIndex) => set({ currentChapterIndex }),
  setPercentComplete: (percentComplete) => set({ percentComplete }),
  setWordPosition: (wordPosition) => set({ wordPosition }),

  loadProgress: (progress) =>
    set({
      currentCfi: progress.currentCfi,
      currentChapterIndex: progress.currentChapterIndex,
      percentComplete: progress.percentComplete,
    }),
}));
