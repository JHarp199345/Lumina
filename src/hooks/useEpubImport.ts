import { useCallback } from "react";
import { readFileBytes } from "@/utils/tauriBridge";
import { parseEpub, extractCoverImage } from "@/pipeline/epubParser";
import { useBookStore } from "@/store/bookStore";
import { useAnnotationStore } from "@/store/annotationStore";
import { useImageStore } from "@/store/imageStore";
import { useReaderStore } from "@/store/readerStore";
import { storage } from "@/storage";
import type { Book, CachedImage } from "@/types";
import { getAnalysisSlice } from "@/pipeline/collectionSlicing";
import { computeSceneWordPosition } from "@/utils/scenePosition";

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

export function useEpubImport() {
  const {
    addBook,
    updateBook,
    setActiveBook,
    setActiveStructure,
    setActiveSemanticMap,
    setActiveStyleSeed,
    setInitialCfi,
    clearActiveBookState,
  } = useBookStore();
  const { loadAnnotations, clearAnnotations } = useAnnotationStore();
  const { addToCache, clearImagesForUnmount, setCurrentImage, setCurrentThemes } = useImageStore();
  const { loadProgress, resetReader } = useReaderStore();

  const unmountActiveBook = useCallback(() => {
    clearActiveBookState();
    clearAnnotations();
    clearImagesForUnmount();
    resetReader();
  }, [clearActiveBookState, clearAnnotations, clearImagesForUnmount, resetReader]);

  // ── Import a new EPUB file ──────────────────────────────────────────────────

  const importEpub = useCallback(async (onProgress?: (message: string) => void) => {
    const runStep = async <T,>(label: string, action: () => Promise<T>): Promise<T> => {
      onProgress?.(label);
      try {
        const result = await action();
        onProgress?.(`Done: ${label}`);
        return result;
      } catch (err) {
        throw new Error(`${label} failed: ${describeError(err)}`);
      }
    };

    const picked = await runStep("Opening file picker…", () => storage.pickEpubFile());
    if (!picked) return null;

    // Read bytes from the File object (web) or file path (Tauri)
    let bytes: Uint8Array;
    if (picked instanceof File) {
      const buf = await runStep("Reading EPUB file…", () => picked.arrayBuffer());
      bytes = new Uint8Array(buf);
    } else {
      bytes = await runStep("Reading EPUB file…", () => readFileBytes(picked as string));
    }

    // Give React a breath to render the import status before parsing a large EPUB.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const { structure, zip } = await runStep("Parsing EPUB structure…", () =>
      parseEpub(bytes, onProgress)
    );

    const fileName =
      picked instanceof File
        ? picked.name
        : (picked as string).split("/").pop() || "book.epub";

    const storedPath = await runStep("Copying book into Lumina…", () =>
      storage.storeEpub(picked, structure.bookId, fileName)
    );

    const coverImage = await runStep("Extracting cover image…", () => extractCoverImage(zip));

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

    await runStep("Saving book to library…", () => storage.saveBook(book));

    onProgress?.("Mounting book in Lumina…");

    // Mount the new book cleanly, dismounting any prior active book artifacts.
    unmountActiveBook();

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
  }, [addBook, setActiveBook, setActiveStructure, setInitialCfi, unmountActiveBook]);

  // ── Load the full library from SQLite on startup ────────────────────────────

  const loadLibrary = useCallback(async () => {
    try {
      const books = await storage.loadAllBooks();
      books.forEach((book) => addBook(book));
      return books;
    } catch (err) {
      console.warn("[Library] Failed to load library:", err);
      return [];
    }
  }, [addBook]);

  // ── Open an existing book from the library ──────────────────────────────────
  //
  // ORDERING MATTERS: load all data before setting activeBook so EpubRenderer
  // mounts with the correct CFI, annotations, and structure already in store.

  const openBook = useCallback(
    async (book: Book, onProgress?: (message: string) => void) => {
      onProgress?.(`Opening ${book.title}…`);
      unmountActiveBook();

      // 1. Load reading progress first — captures the CFI we'll restore to
      onProgress?.("Loading saved reading state…");
      const progress = await storage.loadProgress(book.id);
      const savedCfi = progress?.currentCfi ?? null;

      // 2. Re-parse EPUB structure (chapters/sections not stored in DB)
      let structure = null;
      try {
        onProgress?.("Reading saved EPUB file…");
        const bytes = await storage.getEpubBytes(book);
        onProgress?.("Parsing saved EPUB structure…");
        const parsed = await parseEpub(bytes, onProgress);
        structure = parsed.structure;
      } catch (err) {
        console.warn("[OpenBook] Could not re-parse EPUB:", err);
        onProgress?.(
          `Could not refresh table of contents: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      const semanticBookId = structure
        ? getAnalysisSlice(structure, progress?.currentChapterIndex ?? 0).semanticBookId
        : book.id;

      // 3. Load all ancillary data
      const [semanticMap, seedId, highlights, notes, cachedImages] = await Promise.all([
        storage.loadSemanticMap(semanticBookId),
        storage.loadBookStyleSeed(book.id),
        storage.loadHighlights(book.id),
        storage.loadNotes(book.id),
        storage.loadImagesForPrefix(book.id),
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

      // 4b. Restore the contextually correct display image.
      //     Find the most recently passed scene that already has a generated image.
      if (semanticMap && cachedImages.length > 0) {
        const imageMap: Record<string, CachedImage> = {};
        cachedImages.forEach((img) => { imageMap[img.sceneId] = img; });

        const chapters = structure?.chapters ?? [];
        const totalWords = chapters.reduce((s, c) => s + c.wordCount, 0);
        const progressPercent = progress?.percentComplete ?? 0;
        const estimatedWordPos = totalWords > 0 ? (totalWords * progressPercent) / 100 : 0;

        let imageToDisplay: CachedImage | null = null;
        let bestPos = -1;

        for (const scene of semanticMap.scenes) {
          const pos = computeSceneWordPosition(scene, chapters);
          if (pos <= estimatedWordPos && pos > bestPos && imageMap[scene.id]) {
            imageToDisplay = imageMap[scene.id];
            bestPos = pos;
          }
        }

        // Fallback: show the first available image if reader hasn't passed any scene yet
        if (!imageToDisplay) {
          imageToDisplay = cachedImages[0] ?? null;
        }

        if (imageToDisplay) {
          setCurrentImage(imageToDisplay);
          setCurrentThemes(imageToDisplay.emotionalThemes);
        }
      }

      // 5. Capture the stable initialCfi BEFORE setting activeBook so it's
      //    available synchronously in the first render of EpubRenderer.
      setInitialCfi(savedCfi);

      // 6. Set active book — this triggers EpubRenderer to mount.
      onProgress?.("Mounting reader…");
      setActiveBook(book);

      // 7. Update last-opened timestamp
      await storage.updateLastOpened(book.id).catch(() => {});
      updateBook(book.id, { lastOpened: new Date().toISOString() });
      onProgress?.(`Opened ${book.title}.`);
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
      setCurrentImage,
      setCurrentThemes,
      updateBook,
      unmountActiveBook,
    ]
  );

  // ── Switch to a different book from the library ─────────────────────────────
  //
  // Cleanly dismounts the current book's in-memory artifacts before mounting
  // the new one. SQLite data for both books is preserved throughout.

  const switchBook = useCallback(
    async (book: Book, onProgress?: (message: string) => void) => {
      unmountActiveBook();
      // Small yield so React can unmount EpubRenderer cleanly before re-mounting
      await new Promise((resolve) => setTimeout(resolve, 50));
      await openBook(book, onProgress);
    },
    [unmountActiveBook, openBook]
  );

  return { importEpub, loadLibrary, openBook, switchBook, unmountActiveBook };
}
