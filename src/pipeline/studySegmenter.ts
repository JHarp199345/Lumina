/**
 * Heuristic study segmentation — PLANv Phase 2.
 *
 * Divides a parsed book into meaning-ish study segments WITHOUT any AI. This is
 * the cheap local pass PLANv asks for: do as much as we can offline before
 * spending a single token. Phase 3 will hand this rough map to an AI to merge,
 * split, name, and summarise the segments — but the heuristic map alone is a
 * usable, saveable Study Guide.
 *
 * Strategy:
 *   - Each chapter is split into roughly TARGET-sized segments, cut on the
 *     section boundaries the parser already found (headings / scene breaks /
 *     paragraph clusters) so segments never bisect a paragraph.
 *   - A chapter's segment count is round(chapterWords / TARGET), clamped to ≥1.
 *     Sections are then distributed as evenly as possible across that count, so
 *     we avoid tiny orphan tails.
 *   - Very short / transitional chapters become a single segment and are marked
 *     not quiz-worthy (PLANv: "no quiz-worthy segment, if the chapter is very
 *     short or transitional").
 *
 * Anchors are stable: chapter index + word offsets (within chapter AND global),
 * never rendered page numbers — same philosophy as structured highlights.
 */

import type { BookStructure, Chapter, StudyGuide, StudySegment } from "@/types";

/** Ideal words per study segment — a ~6–9 minute read, a natural place to pause. */
const TARGET_WORDS = 1400;
/** A chapter at or under this is treated as transitional: one segment, not quiz-worthy. */
const TRANSITIONAL_CHAPTER_WORDS = 350;
/** Don't bother emitting a segment shorter than this on its own. */
const MIN_SEGMENT_WORDS = 400;

export const STUDY_GUIDE_VERSION = 1;

interface SectionLike {
  startWordOffset: number;
  wordCount: number;
}

/** Fallback when a chapter has no parsed sections: treat the whole chapter as one block. */
function chapterSections(chapter: Chapter): SectionLike[] {
  if (chapter.sections && chapter.sections.length > 0) {
    return [...chapter.sections]
      .sort((a, b) => a.startWordOffset - b.startWordOffset)
      .map((s) => ({ startWordOffset: s.startWordOffset, wordCount: s.wordCount }));
  }
  return [{ startWordOffset: 0, wordCount: chapter.wordCount }];
}

/**
 * Group a chapter's sections into `count` contiguous segments, balanced by word
 * count. Cuts only fall on section boundaries (so paragraphs are never split),
 * and each internal cut is placed at the section boundary NEAREST to an evenly
 * spaced ideal — which keeps segments balanced and avoids stranding a tiny tail
 * when the parser's coarse fixed-size sections don't line up with the midpoint.
 * Returns [start, end, words] (word offsets within the chapter) per group.
 */
function groupSections(
  sections: SectionLike[],
  chapterWords: number,
  count: number
): Array<{ start: number; end: number; words: number }> {
  if (count <= 1 || sections.length <= 1) {
    return [{ start: 0, end: chapterWords, words: chapterWords }];
  }

  // Candidate cut offsets = cumulative word ends after each section, except the
  // final one (which is the chapter end, not an internal boundary).
  const candidates: number[] = [];
  let acc = 0;
  for (const section of sections) {
    acc += section.wordCount;
    candidates.push(acc);
  }
  candidates.pop(); // drop the chapter end

  // Pick count-1 internal cuts, each the unused candidate nearest its ideal,
  // kept strictly increasing.
  const cuts: number[] = [];
  for (let k = 1; k < count; k++) {
    const ideal = (chapterWords * k) / count;
    const prev = cuts.length ? cuts[cuts.length - 1] : 0;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      if (c <= prev) continue;
      const dist = Math.abs(c - ideal);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    if (best == null) break; // ran out of distinct boundaries
    cuts.push(best);
  }

  const bounds = [0, ...cuts, chapterWords];
  const groups: Array<{ start: number; end: number; words: number }> = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    groups.push({ start, end, words: end - start });
  }
  return groups;
}

/** Build a readable segment title with chapter context (PLANv naming rules). */
function segmentTitle(chapter: Chapter, partIndex: number, partCount: number): string {
  const base = chapter.title?.trim() || `Chapter ${chapter.index + 1}`;
  // If the title already carries its own ordinal label — "Chapter One", "Ch. 3",
  // "Part II", "Prologue", or a leading number like "1." — use it verbatim.
  // Otherwise give it chapter context so segments read clearly in the list.
  const alreadyLabeled =
    /^\s*(chapter|chap\.?|ch\.?|part|book|prologue|epilogue|interlude|section)\b/i.test(base) ||
    /^\s*\d+\s*[.):\-–]/.test(base);
  const label = alreadyLabeled ? base : `Chapter ${chapter.index + 1}: ${base}`;
  if (partCount <= 1) return label;
  return `${label} · Part ${partIndex + 1}`;
}

/**
 * Produce a heuristic Study Guide for a parsed book. Pure & synchronous — fast
 * enough to run on the main thread for any reasonable book.
 */
export function buildHeuristicStudyGuide(structure: BookStructure): StudyGuide {
  const segments: StudySegment[] = [];
  let globalOffset = 0;

  for (const chapter of structure.chapters) {
    const chapterWords = chapter.wordCount;
    const chapterStartGlobal = globalOffset;
    globalOffset += chapterWords;

    // Skip empty chapters entirely (front-matter spacers, etc.).
    if (chapterWords <= 0) continue;

    const transitional = chapterWords <= TRANSITIONAL_CHAPTER_WORDS;
    const sections = chapterSections(chapter);
    const count = transitional ? 1 : Math.max(1, Math.round(chapterWords / TARGET_WORDS));
    const groups = groupSections(sections, chapterWords, count);

    groups.forEach((group, partIndex) => {
      const words = Math.max(0, group.end - group.start);
      if (words === 0) return;
      segments.push({
        id: `seg-${chapter.index}-${partIndex}`,
        bookId: structure.bookId,
        chapterIndex: chapter.index,
        chapterTitle: chapter.title?.trim() || `Chapter ${chapter.index + 1}`,
        title: segmentTitle(chapter, partIndex, groups.length),
        startWordOffset: group.start,
        endWordOffset: group.end,
        approxWordStart: chapterStartGlobal + group.start,
        approxWordEnd: chapterStartGlobal + group.end,
        wordCount: words,
        quizWorthy: !transitional && words >= MIN_SEGMENT_WORDS,
        spoilerLevel: "none",
        status: "ready",
      });
    });
  }

  return {
    bookId: structure.bookId,
    generatedAt: new Date().toISOString(),
    version: STUDY_GUIDE_VERSION,
    source: "heuristic",
    segments,
  };
}

/** The progress beats shown while a guide generates (PLANv-suggested copy). */
export const STUDY_GUIDE_PROGRESS_STEPS = [
  "Reading chapter structure",
  "Finding natural stopping points",
  "Grouping scenes and topics",
  "Naming study segments",
  "Saving Study Guide",
] as const;
