/**
 * StorageAdapter — the single interface through which Lumina reads and writes
 * all persistent data.
 *
 * Two implementations live behind this interface:
 *   TauriStorageAdapter  — SQLite + native file system via Tauri IPC
 *   WebStorageAdapter    — IndexedDB + Blob URLs for the PWA / browser build
 *
 * Nothing outside the storage/ folder should call Tauri IPC or IndexedDB
 * directly — route everything through `import { storage } from "@/storage"`.
 */

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
} from "@/types";

export interface StorageAdapter {
  // ── EPUB file handling ────────────────────────────────────────────────────

  /**
   * Open a platform-appropriate file picker.
   * Returns a File (web) or absolute path string (Tauri), or null if cancelled.
   */
  pickEpubFile(): Promise<File | string | null>;

  /**
   * Persist the EPUB file in app storage and return the stored reference
   * (absolute path for Tauri, bookId key for web — callers treat it opaquely
   * and pass it back via book.filePath).
   */
  storeEpub(source: File | string, bookId: string, fileName: string): Promise<string>;

  /**
   * Return raw bytes for a book's EPUB file.
   * Accepts whatever was returned by storeEpub as book.filePath.
   */
  getEpubBytes(book: Book): Promise<Uint8Array>;

  // ── Library ───────────────────────────────────────────────────────────────

  saveBook(book: Book): Promise<void>;
  loadAllBooks(): Promise<Book[]>;
  deleteBook(bookId: string): Promise<void>;
  updateLastOpened(bookId: string): Promise<void>;

  // ── Reading progress ──────────────────────────────────────────────────────

  saveProgress(progress: ReadingProgress): Promise<void>;
  loadProgress(bookId: string): Promise<ReadingProgress | null>;

  // ── Annotations ───────────────────────────────────────────────────────────

  saveHighlight(highlight: Highlight): Promise<void>;
  loadHighlights(bookId: string): Promise<Highlight[]>;
  deleteHighlight(highlightId: string): Promise<void>;
  updateHighlightColor(highlightId: string, color: HighlightColor): Promise<void>;

  saveNote(note: Note): Promise<void>;
  loadNotes(bookId: string): Promise<Note[]>;
  updateNote(noteId: string, text: string): Promise<void>;
  deleteNote(noteId: string): Promise<void>;

  // ── Semantic map ──────────────────────────────────────────────────────────

  saveSemanticMap(map: SemanticMap): Promise<void>;
  loadSemanticMap(bookId: string): Promise<SemanticMap | null>;
  deleteSemanticMap(bookId: string): Promise<void>;

  // ── Style seed ────────────────────────────────────────────────────────────

  saveBookStyleSeed(bookId: string, seedId: StyleSeedId): Promise<void>;
  loadBookStyleSeed(bookId: string): Promise<StyleSeedId | null>;

  // ── Image cache ───────────────────────────────────────────────────────────

  /**
   * Persist image bytes and metadata.
   * Returns a display-safe URL (asset://, file://, or blob:) for the image.
   */
  saveImage(meta: Omit<CachedImage, "filePath">, data: Uint8Array): Promise<string>;

  /**
   * Load all cached images for a book (exact bookId match).
   * Each CachedImage.filePath is a display-ready URL for this session.
   */
  loadImages(bookId: string): Promise<CachedImage[]>;

  /**
   * Load images for a book or any of its collection segments
   * (bookId OR bookId::segmentId).
   */
  loadImagesForPrefix(bookId: string): Promise<CachedImage[]>;

  deleteImages(bookId: string): Promise<void>;

  // ── API keys ──────────────────────────────────────────────────────────────

  saveApiKey(name: string, value: string): Promise<void>;
  loadApiKey(name: string): Promise<string | null>;
  deleteApiKey(name: string): Promise<void>;

  // ── Bulk delete ───────────────────────────────────────────────────────────

  /** Delete all data associated with a book (library entry, progress, annotations, images…) */
  deleteAllBookData(bookId: string): Promise<void>;
}
