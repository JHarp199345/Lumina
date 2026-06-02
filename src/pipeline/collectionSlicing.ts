import type { BookStructure, CollectionGroup } from "@/types";

export interface AnalysisSlice {
  structure: BookStructure;
  group?: CollectionGroup;
  semanticBookId: string;
  label: string;
}

export function getAnalysisSlice(
  structure: BookStructure,
  currentChapterIndex = 0
): AnalysisSlice {
  const group = findCollectionGroup(structure, currentChapterIndex);
  if (!group) {
    return {
      structure,
      semanticBookId: structure.bookId,
      label: structure.title,
    };
  }

  const chapters = structure.chapters
    .slice(group.startChapterIndex, group.endChapterIndex + 1)
    .map((chapter, index) => ({
      ...chapter,
      index,
      title: stripGroupTitle(chapter.title, group.title),
    }));

  const slicedStructure: BookStructure = {
    ...structure,
    bookId: getSemanticBookId(structure.bookId, group.id),
    title: `${structure.title}: ${group.title}`,
    totalWords: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    chapters,
    collectionGroups: undefined,
  };

  return {
    structure: slicedStructure,
    group,
    semanticBookId: slicedStructure.bookId,
    label: group.title,
  };
}

export function getSemanticBookId(bookId: string, groupId?: string): string {
  return groupId ? `${bookId}::${groupId}` : bookId;
}

function findCollectionGroup(
  structure: BookStructure,
  currentChapterIndex: number
): CollectionGroup | undefined {
  const groups = structure.collectionGroups;
  if (!groups?.length) return undefined;

  return groups.find(
    (group) =>
      currentChapterIndex >= group.startChapterIndex &&
      currentChapterIndex <= group.endChapterIndex
  ) ?? groups[0];
}

function stripGroupTitle(title: string, groupTitle: string): string {
  const prefix = `${groupTitle} / `;
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}
