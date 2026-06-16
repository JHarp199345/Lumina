/**
 * imagePosition — word-index anchoring for cached images.
 *
 * Images are governed by absolute word position (0…N), not volatile scene ids.
 * Scene ids may change on re-analysis; word positions do not.
 */

import type { CachedImage, Chapter, IdentifiedScene } from "@/types";
import { computeSceneWordPosition } from "@/utils/scenePosition";
import { findImageForVisualSlot, visualSlotKeyForScene } from "@/utils/sceneDedup";

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
    // When a current-generation scene map is provided, it is authoritative: an image
    // whose scene is not in the current generation is an orphan and must never govern
    // the display (prevents a prior generation's art from leaking into the reader).
    if (scenesById && !scenesById.has(image.sceneId)) continue;
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

/** Earliest positioned image strictly after the reader (section preview hold). */
export function getPreviewImage(
  images: CachedImage[],
  wordPosition: number,
  chapters: Chapter[],
  scenesById?: Map<string, IdentifiedScene>
): CachedImage | null {
  let best: CachedImage | null = null;
  let bestPos = Infinity;

  for (const image of images) {
    if (scenesById && !scenesById.has(image.sceneId)) continue;
    const scene = scenesById?.get(image.sceneId);
    const pos = resolveImageWordPosition(image, chapters, scene);
    if (pos < 0 || pos <= wordPosition) continue;
    if (pos < bestPos) {
      best = image;
      bestPos = pos;
    }
  }

  return best;
}

/**
 * Image to show on the visual panel: the governing anchor at or before the
 * reader, or — when still before the first anchor — the next upcoming image
 * so the panel is never blank while art exists for the current section.
 */
export function getDisplayImage(
  images: CachedImage[],
  wordPosition: number,
  chapters: Chapter[],
  scenesById?: Map<string, IdentifiedScene>
): CachedImage | null {
  return (
    getGoverningImage(images, wordPosition, chapters, scenesById) ??
    getPreviewImage(images, wordPosition, chapters, scenesById)
  );
}

export function findImageAtPosition(
  images: Iterable<CachedImage>,
  position: number,
  chapters: Chapter[],
  scenesById?: Map<string, IdentifiedScene>,
  tolerance = 0
): CachedImage | undefined {
  let best: CachedImage | undefined;
  let bestDistance = tolerance >= 0 ? tolerance + 1 : 1;

  for (const image of images) {
    const scene = scenesById?.get(image.sceneId);
    const imagePosition = resolveImageWordPosition(image, chapters, scene);
    if (imagePosition < 0) continue;

    if (tolerance <= 0) {
      if (imagePosition === position) return image;
      continue;
    }

    const distance = Math.abs(imagePosition - position);
    if (distance <= tolerance && distance < bestDistance) {
      best = image;
      bestDistance = distance;
    }
  }

  return best;
}

/** Most-recently generated image wins when several map to the same target. */
function newestImage(candidates: CachedImage[]): CachedImage | undefined {
  if (candidates.length <= 1) return candidates[0];
  return candidates.reduce((best, image) =>
    (image.generatedAt ?? "") > (best.generatedAt ?? "") ? image : best
  );
}

export function getImageForScene(
  scene: IdentifiedScene,
  images: Iterable<CachedImage>,
  chapters: Chapter[] = [],
  scenes: IdentifiedScene[] = []
): CachedImage | undefined {
  const list = Array.from(images);
  // A passage can accumulate more than one cached image (e.g. a regenerate that
  // appended instead of replacing). Prefer the newest so a fresh image is never
  // overshadowed by an older, worse one left in the cache.
  const direct = newestImage(list.filter((image) => image.sceneId === scene.id));
  if (direct) return direct;

  if (chapters.length === 0 || scenes.length === 0) return undefined;

  const slotKey = visualSlotKeyForScene(scene, chapters);
  if (!slotKey) return undefined;
  return findImageForVisualSlot(slotKey, list, scenes, chapters);
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
