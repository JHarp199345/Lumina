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

import { LUMINA_CONFIG } from "@/config";
import { computeSceneWordPosition } from "@/utils/scenePosition";
import { diagnosticError, diagnosticInfo } from "@/utils/diagnostics";
import type { IdentifiedScene, CachedImage } from "@/types";

function currentAnchorSceneId(
  scenes: IdentifiedScene[],
  wordPosition: number,
  getSceneWordPosition: (scene: IdentifiedScene) => number
): string | null {
  let current: IdentifiedScene | null = null;
  for (const scene of [...scenes].sort((a, b) => getSceneWordPosition(a) - getSceneWordPosition(b))) {
    if (getSceneWordPosition(scene) <= wordPosition) current = scene;
  }
  return current?.id ?? null;
}

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

  useEffect(() => {
    priorPromptRef.current = "";
    generatedCountRef.current = 0;
    activeVisualSceneIdRef.current = null;
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

    // ── Display pass: literal forward anchor rule ───────────────────────────
    // Keep the active image frozen. Advance only when the reader crosses the
    // next cached image anchor. Do not recalculate "best image" on every page.
    const cachedScenes = scenes.filter(({ scene }) => Boolean(imageCache[scene.id]));
    const activeSceneId = activeVisualSceneIdRef.current;
    const activeScene = activeSceneId
      ? cachedScenes.find(({ scene }) => scene.id === activeSceneId) ?? null
      : null;

    let nextDisplay = null as null | { scene: IdentifiedScene; position: number; reason: string };

    if (!current || !activeScene) {
      const eligible = cachedScenes.filter(({ position }) => position <= wordPosition);
      const initial = eligible[eligible.length - 1];
      if (initial) nextDisplay = { ...initial, reason: current ? "restore-active-anchor" : "initial-anchor" };
    } else {
      const activePosition = activeScene.position;
      const eligible = cachedScenes.filter(
        ({ position }) => position > activePosition && position <= wordPosition
      );
      const crossed = eligible[eligible.length - 1];
      if (crossed) nextDisplay = { ...crossed, reason: "crossed-next-anchor" };
    }

    if (nextDisplay) {
      const cached = imageCache[nextDisplay.scene.id];
      if (cached && (current?.sceneId !== nextDisplay.scene.id || current.filePath !== cached.filePath)) {
        diagnosticInfo("image.display.switch", "Switching visual segment", {
          reason: nextDisplay.reason,
          fromSceneId: current?.sceneId ?? null,
          activeSceneId,
          toSceneId: nextDisplay.scene.id,
          wordPosition,
          sceneWordPosition: nextDisplay.position,
        });
        activeVisualSceneIdRef.current = nextDisplay.scene.id;
        setCurrentImage(cached);
        setCurrentThemes(cached.emotionalThemes);
      }
    }

    // ── Queue pass: enqueue generation for upcoming scenes ────────────────────
    for (const { scene, position: scenePos } of scenes) {
      if (imageCache[scene.id]) continue; // already generated
      const beat = activeSemanticMap.storyboard?.beats.find((item) => item.sceneId === scene.id);
      if (beat?.generationIntent === "planned_only") continue;

      const distance = scenePos - wordPosition;

      if (
        distance >= -500 &&
        distance <= LUMINA_CONFIG.GENERATION_APPROACH_DISTANCE_WORDS
      ) {
        enqueue({
          sceneId: scene.id,
          bookId: activeSemanticMap.bookId,
          priority: distance, // closer = higher priority (lower number)
          status: "pending",
          description: scene.directorBrief?.finalPrompt || scene.imageDescription || "",
        });
        diagnosticInfo("image.queue.enqueue", "Queued upcoming image", {
          sceneId: scene.id,
          bookId: activeSemanticMap.bookId,
          distance,
          generationIntent: beat?.generationIntent ?? "default",
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
      const hasCurrentImage = Boolean(useImageStore.getState().currentImage);
      const sceneIsCurrentAnchor = scene.id === currentAnchorSceneId(semanticMap.scenes, wordPosition, getSceneWordPosition);
      if (!hasCurrentImage && sceneIsCurrentAnchor) {
        setCurrentImage(existingPersistedImage);
        setCurrentThemes(existingPersistedImage.emotionalThemes);
      }
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

          // Display only if this generated image belongs to the current anchor.
          const hasCurrentImage = Boolean(useImageStore.getState().currentImage);
          const sceneIsCurrentAnchor = scene.id === currentAnchorSceneId(
            semanticMap.scenes,
            useReaderStore.getState().wordPosition,
            getSceneWordPosition
          );
          if (!hasCurrentImage && sceneIsCurrentAnchor) {
            setCurrentImage(img);
            setCurrentThemes(img.emotionalThemes);
          }
        },
      });

      addToCache(cachedImage);
      const hasCurrentImage = Boolean(useImageStore.getState().currentImage);
      const sceneIsCurrentAnchor = scene.id === currentAnchorSceneId(
        semanticMap.scenes,
        useReaderStore.getState().wordPosition,
        getSceneWordPosition
      );
      if (!hasCurrentImage && sceneIsCurrentAnchor) {
        setCurrentImage(cachedImage);
        setCurrentThemes(cachedImage.emotionalThemes);
      }
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
    wordPosition,
    getSceneWordPosition,
    setCurrentImage,
    setCurrentThemes,
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
