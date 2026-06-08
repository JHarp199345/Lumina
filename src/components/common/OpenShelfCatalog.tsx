import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Download, FolderOpen, Search, SlidersHorizontal } from "lucide-react";
import { useEpubImport } from "@/hooks/useEpubImport";

interface GutendexBook {
  id: number;
  title: string;
  authors: { name: string; birth_year: number | null; death_year: number | null }[];
  subjects: string[];
  languages: string[];
  download_count: number;
  formats: Record<string, string>;
}

type SortMode = "popular" | "title-asc" | "title-desc" | "year-asc" | "year-desc";

interface OpenShelfCatalogProps {
  onBack: () => void;
  onClose: () => void;
  onImport: () => void;
}

const GENRES = [
  "Fiction",
  "Fantasy",
  "Science fiction",
  "Gothic fiction",
  "Mystery",
  "Adventure",
  "Philosophy",
  "Poetry",
  "Mythology",
  "History",
];

const FALLBACK_BOOKS: GutendexBook[] = [
  fallbackBook(1342, "Pride and Prejudice", "Austen, Jane", 1775, 1817, ["Fiction", "Love stories"], 0),
  fallbackBook(84, "Frankenstein; Or, The Modern Prometheus", "Shelley, Mary Wollstonecraft", 1797, 1851, ["Gothic fiction", "Science fiction"], 0),
  fallbackBook(2701, "Moby Dick; Or, The Whale", "Melville, Herman", 1819, 1891, ["Adventure", "Fiction"], 0),
  fallbackBook(11, "Alice's Adventures in Wonderland", "Carroll, Lewis", 1832, 1898, ["Fantasy", "Children's stories"], 0),
  fallbackBook(1661, "The Adventures of Sherlock Holmes", "Doyle, Arthur Conan", 1859, 1930, ["Mystery", "Detective fiction"], 0),
  fallbackBook(345, "Dracula", "Stoker, Bram", 1847, 1912, ["Gothic fiction", "Horror"], 0),
  fallbackBook(98, "A Tale of Two Cities", "Dickens, Charles", 1812, 1870, ["History", "Fiction"], 0),
  fallbackBook(174, "The Picture of Dorian Gray", "Wilde, Oscar", 1854, 1900, ["Philosophy", "Fiction"], 0),
  fallbackBook(5200, "Metamorphosis", "Kafka, Franz", 1883, 1924, ["Fiction"], 0),
  fallbackBook(2600, "War and Peace", "Tolstoy, Leo", 1828, 1910, ["History", "Fiction"], 0),
];

interface CatalogPage {
  count: number;
  next: string | null;
  results: GutendexBook[];
}

interface CatalogCacheEntry {
  books: GutendexBook[];
  nextUrl: string | null;
  count: number;
}

const catalogCache = new Map<string, CatalogCacheEntry>();

export default function OpenShelfCatalog({ onBack, onClose, onImport }: OpenShelfCatalogProps) {
  const { importEpubFile } = useEpubImport();
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("");
  const [sort, setSort] = useState<SortMode>("popular");
  const [books, setBooks] = useState<GutendexBook[]>([]);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [status, setStatus] = useState("");
  const [showImportPulse, setShowImportPulse] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestKey = useMemo(() => `${query.trim().toLowerCase()}|${genre}|${sort}`, [query, genre, sort]);

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      const cached = catalogCache.get(requestKey);
      if (cached) {
        setBooks(cached.books);
        setNextUrl(cached.nextUrl);
        setTotalCount(cached.count);
        return;
      }

      setIsLoading(true);
      setStatus("");
      setBooks([]);
      setNextUrl(null);
      setTotalCount(0);
      try {
        const response = await fetch(buildCatalogUrl(query, genre, sort), {
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Catalog returned ${response.status}`);
        const data = await response.json() as CatalogPage;
        const results = data.results ?? [];
        setBooks(results);
        setNextUrl(normalizeCatalogUrl(data.next));
        setTotalCount(data.count ?? results.length);
        catalogCache.set(requestKey, {
          books: results,
          nextUrl: normalizeCatalogUrl(data.next),
          count: data.count ?? results.length,
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          const fallback = filterFallbackBooks(query, genre, sort);
          setBooks(fallback);
          setNextUrl(null);
          setTotalCount(fallback.length);
          setStatus(
            `Live catalog failed: ${err instanceof Error ? err.message : String(err)}. Showing a small Gutenberg fallback shelf.`
          );
        }
      } finally {
        setIsLoading(false);
      }
    };
    const timer = window.setTimeout(run, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, genre, sort, requestKey]);

  const loadMore = useCallback(async () => {
    if (!nextUrl || isLoading || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const response = await fetch(nextUrl, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error(`Catalog returned ${response.status}`);
      const data = await response.json() as CatalogPage;
      const incoming = data.results ?? [];
      setBooks((current) => {
        const seen = new Set(current.map((book) => book.id));
        const merged = [...current, ...incoming.filter((book) => !seen.has(book.id))];
        catalogCache.set(requestKey, {
          books: merged,
          nextUrl: normalizeCatalogUrl(data.next),
          count: data.count ?? totalCount,
        });
        return merged;
      });
      setNextUrl(normalizeCatalogUrl(data.next));
      setTotalCount(data.count ?? totalCount);
    } catch (err) {
      setStatus(`More books failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoading, isLoadingMore, nextUrl, requestKey, totalCount]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !nextUrl) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { rootMargin: "320px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, nextUrl]);

  const visibleBooks = useMemo(() => {
    // Dedup by id — Gutendex can return the same work across pages/feeds, and
    // the initial load doesn't dedup like loadMore does. This guarantees unique
    // React keys regardless of which load path produced the list.
    const byId = new Map<number, GutendexBook>();
    for (const book of books) if (!byId.has(book.id)) byId.set(book.id, book);
    const copy = [...byId.values()];
    if (sort === "title-asc") {
      copy.sort((a, b) => a.title.localeCompare(b.title));
    }
    if (sort === "title-desc") {
      copy.sort((a, b) => b.title.localeCompare(a.title));
    }
    if (sort === "year-asc") {
      copy.sort((a, b) => publicationYear(a) - publicationYear(b));
    }
    if (sort === "year-desc") {
      copy.sort((a, b) => publicationYear(b) - publicationYear(a));
    }
    return copy;
  }, [books, sort]);

  const importBook = async (book: GutendexBook) => {
    const epubUrls = pickEpubUrls(book);
    if (epubUrls.length === 0) {
      setStatus("No EPUB download is available for that book.");
      return;
    }

    setStatus(`Downloading ${book.title}…`);
    setShowImportPulse(false);
    try {
      const file = await downloadFirstWorkingEpub(book, epubUrls, setStatus);
      await importEpubFile(file, setStatus);
      setStatus(`Imported ${book.title}.`);
      window.setTimeout(onClose, 900);
    } catch (err) {
      startBrowserDownload(epubUrls[0], book.title);
      console.warn("[OpenShelf] Automatic import failed; browser download fallback started.", err);
      setStatus("");
      setShowImportPulse(true);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-hair px-5 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-hair text-ink-faint transition hover:bg-ink/[0.06] hover:text-ink-soft"
            title="Back to library"
          >
            <ArrowLeft size={15} />
          </button>
          <div>
            <p className="text-sm font-medium text-ink/80">Open Shelf</p>
            <p className="text-xs text-ink-faint">
              {totalCount
                ? `${books.length.toLocaleString()} of ${totalCount.toLocaleString()} loaded`
                : "Public-domain books ready to download."}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-lg border border-hair bg-black/20 px-3 py-2">
          <Search size={13} className="text-ink-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title or author…"
            className="min-w-0 flex-1 bg-transparent text-xs text-ink-soft placeholder:text-ink-faint focus:outline-none"
          />
          <button
            onClick={() => setShowFilters((value) => !value)}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
              showFilters || genre || sort !== "popular"
                ? "bg-lumina-gold/15 text-lumina-gold"
                : "text-ink-faint hover:bg-ink/[0.06] hover:text-ink-soft"
            }`}
          >
            <SlidersHorizontal size={13} />
          </button>
        </div>

        {showFilters && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <select
              value={genre}
              onChange={(event) => setGenre(event.target.value)}
              className="rounded-lg border border-hair bg-black/20 px-3 py-2 text-xs text-ink-soft focus:outline-none"
            >
              <option value="">All genres</option>
              {GENRES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortMode)}
              className="rounded-lg border border-hair bg-black/20 px-3 py-2 text-xs text-ink-soft focus:outline-none"
            >
              <option value="popular">Popular</option>
              <option value="title-asc">Alphabetical A-Z</option>
              <option value="title-desc">Alphabetical Z-A</option>
              <option value="year-asc">Earliest era first</option>
              <option value="year-desc">Latest era first</option>
            </select>
          </div>
        )}
      </div>

      {status && (
        <div className="mx-4 mt-3 rounded-lg border border-hair bg-black/20 px-3 py-2">
          <p className="break-words text-xs text-ink-soft">{status}</p>
        </div>
      )}

      {showImportPulse && (
        <div className="mx-4 mt-3 flex justify-center">
          <button
            type="button"
            onClick={onImport}
            className="flex h-12 w-12 animate-pulse items-center justify-center rounded-full border border-lumina-gold/50 bg-lumina-gold/16 text-lumina-gold shadow-[0_0_32px_rgba(196,163,74,0.28)] transition-colors hover:bg-lumina-gold/22"
            aria-label="Open downloaded EPUB"
            title="Open downloaded EPUB"
          >
            <FolderOpen size={20} />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
        {isLoading && books.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-ink-faint">Loading the shelf…</p>
        ) : visibleBooks.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-ink-faint">No free books match that search.</p>
        ) : (
          <div className="space-y-2">
            {visibleBooks.map((book) => (
              <div
                key={book.id}
                className="flex gap-3 rounded-lg border border-hair bg-ink/[0.05] p-3 transition-colors hover:bg-ink/[0.07]"
              >
                <div className="flex h-12 w-10 flex-shrink-0 items-center justify-center rounded-md border border-lumina-gold/20 bg-lumina-gold/8 text-lumina-gold/75">
                  <BookOpen size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium text-ink/78">{book.title}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-faint">{authorLine(book)}</p>
                  <p className="mt-1 text-[11px] text-ink-faint">
                    {publicationYear(book) ? `${publicationYear(book)} · ` : ""}
                    {book.languages.join(", ").toUpperCase()} · {book.download_count.toLocaleString()} downloads
                  </p>
                </div>
                <button
                  onClick={() => importBook(book)}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-lumina-gold/25 bg-lumina-gold/10 text-lumina-gold/85 transition hover:bg-lumina-gold/15 hover:text-lumina-gold"
                  title="Import to Lumina"
                >
                  <Download size={15} />
                </button>
              </div>
            ))}
            <div ref={sentinelRef} />
            {nextUrl && (
              <button
                onClick={() => void loadMore()}
                disabled={isLoadingMore}
                className="mt-3 w-full rounded-lg border border-hair bg-ink/[0.04] px-3 py-2 text-xs text-ink-soft transition-colors hover:bg-ink/[0.07] disabled:opacity-45"
              >
                {isLoadingMore ? "Loading more…" : "Load more books"}
              </button>
            )}
            {!nextUrl && visibleBooks.length > 0 && (
              <p className="px-2 py-3 text-center text-[11px] text-ink-faint">
                End of this shelf. Some Gutenberg downloads may need to be imported from the browser's Downloads folder.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function buildCatalogUrl(query: string, genre: string, sort: SortMode): string {
  const params = new URLSearchParams();
  params.set("mime_type", "application/epub+zip");
  if (query.trim()) params.set("search", query.trim());
  if (genre) params.set("topic", genre);
  // Gutendex supports popularity and stable ascending order. Title/year sorting
  // is applied to loaded pages client-side so the first screen still arrives fast.
  params.set("sort", sort === "popular" ? "popular" : "ascending");
  return `https://gutendex.com/books?${params.toString()}`;
}

function normalizeCatalogUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:") parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return url.replace(/^http:\/\//i, "https://");
  }
}

function fallbackBook(
  id: number,
  title: string,
  author: string,
  birthYear: number | null,
  deathYear: number | null,
  subjects: string[],
  downloadCount: number
): GutendexBook {
  return {
    id,
    title,
    authors: [{ name: author, birth_year: birthYear, death_year: deathYear }],
    subjects,
    languages: ["en"],
    download_count: downloadCount,
    formats: {
      "application/epub+zip": `https://www.gutenberg.org/ebooks/${id}.epub.images`,
    },
  };
}

function filterFallbackBooks(query: string, genre: string, sort: SortMode): GutendexBook[] {
  const q = query.trim().toLowerCase();
  const filtered = FALLBACK_BOOKS.filter((book) => {
    const haystack = `${book.title} ${authorLine(book)} ${book.subjects.join(" ")}`.toLowerCase();
    const matchesQuery = !q || haystack.includes(q);
    const matchesGenre =
      !genre || book.subjects.some((subject) => subject.toLowerCase().includes(genre.toLowerCase()));
    return matchesQuery && matchesGenre;
  });

  const copy = [...filtered];
  if (sort === "title-asc") copy.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "title-desc") copy.sort((a, b) => b.title.localeCompare(a.title));
  if (sort === "year-asc") copy.sort((a, b) => publicationYear(a) - publicationYear(b));
  if (sort === "year-desc") copy.sort((a, b) => publicationYear(b) - publicationYear(a));
  return copy;
}

async function downloadFirstWorkingEpub(
  book: GutendexBook,
  urls: string[],
  onProgress: (message: string) => void
): Promise<File> {
  const failures: string[] = [];
  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    try {
      onProgress(
        urls.length > 1
          ? `Downloading ${book.title}… format ${index + 1} of ${urls.length}`
          : `Downloading ${book.title}…`
      );
      const response = await fetch(url, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error(`Download returned ${response.status}`);
      const blob = await response.blob();
      await assertLooksLikeEpub(blob);
      return new File([blob], `${safeFileName(book.title)}.epub`, {
        type: "application/epub+zip",
      });
    } catch (err) {
      failures.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`No EPUB format could be imported. ${failures[0] ?? ""}`.trim());
}

function startBrowserDownload(url: string | undefined, title: string): void {
  if (!url) return;
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName(title)}.epub`;
  link.rel = "noopener";
  link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function pickEpubUrls(book: GutendexBook): string[] {
  const epubEntries = Object.entries(book.formats)
    .filter(([type, url]) => type.toLowerCase().includes("epub") && Boolean(url))
    .map(([type, url]) => ({ type: type.toLowerCase(), url: normalizeDownloadUrl(url) }));

  const exact = epubEntries.filter((entry) => entry.type.includes("application/epub+zip"));
  const candidates = exact.length > 0 ? exact : epubEntries;
  if (candidates.length === 0) return [];

  const score = (url: string) => {
    if (/\.epub\.images($|\?)/i.test(url)) return 0;
    if (/\.epub($|\?)/i.test(url)) return 1;
    if (/\.epub\.noimages($|\?)/i.test(url)) return 2;
    if (/\.epub3\.images($|\?)/i.test(url)) return 3;
    if (/\.epub3($|\?)/i.test(url)) return 4;
    if (/epub/i.test(url)) return 5;
    return 9;
  };

  return [...new Set(candidates.map((entry) => entry.url))]
    .sort((a, b) => score(a) - score(b));
}

function normalizeDownloadUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" && parsed.hostname.endsWith("gutenberg.org")) {
      parsed.protocol = "https:";
    }
    return parsed.toString();
  } catch {
    return url.replace(/^http:\/\/(www\.)?gutenberg\.org/i, "https://www.gutenberg.org");
  }
}

async function assertLooksLikeEpub(blob: Blob): Promise<void> {
  const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const looksLikeZip = header[0] === 0x50 && header[1] === 0x4b;
  if (looksLikeZip) return;

  const contentType = blob.type || "unknown content type";
  throw new Error(`The download was not an EPUB file (${contentType}).`);
}

function authorLine(book: GutendexBook): string {
  return book.authors.map((author) => author.name).join(", ") || "Unknown author";
}

function publicationYear(book: GutendexBook): number {
  const years = book.authors
    .map((author) => author.birth_year)
    .filter((year): year is number => typeof year === "number");
  return years.length ? Math.min(...years) : 0;
}

function safeFileName(title: string): string {
  return title.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "open_shelf_book";
}
