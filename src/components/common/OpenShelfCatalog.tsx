import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Download, Search, SlidersHorizontal } from "lucide-react";
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

type SortMode = "popular" | "title" | "year";

interface OpenShelfCatalogProps {
  onBack: () => void;
  onClose: () => void;
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

export default function OpenShelfCatalog({ onBack, onClose }: OpenShelfCatalogProps) {
  const { importEpubFile } = useEpubImport();
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("");
  const [sort, setSort] = useState<SortMode>("popular");
  const [books, setBooks] = useState<GutendexBook[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      setIsLoading(true);
      setStatus("");
      try {
        const params = new URLSearchParams();
        params.set("mime_type", "application/epub+zip");
        if (query.trim()) params.set("search", query.trim());
        if (genre) params.set("topic", genre);
        params.set("sort", sort === "popular" ? "popular" : "ascending");
        const response = await fetch(`https://gutendex.com/books?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Catalog returned ${response.status}`);
        const data = await response.json() as { results?: GutendexBook[] };
        setBooks((data.results ?? []).slice(0, 30));
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setStatus(`Catalog failed: ${err instanceof Error ? err.message : String(err)}`);
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
  }, [query, genre, sort]);

  const visibleBooks = useMemo(() => {
    const copy = [...books];
    if (sort === "title") {
      copy.sort((a, b) => a.title.localeCompare(b.title));
    }
    if (sort === "year") {
      copy.sort((a, b) => publicationYear(a) - publicationYear(b));
    }
    return copy;
  }, [books, sort]);

  const importBook = async (book: GutendexBook) => {
    const epubUrl = pickEpubUrl(book);
    if (!epubUrl) {
      setStatus("No EPUB download is available for that book.");
      return;
    }

    setStatus(`Downloading ${book.title}…`);
    try {
      const response = await fetch(epubUrl);
      if (!response.ok) throw new Error(`Download returned ${response.status}`);
      const blob = await response.blob();
      const file = new File([blob], `${safeFileName(book.title)}.epub`, {
        type: "application/epub+zip",
      });
      await importEpubFile(file, setStatus);
      setStatus(`Imported ${book.title}.`);
      window.setTimeout(onClose, 900);
    } catch (err) {
      setStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
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
            <p className="text-xs text-ink-faint">Public-domain books ready to import.</p>
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
              <option value="title">Alphabetical</option>
              <option value="year">Publication year</option>
            </select>
          </div>
        )}
      </div>

      {status && (
        <div className="mx-4 mt-3 rounded-lg border border-hair bg-black/20 px-3 py-2">
          <p className="break-words text-xs text-ink-soft">{status}</p>
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
          </div>
        )}
      </div>
    </div>
  );
}

function pickEpubUrl(book: GutendexBook): string | null {
  return (
    book.formats["application/epub+zip"] ??
    Object.entries(book.formats).find(([type]) => type.includes("epub"))?.[1] ??
    null
  );
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
