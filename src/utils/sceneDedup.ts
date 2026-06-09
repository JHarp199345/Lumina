/**
 * sceneDedup — strict one visual slot per EPUB reading chapter/section.
 */

import type { BookStructure, Chapter, IdentifiedScene, MacroArc } from "@/types";
import { computeSceneWordPosition } from "@/utils/scenePosition";

const MIN_CHAPTER_WORDS = 120;

function scenePriority(scene: IdentifiedScene): number {
  if (scene.inflectionPointId === "opening") return 100;
  if (scene.inflectionPointId === "reader_selected") return 90;
  if (!scene.inflectionPointId.startsWith("planned_")) return 70;
  return 40;
}

export function shouldPreferScene(candidate: IdentifiedScene, incumbent: IdentifiedScene): boolean {
  const candidatePriority = scenePriority(candidate);
  const incumbentPriority = scenePriority(incumbent);
  if (candidatePriority !== incumbentPriority) {
    return candidatePriority > incumbentPriority;
  }
  return (candidate.narrativeWeight ?? 0) > (incumbent.narrativeWeight ?? 0);
}

/** Keep the single best scene when multiple candidates target the same chapter. */
export function pickBestScenePerChapter(scenes: IdentifiedScene[]): Map<string, IdentifiedScene> {
  const byChapter = new Map<string, IdentifiedScene>();
  for (const scene of scenes) {
    const existing = byChapter.get(scene.chapterId);
    if (!existing || shouldPreferScene(scene, existing)) {
      byChapter.set(scene.chapterId, scene);
    }
  }
  return byChapter;
}

/**
 * Gallery / stale-plan safety net: one timeline entry per reading chapter, in order.
 */
export function segmentScenesOnePerChapter(
  scenes: IdentifiedScene[],
  chapters: Chapter[],
  minChapterWords = MIN_CHAPTER_WORDS
): IdentifiedScene[] {
  const byChapter = pickBestScenePerChapter(scenes);
  const result: IdentifiedScene[] = [];

  for (const chapter of chapters) {
    if (chapter.wordCount < minChapterWords) continue;
    const scene = byChapter.get(chapter.id);
    if (scene) result.push(scene);
  }

  return result;
}

export interface BuildPlannedChapterScene {
  (chapter: Chapter, structure: BookStructure, macroArc: MacroArc): IdentifiedScene;
}

/**
 * Analysis output: exactly one visual anchor per substantial reading chapter.
 * Directed beats (opening / inflection) win over planned filler for that chapter.
 */
export function buildChapterVisualPlan(
  structure: BookStructure,
  macroArc: MacroArc,
  directedScenes: IdentifiedScene[],
  buildPlanned: BuildPlannedChapterScene
): IdentifiedScene[] {
  const directedByChapter = pickBestScenePerChapter(directedScenes);
  const plan: IdentifiedScene[] = [];

  for (const chapter of structure.chapters) {
    if (!chapter.rawText || chapter.wordCount < MIN_CHAPTER_WORDS) continue;

    const directed = directedByChapter.get(chapter.id);
    if (directed) {
      plan.push(directed);
      continue;
    }

    plan.push(buildPlanned(chapter, structure, macroArc));
  }

  return plan;
}

/** @deprecated Use segmentScenesOnePerChapter — word bands still allowed duplicate chapters. */
export function dedupeScenesByWordPosition(
  scenes: IdentifiedScene[],
  chapters: Chapter[]
): IdentifiedScene[] {
  return segmentScenesOnePerChapter(scenes, chapters);
}

export function dedupeScenesForStructure(
  scenes: IdentifiedScene[],
  structure: BookStructure
): IdentifiedScene[] {
  return segmentScenesOnePerChapter(scenes, structure.chapters);
}

export function scenePositionKey(scene: IdentifiedScene, chapters: Chapter[]): number {
  return computeSceneWordPosition(scene, chapters);
}
