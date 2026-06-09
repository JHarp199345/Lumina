import { useCallback } from "react";
import { readFileBytes } from "@/utils/tauriBridge";
import { parseEpub, extractCoverImage } from "@/pipeline/epubParser";
import { useBookStore } from "@/store/bookStore";
import { useAnnotationStore } from "@/store/annotationStore";
import { useImageStore } from "@/store/imageStore";
import { useReaderStore } from "@/store/readerStore";
import { useStudyStore } from "@/store/studyStore";
import { useAudioStore } from "@/store/audioStore";
import { storage } from "@/storage";
import type { Book, BookStructure, CachedImage } from "@/types";
import { getAnalysisSlice } from "@/pipeline/collectionSlicing";
import { getGoverningImage, hydrateImageWordPositions } from "@/utils/imagePosition";
import { VISUAL_PLAN_VERSION } from "@/config/visualPlan";
import { diagnosticInfo } from "@/utils/diagnostics";

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

async function optionalStep<T>(
  label: string,
  action: () => Promise<T>,
  onProgress?: (message: string) => void
): Promise<T | undefined> {
  onProgress?.(label);
  try {
    const result = await action();
    onProgress?.(`Done: ${label}`);
    return result;
  } catch (err) {
    console.warn(`[Import] Optional step skipped: ${label}`, err);
    onProgress?.(`Skipped: ${label}`);
    return undefined;
  }
}

// A structure parsed before paragraph-preserving extraction has rawText with no
// paragraph breaks at all. A real multi-paragraph book always has some "\n\n";
// if a substantial book has none, the stored structure is stale → re-parse.
function structureLacksParagraphs(structure: Pick<BookStructure, "chapters" | "totalWords">): boolean {
  if (structure.totalWords < 400) return false; // too small to judge; leave as-is
  const hasAnyParagraphBreak = structure.chapters.some((ch) => (ch.rawText ?? "").includes("\n\n"));
  return !hasAnyParagraphBreak;
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
    useStudyStore.getState().clear();
    useAudioStore.getState().clear();
  }, [clearActiveBookState, clearAnnotations, clearImagesForUnmount, resetReader]);

  // ── Import a new EPUB file ──────────────────────────────────────────────────

  // Core import routine — everything after a file has been chosen. Shared by the
  // normal picker flow and the dev test-book loader.
  const runImport = useCallback(async (
    picked: File | string,
    onProgress?: (message: string) => void
  ) => {
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
      picked instanceof File && storage.storeEpubBytes
        ? storage.storeEpubBytes(bytes, structure.bookId, fileName)
        : storage.storeEpub(picked, structure.bookId, fileName)
    );

    const coverImage = await optionalStep("Extracting cover image…", () => extractCoverImage(zip), onProgress);

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
    await runStep("Saving book structure…", () => storage.saveBookStructure(structure));
    await runStep("Resetting reading position…", () =>
      storage.saveProgress({
        bookId: book.id,
        currentCfi: "lumina://cover",
        currentChapterIndex: 0,
        percentComplete: 0,
        lastRead: new Date().toISOString(),
      })
    );

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

  const importEpub = useCallback(async (onProgress?: (message: string) => void) => {
    const picked = await storage.pickEpubFile();
    if (!picked) return null;
    return runImport(picked, onProgress);
  }, [runImport]);

  // Dev/test only: import a book directly from a File, bypassing the picker.
  const importEpubFile = useCallback(
    (file: File, onProgress?: (message: string) => void) => runImport(file, onProgress),
    [runImport]
  );

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

      // 2. Load the stable imported structure. Re-parse when missing, or when
      //    the stored structure predates paragraph-preserving extraction (its
      //    rawText was flattened into one block) so older books self-heal.
      let structure = await storage.loadBookStructure(book.id);
      try {
        if (!structure || structureLacksParagraphs(structure)) {
          onProgress?.(structure ? "Re-reading EPUB for paragraph structure…" : "Reading saved EPUB file…");
          const bytes = await storage.getEpubBytes(book);
          onProgress?.("Parsing saved EPUB structure…");
          const parsed = await parseEpub(bytes, onProgress);
          structure = parsed.structure;
          await storage.saveBookStructure(structure);
        }
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
      const [storedSemanticMap, seedId, highlights, notes, cachedImages, studyGuide, audioArtifacts] = await Promise.all([
        storage.loadSemanticMap(semanticBookId),
        storage.loadBookStyleSeed(book.id),
        storage.loadHighlights(book.id),
        storage.loadNotes(book.id),
        storage.loadImagesForPrefix(book.id),
        storage.loadStudyGuide(book.id).catch(() => null),
        storage.loadAudioArtifacts(book.id).catch(() => []),
      ]);
      const semanticMap =
        storedSemanticMap?.visualPlanVersion === VISUAL_PLAN_VERSION
          ? storedSemanticMap
          : null;
      if (storedSemanticMap && !semanticMap) {
        diagnosticInfo("semantic_map.stale_ignored", "Ignoring stale visual plan", {
          bookId: book.id,
          semanticBookId,
          storedVersion: storedSemanticMap.visualPlanVersion ?? null,
          currentVersion: VISUAL_PLAN_VERSION,
          scenes: storedSemanticMap.scenes.length,
        });
      }

      // 4. Commit everything to stores before setting activeBook.
      //    React batches these, but initialCfi/loadProgress being set first
      //    means the renderer will see them when it first renders.
      if (progress) loadProgress(progress);
      if (structure) setActiveStructure(structure);
      if (semanticMap) setActiveSemanticMap(semanticMap);
      if (seedId) setActiveStyleSeed(seedId);
      loadAnnotations(highlights, notes);
      const hydratedImages = semanticMap && structure
        ? hydrateImageWordPositions(cachedImages, semanticMap.scenes, structure.chapters)
        : cachedImages;
      hydratedImages.forEach((img) => addToCache(img));
      // Mount this book's Study Guide (PLANv) — opt-in artifact, may be null.
      useStudyStore.getState().mount(book.id, studyGuide);
      // Mount this book's Voice Studio audio artifacts (PLANVI).
      useAudioStore.getState().mount(book.id, audioArtifacts);

      // 4b. Restore the display image. Prefer the most recently passed scene that
      //     has a generated image — but NEVER blank the panel when the book has
      //     stored images. If the images don't line up with the current analysis
      //     (re-analyzed, or the map is missing/empty), still show the reader's
      //     art instead of nothing.
      if (hydratedImages.length > 0) {
        const chapters = structure?.chapters ?? [];
        const totalWords = chapters.reduce((s, c) => s + c.wordCount, 0);
        const progressPercent = progress?.percentComplete ?? 0;
        const estimatedWordPos = totalWords > 0 ? (totalWords * progressPercent) / 100 : 0;

        let imageToDisplay = chapters.length > 0
          ? getGoverningImage(hydratedImages, estimatedWordPos, chapters)
          : null;

        // Fallback: no position-matched image — show the most recently generated.
        if (!imageToDisplay) {
          imageToDisplay = [...hydratedImages].sort(
            (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
          )[0] ?? null;
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

  return { importEpub, importEpubFile, loadLibrary, openBook, switchBook, unmountActiveBook };
}
