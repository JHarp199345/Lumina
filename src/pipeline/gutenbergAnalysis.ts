/**
 * Gutenberg analysis pass — refresh structural sections before emotional anchoring.
 */

import type { BookStructure } from "@/types";
import { isGutenbergEdition } from "@/pipeline/gutenbergAnchors";
import { buildGutenbergSections } from "@/pipeline/gutenbergSections";

/** Rebuild sections from scene breaks / headings (fixes legacy 1200-word grids on re-analysis). */
export function refreshGutenbergStructureSections(structure: BookStructure): BookStructure {
  if (!isGutenbergEdition(structure.editionPipeline)) return structure;

  const chapters = structure.chapters.map((chapter) => ({
    ...chapter,
    sections: buildGutenbergSections(chapter.rawText || "", chapter.id),
  }));

  return { ...structure, chapters };
}
