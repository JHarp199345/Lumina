/**
 * sceneDedup — one visual anchor per word-position band.
 *
 * Gutenberg / junk TOC output can yield many tiny chapters that share the same
 * spine file and offset. Analysis may also stack opening + inflection + planned
 * scenes on top of each other. Collapse collisions so the gallery and trigger
 * each map to a single scene per reading segment.
 */

import { LUMINA_CONFIG } from "@/config";
import type { BookStructure, Chapter, IdentifiedScene } from "@/types";
import { computeSceneWordPosition } from "@/utils/scenePosition";

function scenePriority(scene: IdentifiedScene): number {
  if (scene.inflectionPointId === "opening") return 100;
  if (scene.inflectionPointId === "reader_selected") return 90;
  if (!scene.inflectionPointId.startsWith("planned_")) return 70;
  return 40;
}

function shouldPreferScene(candidate: IdentifiedScene, incumbent: IdentifiedScene): boolean {
  const candidatePriority = scenePriority(candidate);
  const incumbentPriority = scenePriority(incumbent);
  if (candidatePriority !== incumbentPriority) {
    return candidatePriority > incumbentPriority;
  }
  return (candidate.narrativeWeight ?? 0) > (incumbent.narrativeWeight ?? 0);
}

export function dedupeScenesByWordPosition(
  scenes: IdentifiedScene[],
  chapters: Chapter[],
  minSeparationWords = LUMINA_CONFIG.VISUAL_MIN_SCENE_SEPARATION_WORDS
): IdentifiedScene[] {
  if (scenes.length <= 1) return scenes;

  const sorted = [...scenes].sort(
    (a, b) => computeSceneWordPosition(a, chapters) - computeSceneWordPosition(b, chapters)
  );

  const kept: IdentifiedScene[] = [];

  for (const scene of sorted) {
    const position = computeSceneWordPosition(scene, chapters);
    const last = kept[kept.length - 1];
    if (!last) {
      kept.push(scene);
      continue;
    }

    const lastPosition = computeSceneWordPosition(last, chapters);
    if (position - lastPosition < minSeparationWords) {
      if (shouldPreferScene(scene, last)) {
        kept[kept.length - 1] = scene;
      }
      continue;
    }

    kept.push(scene);
  }

  return kept;
}

export function isWordPositionCovered(
  position: number,
  scenes: IdentifiedScene[],
  chapters: Chapter[],
  minSeparationWords = LUMINA_CONFIG.VISUAL_MIN_SCENE_SEPARATION_WORDS
): boolean {
  return scenes.some((scene) => {
    const scenePosition = computeSceneWordPosition(scene, chapters);
    return Math.abs(scenePosition - position) < minSeparationWords;
  });
}

export function dedupeScenesForStructure(
  scenes: IdentifiedScene[],
  structure: BookStructure
): IdentifiedScene[] {
  return dedupeScenesByWordPosition(scenes, structure.chapters);
}
