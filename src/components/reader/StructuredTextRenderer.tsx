import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { storage } from "@/storage";
import { useBookStore } from "@/store/bookStore";
import { useReaderStore } from "@/store/readerStore";
import { useImageStore } from "@/store/imageStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useUiStore } from "@/store/uiStore";
import { useAudioStore } from "@/store/audioStore";
import { resolveChapterIndex } from "@/utils/chapterNavigation";
import { parseChapterDisplay } from "@/utils/titleUtils";
import { useStructuredHighlights } from "@/hooks/useStructuredHighlights";
import { useDeviceLayout } from "@/hooks/useDeviceLayout";
import { ensureReadingParagraphs } from "@/utils/readingText";
import type { Chapter } from "@/types";

const DEFAULT_WORDS_PER_PAGE = 220;
const FOCUS_COLUMN_COUNT = 2;
const FOCUS_COLUMN_GAP_PX = 48;

interface PageSegment {
  text: string;
  startOffset: number;
  endOffset: number;
  startWordOffset: number;
  endWordOffset: number;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function splitIntoPages(text: string, chapterTitle = "", wordsPerPage = DEFAULT_WORDS_PER_PAGE): string[] {
  return splitIntoPageSegments(text, chapterTitle, wordsPerPage).map((page) => page.text);
}

function renderedTextLength(pageText: string): number {
  return pageText.split(/\n{2,}/).join("").length;
}

function splitIntoPageSegments(
  text: string,
  chapterTitle = "",
  wordsPerPage = DEFAULT_WORDS_PER_PAGE
): PageSegment[] {
  const wpp = Math.max(60, Math.round(wordsPerPage));
  const display = parseChapterDisplay(chapterTitle);
  const cleanedText = removeLeadingDuplicateHeading(ensureReadingParagraphs(text), [
    chapterTitle,
    display.title,
    display.subtitle ?? "",
  ]);
  const paragraphs = cleanedText
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const pages: PageSegment[] = [];
  let current: string[] = [];
  let words = 0;
  let renderedOffset = 0;
  let wordOffset = 0;

  const pushPage = (parts: string[]) => {
    const pageText = parts.join("\n\n");
    const startOffset = renderedOffset;
    const endOffset = startOffset + renderedTextLength(pageText);
    const pageWordCount = wordCount(pageText);
    const startWordOffset = wordOffset;
    const endWordOffset = startWordOffset + pageWordCount;
    pages.push({ text: pageText, startOffset, endOffset, startWordOffset, endWordOffset });
    renderedOffset = endOffset;
    wordOffset = endWordOffset;
  };

  for (const paragraph of paragraphs) {
    const paragraphWords = paragraph.split(/\s+/).filter(Boolean);
    if (paragraphWords.length > wpp) {
      if (current.length > 0) {
        pushPage(current);
        current = [];
        words = 0;
      }
      for (let i = 0; i < paragraphWords.length; i += wpp) {
        pushPage([paragraphWords.slice(i, i + wpp).join(" ")]);
      }
      continue;
    }

    const count = paragraphWords.length;
    if (current.length > 0 && words + count > wpp) {
      pushPage(current);
      current = [];
      words = 0;
    }
    current.push(paragraph);
    words += count;
  }

  if (current.length > 0) pushPage(current);
  if (pages.length > 0) return pages;
  const fallback = cleanedText.trim();
  return [{
    text: fallback,
    startOffset: 0,
    endOffset: renderedTextLength(fallback),
    startWordOffset: 0,
    endWordOffset: wordCount(fallback),
  }];
}

// The chapter heading already renders in ChapterHeader, so drop a duplicate of
// it from the top of the body (the chapter's own <h1>, surfaced now that text
// extraction preserves blocks). Removes the whole leading block when it matches
// the chapter title/parts or reads as a generic "Chapter N[: subtitle]" line.
function removeLeadingDuplicateHeading(text: string, candidates: string[]): string {
  const trimmed = text.trimStart();
  const sepIdx = trimmed.search(/\n{2,}/);
  const firstBlock = (sepIdx === -1 ? trimmed : trimmed.slice(0, sepIdx)).replace(/\s+/g, " ").trim();
  if (!firstBlock || firstBlock.length > 90) return trimmed; // real prose, leave it

  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase().replace(/[:.—–-]+\s*$/u, "");
  const fb = norm(firstBlock);

  const matchesTitle = candidates.some((c) => {
    const cc = norm(c);
    return cc.length >= 3 && (fb === cc || fb.startsWith(cc) || cc.startsWith(fb));
  });
  const isGenericChapterLine = /^chapter\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/iu.test(firstBlock);

  if (matchesTitle || isGenericChapterLine) {
    return sepIdx === -1 ? "" : trimmed.slice(sepIdx).trimStart();
  }
  return trimmed;
}

function parseLuminaCfi(cfi: string | undefined): { chapterIndex: number; pageIndex: number } | null {
  const match = cfi?.match(/^lumina:\/\/chapter\/(-?\d+)\/page\/(\d+)$/);
  if (!match) return null;
  return {
    chapterIndex: Number(match[1]),
    pageIndex: Number(match[2]),
  };
}

function pageIndexForChapterOffset(pages: PageSegment[] | undefined, offset: number): number {
  if (!pages || pages.length === 0) return 0;
  const safeOffset = Math.max(0, offset);
  const index = pages.findIndex((page) => safeOffset >= page.startOffset && safeOffset < page.endOffset);
  return index >= 0 ? index : pages.length - 1;
}

/** Balance page paragraphs across a left/right focus spread (desktop only). */
function splitParagraphsForSpread(paragraphs: string[]): [string[], string[]] {
  if (paragraphs.length <= 1) return [paragraphs, []];
  const target =
    paragraphs.reduce((sum, paragraph) => sum + wordCount(paragraph), 0) / 2;
  const left: string[] = [];
  const right: string[] = [];
  let leftWords = 0;

  for (const paragraph of paragraphs) {
    const count = wordCount(paragraph);
    if (right.length === 0 && (left.length === 0 || leftWords + count <= target)) {
      left.push(paragraph);
      leftWords += count;
    } else {
      right.push(paragraph);
    }
  }

  if (right.length === 0 && left.length > 1) {
    const moved = left.pop();
    if (moved) right.push(moved);
  }

  return [left, right];
}

function pageIndexForChapterWordOffset(pages: PageSegment[] | undefined, offset: number): number {
  if (!pages || pages.length === 0) return 0;
  const safeOffset = Math.max(0, offset);
  const index = pages.findIndex((page) => safeOffset >= page.startWordOffset && safeOffset < page.endWordOffset);
  return index >= 0 ? index : pages.length - 1;
}

function locateWordPosition(
  chapters: Chapter[],
  pagesByChapter: PageSegment[][],
  wordPosition: number
): { chapterIndex: number; pageIndex: number } | null {
  if (chapters.length === 0) return null;
  let wordsBeforeChapter = 0;
  const safePosition = Math.max(0, wordPosition);

  for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
    const chapter = chapters[chapterIndex];
    const chapterEnd = wordsBeforeChapter + Math.max(1, chapter.wordCount);
    if (safePosition < chapterEnd || chapterIndex === chapters.length - 1) {
      const wordOffset = safePosition - wordsBeforeChapter;
      return {
        chapterIndex,
        pageIndex: pageIndexForChapterWordOffset(pagesByChapter[chapterIndex], wordOffset),
      };
    }
    wordsBeforeChapter = chapterEnd;
  }

  return null;
}

function ReadAlongParagraph({
  paragraph,
  paragraphIndex,
  pageStartWord,
  wordCursor,
  activeWordPosition,
}: {
  paragraph: string;
  paragraphIndex: number;
  pageStartWord: number;
  wordCursor: { current: number };
  activeWordPosition: number | null;
}) {
  const parts = paragraph.split(/(\s+)/);
  return (
    <p
      className={`mb-5 break-inside-avoid-column text-ink ${
        paragraphIndex === 0
          ? "first-letter:float-left first-letter:mr-2 first-letter:font-serif first-letter:text-[3.1em] first-letter:leading-[0.85] first-letter:text-lumina-gold/80"
          : ""
      }`}
    >
      {parts.map((part, index) => {
        if (/^\s+$/.test(part)) return part;
        const absoluteWord = pageStartWord + wordCursor.current;
        wordCursor.current += 1;
        const active = activeWordPosition === absoluteWord;
        const nearby =
          activeWordPosition !== null &&
          absoluteWord >= activeWordPosition - 2 &&
          absoluteWord <= activeWordPosition + 5;
        return (
          <span
            key={`${index}-${absoluteWord}`}
            data-readalong-active={active ? "true" : undefined}
            className={
              active
                ? "rounded-[0.22em] bg-lumina-gold/34 px-[0.08em] text-ink shadow-[0_0_18px_rgba(210,170,80,0.34)]"
                : nearby
                  ? "rounded-[0.22em] bg-sky-200/10 px-[0.03em] shadow-[0_0_12px_rgba(125,190,230,0.10)]"
                  : undefined
            }
          >
            {part}
          </span>
        );
      })}
    </p>
  );
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
  const activeWordPosition = useAudioStore((s) => s.activeWordPosition);
  const isAudioPlaying = useAudioStore((s) => s.isPlaying);
  const listenAlongMode = useAudioStore((s) => s.listenAlongMode);
  const isFocused = useUiStore((s) => s.focusMode === "reader");
  const { isTablet } = useDeviceLayout();
  // Expanded reader spread: two columns on desktop only. Tablet stays single column.
  const useFocusColumns = isFocused && !listenAlongMode && !isTablet;
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
      let w = el.clientWidth;
      let h = el.clientHeight;
      if (isTablet) {
        const style = getComputedStyle(el);
        const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        w -= padX;
        h -= padY;
      }
      if (w < 60 || h < 60) return;
      const lineH = fontSize * lineHeight;
      const linesPerPage = Math.max(4, Math.floor(h / lineH));
      const columnCount = useFocusColumns ? FOCUS_COLUMN_COUNT : 1;
      const columnWidth =
        columnCount === 1
          ? w
          : Math.max(120, (w - FOCUS_COLUMN_GAP_PX * (columnCount - 1)) / columnCount);
      const charsPerLine = Math.max(24, Math.floor(columnWidth / (fontSize * 0.5)));
      // ~6 characters per word (including the trailing space).
      const approxWords = Math.round((linesPerPage * charsPerLine * columnCount) / 6);
      // Fill the page without clipping; tablet uses a tighter fill for the right gutter.
      const fillRatio = isTablet ? 0.82 : 0.9;
      const target = Math.max(90, Math.min(700, Math.round(approxWords * fillRatio)));
      setWordsPerPage((prev) => (Math.abs(prev - target) >= 12 ? target : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fontSize, lineHeight, currentChapterIndex, useFocusColumns, isTablet]);

  const chapterPageSegments = useMemo(
    () =>
      activeStructure?.chapters.map((chapter) =>
        splitIntoPageSegments(chapter.rawText || "", chapter.title, wordsPerPage)
      ) ?? [],
    [activeStructure, wordsPerPage]
  );
  const chapterPages = useMemo(
    () => chapterPageSegments.map((pages) => pages.map((page) => page.text)),
    [chapterPageSegments]
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
    const segments = chapterPageSegments[currentChapterIndex];
    if (!pages || pages.length === 0 || !segments || segments.length === 0) return;
    let target = pages.length - 1;
    for (let i = 0; i < segments.length; i++) {
      if (chapterWordOffsetRef.current < segments[i].endWordOffset) {
        target = i;
        break;
      }
    }
    setPageIndex((prev) => (prev === target ? prev : target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterPages, currentChapterIndex]);

  const saveLocation = useCallback(
    (chapterIndex: number, nextPageIndex: number) => {
      if (!activeBook || !activeStructure) return;

      const safeChapterIndex = Math.max(0, chapterIndex);
      const pagesInChapter = Math.max(1, chapterPages[safeChapterIndex]?.length ?? 1);
      const wordsBeforeChapter =
        chapterIndex < 0
          ? 0
          : activeStructure.chapters
              .slice(0, safeChapterIndex)
              .reduce((sum, chapter) => sum + chapter.wordCount, 0);
      const wordsIntoChapter =
        chapterIndex < 0
          ? 0
          : chapterPageSegments[safeChapterIndex]?.[nextPageIndex]?.startWordOffset ??
            Math.round(
                (activeStructure.chapters[safeChapterIndex]?.wordCount ?? 0) *
                  (nextPageIndex / pagesInChapter)
              );
      const wordPosition = wordsBeforeChapter + wordsIntoChapter;
      const totalWords = Math.max(1, activeStructure.totalWords || activeStructure.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0));
      const percentComplete = Math.max(0, Math.min(100, (wordPosition / totalWords) * 100));
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
      chapterPageSegments,
      setCurrentCfi,
      setCurrentChapterIndex,
      setPercentComplete,
      setWordPosition,
    ]
  );

  const goTo = useCallback(
    (
      chapterIndex: number,
      nextPageIndex: number,
      options: { sequential?: boolean } = {}
    ) => {
      if (!activeStructure) return;
      if (chapterIndex < 0 && activeBook?.coverImage) {
        if (!options.sequential) useImageStore.getState().markNavigationJump();
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

      if (!options.sequential) {
        useImageStore.getState().markNavigationJump();
      }

      // Record the word offset at the start of this page so re-pagination can
      // return the reader to the same text.
      chapterWordOffsetRef.current = chapterPageSegments[safeChapterIndex]?.[safePageIndex]?.startWordOffset ?? 0;

      setPageIndex(safePageIndex);
      saveLocation(safeChapterIndex, safePageIndex);
    },
    [activeBook?.coverImage, activeStructure, chapterPages, chapterPageSegments, saveLocation]
  );

  useEffect(() => {
    if (!activeStructure || !isAudioPlaying || activeWordPosition === null) return;
    const target = locateWordPosition(activeStructure.chapters, chapterPageSegments, activeWordPosition);
    if (!target) return;
    if (listenAlongMode) {
      if (target.chapterIndex !== currentChapterIndex) goTo(target.chapterIndex, 0);
      return;
    }
    if (target.chapterIndex === currentChapterIndex && target.pageIndex === pageIndex) return;
    goTo(target.chapterIndex, target.pageIndex);
  }, [
    activeStructure,
    activeWordPosition,
    chapterPageSegments,
    currentChapterIndex,
    goTo,
    isAudioPlaying,
    listenAlongMode,
    pageIndex,
  ]);

  useEffect(() => {
    if (!listenAlongMode || !isAudioPlaying || activeWordPosition === null) return;
    const activeEl = contentRef.current?.querySelector('[data-readalong-active="true"]');
    activeEl?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeWordPosition, isAudioPlaying, listenAlongMode]);

  const nextPage = useCallback(() => {
    if (!activeStructure) return;
    if (currentChapterIndex < 0) {
      goTo(0, 0, { sequential: true });
      return;
    }

    const pagesInChapter = Math.max(1, chapterPages[currentChapterIndex]?.length ?? 1);
    if (pageIndex < pagesInChapter - 1) goTo(currentChapterIndex, pageIndex + 1, { sequential: true });
    else goTo(currentChapterIndex + 1, 0, { sequential: true });
  }, [activeStructure, chapterPages, currentChapterIndex, goTo, pageIndex]);

  const prevPage = useCallback(() => {
    if (!activeStructure) return;
    if (currentChapterIndex <= 0 && pageIndex === 0) {
      if (activeBook?.coverImage) goTo(-1, 0, { sequential: true });
      return;
    }

    if (pageIndex > 0) {
      goTo(currentChapterIndex, pageIndex - 1, { sequential: true });
      return;
    }

    const previousChapter = currentChapterIndex - 1;
    const previousPages = Math.max(1, chapterPages[previousChapter]?.length ?? 1);
    goTo(previousChapter, previousPages - 1, { sequential: true });
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
      const charLoc = target.match(/^lumina:\/\/chapter\/(-?\d+)\/char\/(\d+)$/);
      if (charLoc) {
        const chapterIndex = Number(charLoc[1]);
        const page = pageIndexForChapterOffset(chapterPageSegments[chapterIndex], Number(charLoc[2]));
        goTo(chapterIndex, page);
        return;
      }
      const index = resolveChapterIndex(activeStructure, target);
      if (index >= 0) goTo(index, 0);
    };
    win.luminaNavigateToScene = (target: string, wordOffset = 0) => {
      const index = resolveChapterIndex(activeStructure, target);
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
  }, [activeStructure, chapterPages, chapterPageSegments, goTo, nextPage, prevPage]);

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
  const currentPageSegment =
    currentChapterIndex < 0 ? null : chapterPageSegments[currentChapterIndex]?.[pageIndex] ?? null;
  useStructuredHighlights({
    containerRef: contentRef,
    bookId: activeBook?.id,
    locator: highlightLocator,
    chapterIndex: currentChapterIndex < 0 ? null : currentChapterIndex,
    pageStartOffset: currentPageSegment?.startOffset ?? 0,
  });

  if (!activeBook || !activeStructure) return null;

  const isCover = currentChapterIndex < 0;
  const currentText = isCover
    ? ""
    : listenAlongMode
      ? activeStructure.chapters[currentChapterIndex]?.rawText ?? ""
      : chapterPages[currentChapterIndex]?.[pageIndex] ?? activeStructure.chapters[currentChapterIndex]?.rawText ?? "";
  const wordsBeforeCurrentChapter =
    currentChapterIndex < 0
      ? 0
      : activeStructure.chapters.slice(0, currentChapterIndex).reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const currentPageStartWord =
    currentChapterIndex < 0
      ? 0
      : listenAlongMode
        ? wordsBeforeCurrentChapter
        : wordsBeforeCurrentChapter + (currentPageSegment?.startWordOffset ?? 0);
  const paragraphWordCursor = { current: 0 };
  const pageParagraphs = currentText.split(/\n{2,}/).filter(Boolean);
  const focusSpread = useFocusColumns ? splitParagraphsForSpread(pageParagraphs) : null;

  const renderParagraphs = (paragraphs: string[], startParagraphIndex: number) =>
    paragraphs.map((paragraph, index) => (
      <ReadAlongParagraph
        key={`${startParagraphIndex + index}-${paragraph.slice(0, 24)}`}
        paragraph={paragraph}
        paragraphIndex={startParagraphIndex + index}
        pageStartWord={currentPageStartWord}
        wordCursor={paragraphWordCursor}
        activeWordPosition={activeWordPosition}
      />
    ));

  return (
    <div
      className={`reader-paper-surface relative h-full w-full overflow-hidden bg-reader py-5 text-ink ${
        isTablet
          ? "pl-3 pr-0"
          : isFocused && !isTablet
            ? "px-[clamp(1.5rem,4vw,3.5rem)]"
            : "px-[clamp(0.75rem,2vw,1.25rem)]"
      }`}
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
        <div
          className={
            isFocused && !isTablet
              ? "relative z-10 flex h-full w-full max-w-none flex-col overflow-hidden"
              : isFocused && isTablet
                ? "relative z-10 mx-auto flex h-full w-full max-w-[min(100%,94%)] flex-col overflow-hidden"
                : isTablet
                  ? "relative z-10 flex h-full w-full max-w-full flex-col overflow-hidden"
                  : "relative z-10 mx-auto flex h-full w-full max-w-[min(100%,810px)] flex-col overflow-hidden"
          }
        >
          <div className="mb-4 flex items-center justify-between border-b border-hair pb-3">
            <p className="text-[10px] uppercase tracking-[0.22em] text-lumina-gold/58">
              {activeBook.title}
            </p>
            <p className="text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              {listenAlongMode
                ? "Listen Along"
                : `${pageIndex + 1} / ${Math.max(1, chapterPages[currentChapterIndex]?.length ?? 1)}`}
            </p>
          </div>
          <div
            ref={contentRef}
            className={[
              "min-h-0 flex-1 overscroll-contain font-serif text-ink [text-wrap:pretty]",
              useFocusColumns
                ? "grid grid-cols-2 gap-x-[clamp(2rem,4.5vw,4rem)] overflow-hidden"
                : isTablet
                  ? listenAlongMode
                    ? "overflow-y-auto pr-[0.25in]"
                    : "overflow-hidden pr-[0.25in]"
                  : "overflow-y-auto pr-2",
            ].join(" ")}
          >
            {focusSpread ? (
              <>
                <div className="min-h-0 overflow-hidden">{renderParagraphs(focusSpread[0], 0)}</div>
                <div className="min-h-0 overflow-hidden">
                  {renderParagraphs(focusSpread[1], focusSpread[0].length)}
                </div>
              </>
            ) : (
              renderParagraphs(pageParagraphs, 0)
            )}
          </div>
        </div>
      )}
    </div>
  );
}
