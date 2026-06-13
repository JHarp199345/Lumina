/**
 * Single entry point for per-slot image generation.
 * One visual slot → at most one in-flight API call.
 */

import { generateImage } from "@/pipeline/imageGenerator";
import { getStyleSeedById } from "@/data/styleSeeds";
import { storage } from "@/storage";
import { getProvider } from "@/api/llmClient";
import { computeSceneWordPosition } from "@/utils/scenePosition";
import { findImageForVisualSlot, segmentScenesForSemanticMap, visualSlotKeyForScene } from "@/utils/sceneDedup";
import { diagnosticError, diagnosticInfo } from "@/utils/diagnostics";
import { useImageStore } from "@/store/imageStore";
import { useBookStore } from "@/store/bookStore";
import { EMPTY_CHAPTERS } from "@/utils/stableEmpty";
import { LUMINA_CONFIG } from "@/config";
import {
  activeVisualJobForSlot,
  completeVisualJob,
  failVisualJob,
  startVisualJob,
  updateVisualJob,
} from "@/services/visualGenerationJobs";
import type { CachedImage, IdentifiedScene } from "@/types";

const STALE_GENERATION_MS = LUMINA_CONFIG.VISUAL_GENERATION_STALE_MS;

export function reconcileStaleGeneration(): void {
  const store = useImageStore.getState();
  const started = store.generationStartedAt;
  const stale =
    (store.isGenerating && started && Date.now() - started > STALE_GENERATION_MS) ||
    (store.isGenerating && !store.activeGenerationSlot);

  if (!stale) return;

  diagnosticInfo("image.generation.stale_reset", "Resetting stale generation state", {
    activeSlot: store.activeGenerationSlot,
    startedAt: started,
  });

  useImageStore.setState((state) => ({
    isGenerating: false,
    activeGenerationSlot: null,
    generationStartedAt: null,
    queue: state.queue.map((q) =>
      q.status === "generating" ? { ...q, status: "failed" as const } : q
    ),
  }));
}

export interface SlotGenerationRequest {
  scene: IdentifiedScene;
  bookId: string;
  /** User explicitly requested this slot (gallery) — clears competing queue entries. */
  force?: boolean;
  onComplete?: (image: CachedImage) => void;
}

export type SlotGenerationResult =
  | { ok: true; image: CachedImage }
  | { ok: false; reason: "cached" | "busy" | "no_style" | "no_key" | "no_slot" | "error"; error?: string };

export async function generateForVisualSlot(req: SlotGenerationRequest): Promise<SlotGenerationResult> {
  reconcileStaleGeneration();

  const { activeSemanticMap, activeStyleSeed } = useBookStore.getState();
  if (!activeSemanticMap || !activeStyleSeed) {
    return { ok: false, reason: "error", error: "No active book analysis" };
  }

  // Isolation guard: never generate for a book other than the active one, and
  // never for a scene that isn't part of the active map. This is the hard wall
  // that makes one book's image impossible to produce under another book.
  if (req.bookId !== activeSemanticMap.bookId) {
    diagnosticError("isolation.generation_book_mismatch", "Refused image generation across books", {
      requestBookId: req.bookId,
      activeBookId: activeSemanticMap.bookId,
      sceneId: req.scene.id,
    });
    return { ok: false, reason: "error", error: "Book mismatch — refused to generate one book's image under another." };
  }
  if (!activeSemanticMap.scenes.some((s) => s.id === req.scene.id)) {
    diagnosticError("isolation.scene_not_in_active_map", "Refused generation for a scene outside the active map", {
      bookId: req.bookId,
      sceneId: req.scene.id,
    });
    return { ok: false, reason: "error", error: "This scene does not belong to the active book." };
  }

  const chapters = useBookStore.getState().activeStructure?.chapters ?? EMPTY_CHAPTERS;
  const slotKey = visualSlotKeyForScene(req.scene, chapters);
  if (!slotKey) return { ok: false, reason: "no_slot" };

  const store = useImageStore.getState();
  const mapScenes = segmentScenesForSemanticMap(activeSemanticMap.scenes, chapters, activeSemanticMap);

  const cached = store.getCachedImageForSlot(slotKey);
  if (cached) return { ok: false, reason: "cached" };

  const persisted = await storage.loadImages(req.bookId).catch(() => [] as CachedImage[]);
  const persistedHit = findImageForVisualSlot(slotKey, persisted, mapScenes, chapters);
  if (persistedHit) {
    store.addToCache(persistedHit);
    return { ok: false, reason: "cached" };
  }

  const existingJob = activeVisualJobForSlot(req.bookId, slotKey);
  if (existingJob) {
    store.setActiveVisualJob(existingJob);
    store.setVisualPlanningNotice(`${existingJob.label} is already being composed. Progress has been restored.`);
    return { ok: false, reason: "busy" };
  }

  if (req.force) {
    store.clearQueueForSlot(slotKey);
  } else if (store.isSlotBusy(slotKey)) {
    store.setVisualPlanningNotice("That image is already being composed. Watch the progress indicator instead of starting it again.");
    return { ok: false, reason: "busy" };
  }

  if (!store.claimGenerationSlot(slotKey)) {
    store.setVisualPlanningNotice("Another visual is already being composed. Let it finish before starting another.");
    return { ok: false, reason: "busy" };
  }

  const styleSeed = getStyleSeedById(activeStyleSeed);
  if (!styleSeed) {
    store.releaseGenerationSlot();
    return { ok: false, reason: "no_style" };
  }

  const googleKey = await storage.loadApiKey("lumina_google_ai_key");
  const falKey = await storage.loadApiKey("lumina_fal_key");
  if (!googleKey && getProvider() === "gemini") {
    store.releaseGenerationSlot();
    return { ok: false, reason: "no_key" };
  }

  store.setIsGenerating(true);
  store.markGenerationStarted();
  const job = startVisualJob({
    bookId: req.bookId,
    scene: req.scene,
    visualSlotKey: slotKey,
    wordPosition: computeSceneWordPosition(req.scene, chapters),
  });
  store.setActiveVisualJob(job);
  store.setVisualPlanningNotice(null);

  try {
    updateVisualJob(job.id, {
      phase: "generating",
      message: "Sending this visual moment to the image engine...",
      percent: 45,
    });
    const image = await generateImage({
      scene: req.scene,
      styleSeed,
      bookId: req.bookId,
      wordPosition: computeSceneWordPosition(req.scene, chapters),
      visualSlotKey: slotKey,
      googleApiKey: googleKey ?? "",
      falApiKey: falKey ?? undefined,
    });

    if (image.visualSlotKey !== slotKey) {
      throw new Error(`Generated image returned for the wrong visual slot (${image.visualSlotKey ?? "none"}).`);
    }

    store.addToCache(image);
    store.completeQueueForSlot(slotKey);
    updateVisualJob(job.id, {
      phase: "saving",
      message: "Saving generated image...",
      percent: 92,
    });
    req.onComplete?.(image);
    completeVisualJob(job.id);
    store.setActiveVisualJob(null);
    diagnosticInfo("image.generation.complete", "Slot image generation complete", {
      sceneId: image.sceneId,
      visualSlotKey: slotKey,
    });
    return { ok: true, image };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    diagnosticError("image.generation.failed", "Slot image generation failed", {
      sceneId: req.scene.id,
      visualSlotKey: slotKey,
      error: message,
    });
    store.failQueueForSlot(slotKey);
    failVisualJob(job.id, message);
    store.setActiveVisualJob(null);
    return { ok: false, reason: "error", error: message };
  } finally {
    store.setIsGenerating(false);
    store.releaseGenerationSlot();
  }
}
