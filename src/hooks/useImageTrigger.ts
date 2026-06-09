/**
 * Read-Ahead Image Trigger
 *
 * Display: updates when reader position or cache changes.
 * Generation queue: runs ONLY when reader word position changes — never on cache ticks.
 * One EPUB slot → one cached image → one API call in flight.
 */

import { useEffect, useRef, useCallback } from "react";
import { useReaderStore } from "@/store/readerStore";
import { useBookStore } from "@/store/bookStore";
import { useImageStore } from "@/store/imageStore";
import { useSettingsStore } from "@/store/settingsStore";
import { generateImage, extractPaletteContext } from "@/pipeline/imageGenerator";
import { getStyleSeedById } from "@/data/styleSeeds";
import { storage } from "@/storage";
import { LUMINA_CONFIG } from "@/config";

import { computeSceneWordPosition } from "@/utils/scenePosition";
import {
  getDisplayImage,
  getGoverningImage,
  hasPositionedImages,
  resolveImageWordPosition,
} from "@/utils/imagePosition";
import {
  findImageForVisualSlot,
  segmentScenesOnePerSlot,
  slotHasQueuedOrCachedImage,
  visualSlotKeyForScene,
} from "@/utils/sceneDedup";
import { EMPTY_CHAPTERS } from "@/utils/stableEmpty";
import { diagnosticError, diagnosticInfo } from "@/utils/diagnostics";
import type { IdentifiedScene, CachedImage } from "@/types";

function scenePositions(
  scenes: IdentifiedScene[],
  getSceneWordPosition: (scene: IdentifiedScene) => number
): Array<{ scene: IdentifiedScene; position: number }> {
  return scenes
    .map((scene) => ({ scene, position: getSceneWordPosition(scene) }))
    .sort((a, b) => a.position - b.position);
}

export function useImageTrigger() {
  const { activeBook, activeSemanticMap, activeStyleSeed } = useBookStore();
  const { wordPosition } = useReaderStore();
  const { imageCache, setCurrentImage, setCurrentThemes } = useImageStore();
  const pendingQueueCount = useImageStore((s) => s.queue.filter((q) => q.status === "pending").length);
  const { imageGenerationEnabled } = useSettingsStore();

  const isGeneratingRef = useRef(false);
  const priorPromptRef = useRef<string>("");
  const lastDisplayDecisionRef = useRef<string>("");
  const lastWordPositionRef = useRef(0);
  const lastQueuePositionRef = useRef(-1);

  useEffect(() => {
    priorPromptRef.current = "";
    lastDisplayDecisionRef.current = "";
    lastWordPositionRef.current = 0;
    lastQueuePositionRef.current = -1;
  }, [activeBook?.id]);

  const getSceneWordPosition = useCallback((scene: IdentifiedScene): number => {
    const chapters = useBookStore.getState().activeStructure?.chapters ?? EMPTY_CHAPTERS;
    return computeSceneWordPosition(scene, chapters);
  }, []);

  // ── Display only — may run when cache or position changes ─────────────────
  const updateDisplay = useCallback(() => {
    if (!activeSemanticMap || !activeBook) return;

    const chapters = useBookStore.getState().activeStructure?.chapters ?? EMPTY_CHAPTERS;
    const cachedImages = Object.values(useImageStore.getState().imageCache);
    const current = useImageStore.getState().currentImage;
    const readerPos = useReaderStore.getState().wordPosition;

    const displayImage = getDisplayImage(cachedImages, readerPos, chapters);
    const governingImage = getGoverningImage(cachedImages, readerPos, chapters);
    const currentImagePosition =
      current && chapters.length > 0 ? resolveImageWordPosition(current, chapters) : -1;

    const nextPositionedImage = cachedImages
      .map((image) => ({ image, position: resolveImageWordPosition(image, chapters) }))
      .filter(({ position }) => position > readerPos)
      .sort((a, b) => a.position - b.position)[0] ?? null;

    if (displayImage) {
      const displayPos = resolveImageWordPosition(displayImage, chapters);
      const isPreview = !governingImage || governingImage.id !== displayImage.id;

      if (current?.id !== displayImage.id || current.filePath !== displayImage.filePath) {
        setCurrentImage(displayImage);
        setCurrentThemes(displayImage.emotionalThemes);
      } else {
        const decisionSignature = [
          displayImage.id,
          current?.id ?? "none",
          readerPos,
          nextPositionedImage?.position ?? "none",
          cachedImages.length,
          isPreview ? "preview-hold" : "hold",
        ].join("|");

        if (decisionSignature !== lastDisplayDecisionRef.current) {
          lastDisplayDecisionRef.current = decisionSignature;
          diagnosticInfo("image.display.hold", "Holding visual segment", {
            governingSceneId: displayImage.sceneId,
            wordPosition: readerPos,
            imageWordPosition: displayPos,
          });
        }
      }
    } else if (current && hasPositionedImages(cachedImages, chapters)) {
      setCurrentImage(null);
      setCurrentThemes([]);
    }
  }, [activeSemanticMap, activeBook, setCurrentImage, setCurrentThemes]);

  // ── Queue only — runs when reader position changes, not on cache updates ──
  const updateQueue = useCallback(() => {
    if (!activeSemanticMap || !imageGenerationEnabled || !activeBook) return;

    const readerPos = useReaderStore.getState().wordPosition;
    if (readerPos === lastQueuePositionRef.current) return;
    lastQueuePositionRef.current = readerPos;

    const chapters = useBookStore.getState().activeStructure?.chapters ?? EMPTY_CHAPTERS;
    const canonicalScenes = segmentScenesOnePerSlot(activeSemanticMap.scenes, chapters);
    const scenes = scenePositions(canonicalScenes, getSceneWordPosition);
    const store = useImageStore.getState();
    const cachedImages = Object.values(store.imageCache);
    const queue = store.queue;

    const generatableScenes = scenes.filter(({ scene }) => {
      const beat = activeSemanticMap.storyboard?.beats.find((item) => item.sceneId === scene.id);
      return beat?.generationIntent !== "planned_only";
    });

    const positionDelta = readerPos - lastWordPositionRef.current;
    const isNavigationJump =
      Date.now() < store.navigationJumpUntil ||
      Math.abs(positionDelta) >= LUMINA_CONFIG.VISUAL_JUMP_THRESHOLD_WORDS;
    const hasAdvancedForward = positionDelta >= LUMINA_CONFIG.VISUAL_FORWARD_ADVANCE_WORDS;

    if (hasAdvancedForward && Date.now() < store.regenerateCooldownUntil) {
      useImageStore.setState({ regenerateCooldownUntil: 0 });
    }

    if (Date.now() < store.regenerateCooldownUntil) {
      lastWordPositionRef.current = readerPos;
      return;
    }

    if (isNavigationJump) {
      store.pruneQueueOutsideWindow(readerPos, LUMINA_CONFIG.VISUAL_JUMP_QUEUE_WINDOW_WORDS, 0);
    } else {
      store.pruneQueueOutsideWindow(readerPos, LUMINA_CONFIG.VISUAL_PRELOAD_DISTANCE_WORDS, 0);
    }

    lastWordPositionRef.current = readerPos;

    const passedGeneratableScenes = generatableScenes.filter(({ position }) => position <= readerPos);
    const governingPlannedScene = passedGeneratableScenes[passedGeneratableScenes.length - 1] ?? null;
    const governingSlotKey = governingPlannedScene
      ? visualSlotKeyForScene(governingPlannedScene.scene, chapters)
      : null;

    if (
      governingPlannedScene &&
      governingSlotKey &&
      !slotHasQueuedOrCachedImage(governingSlotKey, cachedImages, canonicalScenes, chapters, queue)
    ) {
      store.enqueue({
        sceneId: governingPlannedScene.scene.id,
        bookId: activeSemanticMap.bookId,
        wordPosition: governingPlannedScene.position,
        visualSlotKey: governingSlotKey,
        priority: 0,
        status: "pending",
        description:
          governingPlannedScene.scene.directorBrief?.finalPrompt ||
          governingPlannedScene.scene.imageDescription ||
          "",
      });
      diagnosticInfo("image.queue.enqueue", "Queued current missing visual anchor", {
        sceneId: governingPlannedScene.scene.id,
        visualSlotKey: governingSlotKey,
        wordPosition: readerPos,
      });
    }

    const preloadDistance = isNavigationJump
      ? LUMINA_CONFIG.VISUAL_JUMP_QUEUE_WINDOW_WORDS
      : LUMINA_CONFIG.VISUAL_PRELOAD_DISTANCE_WORDS;

    if (hasAdvancedForward && !isNavigationJump) {
      for (const { scene, position: scenePos } of generatableScenes) {
        const slotKey = visualSlotKeyForScene(scene, chapters);
        if (
          !slotKey ||
          slotHasQueuedOrCachedImage(
            slotKey,
            Object.values(useImageStore.getState().imageCache),
            canonicalScenes,
            chapters,
            useImageStore.getState().queue
          )
        ) {
          continue;
        }

        const distance = scenePos - readerPos;
        if (distance > 0 && distance <= preloadDistance) {
          store.enqueue({
            sceneId: scene.id,
            bookId: activeSemanticMap.bookId,
            wordPosition: scenePos,
            visualSlotKey: slotKey,
            priority: distance,
            status: "pending",
            description: scene.directorBrief?.finalPrompt || scene.imageDescription || "",
          });
        }
      }
    }
  }, [activeSemanticMap, imageGenerationEnabled, activeBook, getSceneWordPosition]);

  const processQueue = useCallback(async () => {
    if (isGeneratingRef.current) return;

    const store = useImageStore.getState();
    const next = store.dequeue();
    if (!next || next.status !== "pending") return;

    const semanticMap = activeSemanticMap;
    if (!semanticMap) return;

    const scene = semanticMap.scenes.find((s) => s.id === next.sceneId);
    if (!scene) {
      store.updateQueueItemStatus(next.sceneId, "complete");
      return;
    }

    const chapters = useBookStore.getState().activeStructure?.chapters ?? EMPTY_CHAPTERS;
    const readerPosition = useReaderStore.getState().wordPosition;
    const scenePosition =
      typeof next.wordPosition === "number"
        ? next.wordPosition
        : computeSceneWordPosition(scene, chapters);

    const aheadLimit =
      Date.now() < store.navigationJumpUntil
        ? LUMINA_CONFIG.VISUAL_JUMP_QUEUE_WINDOW_WORDS
        : LUMINA_CONFIG.VISUAL_PRELOAD_DISTANCE_WORDS;
    const sceneDelta = scenePosition - readerPosition;
    if (sceneDelta > aheadLimit || sceneDelta < -LUMINA_CONFIG.VISUAL_POSITION_MATCH_TOLERANCE) {
      store.updateQueueItemStatus(next.sceneId, "complete");
      return;
    }

    const slotKey = visualSlotKeyForScene(scene, chapters) ?? next.visualSlotKey ?? null;
    const mapScenes = segmentScenesOnePerSlot(semanticMap.scenes, chapters);

    if (!slotKey) {
      store.updateQueueItemStatus(next.sceneId, "complete");
      return;
    }

    const cachedForSlot = store.getCachedImageForSlot(slotKey);
    if (cachedForSlot) {
      store.updateQueueItemStatus(next.sceneId, "complete");
      return;
    }

    const existingMemoryImage = findImageForVisualSlot(
      slotKey,
      Object.values(store.imageCache),
      mapScenes,
      chapters
    );
    if (existingMemoryImage) {
      store.addToCache(existingMemoryImage);
      store.updateQueueItemStatus(next.sceneId, "complete");
      return;
    }

    const persistedImages = await storage.loadImages(next.bookId).catch(() => [] as CachedImage[]);
    const existingPersistedImage = findImageForVisualSlot(
      slotKey,
      persistedImages,
      mapScenes,
      chapters
    );
    if (existingPersistedImage) {
      store.addToCache(existingPersistedImage);
      store.updateQueueItemStatus(next.sceneId, "complete");
      return;
    }

    if (!store.claimGenerationSlot(slotKey)) {
      diagnosticInfo("image.generation.slot_busy", "Skipped generation — slot already claimed or cached", {
        sceneId: next.sceneId,
        visualSlotKey: slotKey,
      });
      return;
    }

    const styleSeed = activeStyleSeed ? getStyleSeedById(activeStyleSeed) : null;
    if (!styleSeed) {
      store.releaseGenerationSlot();
      return;
    }

    isGeneratingRef.current = true;
    store.setIsGenerating(true);
    store.updateQueueItemStatus(next.sceneId, "generating");

    try {
      const googleKey = await storage.loadApiKey("lumina_google_ai_key");
      const falKey = await storage.loadApiKey("lumina_fal_key");

      if (!googleKey) {
        store.updateQueueItemStatus(next.sceneId, "failed");
        return;
      }

      const priorContext = priorPromptRef.current || undefined;

      const cachedImage = await generateImage({
        scene,
        styleSeed,
        bookId: next.bookId,
        wordPosition: scenePosition,
        visualSlotKey: slotKey,
        googleApiKey: googleKey,
        falApiKey: falKey || undefined,
        priorPaletteContext: priorContext,
        onComplete: async (img) => {
          store.addToCache(img);
          priorPromptRef.current = extractPaletteContext(styleSeed, [img.descriptionUsed]);
        },
      });

      store.addToCache(cachedImage);
      store.updateQueueItemStatus(next.sceneId, "complete");
      diagnosticInfo("image.generation.complete", "Image generation complete", {
        sceneId: cachedImage.sceneId,
        visualSlotKey: slotKey,
        wordPosition: scenePosition,
      });
    } catch (err) {
      diagnosticError("image.generation.failed", "Image generation failed", {
        sceneId: next.sceneId,
        visualSlotKey: slotKey,
        error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
      });
      store.updateQueueItemStatus(next.sceneId, "failed");
    } finally {
      isGeneratingRef.current = false;
      store.setIsGenerating(false);
      store.releaseGenerationSlot();
    }
  }, [activeSemanticMap, activeStyleSeed]);

  useEffect(() => {
    updateDisplay();
  }, [wordPosition, imageCache, updateDisplay]);

  useEffect(() => {
    updateQueue();
  }, [wordPosition, updateQueue]);

  useEffect(() => {
    if (!activeSemanticMap) return;
    lastQueuePositionRef.current = -1;
    updateQueue();
  }, [activeSemanticMap?.bookId, activeSemanticMap?.visualPlanVersion, updateQueue]);

  useEffect(() => {
    processQueue();
  }, [processQueue, activeSemanticMap, activeStyleSeed, pendingQueueCount]);

  useEffect(() => {
    const interval = setInterval(processQueue, 3000);
    return () => clearInterval(interval);
  }, [processQueue]);

  return { isGenerating: useImageStore((s) => s.isGenerating) };
}
