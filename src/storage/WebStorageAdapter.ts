/**
 * WebStorageAdapter
 *
 * Implements StorageAdapter using browser-native APIs:
 *   - IndexedDB (via webDb.ts helpers) for all structured data
 *   - ArrayBuffer blobs in IndexedDB for EPUB files and generated images
 *   - localStorage for API keys (simple, survives session with clear warning)
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
  // Stored in localStorage with an "lk_" prefix.
  // Browser localStorage is device-local but not encrypted — appropriate for
  // a local-first app where the user provides their own API key.

  async saveApiKey(name: string, value: string): Promise<void> {
    localStorage.setItem(`lk_${name}`, value);
  }

  async loadApiKey(name: string): Promise<string | null> {
    return localStorage.getItem(`lk_${name}`);
  }

  async deleteApiKey(name: string): Promise<void> {
    localStorage.removeItem(`lk_${name}`);
  }

  // ── Bulk delete ──────────────────────────────────────────────────────────

  async deleteAllBookData(bookId: string): Promise<void> {
    await Promise.allSettled([
      dbDelete(STORES.BOOKS, bookId),
      dbDelete(STORES.BOOK_STRUCTURES, bookId),
      dbDelete(STORES.EPUBS, bookId),
      dbDelete(STORES.PROGRESS, bookId),
      dbDeleteByIndex(STORES.HIGHLIGHTS, "bookId", bookId),
      dbDelete(STORES.SEMANTIC_MAPS, bookId),
      dbDelete(STORES.STUDY_GUIDES, bookId),
      dbDeleteByIndex(STORES.STUDY_QUIZZES, "bookId", bookId),
      dbDeleteByIndex(STORES.STUDY_ATTEMPTS, "bookId", bookId),
      dbDeleteByIndex(STORES.STUDY_FLASHCARDS, "bookId", bookId),
      dbDelete(STORES.BOOK_SETTINGS, bookId),
      this.deleteImages(bookId),
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
