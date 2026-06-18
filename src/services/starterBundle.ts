/**
 * Starter-bundle export (operator tool).
 *
 * Packages one fully-analyzed book — book record, EPUB, semantic map, study
 * guide, quizzes, flashcards, notes, and generated images — into a single JSON
 * the operator downloads, drops into `public/starter-kit/`, and commits. On a
 * fresh visit the app hydrates it so the book is pre-loaded (PLANxvi Part One).
 *
 * v1 keeps it simple: images + EPUB are base64-inlined so it's ONE file to move.
 * (A later optimization can split media to remote URLs for a tinier first load.)
 */

import { storage } from "@/storage";
import type {
  Book,
  BookStructure,
  SemanticMap,
  SourceIntelligenceProfile,
  StudyGuide,
  StudyQuiz,
  StudyFlashcard,
  Note,
  CachedImage,
} from "@/types";

export const STARTER_BUNDLE_VERSION = 1;

export interface StarterBundle {
  bundleVersion: number;
  exportedAt: string;
  book: Book;
  epubBase64: string;
  structure: BookStructure | null;
  semanticMap: SemanticMap | null;
  sourceProfile: SourceIntelligenceProfile | null;
  studyGuide: StudyGuide | null;
  quizzes: StudyQuiz[];
  flashcards: StudyFlashcard[];
  notes: Note[];
  images: Array<{ meta: Omit<CachedImage, "filePath">; dataBase64: string }>;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function urlToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  return uint8ToBase64(new Uint8Array(await res.arrayBuffer()));
}

/** Build the starter bundle for a book and trigger a download. */
export async function exportStarterBundle(bookId: string): Promise<void> {
  const book = (await storage.loadAllBooks()).find((b) => b.id === bookId);
  if (!book) throw new Error(`Book ${bookId} not found`);

  const epubBytes = await storage.getEpubBytes(book);
  const images = await storage.loadImages(bookId);

  const bundle: StarterBundle = {
    bundleVersion: STARTER_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    book,
    epubBase64: uint8ToBase64(epubBytes),
    structure: await storage.loadBookStructure(bookId),
    semanticMap: await storage.loadSemanticMap(bookId),
    sourceProfile: await storage.loadSourceProfile(bookId),
    studyGuide: await storage.loadStudyGuide(bookId),
    quizzes: await storage.loadStudyQuizzes(bookId),
    flashcards: await storage.loadStudyFlashcards(bookId),
    notes: await storage.loadNotes(bookId),
    images: await Promise.all(
      images.map(async (img) => {
        const { filePath, ...meta } = img;
        return { meta, dataBase64: await urlToBase64(filePath) };
      })
    ),
  };

  const slug = (book.title || bookId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || bookId;
  const json = JSON.stringify(bundle);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `starter-${slug}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
