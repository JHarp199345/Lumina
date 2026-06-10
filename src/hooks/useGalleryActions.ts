import { useCallback } from "react";
import { useBookStore } from "@/store/bookStore";
import { useImageStore } from "@/store/imageStore";
import { useReaderStore } from "@/store/readerStore";
import { useUiStore } from "@/store/uiStore";
import { generateImage } from "@/pipeline/imageGenerator";
import { getStyleSeedById } from "@/data/styleSeeds";
import { storage } from "@/storage";
import { computeSceneWordPosition } from "@/utils/scenePosition";
import {
  segmentScenesForSemanticMap,
  slotHasQueuedOrCachedImage,
  visualSlotKeyForScene,
} from "@/utils/sceneDedup";
import { EMPTY_CHAPTERS } from "@/utils/stableEmpty";
import { getProvider } from "@/api/llmClient";

export function useGalleryActions() {
  const visitPassage = useCallback((sceneId: string) => {
    const { activeSemanticMap } = useBookStore.getState();
    const scene = activeSemanticMap?.scenes.find((s) => s.id === sceneId);
    if (!scene) return;

    const currentCfi = useReaderStore.getState().currentCfi;
    if (currentCfi) useUiStore.getState().setReturnCfi(currentCfi);

    const win = window as Window & {
      luminaNavigateToScene?: (target: string, wordOffset?: number) => void;
      luminaNavigate?: (target: string) => void;
    };
    const chapters = useBookStore.getState().activeStructure?.chapters ?? EMPTY_CHAPTERS;
    const chapterIndex = chapters.find((ch) => ch.id === scene.chapterId)?.index;
    if (win.luminaNavigateToScene) {
      win.luminaNavigateToScene(scene.chapterId, scene.anchor?.wordOffset ?? 0);
    } else if (chapterIndex !== undefined) {
      win.luminaNavigate?.(`lumina://chapter/${chapterIndex}/page/0`);
    }
    useUiStore.getState().closeGallery();
  }, []);

  const generateForScene = useCallback(async (sceneId: string) => {
    const { activeBook, activeSemanticMap, activeStyleSeed } = useBookStore.getState();
    if (!activeBook || !activeSemanticMap || !activeStyleSeed) return;

    const scene = activeSemanticMap.scenes.find((s) => s.id === sceneId);
    if (!scene) return;

    const chapters = useBookStore.getState().activeStructure?.chapters ?? EMPTY_CHAPTERS;
    const canonicalScenes = segmentScenesForSemanticMap(activeSemanticMap.scenes, chapters, activeSemanticMap);
    const slotKey = visualSlotKeyForScene(scene, chapters);
    const store = useImageStore.getState();
    if (
      !slotKey ||
      slotHasQueuedOrCachedImage(
        slotKey,
        Object.values(store.imageCache),
        canonicalScenes,
        chapters,
        store.queue
      ) ||
      store.getCachedImageForSlot(slotKey)
    ) {
      return;
    }

    if (!store.claimGenerationSlot(slotKey)) return;

    const googleKey = await storage.loadApiKey("lumina_google_ai_key");
    const falKey = await storage.loadApiKey("lumina_fal_key");
    const styleSeed = getStyleSeedById(activeStyleSeed);
    if ((!googleKey && getProvider() === "gemini") || !styleSeed) {
      store.releaseGenerationSlot();
      return;
    }

    try {
      await generateImage({
        scene,
        styleSeed,
        bookId: activeBook.id,
        wordPosition: computeSceneWordPosition(scene, chapters),
        visualSlotKey: slotKey,
        googleApiKey: googleKey ?? "",
        falApiKey: falKey ?? undefined,
        onComplete: async (img) => {
          store.addToCache(img);
        },
      });
    } finally {
      store.releaseGenerationSlot();
    }
  }, []);

  return { visitPassage, generateForScene };
}
