/**
 * Edition routing — one parseEpub entry, multiple invisible normalization pipelines.
 */

import type { BookStructure, Chapter, EditionPipeline } from "@/types";
import {
  detectGutenbergHtml,
  normalizeGutenbergChapters,
} from "@/pipeline/gutenbergEpub";
import { gutenbergIdFromFilename } from "@/utils/downloadFilename";

export type { EditionPipeline };

export interface EpubImportContext {
  /** Gutendex / Project Gutenberg ebook id when known (Open Shelf). */
  gutenbergId?: number;
  /** Catalog title when OPF metadata is wrong or generic. */
  catalogTitle?: string;
  /** Catalog author line when OPF metadata is wrong. */
  catalogAuthor?: string;
}

export interface ParseEpubOptions {
  importContext?: EpubImportContext;
  /** Original picked filename — used to recover Gutenberg id when importContext is absent. */
  sourceFileName?: string;
}

/** Pick normalization pipeline from EPUB content — same path for file picker and Open Shelf. */
export function resolveEditionPipeline(
  _importContext: EpubImportContext | undefined,
  rawTexts: Map<string, string>
): EditionPipeline {
  for (const html of rawTexts.values()) {
    if (detectGutenbergHtml(html)) return "gutenberg";
  }

  return "standard";
}

export function applyEditionPipeline(
  pipeline: EditionPipeline,
  chapters: Chapter[],
  importContext: EpubImportContext | undefined,
  onProgress?: (message: string) => void
): Chapter[] {
  if (pipeline !== "gutenberg") return chapters;

  onProgress?.("Applying Project Gutenberg edition rules…");
  return normalizeGutenbergChapters(chapters, importContext);
}

export function mergeEditionMetadata(
  structure: BookStructure,
  pipeline: EditionPipeline,
  importContext: EpubImportContext | undefined,
  sourceFileName?: string,
  contentGutenbergId?: number
): BookStructure {
  const title =
    importContext?.catalogTitle?.trim() ||
    structure.title;
  const author =
    importContext?.catalogAuthor?.trim() ||
    structure.author;
  const gutenbergId =
    importContext?.gutenbergId ??
    contentGutenbergId ??
    (pipeline === "gutenberg" && sourceFileName
      ? gutenbergIdFromFilename(sourceFileName)
      : undefined);

  return {
    ...structure,
    title,
    author,
    editionPipeline: pipeline,
    gutenbergId,
  };
}
