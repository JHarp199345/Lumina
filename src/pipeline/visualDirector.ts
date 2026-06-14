import { llmGenerateJSON } from "@/api/llmClient";
import { findRelevantLoreEntities, formatLoreForPrompt } from "@/pipeline/visualLore";
import { loreForBook } from "@/utils/bookIsolation";
import { computeSceneWordPosition } from "@/utils/scenePosition";
import type {
  AnalysisProgressReporter,
  BookStructure,
  CameraDistance,
  IdentifiedScene,
  MomentFunction,
  MotionLevel,
  SemanticMap,
  StyleSeed,
  SubjectFocus,
  VisualDirectorBrief,
  VisualPerspective,
  VisualStrategy,
  SceneBlockingMap,
  SceneElementRole,
  VisualBeat,
  VisualLoreEntity,
} from "@/types";

const MOMENT_FUNCTIONS: MomentFunction[] = [
  "threshold",
  "transformation",
  "loss_of_innocence",
  "promise_made",
  "promise_delivered",
  "promise_broken",
  "betrayal",
  "collision",
  "sacrifice",
  "cost_of_triumph",
  "revelation",
  "recognition",
  "moral_choice",
  "dread",
  "temptation",
  "grief",
  "isolation",
  "gathering",
  "aftermath",
  "return",
  "suspense",
  "opening_world",
];

const VISUAL_STRATEGIES: VisualStrategy[] = [
  "literal_iconic",
  "ritualized_action",
  "symbolic_abstraction",
  "object_centered",
  "threshold_composition",
  "emotional_landscape",
  "environmental_pressure",
  "aftermath_tableau",
  "anticipation_frame",
  "scale_contrast",
  "character_silhouette",
  "negative_space",
  "rare_aerial",
];

const PERSPECTIVES: VisualPerspective[] = [
  "intimate_close",
  "medium_human_scale",
  "wide_establishing",
  "solitary_figure_against_scale",
  "low_angle",
  "high_angle",
  "rare_aerial",
  "object_perspective",
  "over_the_shoulder",
  "silhouette_from_behind",
  "environment_first",
  "negative_space_dominant",
];

const SUBJECT_FOCI: SubjectFocus[] = [
  "person",
  "object",
  "place",
  "crowd_or_mass",
  "threshold",
  "natural_force",
  "symbolic_motif",
  "aftermath",
  "absence",
];

const MOTION_LEVELS: MotionLevel[] = [
  "completely_still",
  "potential_energy",
  "slow_movement",
  "purposeful_motion",
  "rushing",
  "violent_collision",
  "settling_aftermath",
  "exhausted_stillness",
];

const CAMERA_DISTANCES: CameraDistance[] = [
  "extreme_close",
  "close",
  "medium",
  "medium_wide",
  "wide",
  "extreme_wide",
];

const SCENE_ELEMENT_ROLES: SceneElementRole[] = [
  "primary_subject",
  "secondary_subject",
  "threat",
  "ally",
  "opposing_force",
  "contested_object",
  "environment",
  "symbolic_accent",
  "motion_group",
];

interface DiversityMemory {
  recentStrategies: VisualStrategy[];
  recentPerspectives: VisualPerspective[];
  recentSubjects: SubjectFocus[];
  recentMotion: MotionLevel[];
  recentDominantEmotions: string[];
  aerialViewUsed: boolean;
}

// Cross-image continuity: a payoff image is told what its setup image showed,
// so it can echo the recurring motif and the reader feels the callback.
interface ThreadEcho {
  threadLabel: string;
  role: NonNullable<IdentifiedScene["threadRole"]>;
  motif: string;
  mode: "plant" | "echo";
  priorFocalPoint?: string;
  priorAnchors?: string[];
}

function buildThreadEcho(
  scene: IdentifiedScene,
  threadHistory: Map<string, { scene: IdentifiedScene; brief: VisualDirectorBrief }[]>
): ThreadEcho | undefined {
  if (!scene.threadId || !scene.threadRole) return undefined;
  const motif = scene.threadMotif ?? "";
  const prior = threadHistory.get(scene.threadId) ?? [];

  // Setup/build images plant the motif. Payoff/cost/echo images call it back.
  if (scene.threadRole === "setup" || scene.threadRole === "build") {
    return { threadLabel: scene.threadLabel ?? "", role: scene.threadRole, motif, mode: "plant" };
  }

  const setup = prior.find((p) => p.scene.threadRole === "setup") ?? prior[0];
  return {
    threadLabel: scene.threadLabel ?? "",
    role: scene.threadRole,
    motif,
    mode: prior.length ? "echo" : "plant",
    priorFocalPoint: setup?.brief.blocking?.focalPoint,
    priorAnchors: setup?.brief.concreteAnchors,
  };
}

export async function createVisualDirectorBriefs(params: {
  semanticMap: SemanticMap;
  structure: BookStructure;
  styleSeed: StyleSeed;
  interpretationLevel: number;
  apiKey: string;
  onProgress?: AnalysisProgressReporter;
}): Promise<IdentifiedScene[]> {
  const briefs: VisualDirectorBrief[] = [];
  const scenes: IdentifiedScene[] = [];
  // Per-thread record of what each setup image actually showed, so later
  // payoff images on the same thread can echo it.
  const threadHistory = new Map<string, { scene: IdentifiedScene; brief: VisualDirectorBrief }[]>();
  const scenesToDirect = params.semanticMap.scenes.filter((scene) => {
    const beat = params.semanticMap.storyboard?.beats.find((item) => item.sceneId === scene.id);
    return beat?.generationIntent !== "planned_only";
  });

  for (let i = 0; i < params.semanticMap.scenes.length; i++) {
    const scene = params.semanticMap.scenes[i];
    const beat = params.semanticMap.storyboard?.beats.find((item) => item.sceneId === scene.id);
    if (beat?.generationIntent === "planned_only") {
      scenes.push(scene);
      continue;
    }
    const directedIndex = scenesToDirect.findIndex((item) => item.id === scene.id);
    params.onProgress?.({
      phase: "prompts",
      message: `Directing visual scene ${directedIndex + 1} of ${scenesToDirect.length}…`,
      percent: 86 + Math.round(((directedIndex + 1) / Math.max(1, scenesToDirect.length)) * 8),
      current: directedIndex + 1,
      total: scenesToDirect.length,
      itemLabel: getSceneChapter(params.structure, scene)?.title,
    });

    const threadEcho = buildThreadEcho(scene, threadHistory);

    const brief = await createVisualDirectorBrief({
      scene,
      semanticMap: params.semanticMap,
      structure: params.structure,
      styleSeed: params.styleSeed,
      interpretationLevel: params.interpretationLevel,
      recentBriefs: briefs,
      threadEcho,
      apiKey: params.apiKey,
    });

    briefs.push(brief);
    if (scene.threadId) {
      const list = threadHistory.get(scene.threadId) ?? [];
      list.push({ scene, brief });
      threadHistory.set(scene.threadId, list);
    }
    scenes.push({
      ...scene,
      directorBrief: brief,
      imageDescription: brief.finalPrompt,
    });
  }

  return scenes;
}

export async function createVisualDirectorBrief(params: {
  scene: IdentifiedScene;
  semanticMap: SemanticMap;
  structure: BookStructure;
  styleSeed: StyleSeed;
  interpretationLevel: number;
  recentBriefs: VisualDirectorBrief[];
  threadEcho?: ThreadEcho;
  apiKey: string;
}): Promise<VisualDirectorBrief> {
  const nearbyText = getNearbyText(params.structure, params.scene, 700);
  const memory = buildDiversityMemory(params.recentBriefs);
  const beat = params.semanticMap.storyboard?.beats.find((item) => item.sceneId === params.scene.id);
  // Isolation guard: only ever ground a brief in lore built for THIS book.
  // A foreign dossier (wrong bookId) is the proven cross-book contamination
  // carrier, so it is dropped here before it can reach the prompt.
  const sceneWordPosition = computeSceneWordPosition(params.scene, params.structure.chapters);
  const loreEntities = findRelevantLoreEntities(
    loreForBook(params.semanticMap.visualLore, params.semanticMap.bookId),
    `${params.scene.imageDescription ?? ""}\n${params.scene.symbolicMotifs.join(" ")}\n${nearbyText}`,
    5,
    sceneWordPosition
  );
  const prompt = buildDirectorPrompt({ ...params, nearbyText, memory, beat, loreEntities });

  try {
    const parsed = await llmGenerateJSON<Partial<VisualDirectorBrief>>("visual_analyst", prompt, {
      temperature: 0.65,
      maxTokens: 1600,
      geminiKey: params.apiKey,
    });
    return normalizeBrief(parsed, params, nearbyText, memory);
  } catch (err) {
    console.warn("[VisualDirector] Brief generation failed, using fallback:", err);
    return buildFallbackBrief(params, nearbyText, memory);
  }
}

export function buildDiversityMemory(briefs: VisualDirectorBrief[]): DiversityMemory {
  const recent = briefs.slice(-3);
  return {
    recentStrategies: recent.map((brief) => brief.visualStrategy),
    recentPerspectives: recent.map((brief) => brief.perspective),
    recentSubjects: recent.map((brief) => brief.subjectFocus),
    recentMotion: recent.map((brief) => brief.motionLevel),
    recentDominantEmotions: recent.map((brief) => brief.dominantEmotion).filter(Boolean),
    aerialViewUsed: briefs.some((brief) => brief.perspective === "rare_aerial" || brief.visualStrategy === "rare_aerial"),
  };
}

function buildDirectorPrompt(params: {
  scene: IdentifiedScene;
  semanticMap: SemanticMap;
  structure: BookStructure;
  styleSeed: StyleSeed;
  interpretationLevel: number;
  recentBriefs: VisualDirectorBrief[];
  threadEcho?: ThreadEcho;
  nearbyText: string;
  memory: DiversityMemory;
  beat?: VisualBeat;
  loreEntities: VisualLoreEntity[];
}): string {
  const chapter = getSceneChapter(params.structure, params.scene);
  const interpretation = getInterpretationInstruction(params.interpretationLevel);
  const diversity = getDiversityInstruction(params.memory);
  const loreContext = formatLoreForPrompt(params.loreEntities);
  const threadDirection = getThreadInstruction(params.threadEcho);

  return `You are Lumina's Visual Director. Create a precise JSON visual brief for a generated image that accompanies a reader at a specific book moment.

CORE PRODUCT DIRECTION:
- Lumina is depictive first, symbolic second.
- Depict the actual book scene clearly enough that the reader feels they are seeing the moment.
- Do not make the image vague or purely abstract unless the reader's level explicitly asks for that.
- Use cinematic direction: choose the best instant, camera angle, subject focus, composition, and energy.
- Add symbolic emphasis only to strengthen the depicted scene, not to replace it.
- Avoid lazy repetition. Vary perspective, motion, subject focus, and emotional register.
- Build a scene blocking map before writing the prompt: identify the important visual elements,
  where they are in the frame, how they relate physically, which object or figure is the focal
  point, and what motion or stillness defines each element.
- Honor the visual beat. Setup and mystery beats should plant readable elements. Suspense beats
  should increase pressure. Payoff beats should deliver clear events. Cost and aftermath beats
  should show consequence and let the sequence breathe.

BOOK:
Title: ${params.structure.title}
Author: ${params.structure.author}
Arc shape: ${params.semanticMap.arcShape}
Total chapters: ${params.structure.chapters.length}

THIS SCENE:
Chapter: ${chapter?.title ?? params.scene.chapterId}
Scene emotional vectors: ${params.scene.emotionalVector.join(", ")}
Scene symbolic motifs: ${params.scene.symbolicMotifs.join(", ")}
Scene atmospheric qualities: ${params.scene.atmosphericQualities.join(", ")}
Narrative weight: ${params.scene.narrativeWeight}
Visual beat: ${params.beat?.beatType ?? "unclassified"}
Arc position: ${params.beat ? Math.round(params.beat.arcPosition * 100) : "unknown"}%
Beat purpose: ${params.beat?.emotionalPurpose ?? "Support this selected visual moment."}
Pacing note: ${params.beat?.pacingNote ?? "Keep this image distinct from surrounding images."}
Setup/payoff thread: ${params.beat?.setupPayoffThread ?? "none"}
Visual density: ${params.beat?.visualDensity ?? "moderate"}
Nearby source text:
${params.nearbyText}

STYLE SEED:
${params.styleSeed.name}
${params.styleSeed.promptFragment}
Palette foundation: ${params.styleSeed.paletteKeywords.join(", ")}

READER VISUAL LEVEL: ${params.interpretationLevel}/100
${interpretation}

NARRATIVE THREAD:
${threadDirection}

RENDERING VARIETY (framing only — never override the beat's intensity or emotional purpose):
${diversity}

GROUNDED VISUAL LORE:
${loreContext}

Use lore descriptors as broad visual grounding only. Select descriptors that actually matter to
this scene and weave them into the blocking map's element depictions. Do not copy a specific
public image, pose, official artwork composition, fan art composition, logo, or artist style.

JSON ONLY. Return exactly this shape:
{
  "momentFunction": one of ${JSON.stringify(MOMENT_FUNCTIONS)},
  "visualStrategy": one of ${JSON.stringify(VISUAL_STRATEGIES)},
  "perspective": one of ${JSON.stringify(PERSPECTIVES)},
  "cameraDistance": one of ${JSON.stringify(CAMERA_DISTANCES)},
  "subjectFocus": one of ${JSON.stringify(SUBJECT_FOCI)},
  "motionLevel": one of ${JSON.stringify(MOTION_LEVELS)},
  "emotionalTone": ["2-4 concrete emotional descriptors"],
  "dominantEmotion": "single strongest emotional word or phrase",
  "symbolicAnchors": ["2-4 symbolic accents"],
  "concreteAnchors": ["3-6 physical scene anchors from the text"],
  "blocking": {
    "stagingSummary": "plain language summary of who/what is where in the frame",
    "focalPoint": "the visual object, person, or confrontation the viewer's eye should land on",
    "elements": [
      {
        "id": "short_snake_case_id",
        "label": "visible element name",
        "role": one of ["primary_subject", "secondary_subject", "threat", "ally", "opposing_force", "contested_object", "environment", "symbolic_accent", "motion_group"],
        "depiction": "how this element should look, using concrete visual language",
        "placement": "foreground left, center, background right, encircling midground, etc.",
        "scale": "small, human scale, massive, distant, looming, etc.",
        "motion": "still, advancing, circling, recoiling, guarding, etc.",
        "visualPriority": 1-10
      }
    ],
    "relationships": [
      { "from": "element_id", "to": "element_id", "relation": "faces, surrounds, guards, threatens, reaches toward, flees from, etc." }
    ],
    "cameraLogic": "why this camera position best depicts the physical/emotional relationship"
  },
  "loreEntityNames": ["lore entities actually used in this scene"],
  "loreDescriptorsUsed": ["specific broad descriptors used, such as material, silhouette, color, motif"],
  "loreSourceUrlsUsed": ["source URLs used for provenance only; do not include URLs in image prompts"],
  "chapterContextWords": ["5-10 useful words from the nearby text"],
  "composition": "1-2 sentences describing the frame, subject placement, camera, action, and scale",
  "palette": ["3-5 color or material descriptors"],
  "lighting": "lighting direction and quality",
  "texture": "surface/material texture",
  "restraintRules": ["what to handle tastefully"],
  "avoidExplicitly": ["what must not appear"],
  "diversityNotes": "how this differs from recent images",
  "finalPrompt": "complete image prompt, depictive and scene-faithful, 90-150 words",
  "negativePrompt": "comma-separated negative prompt"
}`;
}

function getInterpretationInstruction(level: number): string {
  if (level < 40) {
    return "The reader prefers interpretive imagery. Keep concrete anchors, but reduce literal figures and action. Use object, place, atmosphere, and symbol.";
  }
  if (level < 60) {
    return "The reader prefers balanced imagery. Figures may be silhouette or gestural. The scene should be recognizable, but emotional composition may lead.";
  }
  if (level < 80) {
    return "The reader prefers illustrative imagery. Figures, action, setting, and important objects should be readable through the selected art style.";
  }
  return "The reader prefers depictive cinematic illustration. Depict the actual scene content with readable figures, action, setting, and important objects. Faces remain gestural rather than portrait-like. The image should feel scene-faithful, not vague.";
}

function getDiversityInstruction(memory: DiversityMemory): string {
  const notes: string[] = [];
  const overusedStrategy = findRepeated(memory.recentStrategies);
  const overusedPerspective = findRepeated(memory.recentPerspectives);
  const overusedSubject = findRepeated(memory.recentSubjects);
  const overusedMotion = findRepeated(memory.recentMotion);

  // These govern HOW the moment is framed — not what kind of moment it is.
  // The visual beat owns intensity and emotional purpose; variety only changes
  // camera, perspective, composition, and subject framing so two images of the
  // same beat type do not look identical.
  if (overusedStrategy) notes.push(`Vary the visual strategy — recently repeated: ${overusedStrategy}.`);
  if (overusedPerspective) notes.push(`Vary the camera perspective — recently repeated: ${overusedPerspective}.`);
  if (overusedSubject) notes.push(`Vary the subject framing — recently repeated: ${overusedSubject}.`);
  if (overusedMotion) notes.push(`Vary the motion framing — recently repeated: ${overusedMotion}.`);
  if (memory.aerialViewUsed) notes.push("Rare aerial view already used once. Do not reuse rare_aerial.");
  // Note recent emotions for awareness only — do NOT soften a payoff or cost
  // beat just because earlier images were intense. The beat decides intensity.
  if (memory.recentDominantEmotions.length) {
    notes.push(`Recent emotional registers (for variety awareness only, the beat still decides intensity): ${memory.recentDominantEmotions.join(", ")}.`);
  }

  return notes.length ? notes.join("\n") : "No prior images yet. Establish strong visual grammar for this book.";
}

function getThreadInstruction(echo?: ThreadEcho): string {
  if (!echo) {
    return "This image is not on a tracked setup→payoff thread. Compose it as a strong standalone moment.";
  }

  const motif = echo.motif ? `Recurring visual motif for this thread: "${echo.motif}".` : "";

  if (echo.mode === "plant") {
    return [
      `This image is a ${echo.role.toUpperCase()} on the thread "${echo.threadLabel}".`,
      motif,
      "Establish that motif clearly and memorably — a later image will pay it off, and the reader should recognize the callback when it does.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const priorParts: string[] = [];
  if (echo.priorFocalPoint) priorParts.push(`Its setup image focused on: ${echo.priorFocalPoint}.`);
  if (echo.priorAnchors?.length) priorParts.push(`Setup image anchors: ${echo.priorAnchors.slice(0, 4).join(", ")}.`);

  return [
    `This image is the ${echo.role.toUpperCase()} of the thread "${echo.threadLabel}".`,
    motif,
    ...priorParts,
    "Deliberately echo the thread's motif from the setup image so the reader feels the payoff land. Recompose it — do not copy the setup's framing — but carry the recognizable visual element forward.",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeBrief(
  raw: Partial<VisualDirectorBrief>,
  params: {
    scene: IdentifiedScene;
    semanticMap: SemanticMap;
    structure: BookStructure;
    styleSeed: StyleSeed;
    interpretationLevel: number;
  },
  nearbyText: string,
  memory: DiversityMemory
): VisualDirectorBrief {
  const fallback = buildFallbackBrief(params, nearbyText, memory);
  const brief: VisualDirectorBrief = {
    ...fallback,
    ...raw,
    sceneId: params.scene.id,
    bookId: params.semanticMap.bookId,
    generatedAt: new Date().toISOString(),
    interpretationLevel: params.interpretationLevel,
    momentFunction: enumOr(raw.momentFunction, MOMENT_FUNCTIONS, fallback.momentFunction),
    visualStrategy: enumOr(raw.visualStrategy, VISUAL_STRATEGIES, fallback.visualStrategy),
    perspective: enumOr(raw.perspective, PERSPECTIVES, fallback.perspective),
    cameraDistance: enumOr(raw.cameraDistance, CAMERA_DISTANCES, fallback.cameraDistance),
    subjectFocus: enumOr(raw.subjectFocus, SUBJECT_FOCI, fallback.subjectFocus),
    motionLevel: enumOr(raw.motionLevel, MOTION_LEVELS, fallback.motionLevel),
    emotionalTone: cleanArray(raw.emotionalTone, fallback.emotionalTone),
    symbolicAnchors: cleanArray(raw.symbolicAnchors, fallback.symbolicAnchors),
    concreteAnchors: cleanArray(raw.concreteAnchors, fallback.concreteAnchors),
    blocking: normalizeBlocking(raw.blocking, fallback.blocking),
    loreEntityNames: cleanArray(raw.loreEntityNames, fallback.loreEntityNames),
    loreDescriptorsUsed: cleanArray(raw.loreDescriptorsUsed, fallback.loreDescriptorsUsed),
    loreSourceUrlsUsed: cleanArray(
      raw.loreSourceUrlsUsed,
      params.semanticMap.visualLore?.entities
        .filter((entity) => briefUsesLoreEntity(raw, entity.name))
        .flatMap((entity) => entity.sourceUrls)
        .slice(0, 8) ?? fallback.loreSourceUrlsUsed
    ),
    chapterContextWords: cleanArray(raw.chapterContextWords, getContextWords(nearbyText)),
    palette: cleanArray(raw.palette, params.styleSeed.paletteKeywords),
    restraintRules: cleanArray(raw.restraintRules, fallback.restraintRules),
    avoidExplicitly: cleanArray(raw.avoidExplicitly, fallback.avoidExplicitly),
  };

  brief.finalPrompt = buildFinalImagePrompt(brief, params.styleSeed);
  brief.negativePrompt = buildNegativePrompt(brief, params.interpretationLevel, params.styleSeed);
  return brief;
}

function buildFallbackBrief(
  params: {
    scene: IdentifiedScene;
    semanticMap: SemanticMap;
    structure: BookStructure;
    styleSeed: StyleSeed;
    interpretationLevel: number;
  },
  nearbyText: string,
  memory: DiversityMemory
): VisualDirectorBrief {
  const chapter = getSceneChapter(params.structure, params.scene);
  const isOpening = params.scene.inflectionPointId === "opening";
  const strategy: VisualStrategy = isOpening
    ? "literal_iconic"
    : memory.recentPerspectives.includes("solitary_figure_against_scale")
      ? "object_centered"
      : "literal_iconic";
  const perspective: VisualPerspective = strategy === "object_centered"
    ? "object_perspective"
    : "medium_human_scale";
  const concreteAnchors = getConcreteAnchors(nearbyText, params.scene);
  const emotionalTone = params.scene.emotionalVector.length
    ? params.scene.emotionalVector.slice(0, 3)
    : ["tension", "resolve"];

  const brief: VisualDirectorBrief = {
    sceneId: params.scene.id,
    bookId: params.semanticMap.bookId,
    generatedAt: new Date().toISOString(),
    interpretationLevel: params.interpretationLevel,
    momentFunction: isOpening ? "opening_world" : inferMomentFunction(params.scene),
    visualStrategy: strategy,
    perspective,
    cameraDistance: "medium_wide",
    subjectFocus: strategy === "object_centered" ? "object" : "person",
    motionLevel: "purposeful_motion",
    emotionalTone,
    dominantEmotion: emotionalTone[0] ?? "tension",
    symbolicAnchors: params.scene.symbolicMotifs.slice(0, 4),
    concreteAnchors,
    blocking: buildFallbackBlocking(params.scene, concreteAnchors, strategy, perspective),
    loreEntityNames: [],
    loreDescriptorsUsed: [],
    loreSourceUrlsUsed: [],
    chapterContextWords: getContextWords(nearbyText),
    composition: `Depict the selected moment from "${chapter?.title ?? params.structure.title}" with readable scene content, clear action or subject focus, and a cinematic composition that preserves the emotional stakes.`,
    palette: params.styleSeed.paletteKeywords,
    lighting: params.scene.atmosphericQualities[0] ?? "dramatic directional light",
    texture: "painterly surface, tactile material detail",
    restraintRules: ["faces gestural rather than portrait-like", "emotion through posture and composition"],
    avoidExplicitly: ["photorealism", "readable text", "watermarks", "graphic gore"],
    diversityNotes: getDiversityInstruction(memory),
    finalPrompt: "",
    negativePrompt: "",
  };

  brief.finalPrompt = buildFinalImagePrompt(brief, params.styleSeed);
  brief.negativePrompt = buildNegativePrompt(brief, params.interpretationLevel, params.styleSeed);
  return brief;
}

function briefUsesLoreEntity(raw: Partial<VisualDirectorBrief>, entityName: string): boolean {
  const lower = entityName.toLowerCase();
  return [
    ...(Array.isArray(raw.loreEntityNames) ? raw.loreEntityNames : []),
    ...(Array.isArray(raw.loreDescriptorsUsed) ? raw.loreDescriptorsUsed : []),
    raw.finalPrompt,
    raw.composition,
  ]
    .filter((item): item is string => typeof item === "string")
    .some((item) => item.toLowerCase().includes(lower));
}

/**
 * Prompt format optimized for local SDXL/Flux models via ComfyUI.
 *
 * Cloud models (Imagen3, Gemini) understand structured prose — "camera logic:
 * medium human scale so the physical relationship is clear." Local diffusion
 * models attend to early tokens and work best with dense comma-separated
 * descriptors. Feeding them 400-word scene-direction prose produces generic output.
 *
 * This keeps the director's scene description as the lead, then appends a
 * tight tag list: subject, setting, mood, palette, light, style. Stays under
 * ~150 words so the local tokenizer doesn't dilute early content.
 */
export function buildComfyUIPrompt(brief: VisualDirectorBrief, styleSeed: StyleSeed): string {
  // Flux reads NATURAL LANGUAGE through its T5 encoder — it is NOT SDXL and does
  // NOT want comma-separated tag soup. Verified on-device: a dense ~180-220 word
  // evocative paragraph yields far more focused, detailed images than prose + a
  // tag tail, and Flux schnell is trained at ~256 tokens so going longer is wasted.
  // So we weave the director's scene prose, the richest element depictions, and
  // the style/light/palette/mood into ONE flowing paragraph — no tag dump, and no
  // "no text"/"no watermark" (those are negatives, which guidance-distilled schnell
  // ignores, and naming them in the positive can backfire).
  const lead = (brief.finalPrompt?.length ?? 0) > 80 ? brief.finalPrompt : brief.composition;

  const topElements = [...brief.blocking.elements]
    .sort((a, b) => b.visualPriority - a.visualPriority)
    .slice(0, 3)
    .map((el) => el.depiction.trim())
    .filter(Boolean);

  const sentences: string[] = [lead.trim(), ...topElements];

  const mood = [brief.dominantEmotion, ...brief.emotionalTone.slice(0, 2)].filter(Boolean);
  if (mood.length) sentences.push(`The mood is ${mood.join(", ")}.`);
  if (brief.lighting) sentences.push(`Lit by ${brief.lighting.trim()}.`);
  if (brief.palette?.length) sentences.push(`A palette of ${brief.palette.slice(0, 4).join(", ")}.`);
  if (styleSeed.promptFragment) sentences.push(`Rendered as ${styleSeed.promptFragment.trim()}.`);

  // Join as flowing prose; ensure each fragment ends with a period.
  return sentences
    .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildFinalImagePrompt(brief: VisualDirectorBrief, styleSeed: StyleSeed): string {
  const register =
    brief.interpretationLevel >= 80
      ? "Depictive cinematic illustration: the action, figures, setting, and important objects are legible and scene-faithful."
      : brief.interpretationLevel >= 60
        ? "Illustrative scene depiction filtered through the selected art style."
        : "Balanced interpretation with recognizable scene anchors and atmospheric emphasis.";

  return [
    brief.finalPrompt && brief.finalPrompt.length > 80 ? brief.finalPrompt : brief.composition,
    `Scene blocking: ${brief.blocking.stagingSummary}`,
    `Focal point: ${brief.blocking.focalPoint}. Camera logic: ${brief.blocking.cameraLogic}.`,
    `Element placement: ${[...brief.blocking.elements]
      .sort((a, b) => b.visualPriority - a.visualPriority)
      .slice(0, 6)
      .map((element) => `${element.label} (${element.role}) ${element.placement}, ${element.scale}, ${element.motion}: ${element.depiction}`)
      .join("; ")}.`,
    `Physical relationships: ${brief.blocking.relationships
      .slice(0, 8)
      .map((relationship) => `${relationship.from} ${relationship.relation} ${relationship.to}`)
      .join("; ")}.`,
    brief.loreDescriptorsUsed.length
      ? `Grounded lore descriptors used: ${brief.loreDescriptorsUsed.join(", ")}.`
      : "",
    `Concrete scene anchors: ${brief.concreteAnchors.join(", ")}.`,
    `Camera and composition: ${humanize(brief.perspective)}, ${humanize(brief.cameraDistance)}, ${humanize(brief.subjectFocus)} as the focus.`,
    `Motion: ${humanize(brief.motionLevel)}.`,
    `Emotional tone: ${brief.dominantEmotion}; ${brief.emotionalTone.join(", ")}.`,
    `Symbolic accents: ${brief.symbolicAnchors.join(", ")}.`,
    `Palette and light: ${brief.palette.join(", ")}; ${brief.lighting}. Texture: ${brief.texture}.`,
    styleSeed.promptFragment,
    `Palette foundation: ${styleSeed.paletteKeywords.join(", ")}.`,
    register,
    `Restraint: ${brief.restraintRules.join(", ")}. No readable text. No photorealism. Faces gestural, not portrait-like.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildNegativePrompt(
  brief: VisualDirectorBrief,
  level: number,
  styleSeed?: StyleSeed
): string {
  // Photorealistic seeds explicitly want photographs — their negatives are
  // paintings/cartoons, not "photorealistic". Use the seed's override if set.
  if (styleSeed?.negativePrompt) {
    return [...styleSeed.negativePrompt.split(",").map((s) => s.trim()), ...brief.avoidExplicitly].join(", ");
  }

  const base =
    styleSeed?.renderMode === "photorealistic"
      ? [
          "painting",
          "illustration",
          "cartoon",
          "anime",
          "manga",
          "watercolor",
          "sketch",
          "drawing",
          "3d render",
          "CGI",
          "low quality",
          "blurry",
          "plastic",
          "unrealistic",
        ]
      : [
          "photorealistic",
          "photograph",
          "celebrity likeness",
          "portrait photography",
          "readable text",
          "letters",
          "watermark",
          "logo",
          "graphic gore",
          "mutilation",
          "modern objects",
          "3d render",
          "CGI",
          "low quality",
        ];

  if (level < 60 && styleSeed?.renderMode !== "photorealistic") {
    base.push("clear faces", "literal portrait");
  }
  return [...base, ...brief.avoidExplicitly].join(", ");
}

/**
 * Three-pass prompt plan for iterative Flux refinement:
 *   Pass 1 — composition and mood (full denoise)
 *   Pass 2 — subject and material detail (img2img, moderate denoise)
 *   Pass 3 — lighting and atmosphere (img2img, light touch)
 *
 * Each pass focuses on one layer so the sampler isn't fighting to do
 * everything at once. Pass 2 and 3 preserve what came before and only
 * add what they specialize in.
 */
export function buildIterativePassPlan(
  brief: VisualDirectorBrief,
  styleSeed: StyleSeed
): { pass1: string; pass2: string; pass3: string } {
  // Pass 1: full scene — the same compact tag prompt we send to ComfyUI normally
  const pass1 = buildComfyUIPrompt(brief, styleSeed);

  // Pass 2: zoom in on the primary subject's material and surface detail.
  // The highest-priority element's depiction field is the richest per-element
  // visual text the director produced — exactly what we want to reinforce.
  const topElements = [...brief.blocking.elements]
    .sort((a, b) => b.visualPriority - a.visualPriority)
    .slice(0, 2);

  const pass2 = [
    ...topElements.map((el) => el.depiction).filter(Boolean),
    brief.blocking.focalPoint,
    ...brief.loreDescriptorsUsed.slice(0, 5),
    ...brief.concreteAnchors.slice(0, 4),
    ...brief.palette.slice(0, 3),
    "fine detail, sharp material texture, intricate surface",
    styleSeed.promptFragment,
  ]
    .filter(Boolean)
    .join(", ");

  // Pass 3: atmosphere and light polish — do not change composition, only add depth.
  const pass3 = [
    brief.dominantEmotion,
    brief.lighting,
    brief.texture,
    ...brief.emotionalTone.slice(0, 2),
    ...brief.palette,
    ...brief.symbolicAnchors.slice(0, 3),
    "atmospheric depth, ambient occlusion, volumetric light, color coherence",
    styleSeed.promptFragment,
  ]
    .filter(Boolean)
    .join(", ");

  return { pass1, pass2, pass3 };
}

function inferMomentFunction(scene: IdentifiedScene): MomentFunction {
  const terms = [...scene.emotionalVector, ...scene.symbolicMotifs, ...scene.atmosphericQualities].join(" ").toLowerCase();
  if (terms.match(/betray|broken trust/)) return "betrayal";
  if (terms.match(/grief|loss|mourning/)) return "grief";
  if (terms.match(/dread|fear|foreboding/)) return "dread";
  if (terms.match(/sacrifice|cost/)) return "sacrifice";
  if (terms.match(/reveal|truth/)) return "revelation";
  if (terms.match(/battle|war|collision|violence/)) return "collision";
  if (terms.match(/threshold|door|gate|choice/)) return "threshold";
  return "threshold";
}

function getSceneChapter(structure: BookStructure, scene: IdentifiedScene) {
  return (
    structure.chapters.find((chapter) => chapter.id === scene.chapterId) ??
    structure.chapters.find((chapter) => chapter.spineIndex === scene.anchor?.spineIndex)
  );
}

function getNearbyText(structure: BookStructure, scene: IdentifiedScene, maxWords: number): string {
  const chapter = getSceneChapter(structure, scene);
  if (!chapter?.rawText) return "";
  const words = chapter.rawText.split(/\s+/).filter(Boolean);
  const offset = Math.max(0, scene.anchor?.wordOffset ?? 0);
  const start = Math.max(0, offset - Math.floor(maxWords * 0.35));
  return words.slice(start, start + maxWords).join(" ");
}

function getContextWords(text: string): string[] {
  const stop = new Set(["the", "and", "that", "with", "from", "this", "were", "they", "there", "would", "could", "should", "into", "upon"]);
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9'\s-]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 4 && !stop.has(word))
        .slice(0, 12)
    )
  );
}

function getConcreteAnchors(text: string, scene: IdentifiedScene): string[] {
  const words = getContextWords(text);
  const motifs = scene.symbolicMotifs.filter((motif) => motif.length > 2);
  return Array.from(new Set([...words.slice(0, 5), ...motifs.slice(0, 2)])).slice(0, 6);
}

function buildFallbackBlocking(
  scene: IdentifiedScene,
  concreteAnchors: string[],
  strategy: VisualStrategy,
  perspective: VisualPerspective
): SceneBlockingMap {
  const primaryLabel = concreteAnchors[0] || scene.symbolicMotifs[0] || "primary figure";
  const secondaryLabel = concreteAnchors[1] || scene.symbolicMotifs[1] || "opposing presence";
  const focalPoint =
    strategy === "object_centered"
      ? primaryLabel
      : `${primaryLabel} facing ${secondaryLabel}`;

  return {
    stagingSummary: `A depictive composition stages ${primaryLabel} in relation to ${secondaryLabel}, with the key physical relationship clear before symbolic atmosphere is added.`,
    focalPoint,
    elements: [
      {
        id: "primary_subject",
        label: primaryLabel,
        role: strategy === "object_centered" ? "contested_object" : "primary_subject",
        depiction: "the clearest readable element in the scene, rendered with concrete detail from the passage",
        placement: perspective === "object_perspective" ? "foreground center" : "foreground or middle ground",
        scale: "visually dominant",
        motion: scene.inflectionPointId === "opening" ? "poised stillness" : "purposeful motion or charged stillness",
        visualPriority: 10,
      },
      {
        id: "opposing_presence",
        label: secondaryLabel,
        role: "opposing_force",
        depiction: "the main visual pressure or counterforce in the scene",
        placement: "opposite side of the frame or surrounding midground",
        scale: "larger or more numerous than the primary subject when the scene calls for threat",
        motion: "advancing, surrounding, or bearing down",
        visualPriority: 8,
      },
      {
        id: "environment",
        label: "environment",
        role: "environment",
        depiction: "the physical setting from the passage, used to clarify location and mood",
        placement: "background and atmospheric depth",
        scale: "surrounding",
        motion: "dust, light, weather, smoke, or texture moving through the frame",
        visualPriority: 5,
      },
    ],
    relationships: [
      { from: "primary_subject", to: "opposing_presence", relation: "faces" },
      { from: "opposing_presence", to: "primary_subject", relation: "threatens or pressures" },
      { from: "environment", to: "primary_subject", relation: "frames" },
    ],
    cameraLogic: `Use ${humanize(perspective)} so the physical relationship between the major elements is clear and the scene reads immediately.`,
  };
}

function normalizeBlocking(value: unknown, fallback: SceneBlockingMap): SceneBlockingMap {
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<SceneBlockingMap>;
  const elements = Array.isArray(raw.elements)
    ? raw.elements
        .map((item, index) => {
          if (!item || typeof item !== "object") return null;
          const element = item as unknown as Record<string, unknown>;
          return {
            id: typeof element.id === "string" && element.id ? element.id : `element_${index}`,
            label: typeof element.label === "string" && element.label ? element.label : `Element ${index + 1}`,
            role: enumOr(element.role, SCENE_ELEMENT_ROLES, "secondary_subject"),
            depiction: typeof element.depiction === "string" ? element.depiction : "visible scene element",
            placement: typeof element.placement === "string" ? element.placement : "middle ground",
            scale: typeof element.scale === "string" ? element.scale : "human scale",
            motion: typeof element.motion === "string" ? element.motion : "still",
            visualPriority:
              typeof element.visualPriority === "number"
                ? Math.max(1, Math.min(10, element.visualPriority))
                : Math.max(1, 10 - index),
          };
        })
        .filter((item): item is SceneBlockingMap["elements"][number] => Boolean(item))
        .slice(0, 10)
    : fallback.elements;
  const relationships = Array.isArray(raw.relationships)
    ? raw.relationships
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const relationship = item as unknown as Record<string, unknown>;
          if (typeof relationship.from !== "string" || typeof relationship.to !== "string") return null;
          return {
            from: relationship.from,
            to: relationship.to,
            relation: typeof relationship.relation === "string" ? relationship.relation : "relates to",
          };
        })
        .filter((item): item is SceneBlockingMap["relationships"][number] => Boolean(item))
        .slice(0, 12)
    : fallback.relationships;

  return {
    stagingSummary:
      typeof raw.stagingSummary === "string" && raw.stagingSummary.trim()
        ? raw.stagingSummary
        : fallback.stagingSummary,
    focalPoint:
      typeof raw.focalPoint === "string" && raw.focalPoint.trim()
        ? raw.focalPoint
        : fallback.focalPoint,
    elements: elements.length ? elements : fallback.elements,
    relationships: relationships.length ? relationships : fallback.relationships,
    cameraLogic:
      typeof raw.cameraLogic === "string" && raw.cameraLogic.trim()
        ? raw.cameraLogic
        : fallback.cameraLogic,
  };
}

function findRepeated<T extends string>(items: T[]): T | null {
  for (const item of items) {
    if (items.filter((candidate) => candidate === item).length >= 2) return item;
  }
  return null;
}

function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

function enumOr<T extends string>(value: unknown, options: T[], fallback: T): T {
  return typeof value === "string" && options.includes(value as T) ? (value as T) : fallback;
}

function cleanArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return cleaned.length ? cleaned.slice(0, 8) : fallback;
}
