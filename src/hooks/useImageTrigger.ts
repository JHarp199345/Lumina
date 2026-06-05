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

export function useImageTrigger() {
  const { activeBook, activeSemanticMap, activeStyleSeed } = useBookStore();
  const { wordPosition } = useReaderStore();
  const {
    imageCache,
    addToCache,
    setCurrentImage,
    setCurrentThemes,
    setIsTransitioning,
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

    const scenes = activeSemanticMap.scenes;

    // ── Display pass: always show the most recently passed scene's image ──────
    // Find the cached scene whose word position is <= current position and
    // closest to it. This means the correct image persists across the full
    // span between scenes — no empty gaps.
    let bestDisplayScene: IdentifiedScene | null = null;
    let bestDist = Infinity;

    for (const scene of scenes) {
      if (!imageCache[scene.id]) continue;
      const scenePos = getSceneWordPosition(scene);
      const dist = wordPosition - scenePos; // positive = reader has passed this scene
      if (dist >= 0 && dist < bestDist) {
        bestDist = dist;
        bestDisplayScene = scene;
      }
    }

    if (bestDisplayScene) {
      const cached = imageCache[bestDisplayScene.id];
      const current = useImageStore.getState().currentImage;
      if (current?.sceneId !== bestDisplayScene.id) {
        transitionToImage(cached);
      }
    }

    // ── Queue pass: enqueue generation for upcoming scenes ────────────────────
    for (const scene of scenes) {
      if (imageCache[scene.id]) continue; // already generated
      const beat = activeSemanticMap.storyboard?.beats.find((item) => item.sceneId === scene.id);
      if (beat?.generationIntent === "planned_only") continue;

      const scenePos = getSceneWordPosition(scene);
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
  ]);

  // Process generation queue (one at a time)
  const processQueue = useCallback(async () => {
    if (isGeneratingRef.current) return;

    const next = dequeue();
    if (!next || next.status !== "pending") return;

    const scene = activeSemanticMap?.scenes.find((s) => s.id === next.sceneId);
    if (!scene) return;

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

          // Display immediately if reader is at/past this scene
          const scenePos = getSceneWordPosition(scene);
          const hasCurrentImage = Boolean(useImageStore.getState().currentImage);
          if (!hasCurrentImage || wordPosition >= scenePos) {
            transitionToImage(img);
          }
        },
      });

      addToCache(cachedImage);
      const hasCurrentImage = Boolean(useImageStore.getState().currentImage);
      const scenePos = getSceneWordPosition(scene);
      if (!hasCurrentImage || wordPosition >= scenePos) {
        transitionToImage(cachedImage);
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
  ]);

  // Image transition
  const transitionToImage = useCallback(
    (image: CachedImage) => {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentImage(image);
        setCurrentThemes(image.emotionalThemes);
        setIsTransitioning(false);
      }, LUMINA_CONFIG.IMAGE_TRANSITION_DURATION_MS / 2);
    },
    [setCurrentImage, setCurrentThemes, setIsTransitioning]
  );

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
