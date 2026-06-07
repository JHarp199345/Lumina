/**
 * Study progress + quiz-availability helpers (PLANv Phase 4).
 *
 * Pure functions that decide what a reader is allowed to be quizzed on, based on
 * how far they've read. The spoiler rule (PLANv Part Four) is the whole point:
 * by default a quiz may only draw on material the reader has actually reached.
 *
 *   - Segment quiz: available once the reader has read PAST the segment.
 *   - Chapter quiz: available once the reader has read past the chapter's end.
 *   - Whole-book quiz: available once the book is effectively complete, or behind
 *     an explicit spoiler confirmation.
 *
 * "Reached" is measured with the same global word offsets the segment anchors
 * use, so it lines up with the reader's live word position.
 */

import type { StudyGuide, StudySegment } from "@/types";

/** A chapter's worth of study segments, grouped for the Chapter-quiz selector. */
export interface StudyChapterGroup {
  chapterIndex: number;
  chapterTitle: string;
  segments: StudySegment[];
  approxWordStart: number;
  approxWordEnd: number;
  /** True if any segment in the chapter is worth quizzing. */
  quizWorthy: boolean;
}

/** A book is "complete" once the reader is within this fraction of the end. */
const BOOK_COMPLETE_FRACTION = 0.985;

/** Reader has read past this segment (so quizzing on it is not a spoiler). */
export function isSegmentReached(segment: StudySegment, wordPosition: number): boolean {
  return wordPosition >= segment.approxWordEnd;
}

/** Group a guide's segments by chapter, preserving order. */
export function groupSegmentsByChapter(guide: StudyGuide): StudyChapterGroup[] {
  const byChapter = new Map<number, StudyChapterGroup>();
  for (const segment of guide.segments) {
    const existing = byChapter.get(segment.chapterIndex);
    if (existing) {
      existing.segments.push(segment);
      existing.approxWordStart = Math.min(existing.approxWordStart, segment.approxWordStart);
      existing.approxWordEnd = Math.max(existing.approxWordEnd, segment.approxWordEnd);
      existing.quizWorthy = existing.quizWorthy || segment.quizWorthy;
    } else {
      byChapter.set(segment.chapterIndex, {
        chapterIndex: segment.chapterIndex,
        chapterTitle: segment.chapterTitle,
        segments: [segment],
        approxWordStart: segment.approxWordStart,
        approxWordEnd: segment.approxWordEnd,
        quizWorthy: segment.quizWorthy,
      });
    }
  }
  return [...byChapter.values()].sort((a, b) => a.chapterIndex - b.chapterIndex);
}

/** Reader has read past the whole chapter. */
export function isChapterReached(group: StudyChapterGroup, wordPosition: number): boolean {
  return wordPosition >= group.approxWordEnd;
}

/** The furthest word offset any segment reaches — the effective end of the book. */
export function guideEndWord(guide: StudyGuide): number {
  return guide.segments.reduce((max, s) => Math.max(max, s.approxWordEnd), 0);
}

/** Reader has effectively finished the book (enables the whole-book quiz). */
export function isBookComplete(guide: StudyGuide, wordPosition: number): boolean {
  const end = guideEndWord(guide);
  if (end <= 0) return false;
  return wordPosition >= end * BOOK_COMPLETE_FRACTION;
}
