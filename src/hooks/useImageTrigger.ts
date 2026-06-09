/**
 * Read-Ahead Image Trigger
 *
 * Monitors reader position and fires image generation when the reader
 * is approaching a scene's anchor point. Never generates all at once.
 * Maximum 1 generation in flight at a time.
 */

import { useEffect, useRef, useCallback } from "react";
import { useReaderStore } from "@/store/readerStore";
import { useBookStore } from "@/store/bookStore";
import { useImageStore } from "@/store/imageStore";
import { useSettingsStore } from "@/store/settingsStore";
import { generateImage, extractPaletteContext } from "@/pipeline/imageGenerator";
import { getStyleSeedById } from "@/data/styleSeeds";
import { storage } from "@/storage";

import { computeSceneWordPosition } from "@/utils/scenePosition";
import { diagnosticError, diagnosticInfo } from "@/utils/diagnostics";
import type { IdentifiedScene, CachedImage } from "@/types";

const VISUAL_PRELOAD_DISTANCE_WORDS = 500;

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
  } = useImageStore();
  const { imageGenerationEnabled } = useSettingsStore();

  const isGeneratingRef = useRef(false);
  const priorPromptRef = useRef<string>("");
  const generatedCountRef = useRef(0);
  const activeVisualSceneIdRef = useRef<string | null>(null);
  const lastDisplayDecisionRef = useRef<string>("");

  useEffect(() => {
    priorPromptRef.current = "";
    generatedCountRef.current = 0;
    activeVisualSceneIdRef.current = null;
    lastDisplayDecisionRef.current = "";
  }, [activeBook?.id]);

  // Calculate word position of each scene using real anchor data
  const getSceneWordPosition = useCallback(
    (scene: IdentifiedScene): number => {
      const { chapters } = useBookStore.getState().activeStructure || { chapters: [] };
      return computeSceneWordPosition(scene, chapters);
    },
    [activeBook]
  );

  // Check if reader is approaching or past a scene
  const checkProximity = useCallback(() => {
    if (!activeSemanticMap || !imageGenerationEnabled || !activeBook) return;

    const scenes = scenePositions(activeSemanticMap.scenes, getSceneWordPosition);
    const current = useImageStore.getState().currentImage;
    if (!activeVisualSceneIdRef.current && current?.sceneId) {
      activeVisualSceneIdRef.current = current.sceneId;
    }

    // ── Display pass: governing-section rule ────────────────────────────────
    // The displayed image is the latest cached scene anchor at or before the
    // reader's current word position. This works in both directions: reading
    // forward advances into the next visual section; paging backward restores
    // the image that governs the section the reader returned to.
    const cachedScenes = scenes.filter(({ scene }) => Boolean(imageCache[scene.id]));
    const currentScenePosition = current?.sceneId
      ? scenes.find(({ scene }) => scene.id === current.sceneId)?.position ?? null
      : null;
    const eligible = cachedScenes.filter(({ position }) => position <= wordPosition);
    const governingScene = eligible[eligible.length - 1] ?? null;
    const nextCachedAnchor = cachedScenes.find(({ position }) => position > wordPosition) ?? null;

    if (governingScene) {
      const cached = imageCache[governingScene.scene.id];
      if (cached && (current?.sceneId !== governingScene.scene.id || current.filePath !== cached.filePath)) {
        const reason =
          !current
            ? "initial-anchor"
            : currentScenePosition !== null && currentScenePosition > governingScene.position
              ? "returned-to-anchor"
              : "entered-anchor";
        diagnosticInfo("image.display.switch", "Switching visual segment", {
          reason,
          fromSceneId: current?.sceneId ?? null,
          toSceneId: governingScene.scene.id,
          wordPosition,
          sceneWordPosition: governingScene.position,
          currentScenePosition,
          nextCachedSceneId: nextCachedAnchor?.scene.id ?? null,
          nextCachedScenePosition: nextCachedAnchor?.position ?? null,
        });
        activeVisualSceneIdRef.current = governingScene.scene.id;
        setCurrentImage(cached);
        setCurrentThemes(cached.emotionalThemes);
      } else {
        const decisionSignature = [
          governingScene.scene.id,
          current?.sceneId ?? "none",
          wordPosition,
          nextCachedAnchor?.scene.id ?? "none",
          nextCachedAnchor?.position ?? "none",
          cachedScenes.length,
          "hold",
        ].join("|");

        if (decisionSignature !== lastDisplayDecisionRef.current) {
          lastDisplayDecisionRef.current = decisionSignature;
          diagnosticInfo("image.display.hold", "Holding governing visual segment", {
            governingSceneId: governingScene.scene.id,
            currentSceneId: current?.sceneId ?? null,
            wordPosition,
            currentScenePosition,
            governingScenePosition: governingScene.position,
            nextCachedSceneId: nextCachedAnchor?.scene.id ?? null,
            nextCachedScenePosition: nextCachedAnchor?.position ?? null,
            cachedSceneCount: cachedScenes.length,
          });
        }
      }
    } else {
      // Only clear when the book HAS scene-anchored images but none govern this
      // position yet (reader paged before the first image). If NO cached image
      // maps to any current scene — orphaned after a re-analysis, or the map is
      // gone — keep whatever is displayed so the reader's art is never blanked.
      if (current && cachedScenes.length > 0) {
        diagnosticInfo("image.display.clear_future", "Clearing visual because no cached anchor governs this position", {
          fromSceneId: current.sceneId,
          wordPosition,
          currentScenePosition,
          nextCachedSceneId: nextCachedAnchor?.scene.id ?? null,
          nextCachedScenePosition: nextCachedAnchor?.position ?? null,
          cachedSceneCount: cachedScenes.length,
        });
        activeVisualSceneIdRef.current = null;
        setCurrentImage(null);
        setCurrentThemes([]);
      }

      const decisionSignature = [
        "none",
        current?.sceneId ?? "none",
        wordPosition,
        nextCachedAnchor?.scene.id ?? "none",
        nextCachedAnchor?.position ?? "none",
        cachedScenes.length,
      ].join("|");

      if (decisionSignature !== lastDisplayDecisionRef.current) {
        lastDisplayDecisionRef.current = decisionSignature;
        diagnosticInfo("image.display.hold", "Holding visual segment", {
          governingSceneId: null,
          currentSceneId: current?.sceneId ?? null,
          wordPosition,
          currentScenePosition,
          governingScenePosition: null,
          nextCachedSceneId: nextCachedAnchor?.scene.id ?? null,
          nextCachedScenePosition: nextCachedAnchor?.position ?? null,
          cachedSceneCount: cachedScenes.length,
        });
      }
    }

    // ── Queue pass: generate only what the reader actually needs ──────────────
    // Display never happens early. Generation may happen for the current missing
    // anchor, or for the next anchor within a tight 500-word runway.
    const generatableScenes = scenes.filter(({ scene }) => {
      const beat = activeSemanticMap.storyboard?.beats.find((item) => item.sceneId === scene.id);
      return beat?.generationIntent !== "planned_only";
    });
    const passedGeneratableScenes = generatableScenes.filter(({ position }) => position <= wordPosition);
    const governingPlannedScene = passedGeneratableScenes[passedGeneratableScenes.length - 1] ?? null;

    if (governingPlannedScene && !imageCache[governingPlannedScene.scene.id]) {
      enqueue({
        sceneId: governingPlannedScene.scene.id,
        bookId: activeSemanticMap.bookId,
        priority: 0,
        status: "pending",
        description: governingPlannedScene.scene.directorBrief?.finalPrompt || governingPlannedScene.scene.imageDescription || "",
      });
      diagnosticInfo("image.queue.enqueue", "Queued current missing visual anchor", {
        sceneId: governingPlannedScene.scene.id,
        bookId: activeSemanticMap.bookId,
        distance: governingPlannedScene.position - wordPosition,
        anchorPosition: governingPlannedScene.position,
      });
    }

    for (const { scene, position: scenePos } of generatableScenes) {
      if (imageCache[scene.id]) continue; // already generated

      const distance = scenePos - wordPosition;

      if (
        distance > 0 &&
        distance <= VISUAL_PRELOAD_DISTANCE_WORDS
      ) {
        enqueue({
          sceneId: scene.id,
          bookId: activeSemanticMap.bookId,
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
  ]);

  // Process generation queue (one at a time)
  const processQueue = useCallback(async () => {
    if (isGeneratingRef.current) return;

    const next = dequeue();
    if (!next || next.status !== "pending") return;

    const semanticMap = activeSemanticMap;
    if (!semanticMap) return;

    const scene = semanticMap.scenes.find((s) => s.id === next.sceneId);
    if (!scene) return;

    const existingMemoryImage = useImageStore.getState().imageCache[scene.id];
    if (existingMemoryImage) {
      updateQueueItemStatus(next.sceneId, "complete");
      return;
    }

    const existingPersistedImage = (await storage.loadImages(next.bookId).catch(() => [] as CachedImage[])).find(
      (image) => image.sceneId === scene.id
    );
    if (existingPersistedImage) {
      addToCache(existingPersistedImage);
      updateQueueItemStatus(next.sceneId, "complete");
      diagnosticInfo("image.generation.persisted_cache", "Using persisted image instead of regenerating", {
        sceneId: scene.id,
        bookId: next.bookId,
      });
      return;
    }

    const styleSeed = activeStyleSeed ? getStyleSeedById(activeStyleSeed) : null;
    if (!styleSeed) return;

    isGeneratingRef.current = true;
    diagnosticInfo("image.generation.start", "Image generation started", {
      sceneId: next.sceneId,
      bookId: next.bookId,
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
        googleApiKey: googleKey,
        falApiKey: falKey || undefined,
        priorPaletteContext: priorContext,
        onComplete: async (img) => {
          addToCache(img);
          generatedCountRef.current++;
          // Persistence handled inside storage.saveImage() — no extra save needed

          // Update prior palette context for next generation
          priorPromptRef.current = extractPaletteContext(
            styleSeed,
            [img.descriptionUsed]
          );
        },
      });

      addToCache(cachedImage);
      console.info("[ImageTrigger] Generated image committed:", cachedImage.sceneId);
      diagnosticInfo("image.generation.complete", "Image generation complete", {
        sceneId: cachedImage.sceneId,
        bookId: cachedImage.bookId,
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
  ]);

  // Run proximity check when position changes
  useEffect(() => {
    checkProximity();
  }, [wordPosition, checkProximity]);

  // Process queue periodically
  useEffect(() => {
    processQueue();
  }, [processQueue, activeSemanticMap, activeStyleSeed, queue]);

  useEffect(() => {
    const interval = setInterval(processQueue, 3000);
    return () => clearInterval(interval);
  }, [processQueue]);

  return { isGenerating };
}
