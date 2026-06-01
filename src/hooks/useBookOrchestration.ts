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
import { getStyleSeedById } from "@/data/styleSeeds";
import { getApiKey } from "@/utils/tauriBridge";
import {
  dbSaveSemanticMap,
  dbLoadSemanticMap,
  dbSaveBookStyleSeed,
  dbSaveImageCache,
  dbDeleteImageCache,
  dbDeleteSemanticMap,
} from "@/services/db";
import type { StyleSeedId, BookStructure, IdentifiedScene } from "@/types";

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
      await dbSaveBookStyleSeed(activeBook.id, styleSeedId).catch(() => {});

      if (!imageGenerationEnabled) return;

      // Check for cached semantic map — skip analysis if found
      const existingMap = await dbLoadSemanticMap(activeBook.id);
      if (existingMap) {
        console.log("[Orchestration] Using cached semantic map");
        setActiveSemanticMap(existingMap);
        await _queueGenerations(existingMap.scenes, activeBook.id);
        return;
      }

      await _runAnalysis(structure, styleSeedId);
    },
    [activeBook, imageGenerationEnabled, setActiveStyleSeed, setActiveSemanticMap, enqueue]
  );

  // ── Force full re-analysis (ignores any cached map) ─────────────────────────

  const reAnalyzeBook = useCallback(
    async (structure: BookStructure) => {
      if (!activeBook) return;
      const seedId = activeStyleSeed ?? useBookStore.getState().activeStyleSeed;
      if (!seedId) return;

      // Delete cached map so _runAnalysis doesn't find it
      await dbDeleteSemanticMap(activeBook.id).catch(() => {});

      setActiveSemanticMap(null);
      await _runAnalysis(structure, seedId);
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
    await dbDeleteImageCache(activeBook.id).catch(() => {});
    clearQueue();
    clearImageCache(); // clears imageCache record, currentImage, and currentThemes

    // Re-queue all scenes in reading order
    await _queueGenerations(map.scenes, activeBook.id);
  }, [activeBook, activeSemanticMap, activeStyleSeed, clearQueue, clearImageCache]);

  // ── Internal helpers ─────────────────────────────────────────────────────────

  const _runAnalysis = useCallback(
    async (structure: BookStructure, styleSeedId: StyleSeedId) => {
      if (!activeBook) return;

      setIsAnalyzing(true);
      setAnalysisProgress("Reading the emotional landscape…");

      try {
        const googleKey = await getApiKey("lumina_google_ai_key");
        if (!googleKey) {
          console.warn("[Orchestration] No API key — skipping analysis");
          setIsAnalyzing(false);
          return;
        }

        const semanticMap = await analyzeBook(structure, googleKey, (progress) => {
          setAnalysisProgress(progress);
        });

        await dbSaveSemanticMap(semanticMap).catch((e) =>
          console.error("[DB] Failed to save semantic map:", e)
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
          const falKey = await getApiKey("lumina_fal_key");

          if (styleSeed) {
            generateImage({
              scene: openingScene,
              styleSeed,
              bookId: activeBook.id,
              googleApiKey: googleKey,
              falApiKey: falKey ?? undefined,
              onComplete: async (img) => {
                addToCache(img);
                setCurrentImage(img);
                setCurrentThemes(img.emotionalThemes);
                await dbSaveImageCache(img).catch(() => {});
              },
            }).catch((err) => {
              console.warn("[Orchestration] Opening image failed:", err);
            });
          }
        }

        await _queueGenerations(semanticMap.scenes.slice(1), activeBook.id);
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
