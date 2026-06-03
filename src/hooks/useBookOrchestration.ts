/**
 * Book Orchestration Hook
 *
 * Three distinct entry points:
 *   startOrchestration(structure, seedId) — normal import flow
 *   reAnalyzeBook(structure)              — force full re-analysis, ignores cache
 *   regenerateAllImages()                 — keeps semantic map, re-generates images only
 */

import { useCallback } from "react";
import { useBookStore } from "@/store/bookStore";
import { useImageStore } from "@/store/imageStore";
import { useSettingsStore } from "@/store/settingsStore";
import { analyzeBook } from "@/pipeline/semanticAnalyzer";
import { generateImage } from "@/pipeline/imageGenerator";
import { getAnalysisSlice } from "@/pipeline/collectionSlicing";
import { getStyleSeedById } from "@/data/styleSeeds";
import { storage } from "@/storage";

import { computeSceneWordPosition } from "@/utils/scenePosition";
import type { StyleSeedId, BookStructure, IdentifiedScene, CachedImage } from "@/types";
import { useReaderStore } from "@/store/readerStore";

export function useBookOrchestration() {
  const {
    setActiveSemanticMap,
    setActiveStyleSeed,
    setIsAnalyzing,
    setAnalysisProgress,
    activeBook,
    activeSemanticMap,
    activeStyleSeed,
  } = useBookStore();
  const { enqueue, addToCache, clearQueue, clearImageCache, setCurrentImage, setCurrentThemes } = useImageStore();
  const { imageGenerationEnabled } = useSettingsStore();

  // ── Normal import flow ───────────────────────────────────────────────────────

  const startOrchestration = useCallback(
    async (structure: BookStructure, styleSeedId: StyleSeedId) => {
      if (!activeBook) return;

      setActiveStyleSeed(styleSeedId);
      await storage.saveBookStyleSeed(activeBook.id, styleSeedId).catch(() => {});

      if (!imageGenerationEnabled) return;

      const currentChapterIndex = useReaderStore.getState().currentChapterIndex;
      const slice = getAnalysisSlice(structure, currentChapterIndex);

      // Check for cached semantic map for this book or collection segment.
      const existingMap = await storage.loadSemanticMap(slice.semanticBookId);
      if (existingMap) {
        console.log(`[Orchestration] Using cached semantic map for ${slice.label}`);
        setActiveSemanticMap(existingMap);

        // Restore the contextually correct display image.
        // Find the most recently passed scene that has a cached image.
        //
        // On a fresh import path (re-import of an existing book), imageCache
        // may be empty because importEpub doesn't pre-load DB images.
        // Load from DB here if the cache is cold before attempting restore.
        let { imageCache } = useImageStore.getState();
        if (Object.keys(imageCache).length === 0) {
          const dbImages = await storage.loadImages(slice.semanticBookId).catch(() => [] as CachedImage[]);
          dbImages.forEach((img) => addToCache(img));
          imageCache = useImageStore.getState().imageCache;
        }

        const { wordPosition } = useReaderStore.getState();
        const chapters = useBookStore.getState().activeStructure?.chapters ?? [];

        let imageToDisplay: CachedImage | null = null;
        let bestSceneWordPos = -1;

        for (const scene of existingMap.scenes) {
          const sceneWordPos = computeSceneWordPosition(scene, chapters);
          if (sceneWordPos <= wordPosition && sceneWordPos > bestSceneWordPos) {
            const cached = imageCache[scene.id];
            if (cached) {
              imageToDisplay = cached;
              bestSceneWordPos = sceneWordPos;
            }
          }
        }

        // Fallback: show scene 0's image if the reader hasn't passed any scene yet
        if (!imageToDisplay) {
          const firstCached = imageCache[existingMap.scenes[0]?.id];
          if (firstCached) imageToDisplay = firstCached;
        }

        if (imageToDisplay) {
          setCurrentImage(imageToDisplay);
          setCurrentThemes(imageToDisplay.emotionalThemes);
        }

        await _queueGenerations(existingMap.scenes, slice.semanticBookId);
        return;
      }

      await _runAnalysis(slice.structure, styleSeedId, slice.semanticBookId, slice.label);
    },
    [activeBook, imageGenerationEnabled, setActiveStyleSeed, setActiveSemanticMap, enqueue]
  );

  // ── Force full re-analysis (ignores any cached map) ─────────────────────────

  const reAnalyzeBook = useCallback(
    async (structure: BookStructure) => {
      if (!activeBook) return;
      const seedId = activeStyleSeed ?? useBookStore.getState().activeStyleSeed;
      if (!seedId) return;

      const currentChapterIndex = useReaderStore.getState().currentChapterIndex;
      const slice = getAnalysisSlice(structure, currentChapterIndex);

      // Delete cached segment map so _runAnalysis doesn't find it.
      await storage.deleteSemanticMap(slice.semanticBookId).catch(() => {});

      setActiveSemanticMap(null);
      await _runAnalysis(slice.structure, seedId, slice.semanticBookId, slice.label);
    },
    [activeBook, activeStyleSeed, setActiveSemanticMap]
  );

  // ── Regenerate all images (keeps semantic map) ───────────────────────────────

  const regenerateAllImages = useCallback(async () => {
    if (!activeBook) return;
    const map = activeSemanticMap ?? useBookStore.getState().activeSemanticMap;
    const seedId = activeStyleSeed ?? useBookStore.getState().activeStyleSeed;
    if (!map || !seedId) return;

    // Clear image cache from DB and all in-memory image state atomically
    await storage.deleteImages(map.bookId).catch(() => {});
    clearQueue();
    clearImageCache(); // clears imageCache record, currentImage, and currentThemes

    // Re-queue all scenes in reading order
    await _queueGenerations(map.scenes, map.bookId);
  }, [activeBook, activeSemanticMap, activeStyleSeed, clearQueue, clearImageCache]);

  // ── Internal helpers ─────────────────────────────────────────────────────────

  const _runAnalysis = useCallback(
    async (
      structure: BookStructure,
      styleSeedId: StyleSeedId,
      semanticBookId: string,
      label: string
    ) => {
      if (!activeBook) return;

      setIsAnalyzing(true);
      setAnalysisProgress(`Reading the emotional landscape of ${label}…`);

      try {
        const googleKey = await storage.loadApiKey("lumina_google_ai_key");
        if (!googleKey) {
          console.warn("[Orchestration] No API key — skipping analysis");
          setIsAnalyzing(false);
          return;
        }

        const semanticMap = await analyzeBook(structure, googleKey, (progress) => {
          setAnalysisProgress(progress);
        });

        await storage.saveSemanticMap(semanticMap).catch((e) =>
          console.error("[Storage] Failed to save semantic map:", e)
        );

        setActiveSemanticMap(semanticMap);
        setIsAnalyzing(false);
        setAnalysisProgress("");

        console.log(
          `[Orchestration] Analysis complete: arc=${semanticMap.arcShape}, ` +
            `scenes=${semanticMap.scenes.length}, golden=${semanticMap.goldenNumber}`
        );

        // Generate opening image immediately
        const openingScene = semanticMap.scenes[0];
        if (openingScene) {
          const styleSeed = getStyleSeedById(styleSeedId);
          const falKey = await storage.loadApiKey("lumina_fal_key");

          if (styleSeed) {
            generateImage({
              scene: openingScene,
              styleSeed,
              bookId: semanticBookId,
              googleApiKey: googleKey,
              falApiKey: falKey ?? undefined,
              onComplete: async (img) => {
                addToCache(img);
                setCurrentImage(img);
                setCurrentThemes(img.emotionalThemes);
                // Persistence handled inside storage.saveImage() — no extra save
              },
            }).catch((err) => {
              console.warn("[Orchestration] Opening image failed:", err);
            });
          }
        }

        await _queueGenerations(semanticMap.scenes.slice(1), semanticBookId);
      } catch (err) {
        console.error("[Orchestration] Failed:", err);
        setIsAnalyzing(false);
        setAnalysisProgress("");
      }
    },
    [
      activeBook,
      setActiveSemanticMap,
      setIsAnalyzing,
      setAnalysisProgress,
      addToCache,
      setCurrentImage,
      setCurrentThemes,
    ]
  );

  const _queueGenerations = useCallback(
    async (scenes: IdentifiedScene[], bookId: string) => {
      scenes.forEach((scene, i) => {
        enqueue({
          sceneId: scene.id,
          bookId,
          priority: i + 1,
          status: "pending",
          description: scene.imageDescription || "",
        });
      });
    },
    [enqueue]
  );

  return { startOrchestration, reAnalyzeBook, regenerateAllImages };
}
