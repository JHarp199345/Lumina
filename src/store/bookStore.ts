import { create } from "zustand";
import type { AnalysisProgressDetail, Book, BookStructure, SemanticMap, StyleSeedId } from "@/types";

interface BookStore {
  // Library
  library: Book[];
  addBook: (book: Book) => void;
  removeBook: (bookId: string) => void;
  updateBook: (bookId: string, patch: Partial<Book>) => void;

  // Active book
  activeBook: Book | null;
  activeStructure: BookStructure | null;
  activeSemanticMap: SemanticMap | null;
  activeStyleSeed: StyleSeedId | null;

  /**
   * Stable CFI captured at the moment a book is opened.
   * ReaderPanel passes this as the renderer's initialCfi so the renderer
   * mounts with the correct location — independent of live currentCfi changes.
   * Cleared to null after first display by EpubRenderer.
   */
  initialCfi: string | null;

  setActiveBook: (book: Book | null) => void;
  setActiveStructure: (structure: BookStructure | null) => void;
  setActiveSemanticMap: (map: SemanticMap | null) => void;
  setActiveStyleSeed: (seed: StyleSeedId | null) => void;
  setInitialCfi: (cfi: string | null) => void;
  clearActiveBookState: () => void;

  // Analysis state
  isAnalyzing: boolean;
  analysisProgress: string;
  analysisProgressDetail: AnalysisProgressDetail | null;
  setIsAnalyzing: (analyzing: boolean) => void;
  setAnalysisProgress: (progress: string) => void;
  setAnalysisProgressDetail: (progress: AnalysisProgressDetail | null) => void;

  /**
   * Set to true by VisualPanel when the user clicks "Analyze This Book".
   * App.tsx watches this flag and drives the seed-picker → analysis flow.
   * Always reset to false immediately after App.tsx handles it.
   */
  analysisRequested: boolean;
  setAnalysisRequested: (requested: boolean) => void;
}

export const useBookStore = create<BookStore>()((set) => ({
  library: [],
  addBook: (book) =>
    set((state) => ({ library: [...state.library.filter((b) => b.id !== book.id), book] })),
  removeBook: (bookId) =>
    set((state) => ({ library: state.library.filter((b) => b.id !== bookId) })),
  updateBook: (bookId, patch) =>
    set((state) => ({
      library: state.library.map((b) => (b.id === bookId ? { ...b, ...patch } : b)),
    })),

  activeBook: null,
  activeStructure: null,
  activeSemanticMap: null,
  activeStyleSeed: null,
  initialCfi: null,

  setActiveBook: (activeBook) => set({ activeBook }),
  setActiveStructure: (activeStructure) => set({ activeStructure }),
  setActiveSemanticMap: (activeSemanticMap) => set({ activeSemanticMap }),
  setActiveStyleSeed: (activeStyleSeed) => set({ activeStyleSeed }),
  setInitialCfi: (initialCfi) => set({ initialCfi }),
  clearActiveBookState: () =>
    set({
      activeBook: null,
      activeStructure: null,
      activeSemanticMap: null,
      activeStyleSeed: null,
      initialCfi: null,
      isAnalyzing: false,
      analysisProgress: "",
      analysisProgressDetail: null,
    }),

  isAnalyzing: false,
  analysisProgress: "",
  analysisProgressDetail: null,
  setIsAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
  setAnalysisProgress: (analysisProgress) =>
    set((state) => ({
      analysisProgress,
      analysisProgressDetail: analysisProgress ? state.analysisProgressDetail : null,
    })),
  setAnalysisProgressDetail: (analysisProgressDetail) =>
    set({
      analysisProgressDetail,
      analysisProgress: analysisProgressDetail?.message ?? "",
    }),

  analysisRequested: false,
  setAnalysisRequested: (analysisRequested) => set({ analysisRequested }),
}));
