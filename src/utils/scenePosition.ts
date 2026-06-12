/**
 * scenePosition — shared word-position calculation for scenes.
 *
 * Used by both useImageTrigger (display logic) and useBookOrchestration
 * (image restore on book re-open) so both use identical math.
 */

import type { IdentifiedScene, Chapter } from "@/types";

/**
 * Returns the estimated absolute word position of a scene within the full book.
 * Uses the scene's structural anchor (spineIndex + wordOffset) for reliability.
 * Falls back to chapter-start position if anchor is unavailable.
 */
export function computeSceneWordPosition(
  scene: IdentifiedScene,
  chapters: Chapter[]
): number {
  if (!chapters.length) return 0;

  const anchor = scene.anchor;

  if (anchor) {
    // Prefer spineIndex match — most reliable
    const chapter =
      chapters.find((ch) => ch.spineIndex === anchor.spineIndex) ??
      chapters.find((ch) => ch.id === scene.chapterId);

    if (!chapter) return 0;

    const wordsBefore = chapters
      .slice(0, chapter.index)
      .reduce((sum, ch) => sum + ch.wordCount, 0);

    return wordsBefore + anchor.wordOffset;
  }

  // Legacy fallback: chapter lookup by id only, no word offset
  const chapter = chapters.find((ch) => ch.id === scene.chapterId);
  if (!chapter) return 0;

  return chapters
    .slice(0, chapter.index)
    .reduce((sum, ch) => sum + ch.wordCount, 0);
}

export function sceneWordPositions(
  scenes: IdentifiedScene[],
  chapters: Chapter[]
): Array<{ scene: IdentifiedScene; position: number }> {
  return scenes
    .map((scene) => ({ scene, position: computeSceneWordPosition(scene, chapters) }))
    .sort((a, b) => a.position - b.position);
}

export function getCurrentPlannedScene(
  scenes: IdentifiedScene[],
  wordPosition: number,
  chapters: Chapter[]
): IdentifiedScene | null {
  const positioned = sceneWordPositions(scenes, chapters);
  if (positioned.length === 0) return null;

  let current = positioned[0];
  for (const item of positioned) {
    if (item.position > wordPosition) break;
    current = item;
  }
  return current.scene;
}
