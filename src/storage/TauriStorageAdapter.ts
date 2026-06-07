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
  dbSaveBookStyleSeed,
  dbLoadBookStyleSeed,
  dbSaveImageCache,
  dbLoadImageCache,
  dbLoadImageCacheForBookPrefix,
  dbDeleteImageCache,
  dbDeleteAllBookData,
} from "@/services/db";
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

  async deleteAudioArtifacts(bookId: string): Promise<void> {
    await dbDeleteAudioArtifacts(bookId);
    const appDataDir = await getAppDataDir().catch(() => "");
    if (appDataDir) {
      await deleteDirectory(`${appDataDir}/${LUMINA_CONFIG.AUDIO_CACHE_DIR}/${bookId}`).catch(() => {});
    }
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

  // ── Bulk delete ──────────────────────────────────────────────────────────

  async deleteAllBookData(bookId: string): Promise<void> {
    await dbDeleteAllBookData(bookId);
    const appDataDir = await getAppDataDir().catch(() => "");
    if (appDataDir) {
      await Promise.allSettled([
        deleteDirectory(`${appDataDir}/books/${bookId}`),
        deleteDirectory(`${appDataDir}/${LUMINA_CONFIG.IMAGE_CACHE_DIR}/${bookId}`),
        deleteDirectory(`${appDataDir}/${LUMINA_CONFIG.AUDIO_CACHE_DIR}/${bookId}`),
      ]);
    }
  }
}
