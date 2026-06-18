import { storage } from "@/storage";
import type { CachedImage, ReadingProgress } from "@/types";
import type { StarterBundle } from "@/services/starterBundle";

const STARTER_BUNDLE_FILES = [
  "starter-kit/starter-frankenstein-or-the-modern-prometheus.json",
];

const STARTER_HYDRATION_KEY = "lumina.starterKit.hydrated.v1";

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function starterUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function fetchStarterBundle(path: string): Promise<StarterBundle> {
  const urls = [starterUrl(path), `/${path}`];
  let lastError: unknown = null;

  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) {
        lastError = new Error(`Starter bundle ${url} failed to load (${res.status})`);
        continue;
      }

      const text = await res.text();
      return JSON.parse(text) as StarterBundle;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Starter bundle ${path} was not valid JSON`);
}

async function saveStarterBundle(bundle: StarterBundle): Promise<void> {
  if (bundle.bundleVersion !== 1) {
    throw new Error(`Unsupported starter bundle version ${bundle.bundleVersion}`);
  }

  const bookId = bundle.book.id;
  const epubPath = storage.storeEpubBytes
    ? await storage.storeEpubBytes(
        base64ToUint8(bundle.epubBase64),
        bookId,
        `${bookId}.epub`
      )
    : bundle.book.filePath;

  const book = {
    ...bundle.book,
    filePath: epubPath,
    importedAt: bundle.book.importedAt ?? bundle.exportedAt,
    lastOpened: new Date().toISOString(),
  };
  await storage.saveBook(book);

  if (bundle.structure) await storage.saveBookStructure(bundle.structure);
  if (bundle.semanticMap) await storage.saveSemanticMap(bundle.semanticMap);
  if (bundle.sourceProfile) await storage.saveSourceProfile(bundle.sourceProfile);
  if (bundle.studyGuide) await storage.saveStudyGuide(bundle.studyGuide);
  await Promise.all(bundle.quizzes.map((quiz) => storage.saveStudyQuiz(quiz)));
  if (bundle.flashcards.length > 0) await storage.saveStudyFlashcards(bundle.flashcards);
  await Promise.all(bundle.notes.map((note) => storage.saveNote(note)));

  for (const image of bundle.images) {
    const meta = image.meta as Omit<CachedImage, "filePath">;
    await storage.saveImage(meta, base64ToUint8(image.dataBase64));
  }

  const firstChapter = bundle.structure?.chapters[0];
  const progress: ReadingProgress = {
    bookId,
    currentCfi: firstChapter?.startCfi ?? "",
    currentChapterIndex: firstChapter?.index ?? 0,
    percentComplete: 0,
    lastRead: new Date().toISOString(),
  };
  await storage.saveProgress(progress);

  const firstSeed = bundle.images[0]?.meta.styleSeed;
  if (firstSeed) await storage.saveBookStyleSeed(bookId, firstSeed);
}

/**
 * Hydrate public starter books once for a fresh browser library.
 * Existing libraries are left alone.
 */
export async function hydrateStarterLibrary(): Promise<boolean> {
  const existingBooks = await storage.loadAllBooks();
  if (existingBooks.length > 0) return false;
  if (window.localStorage.getItem(STARTER_HYDRATION_KEY) === "1") return false;

  const bundles = await Promise.all(STARTER_BUNDLE_FILES.map(fetchStarterBundle));
  for (const bundle of bundles) {
    await saveStarterBundle(bundle);
  }

  window.localStorage.setItem(STARTER_HYDRATION_KEY, "1");
  return bundles.length > 0;
}
