import { useCallback } from "react";
import { useBookStore } from "@/store/bookStore";
import { useReaderStore } from "@/store/readerStore";
import { useUiStore } from "@/store/uiStore";
import { generateForVisualSlot } from "@/services/slotImageGeneration";
import { computeSceneWordPosition } from "@/utils/scenePosition";
import { visualSlotKeyForScene } from "@/utils/sceneDedup";
import { EMPTY_CHAPTERS } from "@/utils/stableEmpty";

export function useGalleryActions() {
  const visitPassage = useCallback((sceneId: string) => {
    const { activeSemanticMap } = useBookStore.getState();
    const scene = activeSemanticMap?.scenes.find((s) => s.id === sceneId);
    if (!scene) return;

    const currentCfi = useReaderStore.getState().currentCfi;
    const ui = useUiStore.getState();
    if (currentCfi) ui.setReturnCfi(currentCfi);

    const win = window as Window & {
      luminaNavigateToScene?: (target: string, wordOffset?: number) => void;
      luminaNavigate?: (target: string) => void;
    };
    const chapters = useBookStore.getState().activeStructure?.chapters ?? EMPTY_CHAPTERS;
    const chapterIndex = chapters.find((ch) => ch.id === scene.chapterId)?.index;
    if (win.luminaNavigateToScene) {
      win.luminaNavigateToScene(scene.chapterId, scene.anchor?.wordOffset ?? 0);
    } else if (chapterIndex !== undefined) {
      const target = `lumina://chapter/${chapterIndex}/page/0`;
      if (win.luminaNavigate) win.luminaNavigate(target);
      else ui.requestReaderNavigation(target);
    } else {
      ui.requestReaderNavigation(scene.chapterId, scene.anchor?.wordOffset ?? 0);
    }
    ui.setPhonePanel("reader");
    ui.closeGallery();
  }, []);

  const generateForScene = useCallback(async (sceneId: string) => {
    const { activeBook, activeSemanticMap, activeStructure } = useBookStore.getState();
    if (!activeBook || !activeSemanticMap) return;

    const scene = activeSemanticMap.scenes.find((s) => s.id === sceneId);
    if (!scene) return;

    const chapters = activeStructure?.chapters ?? EMPTY_CHAPTERS;
    const wordPosition = computeSceneWordPosition(scene, chapters);
    const visualSlotKey = visualSlotKeyForScene(scene, chapters);
    const { startWorkflow, trackStep, completeWorkflow } = await import("@/services/workflowTracker");
    const workflowId = await startWorkflow(
      "manual-image-generation",
      `${activeBook.title} — manual scene image`,
      {
        book_id: activeBook.id,
        book_title: activeBook.title,
        scene_id: scene.id,
        visual_slot_key: visualSlotKey,
        word_position: wordPosition,
      },
      "Generate one user-requested visual story image"
    );

    const result = await trackStep(
      workflowId,
      {
        name: "manual-scene-image",
        goal: "Generate and persist the requested visual slot image",
        agent: "image_director",
        skill: "scene-image-generation",
      },
      () =>
        generateForVisualSlot({
          scene,
          bookId: activeBook.id,
          force: true,
        }),
      (outcome) => ({
        metrics: {
          ok: outcome.ok,
          reason: outcome.ok ? "generated" : outcome.reason,
          scene_id: scene.id,
          visual_slot_key: visualSlotKey,
          word_position: wordPosition,
          image_id: outcome.ok ? outcome.image.id : null,
        },
        goal_achieved: outcome.ok ? 1 : outcome.reason === "cached" ? 0.75 : 0,
        unblocked_next: outcome.ok || outcome.reason === "cached",
      }),
      (err) => ({
        metrics: {
          scene_id: scene.id,
          visual_slot_key: visualSlotKey,
          word_position: wordPosition,
          error: err instanceof Error ? err.message : String(err),
        },
        goal_achieved: 0,
        unblocked_next: true,
      })
    );

    await completeWorkflow(workflowId, {
      outcome_metrics: {
        scene_id: scene.id,
        visual_slot_key: visualSlotKey,
        ok: result.ok,
        reason: result.ok ? "generated" : result.reason,
      },
    });

    if (!result.ok && result.reason === "error") {
      throw new Error(result.error || "Image generation failed");
    }
  }, []);

  return { visitPassage, generateForScene };
}
