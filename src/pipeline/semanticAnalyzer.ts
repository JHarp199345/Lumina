/**
 * Semantic Analysis Pipeline
 *
 * Three-pass analysis:
 *   Pass 1 — Story shape: sentiment scoring → smoothing → arc fitting → inflection detection
 *   Pass 2 — Scene identification: zoom into each inflection with Gemini
 *   Pass 3 — Image description: Gemini generates 2-4 sentence symbolic visual prompt
 */

import { analyzeStoryShape } from "./storyShape";
import { buildVisualStoryboard } from "./visualStoryboard";
import {
  buildNarrativeBlueprint,
  annotateScenesWithThreads,
  selectNarrativeScenes,
} from "./narrativeThreads";
import type {
  BookStructure,
  MacroArc,
  InflectionPoint,
  IdentifiedScene,
  SemanticMap,
  AnalysisProgressReporter,
} from "@/types";
import { LUMINA_CONFIG } from "@/config";
import { VISUAL_PLAN_VERSION } from "@/config/visualPlan";
import { storyOnlyStructure } from "@/utils/storyContent";
import { buildChapterVisualPlan } from "@/utils/sceneDedup";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function analyzeBook(
  structure: BookStructure,
  apiKey: string,
  onProgress?: AnalysisProgressReporter
): Promise<SemanticMap> {
  const analysisStructure = storyOnlyStructure(structure);
  const report = makeProgressReporter(onProgress);
  report({
    phase: "preparing",
    message: `Preparing ${analysisStructure.chapters.length} story chapters for analysis…`,
    percent: 3,
    current: 0,
    total: analysisStructure.chapters.length,
  });

  // Pass 1: Story shape via proper algorithm
  const shapeResult = await analyzeStoryShape(
    analysisStructure.chapters,
    analysisStructure.title,
    apiKey,
    report
  );

  report({
    phase: "mapping",
    message: "Mapping the book's emotional arc…",
    percent: 40,
  });

  // Enrich with dominant emotions and themes via Gemini
  const macroContext = await getMacroContext(analysisStructure, shapeResult.arcShape, apiKey);

  const macroArc: MacroArc = {
    arcShape: shapeResult.arcShape,
    dominantEmotions: macroContext.dominantEmotions,
    centralThemes: macroContext.centralThemes,
    inflectionPoints: shapeResult.inflectionPoints,
  };

  // Pass 2.0: Narrative blueprint — the setup→payoff spine the rest of the
  // pipeline reads from. One book-wide call; on failure selection degrades
  // gracefully to emotional-weight ordering.
  const narrativeBlueprint = await buildNarrativeBlueprint({
    structure: analysisStructure,
    macroArc,
    apiKey,
    onProgress: report,
  });

  // Pass 2: Scene identification at each inflection
  const scenes = await identifyScenes(analysisStructure, macroArc, apiKey, report);

  report({
    phase: "prompts",
    message: `Writing visual briefs for ${scenes.length} image moments…`,
    percent: 68,
    current: 0,
    total: scenes.length,
  });

  // Pass 3: Gemini generates the actual image description
  const scenesWithDescriptions = await generateImageDescriptions(
    scenes,
    macroArc,
    analysisStructure.title,
    apiKey,
    report
  );

  // Stamp each scene with its thread membership (id / role / motif). From here
  // on, every stage reads narrative structure directly off the scene.
  const annotatedScenes = annotateScenesWithThreads(
    scenesWithDescriptions,
    narrativeBlueprint,
    analysisStructure
  );

  // One visual slot per reading chapter — opening/inflection beats claim their
  // chapter; everything else gets a single planned anchor in that section.
  const chapterPlan = buildChapterVisualPlan(
    analysisStructure,
    macroArc,
    annotatedScenes,
    buildPlannedChapterScene
  );

  const plannedScenes = annotateScenesWithThreads(
    chapterPlan,
    narrativeBlueprint,
    analysisStructure
  );

  const goldenNumber = calculateGoldenNumber(analysisStructure.totalWords, plannedScenes.length);
  const defaultScenes = selectNarrativeScenes(plannedScenes, goldenNumber, narrativeBlueprint);
  const defaultSceneIds = new Set(defaultScenes.map((scene) => scene.id));

  const storyboard = buildVisualStoryboard({
    bookId: analysisStructure.bookId,
    arcShape: macroArc.arcShape,
    structure: analysisStructure,
    scenes: plannedScenes,
    inflectionPoints: macroArc.inflectionPoints,
    goldenNumber,
    defaultSceneIds,
  });

  report({
    phase: "complete",
    message: `Analysis complete: ${defaultScenes.length} default images and ${plannedScenes.length} mapped moments.`,
    percent: 88,
    current: defaultScenes.length,
    total: plannedScenes.length,
  });

  return {
    bookId: analysisStructure.bookId,
    visualPlanVersion: VISUAL_PLAN_VERSION,
    arcShape: macroArc.arcShape,
    inflectionPoints: macroArc.inflectionPoints,
    scenes: plannedScenes,
    goldenNumber,
    analyzedAt: new Date().toISOString(),
    storyboard,
    narrativeBlueprint,
  };
}

function buildPlannedChapterScene(
  chapter: BookStructure["chapters"][0],
  structure: BookStructure,
  macroArc: MacroArc
): IdentifiedScene {
  const targetOffset = Math.floor(chapter.wordCount * 0.42);
  const anchorSection = chapter.sections.reduce((best, section) => {
    const bestDist = Math.abs((best.startWordOffset ?? 0) - targetOffset);
    const sectionDist = Math.abs((section.startWordOffset ?? 0) - targetOffset);
    return sectionDist < bestDist ? section : best;
  }, chapter.sections[0] ?? { id: chapter.id, startWordOffset: targetOffset });

  const scene = buildFallbackScene(chapter, structure, `planned_chapter_${chapter.index}`, {
    id: `planned_chapter_${chapter.index}`,
    approximateChapterIndex: chapter.index,
    emotionalShift: macroArc.dominantEmotions.slice(0, 2).join(", ") || "emotional transition",
    significance: 0.35,
    narrativeLabel: chapter.title,
  });

  return {
    ...scene,
    id: `scene_planned_${structure.bookId}_${chapter.id}`,
    inflectionPointId: `planned_chapter_${chapter.index}`,
    sectionId: anchorSection.id,
    anchor: {
      href: chapter.href,
      spineIndex: chapter.spineIndex,
      wordOffset: anchorSection.startWordOffset ?? targetOffset,
    },
    narrativeWeight: 0.35,
    imageDescription: buildFallbackDescription(scene, macroArc),
  };
}

function makeProgressReporter(onProgress?: AnalysisProgressReporter): AnalysisProgressReporter {
  return (progress) => {
    if (!onProgress) return;
    onProgress(typeof progress === "string" ? progress : {
      ...progress,
      percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
    });
  };
}

// ─── Macro Context (themes & emotions from Gemini) ────────────────────────────

async function getMacroContext(
  structure: BookStructure,
  arcShape: string,
  apiKey: string
): Promise<{ dominantEmotions: string[]; centralThemes: string[] }> {
  const sampleChapters = structure.chapters
    .slice(0, Math.min(5, structure.chapters.length))
    .map((ch) => `"${ch.title}": ${(ch.rawText || "").split(/\s+/).slice(0, 50).join(" ")}`)
    .join("\n");

  const prompt = `Book: "${structure.title}" by ${structure.author}
Arc shape identified: ${arcShape}

Sample chapters:
${sampleChapters}

Identify concisely:
1. 2-3 dominant emotional qualities of the entire book (single words or short phrases)
2. 2-3 central symbolic themes (single words or short phrases)

Respond in JSON: { "dominantEmotions": ["...", "..."], "centralThemes": ["...", "..."] }`;

  try {
    const raw = await callGemini(prompt, apiKey, 256);
    const parsed = parseJsonResponse<{ dominantEmotions: string[]; centralThemes: string[] }>(raw);
    return {
      dominantEmotions: parsed.dominantEmotions || [],
      centralThemes: parsed.centralThemes || [],
    };
  } catch {
    return { dominantEmotions: [], centralThemes: [] };
  }
}

// ─── Pass 2: Scene Identification ─────────────────────────────────────────────

async function identifyScenes(
  structure: BookStructure,
  macroArc: MacroArc,
  apiKey: string,
  onProgress?: AnalysisProgressReporter
): Promise<IdentifiedScene[]> {
  const scenes: IdentifiedScene[] = [];
  const usedChapterIds = new Set<string>();
  const totalScenes = macroArc.inflectionPoints.length + (structure.chapters[0] ? 1 : 0);

  // Opening atmosphere — always first
  const openingChapter = structure.chapters[0];
  if (openingChapter) {
    onProgress?.({
      phase: "scenes",
      message: "Finding the opening visual moment…",
      percent: 45,
      current: 1,
      total: totalScenes,
      itemLabel: openingChapter.title,
    });
    const scene = await identifyOpeningScene(openingChapter, structure, apiKey).catch((err) => {
      console.warn("[Semantic] Opening scene identification failed, using fallback:", err);
      return buildFallbackScene(openingChapter, structure, "opening");
    });
    scenes.push(scene);
    usedChapterIds.add(openingChapter.id);
  }

  // One scene per inflection point — never stack a second beat on the same chapter.
  for (let i = 0; i < macroArc.inflectionPoints.length; i++) {
    const point = macroArc.inflectionPoints[i];
    const chapter = structure.chapters[point.approximateChapterIndex];
    if (!chapter || usedChapterIds.has(chapter.id)) continue;
    onProgress?.({
      phase: "scenes",
      message: `Finding key scene ${i + 1} of ${macroArc.inflectionPoints.length}…`,
      percent: 48 + Math.round(((i + 1) / Math.max(1, macroArc.inflectionPoints.length)) * 17),
      current: i + 2,
      total: totalScenes,
      itemLabel: chapter.title,
    });

    const scene = await identifySceneForInflection(chapter, point, structure, apiKey).catch((err) => {
      console.warn("[Semantic] Inflection scene identification failed, using fallback:", err);
      return buildFallbackScene(chapter, structure, point.id, point);
    });
    scenes.push(scene);
    usedChapterIds.add(chapter.id);
  }

  return scenes;
}

function buildFallbackScene(
  chapter: BookStructure["chapters"][0],
  structure: BookStructure,
  inflectionPointId: string,
  inflectionPoint?: InflectionPoint
): IdentifiedScene {
  const targetOffset = inflectionPoint
    ? Math.floor(chapter.wordCount * 0.35)
    : 0;
  const anchorSection = chapter.sections.reduce((best, section) => {
    const bestDist = Math.abs((best.startWordOffset ?? 0) - targetOffset);
    const sectionDist = Math.abs((section.startWordOffset ?? 0) - targetOffset);
    return sectionDist < bestDist ? section : best;
  }, chapter.sections[0] ?? { id: chapter.id, startWordOffset: targetOffset });

  const text = (chapter.rawText || "").toLowerCase();
  const emotionalVector = [
    text.match(/war|kill|blood|fear|death|dark|pain/) ? "tension" : "uncertainty",
    text.match(/hope|light|love|free|rise|home/) ? "longing" : "foreboding",
  ];
  const symbolicMotifs = [
    "threshold",
    "distant light",
    inflectionPoint?.narrativeLabel || "unseen turning point",
  ];
  const atmosphericQualities = [
    text.match(/cold|ice|snow|night|dark/) ? "cold shadow" : "muted atmosphere",
    text.match(/fire|red|blood|sun/) ? "embered light" : "quiet pressure",
  ];

  return {
    id:
      inflectionPointId === "opening"
        ? `scene_opening_${structure.bookId}_${chapter.id}`
        : `scene_${inflectionPointId}_${chapter.id}`,
    inflectionPointId,
    chapterId: chapter.id,
    sectionId: anchorSection.id,
    anchorCfi: "",
    anchor: {
      href: chapter.href,
      spineIndex: chapter.spineIndex,
      wordOffset: anchorSection.startWordOffset ?? targetOffset,
    },
    emotionalVector,
    symbolicMotifs,
    atmosphericQualities,
    narrativeWeight: inflectionPoint?.significance ?? 0.65,
  };
}

async function identifyOpeningScene(
  chapter: BookStructure["chapters"][0],
  structure: BookStructure,
  apiKey: string
): Promise<IdentifiedScene> {
  const text = truncateText(chapter.rawText || "", 500);

  const prompt = `Analyze the symbolic and atmospheric opening of "${structure.title}".

Opening text:
${text}

Extract the emotional and symbolic essence — NOT a plot summary.
Think like a symbolist painter. What is the emotional atmosphere? What symbols are present or implied?

JSON response:
{
  "emotionalVector": ["emotion1", "emotion2"],
  "symbolicMotifs": ["motif1", "motif2", "motif3"],
  "atmosphericQualities": ["quality1", "quality2"],
  "narrativeWeight": 0.7
}`;

  const raw = await callGemini(prompt, apiKey, 512);
  const parsed = parseJsonResponse<Partial<IdentifiedScene>>(raw);

  return {
    id: `scene_opening_${structure.bookId}_${chapter.id}`,
    inflectionPointId: "opening",
    chapterId: chapter.id,
    sectionId: chapter.sections[0]?.id ?? chapter.id,
    anchorCfi: "",
    anchor: {
      href: chapter.href,
      spineIndex: chapter.spineIndex,
      wordOffset: 0,
    },
    emotionalVector: (parsed.emotionalVector as string[]) || [],
    symbolicMotifs: (parsed.symbolicMotifs as string[]) || [],
    atmosphericQualities: (parsed.atmosphericQualities as string[]) || [],
    narrativeWeight: (parsed.narrativeWeight as number) || 0.7,
  };
}

async function identifySceneForInflection(
  chapter: BookStructure["chapters"][0],
  inflectionPoint: InflectionPoint,
  structure: BookStructure,
  apiKey: string
): Promise<IdentifiedScene> {
  const text = truncateText(chapter.rawText || "", 700);

  const prompt = `You are identifying the symbolic visual essence of a key emotional moment in "${structure.title}".

Chapter: "${chapter.title}" (Chapter ${chapter.index + 1})
Emotional transition: "${inflectionPoint.emotionalShift}"
Narrative role: "${inflectionPoint.narrativeLabel}"

Chapter text:
${text}

Extract the symbolic and emotional essence. Do NOT describe the scene literally.
Think like a symbolist painter — what would this moment look like as a painting?

Examples of good symbolic motifs: "fractured crown", "still water before a storm", "a door left ajar"
Examples to avoid (too literal): "the king's crown", "the lake at sunrise"

JSON response:
{
  "emotionalVector": ["emotion1", "emotion2"],
  "symbolicMotifs": ["motif1", "motif2", "motif3"],
  "atmosphericQualities": ["quality1", "quality2"],
  "narrativeWeight": 0.8
}`;

  const raw = await callGemini(prompt, apiKey, 512);
  const parsed = parseJsonResponse<Partial<IdentifiedScene>>(raw);

  // Anchor to the most emotionally significant section.
  // Prefer the section at or just past the first third of the chapter —
  // inflection moments typically build rather than open a chapter.
  const targetOffset = Math.floor(chapter.wordCount * 0.35);
  const anchorSection = chapter.sections.reduce((best, s) => {
    const bDist = Math.abs((best.startWordOffset ?? 0) - targetOffset);
    const sDist = Math.abs((s.startWordOffset ?? 0) - targetOffset);
    return sDist < bDist ? s : best;
  }, chapter.sections[0] ?? { id: chapter.id, startWordOffset: targetOffset });

  return {
    id: `scene_${inflectionPoint.id}_${chapter.id}`,
    inflectionPointId: inflectionPoint.id,
    chapterId: chapter.id,
    sectionId: anchorSection.id,
    anchorCfi: "",
    anchor: {
      href: chapter.href,
      spineIndex: chapter.spineIndex,
      wordOffset: anchorSection.startWordOffset ?? targetOffset,
    },
    emotionalVector: (parsed.emotionalVector as string[]) || [],
    symbolicMotifs: (parsed.symbolicMotifs as string[]) || [],
    atmosphericQualities: (parsed.atmosphericQualities as string[]) || [],
    narrativeWeight: (parsed.narrativeWeight as number) || 0.5,
  };
}

// ─── Pass 3: Image Description (real Gemini call) ─────────────────────────────

async function generateImageDescriptions(
  scenes: IdentifiedScene[],
  macroArc: MacroArc,
  bookTitle: string,
  apiKey: string,
  onProgress?: AnalysisProgressReporter
): Promise<IdentifiedScene[]> {
  const result: IdentifiedScene[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    onProgress?.({
      phase: "prompts",
      message: `Writing visual brief ${i + 1} of ${scenes.length}…`,
      percent: 68 + Math.round(((i + 1) / Math.max(1, scenes.length)) * 17),
      current: i + 1,
      total: scenes.length,
      itemLabel: scene.symbolicMotifs.slice(0, 2).join(" + ") || scene.chapterId,
    });

    try {
      const description = await generateSingleDescription(scene, macroArc, bookTitle, apiKey);
      result.push({ ...scene, imageDescription: description });
    } catch {
      // Fall back to template if Gemini fails
      result.push({ ...scene, imageDescription: buildFallbackDescription(scene, macroArc) });
    }
  }

  return result;
}

async function generateSingleDescription(
  scene: IdentifiedScene,
  macroArc: MacroArc,
  bookTitle: string,
  apiKey: string
): Promise<string> {
  const prompt = `You are writing a 2-4 sentence image generation prompt for a symbolic, atmospheric painting.
This image will accompany a reader at a key emotional moment in "${bookTitle}".

The moment's emotional qualities: ${scene.emotionalVector.join(", ")}
Symbolic visual motifs: ${scene.symbolicMotifs.join(", ")}
Atmospheric qualities: ${scene.atmosphericQualities.join(", ")}
Central book themes: ${macroArc.centralThemes.join(", ")}

Write a 2-4 sentence image generation prompt that:
- Is entirely symbolic and atmospheric — NOT literal
- Evokes emotion through composition, light, and symbol rather than narrative
- Suggests no specific named characters or exact literary scenes
- Reads like a brief for a symbolist watercolor painting or illuminated manuscript
- Avoids: text, faces, crowds, photorealistic directives

Respond with ONLY the prompt text, no JSON, no quotes, no explanation.`;

  const url = `${GEMINI_BASE}/models/${LUMINA_CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.85,
        topP: 0.95,
        maxOutputTokens: 300,
      },
    }),
  });

  if (!response.ok) throw new Error(`Gemini error ${response.status}`);

  const data = await response.json();
  return (data.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
}

function buildFallbackDescription(scene: IdentifiedScene, macroArc: MacroArc): string {
  const emotions = scene.emotionalVector.slice(0, 2).join(" and ");
  const motifs = scene.symbolicMotifs.slice(0, 3).join(", ");
  const atmosphere = scene.atmosphericQualities.slice(0, 2).join(", ");
  const themes = macroArc.centralThemes.slice(0, 2).join(" and ");
  return (
    `Symbolic atmospheric composition evoking ${emotions}. ` +
    `Visual motifs: ${motifs}. Atmosphere: ${atmosphere}. ` +
    `Underlying themes of ${themes}. Non-literal, painterly, symbolic. No text, no faces.`
  );
}

// ─── Golden Number & Scene Selection ─────────────────────────────────────────

function calculateGoldenNumber(totalWords: number, candidateCount: number): number {
  let cap: number;
  if (totalWords < 50000) cap = LUMINA_CONFIG.MAX_IMAGES_SHORT_BOOK;
  else if (totalWords < 150000) cap = LUMINA_CONFIG.MAX_IMAGES_MEDIUM_BOOK;
  else cap = LUMINA_CONFIG.MAX_IMAGES_LONG_BOOK;

  return Math.max(LUMINA_CONFIG.MIN_IMAGES, Math.min(cap, candidateCount));
}

// Scene selection now lives in narrativeThreads.ts (selectNarrativeScenes) —
// it scores by setup→payoff role and completes chains instead of taking the
// top-sentiment N.

// ─── Gemini Helpers ───────────────────────────────────────────────────────────

async function callGemini(prompt: string, apiKey: string, maxTokens = 1024): Promise<string> {
  const url = `${GEMINI_BASE}/models/${LUMINA_CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: maxTokens,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
}

function truncateText(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + "…";
}

function parseJsonResponse<T>(raw: string): T {
  const cleaned = raw
    .replace(/```json\n?/gi, "")
    .replace(/```\n?/gi, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    console.error("[Semantic] Failed to parse JSON:", cleaned.slice(0, 200));
    return {} as T;
  }
}
