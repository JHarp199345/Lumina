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
import { storage } from "@/storage";
import { toAssetUrl } from "@/utils/tauriBridge";

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

const READER_TEXT_COLOR = "rgba(186, 222, 244, 0.88)";
const READER_MUTED_COLOR = "rgba(148, 190, 218, 0.72)";
const READER_HEADING_COLOR = "rgba(224, 243, 255, 0.94)";
const READER_BACKGROUND = "#071525";

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
  const touchStartRef     = useRef<{ x: number; y: number } | null>(null);
  const wiredDocsRef      = useRef<WeakSet<Document>>(new WeakSet());

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
        storage.saveProgress({
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

  const displayRelativeChapter = useCallback(async (direction: 1 | -1) => {
    const r = renditionRef.current;
    const structure = useBookStore.getState().activeStructure;
    if (!r || !structure?.chapters.length) return false;

    const { currentChapterIndex } = useReaderStore.getState();
    const nextIndex = Math.max(
      0,
      Math.min(structure.chapters.length - 1, currentChapterIndex + direction)
    );
    if (nextIndex === currentChapterIndex) return false;

    const chapter = structure.chapters[nextIndex];
    const target = chapter.startCfi || chapter.href;
    if (!target) return false;

    const before = useReaderStore.getState().currentCfi;
    await r.display(target);
    const after = useReaderStore.getState().currentCfi;
    setCurrentChapterIndex(nextIndex);
    return Boolean(after && after !== before);
  }, [setCurrentChapterIndex]);

  const displayRelativeSpineItem = useCallback(async (direction: 1 | -1) => {
    const r = renditionRef.current;
    const book = bookRef.current as
      | (EpubBook & {
          spine?: {
            items?: Array<{ href?: string; hrefNormalized?: string }>;
          };
        })
      | null;
    if (!r || !book?.spine?.items?.length) return false;

    const location = (
      r as unknown as {
        currentLocation?: () => { start?: { href?: string; index?: number } };
      }
    ).currentLocation?.();
    const currentHref = location?.start?.href;
    const currentIndex =
      typeof location?.start?.index === "number"
        ? location.start.index
        : book.spine.items.findIndex((item) =>
            Boolean(
              currentHref &&
                (item.href === currentHref ||
                  item.hrefNormalized === currentHref ||
                  currentHref.endsWith(item.href ?? ""))
            )
          );
    const nextIndex = Math.max(
      0,
      Math.min(book.spine.items.length - 1, currentIndex + direction)
    );
    if (nextIndex === currentIndex) return false;

    const target = book.spine.items[nextIndex]?.hrefNormalized || book.spine.items[nextIndex]?.href;
    if (!target) return false;

    await r.display(target);
    return true;
  }, []);

  const goNextPage = useCallback(() => {
    const r = renditionRef.current;
    if (!r) return;

    const before = useReaderStore.getState().currentCfi;
    void Promise.resolve(r.next()).then(() => {
      window.setTimeout(() => {
        const after = useReaderStore.getState().currentCfi;
        if (after && after !== before) return;
        void displayRelativeChapter(1).then((moved) => {
          if (!moved) void displayRelativeSpineItem(1);
        });
      }, 300);
    });
  }, [displayRelativeChapter, displayRelativeSpineItem]);

  const goPrevPage = useCallback(() => {
    const r = renditionRef.current;
    if (!r) return;

    const before = useReaderStore.getState().currentCfi;
    void Promise.resolve(r.prev()).then(() => {
      window.setTimeout(() => {
        const after = useReaderStore.getState().currentCfi;
        if (after && after !== before) return;
        void displayRelativeChapter(-1).then((moved) => {
          if (!moved) void displayRelativeSpineItem(-1);
        });
      }, 300);
    });
  }, [displayRelativeChapter, displayRelativeSpineItem]);

  const navigateToTarget = useCallback((target: string) => {
    const r = renditionRef.current;
    if (!r || !target) return;

    void Promise.resolve(r.display(target)).catch(() => {
      const fileName = target.split("#")[0]?.split("/").pop();
      if (!fileName) return;
      const book = bookRef.current as
        | (EpubBook & {
            spine?: {
              items?: Array<{ href?: string; hrefNormalized?: string }>;
            };
          })
        | null;
      const match = book?.spine?.items?.find((item) =>
        Boolean(
          (item.href && item.href.endsWith(fileName)) ||
            (item.hrefNormalized && item.hrefNormalized.endsWith(fileName))
        )
      );
      const fallback = match?.hrefNormalized || match?.href;
      if (fallback) void r.display(fallback);
    });
  }, []);

  const wireContentNavigation = useCallback(
    (doc: Document | undefined) => {
      if (!doc || wiredDocsRef.current.has(doc)) return;
      wiredDocsRef.current.add(doc);

      const isInteractive = (target: EventTarget | null) =>
        target instanceof Element &&
        Boolean(target.closest("a,button,input,textarea,select,[role='button']"));

      const onTouchStart = (event: TouchEvent) => {
        const touch = event.touches[0];
        if (!touch) return;
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      };

      const onTouchEnd = (event: TouchEvent) => {
        if (isInteractive(event.target)) return;
        const start = touchStartRef.current;
        const touch = event.changedTouches[0];
        touchStartRef.current = null;
        if (!start || !touch) return;

        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.35) {
          event.preventDefault();
          if (dx < 0) goNextPage();
          else goPrevPage();
        }
      };

      const onClick = (event: MouseEvent) => {
        if (isInteractive(event.target)) return;
        if (doc.getSelection()?.toString()) return;
        const width = doc.defaultView?.innerWidth || doc.documentElement.clientWidth;
        if (!width) return;
        if (event.clientX > width * 0.72) goNextPage();
        if (event.clientX < width * 0.28) goPrevPage();
      };

      doc.addEventListener("touchstart", onTouchStart, { passive: true });
      doc.addEventListener("touchend", onTouchEnd, { passive: false });
      doc.addEventListener("click", onClick);
    },
    [goNextPage, goPrevPage]
  );

  // ── Init EPUB.js ───────────────────────────────────────────────────────────

  const initEpub = useCallback(async () => {
    if (!containerRef.current) return;

    renditionRef.current?.destroy();
    bookRef.current?.destroy();
    initialDisplayed.current = false;

    // Web/PWA: EPUB is stored in IndexedDB — load bytes and pass an ArrayBuffer.
    // Tauri: EPUB is a native file path — use the asset:// protocol URL.
    let epubSource: string | ArrayBuffer;
    if (epubPath.startsWith("idb://")) {
      const activeBook = useBookStore.getState().activeBook;
      if (!activeBook) return;
      const bytes = await storage.getEpubBytes(activeBook);
      epubSource = bytes.buffer as ArrayBuffer;
    } else {
      epubSource = toAssetUrl(epubPath);
    }

    const book = Epub(epubSource);
    bookRef.current = book;

    const rendition = book.renderTo(containerRef.current, {
      width: "100%",
      height: "100%",
      flow: "paginated",
      spread: "none",
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;

    // Inject reader + highlight + search-mark styles
    rendition.themes.default({
      "html,body": {
        "background": `${READER_BACKGROUND} !important`,
        "color": `${READER_TEXT_COLOR} !important`,
      },
      body: {
        "font-size": `${fontSize}px`,
        "line-height": String(lineHeight),
        "color": `${READER_TEXT_COLOR} !important`,
        "background": `${READER_BACKGROUND} !important`,
        "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        "padding": "0 !important",
      },
      "*": {
        "color": `${READER_TEXT_COLOR} !important`,
        "border-color": "rgba(125, 183, 218, 0.18) !important",
      },
      "p,div,span,li,blockquote,section,article": {
        "color": `${READER_TEXT_COLOR} !important`,
        "text-shadow": "none !important",
      },
      p: {
        "margin-bottom": "1.2em",
        "text-align": "left",
      },
      "h1,h2,h3,h4,h5,h6": {
        "font-family": "Georgia, serif",
        "color": `${READER_HEADING_COLOR} !important`,
        "margin-bottom": "0.75em",
        "margin-top": "1.5em",
      },
      "i,em,cite": {
        "color": `${READER_MUTED_COLOR} !important`,
      },
      a: {
        "color": "#d6b95f !important",
        "text-decoration": "none",
      },
      ".lumina-hl-yellow": { "background": "rgba(250,204,21,0.28)", "border-radius": "2px" },
      ".lumina-hl-blue":   { "background": "rgba(59,130,246,0.28)", "border-radius": "2px" },
      ".lumina-hl-green":  { "background": "rgba(34,197,94,0.22)",  "border-radius": "2px" },
      ".lumina-hl-red":    { "background": "rgba(239,68,68,0.22)",  "border-radius": "2px" },
      ".lumina-search":    { "background": "rgba(201,168,76,0.4)",  "border-radius": "2px", "outline": "1px solid rgba(201,168,76,0.6)" },
    });

    // Re-apply highlights every time a new section renders
    rendition.on("rendered", (_section: unknown, view: { contents?: { document?: Document } }) => {
      applyHighlights();
      wireContentNavigation(view?.contents?.document);
    });

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
          storage.saveProgress({
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
      body: {
        "font-size": `${fontSize}px`,
        "line-height": String(lineHeight),
        "color": `${READER_TEXT_COLOR} !important`,
        "background": `${READER_BACKGROUND} !important`,
      },
    });
  }, [fontSize, lineHeight]);

  // Re-apply highlights when annotation store updates
  useEffect(() => { applyHighlights(); }, [applyHighlights]);

  // ── Window API ─────────────────────────────────────────────────────────────

  useEffect(() => {
    type LuminaWin = Window & {
      luminaNavigate?:         (target: string) => void;
      luminaNavigateToScene?:  (target: string, wordOffset?: number) => void;
      luminaNextPage?:         () => void;
      luminaPrevPage?:         () => void;
      luminaEpubBook?:         { getCfiFromRange?: (r: Range) => string };
      luminaEpubSearch?:       (q: string) => Promise<{ cfi: string; excerpt: string }[]>;
      luminaMarkSearchResult?: (cfi: string) => void;
      luminaClearSearchMarks?: () => void;
    };
    const win = window as LuminaWin;

    win.luminaNavigate = (target: string) => {
      navigateToTarget(target);
    };
    win.luminaNavigateToScene = (target: string) => {
      navigateToTarget(target);
    };

    win.luminaNextPage = () => {
      goNextPage();
    };

    win.luminaPrevPage = () => {
      goPrevPage();
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

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        goNextPage();
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        goPrevPage();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      delete win.luminaNavigate;
      delete win.luminaNavigateToScene;
      delete win.luminaNextPage;
      delete win.luminaPrevPage;
      delete win.luminaEpubBook;
      delete win.luminaEpubSearch;
      delete win.luminaMarkSearchResult;
      delete win.luminaClearSearchMarks;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [goNextPage, goPrevPage, navigateToTarget]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ background: "transparent" }}
    />
  );
}
