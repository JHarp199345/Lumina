import type { BookStructure, Chapter } from "@/types";

const NON_STORY_TITLE_PATTERNS = [
  /\b(front\s*matter|back\s*matter|backlist|also\s+by|other\s+books|more\s+from|black\s+library)\b/i,
  /\b(copyright|credits?|acknowledgements?|about\s+the\s+author|about\s+the\s+publisher)\b/i,
  /\b(contents?|table\s+of\s+contents|title\s+page|cover|dedication|epigraph|appendix|glossary|index)\b/i,
  /\b(advertisement|newsletter|preview|sample|extract|coming\s+soon)\b/i,
];

const NON_STORY_TEXT_PATTERNS = [
  /\bmore\s+warhammer\s+40,?000\s+from\s+black\s+library\b/i,
  /\bmore\s+necrons\s+from\s+black\s+library\b/i,
  /\bthis\s+is\s+a\s+work\s+of\s+fiction\b/i,
  /\ball\s+rights\s+reserved\b/i,
  /\bisbn\b/i,
  /\bwww\.[a-z0-9.-]+\.[a-z]{2,}\b/i,
];

const STORY_TITLE_PATTERNS = [
  /\b(chapter|prologue|epilogue|part|book)\b/i,
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i,
  /\b[ivxlcdm]+\b/i,
];

export function isNonStoryChapter(chapter: Chapter): boolean {
  const title = chapter.title.trim();
  const text = (chapter.rawText ?? "").slice(0, 1200);
  const normalized = `${title}\n${text}`.toLowerCase();

  if (NON_STORY_TITLE_PATTERNS.some((pattern) => pattern.test(title))) return true;
  if (NON_STORY_TEXT_PATTERNS.some((pattern) => pattern.test(normalized))) return true;

  const mostlyCatalog =
    /\b(book\s+\d+|various\s+authors|nate\s+crowley|ben\s+counter|gav\s+thorpe|guy\s+haley|darius\s+hinks|john\s+french)\b/i.test(text) &&
    !/[.!?]\s+[A-Z]/.test(text);
  if (mostlyCatalog) return true;

  return false;
}

export function isStoryChapter(chapter: Chapter): boolean {
  if (!chapter.rawText || chapter.wordCount < 120) return false;
  if (isNonStoryChapter(chapter)) return false;

  const titleLooksStory = STORY_TITLE_PATTERNS.some((pattern) => pattern.test(chapter.title));
  const hasProse = /[.!?]\s+[A-Z0-9]/.test(chapter.rawText);

  return titleLooksStory || hasProse || chapter.wordCount >= 800;
}

export function storyChapters(chapters: Chapter[]): Chapter[] {
  const filtered = chapters.filter(isStoryChapter);
  return filtered.length > 0 ? filtered : chapters.filter((chapter) => chapter.rawText && chapter.wordCount >= 120);
}

export function storyOnlyStructure(structure: BookStructure): BookStructure {
  const chapters = storyChapters(structure.chapters);
  return {
    ...structure,
    totalWords: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    chapters,
    collectionGroups: undefined,
  };
}
