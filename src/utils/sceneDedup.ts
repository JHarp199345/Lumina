/**
 * sceneDedup — one visual slot per EPUB HTML section (spine + href).
 *
 * Gutenberg TOC junk often creates many chapter IDs pointing at the same file.
 * The semantic map and gallery must never carry more than one scene per slot.
 */

import type { BookStructure, Chapter, IdentifiedScene, MacroArc, CachedImage } from "@/types";
import { computeSceneWordPosition } from "@/utils/scenePosition";

const MIN_PLANNED_CHAPTER_WORDS = 400;

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

/**
 * One slot per physical EPUB HTML file (fragment stripped).
 * TOC rows that point at the same file with different anchors must not multiply slots.
 */
export function visualSlotKey(chapter: Chapter): string {
  const fileHref = chapter.href.split("#")[0] || chapter.href;
  return fileHref;
}

export function visualSlotKeyForScene(
  scene: IdentifiedScene,
  chapters: Chapter[]
): string | null {
  const chapter =
    chapters.find((ch) => ch.id === scene.chapterId) ??
    chapters.find((ch) => ch.spineIndex === scene.anchor?.spineIndex);
  return chapter ? visualSlotKey(chapter) : null;
}

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

export function pickBestScenePerSlot(
  scenes: IdentifiedScene[],
  chapters: Chapter[]
): Map<string, IdentifiedScene> {
  const groups = new Map<string, IdentifiedScene[]>();

  for (const scene of scenes) {
    const slot = visualSlotKeyForScene(scene, chapters);
    if (!slot) continue;
    const group = groups.get(slot) ?? [];
    group.push(scene);
    groups.set(slot, group);
  }

  const bySlot = new Map<string, IdentifiedScene>();
  for (const [slot, group] of groups) {
    const best = group.reduce((incumbent, candidate) =>
      shouldPreferScene(candidate, incumbent) ? candidate : incumbent
    );
    bySlot.set(slot, best);
  }
  return bySlot;
}

export function findImageForVisualSlot(
  slotKey: string,
  images: Iterable<CachedImage>,
  scenes: IdentifiedScene[],
  chapters: Chapter[]
): CachedImage | undefined {
  for (const image of images) {
    const scene = scenes.find((item) => item.id === image.sceneId);
    if (!scene) continue;
    if (visualSlotKeyForScene(scene, chapters) === slotKey) return image;
  }
  return undefined;
}

/**
 * Timeline / gallery: exactly one entry per EPUB section, in reading order.
 */
export function segmentScenesOnePerSlot(
  scenes: IdentifiedScene[],
  chapters: Chapter[]
): IdentifiedScene[] {
  const bySlot = pickBestScenePerSlot(scenes, chapters);
  const usedSlots = new Set<string>();
  const result: IdentifiedScene[] = [];

  for (const chapter of chapters) {
    const slot = visualSlotKey(chapter);
    if (usedSlots.has(slot)) continue;

    const scene = bySlot.get(slot);
    if (!scene) continue;

    usedSlots.add(slot);
    result.push(scene);
  }

  if (result.length > 0) return result;

  const canonical = [...bySlot.values()].sort(
    (a, b) => computeSceneWordPosition(a, chapters) - computeSceneWordPosition(b, chapters)
  );
  if (canonical.length > 0) return canonical;

  return [...scenes].sort(
    (a, b) => computeSceneWordPosition(a, chapters) - computeSceneWordPosition(b, chapters)
  );
}

export interface BuildPlannedChapterScene {
  (chapter: Chapter, structure: BookStructure, macroArc: MacroArc): IdentifiedScene;
}

/**
 * Analysis output: one scene in the stored semantic map per EPUB HTML section.
 */
export function buildVisualSlotPlan(
  structure: BookStructure,
  macroArc: MacroArc,
  directedScenes: IdentifiedScene[],
  buildPlanned: BuildPlannedChapterScene
): IdentifiedScene[] {
  const directedByChapter = pickBestScenePerChapter(directedScenes);
  const usedSlots = new Set<string>();
  const plan: IdentifiedScene[] = [];

  for (const chapter of structure.chapters) {
    if (!chapter.rawText) continue;

    const slot = visualSlotKey(chapter);
    if (usedSlots.has(slot)) continue;

    const directed = directedByChapter.get(chapter.id);
    if (!directed && chapter.wordCount < MIN_PLANNED_CHAPTER_WORDS) continue;

    usedSlots.add(slot);
    plan.push(directed ?? buildPlanned(chapter, structure, macroArc));
  }

  return plan;
}

/** @deprecated Use buildVisualSlotPlan */
export function buildChapterVisualPlan(
  structure: BookStructure,
  macroArc: MacroArc,
  directedScenes: IdentifiedScene[],
  buildPlanned: BuildPlannedChapterScene
): IdentifiedScene[] {
  return buildVisualSlotPlan(structure, macroArc, directedScenes, buildPlanned);
}

export function segmentScenesOnePerChapter(
  scenes: IdentifiedScene[],
  chapters: Chapter[]
): IdentifiedScene[] {
  return segmentScenesOnePerSlot(scenes, chapters);
}

export function dedupeScenesForStructure(
  scenes: IdentifiedScene[],
  structure: BookStructure
): IdentifiedScene[] {
  return segmentScenesOnePerSlot(scenes, structure.chapters);
}

export function scenePositionKey(scene: IdentifiedScene, chapters: Chapter[]): number {
  return computeSceneWordPosition(scene, chapters);
}

export function slotHasQueuedOrCachedImage(
  slotKey: string,
  images: CachedImage[],
  scenes: IdentifiedScene[],
  chapters: Chapter[],
  queue: Array<{ visualSlotKey?: string; status: string }>
): boolean {
  if (findImageForVisualSlot(slotKey, images, scenes, chapters)) return true;
  return queue.some(
    (item) =>
      item.visualSlotKey === slotKey &&
      (item.status === "pending" || item.status === "generating")
  );
}

export const VISUAL_MIN_PLANNED_CHAPTER_WORDS = MIN_PLANNED_CHAPTER_WORDS;
