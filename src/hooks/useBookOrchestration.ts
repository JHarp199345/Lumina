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
import {
  findImageAtPosition,
  getDisplayImage,
  hydrateImageWordPositions,
} from "@/utils/imagePosition";
import {
  findImageForVisualSlot,
  segmentScenesForSemanticMap,
  visualSlotKeyForScene,
} from "@/utils/sceneDedup";
import { diagnosticError, diagnosticInfo, diagnosticWarn } from "@/utils/diagnostics";
import { LUMINA_CONFIG } from "@/config";
import { VISUAL_PLAN_VERSION } from "@/config/visualPlan";
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
      if (existingMap && existingMap.visualPlanVersion !== VISUAL_PLAN_VERSION) {
        diagnosticInfo("semantic_map.stale_deleted", "Deleting stale visual plan", {
          semanticBookId: slice.semanticBookId,
          storedVersion: existingMap.visualPlanVersion ?? null,
          currentVersion: VISUAL_PLAN_VERSION,
          scenes: existingMap.scenes.length,
        });
        await storage.deleteSemanticMap(slice.semanticBookId).catch(() => {});
      }

      if (existingMap?.visualPlanVersion === VISUAL_PLAN_VERSION) {
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
        const chapters = useBookStore.getState().activeStructure?.chapters ?? [];
        if (Object.keys(imageCache).length === 0) {
          const sceneIdSet = new Set(existingMap.scenes.map((scene) => scene.id));
          const dbImages = (await storage.loadImages(slice.semanticBookId).catch(() => [] as CachedImage[]))
            // Only current-generation images enter the cache — orphans from a prior
            // generation are never loaded, so no view can ever display them.
            .filter((img) => sceneIdSet.has(img.sceneId));
          const hydrated = hydrateImageWordPositions(dbImages, existingMap.scenes, chapters);
          hydrated.forEach((img) => addToCache(img));
          imageCache = useImageStore.getState().imageCache;
        }

        const { wordPosition } = useReaderStore.getState();
        // Scope to the current generation's scenes (single source of truth) so an
        // orphaned image from a prior generation can never be picked for display.
        const existingScenesById = new Map(existingMap.scenes.map((scene) => [scene.id, scene]));
        const cachedImages = Object.values(imageCache).filter((image) =>
          existingScenesById.has(image.sceneId)
        );
        const imageToDisplay = getDisplayImage(cachedImages, wordPosition, chapters, existingScenesById);

        if (imageToDisplay) {
          setCurrentImage(imageToDisplay);
          setCurrentThemes(imageToDisplay.emotionalThemes);
        } else if (cachedImages.length > 0) {
          const fallback = [...cachedImages].sort(
            (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
          )[0] ?? null;
          if (fallback) {
            setCurrentImage(fallback);
            setCurrentThemes(fallback.emotionalThemes);
          }
        } else {
          setCurrentImage(null);
          setCurrentThemes([]);
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

      const slice = getAnalysisSlice(structure, 0);

      // Delete cached segment map so _runAnalysis doesn't find it.
      await storage.deleteSemanticMap(slice.semanticBookId).catch(() => {});

      clearQueue();
      setActiveSemanticMap(null);
      await _runAnalysis(slice.structure, seedId, slice.semanticBookId, slice.label, {
        ensureOpeningImage: false,
      });

      const semanticMap = useBookStore.getState().activeSemanticMap;
      if (!semanticMap) return;

      const chapters = structure.chapters;
      const scenesById = new Map(semanticMap.scenes.map((scene) => [scene.id, scene]));
      const persistedImages = await storage.loadImages(slice.semanticBookId).catch(() => [] as CachedImage[]);
      // Only the current generation's images enter the cache / display.
      const currentGen = persistedImages.filter((image) => scenesById.has(image.sceneId));
      const hydrated = hydrateImageWordPositions(currentGen, semanticMap.scenes, chapters);
      hydrated.forEach((image) => addToCache(image));

      const win = window as Window & { luminaNavigate?: (target: string) => void };
      win.luminaNavigate?.("lumina://chapter/0/page/0");
      useReaderStore.getState().setCurrentCfi("lumina://chapter/0/page/0");
      useReaderStore.getState().setCurrentChapterIndex(0);
      useReaderStore.getState().setPercentComplete(0);
      useReaderStore.getState().setWordPosition(0);
      useImageStore.getState().markNavigationJump();

      const imageToDisplay = getDisplayImage(hydrated, 0, chapters, scenesById);
      if (imageToDisplay) {
        setCurrentImage(imageToDisplay);
        setCurrentThemes(imageToDisplay.emotionalThemes);
      } else {
        setCurrentImage(null);
        setCurrentThemes([]);
      }

      diagnosticInfo("reanalyze.restore", "Re-analysis complete — restored opening position and cached art", {
        semanticBookId: slice.semanticBookId,
        persistedImages: hydrated.length,
        displayedSceneId: imageToDisplay?.sceneId ?? null,
      });
    },
    [setActiveSemanticMap, clearQueue, addToCache, setCurrentImage, setCurrentThemes]
  );

  // ── Re-Ingest (the single explicit "start a fresh generation" action) ────────
  // Snapshots the current generation into the archive, clears the active generated
  // artifacts (images, audio, semantic map, source profile), then re-lays fresh
  // groundwork. Images fill in one-at-a-time via the read-ahead trigger. User data
  // (highlights, notes, progress, the EPUB) is never touched.

  const reIngest = useCallback(
    async (structure: BookStructure) => {
      const state = useBookStore.getState();
      const book = state.activeBook;
      const seedId = state.activeStyleSeed;
      if (!book || !seedId) return;

      const slice = getAnalysisSlice(structure, 0);
      diagnosticInfo("reingest.start", "Re-ingesting book", { bookId: book.id });

      // 1. Archive the current generation and clear the active generated artifacts.
      await storage.archiveAndResetGeneration(book).catch((err) =>
        diagnosticWarn("reingest.archive_failed", "Archive/reset failed", {
          error: err instanceof Error ? err.message : String(err),
        })
      );

      // 2. Clear in-memory generation state so nothing old lingers in the gallery.
      clearQueue();
      clearImageCache();
      setActiveSemanticMap(null);

      // 3. Re-lay the groundwork: fresh analysis. The opening image generates;
      //    the rest fill in one-at-a-time as the reader reaches each slot.
      await _runAnalysis(slice.structure, seedId, slice.semanticBookId, slice.label, {
        ensureOpeningImage: true,
      });

      // 4. Return the reader to the start of the fresh generation.
      const win = window as Window & { luminaNavigate?: (target: string) => void };
      win.luminaNavigate?.("lumina://chapter/0/page/0");
      useReaderStore.getState().setCurrentCfi("lumina://chapter/0/page/0");
      useReaderStore.getState().setCurrentChapterIndex(0);
      useReaderStore.getState().setPercentComplete(0);
      useReaderStore.getState().setWordPosition(0);
      useImageStore.getState().markNavigationJump();

      diagnosticInfo("reingest.complete", "Re-ingestion complete", { bookId: book.id });
    },
    [setActiveSemanticMap, clearQueue, clearImageCache]
  );

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
        message: `Analyzing ${label}…`,
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
        const isExpository = baseSemanticMap.analysisProtocol === "expository";

        const visualLore = isExpository
          ? null
          : await buildVisualLoreDossier({
              structure,
              apiKey: googleKey,
              onProgress: reportProgress,
            });
        const loreSemanticMap = visualLore
          ? { ...baseSemanticMap, visualLore }
          : baseSemanticMap;
        const styleSeed = getStyleSeedById(styleSeedId);
        const directedScenes =
          styleSeed && !isExpository
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

        // Pre-warm the Source Intelligence Profile for Audio Overview in the same
        // ingestion run (one extra consolidation call). Best-effort and fully
        // detached — it must never affect analysis success. Older books build it
        // lazily on first Audio Overview open instead.
        void (async () => {
          try {
            const apiKey = await storage.loadApiKey("lumina_google_ai_key");
            if (!apiKey) return;
            const existing = await storage.loadSourceProfile(semanticMap.bookId).catch(() => null);
            if (existing) return;
            const { buildSourceProfile } = await import("@/pipeline/sourceProfile");
            const profile = await buildSourceProfile(structure, semanticMap, apiKey);
            await storage.saveSourceProfile(profile).catch(() => {});
          } catch (err) {
            diagnosticWarn("source_profile.prewarm_failed", "SIP pre-warm failed", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();

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

  // Generate + display a specific scene's image immediately. Used for the
  // opening image and for the current block on regenerate-all. On failure it
  // queues the scene for the background processor to retry.
  const _ensureSceneImage = useCallback(
    async (
      scene: IdentifiedScene | undefined,
      styleSeedId: StyleSeedId,
      semanticBookId: string,
      options: { display?: boolean } = {}
    ) => {
      if (!scene) return;
      const shouldDisplay = options.display !== false;

      const chapters = useBookStore.getState().activeStructure?.chapters ?? [];
      const scenePosition = computeSceneWordPosition(scene, chapters);
      const semanticMap = useBookStore.getState().activeSemanticMap;
      const mapScenes = segmentScenesForSemanticMap(semanticMap?.scenes ?? [scene], chapters, semanticMap);
      const slotKey = visualSlotKeyForScene(scene, chapters);
      const store = useImageStore.getState();

      if (slotKey) {
        const cached =
          store.getCachedImageForSlot(slotKey) ??
          findImageForVisualSlot(slotKey, Object.values(store.imageCache), mapScenes, chapters);
        if (cached) {
          if (shouldDisplay) {
            setCurrentImage(cached);
            setCurrentThemes(cached.emotionalThemes);
          }
          return;
        }
      }

      const persistedImages = await storage.loadImages(semanticBookId).catch(() => [] as CachedImage[]);
      const persisted =
        slotKey
          ? findImageForVisualSlot(slotKey, persistedImages, mapScenes, chapters)
          : findImageAtPosition(
              persistedImages,
              scenePosition,
              chapters,
              undefined,
              LUMINA_CONFIG.VISUAL_POSITION_MATCH_TOLERANCE
            );
      if (persisted) {
        addToCache(persisted);
        if (shouldDisplay) {
          setCurrentImage(persisted);
          setCurrentThemes(persisted.emotionalThemes);
        }
        diagnosticInfo("image.scene.persisted_cache", "Using persisted image for EPUB section slot", {
          sceneId: scene.id,
          bookId: semanticBookId,
          visualSlotKey: slotKey,
        });
        return;
      }

      const styleSeed = getStyleSeedById(styleSeedId);
      const googleKey = await storage.loadApiKey("lumina_google_ai_key");
      const falKey = await storage.loadApiKey("lumina_fal_key");
      if (!styleSeed || !googleKey) return;

      if (slotKey && !store.claimGenerationSlot(slotKey)) return;

      setIsGenerating(true);
      try {
        const generated = await generateImage({
          scene,
          styleSeed,
          bookId: semanticBookId,
          wordPosition: scenePosition,
          visualSlotKey: slotKey ?? undefined,
          googleApiKey: googleKey,
          falApiKey: falKey ?? undefined,
          onComplete: async (img) => {
            addToCache(img);
            if (shouldDisplay) {
              setCurrentImage(img);
              setCurrentThemes(img.emotionalThemes);
            }
          },
        });
        addToCache(generated);
        if (shouldDisplay) {
          setCurrentImage(generated);
          setCurrentThemes(generated.emotionalThemes);
        }
        console.info("[Orchestration] Scene image committed:", generated.sceneId);
        diagnosticInfo("image.scene.committed", "Scene image committed", {
          sceneId: generated.sceneId,
          bookId: semanticBookId,
          filePath: generated.filePath,
        });
      } catch (err) {
        console.warn("[Orchestration] Scene image failed:", err);
        diagnosticError("image.scene.failed", "Scene image failed", {
          semanticBookId,
          sceneId: scene.id,
          error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
        });
        enqueue({
          sceneId: scene.id,
          bookId: semanticBookId,
          wordPosition: scenePosition,
          visualSlotKey: slotKey ?? undefined,
          priority: -1000,
          status: "pending",
          description: scene.directorBrief?.finalPrompt || scene.imageDescription || "",
        });
      } finally {
        setIsGenerating(false);
        if (slotKey) store.releaseGenerationSlot();
      }
    },
    [addToCache, enqueue, setCurrentImage, setCurrentThemes, setIsGenerating]
  );

  // Opening image is prepared up front, but display still belongs to the
  // governing-section trigger. Generating must not force a future image on screen.
  const _ensureOpeningImage = useCallback(
    async (semanticMap: { scenes: IdentifiedScene[] }, styleSeedId: StyleSeedId, semanticBookId: string) => {
      await _ensureSceneImage(semanticMap.scenes[0], styleSeedId, semanticBookId, { display: false });
    },
    [_ensureSceneImage]
  );

  // ── Regenerate all images (keeps the plan; lazy from current position) ───────
  //
  // Nuclear reset: wipe the whole image library, regenerate ONLY the scene at
  // the reader's current position, then leave every other trigger point planned
  // until read-ahead fires on natural forward reading.

  const regenerateAllImages = useCallback(async () => {
    const state = useBookStore.getState();
    if (!state.activeBook) return;
    const map = state.activeSemanticMap;
    const seedId = state.activeStyleSeed;
    if (!map || !seedId) return;

    const wordPosition = useReaderStore.getState().wordPosition;

    diagnosticInfo("regenerate_all.start", "Wiping image library and regenerating current scene only", {
      bookId: state.activeBook.id,
      semanticBookId: map.bookId,
      wordPosition,
      scenes: map.scenes.length,
    });

    await storage.deleteImages(state.activeBook.id).catch(() => {});
    clearQueue();
    clearImageCache();
    useImageStore.getState().markRegenerateCooldown();

    const chapters = state.activeStructure?.chapters ?? [];
    const generatable = map.scenes.filter((scene) => {
      const beat = map.storyboard?.beats.find((b) => b.sceneId === scene.id);
      return beat?.generationIntent !== "planned_only";
    });

    let current: IdentifiedScene | undefined;
    let bestPos = -Infinity;
    for (const scene of generatable) {
      const pos = computeSceneWordPosition(scene, chapters);
      if (pos <= wordPosition && pos > bestPos) {
        bestPos = pos;
        current = scene;
      }
    }

    if (current) {
      await _ensureSceneImage(current, seedId, map.bookId, { display: true });
    } else {
      setCurrentImage(null);
      setCurrentThemes([]);
    }

    diagnosticInfo("regenerate_all.complete", "Image library wiped; current scene regenerated", {
      bookId: state.activeBook.id,
      wordPosition,
      currentSceneId: current?.id ?? null,
      currentScenePosition: current ? bestPos : null,
    });
  }, [clearQueue, clearImageCache, setCurrentImage, setCurrentThemes, _ensureSceneImage]);

  return { startOrchestration, reAnalyzeBook, regenerateAllImages, reIngest };
}
