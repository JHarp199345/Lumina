import { useCallback } from "react";
import { openEpubDialog, readFileBytes, copyFileToAppData } from "@/utils/tauriBridge";
import { parseEpub, extractCoverImage } from "@/pipeline/epubParser";
import { useBookStore } from "@/store/bookStore";
import { useAnnotationStore } from "@/store/annotationStore";
import { useImageStore } from "@/store/imageStore";
import { useReaderStore } from "@/store/readerStore";
import {
  dbSaveBook,
  dbLoadAllBooks,
  dbLoadProgress,
  dbLoadHighlights,
  dbLoadNotes,
  dbLoadSemanticMap,
  dbLoadImageCache,
  dbLoadBookStyleSeed,
  dbUpdateLastOpened,
} from "@/services/db";
import type { Book } from "@/types";

export function useEpubImport() {
  const {
    addBook,
    updateBook,
    setActiveBook,
    setActiveStructure,
    setActiveSemanticMap,
    setActiveStyleSeed,
    setInitialCfi,
  } = useBookStore();
  const { loadAnnotations } = useAnnotationStore();
  const { addToCache } = useImageStore();
  const { loadProgress } = useReaderStore();

  // ── Import a new EPUB file ──────────────────────────────────────────────────

  const importEpub = useCallback(async () => {
    const filePath = await openEpubDialog();
    if (!filePath) return null;

    const bytes = await readFileBytes(filePath);
    const { structure, zip } = await parseEpub(bytes);

    const fileName = filePath.split("/").pop() || "book.epub";
    const storedPath = await copyFileToAppData(filePath, `books/${structure.bookId}/${fileName}`);
    const coverImage = await extractCoverImage(zip);

    const book: Book = {
      id: structure.bookId,
      title: structure.title,
      author: structure.author,
      filePath: storedPath,
      coverImage,
      totalWords: structure.totalWords,
      parserConfidence: structure.parserConfidence,
      importedAt: new Date().toISOString(),
      lastOpened: new Date().toISOString(),
    };

    await dbSaveBook(book);

    // No saved progress for a new import — set empty initial CFI
    setInitialCfi(null);
    addBook(book);
    setActiveBook(book);
    setActiveStructure(structure);

    console.log(
      `[EPUB Import] "${book.title}" — ${structure.chapters.length} chapters, ` +
        `${structure.totalWords.toLocaleString()} words, confidence: ${structure.parserConfidence}`
    );

    return { book, structure };
  }, [addBook, setActiveBook, setActiveStructure, setInitialCfi]);

  // ── Load the full library from SQLite on startup ────────────────────────────

  const loadLibrary = useCallback(async () => {
    try {
      const books = await dbLoadAllBooks();
      books.forEach((book) => addBook(book));
      return books;
    } catch (err) {
      console.warn("[Library] Failed to load from DB:", err);
      return [];
    }
  }, [addBook]);

  // ── Open an existing book from the library ──────────────────────────────────
  //
  // ORDERING MATTERS: load all data before setting activeBook so EpubRenderer
  // mounts with the correct CFI, annotations, and structure already in store.

  const openBook = useCallback(
    async (book: Book) => {
      // 1. Load reading progress first — captures the CFI we'll restore to
      const progress = await dbLoadProgress(book.id);
      const savedCfi = progress?.currentCfi ?? null;

      // 2. Re-parse EPUB structure (chapters/sections not stored in DB)
      let structure = null;
      try {
        const bytes = await readFileBytes(book.filePath);
        const parsed = await parseEpub(bytes);
        structure = parsed.structure;
      } catch (err) {
        console.warn("[OpenBook] Could not re-parse EPUB:", err);
      }

      // 3. Load all ancillary data
      const [semanticMap, seedId, highlights, notes, cachedImages] = await Promise.all([
        dbLoadSemanticMap(book.id),
        dbLoadBookStyleSeed(book.id),
        dbLoadHighlights(book.id),
        dbLoadNotes(book.id),
        dbLoadImageCache(book.id),
      ]);

      // 4. Commit everything to stores before setting activeBook.
      //    React batches these, but initialCfi/loadProgress being set first
      //    means the renderer will see them when it first renders.
      if (progress) loadProgress(progress);
      if (structure) setActiveStructure(structure);
      if (semanticMap) setActiveSemanticMap(semanticMap);
      if (seedId) setActiveStyleSeed(seedId);
      loadAnnotations(highlights, notes);
      cachedImages.forEach((img) => addToCache(img));

      // 5. Capture the stable initialCfi BEFORE setting activeBook so it's
      //    available synchronously in the first render of EpubRenderer.
      setInitialCfi(savedCfi);

      // 6. Set active book — this triggers EpubRenderer to mount.
      setActiveBook(book);

      // 7. Update last-opened timestamp
      await dbUpdateLastOpened(book.id).catch(() => {});
      updateBook(book.id, { lastOpened: new Date().toISOString() });
    },
    [
      setActiveBook,
      setActiveStructure,
      setActiveSemanticMap,
      setActiveStyleSeed,
      setInitialCfi,
      loadProgress,
      loadAnnotations,
      addToCache,
      updateBook,
    ]
  );

  return { importEpub, loadLibrary, openBook };
}
