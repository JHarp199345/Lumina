/**
 * EpubRenderer
 *
 * Single source of truth for:
 *   - EPUB.js lifecycle (init, destroy, font updates)
 *   - Reading progress persistence (owns dbSaveProgress — useReadPosition does not)
 *   - Highlight re-application via rendition.annotations
 *   - Window API for navigation, CFI extraction, search, search-mark clearing
 */

import { useEffect, useRef, useCallback } from "react";
import Epub from "epubjs";
import type { Book as EpubBook, Rendition, NavItem } from "epubjs";
import { useReaderStore } from "@/store/readerStore";
import { useBookStore } from "@/store/bookStore";
import { useAnnotationStore } from "@/store/annotationStore";
import { useSettingsStore } from "@/store/settingsStore";
import { dbSaveProgress } from "@/services/db";

interface EpubRendererProps {
  epubPath: string;
  bookId: string;
  /** Stable CFI to display on first mount, captured before activeBook is set. */
  initialCfi?: string;
  /** Called once after the initial CFI has been displayed. */
  onInitialDisplayComplete?: () => void;
  onTocReady?: (toc: NavItem[]) => void;
}

const HIGHLIGHT_CLASS: Record<string, string> = {
  yellow: "lumina-hl-yellow",
  blue:   "lumina-hl-blue",
  green:  "lumina-hl-green",
  red:    "lumina-hl-red",
};

export default function EpubRenderer({
  epubPath,
  bookId,
  initialCfi,
  onInitialDisplayComplete,
  onTocReady,
}: EpubRendererProps) {
  const containerRef      = useRef<HTMLDivElement>(null);
  const bookRef           = useRef<EpubBook | null>(null);
  const renditionRef      = useRef<Rendition | null>(null);
  const saveTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialDisplayed  = useRef(false);   // gate: only display initialCfi once

  const { setCurrentCfi, setPercentComplete, setCurrentChapterIndex } = useReaderStore();
  const { activeStructure } = useBookStore();
  const { getHighlightsForBook } = useAnnotationStore();
  const { fontSize, lineHeight } = useSettingsStore();

  // ── Re-apply persisted highlights ─────────────────────────────────────────

  const applyHighlights = useCallback(() => {
    const r = renditionRef.current;
    if (!r) return;
    for (const h of getHighlightsForBook(bookId)) {
      if (!h.cfiRange || h.cfiRange.startsWith("dom:")) continue;
      try {
        r.annotations.remove(h.id, "highlight");
        r.annotations.highlight(
          h.cfiRange,
          { id: h.id },
          undefined,
          HIGHLIGHT_CLASS[h.color] ?? "lumina-hl-yellow"
        );
      } catch { /* CFI may not be on the visible section */ }
    }
  }, [bookId, getHighlightsForBook]);

  // ── Map EPUB.js href to chapter index ──────────────────────────────────────

  const findChapterIndex = useCallback(
    (href: string | undefined): number => {
      if (!activeStructure || !href) return 0;
      const baseName = href.split("/").pop() ?? "";
      const idx = activeStructure.chapters.findIndex(
        (ch) => ch.href && (ch.href === href || ch.href.endsWith(baseName))
      );
      return idx >= 0 ? idx : 0;
    },
    [activeStructure]
  );

  // ── Debounced progress save (single owner — not duplicated in useReadPosition) ──

  const scheduleSave = useCallback(
    (cfi: string, chapterIndex: number, percent: number) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        dbSaveProgress({
          bookId,
          currentCfi: cfi,
          currentChapterIndex: chapterIndex,
          percentComplete: percent,
          lastRead: new Date().toISOString(),
        }).catch(() => {});
      }, 4000);
    },
    [bookId]
  );

  // ── Init EPUB.js ───────────────────────────────────────────────────────────

  const initEpub = useCallback(async () => {
    if (!containerRef.current) return;

    renditionRef.current?.destroy();
    bookRef.current?.destroy();
    initialDisplayed.current = false;

    const book = Epub(epubPath);
    bookRef.current = book;

    const rendition = book.renderTo(containerRef.current, {
      width: "100%",
      height: "100%",
      flow: "scrolled-doc",
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;

    // Inject reader + highlight + search-mark styles
    rendition.themes.default({
      body: {
        "font-size": `${fontSize}px`,
        "line-height": String(lineHeight),
        "color": "rgba(255, 255, 255, 0.85)",
        "background": "transparent",
        "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        "padding": "0 !important",
      },
      p:          { "margin-bottom": "1.2em", "text-align": "left" },
      "h1,h2,h3": { "font-family": "Georgia,serif", "color": "rgba(255,255,255,0.9)", "margin-bottom": "0.75em", "margin-top": "1.5em" },
      a:          { "color": "#c9a84c", "text-decoration": "none" },
      ".lumina-hl-yellow": { "background": "rgba(250,204,21,0.28)", "border-radius": "2px" },
      ".lumina-hl-blue":   { "background": "rgba(59,130,246,0.28)", "border-radius": "2px" },
      ".lumina-hl-green":  { "background": "rgba(34,197,94,0.22)",  "border-radius": "2px" },
      ".lumina-hl-red":    { "background": "rgba(239,68,68,0.22)",  "border-radius": "2px" },
      ".lumina-search":    { "background": "rgba(201,168,76,0.4)",  "border-radius": "2px", "outline": "1px solid rgba(201,168,76,0.6)" },
    });

    // Re-apply highlights every time a new section renders
    rendition.on("rendered", () => applyHighlights());

    // Track location — single place progress is saved
    rendition.on(
      "relocated",
      (loc: { start: { cfi: string; percentage: number; href?: string } }) => {
        if (!loc?.start?.cfi) return;
        const cfi     = loc.start.cfi;
        const percent = (loc.start.percentage || 0) * 100;
        const chIdx   = findChapterIndex(loc.start.href);

        setCurrentCfi(cfi);
        setPercentComplete(percent);
        setCurrentChapterIndex(chIdx);
        scheduleSave(cfi, chIdx, percent);
      }
    );

    await book.ready;

    const nav = await book.loaded.navigation;
    if (onTocReady && nav?.toc) onTocReady(nav.toc);

    // Display initial location exactly once
    if (initialCfi && initialCfi.startsWith("epubcfi(")) {
      await rendition.display(initialCfi);
    } else {
      await rendition.display();
    }
    initialDisplayed.current = true;
    onInitialDisplayComplete?.();
  }, [
    epubPath, fontSize, lineHeight,
    applyHighlights, findChapterIndex, scheduleSave,
    setCurrentCfi, setPercentComplete, setCurrentChapterIndex,
    onTocReady, initialCfi, onInitialDisplayComplete,
  ]);

  useEffect(() => {
    initEpub();
    return () => {
      // Flush any pending save immediately on unmount
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        const { currentCfi, currentChapterIndex, percentComplete } = useReaderStore.getState();
        if (currentCfi) {
          dbSaveProgress({
            bookId,
            currentCfi,
            currentChapterIndex,
            percentComplete,
            lastRead: new Date().toISOString(),
          }).catch(() => {});
        }
      }
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
    };
  }, [epubPath]); // Only re-init when the EPUB file changes

  // Update font styles without full reinit
  useEffect(() => {
    renditionRef.current?.themes.default({
      body: { "font-size": `${fontSize}px`, "line-height": String(lineHeight) },
    });
  }, [fontSize, lineHeight]);

  // Re-apply highlights when annotation store updates
  useEffect(() => { applyHighlights(); }, [applyHighlights]);

  // ── Window API ─────────────────────────────────────────────────────────────

  useEffect(() => {
    type LuminaWin = Window & {
      luminaNavigate?:         (target: string) => void;
      luminaEpubBook?:         { getCfiFromRange?: (r: Range) => string };
      luminaEpubSearch?:       (q: string) => Promise<{ cfi: string; excerpt: string }[]>;
      luminaMarkSearchResult?: (cfi: string) => void;
      luminaClearSearchMarks?: () => void;
    };
    const win = window as LuminaWin;

    win.luminaNavigate = (target: string) => {
      renditionRef.current?.display(target);
    };

    win.luminaEpubBook = {
      getCfiFromRange: (range: Range) => {
        try {
          return (bookRef.current as EpubBook & { cfiFromRange?: (r: Range) => string })
            .cfiFromRange?.(range) ?? "";
        } catch { return ""; }
      },
    };

    // Search across all spine items
    win.luminaEpubSearch = async (query: string) => {
      const book = bookRef.current;
      if (!book) return [];
      try {
        const results: { cfi: string; excerpt: string }[] = [];
        for (const item of (book.spine as unknown as { items: unknown[] }).items ?? []) {
          const si = item as {
            load: (l: unknown) => Promise<void>;
            find: (q: string) => { cfi: string; excerpt: string }[];
            unload: () => void;
          };
          await si.load((book as EpubBook & { load: unknown }).load);
          const found = si.find(query) || [];
          si.unload();
          results.push(...found.map((r) => ({ cfi: r.cfi, excerpt: r.excerpt || query })));
          if (results.length >= 100) break;
        }
        return results;
      } catch { return []; }
    };

    // Mark the current search result with a temporary highlight annotation
    win.luminaMarkSearchResult = (cfi: string) => {
      const r = renditionRef.current;
      if (!r || !cfi) return;
      try {
        r.annotations.remove("lumina-search-current", "highlight");
        r.annotations.highlight(cfi, { id: "lumina-search-current" }, undefined, "lumina-search");
      } catch { /* CFI may not be on visible section */ }
    };

    // Clear temporary search highlight
    win.luminaClearSearchMarks = () => {
      try {
        renditionRef.current?.annotations.remove("lumina-search-current", "highlight");
      } catch { /* ignore */ }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ background: "transparent" }}
    />
  );
}
