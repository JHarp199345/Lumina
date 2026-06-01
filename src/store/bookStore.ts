import { create } from "zustand";
import type { Book, BookStructure, SemanticMap, StyleSeedId } from "@/types";

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

  // Analysis state
  isAnalyzing: boolean;
  analysisProgress: string;
  setIsAnalyzing: (analyzing: boolean) => void;
  setAnalysisProgress: (progress: string) => void;
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

  isAnalyzing: false,
  analysisProgress: "",
  setIsAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
  setAnalysisProgress: (analysisProgress) => set({ analysisProgress }),
}));
