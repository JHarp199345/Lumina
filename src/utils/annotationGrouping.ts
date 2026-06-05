/**
 * annotationGrouping — derive a highlight's chapter from its EPUB CFI and group
 * highlights / notes by chapter for the Glossary and Notepad.
 *
 * Highlights store a `cfiRange` but not a chapter reference. We derive the chapter
 * by reading the spine step from the CFI:
 *
 *   epubcfi(/6/14!/4/2/...)
 *           ^^^^  spine step N → spineIndex = N/2 - 1
 *
 * and matching it against the book structure's chapters (which carry spineIndex).
 * When derivation fails, the highlight falls into an "Unsorted" bucket so nothing
 * is ever lost.
 */

import type { Highlight, Note, BookStructure, Chapter } from "@/types";
import { formatChapterTitle } from "@/utils/chapterTitles";

export interface ChapterGroup<T> {
  chapterIndex: number;      // -1 for the Unsorted bucket
  chapterTitle: string;
  items: T[];
}

/** Read the spine step from a CFI and convert to a 0-based spine index. */
export function spineIndexFromCfi(cfi: string): number {
  const match = cfi.match(/epubcfi\(\/6\/(\d+)/);
  if (!match) return -1;
  const step = parseInt(match[1], 10);
  if (!Number.isFinite(step) || step < 2) return -1;
  return Math.floor(step / 2) - 1;
}

/** Read the chapter index from a structured-reader locator. */
export function chapterIndexFromLocator(locator: string | undefined): number {
  const m = locator?.match(/^lumina:\/\/chapter\/(-?\d+)\/page\/\d+$/);
  return m ? Number(m[1]) : -1;
}

/** Find the chapter a highlight belongs to, or null if it can't be resolved. */
export function chapterForHighlight(
  highlight: Highlight,
  structure: BookStructure | null
): Chapter | null {
  if (!structure) return null;

  // Structured (web) reader: chapter index lives in the lumina:// locator.
  const locIndex = chapterIndexFromLocator(highlight.locator);
  if (locIndex >= 0) {
    return structure.chapters.find((ch) => ch.index === locIndex) ?? null;
  }

  // EPUB.js reader: derive from the CFI spine step.
  const spineIndex = spineIndexFromCfi(highlight.cfiRange);
  if (spineIndex < 0) return null;
  return (
    structure.chapters.find((ch) => ch.spineIndex === spineIndex) ??
    structure.chapters.find((ch) => ch.index === spineIndex) ??
    null
  );
}

/** A readable chapter title for a group header. */
export function chapterLabel(chapter: Chapter | null): string {
  if (!chapter) return "Unsorted";
  const formatted = formatChapterTitle(chapter.title, chapter.index);
  return formatted.title || `Chapter ${chapter.index + 1}`;
}

/** Group highlights by chapter, ordered by chapter index, then reading order. */
export function groupHighlightsByChapter(
  highlights: Highlight[],
  structure: BookStructure | null
): ChapterGroup<Highlight>[] {
  const buckets = new Map<number, { title: string; items: Highlight[] }>();

  for (const h of highlights) {
    const chapter = chapterForHighlight(h, structure);
    const key = chapter ? chapter.index : -1;
    const title = chapterLabel(chapter);
    if (!buckets.has(key)) buckets.set(key, { title, items: [] });
    buckets.get(key)!.items.push(h);
  }

  return [...buckets.entries()]
    .map(([chapterIndex, { title, items }]) => ({
      chapterIndex,
      chapterTitle: title,
      items: items.sort(byCreatedAt),
    }))
    .sort(byChapterIndex);
}

/**
 * Group notes by chapter. A note files under the chapter of its linked highlight
 * (if any), otherwise the Unsorted bucket. Requires the highlight list to resolve
 * the link.
 */
export function groupNotesByChapter(
  notes: Note[],
  highlights: Highlight[],
  structure: BookStructure | null
): ChapterGroup<Note>[] {
  const highlightById = new Map(highlights.map((h) => [h.id, h]));
  const buckets = new Map<number, { title: string; items: Note[] }>();

  for (const n of notes) {
    const linked = n.highlightId ? highlightById.get(n.highlightId) : undefined;
    const chapter = linked ? chapterForHighlight(linked, structure) : null;
    const key = chapter ? chapter.index : -1;
    const title = chapterLabel(chapter);
    if (!buckets.has(key)) buckets.set(key, { title, items: [] });
    buckets.get(key)!.items.push(n);
  }

  return [...buckets.entries()]
    .map(([chapterIndex, { title, items }]) => ({
      chapterIndex,
      chapterTitle: title,
      items: items.sort(byCreatedAt),
    }))
    .sort(byChapterIndex);
}

function byCreatedAt(a: { createdAt: string }, b: { createdAt: string }): number {
  return a.createdAt.localeCompare(b.createdAt);
}

function byChapterIndex(a: { chapterIndex: number }, b: { chapterIndex: number }): number {
  // Unsorted (-1) always sinks to the bottom
  if (a.chapterIndex === -1) return 1;
  if (b.chapterIndex === -1) return -1;
  return a.chapterIndex - b.chapterIndex;
}
