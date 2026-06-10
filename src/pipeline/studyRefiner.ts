/**
 * AI study-segment refinement — PLANv Phase 3.
 *
 * Takes the cheap heuristic map (Phase 2) and asks an AI to make it readable:
 * better names, short summaries, a learning purpose, quiz-worthiness, spoiler
 * sensitivity, and the dominant concepts/characters/locations/themes.
 *
 * Deliberately conservative: this pass ENRICHES segments, it does not move their
 * boundaries. The heuristic boundaries are already balanced, and the anchors are
 * stable identifiers that quizzes/badges will reference — silently re-cutting
 * them would invalidate anything built on top. (Structural merge/split is a
 * later, separate refinement.) If the AI call fails, the heuristic values are
 * kept untouched and the error is surfaced; nothing is half-written.
 */

import { llmGenerateJSON } from "@/api/llmClient";
import type {
  BookStructure,
  Chapter,
  StudyGuide,
  StudySegment,
  StudySpoilerLevel,
} from "@/types";

/** Segments per AI request — keeps each call small and lets us report progress. */
const BATCH_SIZE = 6;

/** The shape we ask the model to return for each segment. */
interface RefinedFields {
  title?: string;
  summary?: string;
  purpose?: string;
  quizWorthy?: boolean;
  spoilerLevel?: string;
  concepts?: string[];
  characters?: string[];
  locations?: string[];
  themes?: string[];
}

export interface RefineProgress {
  message: string;
  /** 0..1 completion across all batches. */
  fraction: number;
}

/** Pull the segment's text out of its chapter using the stable word offsets. */
function segmentExcerpt(segment: StudySegment, chapters: Chapter[]): string {
  const chapter = chapters.find((c) => c.index === segment.chapterIndex);
  const text = chapter?.rawText ?? "";
  if (!text) return "";
  const words = text.split(/\s+/);
  const slice = words.slice(segment.startWordOffset, segment.endWordOffset);
  // ~180 words is plenty for naming + a 1–2 sentence summary; sample head + tail
  // so the model sees how the segment opens and closes.
  if (slice.length <= 220) return slice.join(" ");
  const head = slice.slice(0, 170).join(" ");
  const tail = slice.slice(-50).join(" ");
  return `${head} […] ${tail}`;
}

function normaliseSpoiler(value: unknown): StudySpoilerLevel {
  const v = String(value ?? "").toLowerCase();
  if (v === "high") return "high";
  if (v === "low") return "low";
  return "none";
}

function cleanStringArray(value: unknown, max = 6): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .slice(0, max);
  return out.length ? out : undefined;
}

async function refineBatch(
  batch: StudySegment[],
  chapters: Chapter[],
  bookTitle: string,
  apiKey: string
): Promise<RefinedFields[]> {
  const blocks = batch
    .map((segment, i) => {
      const excerpt = segmentExcerpt(segment, chapters);
      return `### Segment ${i}
Chapter: ${segment.chapterTitle}
Working title: ${segment.title}
Approx length: ${segment.wordCount} words
Excerpt:
"""
${excerpt}
"""`;
    })
    .join("\n\n");

  const prompt = `You are helping build a study guide for the book "${bookTitle}".

Below are ${batch.length} consecutive study segments, each with an excerpt. For EACH segment, return a refined study record.

Guidance:
- "title": a readable name that KEEPS the chapter context already present, e.g. "Chapter 3: The First Betrayal". Do not invent chapter numbers; reuse the chapter context from the segment. Do not output ids or filenames.
- "summary": one or two plain sentences on what happens / what matters in this segment. No spoilers beyond this segment.
- "purpose": one of "recall", "comprehension", or "synthesis" — what this segment is best for.
- "quizWorthy": true if there is enough substance to quiz on; false for thin, transitional, or purely atmospheric passages.
- "spoilerLevel": "none", "low", or "high" — how spoiler-sensitive a quiz on this segment would be.
- "concepts": up to 4 dominant ideas (plot, character, theme, lore, conflict, setup, payoff, etc.).
- "characters": named characters present (up to 5), if any.
- "locations": named places present (up to 5), if any.
- "themes": up to 3 themes, if clear.

Respond with ONLY a JSON array of ${batch.length} objects, in the same order as the segments. Each object:
{"title": string, "summary": string, "purpose": string, "quizWorthy": boolean, "spoilerLevel": string, "concepts": string[], "characters": string[], "locations": string[], "themes": string[]}

Segments:
${blocks}`;

  const parsed = await llmGenerateJSON<unknown>("curriculum", prompt, {
    temperature: 0.4,
    maxTokens: 2048,
    geminiKey: apiKey,
  });
  if (!Array.isArray(parsed)) throw new Error("AI returned an unexpected shape");
  return parsed as RefinedFields[];
}

/** Merge AI fields onto a heuristic segment, keeping all anchors intact. */
function applyRefinement(segment: StudySegment, fields: RefinedFields | undefined): StudySegment {
  if (!fields || typeof fields !== "object") return segment;
  return {
    ...segment,
    title: typeof fields.title === "string" && fields.title.trim() ? fields.title.trim() : segment.title,
    summary: typeof fields.summary === "string" && fields.summary.trim() ? fields.summary.trim() : segment.summary,
    purpose: typeof fields.purpose === "string" && fields.purpose.trim() ? fields.purpose.trim() : segment.purpose,
    quizWorthy: typeof fields.quizWorthy === "boolean" ? fields.quizWorthy : segment.quizWorthy,
    spoilerLevel: normaliseSpoiler(fields.spoilerLevel),
    concepts: cleanStringArray(fields.concepts) ?? segment.concepts,
    characters: cleanStringArray(fields.characters) ?? segment.characters,
    locations: cleanStringArray(fields.locations) ?? segment.locations,
    themes: cleanStringArray(fields.themes, 3) ?? segment.themes,
  };
}

/**
 * Refine a heuristic guide with AI. Processes in batches with progress. Throws
 * if no batch succeeds; otherwise returns a guide marked "ai-refined" (partial
 * refinement still counts — un-refined segments keep their heuristic values).
 */
export async function refineStudyGuide(
  guide: StudyGuide,
  structure: BookStructure,
  apiKey: string,
  onProgress?: (p: RefineProgress) => void
): Promise<StudyGuide> {
  const chapters = structure.chapters;
  const segments = [...guide.segments];
  const batches: StudySegment[][] = [];
  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    batches.push(segments.slice(i, i + BATCH_SIZE));
  }

  let anySucceeded = false;
  let firstError: unknown = null;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    onProgress?.({
      message:
        batches.length > 1
          ? `Refining segments ${b * BATCH_SIZE + 1}–${b * BATCH_SIZE + batch.length}…`
          : "Refining study segments…",
      fraction: b / batches.length,
    });
    try {
      const fields = await refineBatch(batch, chapters, structure.title, apiKey);
      batch.forEach((segment, i) => {
        const idx = b * BATCH_SIZE + i;
        segments[idx] = applyRefinement(segment, fields[i]);
      });
      anySucceeded = true;
    } catch (err) {
      console.warn(`[StudyRefiner] Batch ${b} failed:`, err);
      if (!firstError) firstError = err;
      // Leave this batch's segments as their heuristic selves and continue.
    }
  }

  if (!anySucceeded) {
    throw firstError instanceof Error
      ? firstError
      : new Error("AI refinement failed for every segment.");
  }

  onProgress?.({ message: "Saving refined guide…", fraction: 1 });

  return {
    ...guide,
    segments,
    source: "ai-refined",
    generatedAt: new Date().toISOString(),
  };
}
