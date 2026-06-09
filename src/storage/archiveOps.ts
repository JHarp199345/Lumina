import type { ArchiveBook, Highlight, Note } from "@/types";

export type ArchiveCategory = "audio" | "images" | "notes" | "presentations" | "badges";

/** Copy linked highlight text onto notes before highlights are removed from storage. */
export function materializeNoteExcerpts(notes: Note[], highlights: Highlight[]): Note[] {
  const byHighlightId = new Map(highlights.map((highlight) => [highlight.id, highlight]));
  return notes.map((note) => {
    const excerpt = byHighlightId.get(note.highlightId)?.selectedText?.trim();
    if (!excerpt || note.sourceExcerpt?.trim()) return note;
    return {
      ...note,
      sourceExcerpt: excerpt,
      updatedAt: new Date().toISOString(),
    };
  });
}

export function archiveSummaryLine(entry: ArchiveBook): string {
  return [
    entry.audioCount > 0 ? `${entry.audioCount} audio` : null,
    entry.imageCount > 0 ? `${entry.imageCount} images` : null,
    entry.noteCount > 0 ? `${entry.noteCount} notes` : null,
    entry.presentationCount > 0 ? `${entry.presentationCount} decks` : null,
    entry.badgeCount > 0 ? `${entry.badgeCount} badges` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function archiveIsEmpty(entry: Pick<ArchiveBook, "audioCount" | "imageCount" | "noteCount" | "presentationCount" | "badgeCount">): boolean {
  return (
    entry.audioCount +
      entry.imageCount +
      entry.noteCount +
      entry.presentationCount +
      entry.badgeCount ===
    0
  );
}
