import { useCallback } from "react";
import { useBookStore } from "@/store/bookStore";
import { useReaderStore } from "@/store/readerStore";
import { useUiStore } from "@/store/uiStore";
import { generateForVisualSlot } from "@/services/slotImageGeneration";
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
    const { activeBook, activeSemanticMap } = useBookStore.getState();
    if (!activeBook || !activeSemanticMap) return;

    const scene = activeSemanticMap.scenes.find((s) => s.id === sceneId);
    if (!scene) return;

    const result = await generateForVisualSlot({
      scene,
      bookId: activeBook.id,
      force: true,
    });

    if (!result.ok && result.reason === "error") {
      throw new Error(result.error || "Image generation failed");
    }
  }, []);

  return { visitPassage, generateForScene };
}
