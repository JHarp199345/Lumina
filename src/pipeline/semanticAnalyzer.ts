/**
 * Semantic Analysis Pipeline
 *
 * Three-pass analysis:
 *   Pass 1 — Story shape: sentiment scoring → smoothing → arc fitting → inflection detection
 *   Pass 2 — Scene identification: zoom into each inflection with Gemini
 *   Pass 3 — Image description: Gemini generates 2-4 sentence symbolic visual prompt
 */

import { analyzeStoryShape, type StoryShapeResult } from "./storyShape";
import { analyzeExpositoryBook } from "@/pipeline/expositoryAnalyzer";
import { pickSceneAnchor, isGutenbergEdition } from "@/pipeline/gutenbergAnchors";
import { refreshGutenbergStructureSections } from "@/pipeline/gutenbergAnalysis";
import { resolveWorkProtocol } from "@/pipeline/workProtocol";
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
import {
  llmGenerate,
  llmGenerateJSON,
  getProvider,
  runOdysseusSequential,
  type OdysseusParallelTask,
} from "@/api/llmClient";
import { VISUAL_PLAN_VERSION } from "@/config/visualPlan";
import { storyOnlyStructure } from "@/utils/storyContent";
import { buildVisualSlotPlan } from "@/utils/sceneDedup";
import { buildPublicVisualBrief } from "@/utils/publicVisualBrief";

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function analyzeBook(
  structure: BookStructure,
  apiKey: string,
  onProgress?: AnalysisProgressReporter
): Promise<SemanticMap> {
  const report = makeProgressReporter(onProgress);

  report({
    phase: "preparing",
    message: `Reading "${structure.title}" to choose the right analysis path…`,
    percent: 2,
  });

  const workProtocol = await resolveWorkProtocol(structure, apiKey, report);
  if (workProtocol.protocol === "expository") {
    report({
      phase: "preparing",
      message: `Expository work — mapping ideas and diagrams for "${structure.title}"…`,
      percent: 5,
      analysisProtocol: "expository",
    });
    return analyzeExpositoryBook(structure, apiKey, workProtocol, report);
  }

  report({
    phase: "preparing",
    message: `Narrative work — mapping story and emotional arc for "${structure.title}"…`,
    percent: 5,
    analysisProtocol: "narrative",
  });

  return analyzeNarrativeBook(structure, apiKey, report, workProtocol);
}

async function analyzeNarrativeBook(
  structure: BookStructure,
  apiKey: string,
  baseReport: AnalysisProgressReporter,
  workProtocol: Awaited<ReturnType<typeof resolveWorkProtocol>>
): Promise<SemanticMap> {
  const report: AnalysisProgressReporter = (progress) => {
    if (typeof progress === "string") {
      baseReport({ phase: "preparing", message: progress, percent: 0, analysisProtocol: "narrative" });
      return;
    }
    baseReport({ ...progress, analysisProtocol: progress.analysisProtocol ?? "narrative" });
  };

  let analysisStructure = storyOnlyStructure(structure);
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

  if (isGutenbergEdition(analysisStructure.editionPipeline)) {
    analysisStructure = refreshGutenbergStructureSections(analysisStructure);
    report({
      phase: "mapping",
      message: "Mapping emotional turns onto scene breaks and headings…",
      percent: 40,
    });
  } else {
    report({
      phase: "mapping",
      message: "Mapping the book's emotional arc…",
      percent: 40,
    });
  }

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
  report({ phase: "blueprint" as unknown as "mapping", message: "Building narrative thread blueprint…", percent: 42 });
  const narrativeBlueprint = await buildNarrativeBlueprint({
    structure: analysisStructure,
    macroArc,
    apiKey,
    onProgress: report,
  });

  // Pass 2: Scene identification at each inflection
  const scenes = await identifyScenes(analysisStructure, macroArc, shapeResult, apiKey, report);

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

  // One visual anchor per parser chapter (Gutenberg NCX backbone).
  const chapterPlan = buildVisualSlotPlan(
    analysisStructure,
    macroArc,
    annotatedScenes,
    (chapter, s, arc) => buildPlannedChapterScene(chapter, s, arc, shapeResult)
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

  const beatsBySceneId = new Map(storyboard.beats.map((beat) => [beat.sceneId, beat]));
  const scenesForRoadmap = plannedScenes.map((scene) => {
    const beat = beatsBySceneId.get(scene.id);
    const isDirected = Boolean(scene.directorBrief);
    return {
      ...scene,
      visualSlotKey: scene.visualSlotKey ?? scene.chapterId,
      visualPreparationState: isDirected ? "directed" as const : "planned" as const,
      publicVisualBrief: scene.publicVisualBrief ?? buildPublicVisualBrief(scene, beat),
    };
  });

  return {
    bookId: analysisStructure.bookId,
    visualPlanVersion: VISUAL_PLAN_VERSION,
    analysisProtocol: "narrative",
    workType: workProtocol.workType,
    arcShape: macroArc.arcShape,
    inflectionPoints: macroArc.inflectionPoints,
    scenes: scenesForRoadmap,
    goldenNumber,
    analyzedAt: new Date().toISOString(),
    storyboard,
    narrativeBlueprint,
  };
}

function buildPlannedChapterScene(
  chapter: BookStructure["chapters"][0],
  structure: BookStructure,
  macroArc: MacroArc,
  shapeResult: StoryShapeResult
): IdentifiedScene {
  const anchor = pickSceneAnchor(chapter, structure.editionPipeline, {
    chapterSentiment: shapeResult.sentimentScores[chapter.index],
    prevSentiment: shapeResult.sentimentScores[chapter.index - 1],
    nextSentiment: shapeResult.sentimentScores[chapter.index + 1],
  });

  const plannedBeat: InflectionPoint = {
    id: `planned_chapter_${chapter.index}`,
    approximateChapterIndex: chapter.index,
    emotionalShift: macroArc.dominantEmotions.slice(0, 2).join(", ") || "emotional transition",
    significance: 0.35,
    narrativeLabel: chapter.title,
  };
  const scene = buildFallbackScene(
    chapter,
    structure,
    `planned_chapter_${chapter.index}`,
    plannedBeat,
    shapeResult
  );

  return {
    ...scene,
    id: `scene_planned_${structure.bookId}_${chapter.id}`,
    inflectionPointId: `planned_chapter_${chapter.index}`,
    sectionId: anchor.sectionId,
    anchor: {
      href: chapter.href,
      fragment: chapter.fragment,
      spineIndex: chapter.spineIndex,
      wordOffset: anchor.wordOffset,
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
    const parsed = await llmGenerateJSON<{ dominantEmotions?: string[]; centralThemes?: string[] }>("reading", prompt, {
      temperature: 0.7,
      maxTokens: 256,
      geminiKey: apiKey,
    });
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
  shapeResult: StoryShapeResult,
  apiKey: string,
  onProgress?: AnalysisProgressReporter
): Promise<IdentifiedScene[]> {
  if (getProvider() === "odysseus") {
    try {
      return await identifyScenesParallel(structure, macroArc, shapeResult, onProgress);
    } catch (err) {
      console.warn("[Semantic] Parallel scene identification failed, falling back to sequential:", err);
    }
  }

  const scenes: IdentifiedScene[] = [];
  const usedSlotKeys = new Set<string>();
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
    const scene = await identifyOpeningScene(openingChapter, structure, shapeResult, apiKey).catch((err) => {
      console.warn("[Semantic] Opening scene identification failed, using fallback:", err);
      return buildFallbackScene(openingChapter, structure, "opening", undefined, shapeResult);
    });
    scenes.push(scene);
    usedSlotKeys.add(openingChapter.id);
  }

  // One inflection scene per parser chapter.
  for (let i = 0; i < macroArc.inflectionPoints.length; i++) {
    const point = macroArc.inflectionPoints[i];
    const chapter = structure.chapters[point.approximateChapterIndex];
    if (!chapter || usedSlotKeys.has(chapter.id)) continue;
    onProgress?.({
      phase: "scenes",
      message: `Finding key scene ${i + 1} of ${macroArc.inflectionPoints.length}…`,
      percent: 48 + Math.round(((i + 1) / Math.max(1, macroArc.inflectionPoints.length)) * 17),
      current: i + 2,
      total: totalScenes,
      itemLabel: chapter.title,
    });

    const scene = await identifySceneForInflection(chapter, point, structure, shapeResult, apiKey).catch((err) => {
      console.warn("[Semantic] Inflection scene identification failed, using fallback:", err);
      return buildFallbackScene(chapter, structure, point.id, point, shapeResult);
    });
    scenes.push(scene);
    usedSlotKeys.add(chapter.id);
  }

  return scenes;
}

async function identifyScenesParallel(
  structure: BookStructure,
  macroArc: MacroArc,
  shapeResult: StoryShapeResult,
  onProgress?: AnalysisProgressReporter
): Promise<IdentifiedScene[]> {
  type SceneMeta = {
    chapter: BookStructure["chapters"][0];
    inflectionPoint?: InflectionPoint;
    isOpening: boolean;
  };

  const tasks: OdysseusParallelTask[] = [];
  const taskMeta = new Map<string, SceneMeta>();
  const usedChapterIds = new Set<string>();

  const openingChapter = structure.chapters[0];
  if (openingChapter) {
    const taskId = "scene-opening";
    tasks.push({
      id: taskId,
      agent: "reading",
      prompt: `Analyze the symbolic and atmospheric opening of "${structure.title}".

Opening text:
${truncateText(openingChapter.rawText || "", 500)}

Extract the emotional and symbolic essence — NOT a plot summary.
Think like a symbolist painter. What is the emotional atmosphere? What symbols are present or implied?

JSON response:
{
  "emotionalVector": ["emotion1", "emotion2"],
  "symbolicMotifs": ["motif1", "motif2", "motif3"],
  "atmosphericQualities": ["quality1", "quality2"],
  "narrativeWeight": 0.7
}`,
      temperature: 0.7,
      max_tokens: 512,
    });
    taskMeta.set(taskId, { chapter: openingChapter, isOpening: true });
    usedChapterIds.add(openingChapter.id);
  }

  for (let i = 0; i < macroArc.inflectionPoints.length; i++) {
    const point = macroArc.inflectionPoints[i];
    const chapter = structure.chapters[point.approximateChapterIndex];
    if (!chapter || usedChapterIds.has(chapter.id)) continue;
    usedChapterIds.add(chapter.id);

    const taskId = `scene-inflection-${i}`;
    tasks.push({
      id: taskId,
      agent: "reading",
      prompt: `You are identifying the symbolic visual essence of a key emotional moment in "${structure.title}".

Chapter: "${chapter.title}" (Chapter ${chapter.index + 1})
Emotional transition: "${point.emotionalShift}"
Narrative role: "${point.narrativeLabel}"

Chapter text:
${truncateText(chapter.rawText || "", 700)}

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
}`,
      temperature: 0.7,
      max_tokens: 512,
    });
    taskMeta.set(taskId, { chapter, inflectionPoint: point, isOpening: false });
  }

  if (tasks.length === 0) return [];

  onProgress?.({
    phase: "scenes",
    message: `Analyzing ${tasks.length} scenes one at a time…`,
    percent: 45,
    current: 0,
    total: tasks.length,
  });

  const parallelResult = await runOdysseusSequential({
    workflow: {
      type: "scene-analysis",
      label: `Scene identification — ${structure.title}`,
      task_goal: `Identify symbolic scenes for ${tasks.length} key emotional moments`,
      context: {
        book_title: structure.title,
        inflection_count: macroArc.inflectionPoints.length,
        task_count: tasks.length,
      },
    },
    tasks,
  }, ({ completed, total }) => {
    onProgress?.({
      phase: "scenes",
      message: `Analyzing scenes — ${completed}/${total}…`,
      percent: 45 + Math.round((completed / Math.max(1, total)) * 20),
      current: completed,
      total,
    });
  });

  onProgress?.({
    phase: "scenes",
    message: `Scene analysis complete — building ${tasks.length} scenes…`,
    percent: 65,
    current: tasks.length,
    total: tasks.length,
  });

  const scenes: IdentifiedScene[] = [];

  for (const result of parallelResult.results) {
    const meta = taskMeta.get(result.id);
    if (!meta) continue;
    const { chapter, inflectionPoint, isOpening } = meta;

    let parsed: Partial<IdentifiedScene> = {};
    if (result.status === "done" && result.content) {
      try {
        const cleaned = result.content.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]) as Partial<IdentifiedScene>;
      } catch {
        // will use fallback fields below
      }
    }

    if (isOpening) {
      const anchor = pickSceneAnchor(chapter, structure.editionPipeline, {
        atOpening: true,
        chapterSentiment: shapeResult.sentimentScores[chapter.index],
        nextSentiment: shapeResult.sentimentScores[chapter.index + 1],
      });
      scenes.push({
        id: `scene_opening_${structure.bookId}_${chapter.id}`,
        inflectionPointId: "opening",
        chapterId: chapter.id,
        sectionId: anchor.sectionId,
        anchorCfi: "",
        anchor: { href: chapter.href, fragment: chapter.fragment, spineIndex: chapter.spineIndex, wordOffset: anchor.wordOffset },
        emotionalVector: (parsed.emotionalVector as string[]) || [],
        symbolicMotifs: (parsed.symbolicMotifs as string[]) || [],
        atmosphericQualities: (parsed.atmosphericQualities as string[]) || [],
        narrativeWeight: (parsed.narrativeWeight as number) || 0.7,
      });
    } else if (inflectionPoint) {
      const anchor = pickSceneAnchor(chapter, structure.editionPipeline, {
        inflectionPoint,
        chapterSentiment: shapeResult.sentimentScores[chapter.index],
        prevSentiment: shapeResult.sentimentScores[chapter.index - 1],
        nextSentiment: shapeResult.sentimentScores[chapter.index + 1],
        standardRatio: 0.35,
      });
      scenes.push({
        id: `scene_${inflectionPoint.id}_${chapter.id}`,
        inflectionPointId: inflectionPoint.id,
        chapterId: chapter.id,
        sectionId: anchor.sectionId,
        anchorCfi: "",
        anchor: { href: chapter.href, fragment: chapter.fragment, spineIndex: chapter.spineIndex, wordOffset: anchor.wordOffset },
        emotionalVector: (parsed.emotionalVector as string[]) || [],
        symbolicMotifs: (parsed.symbolicMotifs as string[]) || [],
        atmosphericQualities: (parsed.atmosphericQualities as string[]) || [],
        narrativeWeight: (parsed.narrativeWeight as number) || 0.5,
      });
    }
  }

  // Fallback for any failed tasks
  for (const result of parallelResult.results.filter((r) => r.status !== "done")) {
    const meta = taskMeta.get(result.id);
    if (!meta) continue;
    const { chapter, inflectionPoint, isOpening } = meta;
    scenes.push(
      isOpening
        ? buildFallbackScene(chapter, structure, "opening", undefined, shapeResult)
        : buildFallbackScene(chapter, structure, inflectionPoint!.id, inflectionPoint, shapeResult)
    );
  }

  return scenes;
}

function buildFallbackScene(
  chapter: BookStructure["chapters"][0],
  structure: BookStructure,
  inflectionPointId: string,
  inflectionPoint?: InflectionPoint,
  shapeResult?: StoryShapeResult
): IdentifiedScene {
  const anchor = pickSceneAnchor(chapter, structure.editionPipeline, {
    atOpening: inflectionPointId === "opening",
    inflectionPoint,
    chapterSentiment: shapeResult?.sentimentScores[chapter.index],
    prevSentiment: shapeResult?.sentimentScores[chapter.index - 1],
    nextSentiment: shapeResult?.sentimentScores[chapter.index + 1],
    standardRatio: inflectionPoint ? 0.35 : 0,
  });

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
    sectionId: anchor.sectionId,
    anchorCfi: "",
    anchor: {
      href: chapter.href,
      fragment: chapter.fragment,
      spineIndex: chapter.spineIndex,
      wordOffset: anchor.wordOffset,
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
  shapeResult: StoryShapeResult,
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

  const parsed = await llmGenerateJSON<Partial<IdentifiedScene>>("reading", prompt, {
    temperature: 0.7,
    maxTokens: 512,
    geminiKey: apiKey,
  });

  const openingAnchor = pickSceneAnchor(chapter, structure.editionPipeline, {
    atOpening: true,
    chapterSentiment: shapeResult.sentimentScores[chapter.index],
    nextSentiment: shapeResult.sentimentScores[chapter.index + 1],
  });

  return {
    id: `scene_opening_${structure.bookId}_${chapter.id}`,
    inflectionPointId: "opening",
    chapterId: chapter.id,
    sectionId: openingAnchor.sectionId,
    anchorCfi: "",
    anchor: {
      href: chapter.href,
      fragment: chapter.fragment,
      spineIndex: chapter.spineIndex,
      wordOffset: openingAnchor.wordOffset,
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
  shapeResult: StoryShapeResult,
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

  const parsed = await llmGenerateJSON<Partial<IdentifiedScene>>("reading", prompt, {
    temperature: 0.7,
    maxTokens: 512,
    geminiKey: apiKey,
  });

  const inflectionAnchor = pickSceneAnchor(chapter, structure.editionPipeline, {
    inflectionPoint,
    chapterSentiment: shapeResult.sentimentScores[chapter.index],
    prevSentiment: shapeResult.sentimentScores[chapter.index - 1],
    nextSentiment: shapeResult.sentimentScores[chapter.index + 1],
    standardRatio: 0.35,
  });

  return {
    id: `scene_${inflectionPoint.id}_${chapter.id}`,
    inflectionPointId: inflectionPoint.id,
    chapterId: chapter.id,
    sectionId: inflectionAnchor.sectionId,
    anchorCfi: "",
    anchor: {
      href: chapter.href,
      fragment: chapter.fragment,
      spineIndex: chapter.spineIndex,
      wordOffset: inflectionAnchor.wordOffset,
    },
    emotionalVector: (parsed.emotionalVector as string[]) || [],
    symbolicMotifs: (parsed.symbolicMotifs as string[]) || [],
    atmosphericQualities: (parsed.atmosphericQualities as string[]) || [],
    narrativeWeight: (parsed.narrativeWeight as number) || 0.5,
  };
}

// ─── Pass 3: Image Description ────────────────────────────────────────────────

async function generateImageDescriptions(
  scenes: IdentifiedScene[],
  macroArc: MacroArc,
  bookTitle: string,
  apiKey: string,
  onProgress?: AnalysisProgressReporter
): Promise<IdentifiedScene[]> {
  if (getProvider() === "odysseus") {
    try {
      return await generateImageDescriptionsParallel(scenes, macroArc, bookTitle, onProgress);
    } catch (err) {
      console.warn("[Semantic] Parallel image descriptions failed, falling back to sequential:", err);
    }
  }

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
      result.push({ ...scene, imageDescription: buildFallbackDescription(scene, macroArc) });
    }
  }

  return result;
}

async function generateImageDescriptionsParallel(
  scenes: IdentifiedScene[],
  macroArc: MacroArc,
  bookTitle: string,
  onProgress?: AnalysisProgressReporter
): Promise<IdentifiedScene[]> {
  const tasks: OdysseusParallelTask[] = scenes.map((scene, i) => ({
    id: `desc-${i}`,
    agent: "visual_analyst",
    prompt: `You are writing a 2-4 sentence image generation prompt for a symbolic, atmospheric painting.
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

Respond with ONLY the prompt text, no JSON, no quotes, no explanation.`,
    temperature: 0.85,
    max_tokens: 300,
  }));

  onProgress?.({
    phase: "prompts",
    message: `Writing ${scenes.length} visual briefs one at a time…`,
    percent: 68,
    current: 0,
    total: scenes.length,
  });

  const parallelResult = await runOdysseusSequential({
    workflow: {
      type: "visual-briefs",
      label: `Visual briefs — ${bookTitle}`,
      task_goal: `Generate ${scenes.length} symbolic image prompts`,
      context: { book_title: bookTitle, scene_count: scenes.length },
    },
    tasks,
  }, ({ completed, total }) => {
    onProgress?.({
      phase: "prompts",
      message: `Writing visual briefs — ${completed}/${total}…`,
      percent: 68 + Math.round((completed / Math.max(1, total)) * 17),
      current: completed,
      total,
    });
  });

  onProgress?.({
    phase: "prompts",
    message: `Visual briefs complete.`,
    percent: 85,
    current: scenes.length,
    total: scenes.length,
  });

  return scenes.map((scene, i) => {
    const result = parallelResult.results.find((r) => r.id === `desc-${i}`);
    const description =
      result?.status === "done" && result.content?.trim()
        ? result.content.trim()
        : buildFallbackDescription(scene, macroArc);
    return { ...scene, imageDescription: description };
  });
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

  return (await llmGenerate("visual_analyst", prompt, {
    temperature: 0.85,
    maxTokens: 300,
    geminiKey: apiKey,
  })).trim();
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

function truncateText(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + "…";
}
