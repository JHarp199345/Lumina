/**
 * Split oversized parser chapters (common in Project Gutenberg EPUBs) into
 * smaller reading units so story-shape analysis and visual planning get more
 * natural stopping points per ~3k words.
 */

import type { Chapter, Section } from "@/types";

/** Target max words per reading chapter after subdivision. */
export const READING_CHAPTER_MAX_WORDS = 3200;
export const READING_CHAPTER_MIN_SPLIT = 4500;

function buildSections(text: string, chapterId: string): Section[] {
  const words = text.split(/\s+/).filter(Boolean);
  const sectionSize = 1200;
  const sections: Section[] = [];

  for (let i = 0; i < words.length; i += sectionSize) {
    const sectionWords = words.slice(i, i + sectionSize);
    const index = Math.floor(i / sectionSize);
    sections.push({
      id: `${chapterId}_s${index}`,
      chapterId,
      index,
      wordCount: sectionWords.length,
      startWordOffset: i,
      rawText: sectionWords.join(" "),
    });
  }

  return sections;
}

function splitTextAtParagraphs(text: string, maxWords: number): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [text.trim()];

  const parts: string[] = [];
  let current: string[] = [];
  let words = 0;

  const push = () => {
    if (current.length === 0) return;
    parts.push(current.join("\n\n"));
    current = [];
    words = 0;
  };

  for (const paragraph of paragraphs) {
    const count = paragraph.split(/\s+/).filter(Boolean).length;
    if (words > 0 && words + count > maxWords) {
      push();
    }
    current.push(paragraph);
    words += count;
  }

  push();
  return parts.length > 0 ? parts : [text.trim()];
}

function partTitle(chapter: Chapter, partIndex: number, partCount: number): string {
  const base = chapter.title?.trim() || `Section ${chapter.index + 1}`;
  if (partCount <= 1) return base;
  return `${base} · Part ${partIndex + 1}`;
}

function sliceSections(sections: Section[], startOffset: number, endOffset: number): Section[] {
  const slice: Section[] = [];
  let cursor = 0;

  for (const section of sections) {
    const sectionStart = section.startWordOffset ?? cursor;
    const sectionEnd = sectionStart + section.wordCount;
    cursor = sectionEnd;

    if (sectionEnd <= startOffset || sectionStart >= endOffset) continue;

    const relStart = Math.max(0, startOffset - sectionStart);
    const relEnd = Math.min(section.wordCount, endOffset - sectionStart);
    const sectionWords = (section.rawText ?? "").split(/\s+/).filter(Boolean);
    const rawText = sectionWords.slice(relStart, relEnd).join(" ");
    if (!rawText) continue;

    slice.push({
      ...section,
      wordCount: relEnd - relStart,
      startWordOffset: Math.max(0, sectionStart - startOffset),
      rawText,
    });
  }

  return slice;
}

function subdivideOneChapter(chapter: Chapter): Chapter[] {
  if (chapter.wordCount < READING_CHAPTER_MIN_SPLIT) return [chapter];

  const sections =
    chapter.sections.length > 0
      ? chapter.sections
      : buildSections(chapter.rawText || "", chapter.id);

  if (sections.length <= 1) {
    const textParts = splitTextAtParagraphs(chapter.rawText || "", READING_CHAPTER_MAX_WORDS);
    if (textParts.length <= 1) return [chapter];

    return textParts.map((rawText, partIndex) => {
      const id = `${chapter.id}_p${partIndex}`;
      const wordCount = rawText.split(/\s+/).filter(Boolean).length;
      return {
        ...chapter,
        id,
        title: partTitle(chapter, partIndex, textParts.length),
        wordCount,
        rawText,
        sections: buildSections(rawText, id),
      };
    });
  }

  const boundaries: number[] = [0];
  let acc = 0;
  for (const section of sections) {
    acc += section.wordCount;
    boundaries.push(acc);
  }

  const parts: Array<{ start: number; end: number }> = [];
  let partStart = 0;
  let partWords = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const nextWords = partWords + section.wordCount;
    const isLast = i === sections.length - 1;

    if (!isLast && partWords > 0 && nextWords >= READING_CHAPTER_MAX_WORDS) {
      parts.push({ start: partStart, end: partStart + partWords });
      partStart += partWords;
      partWords = section.wordCount;
      continue;
    }

    partWords = nextWords;
    if (isLast && partWords > 0) {
      parts.push({ start: partStart, end: partStart + partWords });
    }
  }

  if (parts.length <= 1) return [chapter];

  return parts.map(({ start, end }, partIndex) => {
    const id = `${chapter.id}_p${partIndex}`;
    const allWords = (chapter.rawText || "").split(/\s+/).filter(Boolean);
    const rawText = allWords.slice(start, end).join(" ");
    const slicedSections = sliceSections(sections, start, end).map((section, index) => ({
      ...section,
      id: `${id}_s${index}`,
      chapterId: id,
      index,
    }));

    return {
      ...chapter,
      id,
      title: partTitle(chapter, partIndex, parts.length),
      wordCount: end - start,
      rawText,
      sections: slicedSections.length > 0 ? slicedSections : buildSections(rawText, id),
    };
  });
}

export function subdivideOversizedChapters(chapters: Chapter[]): Chapter[] {
  const expanded = chapters.flatMap(subdivideOneChapter);
  return expanded.map((chapter, index) => ({ ...chapter, index }));
}
