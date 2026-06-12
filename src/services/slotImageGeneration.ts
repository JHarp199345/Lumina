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
import type { CachedImage, IdentifiedScene } from "@/types";

const STALE_GENERATION_MS = 7 * 60 * 1000;

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

  if (req.force) {
    store.clearQueueForSlot(slotKey);
  } else if (store.isSlotBusy(slotKey)) {
    return { ok: false, reason: "busy" };
  }

  if (!store.claimGenerationSlot(slotKey)) {
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

  try {
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
    req.onComplete?.(image);
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
    return { ok: false, reason: "error", error: message };
  } finally {
    store.setIsGenerating(false);
    store.releaseGenerationSlot();
  }
}
