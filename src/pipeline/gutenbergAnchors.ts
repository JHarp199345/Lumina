/**
 * Gutenberg visual anchors — emotional soft targets snapped to structural boundaries.
 */

import type { Chapter, EditionPipeline, InflectionPoint, Section } from "@/types";
import {
  catalogTextBoundaries,
  countWords,
  heuristicSentiment,
  snapToBoundary,
  splitParagraphs,
} from "@/pipeline/gutenbergBoundaries";

export interface SceneAnchorPick {
  wordOffset: number;
  sectionId: string;
}

export function isGutenbergEdition(pipeline?: EditionPipeline): boolean {
  return pipeline === "gutenberg";
}

function sectionForOffset(chapter: Chapter, offset: number): Section {
  const sections = chapter.sections.length > 0 ? chapter.sections : [];
  if (sections.length === 0) {
    return { id: chapter.id, chapterId: chapter.id, index: 0, wordCount: chapter.wordCount, startWordOffset: 0 };
  }

  let best = sections[0];
  let bestDist = Math.abs((best.startWordOffset ?? 0) - offset);
  for (const section of sections) {
    const dist = Math.abs((section.startWordOffset ?? 0) - offset);
    if (dist < bestDist) {
      best = section;
      bestDist = dist;
    }
  }
  return best;
}

/** Heuristic interior emotional turn within a long chapter (paragraph batches). */
export function estimateInteriorTurnOffset(chapter: Chapter): number {
  const paragraphs = splitParagraphs(chapter.rawText || "");
  if (paragraphs.length < 4) {
    return Math.floor(chapter.wordCount * 0.38);
  }

  const batchSize = 2;
  const windows: Array<{ start: number; score: number }> = [];
  let offset = 0;

  for (let i = 0; i < paragraphs.length; i += batchSize) {
    const batch = paragraphs.slice(i, i + batchSize).join("\n\n");
    windows.push({ start: offset, score: heuristicSentiment(batch) });
    offset += countWords(batch);
  }

  if (windows.length < 2) return Math.floor(chapter.wordCount * 0.38);

  let bestIdx = 0;
  let bestMag = 0;
  for (let i = 1; i < windows.length; i++) {
    const mag = Math.abs(windows[i].score - windows[i - 1].score);
    if (mag > bestMag) {
      bestMag = mag;
      bestIdx = i;
    }
  }

  return windows[bestIdx]?.start ?? Math.floor(chapter.wordCount * 0.38);
}

export function softTargetForChapter(
  chapter: Chapter,
  options: {
    atOpening?: boolean;
    inflectionPoint?: InflectionPoint;
    chapterSentiment?: number;
    prevSentiment?: number;
    nextSentiment?: number;
  } = {}
): number {
  if (options.atOpening) return 0;

  if (options.inflectionPoint) {
    const base = Math.floor(chapter.wordCount * (0.28 + options.inflectionPoint.significance * 0.22));
    return Math.max(0, Math.min(chapter.wordCount - 1, base));
  }

  const prev = options.prevSentiment ?? 0;
  const cur = options.chapterSentiment ?? 0;
  const next = options.nextSentiment ?? cur;
  const inbound = cur - prev;
  const outbound = next - cur;

  if (Math.abs(inbound) > 0.12 || Math.abs(outbound) > 0.12) {
    return estimateInteriorTurnOffset(chapter);
  }

  return Math.floor(chapter.wordCount * 0.42);
}

export function pickGutenbergSceneAnchor(
  chapter: Chapter,
  options: {
    atOpening?: boolean;
    inflectionPoint?: InflectionPoint;
    chapterSentiment?: number;
    prevSentiment?: number;
    nextSentiment?: number;
  } = {}
): SceneAnchorPick {
  const soft = softTargetForChapter(chapter, options);
  const boundaries = catalogTextBoundaries(chapter.rawText || "");
  const snapped = snapToBoundary(soft, boundaries, chapter.wordCount);
  const section = sectionForOffset(chapter, snapped);
  return {
    wordOffset: snapped,
    sectionId: section.id,
  };
}

/** Legacy fallback for non-Gutenberg editions — nearest section to a ratio target. */
export function pickStandardSceneAnchor(
  chapter: Chapter,
  ratio = 0.42
): SceneAnchorPick {
  const targetOffset = Math.floor(chapter.wordCount * ratio);
  const section = sectionForOffset(chapter, targetOffset);
  return {
    wordOffset: section.startWordOffset ?? targetOffset,
    sectionId: section.id,
  };
}

export function pickSceneAnchor(
  chapter: Chapter,
  editionPipeline: EditionPipeline | undefined,
  options: {
    atOpening?: boolean;
    inflectionPoint?: InflectionPoint;
    chapterSentiment?: number;
    prevSentiment?: number;
    nextSentiment?: number;
    standardRatio?: number;
  } = {}
): SceneAnchorPick {
  if (isGutenbergEdition(editionPipeline)) {
    return pickGutenbergSceneAnchor(chapter, options);
  }
  if (options.atOpening) {
    const section = chapter.sections[0];
    return { wordOffset: 0, sectionId: section?.id ?? chapter.id };
  }
  return pickStandardSceneAnchor(chapter, options.standardRatio ?? (options.inflectionPoint ? 0.35 : 0.42));
}
