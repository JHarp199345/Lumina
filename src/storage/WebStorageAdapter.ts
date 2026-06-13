/**
 * WebStorageAdapter
 *
 * Implements StorageAdapter using browser-native APIs:
 *   - IndexedDB (via webDb.ts helpers) for all structured data
 *   - ArrayBuffer blobs in IndexedDB for EPUB files and generated images
 *   - IndexedDB for API keys, with localStorage as migration/fallback
 *   - Blob URLs for displaying images and loading EPUBs into EPUB.js
 *
 * Blob URLs (blob:...) are session-scoped — they are recreated from stored
 * blobs each time the app opens. This is transparent to callers.
 */

import type { StorageAdapter } from "./StorageAdapter";
import type {
  Book,
  BookStructure,
  ReadingProgress,
  SemanticMap,
  SourceIntelligenceProfile,
  StyleSeedId,
  Highlight,
  HighlightColor,
  Note,
  CachedImage,
  StudyGuide,
  StudyQuiz,
  StudyQuizAttempt,
  StudyBadgeAward,
  StudyFlashcard,
  AudioArtifact,
  PresentationDeck,
  ArchiveBook,
  LuminaNotification,
  BlackboardNote,
} from "@/types";
import {
  STORES,
  dbGet,
  dbPut,
  dbDelete,
  dbGetAll,
  dbGetByIndex,
  dbDeleteByIndex,
} from "./webDb";
import { matchesBookScope } from "./bookScope";
import {
  archiveIsEmpty,
  materializeNoteExcerpts,
  type ArchiveCategory,
} from "./archiveOps";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create and remember a blob URL so we can revoke old ones. */
const activeBlobUrls = new Set<string>();

function makeBlobUrl(data: Uint8Array, mimeType: string): string {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  activeBlobUrls.add(url);
  return url;
}

function makeDataUrl(data: Uint8Array, mimeType: string): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    binary += String.fromCharCode(...data.slice(i, i + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function detectImageMimeType(data: Uint8Array): string {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return "image/webp";
  }
  return "image/png";
}

function makeAudioBlobUrl(data: Uint8Array, mimeType: string): string {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  activeBlobUrls.add(url);
  return url;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class WebStorageAdapter implements StorageAdapter {
  // ── EPUB handling ────────────────────────────────────────────────────────

  async pickEpubFile(): Promise<File | string | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".epub,application/epub+zip";

      input.onchange = () => {
        const file = input.files?.[0] ?? null;
        resolve(file);
      };

      // If the user dismisses without picking, resolve null after a tick
      input.oncancel = () => resolve(null);

      // Append briefly to body (required in some browsers)
      document.body.appendChild(input);
      input.click();
      // Small delay before removal so the dialog can open
      setTimeout(() => document.body.removeChild(input), 100);
    });
  }

  async storeEpub(source: File | string, bookId: string, _fileName: string): Promise<string> {
    let bytes: Uint8Array;

    if (source instanceof File) {
      const buf = await source.arrayBuffer();
      bytes = new Uint8Array(buf);
    } else {
      throw new Error("WebStorageAdapter.storeEpub: expected a File object");
    }

    await dbPut(STORES.EPUBS, bytes, bookId);
    // Return the bookId as the "path" — getEpubBytes uses this as the key
    return `idb://${bookId}`;
  }

  async storeEpubBytes(bytes: Uint8Array, bookId: string, _fileName: string): Promise<string> {
    await dbPut(STORES.EPUBS, bytes, bookId);
    return `idb://${bookId}`;
  }

  async getEpubBytes(book: Book): Promise<Uint8Array> {
    // filePath is either "idb://<bookId>" (web-stored) or a native path (Tauri)
    const key = book.filePath.startsWith("idb://")
      ? book.filePath.slice(6) // strip "idb://"
      : book.id;

    const bytes = await dbGet<Uint8Array>(STORES.EPUBS, key);
    if (!bytes) throw new Error(`[Web] EPUB not found in IndexedDB for book ${book.id}`);
    return bytes;
  }

  // ── Library ──────────────────────────────────────────────────────────────

  async saveBook(book: Book): Promise<void> {
    await dbPut(STORES.BOOKS, book);
  }

  async loadAllBooks(): Promise<Book[]> {
    const books = await dbGetAll<Book>(STORES.BOOKS);
    return books.sort((a, b) => {
      const ta = a.lastOpened ? new Date(a.lastOpened).getTime() : 0;
      const tb = b.lastOpened ? new Date(b.lastOpened).getTime() : 0;
      return tb - ta;
    });
  }

  async deleteBook(bookId: string): Promise<void> {
    await dbDelete(STORES.BOOKS, bookId);
  }

  async updateLastOpened(bookId: string): Promise<void> {
    const book = await dbGet<Book>(STORES.BOOKS, bookId);
    if (book) {
      await dbPut(STORES.BOOKS, { ...book, lastOpened: new Date().toISOString() });
    }
  }

  async saveBookStructure(structure: BookStructure): Promise<void> {
    await dbPut(STORES.BOOK_STRUCTURES, structure, structure.bookId);
  }

  async loadBookStructure(bookId: string): Promise<BookStructure | null> {
    return (await dbGet<BookStructure>(STORES.BOOK_STRUCTURES, bookId)) ?? null;
  }

  // ── Progress ─────────────────────────────────────────────────────────────

  async saveProgress(progress: ReadingProgress): Promise<void> {
    await dbPut(STORES.PROGRESS, progress);
  }

  async loadProgress(bookId: string): Promise<ReadingProgress | null> {
    return (await dbGet<ReadingProgress>(STORES.PROGRESS, bookId)) ?? null;
  }

  // ── Annotations ──────────────────────────────────────────────────────────

  async saveHighlight(highlight: Highlight): Promise<void> {
    await dbPut(STORES.HIGHLIGHTS, highlight);
  }

  async loadHighlights(bookId: string): Promise<Highlight[]> {
    return dbGetByIndex<Highlight>(STORES.HIGHLIGHTS, "bookId", bookId);
  }

  async deleteHighlight(highlightId: string): Promise<void> {
    await dbDelete(STORES.HIGHLIGHTS, highlightId);
  }

  async updateHighlightColor(highlightId: string, color: HighlightColor): Promise<void> {
    const h = await dbGet<Highlight>(STORES.HIGHLIGHTS, highlightId);
    if (h) await dbPut(STORES.HIGHLIGHTS, { ...h, color });
  }

  async saveNote(note: Note): Promise<void> {
    await dbPut(STORES.NOTES, note);
  }

  async loadNotes(bookId: string): Promise<Note[]> {
    return dbGetByIndex<Note>(STORES.NOTES, "bookId", bookId);
  }

  async updateNote(noteId: string, text: string): Promise<void> {
    const n = await dbGet<Note>(STORES.NOTES, noteId);
    if (n) await dbPut(STORES.NOTES, { ...n, noteText: text, updatedAt: new Date().toISOString() });
  }

  async deleteNote(noteId: string): Promise<void> {
    await dbDelete(STORES.NOTES, noteId);
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  async saveNotification(notification: LuminaNotification): Promise<void> {
    await dbPut(STORES.NOTIFICATIONS, notification);
  }

  async loadNotifications(bookId: string): Promise<LuminaNotification[]> {
    return dbGetByIndex<LuminaNotification>(STORES.NOTIFICATIONS, "bookId", bookId);
  }

  async markNotificationsRead(ids: string[]): Promise<void> {
    await Promise.all(
      ids.map(async (id) => {
        const n = await dbGet<LuminaNotification>(STORES.NOTIFICATIONS, id);
        if (n && !n.read) await dbPut(STORES.NOTIFICATIONS, { ...n, read: true });
      })
    );
  }

  async deleteNotification(id: string): Promise<void> {
    await dbDelete(STORES.NOTIFICATIONS, id);
  }

  async clearNotifications(bookId: string): Promise<void> {
    await dbDeleteByIndex(STORES.NOTIFICATIONS, "bookId", bookId);
  }

  // ── Semantic map ─────────────────────────────────────────────────────────

  async saveSemanticMap(map: SemanticMap): Promise<void> {
    await dbPut(STORES.SEMANTIC_MAPS, map, map.bookId);
  }

  async loadSemanticMap(bookId: string): Promise<SemanticMap | null> {
    return (await dbGet<SemanticMap>(STORES.SEMANTIC_MAPS, bookId)) ?? null;
  }

  async deleteSemanticMap(bookId: string): Promise<void> {
    await dbDelete(STORES.SEMANTIC_MAPS, bookId);
  }

  // ── Indexed blackboard artifacts ────────────────────────────────────────

  async saveBlackboardNotes(notes: BlackboardNote[]): Promise<void> {
    await Promise.all(notes.map((note) => dbPut(STORES.BLACKBOARD_NOTES, note)));
  }

  async loadBlackboardNotes(bookId: string): Promise<BlackboardNote[]> {
    const notes = await dbGetByIndex<BlackboardNote>(STORES.BLACKBOARD_NOTES, "bookId", bookId);
    return notes.sort(
      (a, b) =>
        (a.startWord ?? 0) - (b.startWord ?? 0) ||
        a.kind.localeCompare(b.kind) ||
        a.id.localeCompare(b.id)
    );
  }

  async deleteBlackboardNotes(bookId: string): Promise<void> {
    await dbDeleteByIndex(STORES.BLACKBOARD_NOTES, "bookId", bookId);
  }

  // ── Source Intelligence Profile ────────────────────────────────────────────

  async saveSourceProfile(profile: SourceIntelligenceProfile): Promise<void> {
    await dbPut(STORES.SOURCE_PROFILES, profile, profile.bookId);
  }

  async loadSourceProfile(bookId: string): Promise<SourceIntelligenceProfile | null> {
    return (await dbGet<SourceIntelligenceProfile>(STORES.SOURCE_PROFILES, bookId)) ?? null;
  }

  async deleteSourceProfile(bookId: string): Promise<void> {
    await dbDelete(STORES.SOURCE_PROFILES, bookId);
  }

  // ── Study guide ──────────────────────────────────────────────────────────

  async saveStudyGuide(guide: StudyGuide): Promise<void> {
    await dbPut(STORES.STUDY_GUIDES, guide, guide.bookId);
  }

  async loadStudyGuide(bookId: string): Promise<StudyGuide | null> {
    return (await dbGet<StudyGuide>(STORES.STUDY_GUIDES, bookId)) ?? null;
  }

  async deleteStudyGuide(bookId: string): Promise<void> {
    await dbDelete(STORES.STUDY_GUIDES, bookId);
  }

  async saveStudyQuiz(quiz: StudyQuiz): Promise<void> {
    await dbPut(STORES.STUDY_QUIZZES, quiz);
  }

  async loadStudyQuizzes(bookId: string): Promise<StudyQuiz[]> {
    return dbGetByIndex<StudyQuiz>(STORES.STUDY_QUIZZES, "bookId", bookId);
  }

  async saveStudyQuizAttempt(attempt: StudyQuizAttempt): Promise<void> {
    await dbPut(STORES.STUDY_ATTEMPTS, attempt);
  }

  async loadStudyQuizAttempts(bookId: string): Promise<StudyQuizAttempt[]> {
    return dbGetByIndex<StudyQuizAttempt>(STORES.STUDY_ATTEMPTS, "bookId", bookId);
  }

  async saveStudyBadgeAward(award: StudyBadgeAward): Promise<void> {
    await dbPut(STORES.STUDY_BADGES, award);
  }

  async loadStudyBadgeAwards(bookId: string): Promise<StudyBadgeAward[]> {
    return dbGetByIndex<StudyBadgeAward>(STORES.STUDY_BADGES, "bookId", bookId);
  }

  async saveStudyFlashcards(cards: StudyFlashcard[]): Promise<void> {
    await Promise.all(cards.map((card) => dbPut(STORES.STUDY_FLASHCARDS, card)));
  }

  async loadStudyFlashcards(bookId: string): Promise<StudyFlashcard[]> {
    const cards = await dbGetByIndex<StudyFlashcard>(STORES.STUDY_FLASHCARDS, "bookId", bookId);
    return cards.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  // ── Voice Studio ────────────────────────────────────────────────────────

  async saveAudioArtifact(meta: Omit<AudioArtifact, "filePath">, data: Uint8Array): Promise<string> {
    await dbPut(STORES.AUDIO_BLOBS, data, meta.id);
    const displayUrl = makeAudioBlobUrl(data, meta.mimeType);
    const fullMeta: AudioArtifact = { ...meta, filePath: `idb-audio://${meta.id}` };
    await dbPut(STORES.AUDIO_META, fullMeta);
    return displayUrl;
  }

  async loadAudioArtifacts(bookId: string): Promise<AudioArtifact[]> {
    const metas = await dbGetByIndex<AudioArtifact>(STORES.AUDIO_META, "bookId", bookId);
    const resolved = await Promise.all(
      metas.map(async (meta) => {
        const data = await dbGet<Uint8Array>(STORES.AUDIO_BLOBS, meta.id);
        if (!data) {
          return {
            ...meta,
            status: "failed" as const,
            error: "Saved audio metadata exists, but the stored audio bytes were not found.",
          };
        }
        return { ...meta, filePath: makeAudioBlobUrl(data, meta.mimeType) };
      })
    );
    return resolved.sort((a, b) => new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime());
  }

  async deleteAudioArtifact(id: string): Promise<void> {
    await dbDelete(STORES.AUDIO_META, id);
    await dbDelete(STORES.AUDIO_BLOBS, id).catch(() => {});
  }

  async deleteAudioArtifacts(bookId: string): Promise<void> {
    const metas = await dbGetByIndex<AudioArtifact>(STORES.AUDIO_META, "bookId", bookId);
    await Promise.all(
      metas.map(async (meta) => {
        await dbDelete(STORES.AUDIO_META, meta.id);
        await dbDelete(STORES.AUDIO_BLOBS, meta.id).catch(() => {});
      })
    );
  }

  // ── Presentation Studio ───────────────────────────────────────────────

  async savePresentation(deck: PresentationDeck): Promise<void> {
    await dbPut(STORES.PRESENTATIONS, deck);
  }

  async loadPresentations(bookId: string): Promise<PresentationDeck[]> {
    const decks = await dbGetByIndex<PresentationDeck>(STORES.PRESENTATIONS, "bookId", bookId);
    return decks.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
  }

  async deletePresentations(bookId: string): Promise<void> {
    await dbDeleteByIndex(STORES.PRESENTATIONS, "bookId", bookId);
  }

  // ── Style seed ───────────────────────────────────────────────────────────

  async saveBookStyleSeed(bookId: string, seedId: StyleSeedId): Promise<void> {
    await dbPut(STORES.BOOK_SETTINGS, { seedId }, bookId);
  }

  async loadBookStyleSeed(bookId: string): Promise<StyleSeedId | null> {
    const record = await dbGet<{ seedId: StyleSeedId }>(STORES.BOOK_SETTINGS, bookId);
    return record?.seedId ?? null;
  }

  // ── Image cache ──────────────────────────────────────────────────────────

  async saveImage(meta: Omit<CachedImage, "filePath">, data: Uint8Array): Promise<string> {
    // Persist blob in IndexedDB
    await dbPut(STORES.IMAGE_BLOBS, data, meta.sceneId);

    // Use a data URL for immediate display in the PWA. It is larger than a
    // blob URL, but avoids mobile browser blob lifecycle edge cases.
    const displayUrl = makeDataUrl(data, detectImageMimeType(data));

    // Persist metadata (with placeholder — real URL recreated on load)
    const fullMeta: CachedImage = { ...meta, filePath: `idb-img://${meta.sceneId}` };
    await dbPut(STORES.IMAGE_META, fullMeta);

    return displayUrl;
  }

  async loadImages(bookId: string): Promise<CachedImage[]> {
    const metas = await dbGetByIndex<CachedImage>(STORES.IMAGE_META, "bookId", bookId);
    return this._resolveImageUrls(metas);
  }

  async loadImagesForPrefix(bookId: string): Promise<CachedImage[]> {
    // Load exact match + any collection segment keys (bookId::segmentId)
    const all = await dbGetAll<CachedImage>(STORES.IMAGE_META);
    const matched = all.filter(
      (m) => m.bookId === bookId || m.bookId.startsWith(`${bookId}::`)
    );

    return this._resolveImageUrls(matched);
  }

  async deleteImages(bookId: string): Promise<void> {
    const metas = await dbGetAll<CachedImage>(STORES.IMAGE_META);
    const toDelete = metas.filter(
      (m) => m.bookId === bookId || m.bookId.startsWith(`${bookId}::`)
    );
    await Promise.all(
      toDelete.map(async (m) => {
        await dbDelete(STORES.IMAGE_META, m.id);
        await dbDelete(STORES.IMAGE_BLOBS, m.sceneId).catch(() => {});
      })
    );
  }

  // ── API keys ─────────────────────────────────────────────────────────────
  // Stored primarily in IndexedDB. localStorage remains a compatibility mirror
  // for older builds and for synchronous callers such as llmClient token headers.

  async saveApiKey(name: string, value: string): Promise<void> {
    await dbPut(STORES.API_KEYS, value, name);
    try {
      localStorage.setItem(`lk_${name}`, value);
    } catch {
      // IndexedDB is the durable source; localStorage is only a mirror.
    }
  }

  async loadApiKey(name: string): Promise<string | null> {
    const stored = await dbGet<string>(STORES.API_KEYS, name).catch(() => undefined);
    if (typeof stored === "string") {
      try {
        localStorage.setItem(`lk_${name}`, stored);
      } catch {
        // Nonessential mirror.
      }
      return stored;
    }
    try {
      return localStorage.getItem(`lk_${name}`);
    } catch {
      return null;
    }
  }

  async deleteApiKey(name: string): Promise<void> {
    await dbDelete(STORES.API_KEYS, name).catch(() => {});
    try {
      localStorage.removeItem(`lk_${name}`);
    } catch {
      // ignore
    }
  }

  // ── Archive ──────────────────────────────────────────────────────────────

  private async _saveArchiveEntry(
    bookId: string,
    title: string,
    author: string,
    counts: Omit<ArchiveBook, "bookId" | "title" | "author" | "archivedAt"> & { archivedAt?: string }
  ): Promise<void> {
    const existing = await dbGet<ArchiveBook>(STORES.ARCHIVE_BOOKS, bookId);
    const entry: ArchiveBook = {
      bookId,
      title,
      author,
      archivedAt: counts.archivedAt ?? existing?.archivedAt ?? new Date().toISOString(),
      audioCount: counts.audioCount,
      imageCount: counts.imageCount,
      noteCount: counts.noteCount,
      presentationCount: counts.presentationCount,
      badgeCount: counts.badgeCount,
    };
    if (archiveIsEmpty(entry)) {
      await dbDelete(STORES.ARCHIVE_BOOKS, bookId).catch(() => {});
      return;
    }
    await dbPut(STORES.ARCHIVE_BOOKS, entry, bookId);
  }

  private async _archiveCounts(bookId: string) {
    const [audio, images, notes, presentations, badges] = await Promise.all([
      this.loadAudioArtifacts(bookId),
      this.loadImagesForPrefix(bookId),
      this.loadNotes(bookId),
      this.loadPresentations(bookId),
      this.loadStudyBadgeAwards(bookId),
    ]);
    return {
      audioCount: audio.length,
      imageCount: images.length,
      noteCount: notes.length,
      presentationCount: presentations.length,
      badgeCount: badges.length,
    };
  }

  private async _materializeNotesForArchive(bookId: string): Promise<void> {
    const [notes, highlights] = await Promise.all([
      this.loadNotes(bookId),
      this.loadHighlights(bookId),
    ]);
    const materialized = materializeNoteExcerpts(notes, highlights);
    await Promise.all(
      materialized.map((note, index) => {
        if (note.sourceExcerpt === notes[index]?.sourceExcerpt) return Promise.resolve();
        return this.saveNote(note);
      })
    );
    await dbDeleteByIndex(STORES.HIGHLIGHTS, "bookId", bookId);
  }

  async archiveAndResetGeneration(book: Book): Promise<void> {
    const bookId = book.id;
    // 1. Snapshot counts into the archive. Generated media is reader-owned and
    // stays in place; the archive is a view over preserved artifacts, not a copy
    // made right before deletion.
    await this._materializeNotesForArchive(bookId).catch(() => {});
    const counts = await this._archiveCounts(bookId);
    await this._saveArchiveEntry(book.id, book.title, book.author, counts);

    // 2. Do not delete generated artifacts here. A fresh analysis may overwrite
    // the active semantic map by key, but app updates/restarts/re-ingest setup
    // must never silently remove expensive reader-owned work.
  }

  async archiveAndRemoveBook(book: Book): Promise<void> {
    const bookId = book.id;
    await this._materializeNotesForArchive(bookId);
    const counts = await this._archiveCounts(bookId);
    await this._saveArchiveEntry(book.id, book.title, book.author, counts);

    const semanticMaps = await dbGetAll<SemanticMap>(STORES.SEMANTIC_MAPS);
    await Promise.all(
      semanticMaps
        .filter((map) => matchesBookScope(map.bookId, bookId))
        .map((map) => dbDelete(STORES.SEMANTIC_MAPS, map.bookId))
    );

    const profiles = await dbGetAll<SourceIntelligenceProfile>(STORES.SOURCE_PROFILES);
    await Promise.all(
      profiles
        .filter((profile) => matchesBookScope(profile.bookId, bookId))
        .map((profile) => dbDelete(STORES.SOURCE_PROFILES, profile.bookId))
    );
    const blackboardNotes = await dbGetAll<BlackboardNote>(STORES.BLACKBOARD_NOTES);
    await Promise.all(
      blackboardNotes
        .filter((note) => matchesBookScope(note.bookId, bookId))
        .map((note) => dbDelete(STORES.BLACKBOARD_NOTES, note.id))
    );

    await Promise.allSettled([
      dbDelete(STORES.BOOKS, bookId),
      dbDelete(STORES.BOOK_STRUCTURES, bookId),
      dbDelete(STORES.EPUBS, bookId),
      dbDelete(STORES.PROGRESS, bookId),
      dbDelete(STORES.STUDY_GUIDES, bookId),
      dbDeleteByIndex(STORES.STUDY_QUIZZES, "bookId", bookId),
      dbDeleteByIndex(STORES.STUDY_ATTEMPTS, "bookId", bookId),
      dbDeleteByIndex(STORES.STUDY_FLASHCARDS, "bookId", bookId),
      dbDelete(STORES.BOOK_SETTINGS, bookId),
    ]);
  }

  async loadArchiveBooks(): Promise<ArchiveBook[]> {
    const books = await dbGetAll<ArchiveBook>(STORES.ARCHIVE_BOOKS);
    return books.sort(
      (a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime()
    );
  }

  async syncArchiveEntry(bookId: string): Promise<void> {
    const existing = await dbGet<ArchiveBook>(STORES.ARCHIVE_BOOKS, bookId);
    if (!existing) return;
    const counts = await this._archiveCounts(bookId);
    await this._saveArchiveEntry(bookId, existing.title, existing.author, {
      ...counts,
      archivedAt: existing.archivedAt,
    });
  }

  async purgeArchive(bookId: string): Promise<void> {
    await Promise.allSettled([
      dbDeleteByIndex(STORES.HIGHLIGHTS, "bookId", bookId),
      dbDeleteByIndex(STORES.NOTES, "bookId", bookId),
      dbDeleteByIndex(STORES.BLACKBOARD_NOTES, "bookId", bookId),
      dbDeleteByIndex(STORES.STUDY_BADGES, "bookId", bookId),
      this.deletePresentations(bookId),
      this.deleteAudioArtifacts(bookId),
      this.deleteImages(bookId),
      dbDelete(STORES.ARCHIVE_BOOKS, bookId),
    ]);
  }

  async purgeArchiveCategory(bookId: string, category: ArchiveCategory): Promise<void> {
    switch (category) {
      case "audio":
        await this.deleteAudioArtifacts(bookId);
        break;
      case "images":
        await this.deleteImages(bookId);
        break;
      case "notes":
        await dbDeleteByIndex(STORES.NOTES, "bookId", bookId);
        break;
      case "presentations":
        await this.deletePresentations(bookId);
        break;
      case "badges":
        await dbDeleteByIndex(STORES.STUDY_BADGES, "bookId", bookId);
        break;
    }
    await this.syncArchiveEntry(bookId);
  }

  async purgeAllArchives(): Promise<void> {
    const books = await this.loadArchiveBooks();
    await Promise.all(books.map((book) => this.purgeArchive(book.bookId)));
  }

  async deleteArchivedAudio(audioId: string): Promise<void> {
    const meta = await dbGet<AudioArtifact>(STORES.AUDIO_META, audioId);
    if (!meta) return;
    await dbDelete(STORES.AUDIO_META, audioId);
    await dbDelete(STORES.AUDIO_BLOBS, audioId).catch(() => {});
    await this.syncArchiveEntry(meta.bookId);
  }

  async deleteArchivedImage(imageId: string, sceneId: string): Promise<void> {
    const meta = await dbGet<CachedImage>(STORES.IMAGE_META, imageId);
    if (!meta) return;
    await dbDelete(STORES.IMAGE_META, imageId);
    await dbDelete(STORES.IMAGE_BLOBS, sceneId).catch(() => {});
    await this.syncArchiveEntry(meta.bookId);
  }

  async deleteArchivedNote(noteId: string): Promise<void> {
    const note = await dbGet<Note>(STORES.NOTES, noteId);
    if (!note) return;
    await this.deleteNote(noteId);
    await this.syncArchiveEntry(note.bookId);
  }

  async deleteArchivedPresentation(deckId: string): Promise<void> {
    const deck = await dbGet<PresentationDeck>(STORES.PRESENTATIONS, deckId);
    if (!deck) return;
    await dbDelete(STORES.PRESENTATIONS, deckId);
    await this.syncArchiveEntry(deck.bookId);
  }

  async deleteArchivedBadge(badgeId: string): Promise<void> {
    const badge = await dbGet<StudyBadgeAward>(STORES.STUDY_BADGES, badgeId);
    if (!badge) return;
    await dbDelete(STORES.STUDY_BADGES, badgeId);
    await this.syncArchiveEntry(badge.bookId);
  }

  // ── Bulk delete ──────────────────────────────────────────────────────────

  async deleteAllBookData(bookId: string): Promise<void> {
    await this.purgeArchive(bookId).catch(() => {});
    const semanticMaps = await dbGetAll<SemanticMap>(STORES.SEMANTIC_MAPS);
    await Promise.all(
      semanticMaps
        .filter((map) => matchesBookScope(map.bookId, bookId))
        .map((map) => dbDelete(STORES.SEMANTIC_MAPS, map.bookId))
    );
    const profiles = await dbGetAll<SourceIntelligenceProfile>(STORES.SOURCE_PROFILES);
    await Promise.all(
      profiles
        .filter((profile) => matchesBookScope(profile.bookId, bookId))
        .map((profile) => dbDelete(STORES.SOURCE_PROFILES, profile.bookId))
    );
    const blackboardNotes = await dbGetAll<BlackboardNote>(STORES.BLACKBOARD_NOTES);
    await Promise.all(
      blackboardNotes
        .filter((note) => matchesBookScope(note.bookId, bookId))
        .map((note) => dbDelete(STORES.BLACKBOARD_NOTES, note.id))
    );
    await Promise.allSettled([
      dbDelete(STORES.BOOKS, bookId),
      dbDelete(STORES.BOOK_STRUCTURES, bookId),
      dbDelete(STORES.EPUBS, bookId),
      dbDelete(STORES.PROGRESS, bookId),
      dbDelete(STORES.STUDY_GUIDES, bookId),
      dbDeleteByIndex(STORES.STUDY_QUIZZES, "bookId", bookId),
      dbDeleteByIndex(STORES.STUDY_ATTEMPTS, "bookId", bookId),
      dbDeleteByIndex(STORES.STUDY_FLASHCARDS, "bookId", bookId),
      dbDelete(STORES.BOOK_SETTINGS, bookId),
    ]);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private async _resolveImageUrls(metas: CachedImage[]): Promise<CachedImage[]> {
    return Promise.all(
      metas.map(async (meta) => {
        const data = await dbGet<Uint8Array>(STORES.IMAGE_BLOBS, meta.sceneId);
        if (!data) return meta; // no blob — filePath stays as placeholder
        return { ...meta, filePath: makeDataUrl(data, detectImageMimeType(data)) };
      })
    );
  }
}
