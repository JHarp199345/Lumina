/**
 * imagePosition — word-index anchoring for cached images.
 *
 * Images are governed by absolute word position (0…N), not volatile scene ids.
 * Scene ids may change on re-analysis; word positions do not.
 */

import type { CachedImage, Chapter, IdentifiedScene } from "@/types";
import { computeSceneWordPosition } from "@/utils/scenePosition";

export function resolveImageWordPosition(
  image: CachedImage,
  chapters: Chapter[],
  scene?: IdentifiedScene
): number {
  if (typeof image.wordPosition === "number" && image.wordPosition >= 0) {
    return image.wordPosition;
  }
  if (scene) {
    return computeSceneWordPosition(scene, chapters);
  }
  return -1;
}

export function getGoverningImage(
  images: CachedImage[],
  wordPosition: number,
  chapters: Chapter[],
  scenesById?: Map<string, IdentifiedScene>
): CachedImage | null {
  let best: CachedImage | null = null;
  let bestPos = -1;

  for (const image of images) {
    const scene = scenesById?.get(image.sceneId);
    const pos = resolveImageWordPosition(image, chapters, scene);
    if (pos < 0) continue;
    if (pos <= wordPosition && pos > bestPos) {
      best = image;
      bestPos = pos;
    }
  }

  return best;
}

export function findImageAtPosition(
  images: Iterable<CachedImage>,
  position: number,
  chapters: Chapter[],
  scenesById?: Map<string, IdentifiedScene>
): CachedImage | undefined {
  for (const image of images) {
    const scene = scenesById?.get(image.sceneId);
    if (resolveImageWordPosition(image, chapters, scene) === position) {
      return image;
    }
  }
  return undefined;
}

export function getImageForScene(
  scene: IdentifiedScene,
  images: Iterable<CachedImage>,
  chapters: Chapter[]
): CachedImage | undefined {
  const position = computeSceneWordPosition(scene, chapters);
  const imageList = Array.from(images);
  const byPosition = findImageAtPosition(imageList, position, chapters);
  if (byPosition) return byPosition;
  return imageList.find((image) => image.sceneId === scene.id);
}

export function hydrateImageWordPositions(
  images: CachedImage[],
  scenes: IdentifiedScene[],
  chapters: Chapter[]
): CachedImage[] {
  const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));
  return images.map((image) => {
    if (typeof image.wordPosition === "number" && image.wordPosition >= 0) {
      return image;
    }
    const scene = scenesById.get(image.sceneId);
    if (!scene) return image;
    return { ...image, wordPosition: computeSceneWordPosition(scene, chapters) };
  });
}

export function hasPositionedImages(
  images: Iterable<CachedImage>,
  chapters: Chapter[],
  scenesById?: Map<string, IdentifiedScene>
): boolean {
  for (const image of images) {
    const scene = scenesById?.get(image.sceneId);
    if (resolveImageWordPosition(image, chapters, scene) >= 0) return true;
  }
  return false;
}
