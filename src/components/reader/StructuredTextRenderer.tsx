import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { storage } from "@/storage";
import { useBookStore } from "@/store/bookStore";
import { useReaderStore } from "@/store/readerStore";
import { useSettingsStore } from "@/store/settingsStore";
import { parseChapterDisplay } from "@/utils/titleUtils";
import { useStructuredHighlights } from "@/hooks/useStructuredHighlights";

const DEFAULT_WORDS_PER_PAGE = 220;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function splitIntoPages(text: string, chapterTitle = "", wordsPerPage = DEFAULT_WORDS_PER_PAGE): string[] {
  const wpp = Math.max(60, Math.round(wordsPerPage));
  const display = parseChapterDisplay(chapterTitle);
  const cleanedText = removeLeadingDuplicateHeading(text, [
    chapterTitle,
    display.title,
    display.subtitle ?? "",
  ]);
  const paragraphs = cleanedText
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const pages: string[] = [];
  let current: string[] = [];
  let words = 0;

  for (const paragraph of paragraphs) {
    const paragraphWords = paragraph.split(/\s+/).filter(Boolean);
    if (paragraphWords.length > wpp) {
      if (current.length > 0) {
        pages.push(current.join("\n\n"));
        current = [];
        words = 0;
      }
      for (let i = 0; i < paragraphWords.length; i += wpp) {
        pages.push(paragraphWords.slice(i, i + wpp).join(" "));
      }
      continue;
    }

    const count = paragraphWords.length;
    if (current.length > 0 && words + count > wpp) {
      pages.push(current.join("\n\n"));
      current = [];
      words = 0;
    }
    current.push(paragraph);
    words += count;
  }

  if (current.length > 0) pages.push(current.join("\n\n"));
  return pages.length > 0 ? pages : [cleanedText.trim()];
}

function removeLeadingDuplicateHeading(text: string, candidates: string[]): string {
  let cleaned = text.trimStart();
  for (const candidate of candidates) {
    const heading = candidate.replace(/\s+/g, " ").trim();
    if (!heading || !isGenericChapterHeading(heading)) continue;
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escaped}(?=\\s|[.:;,—–-]|$)`, "iu");
    cleaned = cleaned.replace(pattern, "").trimStart();
  }
  return cleaned;
}

function isGenericChapterHeading(title: string): boolean {
  return /^chapter\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\.?$/iu.test(
    title.trim()
  );
}

function parseLuminaCfi(cfi: string | undefined): { chapterIndex: number; pageIndex: number } | null {
  const match = cfi?.match(/^lumina:\/\/chapter\/(-?\d+)\/page\/(\d+)$/);
  if (!match) return null;
  return {
    chapterIndex: Number(match[1]),
    pageIndex: Number(match[2]),
  };
}

export default function StructuredTextRenderer({
  initialCfi,
  onInitialDisplayComplete,
}: {
  initialCfi?: string;
  onInitialDisplayComplete?: () => void;
}) {
  const { activeBook, activeStructure } = useBookStore();
  const {
    currentChapterIndex,
    setCurrentCfi,
    setCurrentChapterIndex,
    setPercentComplete,
    setWordPosition,
  } = useReaderStore();
  const { fontSize, lineHeight } = useSettingsStore();
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Word offset within the current chapter, preserved across re-pagination so
  // the reader stays on the same text when the page size changes.
  const chapterWordOffsetRef = useRef(0);

  // Words per page, derived from the measured content area. A wider/taller page
  // (e.g. focus mode) gets more text so it fills comfortably.
  const [wordsPerPage, setWordsPerPage] = useState(DEFAULT_WORDS_PER_PAGE);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 60 || h < 60) return;
      const lineH = fontSize * lineHeight;
      const linesPerPage = Math.max(4, Math.floor(h / lineH));
      const charsPerLine = Math.max(24, Math.floor(w / (fontSize * 0.5)));
      // ~6 characters per word (including the trailing space).
      const approxWords = Math.round((linesPerPage * charsPerLine) / 6);
      // Fill ~90% of the page so it reads full but never overflows.
      const target = Math.max(90, Math.min(700, Math.round(approxWords * 0.9)));
      setWordsPerPage((prev) => (Math.abs(prev - target) >= 12 ? target : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fontSize, lineHeight, currentChapterIndex]);

  const chapterPages = useMemo(
    () =>
      activeStructure?.chapters.map((chapter) =>
        splitIntoPages(chapter.rawText || "", chapter.title, wordsPerPage)
      ) ?? [],
    [activeStructure, wordsPerPage]
  );

  const initialLocation = useMemo(() => {
    const fromCfi = parseLuminaCfi(initialCfi);
    if (fromCfi) return fromCfi;
    // Fall back to the live reading position so a remount (e.g. toggling focus
    // mode) restores where the reader was, not the start of the book.
    const fromStore = parseLuminaCfi(useReaderStore.getState().currentCfi);
    if (fromStore) return fromStore;
    return { chapterIndex: activeBook?.coverImage ? -1 : 0, pageIndex: 0 };
  }, [activeBook?.coverImage, initialCfi]);

  const [pageIndex, setPageIndex] = useState(initialLocation.pageIndex);

  // Keep the same text on screen when pagination changes (page size / resize).
  useEffect(() => {
    if (currentChapterIndex < 0) return;
    const pages = chapterPages[currentChapterIndex];
    if (!pages || pages.length === 0) return;
    let acc = 0;
    let target = pages.length - 1;
    for (let i = 0; i < pages.length; i++) {
      const wc = wordCount(pages[i]);
      if (chapterWordOffsetRef.current < acc + wc) {
        target = i;
        break;
      }
      acc += wc;
    }
    setPageIndex((prev) => (prev === target ? prev : target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterPages, currentChapterIndex]);

  const saveLocation = useCallback(
    (chapterIndex: number, nextPageIndex: number) => {
      if (!activeBook || !activeStructure) return;

      const safeChapterIndex = Math.max(0, chapterIndex);
      const chapterCount = Math.max(1, activeStructure.chapters.length);
      const pagesInChapter = Math.max(1, chapterPages[safeChapterIndex]?.length ?? 1);
      const chapterProgress =
        chapterIndex < 0 ? 0 : (safeChapterIndex + nextPageIndex / pagesInChapter) / chapterCount;
      const percentComplete = Math.max(0, Math.min(100, chapterProgress * 100));
      const wordsBeforeChapter =
        chapterIndex < 0
          ? 0
          : activeStructure.chapters
              .slice(0, safeChapterIndex)
              .reduce((sum, chapter) => sum + chapter.wordCount, 0);
      const wordsIntoChapter =
        chapterIndex < 0
          ? 0
          : Math.round(
              (activeStructure.chapters[safeChapterIndex]?.wordCount ?? 0) *
                (nextPageIndex / pagesInChapter)
            );
      const wordPosition = wordsBeforeChapter + wordsIntoChapter;
      const cfi =
        chapterIndex < 0
          ? "lumina://cover"
          : `lumina://chapter/${safeChapterIndex}/page/${nextPageIndex}`;

      setCurrentCfi(cfi);
      setCurrentChapterIndex(chapterIndex);
      setPercentComplete(percentComplete);
      setWordPosition(wordPosition);
      storage
        .saveProgress({
          bookId: activeBook.id,
          currentCfi: cfi,
          currentChapterIndex: safeChapterIndex,
          percentComplete,
          lastRead: new Date().toISOString(),
        })
        .catch(() => {});
    },
    [
      activeBook,
      activeStructure,
      chapterPages,
      setCurrentCfi,
      setCurrentChapterIndex,
      setPercentComplete,
      setWordPosition,
    ]
  );

  const goTo = useCallback(
    (chapterIndex: number, nextPageIndex: number) => {
      if (!activeStructure) return;
      if (chapterIndex < 0 && activeBook?.coverImage) {
        setPageIndex(0);
        saveLocation(-1, 0);
        return;
      }

      const safeChapterIndex = Math.max(
        0,
        Math.min(activeStructure.chapters.length - 1, chapterIndex)
      );
      const pages = chapterPages[safeChapterIndex];
      const pagesInChapter = Math.max(1, pages?.length ?? 1);
      const safePageIndex = Math.max(0, Math.min(pagesInChapter - 1, nextPageIndex));

      // Record the word offset at the start of this page so re-pagination can
      // return the reader to the same text.
      let offset = 0;
      if (pages) for (let i = 0; i < safePageIndex && i < pages.length; i++) offset += wordCount(pages[i]);
      chapterWordOffsetRef.current = offset;

      setPageIndex(safePageIndex);
      saveLocation(safeChapterIndex, safePageIndex);
    },
    [activeBook?.coverImage, activeStructure, chapterPages, saveLocation]
  );

  const nextPage = useCallback(() => {
    if (!activeStructure) return;
    if (currentChapterIndex < 0) {
      goTo(0, 0);
      return;
    }

    const pagesInChapter = Math.max(1, chapterPages[currentChapterIndex]?.length ?? 1);
    if (pageIndex < pagesInChapter - 1) goTo(currentChapterIndex, pageIndex + 1);
    else goTo(currentChapterIndex + 1, 0);
  }, [activeStructure, chapterPages, currentChapterIndex, goTo, pageIndex]);

  const prevPage = useCallback(() => {
    if (!activeStructure) return;
    if (currentChapterIndex <= 0 && pageIndex === 0) {
      if (activeBook?.coverImage) goTo(-1, 0);
      return;
    }

    if (pageIndex > 0) {
      goTo(currentChapterIndex, pageIndex - 1);
      return;
    }

    const previousChapter = currentChapterIndex - 1;
    const previousPages = Math.max(1, chapterPages[previousChapter]?.length ?? 1);
    goTo(previousChapter, previousPages - 1);
  }, [activeBook?.coverImage, activeStructure, chapterPages, currentChapterIndex, goTo, pageIndex]);

  useEffect(() => {
    goTo(initialLocation.chapterIndex, initialLocation.pageIndex);
    onInitialDisplayComplete?.();
  }, []); // initial mount only

  useEffect(() => {
    type LuminaWin = Window & {
      luminaNavigate?: (target: string) => void;
      luminaNavigateToScene?: (target: string, wordOffset?: number) => void;
      luminaNextPage?: () => void;
      luminaPrevPage?: () => void;
    };
    const win = window as LuminaWin;

    win.luminaNextPage = nextPage;
    win.luminaPrevPage = prevPage;
    win.luminaNavigate = (target: string) => {
      // Structured locator from a highlight: lumina://chapter/{ch}/page/{pg}
      const loc = target.match(/^lumina:\/\/chapter\/(-?\d+)\/page\/(\d+)$/);
      if (loc) {
        goTo(Number(loc[1]), Number(loc[2]));
        return;
      }
      const index = activeStructure?.chapters.findIndex(
        (chapter) =>
          chapter.id === target ||
          chapter.href === target ||
          chapter.startCfi === target ||
          Boolean(chapter.href && target.endsWith(chapter.href.split("/").pop() ?? ""))
      );
      if (index !== undefined && index >= 0) goTo(index, 0);
    };
    win.luminaNavigateToScene = (target: string, wordOffset = 0) => {
      const index = activeStructure?.chapters.findIndex(
        (chapter) =>
          chapter.id === target ||
          chapter.href === target ||
          chapter.startCfi === target ||
          Boolean(chapter.href && target.endsWith(chapter.href.split("/").pop() ?? ""))
      );
      if (index === undefined || index < 0) return;
      const chapter = activeStructure?.chapters[index];
      const pagesInChapter = Math.max(1, chapterPages[index]?.length ?? 1);
      const ratio = chapter?.wordCount
        ? Math.max(0, Math.min(1, wordOffset / chapter.wordCount))
        : 0;
      goTo(index, Math.floor(ratio * pagesInChapter));
    };

    return () => {
      delete win.luminaNextPage;
      delete win.luminaPrevPage;
      delete win.luminaNavigate;
      delete win.luminaNavigateToScene;
    };
  }, [activeStructure, chapterPages, goTo, nextPage, prevPage]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === "PageDown") nextPage();
      if (event.key === "ArrowLeft" || event.key === "PageUp") prevPage();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nextPage, prevPage]);

  // Page locator for highlight anchoring (null on the cover).
  const highlightLocator =
    currentChapterIndex < 0 ? null : `lumina://chapter/${currentChapterIndex}/page/${pageIndex}`;
  useStructuredHighlights({
    containerRef: contentRef,
    bookId: activeBook?.id,
    locator: highlightLocator,
  });

  if (!activeBook || !activeStructure) return null;

  const isCover = currentChapterIndex < 0;
  const currentText = isCover
    ? ""
    : chapterPages[currentChapterIndex]?.[pageIndex] ?? activeStructure.chapters[currentChapterIndex]?.rawText ?? "";

  return (
    <div
      className="reader-paper-surface relative h-full w-full overflow-hidden bg-reader px-6 py-5 text-ink"
      onClick={(event) => {
        // Don't turn the page while the reader is selecting text.
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        if (x > rect.width * 0.72) nextPage();
        if (x < rect.width * 0.28) prevPage();
      }}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        if (touch) setTouchStart({ x: touch.clientX, y: touch.clientY });
      }}
      onTouchEnd={(event) => {
        const touch = event.changedTouches[0];
        if (!touchStart || !touch) return;
        const dx = touch.clientX - touchStart.x;
        const dy = touch.clientY - touchStart.y;
        setTouchStart(null);
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.35) {
          if (dx < 0) nextPage();
          else prevPage();
        }
      }}
      style={{ fontSize: `${fontSize}px`, lineHeight }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-ink/[0.035] to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-reader to-transparent" />
      {isCover ? (
        <div className="relative z-10 flex h-full items-center justify-center">
          {activeBook.coverImage ? (
            <div className="relative flex h-full w-full items-center justify-center">
              <div className="absolute inset-10 rounded-full bg-lumina-gold/8 blur-3xl" />
              <img
                src={activeBook.coverImage}
                alt={`${activeBook.title} cover`}
                className="relative max-h-[92%] max-w-[86%] rounded-md border border-hair object-contain shadow-2xl shadow-black/55"
                draggable={false}
              />
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center px-8 text-center">
              <div className="max-w-md border-y border-lumina-gold/30 py-10">
                <p className="mb-4 text-xs uppercase tracking-[0.26em] text-lumina-gold/65">
                  Lumina
                </p>
                <h2 className="font-serif text-3xl leading-tight text-ink">
                  {activeBook.title}
                </h2>
                <p className="mt-4 text-sm uppercase tracking-[0.18em] text-ink-faint">
                  {activeBook.author}
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="relative z-10 mx-auto flex h-full max-w-[680px] flex-col overflow-hidden">
          <div className="mb-4 flex items-center justify-between border-b border-hair pb-3">
            <p className="text-[10px] uppercase tracking-[0.22em] text-lumina-gold/58">
              {activeBook.title}
            </p>
            <p className="text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              {pageIndex + 1} / {Math.max(1, chapterPages[currentChapterIndex]?.length ?? 1)}
            </p>
          </div>
          <div
            ref={contentRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2 font-serif text-ink [text-wrap:pretty]"
          >
            {currentText.split(/\n{2,}/).map((paragraph, index) => (
              <p
                key={index}
                className={`mb-5 text-ink ${
                  index === 0
                    ? "first-letter:float-left first-letter:mr-2 first-letter:font-serif first-letter:text-[3.1em] first-letter:leading-[0.85] first-letter:text-lumina-gold/80"
                    : ""
                }`}
              >
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
