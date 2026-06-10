/**
 * TauriStorageAdapter
 *
 * Implements StorageAdapter using the existing Tauri IPC layer:
 *   - SQLite (via services/db.ts) for all relational data
 *   - Native file system (via tauriBridge.ts) for EPUB blobs and generated images
 *
 * No behaviour changes from the pre-adapter codebase — this is a thin wrapper
 * that routes calls to the existing functions.
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
} from "@/types";
import {
  openEpubDialog,
  readFileBytes,
  writeFileBytes,
  copyFileToAppData,
  getAppDataDir,
  storeApiKey,
  getApiKey,
  deleteApiKey,
  toAssetUrl,
  deleteDirectory,
} from "@/utils/tauriBridge";
import {
  dbSaveBook,
  dbLoadAllBooks,
  dbDeleteBook,
  dbUpdateLastOpened,
  dbSaveBookStructure,
  dbLoadBookStructure,
  dbSaveProgress,
  dbLoadProgress,
  dbSaveHighlight,
  dbLoadHighlights,
  dbDeleteHighlight,
  dbUpdateHighlightColor,
  dbSaveNote,
  dbLoadNotes,
  dbUpdateNote,
  dbDeleteNote,
  dbSaveSemanticMap,
  dbLoadSemanticMap,
  dbDeleteSemanticMap,
  dbSaveSourceProfile,
  dbLoadSourceProfile,
  dbDeleteSourceProfile,
  dbSaveStudyGuide,
  dbLoadStudyGuide,
  dbDeleteStudyGuide,
  dbSaveStudyQuiz,
  dbLoadStudyQuizzes,
  dbSaveStudyQuizAttempt,
  dbLoadStudyQuizAttempts,
  dbSaveStudyBadgeAward,
  dbLoadStudyBadgeAwards,
  dbSaveStudyFlashcards,
  dbLoadStudyFlashcards,
  dbSaveAudioArtifact,
  dbLoadAudioArtifacts,
  dbDeleteAudioArtifacts,
  dbSavePresentation,
  dbLoadPresentations,
  dbDeletePresentations,
  dbSaveBookStyleSeed,
  dbLoadBookStyleSeed,
  dbSaveImageCache,
  dbLoadImageCache,
  dbLoadImageCacheForBookPrefix,
  dbDeleteImageCache,
  dbDeleteAllBookData,
  dbSaveArchiveBook,
  dbLoadArchiveBooks,
  dbDeleteArchiveBook,
  dbArchiveAndRemoveBook,
  dbPurgeArchivedArtifacts,
  dbDeleteStudyBadgeAward,
  dbDeletePresentationDeck,
  dbDeleteAudioArtifact,
  dbDeleteCachedImage,
  dbLoadAudioArtifactById,
  dbLoadCachedImageById,
  dbLoadNoteById,
  dbLoadPresentationDeckById,
  dbLoadStudyBadgeAwardById,
} from "@/services/db";
import {
  archiveIsEmpty,
  materializeNoteExcerpts,
  type ArchiveCategory,
} from "./archiveOps";
import { LUMINA_CONFIG } from "@/config";

export class TauriStorageAdapter implements StorageAdapter {
  // ── EPUB handling ────────────────────────────────────────────────────────

  async pickEpubFile(): Promise<File | string | null> {
    return openEpubDialog(); // returns path string or null
  }

  async storeEpub(source: File | string, bookId: string, fileName: string): Promise<string> {
    if (typeof source !== "string") {
      throw new Error("TauriStorageAdapter.storeEpub: expected a file path string");
    }
    return copyFileToAppData(source, `books/${bookId}/${fileName}`);
  }

  async getEpubBytes(book: Book): Promise<Uint8Array> {
    return readFileBytes(book.filePath);
  }

  // ── Library ──────────────────────────────────────────────────────────────

  async saveBook(book: Book): Promise<void> {
    await dbSaveBook(book);
  }

  async loadAllBooks(): Promise<Book[]> {
    return dbLoadAllBooks();
  }

  async deleteBook(bookId: string): Promise<void> {
    await dbDeleteBook(bookId);
  }

  async updateLastOpened(bookId: string): Promise<void> {
    await dbUpdateLastOpened(bookId);
  }

  async saveBookStructure(structure: BookStructure): Promise<void> {
    await dbSaveBookStructure(structure);
  }

  async loadBookStructure(bookId: string): Promise<BookStructure | null> {
    return dbLoadBookStructure(bookId);
  }

  // ── Progress ─────────────────────────────────────────────────────────────

  async saveProgress(progress: ReadingProgress): Promise<void> {
    await dbSaveProgress(progress);
  }

  async loadProgress(bookId: string): Promise<ReadingProgress | null> {
    return dbLoadProgress(bookId);
  }

  // ── Annotations ──────────────────────────────────────────────────────────

  async saveHighlight(highlight: Highlight): Promise<void> {
    await dbSaveHighlight(highlight);
  }

  async loadHighlights(bookId: string): Promise<Highlight[]> {
    return dbLoadHighlights(bookId);
  }

  async deleteHighlight(highlightId: string): Promise<void> {
    await dbDeleteHighlight(highlightId);
  }

  async updateHighlightColor(highlightId: string, color: HighlightColor): Promise<void> {
    await dbUpdateHighlightColor(highlightId, color);
  }

  async saveNote(note: Note): Promise<void> {
    await dbSaveNote(note);
  }

  async loadNotes(bookId: string): Promise<Note[]> {
    return dbLoadNotes(bookId);
  }

  async updateNote(noteId: string, text: string): Promise<void> {
    await dbUpdateNote(noteId, text);
  }

  async deleteNote(noteId: string): Promise<void> {
    await dbDeleteNote(noteId);
  }

  // ── Semantic map ─────────────────────────────────────────────────────────

  async saveSemanticMap(map: SemanticMap): Promise<void> {
    await dbSaveSemanticMap(map);
  }

  async loadSemanticMap(bookId: string): Promise<SemanticMap | null> {
    return dbLoadSemanticMap(bookId);
  }

  async deleteSemanticMap(bookId: string): Promise<void> {
    await dbDeleteSemanticMap(bookId);
  }

  // ── Source Intelligence Profile ────────────────────────────────────────────

  async saveSourceProfile(profile: SourceIntelligenceProfile): Promise<void> {
    await dbSaveSourceProfile(profile);
  }

  async loadSourceProfile(bookId: string): Promise<SourceIntelligenceProfile | null> {
    return dbLoadSourceProfile(bookId);
  }

  async deleteSourceProfile(bookId: string): Promise<void> {
    await dbDeleteSourceProfile(bookId);
  }

  // ── Study guide ──────────────────────────────────────────────────────────

  async saveStudyGuide(guide: StudyGuide): Promise<void> {
    await dbSaveStudyGuide(guide);
  }

  async loadStudyGuide(bookId: string): Promise<StudyGuide | null> {
    return dbLoadStudyGuide(bookId);
  }

  async deleteStudyGuide(bookId: string): Promise<void> {
    await dbDeleteStudyGuide(bookId);
  }

  async saveStudyQuiz(quiz: StudyQuiz): Promise<void> {
    await dbSaveStudyQuiz(quiz);
  }

  async loadStudyQuizzes(bookId: string): Promise<StudyQuiz[]> {
    return dbLoadStudyQuizzes(bookId);
  }

  async saveStudyQuizAttempt(attempt: StudyQuizAttempt): Promise<void> {
    await dbSaveStudyQuizAttempt(attempt);
  }

  async loadStudyQuizAttempts(bookId: string): Promise<StudyQuizAttempt[]> {
    return dbLoadStudyQuizAttempts(bookId);
  }

  async saveStudyBadgeAward(award: StudyBadgeAward): Promise<void> {
    await dbSaveStudyBadgeAward(award);
  }

  async loadStudyBadgeAwards(bookId: string): Promise<StudyBadgeAward[]> {
    return dbLoadStudyBadgeAwards(bookId);
  }

  async saveStudyFlashcards(cards: StudyFlashcard[]): Promise<void> {
    await dbSaveStudyFlashcards(cards);
  }

  async loadStudyFlashcards(bookId: string): Promise<StudyFlashcard[]> {
    return dbLoadStudyFlashcards(bookId);
  }

  // ── Voice Studio ────────────────────────────────────────────────────────

  async saveAudioArtifact(meta: Omit<AudioArtifact, "filePath">, data: Uint8Array): Promise<string> {
    const appDataDir = await getAppDataDir();
    const extension = meta.mimeType.includes("wav") ? "wav" : "audio";
    const relativePath = `${LUMINA_CONFIG.AUDIO_CACHE_DIR}/${meta.bookId}/${meta.id}.${extension}`;
    const fullPath = `${appDataDir}/${relativePath}`;
    await writeFileBytes(fullPath, data);
    const displayUrl = `${toAssetUrl(fullPath)}?v=${encodeURIComponent(meta.generatedAt)}`;
    await dbSaveAudioArtifact({ ...meta, filePath: displayUrl });
    return displayUrl;
  }

  async loadAudioArtifacts(bookId: string): Promise<AudioArtifact[]> {
    return dbLoadAudioArtifacts(bookId);
  }

  async deleteAudioArtifact(id: string): Promise<void> {
    await dbDeleteAudioArtifact(id);
  }

  async deleteAudioArtifacts(bookId: string): Promise<void> {
    await dbDeleteAudioArtifacts(bookId);
    const appDataDir = await getAppDataDir().catch(() => "");
    if (appDataDir) {
      await deleteDirectory(`${appDataDir}/${LUMINA_CONFIG.AUDIO_CACHE_DIR}/${bookId}`).catch(() => {});
    }
  }

  // ── Presentation Studio ───────────────────────────────────────────────

  async savePresentation(deck: PresentationDeck): Promise<void> {
    await dbSavePresentation(deck);
  }

  async loadPresentations(bookId: string): Promise<PresentationDeck[]> {
    return dbLoadPresentations(bookId);
  }

  async deletePresentations(bookId: string): Promise<void> {
    await dbDeletePresentations(bookId);
  }

  // ── Style seed ───────────────────────────────────────────────────────────

  async saveBookStyleSeed(bookId: string, seedId: StyleSeedId): Promise<void> {
    await dbSaveBookStyleSeed(bookId, seedId);
  }

  async loadBookStyleSeed(bookId: string): Promise<StyleSeedId | null> {
    return dbLoadBookStyleSeed(bookId);
  }

  // ── Image cache ──────────────────────────────────────────────────────────

  async saveImage(meta: Omit<CachedImage, "filePath">, data: Uint8Array): Promise<string> {
    const appDataDir = await getAppDataDir();
    const fileName = `${meta.sceneId}.png`;
    const relativePath = `${LUMINA_CONFIG.IMAGE_CACHE_DIR}/${meta.bookId}/${fileName}`;
    const fullPath = `${appDataDir}/${relativePath}`;
    await writeFileBytes(fullPath, data);
    const displayUrl = `${toAssetUrl(fullPath)}?v=${encodeURIComponent(meta.generatedAt)}`;
    await dbSaveImageCache({ ...meta, filePath: displayUrl });
    return displayUrl;
  }

  async loadImages(bookId: string): Promise<CachedImage[]> {
    return dbLoadImageCache(bookId);
  }

  async loadImagesForPrefix(bookId: string): Promise<CachedImage[]> {
    return dbLoadImageCacheForBookPrefix(bookId);
  }

  async deleteImages(bookId: string): Promise<void> {
    await dbDeleteImageCache(bookId);
    // Best-effort file cleanup
    const appDataDir = await getAppDataDir().catch(() => "");
    if (appDataDir) {
      await deleteDirectory(`${appDataDir}/${LUMINA_CONFIG.IMAGE_CACHE_DIR}/${bookId}`).catch(() => {});
    }
  }

  // ── API keys ─────────────────────────────────────────────────────────────

  async saveApiKey(name: string, value: string): Promise<void> {
    await storeApiKey(name, value);
  }

  async loadApiKey(name: string): Promise<string | null> {
    return getApiKey(name);
  }

  async deleteApiKey(name: string): Promise<void> {
    await deleteApiKey(name);
  }

  // ── Archive ──────────────────────────────────────────────────────────────

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

  private async _saveArchiveEntry(
    bookId: string,
    title: string,
    author: string,
    counts: Omit<ArchiveBook, "bookId" | "title" | "author" | "archivedAt"> & { archivedAt?: string }
  ): Promise<void> {
    const existing = (await dbLoadArchiveBooks()).find((entry) => entry.bookId === bookId);
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
      await dbDeleteArchiveBook(bookId).catch(() => {});
      return;
    }
    await dbSaveArchiveBook(entry);
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
    await Promise.all(highlights.map((highlight) => this.deleteHighlight(highlight.id)));
  }

  async archiveAndResetGeneration(book: Book): Promise<void> {
    const bookId = book.id;
    // 1. Snapshot the current generation's counts into the archive.
    await this._materializeNotesForArchive(bookId).catch(() => {});
    const counts = await this._archiveCounts(bookId);
    await this._saveArchiveEntry(bookId, book.title, book.author, counts);

    // 2. Clear the active generated artifacts (book + user data stay).
    await this.deleteSemanticMap(bookId).catch(() => {});
    await this.deleteSourceProfile(bookId).catch(() => {});
    await this.deleteImages(bookId).catch(() => {});
    await this.deleteAudioArtifacts(bookId).catch(() => {});

    const appDataDir = await getAppDataDir().catch(() => "");
    if (appDataDir) {
      await Promise.allSettled([
        deleteDirectory(`${appDataDir}/${LUMINA_CONFIG.IMAGE_CACHE_DIR}/${bookId}`),
        deleteDirectory(`${appDataDir}/${LUMINA_CONFIG.AUDIO_CACHE_DIR}/${bookId}`),
      ]);
    }
  }

  async archiveAndRemoveBook(book: Book): Promise<void> {
    const bookId = book.id;
    await this._materializeNotesForArchive(bookId);
    const counts = await this._archiveCounts(bookId);
    await this._saveArchiveEntry(bookId, book.title, book.author, counts);
    await dbArchiveAndRemoveBook(bookId);

    const appDataDir = await getAppDataDir().catch(() => "");
    if (appDataDir) {
      await deleteDirectory(`${appDataDir}/books/${bookId}`).catch(() => {});
    }
  }

  async loadArchiveBooks(): Promise<ArchiveBook[]> {
    return dbLoadArchiveBooks();
  }

  async syncArchiveEntry(bookId: string): Promise<void> {
    const existing = (await dbLoadArchiveBooks()).find((entry) => entry.bookId === bookId);
    if (!existing) return;
    const counts = await this._archiveCounts(bookId);
    await this._saveArchiveEntry(bookId, existing.title, existing.author, {
      ...counts,
      archivedAt: existing.archivedAt,
    });
  }

  async purgeArchive(bookId: string): Promise<void> {
    await dbPurgeArchivedArtifacts(bookId);
    const appDataDir = await getAppDataDir().catch(() => "");
    if (appDataDir) {
      await Promise.allSettled([
        deleteDirectory(`${appDataDir}/${LUMINA_CONFIG.IMAGE_CACHE_DIR}/${bookId}`),
        deleteDirectory(`${appDataDir}/${LUMINA_CONFIG.AUDIO_CACHE_DIR}/${bookId}`),
      ]);
    }
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
        await Promise.all((await this.loadNotes(bookId)).map((note) => this.deleteNote(note.id)));
        break;
      case "presentations":
        await this.deletePresentations(bookId);
        break;
      case "badges":
        await Promise.all(
          (await this.loadStudyBadgeAwards(bookId)).map((badge) => dbDeleteStudyBadgeAward(badge.id))
        );
        break;
    }
    await this.syncArchiveEntry(bookId);
  }

  async purgeAllArchives(): Promise<void> {
    const books = await this.loadArchiveBooks();
    await Promise.all(books.map((book) => this.purgeArchive(book.bookId)));
  }

  async deleteArchivedAudio(audioId: string): Promise<void> {
    const meta = await dbLoadAudioArtifactById(audioId);
    if (!meta) return;
    await dbDeleteAudioArtifact(audioId);
    await this.syncArchiveEntry(meta.bookId);
  }

  async deleteArchivedImage(imageId: string, _sceneId: string): Promise<void> {
    const meta = await dbLoadCachedImageById(imageId);
    if (!meta) return;
    await dbDeleteCachedImage(imageId);
    await this.syncArchiveEntry(meta.bookId);
  }

  async deleteArchivedNote(noteId: string): Promise<void> {
    const note = await dbLoadNoteById(noteId);
    if (!note) return;
    await this.deleteNote(noteId);
    await this.syncArchiveEntry(note.bookId);
  }

  async deleteArchivedPresentation(deckId: string): Promise<void> {
    const deck = await dbLoadPresentationDeckById(deckId);
    if (!deck) return;
    await dbDeletePresentationDeck(deckId);
    await this.syncArchiveEntry(deck.bookId);
  }

  async deleteArchivedBadge(badgeId: string): Promise<void> {
    const badge = await dbLoadStudyBadgeAwardById(badgeId);
    if (!badge) return;
    await dbDeleteStudyBadgeAward(badgeId);
    await this.syncArchiveEntry(badge.bookId);
  }

  // ── Bulk delete ──────────────────────────────────────────────────────────

  async deleteAllBookData(bookId: string): Promise<void> {
    await this.purgeArchive(bookId).catch(() => {});
    await dbDeleteAllBookData(bookId);
    const appDataDir = await getAppDataDir().catch(() => "");
    if (appDataDir) {
      await deleteDirectory(`${appDataDir}/books/${bookId}`).catch(() => {});
    }
  }
}
