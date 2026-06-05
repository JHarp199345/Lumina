import { create } from "zustand";
import type { HighlightColor } from "@/types";

/**
 * selectionStore — drives the selection action bar.
 *
 * Two phases:
 *   pending  — text is selected but not yet highlighted. The bar offers the lens
 *              choices ("Highlight as…"). Highlighting is a deliberate tap, not
 *              automatic, so selecting text to read or copy never marks the book.
 *   active   — a highlight was just created. The bar offers refinement: recolour,
 *              add a note, remove.
 */

export interface PendingSelection {
  cfiRange: string;
  text: string;
}

interface SelectionStore {
  // Phase 1: a live selection awaiting the "Highlight" action
  pending: PendingSelection | null;
  setPending: (pending: PendingSelection | null) => void;

  // Phase 2: the freshly-created highlight being refined
  activeHighlightId: string | null;
  activeColor: HighlightColor;
  setActive: (id: string, color: HighlightColor) => void;
  setColor: (color: HighlightColor) => void;

  clear: () => void;
}

export const useSelectionStore = create<SelectionStore>()((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),

  activeHighlightId: null,
  activeColor: "yellow",
  setActive: (activeHighlightId, activeColor) => set({ activeHighlightId, activeColor }),
  setColor: (activeColor) => set({ activeColor }),

  clear: () => set({ pending: null, activeHighlightId: null }),
}));
