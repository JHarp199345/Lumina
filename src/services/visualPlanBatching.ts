import { getProvider } from "@/api/llmClient";
import { LUMINA_CONFIG } from "@/config";
import { createVisualDirectorBrief } from "@/pipeline/visualDirector";
import { storage } from "@/storage";
import { computeSceneWordPosition } from "@/utils/scenePosition";
import { diagnosticInfo, diagnosticWarn } from "@/utils/diagnostics";
import type {
  AnalysisProgressReporter,
  BookStructure,
  IdentifiedScene,
  SemanticMap,
  StyleSeed,
  VisualBeat,
  VisualDirectorBrief,
} from "@/types";

let activeBatchKey: string | null = null;

interface EnsureVisualPlanBatchParams {
  semanticMap: SemanticMap;
  structure: BookStructure;
  styleSeed: StyleSeed;
  interpretationLevel: number;
  apiKey: string;
  wordPosition: number;
  reason: "read_ahead" | "gallery_request" | "jump";
  onProgress?: AnalysisProgressReporter;
}

function isActiveBeat(beat: VisualBeat | undefined): boolean {
  return beat?.generationIntent === "default" || beat?.generationIntent === "reader_requested";
}

function beatPosition(scene: IdentifiedScene, structure: BookStructure): number {
  return computeSceneWordPosition(scene, structure.chapters);
}

function activeAheadCount(
  scenes: IdentifiedScene[],
  beatsBySceneId: Map<string, VisualBeat>,
  structure: BookStructure,
  wordPosition: number
): number {
  return scenes.filter((scene) => {
    const beat = beatsBySceneId.get(scene.id);
    return isActiveBeat(beat) && beatPosition(scene, structure) >= wordPosition;
  }).length;
}

function choosePromotionScenes(
  semanticMap: SemanticMap,
  structure: BookStructure,
  wordPosition: number
): IdentifiedScene[] {
  const beatsBySceneId = new Map(semanticMap.storyboard?.beats.map((beat) => [beat.sceneId, beat]) ?? []);
  const aheadActive = activeAheadCount(semanticMap.scenes, beatsBySceneId, structure, wordPosition);
  if (aheadActive >= LUMINA_CONFIG.VISUAL_ACTIVE_BATCH_REFILL_THRESHOLD) return [];

  const needed = Math.min(
    LUMINA_CONFIG.VISUAL_MAX_BATCH_PROMOTIONS,
    Math.max(0, LUMINA_CONFIG.VISUAL_ACTIVE_BATCH_SIZE - aheadActive)
  );
  if (needed <= 0) return [];

  const candidates = semanticMap.scenes
    .map((scene) => ({ scene, position: beatPosition(scene, structure), beat: beatsBySceneId.get(scene.id) }))
    .filter(({ beat, position }) => beat?.generationIntent === "planned_only" && position >= wordPosition)
    .sort((a, b) => a.position - b.position || b.scene.narrativeWeight - a.scene.narrativeWeight);

  return candidates.slice(0, needed).map(({ scene }) => scene);
}

function updateBeatIntent(beat: VisualBeat, promotedIds: Set<string>): VisualBeat {
  if (!promotedIds.has(beat.sceneId)) return beat;
  return {
    ...beat,
    generationIntent: "default",
    pacingNote: `${beat.pacingNote} Activated in the reader's current illustration batch.`,
  };
}

function applyBrief(scene: IdentifiedScene, brief: VisualDirectorBrief): IdentifiedScene {
  return {
    ...scene,
    directorBrief: brief,
    imageDescription: brief.finalPrompt,
  };
}

function activeBeatCount(beats: VisualBeat[]): number {
  return beats.filter(isActiveBeat).length;
}

export async function ensureVisualPlanBatch(
  params: EnsureVisualPlanBatchParams
): Promise<SemanticMap> {
  const storyboard = params.semanticMap.storyboard;
  if (!storyboard?.beats.length) return params.semanticMap;

  const canDirect = getProvider() === "odysseus" || Boolean(params.apiKey);
  if (!canDirect) return params.semanticMap;

  const promotions = choosePromotionScenes(params.semanticMap, params.structure, params.wordPosition);
  if (promotions.length === 0) return params.semanticMap;

  const key = [
    params.semanticMap.bookId,
    params.reason,
    Math.floor(params.wordPosition / 1000),
    promotions.map((scene) => scene.id).join(","),
  ].join("|");
  if (activeBatchKey === key) return params.semanticMap;
  activeBatchKey = key;

  try {
    const promotedIds = new Set(promotions.map((scene) => scene.id));
    const updatedStoryboard = {
      ...storyboard,
      beats: storyboard.beats.map((beat) => updateBeatIntent(beat, promotedIds)),
      pathwaySummary: `${storyboard.pathwaySummary} Active illustration batch extended near word ${params.wordPosition}.`,
    };

    let currentScenes = params.semanticMap.scenes;
    const recentBriefs = currentScenes
      .map((scene) => scene.directorBrief)
      .filter((brief): brief is VisualDirectorBrief => Boolean(brief));

    diagnosticInfo("visual_plan.batch_promote.start", "Activating next visual planning batch", {
      bookId: params.semanticMap.bookId,
      reason: params.reason,
      wordPosition: params.wordPosition,
      promoted: promotions.length,
    });

    params.onProgress?.({
      phase: "prompts",
      message: "Preparing the next visual story batch…",
      percent: 88,
      current: 0,
      total: promotions.length,
    });

    for (let i = 0; i < promotions.length; i++) {
      const scene = promotions[i];
      if (scene.directorBrief) continue;

      try {
        const partialMap: SemanticMap = {
          ...params.semanticMap,
          storyboard: updatedStoryboard,
          scenes: currentScenes,
        };
        const brief = await createVisualDirectorBrief({
          scene,
          semanticMap: partialMap,
          structure: params.structure,
          styleSeed: params.styleSeed,
          interpretationLevel: params.interpretationLevel,
          recentBriefs,
          apiKey: params.apiKey,
        });
        recentBriefs.push(brief);
        currentScenes = currentScenes.map((item) => (item.id === scene.id ? applyBrief(item, brief) : item));
        params.onProgress?.({
          phase: "prompts",
          message: "Preparing the next visual story batch…",
          percent: 88 + Math.round(((i + 1) / promotions.length) * 6),
          current: i + 1,
          total: promotions.length,
          itemLabel: scene.symbolicMotifs.slice(0, 2).join(" + "),
        });
      } catch (err) {
        diagnosticWarn("visual_plan.batch_brief_failed", "Could not direct promoted visual scene", {
          bookId: params.semanticMap.bookId,
          sceneId: scene.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const nextMap: SemanticMap = {
      ...params.semanticMap,
      storyboard: updatedStoryboard,
      scenes: currentScenes,
      goldenNumber: Math.max(params.semanticMap.goldenNumber, activeBeatCount(updatedStoryboard.beats)),
    };

    await storage.saveSemanticMap(nextMap).catch((err) => {
      diagnosticWarn("visual_plan.batch_save_failed", "Could not save promoted visual batch", {
        bookId: params.semanticMap.bookId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    diagnosticInfo("visual_plan.batch_promote.complete", "Visual planning batch activated", {
      bookId: params.semanticMap.bookId,
      promoted: promotions.length,
    });

    return nextMap;
  } finally {
    activeBatchKey = null;
  }
}
