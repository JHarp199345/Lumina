/**
 * Read-Ahead Image Trigger
 *
 * Display: updates when reader position or cache changes.
 * Generation queue: runs ONLY when reader word position changes — never on cache ticks.
 * One EPUB slot → one cached image → one API call in flight.
 */

import { useEffect, useRef, useCallback } from "react";
import { useReaderStore } from "@/store/readerStore";
import { useBookStore } from "@/store/bookStore";
import { useImageStore } from "@/store/imageStore";
import { useSettingsStore } from "@/store/settingsStore";
import { extractPaletteContext } from "@/pipeline/imageGenerator";
import { generateForVisualSlot, reconcileStaleGeneration } from "@/services/slotImageGeneration";
import type { SlotGenerationResult } from "@/services/slotImageGeneration";
import { ensureVisualPlanBatch } from "@/services/visualPlanBatching";
import { storage } from "@/storage";
import { getStyleSeedById } from "@/data/styleSeeds";
import { LUMINA_CONFIG } from "@/config";
import { getProvider } from "@/api/llmClient";

import { computeSceneWordPosition } from "@/utils/scenePosition";
import { getDisplayImage } from "@/utils/imagePosition";
import {
  segmentScenesForSemanticMap,
  slotHasQueuedOrCachedImage,
  visualSlotKeyForScene,
} from "@/utils/sceneDedup";
import { EMPTY_CHAPTERS } from "@/utils/stableEmpty";
import { diagnosticInfo } from "@/utils/diagnostics";
import type { IdentifiedScene } from "@/types";

const FREE_IMAGE_MAX_CONCURRENT = 6;

function scenePositions(
  scenes: IdentifiedScene[],
  getSceneWordPosition: (scene: IdentifiedScene) => number
): Array<{ scene: IdentifiedScene; position: number }> {
  return scenes
    .map((scene) => ({ scene, position: getSceneWordPosition(scene) }))
    .sort((a, b) => a.position - b.position);
}

export function useImageTrigger() {
  const activeBook = useBookStore((s) => s.activeBook);
  const activeSemanticMap = useBookStore((s) => s.activeSemanticMap);
  const activeStyleSeed = useBookStore((s) => s.activeStyleSeed);
  const wordPosition = useReaderStore((s) => s.wordPosition);
  const imageCache = useImageStore((s) => s.imageCache);
  const setCurrentImage = useImageStore((s) => s.setCurrentImage);
  const setCurrentThemes = useImageStore((s) => s.setCurrentThemes);
  const pendingQueueCount = useImageStore((s) => s.queue.filter((q) => q.status === "pending").length);
  const imageGenerationEnabled = useSettingsStore((s) => s.imageGenerationEnabled);

  const isGeneratingRef = useRef(false);
  const freeGeneratingScenesRef = useRef<Set<string>>(new Set());
  const isPlanningRef = useRef(false);
  const priorPromptRef = useRef<string>("");
  const lastWordPositionRef = useRef(0);
  const lastQueuePositionRef = useRef(-1);

  useEffect(() => {
    priorPromptRef.current = "";
    lastWordPositionRef.current = 0;
    lastQueuePositionRef.current = -1;
  }, [activeBook?.id]);

  const getSceneWordPosition = useCallback((scene: IdentifiedScene): number => {
    const chapters = useBookStore.getState().activeStructure?.chapters ?? EMPTY_CHAPTERS;
    return computeSceneWordPosition(scene, chapters);
  }, []);

  // ── Display only — may run when cache or position changes ─────────────────
  const updateDisplay = useCallback(() => {
    if (!activeSemanticMap || !activeBook) return;

    const chapters = useBookStore.getState().activeStructure?.chapters ?? EMPTY_CHAPTERS;

    // SINGLE SOURCE OF TRUTH: only images from the CURRENT generation may display, so
    // an orphan from a prior generation can never leak into the reader.
    const currentSceneIds = new Set(activeSemanticMap.scenes.map((scene) => scene.id));
    const scenesById = new Map(activeSemanticMap.scenes.map((scene) => [scene.id, scene]));
    const cachedImages = Object.values(useImageStore.getState().imageCache).filter((image) =>
      currentSceneIds.has(image.sceneId)
    );
    const readerPos = useReaderStore.getState().wordPosition;

    let current = useImageStore.getState().currentImage;
    if (current && !currentSceneIds.has(current.sceneId)) {
      setCurrentImage(null);
      setCurrentThemes([]);
      current = null;
    }

    // ONE deterministic rule, reading and jumps alike: show the slot at or before the
    // reader (the previous image is held until the next slot's image is ready); before
    // the first slot, show the first slot's image; never show a slot ahead of the reader.
    const displayImage = getDisplayImage(cachedImages, readerPos, chapters, scenesById);

    if (displayImage) {
      if (current?.id !== displayImage.id || current.filePath !== displayImage.filePath) {
        setCurrentImage(displayImage);
        setCurrentThemes(displayImage.emotionalThemes);
      }
    } else if (current) {
      // No current-generation image exists yet — show nothing.
      setCurrentImage(null);
      setCurrentThemes([]);
    }
  }, [activeSemanticMap, activeBook, setCurrentImage, setCurrentThemes]);

  // ── Queue only — runs when reader position changes, not on cache updates ──
  const updateQueue = useCallback(() => {
    if (!activeSemanticMap || !imageGenerationEnabled || !activeBook) return;

    const readerPos = useReaderStore.getState().wordPosition;
    if (readerPos === lastQueuePositionRef.current) return;
    lastQueuePositionRef.current = readerPos;

    const chapters = useBookStore.getState().activeStructure?.chapters ?? EMPTY_CHAPTERS;
    const activeStructure = useBookStore.getState().activeStructure;
    const canonicalScenes = segmentScenesForSemanticMap(activeSemanticMap.scenes, chapters, activeSemanticMap);
    const scenes = scenePositions(canonicalScenes, getSceneWordPosition);
    const store = useImageStore.getState();
    const cachedImages = Object.values(store.imageCache);
    const queue = store.queue;

    const positionDelta = readerPos - lastWordPositionRef.current;
    const isNavigationJump =
      Date.now() < store.navigationJumpUntil ||
      Math.abs(positionDelta) >= LUMINA_CONFIG.VISUAL_JUMP_THRESHOLD_WORDS;

    if (isPlanningRef.current && (isNavigationJump || Math.abs(positionDelta) > 0)) {
      useImageStore
        .getState()
        .setVisualPlanningNotice("Lumina is still preparing the current visual request. Let that finish before starting another.");
    }

    if (!isPlanningRef.current && activeStyleSeed && activeStructure) {
      const styleSeed = getStyleSeedById(activeStyleSeed);
      if (styleSeed) {
        isPlanningRef.current = true;
        useImageStore.getState().setVisualPlanningNotice(null);
        void (async () => {
          try {
            const apiKey = await storage.loadApiKey("lumina_google_ai_key").catch(() => "");
            const nextMap = await ensureVisualPlanBatch({
              semanticMap: activeSemanticMap,
              structure: activeStructure,
              styleSeed,
              interpretationLevel: useSettingsStore.getState().visualInterpretationLevel,
              apiKey: apiKey ?? "",
              wordPosition: readerPos,
              reason: isNavigationJump ? "jump" : "read_ahead",
            });
            if (nextMap !== activeSemanticMap) {
              useBookStore.getState().setActiveSemanticMap(nextMap);
            }
          } finally {
            isPlanningRef.current = false;
            useImageStore.getState().setVisualPlanningNotice(null);
          }
        })();
      }
    }

    const generatableScenes = scenes.filter(({ scene }) => {
      const beat = activeSemanticMap.storyboard?.beats.find((item) => item.sceneId === scene.id);
      return beat?.generationIntent !== "planned_only";
    });

    const hasAdvancedForward = positionDelta >= LUMINA_CONFIG.VISUAL_FORWARD_ADVANCE_WORDS;

    if (hasAdvancedForward && Date.now() < store.regenerateCooldownUntil) {
      useImageStore.setState({ regenerateCooldownUntil: 0 });
    }

    if (Date.now() < store.regenerateCooldownUntil) {
      lastWordPositionRef.current = readerPos;
      return;
    }

    if (isNavigationJump) {
      store.pruneQueueOutsideWindow(readerPos, LUMINA_CONFIG.VISUAL_JUMP_QUEUE_WINDOW_WORDS, 0);
    } else {
      store.pruneQueueOutsideWindow(readerPos, LUMINA_CONFIG.VISUAL_PRELOAD_DISTANCE_WORDS, 0);
    }

    lastWordPositionRef.current = readerPos;

    const passedGeneratableScenes = generatableScenes.filter(({ position }) => position <= readerPos);
    const governingPlannedScene = passedGeneratableScenes[passedGeneratableScenes.length - 1] ?? null;
    const governingSlotKey = governingPlannedScene
      ? visualSlotKeyForScene(governingPlannedScene.scene, chapters)
      : null;

    if (
      governingPlannedScene &&
      governingSlotKey &&
      !slotHasQueuedOrCachedImage(governingSlotKey, cachedImages, canonicalScenes, chapters, queue)
    ) {
      store.enqueue({
        sceneId: governingPlannedScene.scene.id,
        bookId: activeSemanticMap.bookId,
        wordPosition: governingPlannedScene.position,
        visualSlotKey: governingSlotKey,
        priority: 0,
        status: "pending",
        description:
          governingPlannedScene.scene.directorBrief?.finalPrompt ||
          governingPlannedScene.scene.imageDescription ||
          "",
      });
      diagnosticInfo("image.queue.enqueue", "Queued current missing visual anchor", {
        sceneId: governingPlannedScene.scene.id,
        visualSlotKey: governingSlotKey,
        wordPosition: readerPos,
      });
    }

    const preloadDistance = isNavigationJump
      ? LUMINA_CONFIG.VISUAL_JUMP_QUEUE_WINDOW_WORDS
      : LUMINA_CONFIG.VISUAL_PRELOAD_DISTANCE_WORDS;

    if (hasAdvancedForward && !isNavigationJump) {
      for (const { scene, position: scenePos } of generatableScenes) {
        const slotKey = visualSlotKeyForScene(scene, chapters);
        if (
          !slotKey ||
          slotHasQueuedOrCachedImage(
            slotKey,
            Object.values(useImageStore.getState().imageCache),
            canonicalScenes,
            chapters,
            useImageStore.getState().queue
          )
        ) {
          continue;
        }

        const distance = scenePos - readerPos;
        if (distance > 0 && distance <= preloadDistance) {
          store.enqueue({
            sceneId: scene.id,
            bookId: activeSemanticMap.bookId,
            wordPosition: scenePos,
            visualSlotKey: slotKey,
            priority: distance,
            status: "pending",
            description: scene.directorBrief?.finalPrompt || scene.imageDescription || "",
          });
        }
      }
    }
  }, [activeSemanticMap, imageGenerationEnabled, activeBook, getSceneWordPosition]);

  const processQueue = useCallback(async () => {
    if (getProvider() === "openrouter-free") {
      const running = freeGeneratingScenesRef.current;
      const semanticMap = activeSemanticMap;
      if (!semanticMap) return;

      while (running.size < FREE_IMAGE_MAX_CONCURRENT) {
        reconcileStaleGeneration();

        const store = useImageStore.getState();
        const next = store.dequeue();
        if (!next || next.status !== "pending") return;

        const scene = semanticMap.scenes.find((s) => s.id === next.sceneId);
        if (!scene) {
          store.updateQueueItemStatus(next.sceneId, "complete");
          continue;
        }

        const chapters = useBookStore.getState().activeStructure?.chapters ?? EMPTY_CHAPTERS;
        const readerPosition = useReaderStore.getState().wordPosition;
        const scenePosition =
          typeof next.wordPosition === "number"
            ? next.wordPosition
            : computeSceneWordPosition(scene, chapters);

        const aheadLimit =
          Date.now() < store.navigationJumpUntil
            ? LUMINA_CONFIG.VISUAL_JUMP_QUEUE_WINDOW_WORDS
            : LUMINA_CONFIG.VISUAL_PRELOAD_DISTANCE_WORDS;
        const sceneDelta = scenePosition - readerPosition;
        if (sceneDelta > aheadLimit || sceneDelta < -LUMINA_CONFIG.VISUAL_POSITION_MATCH_TOLERANCE) {
          store.updateQueueItemStatus(next.sceneId, "complete");
          continue;
        }

        const slotKey = visualSlotKeyForScene(scene, chapters) ?? next.visualSlotKey ?? null;
        if (!slotKey) {
          store.updateQueueItemStatus(next.sceneId, "complete");
          continue;
        }

        running.add(next.sceneId);
        store.updateQueueItemStatus(next.sceneId, "generating");

        void generateForVisualSlot({
          scene,
          bookId: next.bookId,
          fromQueue: true,
          onComplete: (img) => {
            if (activeStyleSeed) {
              const styleSeed = getStyleSeedById(activeStyleSeed);
              if (styleSeed) {
                priorPromptRef.current = extractPaletteContext(styleSeed, [img.descriptionUsed]);
              }
            }
          },
        })
          .then((result) => {
            const latest = useImageStore.getState();
            if (result.ok || result.reason === "cached") {
              latest.updateQueueItemStatus(next.sceneId, "complete");
            } else if (result.reason === "busy") {
              latest.updateQueueItemStatus(next.sceneId, "pending");
            } else if (result.reason === "error") {
              latest.updateQueueItemStatus(next.sceneId, "failed");
            } else {
              latest.updateQueueItemStatus(next.sceneId, "complete");
            }
          })
          .catch(() => {
            useImageStore.getState().updateQueueItemStatus(next.sceneId, "failed");
          })
          .finally(() => {
            freeGeneratingScenesRef.current.delete(next.sceneId);
            processQueueRef.current();
          });
      }
      return;
    }

    if (isGeneratingRef.current) return;

    reconcileStaleGeneration();

    const store = useImageStore.getState();
    const next = store.dequeue();
    if (!next || next.status !== "pending") return;

    const semanticMap = activeSemanticMap;
    if (!semanticMap) return;

    const scene = semanticMap.scenes.find((s) => s.id === next.sceneId);
    if (!scene) {
      store.updateQueueItemStatus(next.sceneId, "complete");
      return;
    }

    const chapters = useBookStore.getState().activeStructure?.chapters ?? EMPTY_CHAPTERS;
    const readerPosition = useReaderStore.getState().wordPosition;
    const scenePosition =
      typeof next.wordPosition === "number"
        ? next.wordPosition
        : computeSceneWordPosition(scene, chapters);

    const aheadLimit =
      Date.now() < store.navigationJumpUntil
        ? LUMINA_CONFIG.VISUAL_JUMP_QUEUE_WINDOW_WORDS
        : LUMINA_CONFIG.VISUAL_PRELOAD_DISTANCE_WORDS;
    const sceneDelta = scenePosition - readerPosition;
    if (sceneDelta > aheadLimit || sceneDelta < -LUMINA_CONFIG.VISUAL_POSITION_MATCH_TOLERANCE) {
      store.updateQueueItemStatus(next.sceneId, "complete");
      return;
    }

    const slotKey = visualSlotKeyForScene(scene, chapters) ?? next.visualSlotKey ?? null;
    if (!slotKey) {
      store.updateQueueItemStatus(next.sceneId, "complete");
      return;
    }

    if (store.isSlotBusy(slotKey) && store.activeGenerationSlot !== slotKey) {
      return;
    }

    isGeneratingRef.current = true;
    store.updateQueueItemStatus(next.sceneId, "generating");

    // Track every reader-triggered generation as its own job so the workflow
    // log shows all generation activity, not just manual/ingestion runs.
    // (startWorkflow is a no-op off Odysseus, so this is free for Gemini.)
    const { startWorkflow, trackStep, completeWorkflow } = await import("@/services/workflowTracker");
    const bookTitle = useBookStore.getState().activeBook?.title ?? "Book";
    const workflowId = await startWorkflow(
      "auto-image-generation",
      `${bookTitle} — auto scene image`,
      {
        book_id: next.bookId,
        book_title: bookTitle,
        scene_id: scene.id,
        visual_slot_key: slotKey,
        word_position: scenePosition,
        reader_position: readerPosition,
      },
      "Generate the next visual as the reader approaches it"
    );

    let result: SlotGenerationResult | null = null;
    let thrownError: unknown = null;
    try {
      result = await trackStep(
        workflowId,
        {
          name: "auto-scene-image",
          goal: "Generate and persist the upcoming visual slot image",
          agent: "image_director",
          skill: "scene-image-generation",
        },
        () =>
          generateForVisualSlot({
            scene,
            bookId: next.bookId,
            fromQueue: true,
            onComplete: (img) => {
              if (activeStyleSeed) {
                const styleSeed = getStyleSeedById(activeStyleSeed);
                if (styleSeed) {
                  priorPromptRef.current = extractPaletteContext(styleSeed, [img.descriptionUsed]);
                }
              }
            },
          }),
        (outcome) => ({
          metrics: {
            ok: outcome.ok,
            reason: outcome.ok ? "generated" : outcome.reason,
            error: outcome.ok ? null : outcome.error ?? null,
            scene_id: scene.id,
            visual_slot_key: slotKey,
            word_position: scenePosition,
            image_id: outcome.ok ? outcome.image.id : null,
          },
          // "busy" is backpressure — the single-flight guard correctly declined a
          // concurrent request; the queue item is requeued below. Treat it as a
          // benign deferral (like "cached"), not an image_director failure, so it
          // doesn't drag the run grade to 0 or generate false "scored 0%" findings.
          goal_achieved: outcome.ok ? 1 : outcome.reason === "cached" || outcome.reason === "busy" ? 0.75 : 0,
          unblocked_next: outcome.ok || outcome.reason === "cached" || outcome.reason === "busy",
        }),
        (err) => ({
          metrics: {
            ok: false,
            reason: "exception",
            scene_id: scene.id,
            visual_slot_key: slotKey,
            error: err instanceof Error ? err.message : String(err),
          },
          goal_achieved: 0,
          unblocked_next: false,
        })
      );
    } catch (err) {
      thrownError = err;
    } finally {
      await completeWorkflow(workflowId, {
        outcome_metrics: {
          scene_id: scene.id,
          visual_slot_key: slotKey,
          ok: result?.ok ?? false,
          reason: result ? (result.ok ? "generated" : result.reason) : "exception",
          error: result && !result.ok ? result.error ?? null : thrownError instanceof Error ? thrownError.message : thrownError ? String(thrownError) : null,
        },
      });
    }

    if (thrownError) {
      store.updateQueueItemStatus(next.sceneId, "failed");
      isGeneratingRef.current = false;
      return;
    }
    if (!result) {
      store.updateQueueItemStatus(next.sceneId, "failed");
      isGeneratingRef.current = false;
      return;
    }

    if (result.ok) {
      store.updateQueueItemStatus(next.sceneId, "complete");
    } else if (result.reason === "cached") {
      store.updateQueueItemStatus(next.sceneId, "complete");
    } else if (result.reason === "busy") {
      store.updateQueueItemStatus(next.sceneId, "pending");
    } else if (result.reason === "error") {
      store.updateQueueItemStatus(next.sceneId, "failed");
    } else {
      store.updateQueueItemStatus(next.sceneId, "complete");
    }

    isGeneratingRef.current = false;
  }, [activeSemanticMap, activeStyleSeed]);

  const updateDisplayRef = useRef(updateDisplay);
  const updateQueueRef = useRef(updateQueue);
  const processQueueRef = useRef(processQueue);
  updateDisplayRef.current = updateDisplay;
  updateQueueRef.current = updateQueue;
  processQueueRef.current = processQueue;

  useEffect(() => {
    updateDisplayRef.current();
  }, [wordPosition, imageCache]);

  useEffect(() => {
    updateQueueRef.current();
  }, [wordPosition]);

  useEffect(() => {
    if (!activeSemanticMap) return;
    lastQueuePositionRef.current = -1;
    updateQueueRef.current();
  }, [activeSemanticMap?.bookId, activeSemanticMap?.visualPlanVersion]);

  useEffect(() => {
    processQueueRef.current();
  }, [activeSemanticMap?.bookId, activeSemanticMap?.visualPlanVersion, activeStyleSeed, pendingQueueCount]);

  useEffect(() => {
    const interval = setInterval(() => {
      reconcileStaleGeneration();
      processQueueRef.current();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return { isGenerating: useImageStore((s) => s.isGenerating) };
}
