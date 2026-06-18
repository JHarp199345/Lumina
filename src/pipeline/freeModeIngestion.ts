import { llmGenerateJSON } from "@/api/llmClient";
import { VISUAL_PLAN_VERSION } from "@/config/visualPlan";
import { storage } from "@/storage";
import type {
  AnalysisProgressReporter,
  ArcShape,
  BlackboardNote,
  BookStructure,
  IdentifiedScene,
  InflectionPoint,
  PublicVisualBrief,
  SemanticMap,
  VisualBeat,
} from "@/types";

const FREE_CHUNK_TARGET_CHARS = 14_000;
const LEDGER_VERSION = 1;
const LEDGER_TAG = "free-ingestion-ledger";

interface FreeIngestionChunk {
  chunkIndex: number;
  startChar: number;
  endChar: number;
  startChapterIndex: number;
  endChapterIndex: number;
  text: string;
}

interface FreeChunkArtifact {
  summary: string;
  emotionalTone: string[];
  themes: string[];
  entities: string[];
  visualMoment: {
    title: string;
    description: string;
    motifs: string[];
    atmosphere: string[];
  };
}

export interface FreeIngestionCheckpoint {
  bookId: string;
  ingestionRunId: string;
  chunkIndex: number;
  status: "completed" | "failed";
  startChar: number;
  endChar: number;
  startChapterIndex: number;
  endChapterIndex: number;
  summaryArtifactId?: string;
  entitiesArtifactId?: string;
  semanticMapArtifactId?: string;
  artifact?: FreeChunkArtifact;
  error?: string;
  completedAt?: string;
  updatedAt: string;
}

export async function analyzeBookFreeMode(
  structure: BookStructure,
  onProgress?: AnalysisProgressReporter
): Promise<SemanticMap> {
  const chunks = splitStructureForFreeIngestion(structure);
  const ingestionRunId = `free_${structure.bookId}_${hashText(`${structure.totalWords}:${chunks.length}`)}`;
  const existing = await loadFreeIngestionCheckpoints(structure.bookId, ingestionRunId);
  const completed = new Map(existing.filter((c) => c.status === "completed").map((c) => [c.chunkIndex, c]));

  onProgress?.({
    phase: "preparing",
    message: `Free mode ingestion: ${completed.size}/${chunks.length} chunks already saved.`,
    percent: 5,
  });

  for (const chunk of chunks) {
    if (completed.has(chunk.chunkIndex)) continue;
    onProgress?.({
      phase: "mapping",
      message: `Free mode ingestion: processing chunk ${chunk.chunkIndex + 1} of ${chunks.length}.`,
      percent: 8 + Math.round((chunk.chunkIndex / Math.max(1, chunks.length)) * 70),
      current: chunk.chunkIndex + 1,
      total: chunks.length,
    });

    try {
      const artifact = validateChunkArtifact(await analyzeFreeChunk(structure, chunk));
      const checkpoint: FreeIngestionCheckpoint = {
        bookId: structure.bookId,
        ingestionRunId,
        chunkIndex: chunk.chunkIndex,
        status: "completed",
        startChar: chunk.startChar,
        endChar: chunk.endChar,
        startChapterIndex: chunk.startChapterIndex,
        endChapterIndex: chunk.endChapterIndex,
        summaryArtifactId: freeArtifactId(ingestionRunId, chunk.chunkIndex, "summary"),
        entitiesArtifactId: freeArtifactId(ingestionRunId, chunk.chunkIndex, "entities"),
        semanticMapArtifactId: freeArtifactId(ingestionRunId, chunk.chunkIndex, "semantic"),
        artifact,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveFreeIngestionCheckpoint(checkpoint);
      completed.set(chunk.chunkIndex, checkpoint);
    } catch (err) {
      await saveFreeIngestionCheckpoint({
        bookId: structure.bookId,
        ingestionRunId,
        chunkIndex: chunk.chunkIndex,
        status: "failed",
        startChar: chunk.startChar,
        endChar: chunk.endChar,
        startChapterIndex: chunk.startChapterIndex,
        endChapterIndex: chunk.endChapterIndex,
        error: err instanceof Error ? err.message : String(err),
        updatedAt: new Date().toISOString(),
      });
      throw err;
    }
  }

  const ordered = chunks.map((chunk) => completed.get(chunk.chunkIndex)).filter(Boolean) as FreeIngestionCheckpoint[];
  onProgress?.({
    phase: "complete",
    message: "Free mode ingestion: merging saved chunk artifacts.",
    percent: 84,
    current: ordered.length,
    total: chunks.length,
  });

  const semanticMap = mergeFreeIngestionArtifacts(structure, ingestionRunId, ordered);
  await saveFreeIngestionCheckpoint({
    bookId: structure.bookId,
    ingestionRunId,
    chunkIndex: chunks.length,
    status: "completed",
    startChar: 0,
    endChar: structure.chapters.reduce((sum, chapter) => sum + chapterText(chapter).length, 0),
    startChapterIndex: 0,
    endChapterIndex: Math.max(0, structure.chapters.length - 1),
    semanticMapArtifactId: `${ingestionRunId}:final-map`,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return semanticMap;
}

export async function loadFreeIngestionCheckpoints(
  bookId: string,
  ingestionRunId?: string
): Promise<FreeIngestionCheckpoint[]> {
  const notes = await storage.loadBlackboardNotes(bookId).catch(() => [] as BlackboardNote[]);
  return notes
    .filter((note) => note.tags.includes(LEDGER_TAG))
    .flatMap((note) => {
      try {
        const checkpoint = JSON.parse(note.body) as FreeIngestionCheckpoint;
        if (ingestionRunId && checkpoint.ingestionRunId !== ingestionRunId) return [];
        return [checkpoint];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.chunkIndex - b.chunkIndex);
}

function splitStructureForFreeIngestion(structure: BookStructure): FreeIngestionChunk[] {
  const chunks: FreeIngestionChunk[] = [];
  let text = "";
  let startChar = 0;
  let cursor = 0;
  let startChapterIndex = 0;
  let endChapterIndex = 0;

  const flush = () => {
    const body = text.trim();
    if (!body) return;
    chunks.push({
      chunkIndex: chunks.length,
      startChar,
      endChar: cursor,
      startChapterIndex,
      endChapterIndex,
      text: body,
    });
    text = "";
    startChar = cursor;
    startChapterIndex = endChapterIndex + 1;
  };

  for (const chapter of structure.chapters) {
    const raw = chapterText(chapter);
    const chapterTextBlock = `\n\n[Chapter ${chapter.index + 1}: ${chapter.title}]\n${raw}`;
    if (text && text.length + chapterTextBlock.length > FREE_CHUNK_TARGET_CHARS) flush();
    if (!text) {
      startChar = cursor;
      startChapterIndex = chapter.index;
    }
    text += chapterTextBlock;
    cursor += raw.length;
    endChapterIndex = chapter.index;
  }
  flush();
  return chunks.length ? chunks : [{
    chunkIndex: 0,
    startChar: 0,
    endChar: 0,
    startChapterIndex: 0,
    endChapterIndex: 0,
    text: structure.title,
  }];
}

function chapterText(chapter: BookStructure["chapters"][0]): string {
  return chapter.rawText || chapter.sections.map((section) => section.rawText ?? "").filter(Boolean).join("\n\n") || chapter.title;
}

async function analyzeFreeChunk(structure: BookStructure, chunk: FreeIngestionChunk): Promise<FreeChunkArtifact> {
  return llmGenerateJSON<FreeChunkArtifact>("reading", buildChunkPrompt(structure, chunk), {
    temperature: 0.25,
    maxTokens: 1200,
    jsonMode: true,
    think: false,
  });
}

function buildChunkPrompt(structure: BookStructure, chunk: FreeIngestionChunk): string {
  return `You are building a resumable free-mode ingestion ledger for Lumina.

Return ONLY valid JSON with this shape:
{
  "summary": "120-220 word factual summary of this chunk",
  "emotionalTone": ["2-5 short tone words"],
  "themes": ["2-6 recurring ideas"],
  "entities": ["up to 12 important characters, places, objects, or concepts"],
  "visualMoment": {
    "title": "short reader-facing title",
    "description": "one safe-for-all-audiences image description grounded in this chunk",
    "motifs": ["2-5 visual motifs"],
    "atmosphere": ["2-5 atmosphere words"]
  }
}

Rules:
- Do not summarize beyond this chunk.
- Do not invent private facts outside the text.
- Keep image description non-explicit and suitable for public viewing.

Book: ${structure.title}
Author: ${structure.author}
Chunk: ${chunk.chunkIndex + 1}
Text:
${chunk.text.slice(0, FREE_CHUNK_TARGET_CHARS)}`;
}

function validateChunkArtifact(raw: FreeChunkArtifact): FreeChunkArtifact {
  const artifact = {
    summary: String(raw?.summary || "").trim(),
    emotionalTone: asStringArray(raw?.emotionalTone).slice(0, 5),
    themes: asStringArray(raw?.themes).slice(0, 8),
    entities: asStringArray(raw?.entities).slice(0, 16),
    visualMoment: {
      title: String(raw?.visualMoment?.title || "Free-mode visual moment").trim(),
      description: String(raw?.visualMoment?.description || "").trim(),
      motifs: asStringArray(raw?.visualMoment?.motifs).slice(0, 6),
      atmosphere: asStringArray(raw?.visualMoment?.atmosphere).slice(0, 6),
    },
  };
  if (artifact.summary.length < 40) throw new Error("Free ingestion chunk summary was too short.");
  if (artifact.visualMoment.description.length < 30) {
    throw new Error("Free ingestion chunk visual moment was too short.");
  }
  return artifact;
}

function mergeFreeIngestionArtifacts(
  structure: BookStructure,
  ingestionRunId: string,
  checkpoints: FreeIngestionCheckpoint[]
): SemanticMap {
  const inflectionPoints: InflectionPoint[] = checkpoints.map((checkpoint) => ({
    id: `free_inflection_${checkpoint.chunkIndex}`,
    approximateChapterIndex: checkpoint.startChapterIndex,
    emotionalShift: checkpoint.artifact?.emotionalTone.slice(0, 3).join(", ") || "free-mode checkpoint",
    significance: Math.max(0.35, Math.min(0.85, 0.45 + checkpoint.chunkIndex / Math.max(1, checkpoints.length) * 0.25)),
    narrativeLabel: checkpoint.artifact?.visualMoment.title || `Chunk ${checkpoint.chunkIndex + 1}`,
  }));

  const scenes: IdentifiedScene[] = checkpoints.map((checkpoint) => {
    const chapter = structure.chapters[checkpoint.startChapterIndex] ?? structure.chapters[0];
    const artifact = checkpoint.artifact!;
    const sceneId = `free_scene_${checkpoint.chunkIndex}`;
    const publicBrief = buildFreePublicBrief(artifact);
    return {
      id: sceneId,
      inflectionPointId: inflectionPoints[checkpoint.chunkIndex]?.id ?? `free_inflection_${checkpoint.chunkIndex}`,
      chapterId: chapter.id,
      sectionId: chapter.sections[0]?.id ?? chapter.id,
      visualSlotKey: chapter.id,
      anchorCfi: "",
      anchor: {
        href: chapter.href,
        spineIndex: chapter.index,
        wordOffset: 0,
      },
      emotionalVector: artifact.emotionalTone,
      symbolicMotifs: artifact.visualMoment.motifs,
      atmosphericQualities: artifact.visualMoment.atmosphere,
      narrativeWeight: 0.55,
      imageDescription: artifact.visualMoment.description,
      visualPreparationState: "planned",
      publicVisualBrief: publicBrief,
    };
  });

  const beats: VisualBeat[] = scenes.map((scene, index) => ({
    id: `free_beat_${index}`,
    sceneId: scene.id,
    beatIndex: index,
    beatType: index === 0 ? "opening" : index === scenes.length - 1 ? "closing" : "setup",
    origin: "arc",
    generationIntent: "default",
    arcPosition: scenes.length <= 1 ? 0 : index / (scenes.length - 1),
    readerTriggerWord: checkpointStartWord(structure, checkpoints[index]),
    emotionalPurpose: scene.emotionalVector.join(", ") || "free-mode visual checkpoint",
    pacingNote: "Free-mode checkpoint generated from a saved ingestion chunk.",
    visualDensity: "moderate",
  }));

  const arcShape: ArcShape = checkpoints.length > 2 ? "rise-fall-rise" : "rise-fall";
  return {
    bookId: structure.bookId,
    visualPlanVersion: VISUAL_PLAN_VERSION,
    analysisProtocol: "narrative",
    workType: "fiction",
    arcShape,
    inflectionPoints,
    scenes,
    goldenNumber: Math.max(1, scenes.length),
    analyzedAt: new Date().toISOString(),
    storyboard: {
      bookId: structure.bookId,
      arcShape,
      visualBeatCount: beats.length,
      generatedAt: new Date().toISOString(),
      densityTarget: "balanced",
      pathwaySummary: `Free-mode resumable ingestion run ${ingestionRunId} produced ${beats.length} planned visual checkpoints.`,
      beats,
    },
  };
}

async function saveFreeIngestionCheckpoint(checkpoint: FreeIngestionCheckpoint): Promise<void> {
  const timestamp = new Date().toISOString();
  const note: BlackboardNote = {
    id: `${checkpoint.bookId}:free-ingestion:${checkpoint.ingestionRunId}:${checkpoint.chunkIndex}`,
    bookId: checkpoint.bookId,
    blackboardId: `${checkpoint.bookId}:free-ingestion`,
    kind: "source",
    title: `Free ingestion chunk ${checkpoint.chunkIndex + 1} ${checkpoint.status}`,
    body: JSON.stringify(checkpoint),
    tags: [
      LEDGER_TAG,
      `run:${checkpoint.ingestionRunId}`,
      `chunk:${checkpoint.chunkIndex}`,
      checkpoint.status,
    ],
    sourceIds: [
      checkpoint.ingestionRunId,
      `chunk:${checkpoint.chunkIndex}`,
      checkpoint.summaryArtifactId ?? "",
      checkpoint.entitiesArtifactId ?? "",
      checkpoint.semanticMapArtifactId ?? "",
    ].filter(Boolean),
    startWord: checkpoint.startChar,
    endWord: checkpoint.endChar,
    confidence: checkpoint.status === "completed" ? 0.85 : 0.2,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: LEDGER_VERSION,
  };
  await storage.saveBlackboardNotes([note]);
}

function buildFreePublicBrief(artifact: FreeChunkArtifact): PublicVisualBrief {
  const now = new Date().toISOString();
  return {
    title: artifact.visualMoment.title,
    teaser: artifact.summary.slice(0, 140),
    expectedDepiction: artifact.visualMoment.description,
    whyChosen: "Chosen from a completed free-mode ingestion checkpoint.",
    tags: [
      ...artifact.visualMoment.motifs.map((motif) => ({
        id: slug(motif),
        label: motif,
        description: "Motif found during free-mode chunk ingestion.",
        weight: 0.7,
      })),
    ],
    weightedDirections: [],
    referenceImages: [],
    updatedAt: now,
  };
}

function checkpointStartWord(structure: BookStructure, checkpoint: FreeIngestionCheckpoint): number {
  const before = structure.chapters
    .filter((chapter) => chapter.index < checkpoint.startChapterIndex)
    .reduce((sum, chapter) => sum + chapter.wordCount, 0);
  return before;
}

function freeArtifactId(runId: string, chunkIndex: number, kind: string): string {
  return `${runId}:${kind}:${chunkIndex}`;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "tag";
}
