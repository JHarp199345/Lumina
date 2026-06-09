/**
 * Structural section builder — heading/scene-break bounded reads for all editions.
 * Used by expository analysis and Gutenberg refresh paths.
 */

import type { BookStructure, Chapter, Section } from "@/types";
import { classifyExpositoryParagraph } from "@/pipeline/expositoryBoundaries";
import { classifyParagraph, countWords, splitParagraphs } from "@/pipeline/gutenbergBoundaries";

const TARGET_SECTION_WORDS = 1400;
const MIN_SECTION_WORDS = 180;

function sliceParagraphText(paragraphs: string[], start: number, end: number): string {
  return paragraphs.slice(start, end).join("\n\n");
}

function classifyForSections(para: string, expository: boolean) {
  return expository ? classifyExpositoryParagraph(para) : classifyParagraph(para);
}

/** Sections bounded by scene breaks and headings; otherwise paragraph-grouped reads. */
export function buildStructuralSections(
  rawText: string,
  chapterId: string,
  options: { expository?: boolean } = {}
): Section[] {
  const text = rawText.trim();
  if (!text) {
    return [
      {
        id: `${chapterId}_s0`,
        chapterId,
        index: 0,
        wordCount: 0,
        startWordOffset: 0,
        rawText: "",
      },
    ];
  }

  const expository = options.expository ?? false;
  const paragraphs = splitParagraphs(text);
  const strongCutIndices: number[] = [0];

  for (let i = 1; i < paragraphs.length; i++) {
    const kind = classifyForSections(paragraphs[i], expository);
    if (kind === "scene_break" || kind === "heading") {
      strongCutIndices.push(i);
    }
  }

  if (strongCutIndices.length > 1) {
    return sectionsFromParagraphCuts(paragraphs, chapterId, strongCutIndices);
  }

  return sectionsFromParagraphGrouping(paragraphs, chapterId);
}

function sectionsFromParagraphCuts(
  paragraphs: string[],
  chapterId: string,
  cutParagraphIndices: number[]
): Section[] {
  const sections: Section[] = [];
  let sectionIndex = 0;

  for (let c = 0; c < cutParagraphIndices.length; c++) {
    const startPara = cutParagraphIndices[c];
    const endPara = cutParagraphIndices[c + 1] ?? paragraphs.length;
    const slice = sliceParagraphText(paragraphs, startPara, endPara);
    const wordCount = countWords(slice);
    if (wordCount < MIN_SECTION_WORDS && c < cutParagraphIndices.length - 1) continue;

    let startWordOffset = 0;
    for (let i = 0; i < startPara; i++) {
      startWordOffset += countWords(paragraphs[i]);
    }

    sections.push({
      id: `${chapterId}_s${sectionIndex}`,
      chapterId,
      index: sectionIndex,
      wordCount,
      startWordOffset,
      rawText: slice,
    });
    sectionIndex++;
  }

  if (sections.length === 0) {
    return sectionsFromParagraphGrouping(paragraphs, chapterId);
  }

  return sections;
}

function sectionsFromParagraphGrouping(paragraphs: string[], chapterId: string): Section[] {
  const sections: Section[] = [];
  let sectionIndex = 0;
  let chunkStart = 0;
  let chunkWords = 0;
  let startWordOffset = 0;

  const flush = (end: number) => {
    if (end <= chunkStart) return;
    const slice = sliceParagraphText(paragraphs, chunkStart, end);
    const wordCount = countWords(slice);
    if (wordCount < MIN_SECTION_WORDS && sections.length > 0) {
      const prev = sections[sections.length - 1];
      prev.rawText = `${prev.rawText}\n\n${slice}`;
      prev.wordCount += wordCount;
      return;
    }
    sections.push({
      id: `${chapterId}_s${sectionIndex}`,
      chapterId,
      index: sectionIndex,
      wordCount,
      startWordOffset,
      rawText: slice,
    });
    sectionIndex++;
  };

  for (let i = 0; i < paragraphs.length; i++) {
    const w = countWords(paragraphs[i]);
    if (chunkWords > 0 && chunkWords + w > TARGET_SECTION_WORDS) {
      flush(i);
      chunkStart = i;
      chunkWords = 0;
      startWordOffset = 0;
      for (let j = 0; j < i; j++) startWordOffset += countWords(paragraphs[j]);
    }
    chunkWords += w;
  }

  flush(paragraphs.length);

  if (sections.length === 0) {
    const all = paragraphs.join("\n\n");
    return [
      {
        id: `${chapterId}_s0`,
        chapterId,
        index: 0,
        wordCount: countWords(all),
        startWordOffset: 0,
        rawText: all,
      },
    ];
  }

  return sections;
}

export function refreshChapterStructuralSections(
  chapter: Pick<Chapter, "id" | "rawText">,
  expository: boolean
): Section[] {
  return buildStructuralSections(chapter.rawText || "", chapter.id, { expository });
}

export function refreshStructuralSections(
  structure: BookStructure,
  expository: boolean
): BookStructure {
  const chapters = structure.chapters.map((chapter) => ({
    ...chapter,
    sections: refreshChapterStructuralSections(chapter, expository),
  }));
  return { ...structure, chapters };
}
