/**
 * Semantic Analysis Pipeline
 *
 * Three-pass analysis:
 *   Pass 1 — Story shape: sentiment scoring → smoothing → arc fitting → inflection detection
 *   Pass 2 — Scene identification: zoom into each inflection with Gemini
 *   Pass 3 — Image description: Gemini generates 2-4 sentence symbolic visual prompt
 */

import { analyzeStoryShape } from "./storyShape";
import type {
  BookStructure,
  MacroArc,
  InflectionPoint,
  IdentifiedScene,
  SemanticMap,
} from "@/types";
import { LUMINA_CONFIG } from "@/config";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function analyzeBook(
  structure: BookStructure,
  apiKey: string,
  onProgress?: (msg: string) => void
): Promise<SemanticMap> {
  onProgress?.("Scoring emotional trajectory…");

  // Pass 1: Story shape via proper algorithm
  const shapeResult = await analyzeStoryShape(
    structure.chapters,
    structure.title,
    apiKey,
    onProgress
  );

  onProgress?.("Identifying key moments…");

  // Enrich with dominant emotions and themes via Gemini
  const macroContext = await getMacroContext(structure, shapeResult.arcShape, apiKey);

  const macroArc: MacroArc = {
    arcShape: shapeResult.arcShape,
    dominantEmotions: macroContext.dominantEmotions,
    centralThemes: macroContext.centralThemes,
    inflectionPoints: shapeResult.inflectionPoints,
  };

  // Pass 2: Scene identification at each inflection
  const scenes = await identifyScenes(structure, macroArc, apiKey, onProgress);

  onProgress?.("Composing visual descriptions…");

  // Pass 3: Gemini generates the actual image description
  const scenesWithDescriptions = await generateImageDescriptions(
    scenes,
    macroArc,
    structure.title,
    apiKey,
    onProgress
  );

  const goldenNumber = calculateGoldenNumber(
    structure.totalWords,
    scenesWithDescriptions.length
  );
  const finalScenes = selectFinalScenes(scenesWithDescriptions, goldenNumber);

  onProgress?.("");

  return {
    bookId: structure.bookId,
    arcShape: macroArc.arcShape,
    inflectionPoints: macroArc.inflectionPoints,
    scenes: finalScenes,
    goldenNumber,
    analyzedAt: new Date().toISOString(),
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
  onProgress?: (msg: string) => void
): Promise<IdentifiedScene[]> {
  const scenes: IdentifiedScene[] = [];

  // Opening atmosphere — always first
  const openingChapter = structure.chapters[0];
  if (openingChapter) {
    const scene = await identifyOpeningScene(openingChapter, structure, apiKey);
    scenes.push(scene);
  }

  // One scene per inflection point
  for (const point of macroArc.inflectionPoints) {
    onProgress?.(`Examining chapter ${point.approximateChapterIndex + 1}…`);
    const chapter = structure.chapters[point.approximateChapterIndex];
    if (!chapter) continue;

    const scene = await identifySceneForInflection(chapter, point, structure, apiKey);
    scenes.push(scene);
  }

  return scenes;
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
    id: `scene_opening_${structure.bookId}`,
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
  onProgress?: (msg: string) => void
): Promise<IdentifiedScene[]> {
  const result: IdentifiedScene[] = [];

  for (let i = 0; i < scenes.length; i++) {
    onProgress?.(`Composing image description ${i + 1} of ${scenes.length}…`);
    const scene = scenes[i];

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

function selectFinalScenes(scenes: IdentifiedScene[], goldenNumber: number): IdentifiedScene[] {
  if (scenes.length <= goldenNumber) return scenes;

  const opening = scenes.find((s) => s.inflectionPointId === "opening");
  const rest = scenes.filter((s) => s.inflectionPointId !== "opening");
  const sorted = rest.sort((a, b) => b.narrativeWeight - a.narrativeWeight);
  const selected = sorted.slice(0, goldenNumber - (opening ? 1 : 0));
  const final = [...(opening ? [opening] : []), ...selected].sort(
    (a, b) => a.anchorCfi.localeCompare(b.anchorCfi)
  );

  return final;
}

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
