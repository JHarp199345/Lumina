import { create } from "zustand";
import type { HighlightColor } from "@/types";

/**
 * selectionStore — the "just highlighted" refinement state.
 *
 * When the reader selects text in the book, a highlight is created and saved
 * immediately (one step). This store holds the id/color of that fresh highlight
 * so a small action bar can offer refinement (change lens, add note, remove)
 * without requiring the reader to have done anything beyond selecting.
 */

interface SelectionStore {
  activeHighlightId: string | null;
  activeColor: HighlightColor;
  activeText: string;
  setActive: (id: string, color: HighlightColor, text: string) => void;
  setColor: (color: HighlightColor) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionStore>()((set) => ({
  activeHighlightId: null,
  activeColor: "yellow",
  activeText: "",
  setActive: (activeHighlightId, activeColor, activeText) =>
    set({ activeHighlightId, activeColor, activeText }),
  setColor: (activeColor) => set({ activeColor }),
  clear: () => set({ activeHighlightId: null, activeText: "" }),
}));
