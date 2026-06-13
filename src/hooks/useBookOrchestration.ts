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
import {
  activeVisualJobForSlot,
  completeVisualJob,
  failVisualJob,
  startVisualJob,
  updateVisualJob,
} from "@/services/visualGenerationJobs";
import { getAnalysisSlice } from "@/pipeline/collectionSlicing";
import { getStyleSeedById } from "@/data/styleSeeds";
import { storage } from "@/storage";
import { getProvider } from "@/api/llmClient";

import { computeSceneWordPosition } from "@/utils/scenePosition";
import { sanitizeMapForBook } from "@/utils/bookIsolation";
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
import { useNotificationStore } from "@/store/notificationStore";

// Module-level re-entrancy lock. The workflow tracker keeps a single global
// "active run" context, so two analyses running at once clobber each other's
// run id — their steps bleed into one run and the log looks scrambled (e.g.
// parallel scoring batches interleaved with a second run's sequential scoring
// calls). One analysis at a time keeps each pipeline's telemetry isolated.
let _analysisInFlight = false;

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
      // Sanitize on load — a cached map from before isolation guards could
      // carry a foreign book's visual lore; strip it before it can be used.
      const loadedMap = await storage.loadSemanticMap(slice.semanticBookId);
      const existingMap = loadedMap ? sanitizeMapForBook(loadedMap, slice.semanticBookId) : loadedMap;
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
      const bookId = state.activeBook.id;

      // Delete cached segment map so _runAnalysis doesn't find it.
      await storage.deleteSemanticMap(slice.semanticBookId).catch(() => {});

      clearQueue();
      setActiveSemanticMap(null);
      await _runAnalysis(slice.structure, seedId, slice.semanticBookId, slice.label, {
        ensureOpeningImage: false,
      });

      const semanticMap = useBookStore.getState().activeSemanticMap;
      if (!semanticMap) {
        void useNotificationStore.getState().notify({
          bookId,
          feature: "re-ingest",
          kind: "error",
          title: "Re-analysis failed",
          detail: "Visual analysis did not finish. Check the progress panel or diagnostics.",
        });
        return;
      }

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
      void useNotificationStore.getState().notify({
        bookId,
        feature: "re-ingest",
        kind: "success",
        title: "Re-analysis complete",
        detail: "The visual plan was refreshed. Existing imagery is still preserved unless regenerated.",
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

      try {
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
        void useNotificationStore.getState().notify({
          bookId: book.id,
          feature: "re-ingest",
          kind: "success",
          title: "Re-ingestion complete",
          detail: "Fresh analysis and imagery are ready for this book.",
        });
      } catch (err) {
        diagnosticWarn("reingest.failed", "Re-ingestion failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        void useNotificationStore.getState().notify({
          bookId: book.id,
          feature: "re-ingest",
          kind: "error",
          title: "Re-ingestion failed",
          detail: err instanceof Error ? err.message : "Re-ingestion could not complete.",
        });
      }
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

      // Load the tracker before taking the lock — it's the only awaited call
      // before the try/finally, so a chunk-load failure here can't leak the lock.
      const { startWorkflow, trackStep, completeWorkflow, setWorkflowContext, setActivePhase } =
        await import("@/services/workflowTracker");

      // Re-entrancy guard: refuse a second analysis while one is running so the
      // two don't share/clobber the global workflow context (see _analysisInFlight).
      // The check + set are synchronous (no await between), so this is atomic.
      if (_analysisInFlight) {
        diagnosticWarn("analysis.concurrent_skipped", "Analysis already in progress — skipped concurrent run", {
          semanticBookId,
          label,
        });
        return;
      }
      _analysisInFlight = true;

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

      let wfId: string | null = null;
      const bookTitleEarly = useBookStore.getState().activeBook?.title ?? label;

      try {
        const googleKey = await storage.loadApiKey("lumina_google_ai_key");
        if (!googleKey && getProvider() === "gemini") {
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

        const bookTitle = bookTitleEarly;
        setWorkflowContext({
          id: null,
          type: "book-ingestion",
          label: `${bookTitle} — ${label}`,
          taskGoal: `Ingest "${bookTitle}" — build semantic map and visual plan`,
          stepName: "semantic-analysis",
          stepGoal: "Produce semantic map: arc, scenes, and analysis protocol",
          skill: "book-semantic-analysis",
        });

        wfId = await startWorkflow(
          "book-ingestion",
          `${bookTitle} — ${label}`,
          {
            book_id: book.id,
            book_title: bookTitle,
            chapter_count: structure.chapters.length,
            semantic_book_id: semanticBookId,
            provider: getProvider(),
          },
          `Ingest "${bookTitle}" — build semantic map and visual plan`
        );

        // Step 1 — semantic analysis
        // Phase names update _active.stepName so every server-side queue call
        // is recorded with the right name instead of all showing "semantic-analysis".
        const _phaseMap: Record<string, { name: string; goal: string; skill: string }> = {
          scoring:   { name: "chapter-scoring",      goal: "Score each chapter for emotional valence", skill: "book-chapter-scoring" },
          mapping:   { name: "arc-fitting",           goal: "Fit emotional arc and locate inflection points", skill: "book-arc-fitting" },
          scenes:    { name: "scene-identification",  goal: "Identify symbolic scenes at emotional inflections", skill: "book-scene-identification" },
          prompts:   { name: "image-descriptions",   goal: "Generate visual image prompts for each scene", skill: "book-image-descriptions" },
          blueprint: { name: "narrative-blueprint",  goal: "Build setup→payoff narrative thread structure", skill: "book-narrative-blueprint" },
          preparing: { name: "analysis-prep",        goal: "Determine analysis protocol and prepare structure", skill: "book-semantic-analysis" },
          complete:  { name: "semantic-analysis",    goal: "Semantic analysis complete", skill: "book-semantic-analysis" },
        };
        const phaseReporter: typeof reportProgress = (progress) => {
          if (typeof progress === "object" && progress.phase) {
            const mapped = _phaseMap[progress.phase as string];
            if (mapped) setActivePhase(mapped.name, mapped.goal, mapped.skill);
          }
          reportProgress(progress);
        };

        const baseSemanticMap = await trackStep(
          wfId,
          {
            name: "semantic-analysis",
            goal: "Produce semantic map: arc, scenes, and analysis protocol",
            agent: "reading",
            skill: "book-semantic-analysis",
          },
          () => analyzeBook(structure, googleKey ?? "", phaseReporter),
          (map) => ({
            metrics: {
              scenes: map.scenes.length,
              arc_shape: map.arcShape,
              golden_number: map.goldenNumber,
              protocol: map.analysisProtocol,
              chapters: structure.chapters.length,
            },
            goal_achieved: map.scenes.length > 0 ? 1 : 0,
            unblocked_next: map.scenes.length > 0,
          })
        );

        const isExpository = baseSemanticMap.analysisProtocol === "expository";

        // Step 2 — source profile (early — before visual pipeline; uses semantic map only)
        try {
          const apiKey = await storage.loadApiKey("lumina_google_ai_key");
          const canBuild = apiKey || getProvider() === "odysseus";
          const bookId = String(baseSemanticMap.bookId);
          const existing = await storage.loadSourceProfile(bookId).catch(() => null);
          if (canBuild && !existing) {
            await trackStep(
              wfId,
              {
                name: "source-profile",
                goal: "Build Source Intelligence Profile for Audio Overview prompts",
                agent: "reading",
                skill: "source-intelligence-profile",
              },
              async () => {
                const { buildSourceProfile } = await import("@/pipeline/sourceProfile");
                const profile = await buildSourceProfile(structure, baseSemanticMap, apiKey ?? "");
                await storage.saveSourceProfile(profile).catch(() => {});
                return profile;
              },
              () => ({
                metrics: { book_id: bookId, chapters: structure.chapters.length },
                goal_achieved: 1,
                unblocked_next: true,
              }),
              (err) => ({
                metrics: {
                  book_id: bookId,
                  error: err instanceof Error ? err.message : String(err),
                },
                goal_achieved: 0,
                unblocked_next: true,
              })
            );
          }
        } catch (err) {
          diagnosticWarn("source_profile.prewarm_failed", "SIP pre-warm failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        // Step 3 — visual lore (fiction only)
        const visualLore = isExpository
          ? null
          : await trackStep(
              wfId,
              {
                name: "visual-lore",
                goal: "Build character and location dossier for visual consistency",
                agent: "visual_analyst",
                skill: "visual-lore-dossier",
              },
              () =>
                buildVisualLoreDossier({
                  structure,
                  apiKey: googleKey ?? "",
                  onProgress: reportProgress,
                }),
              (lore) => {
                const entities =
                  (lore as { entities?: { category?: string }[] } | null | undefined)?.entities ?? [];
                const chars = entities.filter((e) => e.category === "character").length;
                const locs = entities.filter((e) => e.category === "place").length;
                return {
                  metrics: { characters: chars, locations: locs, entities: entities.length },
                  goal_achieved: chars > 0 && locs > 0 ? 1 : entities.length > 0 ? 0.75 : 0.5,
                  unblocked_next: true,
                };
              }
            );

        const loreSemanticMap = visualLore
          ? { ...baseSemanticMap, visualLore }
          : baseSemanticMap;
        const styleSeed = getStyleSeedById(styleSeedId);

        // Step 4 — visual director briefs (fiction only)
        const directedScenes =
          styleSeed && !isExpository
            ? await trackStep(
                wfId,
                {
                  name: "visual-direction",
                  goal: "Write per-scene visual director briefs for image generation",
                  agent: "visual_analyst",
                  skill: "scene-visual-direction",
                },
                () =>
                  createVisualDirectorBriefs({
                    semanticMap: loreSemanticMap,
                    structure,
                    styleSeed,
                    interpretationLevel: visualInterpretationLevel,
                    apiKey: googleKey ?? "",
                    onProgress: reportProgress,
                  }),
                (scenes) => ({
                  metrics: { scenes_directed: scenes.length, style_seed: styleSeedId },
                  goal_achieved: scenes.length > 0 ? 1 : 0,
                  unblocked_next: scenes.length > 0,
                })
              )
            : loreSemanticMap.scenes;

        // Sanitize before persisting — guarantees the saved map only carries
        // lore built for this book, so a contaminated map can never be written.
        const semanticMap = sanitizeMapForBook(
          { ...loreSemanticMap, scenes: directedScenes },
          baseSemanticMap.bookId
        );

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
          try {
            await trackStep(
              wfId,
              {
                name: "opening-image",
                goal: "Generate opening scene image via ComfyUI",
                agent: "image_director",
                skill: "scene-image-generation",
              },
              async () => {
                const image = await _ensureOpeningImage(semanticMap, styleSeedId, semanticBookId);
                if (!image) {
                  throw new Error("Opening image was not generated or restored.");
                }
                return image;
              },
              (image) => ({
                metrics: {
                  scene_id: semanticMap.scenes[0]?.id ?? null,
                  image_id: image.id,
                  visual_slot_key: image.visualSlotKey ?? null,
                  success: true,
                },
                goal_achieved: 1,
                unblocked_next: true,
              }),
              (err) => ({
                metrics: {
                  scene_id: semanticMap.scenes[0]?.id ?? null,
                  error: err instanceof Error ? err.message : String(err),
                  success: false,
                },
                goal_achieved: 0,
                unblocked_next: true,
              })
            );
          } catch (err) {
            diagnosticWarn("opening_image.failed", "Opening image was not ready after analysis", {
              semanticBookId,
              sceneId: semanticMap.scenes[0]?.id ?? null,
              error: err instanceof Error ? err.message : String(err),
            });
          }
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

        await completeWorkflow(wfId, {
          outcome_metrics: {
            scenes: semanticMap.scenes.length,
            arc_shape: semanticMap.arcShape,
            golden_number: semanticMap.goldenNumber,
            storyboard_beats: semanticMap.storyboard?.beats.length ?? 0,
            is_expository: isExpository,
            chapter_count: structure.chapters.length,
          },
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
        // Record the failure in the workflow log so the AI can see what broke
        await completeWorkflow(wfId, {
          outcome_metrics: {
            error: err instanceof Error ? err.message : String(err),
            failed: true,
          },
        }).catch(() => {});
        setIsAnalyzing(false);
        setAnalysisProgressDetail({
          phase: "error",
          message: err instanceof Error ? err.message : "Analysis failed before it could finish.",
          percent: 0,
        });
      } finally {
        _analysisInFlight = false;
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
    ): Promise<CachedImage | null> => {
      if (!scene) return null;
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
          return cached;
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
        return persisted;
      }

      const styleSeed = getStyleSeedById(styleSeedId);
      const googleKey = await storage.loadApiKey("lumina_google_ai_key");
      const falKey = await storage.loadApiKey("lumina_fal_key");
      if (!styleSeed || (!googleKey && getProvider() === "gemini")) return null;

      const existingJob = activeVisualJobForSlot(semanticBookId, slotKey);
      if (existingJob) {
        store.setActiveVisualJob(existingJob);
        store.setVisualPlanningNotice(`${existingJob.label} is already being composed. Progress has been restored.`);
        return null;
      }

      if (slotKey && !store.claimGenerationSlot(slotKey)) {
        store.setVisualPlanningNotice("That image is already being composed. Watch the progress indicator instead of starting it again.");
        return null;
      }

      setIsGenerating(true);
      const job = startVisualJob({
        bookId: semanticBookId,
        scene,
        visualSlotKey: slotKey,
        wordPosition: scenePosition,
      });
      store.setActiveVisualJob(job);
      store.setVisualPlanningNotice(null);
      try {
        updateVisualJob(job.id, {
          phase: "generating",
          message: "Composing this visual moment...",
          percent: 45,
        });
        const generated = await generateImage({
          scene,
          styleSeed,
          bookId: semanticBookId,
          wordPosition: scenePosition,
          visualSlotKey: slotKey ?? undefined,
          googleApiKey: googleKey ?? "",
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
        updateVisualJob(job.id, {
          phase: "saving",
          message: "Saving generated image...",
          percent: 92,
        });
        completeVisualJob(job.id);
        store.setActiveVisualJob(null);
        console.info("[Orchestration] Scene image committed:", generated.sceneId);
        diagnosticInfo("image.scene.committed", "Scene image committed", {
          sceneId: generated.sceneId,
          bookId: semanticBookId,
          filePath: generated.filePath,
        });
        return generated;
      } catch (err) {
        console.warn("[Orchestration] Scene image failed:", err);
        diagnosticError("image.scene.failed", "Scene image failed", {
          semanticBookId,
          sceneId: scene.id,
          error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
        });
        failVisualJob(job.id, err instanceof Error ? err.message : String(err));
        store.setActiveVisualJob(null);
        enqueue({
          sceneId: scene.id,
          bookId: semanticBookId,
          wordPosition: scenePosition,
          visualSlotKey: slotKey ?? undefined,
          priority: -1000,
          status: "pending",
          description: scene.directorBrief?.finalPrompt || scene.imageDescription || "",
        });
        return null;
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
      return _ensureSceneImage(semanticMap.scenes[0], styleSeedId, semanticBookId, { display: false });
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
