import { useState, useCallback, useRef } from "react";
import { Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useBookStore } from "@/store/bookStore";
import { useAnnotationStore } from "@/store/annotationStore";
import { useImageStore } from "@/store/imageStore";
import type { Book, BookStructure, CachedImage, Highlight, Note, SemanticMap } from "@/types";

interface SearchResult {
  target: string;
  excerpt: string;
  source: "book" | "highlight" | "note" | "visual";
  label: string;
  wordOffset?: number;
}

interface SearchBarProps {
  onClose: () => void;
}

export default function SearchBar({ onClose }: SearchBarProps) {
  const { activeBook, activeStructure, activeSemanticMap } = useBookStore();
  const { getHighlightsForBook, getNotesForBook } = useAnnotationStore();
  const imageCache = useImageStore((s) => s.imageCache);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
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
      if (found.length > 0) navigateToResult(found[0]);
    } catch (err) {
      console.warn("[Search] Failed:", err);
    } finally {
      setIsSearching(false);
    }
  }, [activeBook, activeStructure, activeSemanticMap, getHighlightsForBook, getNotesForBook, imageCache]);

  const navigateToResult = useCallback((result: SearchResult) => {
    const win = window as Window & {
      luminaNavigate?:         (target: string) => void;
      luminaNavigateToScene?:  (target: string, wordOffset?: number) => void;
      luminaMarkSearchResult?: (cfi: string) => void;
      luminaClearSearchMarks?: () => void;
    };
    win.luminaClearSearchMarks?.();
    if (result.target) {
      if (result.wordOffset != null && win.luminaNavigateToScene) {
        win.luminaNavigateToScene(result.target, result.wordOffset);
      } else {
        win.luminaNavigate?.(result.target);
      }
      // Apply visible mark after a short delay to let section render
      if (result.target.startsWith("epubcfi(") && win.luminaMarkSearchResult) {
        setTimeout(() => win.luminaMarkSearchResult!(result.target), 350);
      }
    }
  }, []);

  const goNext = useCallback(() => {
    if (results.length === 0) return;
    const next = (currentIndex + 1) % results.length;
    setCurrentIndex(next);
    navigateToResult(results[next]);
  }, [currentIndex, results, navigateToResult]);

  const goPrev = useCallback(() => {
    if (results.length === 0) return;
    const prev = (currentIndex - 1 + results.length) % results.length;
    setCurrentIndex(prev);
    navigateToResult(results[prev]);
  }, [currentIndex, results, navigateToResult]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="flex flex-col gap-2 p-3 border-b border-hair bg-surface-dark"
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
            if (e.key === "Enter") goNext();
            if (e.key === "Escape") onClose();
          }}
          placeholder="Search book, notes, highlights…"
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

      {/* Current result excerpt */}
      {results[currentIndex] && (
        <div className="space-y-0.5 px-1">
          <p className="text-[10px] uppercase tracking-[0.16em] text-lumina-gold/65">
            {results[currentIndex].label}
          </p>
          <p className="line-clamp-2 text-xs italic text-ink-faint">
            "…{results[currentIndex].excerpt}…"
          </p>
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
  activeBook: Book | null;
  activeStructure: BookStructure | null;
  semanticMap: SemanticMap | null;
  highlights: Highlight[];
  notes: Note[];
  images: CachedImage[];
};

async function searchBookArtifacts({
  query,
  activeStructure,
  semanticMap,
  highlights,
  notes,
  images,
}: ArtifactSearchArgs): Promise<SearchResult[]> {
  const q = query.trim();
  const lower = q.toLowerCase();
  const results: SearchResult[] = [];

  if (activeStructure?.chapters.length) {
    for (const chapter of activeStructure.chapters) {
      const text = chapter.rawText || "";
      for (const match of findTextMatches(text, lower, 4)) {
        results.push({
          target: chapter.href || chapter.startCfi || chapter.id,
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
