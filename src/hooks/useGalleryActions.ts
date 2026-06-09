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
  segmentScenesOnePerSlot,
  slotHasQueuedOrCachedImage,
  visualSlotKeyForScene,
} from "@/utils/sceneDedup";

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
    const target = scene.anchor?.href || scene.chapterId;
    if (win.luminaNavigateToScene) {
      win.luminaNavigateToScene(target, scene.anchor?.wordOffset ?? 0);
    } else {
      win.luminaNavigate?.(target);
    }
    useUiStore.getState().closeGallery();
  }, []);

  const generateForScene = useCallback(async (sceneId: string) => {
    const { activeBook, activeSemanticMap, activeStyleSeed } = useBookStore.getState();
    if (!activeBook || !activeSemanticMap || !activeStyleSeed) return;

    const scene = activeSemanticMap.scenes.find((s) => s.id === sceneId);
    if (!scene) return;

    const chapters = useBookStore.getState().activeStructure?.chapters ?? [];
    const canonicalScenes = segmentScenesOnePerSlot(activeSemanticMap.scenes, chapters);
    const slotKey = visualSlotKeyForScene(scene, chapters);
    if (
      slotKey &&
      slotHasQueuedOrCachedImage(
        slotKey,
        Object.values(useImageStore.getState().imageCache),
        canonicalScenes,
        chapters,
        useImageStore.getState().queue
      )
    ) {
      return;
    }

    const googleKey = await storage.loadApiKey("lumina_google_ai_key");
    const falKey = await storage.loadApiKey("lumina_fal_key");
    const styleSeed = getStyleSeedById(activeStyleSeed);
    if (!googleKey || !styleSeed) return;

    await generateImage({
      scene,
      styleSeed,
      bookId: activeBook.id,
      wordPosition: computeSceneWordPosition(scene, chapters),
      googleApiKey: googleKey,
      falApiKey: falKey ?? undefined,
      onComplete: async (img) => {
        useImageStore.getState().addToCache(img);
      },
    });
  }, []);

  return { visitPassage, generateForScene };
}
