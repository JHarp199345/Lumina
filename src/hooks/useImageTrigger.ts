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
import { getApiKey } from "@/utils/tauriBridge";
import { dbSaveImageCache } from "@/services/db";
import { LUMINA_CONFIG } from "@/config";
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
      if (!chapters.length) return 0;

      // Use anchor.spineIndex for reliable chapter lookup (no fake CFI math)
      const anchor = scene.anchor;
      if (anchor) {
        const chapter = chapters.find((ch) => ch.spineIndex === anchor.spineIndex)
          ?? chapters.find((ch) => ch.id === scene.chapterId);
        if (!chapter) return 0;
        const wordsBefore = chapters
          .slice(0, chapter.index)
          .reduce((sum, ch) => sum + ch.wordCount, 0);
        return wordsBefore + anchor.wordOffset;
      }

      // Legacy fallback: chapter lookup by id
      const chapter = chapters.find((ch) => ch.id === scene.chapterId);
      if (!chapter) return 0;
      const wordsBefore = chapters.slice(0, chapter.index).reduce((s, c) => s + c.wordCount, 0);
      return wordsBefore;
    },
    [activeBook]
  );

  // Check if reader is approaching or past a scene
  const checkProximity = useCallback(() => {
    if (!activeSemanticMap || !imageGenerationEnabled || !activeBook) return;

    const scenes = activeSemanticMap.scenes;

    for (const scene of scenes) {
      // Already cached?
      if (imageCache[scene.id]) {
        // Check if we should display this image
        const scenePos = getSceneWordPosition(scene);
        if (wordPosition >= scenePos && wordPosition < scenePos + 3000) {
          const cached = imageCache[scene.id];
          const current = useImageStore.getState().currentImage;
          if (current?.sceneId !== scene.id) {
            transitionToImage(cached);
          }
        }
        continue;
      }

      // Check proximity
      const scenePos = getSceneWordPosition(scene);
      const distance = scenePos - wordPosition;

      if (
        distance > 0 &&
        distance <= LUMINA_CONFIG.GENERATION_APPROACH_DISTANCE_WORDS
      ) {
        // Within approach window — queue if not already queued
        enqueue({
          sceneId: scene.id,
          bookId: activeBook.id,
          priority: distance, // closer = higher priority (lower number)
          status: "pending",
          description: scene.imageDescription || "",
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
    setIsGenerating(true);
    updateQueueItemStatus(next.sceneId, "generating");

    try {
      const googleKey = await getApiKey("lumina_google_ai_key");
      const falKey = await getApiKey("lumina_fal_key");

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

          // Persist to SQLite
          await dbSaveImageCache(img).catch(() => {});

          // Update prior palette context for next generation
          priorPromptRef.current = extractPaletteContext(
            styleSeed,
            [img.descriptionUsed]
          );

          // Display immediately if reader is at/past this scene
          const scenePos = getSceneWordPosition(scene);
          if (wordPosition >= scenePos) {
            transitionToImage(img);
          }
        },
      });

      updateQueueItemStatus(next.sceneId, "complete");
    } catch (err) {
      console.error("[ImageTrigger] Generation failed:", err);
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
    const interval = setInterval(processQueue, 3000);
    return () => clearInterval(interval);
  }, [processQueue]);

  return { isGenerating };
}
