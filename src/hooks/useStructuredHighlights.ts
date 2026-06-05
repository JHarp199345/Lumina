/**
 * useStructuredHighlights — highlighting for the structured (web) reader.
 *
 * The structured reader renders plain text in the top document, so selections are
 * normal top-document selections. This hook:
 *   - detects a selection inside the page container and surfaces the action bar
 *   - on a lens tap (luminaCreateHighlight) creates + persists + paints a highlight
 *     anchored by character offsets into the page text
 *   - re-applies, recolours, and removes highlights via the same window API the
 *     EpubRenderer exposes, so the SelectionActionBar is renderer-agnostic
 */

import { useCallback, useEffect, useRef } from "react";
import { useAnnotationStore } from "@/store/annotationStore";
import { useSelectionStore } from "@/store/selectionStore";
import {
  selectionOffsetsWithin,
  applyOffsetHighlight,
  removeOffsetHighlight,
  recolorOffsetHighlight,
  HIGHLIGHT_LENS_CLASS,
} from "@/utils/structuredHighlight";
import type { Highlight, HighlightColor } from "@/types";

interface Args {
  containerRef: React.RefObject<HTMLElement | null>;
  bookId: string | undefined;
  locator: string | null; // lumina://chapter/{ch}/page/{pg}, or null on cover
}

export function useStructuredHighlights({ containerRef, bookId, locator }: Args) {
  const { addHighlight, removeHighlight, updateHighlightColor, getHighlightsForBook } =
    useAnnotationStore();

  // Captured anchor from the latest selection (so a button tap can't lose it).
  const captured = useRef<{ start: number; end: number; text: string } | null>(null);

  // ── Selection detection ─────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !bookId || !locator) return;

    const detect = () => {
      const sel = window.getSelection();
      if (!sel) return;
      const offsets = selectionOffsetsWithin(container, sel);
      if (!offsets) {
        if (useSelectionStore.getState().pending) useSelectionStore.getState().setPending(null);
        captured.current = null;
        return;
      }
      captured.current = offsets;
      useSelectionStore.getState().setPending({ cfiRange: "", text: offsets.text });
    };

    const onSelectionChange = () => {
      // Only clear when collapsed; creation is captured on mouseup/touchend.
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        if (useSelectionStore.getState().pending) useSelectionStore.getState().setPending(null);
        captured.current = null;
      }
    };

    document.addEventListener("mouseup", detect);
    document.addEventListener("touchend", detect);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("mouseup", detect);
      document.removeEventListener("touchend", detect);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [containerRef, bookId, locator]);

  // ── Re-apply persisted highlights for the current page ──────────────────────
  const reapply = useCallback(() => {
    const container = containerRef.current;
    if (!container || !bookId || !locator) return;
    const forPage = getHighlightsForBook(bookId).filter((h) => h.locator === locator);
    // Clear any existing marks first (idempotent), then paint fresh.
    forPage.forEach((h) => removeOffsetHighlight(container, h.id));
    for (const h of forPage) {
      if (h.startOffset == null || h.endOffset == null) continue;
      applyOffsetHighlight(
        container,
        h.startOffset,
        h.endOffset,
        HIGHLIGHT_LENS_CLASS[h.color] ?? "highlight-yellow",
        h.id
      );
    }
  }, [containerRef, bookId, locator, getHighlightsForBook]);

  // Re-apply after each page render (rAF lets React commit first).
  useEffect(() => {
    const raf = requestAnimationFrame(() => reapply());
    return () => cancelAnimationFrame(raf);
  }, [reapply]);

  // ── Window API (shared with EpubRenderer) ───────────────────────────────────
  useEffect(() => {
    if (!bookId || !locator) return;
    const container = containerRef.current;

    type Win = Window & {
      luminaCreateHighlight?: (color: HighlightColor) => string;
      luminaSetHighlightColor?: (id: string, color: HighlightColor) => void;
      luminaRemoveHighlight?: (id: string) => void;
    };
    const win = window as Win;

    win.luminaCreateHighlight = (color: HighlightColor): string => {
      const anchor = captured.current;
      if (!anchor || !container) return "";
      const highlight: Highlight = {
        id: `h_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        bookId,
        cfiRange: "",
        color,
        selectedText: anchor.text,
        createdAt: new Date().toISOString(),
        locator,
        startOffset: anchor.start,
        endOffset: anchor.end,
      };
      addHighlight(highlight);
      applyOffsetHighlight(
        container,
        anchor.start,
        anchor.end,
        HIGHLIGHT_LENS_CLASS[color] ?? "highlight-yellow",
        highlight.id
      );
      // Clear the browser selection so the lens shows, not the selection band.
      try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
      captured.current = null;
      return highlight.id;
    };

    win.luminaSetHighlightColor = (id: string, color: HighlightColor) => {
      updateHighlightColor(id, color);
      if (container) recolorOffsetHighlight(container, id, HIGHLIGHT_LENS_CLASS[color] ?? "highlight-yellow");
    };

    win.luminaRemoveHighlight = (id: string) => {
      if (container) removeOffsetHighlight(container, id);
      removeHighlight(id);
    };

    return () => {
      delete win.luminaCreateHighlight;
      delete win.luminaSetHighlightColor;
      delete win.luminaRemoveHighlight;
    };
  }, [containerRef, bookId, locator, addHighlight, removeHighlight, updateHighlightColor]);
}
