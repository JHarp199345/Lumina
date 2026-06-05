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
import { LUMINA_CONFIG } from "@/config";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

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
  // Batch chapters into groups to minimize API calls
  const BATCH_SIZE = 8;
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
      itemLabel: batch.map((chapter) => chapter.title).join(", "),
    });
    const batchScores = await scoreBatch(batch, bookTitle, apiKey);
    batchScores.forEach((score, j) => {
      scores[i + j] = score;
    });
  }

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
    const url = `${GEMINI_BASE}/models/${LUMINA_CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 256,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) throw new Error(`Gemini error ${response.status}`);

    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
    const parsed = JSON.parse(cleaned);

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
