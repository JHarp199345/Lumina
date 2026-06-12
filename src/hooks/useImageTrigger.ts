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
import { ensureVisualPlanBatch } from "@/services/visualPlanBatching";
import { storage } from "@/storage";
import { getStyleSeedById } from "@/data/styleSeeds";
import { LUMINA_CONFIG } from "@/config";

import { computeSceneWordPosition } from "@/utils/scenePosition";
import {
  getDisplayImage,
  getGoverningImage,
  hasPositionedImages,
  resolveImageWordPosition,
} from "@/utils/imagePosition";
import {
  segmentScenesForSemanticMap,
  slotHasQueuedOrCachedImage,
  visualSlotKeyForScene,
} from "@/utils/sceneDedup";
import { EMPTY_CHAPTERS } from "@/utils/stableEmpty";
import { diagnosticInfo } from "@/utils/diagnostics";
import type { IdentifiedScene } from "@/types";

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
  const isPlanningRef = useRef(false);
  const priorPromptRef = useRef<string>("");
  const lastDisplayDecisionRef = useRef<string>("");
  const lastWordPositionRef = useRef(0);
  const lastQueuePositionRef = useRef(-1);

  useEffect(() => {
    priorPromptRef.current = "";
    lastDisplayDecisionRef.current = "";
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

    // SINGLE SOURCE OF TRUTH: only images belonging to the CURRENT generation may
    // govern the display — the same scene-membership scope the gallery uses. Without
    // this, an orphaned image from a prior generation (e.g. an expository diagram from
    // a wrong classification) could win by raw word position and show in the reader
    // while the gallery showed a different, current image.
    const currentSceneIds = new Set(activeSemanticMap.scenes.map((scene) => scene.id));
    const allCached = Object.values(useImageStore.getState().imageCache);
    const cachedImages = allCached.filter((image) => currentSceneIds.has(image.sceneId));

    let current = useImageStore.getState().currentImage;
    const readerPos = useReaderStore.getState().wordPosition;

    // If the currently displayed image is an orphan from a prior generation, drop it
    // immediately so it can never linger in any view.
    if (current && !currentSceneIds.has(current.sceneId)) {
      setCurrentImage(null);
      setCurrentThemes([]);
      current = null;
    }

    const displayImage = getDisplayImage(cachedImages, readerPos, chapters);
    const governingImage = getGoverningImage(cachedImages, readerPos, chapters);
    const currentImagePosition =
      current && chapters.length > 0 ? resolveImageWordPosition(current, chapters) : -1;

    const nextPositionedImage = cachedImages
      .map((image) => ({ image, position: resolveImageWordPosition(image, chapters) }))
      .filter(({ position }) => position > readerPos)
      .sort((a, b) => a.position - b.position)[0] ?? null;

    if (displayImage) {
      const displayPos = resolveImageWordPosition(displayImage, chapters);
      const isPreview = !governingImage || governingImage.id !== displayImage.id;

      if (current?.id !== displayImage.id || current.filePath !== displayImage.filePath) {
        setCurrentImage(displayImage);
        setCurrentThemes(displayImage.emotionalThemes);
      } else {
        const decisionSignature = [
          displayImage.id,
          current?.id ?? "none",
          readerPos,
          nextPositionedImage?.position ?? "none",
          cachedImages.length,
          isPreview ? "preview-hold" : "hold",
        ].join("|");

        if (decisionSignature !== lastDisplayDecisionRef.current) {
          lastDisplayDecisionRef.current = decisionSignature;
          diagnosticInfo("image.display.hold", "Holding visual segment", {
            governingSceneId: displayImage.sceneId,
            wordPosition: readerPos,
            imageWordPosition: displayPos,
          });
        }
      }
    } else if (current && hasPositionedImages(cachedImages, chapters)) {
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

    if (!isPlanningRef.current && activeStyleSeed && activeStructure) {
      const styleSeed = getStyleSeedById(activeStyleSeed);
      if (styleSeed) {
        isPlanningRef.current = true;
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

    const result = await generateForVisualSlot({
      scene,
      bookId: next.bookId,
      onComplete: (img) => {
        if (activeStyleSeed) {
          const styleSeed = getStyleSeedById(activeStyleSeed);
          if (styleSeed) {
            priorPromptRef.current = extractPaletteContext(styleSeed, [img.descriptionUsed]);
          }
        }
      },
    });

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
