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
import { buildVisualLoreDossier } from "@/pipeline/visualLore";
import { createVisualDirectorBriefs } from "@/pipeline/visualDirector";
import { generateImage } from "@/pipeline/imageGenerator";
import { getAnalysisSlice } from "@/pipeline/collectionSlicing";
import { getStyleSeedById } from "@/data/styleSeeds";
import { storage } from "@/storage";

import { computeSceneWordPosition } from "@/utils/scenePosition";
import { diagnosticError, diagnosticInfo, diagnosticWarn } from "@/utils/diagnostics";
import type {
  AnalysisProgressDetail,
  AnalysisProgressUpdate,
  StyleSeedId,
  BookStructure,
  IdentifiedScene,
  CachedImage,
} from "@/types";
import { useReaderStore } from "@/store/readerStore";

export function useBookOrchestration() {
  const {
    setActiveSemanticMap,
    setActiveStyleSeed,
    setIsAnalyzing,
    setAnalysisProgress,
    setAnalysisProgressDetail,
    activeBook,
    activeSemanticMap,
    activeStyleSeed,
  } = useBookStore();
  const {
    enqueue,
    addToCache,
    clearQueue,
    clearImageCache,
    setCurrentImage,
    setCurrentThemes,
    setIsGenerating,
  } = useImageStore();
  const { imageGenerationEnabled, visualInterpretationLevel } = useSettingsStore();

  // ── Normal import flow ───────────────────────────────────────────────────────

  const startOrchestration = useCallback(
    async (structure: BookStructure, styleSeedId: StyleSeedId) => {
      const book = useBookStore.getState().activeBook;
      if (!book) return;
      diagnosticInfo("orchestration.start", "Starting orchestration", {
        bookId: book.id,
        styleSeedId,
        chapters: structure.chapters.length,
      });

      setActiveStyleSeed(styleSeedId);
      await storage.saveBookStyleSeed(book.id, styleSeedId).catch(() => {});

      if (!imageGenerationEnabled) return;

      const currentChapterIndex = useReaderStore.getState().currentChapterIndex;
      const slice = getAnalysisSlice(structure, currentChapterIndex);

      // Check for cached semantic map for this book or collection segment.
      const existingMap = await storage.loadSemanticMap(slice.semanticBookId);
      if (existingMap) {
        console.log(`[Orchestration] Using cached semantic map for ${slice.label}`);
        diagnosticInfo("orchestration.cached_map", "Using cached semantic map", {
          semanticBookId: slice.semanticBookId,
          scenes: existingMap.scenes.length,
          hasStoryboard: Boolean(existingMap.storyboard),
        });
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

        await _ensureOpeningImage(existingMap, styleSeedId, slice.semanticBookId);
        return;
      }

      await _runAnalysis(slice.structure, styleSeedId, slice.semanticBookId, slice.label);
    },
    [imageGenerationEnabled, setActiveStyleSeed, setActiveSemanticMap, addToCache]
  );

  // ── Force full re-analysis (ignores any cached map) ─────────────────────────

  const reAnalyzeBook = useCallback(
    async (structure: BookStructure) => {
      const state = useBookStore.getState();
      if (!state.activeBook) return;
      const seedId = state.activeStyleSeed;
      if (!seedId) return;

      const currentChapterIndex = useReaderStore.getState().currentChapterIndex;
      const slice = getAnalysisSlice(structure, currentChapterIndex);

      // Delete cached segment map so _runAnalysis doesn't find it.
      await storage.deleteSemanticMap(slice.semanticBookId).catch(() => {});

      setActiveSemanticMap(null);
      await _runAnalysis(slice.structure, seedId, slice.semanticBookId, slice.label, {
        ensureOpeningImage: false,
      });
    },
    [setActiveSemanticMap]
  );

  // ── Regenerate all images (keeps semantic map) ───────────────────────────────

  const regenerateAllImages = useCallback(async () => {
    const state = useBookStore.getState();
    if (!state.activeBook) return;
    const map = state.activeSemanticMap;
    const seedId = state.activeStyleSeed;
    if (!map || !seedId) return;

    // Clear image cache from DB and all in-memory image state atomically
    await storage.deleteImages(map.bookId).catch(() => {});
    clearQueue();
    clearImageCache(); // clears imageCache record, currentImage, and currentThemes

    // Re-queue all scenes in reading order
    await _queueGenerations(map.scenes, map.bookId);
  }, [clearQueue, clearImageCache]);

  // ── Internal helpers ─────────────────────────────────────────────────────────

  const _runAnalysis = useCallback(
    async (
      structure: BookStructure,
      styleSeedId: StyleSeedId,
      semanticBookId: string,
      label: string,
      options: { ensureOpeningImage?: boolean } = {}
    ) => {
      const book = useBookStore.getState().activeBook;
      if (!book) {
      console.warn("[Orchestration] Cannot run analysis: no active book");
        diagnosticWarn("analysis.no_active_book", "Cannot run analysis without an active book");
        return;
      }

      setIsAnalyzing(true);
      const reportProgress = (progress: AnalysisProgressUpdate) => {
        if (typeof progress === "string") {
          setAnalysisProgress(progress);
          return;
        }
        setAnalysisProgressDetail(progress);
      };

      const setPhase = (progress: AnalysisProgressDetail) => {
        setAnalysisProgressDetail(progress);
      };

      setPhase({
        phase: "preparing",
        message: `Reading the emotional landscape of ${label}…`,
        percent: 2,
      });

      try {
        const googleKey = await storage.loadApiKey("lumina_google_ai_key");
        if (!googleKey) {
          console.warn("[Orchestration] No API key — skipping analysis");
          diagnosticWarn("analysis.no_google_key", "No Google AI key found");
          setIsAnalyzing(false);
          setAnalysisProgressDetail({
            phase: "error",
            message: "No Google AI key found. Add one in settings, then analyze again.",
            percent: 0,
          });
          return;
        }

        const baseSemanticMap = await analyzeBook(structure, googleKey, reportProgress);
        const visualLore = await buildVisualLoreDossier({
          structure,
          apiKey: googleKey,
          onProgress: reportProgress,
        });
        const loreSemanticMap = visualLore
          ? { ...baseSemanticMap, visualLore }
          : baseSemanticMap;
        const styleSeed = getStyleSeedById(styleSeedId);
        const directedScenes = styleSeed
          ? await createVisualDirectorBriefs({
              semanticMap: loreSemanticMap,
              structure,
              styleSeed,
              interpretationLevel: visualInterpretationLevel,
              apiKey: googleKey,
              onProgress: reportProgress,
            })
          : loreSemanticMap.scenes;
        const semanticMap = { ...loreSemanticMap, scenes: directedScenes };

        await storage.saveSemanticMap(semanticMap).catch((e) =>
          console.error("[Storage] Failed to save semantic map:", e)
        );

        setActiveSemanticMap(semanticMap);

        console.log(
          `[Orchestration] Analysis complete: arc=${semanticMap.arcShape}, ` +
            `scenes=${semanticMap.scenes.length}, golden=${semanticMap.goldenNumber}`
        );
        diagnosticInfo("analysis.complete", "Analysis complete", {
          semanticBookId,
          arcShape: semanticMap.arcShape,
          scenes: semanticMap.scenes.length,
          goldenNumber: semanticMap.goldenNumber,
          storyboardBeats: semanticMap.storyboard?.beats.length ?? 0,
        });

        if (options.ensureOpeningImage !== false) {
          setPhase({
            phase: "opening-image",
            message: "Composing the opening image…",
            percent: 90,
            current: 1,
            total: semanticMap.scenes.length,
            itemLabel: semanticMap.scenes[0]?.symbolicMotifs.slice(0, 2).join(" + "),
          });
          await _ensureOpeningImage(semanticMap, styleSeedId, semanticBookId);
        }

        setPhase({
          phase: "queueing",
          message: options.ensureOpeningImage === false
            ? "Saving the refreshed visual plan…"
            : "Saving the visual plan for future reading moments…",
          percent: 96,
          current: Math.min(1, semanticMap.scenes.length),
          total: semanticMap.scenes.length,
        });
        setPhase({
          phase: "complete",
          message: options.ensureOpeningImage === false
            ? "Visual scaffold refreshed."
            : "Visual plan ready. New images will form as you read.",
          percent: 100,
          current: Math.min(1, semanticMap.scenes.length),
          total: semanticMap.scenes.length,
        });
        setIsAnalyzing(false);
        setAnalysisProgress("");
        setAnalysisProgressDetail(null);
      } catch (err) {
        console.error("[Orchestration] Failed:", err);
        diagnosticError("analysis.failed", "Analysis failed", {
          semanticBookId,
          error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
        });
        setIsAnalyzing(false);
        setAnalysisProgressDetail({
          phase: "error",
          message: err instanceof Error ? err.message : "Analysis failed before it could finish.",
          percent: 0,
        });
      }
    },
    [
      setActiveSemanticMap,
      setIsAnalyzing,
      setAnalysisProgress,
      setAnalysisProgressDetail,
      addToCache,
      setCurrentImage,
      setCurrentThemes,
      setIsGenerating,
      visualInterpretationLevel,
    ]
  );

  const _ensureOpeningImage = useCallback(
    async (semanticMap: { scenes: IdentifiedScene[] }, styleSeedId: StyleSeedId, semanticBookId: string) => {
      const openingScene = semanticMap.scenes[0];
      if (!openingScene) return;

      const cached = useImageStore.getState().imageCache[openingScene.id];
      if (cached) {
        setCurrentImage(cached);
        setCurrentThemes(cached.emotionalThemes);
        return;
      }

      const styleSeed = getStyleSeedById(styleSeedId);
      const googleKey = await storage.loadApiKey("lumina_google_ai_key");
      const falKey = await storage.loadApiKey("lumina_fal_key");
      if (!styleSeed || !googleKey) return;

      setIsGenerating(true);
      try {
        const generated = await generateImage({
          scene: openingScene,
          styleSeed,
          bookId: semanticBookId,
          googleApiKey: googleKey,
          falApiKey: falKey ?? undefined,
          onComplete: async (img) => {
            addToCache(img);
            setCurrentImage(img);
            setCurrentThemes(img.emotionalThemes);
          },
        });
        addToCache(generated);
        setCurrentImage(generated);
        setCurrentThemes(generated.emotionalThemes);
        console.info("[Orchestration] Opening image committed:", generated.sceneId);
        diagnosticInfo("image.opening.committed", "Opening image committed", {
          sceneId: generated.sceneId,
          bookId: semanticBookId,
          filePath: generated.filePath,
        });
      } catch (err) {
        console.warn("[Orchestration] Opening image failed:", err);
        diagnosticError("image.opening.failed", "Opening image failed", {
          semanticBookId,
          sceneId: openingScene.id,
          error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
        });
        enqueue({
          sceneId: openingScene.id,
          bookId: semanticBookId,
          priority: -1000,
          status: "pending",
          description: openingScene.directorBrief?.finalPrompt || openingScene.imageDescription || "",
        });
      } finally {
        setIsGenerating(false);
      }
    },
    [addToCache, enqueue, setCurrentImage, setCurrentThemes, setIsGenerating]
  );

  const _queueGenerations = useCallback(
    async (scenes: IdentifiedScene[], bookId: string) => {
      scenes.forEach((scene, i) => {
        if (useImageStore.getState().imageCache[scene.id]) return;
        const beat = useBookStore
          .getState()
          .activeSemanticMap?.storyboard?.beats.find((item) => item.sceneId === scene.id);
        if (beat?.generationIntent === "planned_only") return;
        enqueue({
          sceneId: scene.id,
          bookId,
          priority: i + 1,
          status: "pending",
          description: scene.directorBrief?.finalPrompt || scene.imageDescription || "",
        });
      });
    },
    [enqueue]
  );

  return { startOrchestration, reAnalyzeBook, regenerateAllImages };
}
