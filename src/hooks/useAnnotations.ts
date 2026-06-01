import { useCallback } from "react";
import { useAnnotationStore } from "@/store/annotationStore";
import { useBookStore } from "@/store/bookStore";
import type { HighlightColor } from "@/types";

export function useAnnotations() {
  const store = useAnnotationStore();
  const { activeBook } = useBookStore();

  const bookHighlights = activeBook ? store.getHighlightsForBook(activeBook.id) : [];
  const bookNotes = activeBook ? store.getNotesForBook(activeBook.id) : [];

  const removeHighlight = useCallback(
    (highlightId: string) => {
      store.removeHighlight(highlightId);
      // Remove from DOM
      const el = document.querySelector(`mark[data-highlight-id="${highlightId}"]`);
      if (el) {
        const parent = el.parentNode;
        while (el.firstChild) {
          parent?.insertBefore(el.firstChild, el);
        }
        parent?.removeChild(el);
      }
    },
    [store]
  );

  const changeHighlightColor = useCallback(
    (highlightId: string, color: HighlightColor) => {
      store.updateHighlightColor(highlightId, color);
      const el = document.querySelector(`mark[data-highlight-id="${highlightId}"]`);
      if (el) {
        el.className = `highlight-${color}`;
      }
    },
    [store]
  );

  return {
    highlights: bookHighlights,
    notes: bookNotes,
    removeHighlight,
    changeHighlightColor,
    addNote: store.addNote,
    updateNote: store.updateNote,
    removeNote: store.removeNote,
    getNoteForHighlight: store.getNoteForHighlight,
  };
}
