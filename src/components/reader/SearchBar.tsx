import { useState, useCallback, useRef } from "react";
import { Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface SearchResult {
  cfi: string;
  excerpt: string;
  chapterId?: string;
}

interface SearchBarProps {
  onClose: () => void;
}

export default function SearchBar({ onClose }: SearchBarProps) {
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
      // EPUB.js search via the exposed book object
      const epubBook = (window as Window & {
        luminaEpubSearch?: (query: string) => Promise<SearchResult[]>;
      }).luminaEpubSearch;

      if (epubBook) {
        const found = await epubBook(q);
        setResults(found);
        setCurrentIndex(0);
        if (found.length > 0) {
          navigateToResult(found[0]);
        }
      } else {
        // Fallback: simple text search in DOM
        const domResults = searchInDom(q);
        setResults(domResults);
        setCurrentIndex(0);
      }
    } catch (err) {
      console.warn("[Search] Failed:", err);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const navigateToResult = useCallback((result: SearchResult) => {
    const win = window as Window & {
      luminaNavigate?:         (target: string) => void;
      luminaMarkSearchResult?: (cfi: string) => void;
      luminaClearSearchMarks?: () => void;
    };
    win.luminaClearSearchMarks?.();
    if (result.cfi && win.luminaNavigate) {
      win.luminaNavigate(result.cfi);
      // Apply visible mark after a short delay to let section render
      if (win.luminaMarkSearchResult) {
        setTimeout(() => win.luminaMarkSearchResult!(result.cfi), 350);
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
      className="flex flex-col gap-2 p-3 border-b border-white/5 bg-surface-dark"
    >
      {/* Search input */}
      <div className="flex items-center gap-2 bg-black/30 border border-white/10 rounded-lg px-3 py-2">
        <Search size={13} className="text-white/25 flex-shrink-0" />
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
          placeholder="Search in book…"
          className="flex-1 bg-transparent text-xs text-white/60 placeholder:text-white/20 focus:outline-none"
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setResults([]); }}
            className="text-white/20 hover:text-white/50 transition-colors"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Results navigation */}
      {results.length > 0 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-white/25">
            {currentIndex + 1} of {results.length}
          </span>
          <div className="flex gap-1">
            <button
              onClick={goPrev}
              className="p-1 rounded text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
            >
              <ChevronUp size={13} />
            </button>
            <button
              onClick={goNext}
              className="p-1 rounded text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
            >
              <ChevronDown size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Current result excerpt */}
      {results[currentIndex] && (
        <p className="text-xs text-white/30 line-clamp-2 px-1 italic">
          "…{results[currentIndex].excerpt}…"
        </p>
      )}

      {query.length >= 3 && results.length === 0 && !isSearching && (
        <p className="text-xs text-white/20 px-1">No results found.</p>
      )}
    </motion.div>
  );
}

// ─── DOM fallback search ──────────────────────────────────────────────────────

function searchInDom(query: string): SearchResult[] {
  const lowerQuery = query.toLowerCase();
  const results: SearchResult[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent || "";
    const idx = text.toLowerCase().indexOf(lowerQuery);
    if (idx >= 0) {
      const excerpt = text.slice(Math.max(0, idx - 20), idx + query.length + 20).trim();
      results.push({ cfi: "", excerpt });
      if (results.length >= 50) break; // cap at 50 DOM results
    }
  }

  return results;
}
