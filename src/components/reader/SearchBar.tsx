import { useState, useCallback, useRef } from "react";
import { Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useBookStore } from "@/store/bookStore";
import { useAnnotationStore } from "@/store/annotationStore";
import { useImageStore } from "@/store/imageStore";
import { useEpubImport } from "@/hooks/useEpubImport";
import { navigateReader } from "@/utils/readerNavigation";
import type { Book, BookStructure, CachedImage, Highlight, Note, SemanticMap } from "@/types";

interface SearchResult {
  target: string;
  excerpt: string;
  source: "library" | "book" | "highlight" | "note" | "visual";
  label: string;
  wordOffset?: number;
  book?: Book;
}

interface SearchBarProps {
  onClose: () => void;
}

export default function SearchBar({ onClose }: SearchBarProps) {
  const { library, activeBook, activeStructure, activeSemanticMap } = useBookStore();
  const { getHighlightsForBook, getNotesForBook } = useAnnotationStore();
  const imageCache = useImageStore((s) => s.imageCache);
  const { openBook } = useEpubImport();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [status, setStatus] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim() || q.length < 3) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const found = await searchBookArtifacts({
        query: q,
        library,
        activeBook,
        activeStructure,
        semanticMap: activeSemanticMap,
        highlights: activeBook ? getHighlightsForBook(activeBook.id) : [],
        notes: activeBook ? getNotesForBook(activeBook.id) : [],
        images: activeBook
          ? Object.values(imageCache).filter((img) => img.bookId === activeBook.id)
          : [],
      });
      setResults(found);
      setCurrentIndex(0);
    } catch (err) {
      console.warn("[Search] Failed:", err);
    } finally {
      setIsSearching(false);
    }
  }, [library, activeBook, activeStructure, activeSemanticMap, getHighlightsForBook, getNotesForBook, imageCache]);

  const navigateToResult = useCallback(async (result: SearchResult) => {
    if (result.source === "library" && result.book) {
      setStatus(`Opening ${result.book.title}…`);
      await openBook(result.book, setStatus);
      setStatus("");
      onClose();
      return;
    }

    const win = window as Window & {
      luminaMarkSearchResult?: (cfi: string) => void;
      luminaClearSearchMarks?: () => void;
    };
    win.luminaClearSearchMarks?.();
    if (result.target) {
      navigateReader(result.target, result.wordOffset);
      // Apply visible mark after a short delay to let section render
      if (result.target.startsWith("epubcfi(") && win.luminaMarkSearchResult) {
        setTimeout(() => win.luminaMarkSearchResult!(result.target), 350);
      }
    }
  }, [onClose, openBook]);

  const goNext = useCallback(() => {
    if (results.length === 0) return;
    const next = (currentIndex + 1) % results.length;
    setCurrentIndex(next);
    void navigateToResult(results[next]);
  }, [currentIndex, results, navigateToResult]);

  const goPrev = useCallback(() => {
    if (results.length === 0) return;
    const prev = (currentIndex - 1 + results.length) % results.length;
    setCurrentIndex(prev);
    void navigateToResult(results[prev]);
  }, [currentIndex, results, navigateToResult]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="flex max-h-[min(520px,calc(100dvh-5rem))] flex-col gap-2 overflow-hidden rounded-xl border border-hair bg-surface-dark p-3 shadow-2xl shadow-black/40"
    >
      {/* Search input */}
      <div className="flex items-center gap-2 bg-black/30 border border-hair rounded-lg px-3 py-2">
        <Search size={13} className="text-ink-faint flex-shrink-0" />
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            handleSearch(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[currentIndex]) void navigateToResult(results[currentIndex]);
            if (e.key === "Escape") onClose();
          }}
          placeholder="Search library, book, notes…"
          className="flex-1 bg-transparent text-xs text-ink-soft placeholder:text-ink-faint focus:outline-none"
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setResults([]); }}
            className="text-ink-faint hover:text-ink-soft transition-colors"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {status && (
        <p className="rounded-lg border border-hair bg-black/20 px-3 py-2 text-xs text-ink-soft">
          {status}
        </p>
      )}

      {/* Results navigation */}
      {results.length > 0 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-ink-faint">
            {currentIndex + 1} of {results.length}
          </span>
          <div className="flex gap-1">
            <button
              onClick={goPrev}
              className="p-1 rounded text-ink-faint hover:text-ink-soft hover:bg-ink/5 transition-colors"
            >
              <ChevronUp size={13} />
            </button>
            <button
              onClick={goNext}
              className="p-1 rounded text-ink-faint hover:text-ink-soft hover:bg-ink/5 transition-colors"
            >
              <ChevronDown size={13} />
            </button>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <div className="space-y-1">
            {results.map((result, index) => (
              <button
                key={`${result.source}-${result.target}-${index}`}
                onClick={() => void navigateToResult(result)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  index === currentIndex
                    ? "border-lumina-gold/35 bg-lumina-gold/10"
                    : "border-hair bg-ink/[0.03] hover:bg-ink/[0.06]"
                }`}
              >
                <span className="block text-[10px] uppercase tracking-[0.16em] text-lumina-gold/65">
                  {result.label}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-ink-soft">
                  {result.source === "library" ? result.excerpt : `…${result.excerpt}…`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {query.length >= 3 && results.length === 0 && !isSearching && (
        <p className="text-xs text-ink-faint px-1">No results found.</p>
      )}
    </motion.div>
  );
}

// ─── Book Artifact Search ────────────────────────────────────────────────────

type ArtifactSearchArgs = {
  query: string;
  library: Book[];
  activeBook: Book | null;
  activeStructure: BookStructure | null;
  semanticMap: SemanticMap | null;
  highlights: Highlight[];
  notes: Note[];
  images: CachedImage[];
};

async function searchBookArtifacts({
  query,
  library,
  activeStructure,
  semanticMap,
  highlights,
  notes,
  images,
}: ArtifactSearchArgs): Promise<SearchResult[]> {
  const q = query.trim();
  const lower = q.toLowerCase();
  const results: SearchResult[] = [];

  for (const book of library) {
    const haystack = `${book.title} ${book.author}`.toLowerCase();
    if (!haystack.includes(lower)) continue;
    results.push({
      target: book.id,
      excerpt: `${book.title}${book.author ? ` · ${book.author}` : ""}`,
      source: "library",
      label: "Library book",
      book,
    });
  }

  if (activeStructure?.chapters.length) {
    for (const chapter of activeStructure.chapters) {
      const text = chapter.rawText || "";
      for (const match of findTextMatches(text, lower, 4)) {
        results.push({
          target: `lumina://chapter/${chapter.index}/page/0`,
          wordOffset: countWords(text.slice(0, match.index)),
          excerpt: excerptAround(text, match.index, q.length),
          source: "book",
          label: "Book text",
        });
      }
      if (results.length >= 80) break;
    }
  } else {
    const epubSearch = (window as Window & {
      luminaEpubSearch?: (query: string) => Promise<{ cfi: string; excerpt: string }[]>;
    }).luminaEpubSearch;
    if (epubSearch) {
      const found = await epubSearch(q);
      results.push(
        ...found.slice(0, 80).map((r) => ({
          target: r.cfi,
          excerpt: r.excerpt || q,
          source: "book" as const,
          label: "Book text",
        }))
      );
    }
  }

  for (const h of highlights) {
    if (!h.selectedText.toLowerCase().includes(lower)) continue;
    results.push({
      target: h.locator || h.cfiRange,
      excerpt: excerptAround(h.selectedText, h.selectedText.toLowerCase().indexOf(lower), q.length),
      source: "highlight",
      label: "Highlight",
    });
  }

  const highlightById = new Map(highlights.map((h) => [h.id, h]));
  for (const note of notes) {
    const noteIndex = note.noteText.toLowerCase().indexOf(lower);
    const linked = note.highlightId ? highlightById.get(note.highlightId) : undefined;
    const linkedIndex = linked?.selectedText.toLowerCase().indexOf(lower) ?? -1;
    if (noteIndex < 0 && linkedIndex < 0) continue;
    results.push({
      target: linked?.locator || linked?.cfiRange || "",
      excerpt:
        noteIndex >= 0
          ? excerptAround(note.noteText, noteIndex, q.length)
          : excerptAround(linked?.selectedText ?? "", linkedIndex, q.length),
      source: "note",
      label: "Note",
    });
  }

  const sceneById = new Map((semanticMap?.scenes ?? []).map((scene) => [scene.id, scene]));
  for (const image of images) {
    const haystack = [
      image.sceneId,
      image.descriptionUsed,
      ...(image.emotionalThemes ?? []),
    ]
      .filter(Boolean)
      .join(" ");
    const index = haystack.toLowerCase().indexOf(lower);
    if (index < 0) continue;
    const scene = sceneById.get(image.sceneId);
    results.push({
      target: scene?.anchor?.href || scene?.chapterId || image.sceneId,
      wordOffset: scene?.anchor?.wordOffset,
      excerpt: excerptAround(haystack, index, q.length),
      source: "visual",
      label: "Visual artifact",
    });
  }

  return dedupeResults(results).slice(0, 120);
}

function findTextMatches(text: string, lowerQuery: string, maxPerText: number) {
  const lowerText = text.toLowerCase();
  const matches: { index: number }[] = [];
  let from = 0;
  while (matches.length < maxPerText) {
    const index = lowerText.indexOf(lowerQuery, from);
    if (index < 0) break;
    matches.push({ index });
    from = index + lowerQuery.length;
  }
  return matches;
}

function excerptAround(text: string, index: number, length: number): string {
  const safeIndex = Math.max(0, index);
  return text
    .slice(Math.max(0, safeIndex - 42), safeIndex + length + 64)
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = `${result.source}:${result.target}:${result.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
