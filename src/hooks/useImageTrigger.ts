/**
 * Read-Ahead Image Trigger
 *
 * Monitors reader position and fires image generation when the reader
 * is approaching a scene's anchor point. Never generates all at once.
 * Maximum 1 generation in flight at a time.
 *
 * Display is governed by word position: the latest cached image at or
 * before the reader's word number wins — forward and backward.
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
  findImageAtPosition,
  getDisplayImage,
  getGoverningImage,
  hasPositionedImages,
  resolveImageWordPosition,
} from "@/utils/imagePosition";
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
  const {
    imageCache,
    addToCache,
    setCurrentImage,
    setCurrentThemes,
    queue,
    enqueue,
    dequeue,
    updateQueueItemStatus,
    isGenerating,
    setIsGenerating,
    getCachedImageAtPosition,
    navigationJumpUntil,
    regenerateCooldownUntil,
    pruneQueueOutsideWindow,
  } = useImageStore();
  const { imageGenerationEnabled } = useSettingsStore();

  const isGeneratingRef = useRef(false);
  const priorPromptRef = useRef<string>("");
  const generatedCountRef = useRef(0);
  const lastDisplayDecisionRef = useRef<string>("");
  const lastWordPositionRef = useRef(0);
  const lastForwardPositionRef = useRef(0);

  useEffect(() => {
    priorPromptRef.current = "";
    generatedCountRef.current = 0;
    lastDisplayDecisionRef.current = "";
    lastWordPositionRef.current = 0;
    lastForwardPositionRef.current = 0;
  }, [activeBook?.id]);

  const getSceneWordPosition = useCallback(
    (scene: IdentifiedScene): number => {
      const { chapters } = useBookStore.getState().activeStructure || { chapters: [] };
      return computeSceneWordPosition(scene, chapters);
    },
    [activeBook]
  );

  const checkProximity = useCallback(() => {
    if (!activeSemanticMap || !imageGenerationEnabled || !activeBook) return;

    const chapters = useBookStore.getState().activeStructure?.chapters ?? [];
    const scenes = scenePositions(activeSemanticMap.scenes, getSceneWordPosition);
    const cachedImages = Object.values(imageCache);
    const current = useImageStore.getState().currentImage;

    // ── Display pass: governing anchor, or preview the section's next image ──
    const displayImage = getDisplayImage(cachedImages, wordPosition, chapters);
    const governingImage = getGoverningImage(cachedImages, wordPosition, chapters);
    const currentImagePosition =
      current && chapters.length > 0 ? resolveImageWordPosition(current, chapters) : -1;

    const nextPositionedImage = cachedImages
      .map((image) => ({ image, position: resolveImageWordPosition(image, chapters) }))
      .filter(({ position }) => position > wordPosition)
      .sort((a, b) => a.position - b.position)[0] ?? null;

    if (displayImage) {
      const displayPos = resolveImageWordPosition(displayImage, chapters);
      const isPreview = !governingImage || governingImage.id !== displayImage.id;

      if (
        current?.id !== displayImage.id ||
        current.filePath !== displayImage.filePath
      ) {
        const reason = isPreview
          ? "section-preview"
          : !current
            ? "initial-anchor"
            : currentImagePosition > displayPos
              ? "returned-to-anchor"
              : "entered-anchor";
        diagnosticInfo("image.display.switch", "Switching visual segment", {
          reason,
          fromSceneId: current?.sceneId ?? null,
          toSceneId: displayImage.sceneId,
          wordPosition,
          imageWordPosition: displayPos,
          currentImagePosition,
          nextImagePosition: nextPositionedImage?.position ?? null,
          nextSceneId: nextPositionedImage?.image.sceneId ?? null,
        });
        setCurrentImage(displayImage);
        setCurrentThemes(displayImage.emotionalThemes);
      } else {
        const decisionSignature = [
          displayImage.id,
          current?.id ?? "none",
          wordPosition,
          nextPositionedImage?.position ?? "none",
          cachedImages.length,
          isPreview ? "preview-hold" : "hold",
        ].join("|");

        if (decisionSignature !== lastDisplayDecisionRef.current) {
          lastDisplayDecisionRef.current = decisionSignature;
          diagnosticInfo("image.display.hold", "Holding visual segment", {
            governingSceneId: displayImage.sceneId,
            currentSceneId: current?.sceneId ?? null,
            wordPosition,
            imageWordPosition: displayPos,
            currentImagePosition,
            nextImagePosition: nextPositionedImage?.position ?? null,
            cachedImageCount: cachedImages.length,
            previewHold: isPreview,
          });
        }
      }
    } else if (current && hasPositionedImages(cachedImages, chapters)) {
      diagnosticInfo("image.display.clear", "Clearing visual because no positioned image is available", {
        fromSceneId: current.sceneId,
        wordPosition,
        currentImagePosition,
        cachedImageCount: cachedImages.length,
      });
      setCurrentImage(null);
      setCurrentThemes([]);
    }

    // ── Queue pass: generate only what the reader actually needs ──────────────
    const generatableScenes = scenes.filter(({ scene }) => {
      const beat = activeSemanticMap.storyboard?.beats.find((item) => item.sceneId === scene.id);
      return beat?.generationIntent !== "planned_only";
    });

    const positionDelta = wordPosition - lastWordPositionRef.current;
    const isNavigationJump =
      Date.now() < navigationJumpUntil ||
      Math.abs(positionDelta) >= LUMINA_CONFIG.VISUAL_JUMP_THRESHOLD_WORDS;
    const hasAdvancedForward = positionDelta >= LUMINA_CONFIG.VISUAL_FORWARD_ADVANCE_WORDS;

    if (hasAdvancedForward && Date.now() < regenerateCooldownUntil) {
      useImageStore.setState({ regenerateCooldownUntil: 0 });
    }

    if (Date.now() < regenerateCooldownUntil) {
      return;
    }

    if (isNavigationJump) {
      pruneQueueOutsideWindow(
        wordPosition,
        LUMINA_CONFIG.VISUAL_JUMP_QUEUE_WINDOW_WORDS,
        0
      );
    } else {
      pruneQueueOutsideWindow(
        wordPosition,
        LUMINA_CONFIG.VISUAL_PRELOAD_DISTANCE_WORDS,
        0
      );
    }

    lastWordPositionRef.current = wordPosition;
    if (hasAdvancedForward) {
      lastForwardPositionRef.current = wordPosition;
    }

    const passedGeneratableScenes = generatableScenes.filter(({ position }) => position <= wordPosition);
    const governingPlannedScene = passedGeneratableScenes[passedGeneratableScenes.length - 1] ?? null;

    if (
      governingPlannedScene &&
      !getCachedImageAtPosition(governingPlannedScene.position, chapters)
    ) {
      enqueue({
        sceneId: governingPlannedScene.scene.id,
        bookId: activeSemanticMap.bookId,
        wordPosition: governingPlannedScene.position,
        priority: 0,
        status: "pending",
        description:
          governingPlannedScene.scene.directorBrief?.finalPrompt ||
          governingPlannedScene.scene.imageDescription ||
          "",
      });
      diagnosticInfo("image.queue.enqueue", "Queued current missing visual anchor", {
        sceneId: governingPlannedScene.scene.id,
        bookId: activeSemanticMap.bookId,
        distance: governingPlannedScene.position - wordPosition,
        anchorPosition: governingPlannedScene.position,
        navigationJump: isNavigationJump,
      });
    }

    const preloadDistance = isNavigationJump
      ? LUMINA_CONFIG.VISUAL_JUMP_QUEUE_WINDOW_WORDS
      : LUMINA_CONFIG.VISUAL_PRELOAD_DISTANCE_WORDS;

    // Read-ahead only after meaningful forward reading — never on idle ticks, cache updates, or jumps.
    if (hasAdvancedForward && !isNavigationJump) {
      for (const { scene, position: scenePos } of generatableScenes) {
        if (getCachedImageAtPosition(scenePos, chapters)) continue;

        const distance = scenePos - wordPosition;

        if (distance > 0 && distance <= preloadDistance) {
          enqueue({
            sceneId: scene.id,
            bookId: activeSemanticMap.bookId,
            wordPosition: scenePos,
            priority: distance,
            status: "pending",
            description: scene.directorBrief?.finalPrompt || scene.imageDescription || "",
          });
          diagnosticInfo("image.queue.enqueue", "Queued nearby visual anchor", {
            sceneId: scene.id,
            bookId: activeSemanticMap.bookId,
            distance,
            anchorPosition: scenePos,
          });
        }
      }
    }
  }, [
    activeSemanticMap,
    imageGenerationEnabled,
    activeBook,
    imageCache,
    wordPosition,
    getSceneWordPosition,
    enqueue,
    setCurrentImage,
    setCurrentThemes,
    getCachedImageAtPosition,
    navigationJumpUntil,
    regenerateCooldownUntil,
    pruneQueueOutsideWindow,
  ]);

  const processQueue = useCallback(async () => {
    if (isGeneratingRef.current) return;

    const next = dequeue();
    if (!next || next.status !== "pending") return;

    const semanticMap = activeSemanticMap;
    if (!semanticMap) return;

    const scene = semanticMap.scenes.find((s) => s.id === next.sceneId);
    if (!scene) {
      updateQueueItemStatus(next.sceneId, "complete");
      return;
    }

    const chapters = useBookStore.getState().activeStructure?.chapters ?? [];
    const readerPosition = useReaderStore.getState().wordPosition;
    const scenePosition =
      typeof next.wordPosition === "number"
        ? next.wordPosition
        : computeSceneWordPosition(scene, chapters);

    const aheadLimit =
      Date.now() < useImageStore.getState().navigationJumpUntil
        ? LUMINA_CONFIG.VISUAL_JUMP_QUEUE_WINDOW_WORDS
        : LUMINA_CONFIG.VISUAL_PRELOAD_DISTANCE_WORDS;
    const sceneDelta = scenePosition - readerPosition;
    if (sceneDelta > aheadLimit || sceneDelta < -LUMINA_CONFIG.VISUAL_POSITION_MATCH_TOLERANCE) {
      updateQueueItemStatus(next.sceneId, "complete");
      diagnosticInfo("image.queue.skip_distant", "Skipping queued scene outside reader window", {
        sceneId: next.sceneId,
        scenePosition,
        readerPosition,
        sceneDelta,
        aheadLimit,
      });
      return;
    }

    const existingMemoryImage = getCachedImageAtPosition(scenePosition, chapters);
    if (existingMemoryImage) {
      updateQueueItemStatus(next.sceneId, "complete");
      return;
    }

    const persistedImages = await storage.loadImages(next.bookId).catch(() => [] as CachedImage[]);
    const existingPersistedImage = findImageAtPosition(
      persistedImages,
      scenePosition,
      chapters,
      undefined,
      LUMINA_CONFIG.VISUAL_POSITION_MATCH_TOLERANCE
    );
    if (existingPersistedImage) {
      addToCache(existingPersistedImage);
      updateQueueItemStatus(next.sceneId, "complete");
      diagnosticInfo("image.generation.persisted_cache", "Using persisted image instead of regenerating", {
        sceneId: scene.id,
        bookId: next.bookId,
        wordPosition: scenePosition,
      });
      return;
    }

    const styleSeed = activeStyleSeed ? getStyleSeedById(activeStyleSeed) : null;
    if (!styleSeed) return;

    isGeneratingRef.current = true;
    diagnosticInfo("image.generation.start", "Image generation started", {
      sceneId: next.sceneId,
      bookId: next.bookId,
      wordPosition: scenePosition,
    });
    setIsGenerating(true);
    updateQueueItemStatus(next.sceneId, "generating");

    try {
      const googleKey = await storage.loadApiKey("lumina_google_ai_key");
      const falKey = await storage.loadApiKey("lumina_fal_key");

      if (!googleKey) {
        console.warn("[ImageTrigger] No API key configured");
        updateQueueItemStatus(next.sceneId, "failed");
        return;
      }

      const priorContext = priorPromptRef.current || undefined;

      const cachedImage = await generateImage({
        scene,
        styleSeed,
        bookId: next.bookId,
        wordPosition: scenePosition,
        googleApiKey: googleKey,
        falApiKey: falKey || undefined,
        priorPaletteContext: priorContext,
        onComplete: async (img) => {
          addToCache(img);
          generatedCountRef.current++;
          priorPromptRef.current = extractPaletteContext(styleSeed, [img.descriptionUsed]);
        },
      });

      addToCache(cachedImage);
      console.info("[ImageTrigger] Generated image committed:", cachedImage.sceneId, "at word", scenePosition);
      diagnosticInfo("image.generation.complete", "Image generation complete", {
        sceneId: cachedImage.sceneId,
        bookId: cachedImage.bookId,
        wordPosition: scenePosition,
        filePath: cachedImage.filePath,
      });
      updateQueueItemStatus(next.sceneId, "complete");
    } catch (err) {
      console.error("[ImageTrigger] Generation failed:", err);
      diagnosticError("image.generation.failed", "Image generation failed", {
        sceneId: next.sceneId,
        bookId: next.bookId,
        error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
      });
      updateQueueItemStatus(next.sceneId, "failed");
    } finally {
      isGeneratingRef.current = false;
      setIsGenerating(false);
    }
  }, [
    dequeue,
    activeSemanticMap,
    activeStyleSeed,
    updateQueueItemStatus,
    addToCache,
    setIsGenerating,
    getCachedImageAtPosition,
  ]);

  useEffect(() => {
    checkProximity();
  }, [wordPosition, checkProximity]);

  useEffect(() => {
    processQueue();
  }, [processQueue, activeSemanticMap, activeStyleSeed, queue]);

  useEffect(() => {
    const interval = setInterval(processQueue, 3000);
    return () => clearInterval(interval);
  }, [processQueue]);

  return { isGenerating };
}
