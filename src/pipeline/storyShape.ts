/**
 * Story Shape Algorithm
 *
 * Based on Kurt Vonnegut's narrative arc theory, validated computationally
 * by UVM research (2016) identifying 6 fundamental emotional arc types.
 *
 * Steps:
 * 1. Score each chapter emotionally (-1.0 to +1.0) via Gemini Flash
 * 2. Smooth the curve with rolling average
 * 3. Fit to one of 6 canonical arc shapes
 * 4. Locate mathematical inflection points (sign changes in derivative)
 * 5. Confirm inflection points with narrative context
 */

import type { AnalysisProgressReporter, ArcShape, InflectionPoint } from "@/types";
import {
  llmGenerateJSON,
  getProvider,
  runOdysseusParallel,
  type OdysseusParallelTask,
} from "@/api/llmClient";
import { diagnosticInfo, diagnosticWarn } from "@/utils/diagnostics";

// ─── Six Canonical Arc Shapes ─────────────────────────────────────────────────

type ArcTemplate = { shape: ArcShape; curve: number[] };

const ARC_TEMPLATES: ArcTemplate[] = [
  { shape: "rise", curve: [-0.8, -0.4, 0.0, 0.4, 0.7, 0.9] },
  { shape: "fall", curve: [0.8, 0.4, 0.0, -0.4, -0.7, -0.9] },
  { shape: "fall-rise", curve: [0.2, -0.3, -0.8, -0.5, 0.1, 0.8] },
  { shape: "rise-fall", curve: [-0.2, 0.3, 0.8, 0.5, -0.1, -0.8] },
  { shape: "rise-fall-rise", curve: [-0.5, 0.4, 0.8, 0.3, -0.4, 0.7] },
  { shape: "fall-rise-fall", curve: [0.5, -0.4, -0.8, -0.3, 0.4, -0.7] },
];

// ─── Main Analysis ────────────────────────────────────────────────────────────

export interface StoryShapeResult {
  arcShape: ArcShape;
  sentimentScores: number[]; // one per chapter
  smoothedScores: number[];
  inflectionPoints: InflectionPoint[];
}

export async function analyzeStoryShape(
  chapters: { id: string; title: string; index: number; rawText?: string }[],
  bookTitle: string,
  apiKey: string,
  onProgress?: AnalysisProgressReporter
): Promise<StoryShapeResult> {
  onProgress?.({
    phase: "scoring",
    message: `Scoring the emotional tone of ${chapters.length} chapters…`,
    percent: 8,
    current: 0,
    total: chapters.length,
  });

  // Step 1: Score each chapter
  const sentimentScores = await scoreChapters(chapters, bookTitle, apiKey, onProgress);

  // Step 2: Smooth with rolling average (window = 3)
  const smoothedScores = rollingAverage(sentimentScores, 3);

  // Step 3: Fit to arc shape
  const arcShape = fitToArcShape(smoothedScores);

  // Step 4: Find inflection points mathematically
  const rawInflections = findInflectionPoints(smoothedScores, chapters);

  // Step 5: Filter by significance and cap at meaningful count
  const inflectionPoints = rawInflections
    .filter((p) => p.significance >= 0.3)
    .slice(0, 6);

  return { arcShape, sentimentScores, smoothedScores, inflectionPoints };
}

// ─── Step 1: Sentiment Scoring ────────────────────────────────────────────────

async function scoreChapters(
  chapters: { id: string; title: string; index: number; rawText?: string }[],
  bookTitle: string,
  apiKey: string,
  onProgress?: AnalysisProgressReporter
): Promise<number[]> {
  const BATCH_SIZE = 8;

  if (getProvider() === "odysseus") {
    try {
      return await scoreChaptersParallel(chapters, bookTitle, onProgress);
    } catch (err) {
      console.warn("[StoryShape] Parallel scoring failed, falling back to sequential:", err);
    }
  }

  const scores: number[] = new Array(chapters.length).fill(0);
  for (let i = 0; i < chapters.length; i += BATCH_SIZE) {
    const batch = chapters.slice(i, i + BATCH_SIZE);
    const end = Math.min(i + BATCH_SIZE, chapters.length);
    onProgress?.({
      phase: "scoring",
      message: `Scoring chapters ${i + 1}-${end} of ${chapters.length}…`,
      percent: 8 + Math.round((end / Math.max(1, chapters.length)) * 30),
      current: end,
      total: chapters.length,
      itemLabel: batch.map((ch) => ch.title).join(", "),
    });
    const batchScores = await scoreBatch(batch, bookTitle, apiKey);
    batchScores.forEach((score, j) => { scores[i + j] = score; });
  }
  return scores;
}

function _buildScoringPrompt(
  chapters: { title: string; index: number; rawText?: string }[],
  bookTitle: string,
  totalChapters: number
): string {
  const summaries = chapters
    .map((ch) => {
      const excerpt = ch.rawText ? ch.rawText.split(/\s+/).slice(0, 60).join(" ") : "";
      return `Chapter ${ch.index + 1} "${ch.title}": ${excerpt}`;
    })
    .join("\n\n");
  // Horizon awareness (PLAN XIII, Stage 1): each batch is one slice of the book,
  // so tell it the whole's size and its position, and make it calibrate to the
  // full arc — not just the handful of chapters in front of it. Without this,
  // batches score in a vacuum and the stitched arc has mismatched seams.
  const first = (chapters[0]?.index ?? 0) + 1;
  const last = (chapters[chapters.length - 1]?.index ?? 0) + 1;
  return `You are scoring the emotional valence of chapters in "${bookTitle}", a book of ${totalChapters} chapters in total.

You are scoring chapters ${first}–${last} of ${totalChapters}. These are ONE SLICE of the whole book. Calibrate every score against the book's full emotional range from beginning to end — not just the chapters shown here. A calm chapter inside an otherwise dark book is not automatically 0.0; place it where it truly sits across the entire arc.

For each chapter below, provide a sentiment score from -1.0 (pure despair/tragedy) to +1.0 (pure joy/triumph).
Consider: emotional tone, what happens to characters, tension level, hope vs. hopelessness.
0.0 = neutral or balanced. Negative = darker. Positive = brighter.

Chapters:
${summaries}

Respond with ONLY a JSON array of numbers in order, one per chapter. Example: [-0.3, 0.1, -0.8, 0.5]
Numbers must be between -1.0 and 1.0.`;
}

type ChapterForScoring = { id: string; title: string; index: number; rawText?: string };

interface ScoringPacket {
  range: {
    startChapter: number;
    endChapter: number;
    totalChapters: number;
  };
  localMin: number;
  localMax: number;
  dominantTone: string[];
  turningPoints: Array<{
    chapter: number;
    label: string;
    direction: "rise" | "fall" | "steady";
  }>;
  entryTone: string;
  exitTone: string;
  preview: string;
  confidence: number;
}

interface ScoringBatchPayload {
  scores?: unknown[];
  packet?: Partial<ScoringPacket>;
}

interface ParsedScoringBatch {
  scores: number[];
  packet: ScoringPacket;
  usedFallback: boolean;
}

interface MergePayload {
  scores?: unknown[];
  globalMin?: unknown;
  globalMax?: unknown;
  arcSummary?: unknown;
  seamCorrections?: unknown[];
  confidence?: unknown;
}

function stripJsonFences(text: string): string {
  return text.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
}

function clampScore(value: unknown, fallback = 0): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(-1, Math.min(1, num));
}

function clampUnit(value: unknown, fallback = 0.5): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function parseJsonObject<T extends object>(content: string): T | null {
  try {
    const cleaned = stripJsonFences(content);
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

function parseJsonArray(content: string): unknown[] | null {
  try {
    const cleaned = stripJsonFences(content);
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizePacket(
  packet: Partial<ScoringPacket> | undefined,
  batch: { start: number; chapters: ChapterForScoring[] },
  scores: number[],
  totalChapters: number,
  fallbackConfidence = 0.45
): ScoringPacket {
  const first = batch.chapters[0]?.index ?? batch.start;
  const last = batch.chapters[batch.chapters.length - 1]?.index ?? first;
  const localMin = Math.min(...scores);
  const localMax = Math.max(...scores);
  const tones = Array.isArray(packet?.dominantTone)
    ? packet.dominantTone.filter((tone): tone is string => typeof tone === "string").slice(0, 5)
    : [];
  const turningPoints = Array.isArray(packet?.turningPoints)
    ? packet.turningPoints
        .map((point) => ({
          chapter: Math.max(1, Math.min(totalChapters, Number(point.chapter) || first + 1)),
          label: typeof point.label === "string" ? point.label.slice(0, 80) : "local shift",
          direction:
            point.direction === "rise" || point.direction === "fall" || point.direction === "steady"
              ? point.direction
              : "steady",
        }))
        .slice(0, 4)
    : [];

  return {
    range: {
      startChapter: Math.max(1, Number(packet?.range?.startChapter) || first + 1),
      endChapter: Math.max(1, Number(packet?.range?.endChapter) || last + 1),
      totalChapters,
    },
    localMin: clampScore(packet?.localMin, localMin),
    localMax: clampScore(packet?.localMax, localMax),
    dominantTone: tones.length ? tones : inferDominantTone(scores),
    turningPoints,
    entryTone: typeof packet?.entryTone === "string" ? packet.entryTone.slice(0, 120) : inferToneLabel(scores[0] ?? 0),
    exitTone:
      typeof packet?.exitTone === "string"
        ? packet.exitTone.slice(0, 120)
        : inferToneLabel(scores[scores.length - 1] ?? 0),
    preview:
      typeof packet?.preview === "string"
        ? packet.preview.slice(0, 240)
        : `${batch.chapters[0]?.title ?? "Opening"} through ${batch.chapters[batch.chapters.length - 1]?.title ?? "closing"}`,
    confidence: clampUnit(packet?.confidence, fallbackConfidence),
  };
}

function inferToneLabel(score: number): string {
  if (score >= 0.45) return "bright / triumphant";
  if (score >= 0.15) return "hopeful";
  if (score <= -0.45) return "bleak / catastrophic";
  if (score <= -0.15) return "tense";
  return "balanced";
}

function inferDominantTone(scores: number[]): string[] {
  const avg = scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length);
  const spread = Math.max(...scores) - Math.min(...scores);
  const tones = [inferToneLabel(avg)];
  if (spread > 0.65) tones.push("volatile");
  return tones;
}

function roughScoresForBatch(batch: { chapters: ChapterForScoring[] }): number[] {
  return batch.chapters.map((ch) => heuristicSentiment(ch.rawText || ""));
}

function parseScoringBatchResult(
  content: string | undefined,
  batch: { start: number; chapters: ChapterForScoring[] },
  totalChapters: number
): ParsedScoringBatch | null {
  if (!content) return null;

  const objectPayload = parseJsonObject<ScoringBatchPayload>(content);
  if (objectPayload && Array.isArray(objectPayload.scores)) {
    const scores = batch.chapters.map((_, i) => clampScore(objectPayload.scores?.[i]));
    return {
      scores,
      packet: normalizePacket(objectPayload.packet, batch, scores, totalChapters, 0.7),
      usedFallback: false,
    };
  }

  const arrayPayload = parseJsonArray(content);
  if (arrayPayload) {
    const scores = batch.chapters.map((_, i) => clampScore(arrayPayload[i]));
    return {
      scores,
      packet: normalizePacket(undefined, batch, scores, totalChapters, 0.35),
      usedFallback: false,
    };
  }

  return null;
}

function buildScoringBlackboardPrompt(
  chapters: ChapterForScoring[],
  bookTitle: string,
  totalChapters: number
): string {
  const first = (chapters[0]?.index ?? 0) + 1;
  const last = (chapters[chapters.length - 1]?.index ?? 0) + 1;
  const summaries = chapters
    .map((ch) => {
      const excerpt = ch.rawText ? ch.rawText.split(/\s+/).slice(0, 90).join(" ") : "";
      return `Chapter ${ch.index + 1} "${ch.title}": ${excerpt}`;
    })
    .join("\n\n");

  return `You are scoring the emotional valence of chapters in "${bookTitle}", a book of ${totalChapters} chapters.

You are scoring chapters ${first}-${last} of ${totalChapters}. This is one slice of the whole book. Calibrate against the entire book's likely emotional range, not only this slice.

For each chapter, provide a sentiment score from -1.0 (despair, dread, catastrophe) to +1.0 (joy, relief, triumph). Also write a compact blackboard packet that helps a merge worker reconcile this slice with the rest of the book.

Chapters:
${summaries}

Return ONLY this JSON object:
{
  "scores": [number],
  "packet": {
    "range": { "startChapter": ${first}, "endChapter": ${last}, "totalChapters": ${totalChapters} },
    "localMin": number,
    "localMax": number,
    "dominantTone": ["brief tone label"],
    "turningPoints": [{ "chapter": number, "label": "brief reason", "direction": "rise" | "fall" | "steady" }],
    "entryTone": "brief phrase",
    "exitTone": "brief phrase",
    "preview": "one compact sentence describing this slice's emotional function",
    "confidence": number
  }
}

Rules:
- scores length must be exactly ${chapters.length}, in chapter order.
- localMin/localMax must describe only this slice.
- Do not invent events outside the excerpts.
- Keep packet text short; it is for machine reconciliation, not reader display.`;
}

function buildArcMergePrompt(bookTitle: string, chapters: ChapterForScoring[]): string {
  const chapterIndex = chapters
    .map((ch) => `${ch.index + 1}. ${ch.title}`)
    .join("\n");

  return `You are reconciling parallel emotional chapter scores for "${bookTitle}".

You will receive upstream worker outputs. Each worker output should be a JSON object with:
- scores: local chapter scores
- packet: range, localMin/localMax, dominantTone, turningPoints, entryTone, exitTone, preview, confidence

Use those upstream packets to produce one coherent book-wide score array. You are not rewriting the story analysis. You are only fixing scale, seams, and obvious local calibration mismatches across batches.

Book chapter order:
${chapterIndex}

Return ONLY this JSON object:
{
  "scores": [number],
  "globalMin": number,
  "globalMax": number,
  "arcSummary": "one compact sentence",
  "seamCorrections": [{ "afterChapter": number, "reason": "brief" }],
  "confidence": number
}

Rules:
- scores length must be exactly ${chapters.length}.
- Every score must be between -1.0 and 1.0.
- Preserve chapter order.
- Do not invent plot events.
- If upstream workers disagree, smooth seams conservatively instead of flattening the whole arc.`;
}

function parseMergedScores(merge: unknown, chapterCount: number): { scores: number[]; confidence: number; arcSummary?: string } | null {
  let payload: MergePayload | null = null;

  if (typeof merge === "string") {
    payload = parseJsonObject<MergePayload>(merge);
  } else if (merge && typeof merge === "object") {
    const maybeContent = (merge as { content?: unknown }).content;
    if (typeof maybeContent === "string") {
      payload = parseJsonObject<MergePayload>(maybeContent);
    } else {
      payload = merge as MergePayload;
    }
  }

  if (!payload || !Array.isArray(payload.scores) || payload.scores.length !== chapterCount) return null;

  return {
    scores: payload.scores.map((score) => clampScore(score)),
    confidence: clampUnit(payload.confidence, 0.5),
    arcSummary: typeof payload.arcSummary === "string" ? payload.arcSummary.slice(0, 240) : undefined,
  };
}

async function scoreChaptersParallel(
  chapters: ChapterForScoring[],
  bookTitle: string,
  onProgress?: AnalysisProgressReporter
): Promise<number[]> {
  const BATCH_SIZE = 8;
  const batches: Array<{ start: number; chapters: typeof chapters }> = [];
  for (let i = 0; i < chapters.length; i += BATCH_SIZE) {
    batches.push({ start: i, chapters: chapters.slice(i, i + BATCH_SIZE) });
  }

  const tasks: OdysseusParallelTask[] = batches.map((b, i) => ({
    id: `score-batch-${i}`,
    agent: "reading",
    prompt: buildScoringBlackboardPrompt(b.chapters, bookTitle, chapters.length),
    temperature: 0.3,
    max_tokens: 700,
    packet_mode: "compact",
  }));

  onProgress?.({
    phase: "scoring",
    message: `Scoring all ${chapters.length} chapters in parallel (${batches.length} batches)…`,
    percent: 8,
    current: 0,
    total: chapters.length,
  });

  const result = await runOdysseusParallel({
    workflow: {
      type: "chapter-scoring",
      label: `Emotional arc scoring — ${bookTitle}`,
      task_goal: `Score ${chapters.length} chapters for sentiment across ${batches.length} parallel batches`,
      context: { book_title: bookTitle, chapter_count: chapters.length, batch_count: batches.length },
    },
    tasks,
    max_concurrency: 8,
    merge_agent: "reading",
    merge_prompt: buildArcMergePrompt(bookTitle, chapters),
  });

  onProgress?.({
    phase: "scoring",
    message: `Reconciling ${batches.length} chapter score packets into one arc…`,
    percent: 35,
    current: chapters.length,
    total: chapters.length,
  });

  const scores: number[] = new Array(chapters.length).fill(0);
  const packets: ScoringPacket[] = [];
  let failedBatches = 0;
  let fallbackBatches = 0;

  for (let i = 0; i < batches.length; i++) {
    const taskResult = result.results.find((r) => r.id === `score-batch-${i}`);
    const batch = batches[i];

    const parsed = taskResult?.status === "done"
      ? parseScoringBatchResult(taskResult.content, batch, chapters.length)
      : null;

    if (parsed) {
      parsed.scores.forEach((score, j) => {
        scores[batch.start + j] = score;
      });
      packets.push(parsed.packet);
      if (parsed.usedFallback) fallbackBatches += 1;
      continue;
    }

    // Heuristic fallback for failed batch
    failedBatches += 1;
    fallbackBatches += 1;
    const fallbackScores = roughScoresForBatch(batch);
    fallbackScores.forEach((score, j) => {
      scores[batch.start + j] = score;
    });
    packets.push(normalizePacket(undefined, batch, fallbackScores, chapters.length, 0.2));
  }

  diagnosticInfo("story_shape.parallel_scoring.complete", "Parallel chapter score packets parsed", {
    bookTitle,
    chapterCount: chapters.length,
    batchCount: batches.length,
    packetCount: packets.length,
    failedBatches,
    fallbackBatches,
  });

  const merged = parseMergedScores(result.merge, chapters.length);
  if (merged) {
    diagnosticInfo("story_shape.merge_reconcile.complete", "Merged chapter scores into one book-wide arc", {
      bookTitle,
      chapterCount: chapters.length,
      batchCount: batches.length,
      confidence: merged.confidence,
      arcSummary: merged.arcSummary,
    });
    onProgress?.({
      phase: "scoring",
      message: `Arc scoring reconciled — fitting story shape…`,
      percent: 38,
      current: chapters.length,
      total: chapters.length,
    });
    return merged.scores;
  }

  diagnosticWarn("story_shape.merge_reconcile.failed", "Merge reconciliation missing or invalid; using parsed batch scores", {
    bookTitle,
    chapterCount: chapters.length,
    batchCount: batches.length,
    hasMerge: Boolean(result.merge),
  });

  onProgress?.({
    phase: "scoring",
    message: `Scored all ${chapters.length} chapters — fitting arc shape…`,
    percent: 38,
    current: chapters.length,
    total: chapters.length,
  });

  return scores;
}

async function scoreBatch(
  chapters: { title: string; index: number; rawText?: string }[],
  bookTitle: string,
  apiKey: string
): Promise<number[]> {
  const chapterSummaries = chapters
    .map((ch, i) => {
      const excerpt = ch.rawText ? ch.rawText.split(/\s+/).slice(0, 60).join(" ") : "";
      return `Chapter ${ch.index + 1} "${ch.title}": ${excerpt}`;
    })
    .join("\n\n");

  const prompt = `You are scoring the emotional valence of chapters in "${bookTitle}".

For each chapter below, provide a sentiment score from -1.0 (pure despair/tragedy) to +1.0 (pure joy/triumph).
Consider: emotional tone, what happens to characters, tension level, hope vs. hopelessness.
0.0 = neutral or balanced. Negative = darker. Positive = brighter.

Chapters:
${chapterSummaries}

Respond with ONLY a JSON array of numbers in order, one per chapter. Example: [-0.3, 0.1, -0.8, 0.5]
Numbers must be between -1.0 and 1.0.`;

  try {
    const parsed = await llmGenerateJSON<unknown[]>("reading", prompt, {
      temperature: 0.3,
      maxTokens: 256,
      geminiKey: apiKey,
    });

    if (Array.isArray(parsed)) {
      return chapters.map((_, i) =>
        typeof parsed[i] === "number" ? Math.max(-1, Math.min(1, parsed[i])) : 0
      );
    }
  } catch (err) {
    console.warn("[StoryShape] Batch scoring failed, using heuristic:", err);
  }

  // Fallback: rough heuristic from word patterns
  return chapters.map((ch) => heuristicSentiment(ch.rawText || ""));
}

function heuristicSentiment(text: string): number {
  const lower = text.toLowerCase();
  const positiveWords = ["joy", "love", "hope", "light", "laugh", "bright", "win", "free", "peace", "happy", "triumph", "save"];
  const negativeWords = ["death", "dark", "fear", "loss", "pain", "cry", "bleed", "fall", "alone", "broken", "war", "dead", "kill", "grief"];

  const posCount = positiveWords.filter((w) => lower.includes(w)).length;
  const negCount = negativeWords.filter((w) => lower.includes(w)).length;
  const total = posCount + negCount;
  if (total === 0) return 0;
  return (posCount - negCount) / total;
}

// ─── Step 2: Rolling Average ───────────────────────────────────────────────────

function rollingAverage(scores: number[], window: number): number[] {
  if (scores.length <= 1) return [...scores];
  return scores.map((_, i) => {
    const start = Math.max(0, i - Math.floor(window / 2));
    const end = Math.min(scores.length, i + Math.ceil(window / 2));
    const slice = scores.slice(start, end);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

// ─── Step 3: Arc Shape Fitting ────────────────────────────────────────────────

function fitToArcShape(smoothed: number[]): ArcShape {
  if (smoothed.length === 0) return "rise-fall-rise";

  // Normalize to 6 points for comparison
  const normalized = resampleTo(smoothed, 6);

  let bestFit: ArcShape = "rise-fall-rise";
  let bestScore = Infinity;

  for (const template of ARC_TEMPLATES) {
    const score = meanSquaredError(normalized, template.curve);
    if (score < bestScore) {
      bestScore = score;
      bestFit = template.shape;
    }
  }

  return bestFit;
}

function resampleTo(arr: number[], targetLength: number): number[] {
  if (arr.length === targetLength) return arr;
  const result: number[] = [];
  for (let i = 0; i < targetLength; i++) {
    const idx = (i / (targetLength - 1)) * (arr.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, arr.length - 1);
    const frac = idx - lo;
    result.push(arr[lo] * (1 - frac) + arr[hi] * frac);
  }
  return result;
}

function meanSquaredError(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  return a.slice(0, len).reduce((sum, val, i) => sum + (val - b[i]) ** 2, 0) / len;
}

// ─── Step 4: Mathematical Inflection Detection ────────────────────────────────

function findInflectionPoints(
  smoothed: number[],
  chapters: { id: string; title: string; index: number }[]
): InflectionPoint[] {
  if (smoothed.length < 3) return [];

  const inflections: InflectionPoint[] = [];

  // Compute first derivative (slope between adjacent points)
  const derivative = smoothed.slice(1).map((val, i) => val - smoothed[i]);

  // Find sign changes in derivative = inflection points
  for (let i = 1; i < derivative.length; i++) {
    const prev = derivative[i - 1];
    const curr = derivative[i];

    if (prev * curr < 0) {
      // Sign changed — this is an inflection
      const chapterIndex = Math.min(i, chapters.length - 1);
      const chapter = chapters[chapterIndex];
      const magnitude = Math.abs(curr - prev); // size of the turn

      // Determine the nature of the turn
      const isRise = curr > 0; // going upward after this point
      const sentimentAtPoint = smoothed[i] || 0;

      inflections.push({
        id: `ip_${chapterIndex}_${i}`,
        approximateChapterIndex: chapterIndex,
        emotionalShift: describeShift(prev, curr, sentimentAtPoint),
        narrativeLabel: inferNarrativeLabel(sentimentAtPoint, isRise, magnitude),
        significance: Math.min(1, magnitude * 1.5), // normalize magnitude to 0-1
      });
    }
  }

  // Also flag the emotional peak and nadir
  const maxIdx = smoothed.indexOf(Math.max(...smoothed));
  const minIdx = smoothed.indexOf(Math.min(...smoothed));

  [maxIdx, minIdx].forEach((idx) => {
    const exists = inflections.some((p) => Math.abs(p.approximateChapterIndex - idx) <= 1);
    if (!exists && idx < chapters.length) {
      const isMax = idx === maxIdx;
      inflections.push({
        id: `ip_peak_${idx}`,
        approximateChapterIndex: idx,
        emotionalShift: isMax ? "emotional peak of the narrative" : "emotional nadir of the narrative",
        narrativeLabel: isMax ? "climax" : "darkest moment",
        significance: isMax ? 0.9 : 0.85,
      });
    }
  });

  return inflections.sort((a, b) => a.approximateChapterIndex - b.approximateChapterIndex);
}

function describeShift(prevSlope: number, currSlope: number, sentiment: number): string {
  if (prevSlope > 0 && currSlope < 0) {
    return sentiment > 0
      ? "story reaches a high point and begins to fall"
      : "brief recovery ends and descent resumes";
  }
  if (prevSlope < 0 && currSlope > 0) {
    return sentiment < 0
      ? "darkest moment passed, slow climb begins"
      : "momentum shifts toward resolution";
  }
  return "emotional trajectory changes direction";
}

function inferNarrativeLabel(
  sentiment: number,
  isRising: boolean,
  magnitude: number
): string {
  if (magnitude > 0.6) {
    if (!isRising && sentiment > 0.2) return "point of no return";
    if (!isRising && sentiment <= 0) return "collapse";
    if (isRising && sentiment < -0.2) return "turning point";
    if (isRising && sentiment >= 0) return "resolution";
  }
  if (isRising) return sentiment < 0 ? "glimmer of hope" : "rising action";
  return sentiment > 0 ? "false victory" : "deepening conflict";
}
