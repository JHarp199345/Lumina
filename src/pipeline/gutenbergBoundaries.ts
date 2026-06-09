/**
 * Gutenberg boundary catalog — headings, scene breaks, and paragraph edges.
 * Used at ingest (section cuts) and at analysis (emotional snap targets).
 */

export type BoundaryKind = "scene_break" | "heading" | "paragraph";

export interface TextBoundary {
  wordOffset: number;
  kind: BoundaryKind;
  label?: string;
}

export const SCENE_BREAK_LINE_PATTERNS = [
  /^\*\s*\*\s*\*$/,
  /^---+/,
  /^\*\*\*+$/,
  /^§$/,
  /^◆$/,
  /^•\s*•\s*•$/,
];

const HEADING_LINE_PATTERNS = [
  /^chapter\s+[IVXLCDM\d]+/i,
  /^part\s+[IVXLCDM\d]+/i,
  /^book\s+[IVXLCDM\d]+/i,
  /^act\s+[IVXLCDM\d]+/i,
  /^scene\s+[IVXLCDM\d]+/i,
  /^[IVXLCDM]+\.\s*$/,
];

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Fast local sentiment for interior paragraph batches — no API. */
export function heuristicSentiment(text: string): number {
  const lower = text.toLowerCase();
  const positiveWords = [
    "joy", "love", "hope", "light", "laugh", "bright", "win", "free", "peace", "happy", "triumph", "save",
  ];
  const negativeWords = [
    "death", "dark", "fear", "loss", "pain", "cry", "bleed", "fall", "alone", "broken", "war", "dead", "kill", "grief",
  ];
  const posCount = positiveWords.filter((w) => lower.includes(w)).length;
  const negCount = negativeWords.filter((w) => lower.includes(w)).length;
  const total = posCount + negCount;
  if (total === 0) return 0;
  return (posCount - negCount) / total;
}

export function splitParagraphs(rawText: string): string[] {
  return rawText
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function classifyParagraph(para: string): BoundaryKind | null {
  const line = para.replace(/\s+/g, " ").trim();
  if (!line) return null;
  if (SCENE_BREAK_LINE_PATTERNS.some((p) => p.test(line))) return "scene_break";
  if (isHeadingLine(line)) return "heading";
  return "paragraph";
}

function isHeadingLine(line: string): boolean {
  if (line.length > 90) return false;
  if (HEADING_LINE_PATTERNS.some((p) => p.test(line))) return true;
  if (
    line.length >= 3 &&
    line.length <= 60 &&
    line === line.toUpperCase() &&
    /[A-Z]/.test(line) &&
    !/[.!?]{2,}/.test(line)
  ) {
    return true;
  }
  return false;
}

/** Catalog every snap-eligible boundary in reading order. */
export function catalogTextBoundaries(rawText: string): TextBoundary[] {
  const paragraphs = splitParagraphs(rawText);
  const boundaries: TextBoundary[] = [];
  let wordOffset = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const kind = classifyParagraph(para);

    if (kind === "scene_break") {
      boundaries.push({ wordOffset, kind: "scene_break", label: para.slice(0, 24) });
    } else if (kind === "heading") {
      boundaries.push({ wordOffset, kind: "heading", label: para });
    } else if (i === 0 || kind === "paragraph") {
      boundaries.push({ wordOffset, kind: "paragraph" });
    }

    wordOffset += countWords(para);
  }

  if (boundaries.length === 0 && rawText.trim()) {
    boundaries.push({ wordOffset: 0, kind: "paragraph" });
  }

  return boundaries;
}

const BOUNDARY_PRIORITY: Record<BoundaryKind, number> = {
  scene_break: 3,
  heading: 2,
  paragraph: 1,
};

/** Default snap window — emotional turn lands near an authorial break. */
export const GUTENBERG_SNAP_WINDOW_WORDS = 420;

/**
 * Snap a soft emotional target to the nearest structural boundary inside the window.
 * Prefers scene breaks, then headings, then paragraph edges.
 */
export function snapToBoundary(
  targetOffset: number,
  boundaries: TextBoundary[],
  chapterWordCount: number,
  windowWords = GUTENBERG_SNAP_WINDOW_WORDS
): number {
  if (boundaries.length === 0) {
    return Math.max(0, Math.min(chapterWordCount - 1, Math.round(targetOffset)));
  }

  const window = Math.min(windowWords, Math.max(120, Math.floor(chapterWordCount * 0.18)));
  const inWindow = boundaries.filter((b) => Math.abs(b.wordOffset - targetOffset) <= window);

  const pool = inWindow.length > 0 ? inWindow : boundaries;
  const ranked = [...pool].sort((a, b) => {
    const distA = Math.abs(a.wordOffset - targetOffset);
    const distB = Math.abs(b.wordOffset - targetOffset);
    if (distA !== distB) return distA - distB;
    return BOUNDARY_PRIORITY[b.kind] - BOUNDARY_PRIORITY[a.kind];
  });

  return ranked[0]?.wordOffset ?? 0;
}
