/**
 * Enhanced structural boundary detection for expository / technical works.
 * Extends the Gutenberg boundary catalog with subheadings and topic leads.
 */

import {
  catalogTextBoundaries,
  classifyParagraph,
  countWords,
  splitParagraphs,
  type BoundaryKind,
  type TextBoundary,
} from "@/pipeline/gutenbergBoundaries";

export { snapToBoundary, GUTENBERG_SNAP_WINDOW_WORDS } from "@/pipeline/gutenbergBoundaries";
export type { TextBoundary, BoundaryKind };

const SUBHEADING_PATTERNS = [
  /^\*[^*]{4,90}\*$/, // *Italic Subheading*
  /^_[^_]{4,90}_$/, // _Italic Subheading_
  /^[""][^""]{4,90}[""]$/, // "Quoted Subheading"
];

const BOILERPLATE_CHAPTER = /^(copyright|acknowledg|dedication|preface|about the author|notes|index|bibliograph|glossary|table of contents|contents|also by|title page|imprint|colophon)\b/i;

export function isBoilerplateChapterTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return true;
  if (BOILERPLATE_CHAPTER.test(t)) return true;
  if (/^page\s+\d+$/i.test(t)) return true;
  return false;
}

export function isExpositorySubheading(line: string): boolean {
  const trimmed = line.replace(/\s+/g, " ").trim();
  if (trimmed.length < 4 || trimmed.length > 90) return false;
  if (SUBHEADING_PATTERNS.some((p) => p.test(trimmed))) return true;

  // Short standalone topic line — title case, no terminal sentence punctuation.
  if (
    trimmed.length >= 8 &&
    trimmed.length <= 72 &&
    !/[.!?]$/.test(trimmed) &&
    /^[A-Z]/.test(trimmed) &&
    !trimmed.includes("?") &&
    trimmed.split(/\s+/).length <= 12
  ) {
    const lower = trimmed.toLowerCase();
    const looksLikeBody =
      lower.startsWith("the ") && trimmed.split(/\s+/).length > 8 && !/^(the\s+[A-Z])/.test(trimmed);
    if (!looksLikeBody) return true;
  }

  return false;
}

export function classifyExpositoryParagraph(para: string): BoundaryKind | null {
  const line = para.replace(/\s+/g, " ").trim();
  if (!line) return null;

  const base = classifyParagraph(para);
  if (base === "scene_break" || base === "heading") return base;
  if (isExpositorySubheading(line)) return "heading";

  return base;
}

/** Structural boundaries with expository subheading detection. */
export function catalogStructuralBoundaries(rawText: string): TextBoundary[] {
  const paragraphs = splitParagraphs(rawText);
  const boundaries: TextBoundary[] = [];
  let wordOffset = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const kind = classifyExpositoryParagraph(para);

    if (kind === "scene_break") {
      boundaries.push({ wordOffset, kind: "scene_break", label: para.slice(0, 24) });
    } else if (kind === "heading") {
      const label = para.replace(/^\*|\*$|^_|_$/g, "").trim();
      boundaries.push({ wordOffset, kind: "heading", label });
    } else if (i === 0 || kind === "paragraph") {
      boundaries.push({ wordOffset, kind: "paragraph" });
    }

    wordOffset += countWords(para);
  }

  if (boundaries.length === 0 && rawText.trim()) {
    boundaries.push({ wordOffset: 0, kind: "paragraph" });
  }

  return boundaries.length > 0 ? boundaries : catalogTextBoundaries(rawText);
}

export function sectionTitleFromText(rawText: string, fallback: string): string {
  const paragraphs = splitParagraphs(rawText);
  if (paragraphs.length === 0) return fallback;

  const first = paragraphs[0].replace(/\s+/g, " ").trim();
  if (classifyExpositoryParagraph(first) === "heading" || isExpositorySubheading(first)) {
    return first.replace(/^\*|\*$|^_|_$/g, "").trim();
  }

  const boundary = catalogStructuralBoundaries(rawText).find((b) => b.kind === "heading" && b.label);
  return boundary?.label?.trim() || fallback;
}
