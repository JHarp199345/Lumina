/**
 * Project Gutenberg edition normalization — runs after generic EPUB extraction.
 */

import type { Chapter } from "@/types";
import type { EpubImportContext } from "@/pipeline/epubEdition";
import { countWords } from "@/pipeline/gutenbergBoundaries";
import { buildGutenbergSections } from "@/pipeline/gutenbergSections";

const GUTENBERG_HTML_MARKERS = [
  /project\s+gutenberg/i,
  /gutenberg\.org/i,
  /www\.gutenberg\.org/i,
  /ebook\s*#\s*\d+/i,
  /this\s+ebook\s+is\s+for\s+the\s+use\s+of\s+anyone/i,
];

const GUTENBERG_JUNK_TITLE_PATTERNS = [
  /\bproject\s+gutenberg\b/i,
  /\bfull\s+project\s+gutenberg\b/i,
  /\bgutenberg\s+license\b/i,
  /\btable\s+of\s+contents\b/i,
  /\bcontents\b/i,
  /^the\s+full\s+project/i,
];

const GUTENBERG_BOILERPLATE_START = [
  /^the\s+project\s+gutenberg\s+ebook\s+of\b/i,
  /^project\s+gutenberg/i,
  /^produced\s+by\b/i,
  /^updated:\s*/i,
  /^release\s+date:/i,
  /^most\s+recently\s+updated:/i,
  /^ebook\s*#\s*\d+/i,
  /^language:/i,
  /^credits?:/i,
  /^transcriber/i,
];

export function detectGutenbergHtml(html: string): boolean {
  const sample = html.slice(0, 12000);
  return GUTENBERG_HTML_MARKERS.some((pattern) => pattern.test(sample));
}

const GUTENBERG_ID_PATTERNS = [
  /gutenberg\.org\/ebooks\/(\d{1,7})/i,
  /gutenberg\.org\/files\/(\d{1,7})/i,
  /cache\/epub\/(\d{1,7})\//i,
  /ebook\s*#\s*(\d{1,7})/i,
];

/** Parse a Project Gutenberg ebook id from a URL, OPF identifier, or boilerplate line. */
export function parseGutenbergCatalogId(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  for (const pattern of GUTENBERG_ID_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match?.[1]) continue;
    const id = Number(match[1]);
    if (Number.isFinite(id) && id > 0) return id;
  }
  return undefined;
}

/** Read the ebook id baked into Gutenberg HTML — survives user renames on disk. */
export function detectGutenbergIdFromHtml(html: string): number | undefined {
  const sample = html.slice(0, 20000);
  for (const pattern of GUTENBERG_ID_PATTERNS) {
    const match = sample.match(pattern);
    if (!match?.[1]) continue;
    const id = Number(match[1]);
    if (Number.isFinite(id) && id > 0) return id;
  }
  return undefined;
}

export function detectGutenbergIdFromTexts(rawTexts: Map<string, string>): number | undefined {
  for (const html of rawTexts.values()) {
    const id = detectGutenbergIdFromHtml(html);
    if (id) return id;
  }
  return undefined;
}

export function stripGutenbergBoilerplate(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  let start = 0;
  for (let i = 0; i < Math.min(paragraphs.length, 12); i++) {
    const line = paragraphs[i];
    if (GUTENBERG_BOILERPLATE_START.some((pattern) => pattern.test(line))) {
      start = i + 1;
      continue;
    }
    if (/^chapter\s+\d+\s*$/i.test(line) && i < 4) {
      start = i + 1;
      continue;
    }
    if (countWords(line) >= 40 && /[.!?]/.test(line)) break;
    if (countWords(line) >= 80) break;
  }

  const trimmed = paragraphs.slice(start).join("\n\n").trim();
  return trimmed || text.trim();
}

export function isGutenbergJunkChapter(title: string, text: string): boolean {
  const cleanTitle = title.replace(/\s+/g, " ").trim();
  if (GUTENBERG_JUNK_TITLE_PATTERNS.some((pattern) => pattern.test(cleanTitle))) {
    return true;
  }

  const sample = text.slice(0, 900).toLowerCase();
  if (sample.includes("project gutenberg license") || sample.includes("www.gutenberg.org/license")) {
    return true;
  }

  // Bare "CHAPTER N" stubs with almost no body (Gutenberg TOC artifacts).
  if (/^chapter\s+\d+\s*$/i.test(cleanTitle) && countWords(text) < 180) {
    return true;
  }

  // Roman numeral-only stubs (e.g. "VI" between stories).
  if (/^[ivxlcdm]+\s*$/i.test(cleanTitle) && countWords(text) < 120) {
    return true;
  }

  return false;
}

export function normalizeGutenbergChapters(
  chapters: Chapter[],
  _importContext?: EpubImportContext
): Chapter[] {
  const normalized = chapters
    .map((chapter) => {
      const rawText = stripGutenbergBoilerplate(chapter.rawText || "");
      const wordCount = countWords(rawText);
      return {
        ...chapter,
        rawText,
        wordCount,
        sections: buildGutenbergSections(rawText, chapter.id),
      };
    })
    .filter((chapter) => chapter.wordCount >= 120)
    .filter((chapter) => !isGutenbergJunkChapter(chapter.title, chapter.rawText || ""));

  return normalized.map((chapter, index) => ({ ...chapter, index }));
}
