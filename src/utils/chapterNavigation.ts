import type { BookStructure, Chapter } from "@/types";

/** Structured reader locator — unambiguous even when many chapters share one HTML file. */
export function chapterLocator(chapter: Chapter): string {
  return `lumina://chapter/${chapter.index}/page/0`;
}

/** EPUB.js display target — includes NCX fragment when the parser sliced by anchor. */
export function chapterEpubHref(chapter: Chapter): string {
  const file = chapter.href.split("#")[0] || chapter.href;
  if (chapter.fragment) return `${file}#${chapter.fragment}`;
  return chapter.href;
}

export function resolveChapterIndex(
  structure: BookStructure | null | undefined,
  target: string
): number {
  if (!structure?.chapters.length) return -1;

  const loc = target.match(/^lumina:\/\/chapter\/(-?\d+)\/page\/(\d+)$/);
  if (loc) {
    const index = Number(loc[1]);
    return index >= 0 && index < structure.chapters.length ? index : -1;
  }

  const hashIdx = target.indexOf("#");
  const filePart = hashIdx === -1 ? target : target.slice(0, hashIdx);
  const fragment = hashIdx === -1 ? "" : target.slice(hashIdx + 1);
  const baseName = filePart.split("/").pop() ?? "";

  if (fragment) {
    const byFragment = structure.chapters.findIndex(
      (ch) =>
        (ch.href === filePart || ch.href.endsWith(baseName) || ch.href === target) &&
        ch.fragment === fragment
    );
    if (byFragment >= 0) return byFragment;
  }

  return structure.chapters.findIndex(
    (ch) =>
      ch.id === target ||
      ch.href === target ||
      ch.startCfi === target ||
      Boolean(ch.href && target.endsWith(ch.href.split("/").pop() ?? ""))
  );
}
