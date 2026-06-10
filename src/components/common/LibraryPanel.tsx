import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  Copy,
  FolderOpen,
  Plus,
  Sparkles,
  Download,
  ExternalLink,
  FileText,
  Trash2,
  X,
} from "lucide-react";
import ManualImportInstructions from "@/components/common/ManualImportInstructions";
import { useBookStore } from "@/store/bookStore";
import { useEpubImport } from "@/hooks/useEpubImport";
import { storage } from "@/storage";
import OpenShelfCatalog from "@/components/common/OpenShelfCatalog";
import type { BookStructure } from "@/types";
import { loadImportHistory, clearImportHistory, type ImportHistoryEntry } from "@/utils/importHistory";

interface LibraryPanelProps {
  onClose: () => void;
  onImport: () => void;
  onImportProgress?: (message: string) => void;
  onBookImported?: (structure: BookStructure) => void;
}

export default function LibraryPanel({
  onClose,
  onImport,
  onImportProgress,
  onBookImported,
}: LibraryPanelProps) {
  const { library, removeBook, activeBook } = useBookStore();
  const { openBook, unmountActiveBook, importEpubFile } = useEpubImport();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [openProgress, setOpenProgress] = useState("");
  const [view, setView] = useState<"library" | "open-shelf" | "import-history">("library");
  const [importHistory, setImportHistory] = useState<ImportHistoryEntry[]>(() => loadImportHistory());
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const refreshImportHistory = () => setImportHistory(loadImportHistory());

  useEffect(() => {
    refreshImportHistory();
  }, []);

  const reportOpenProgress = (message: string) => {
    setOpenProgress(message);
    onImportProgress?.(message);
  };

  const handleOpen = async (book: (typeof library)[0]) => {
    reportOpenProgress("Preparing reader…");
    try {
      await openBook(book, reportOpenProgress);
      await new Promise((resolve) => setTimeout(resolve, 700));
      onImportProgress?.("");
      setOpenProgress("");
      onClose();
    } catch (err) {
      reportOpenProgress(
        `Open failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleDelete = async (bookId: string) => {
    const book = library.find((entry) => entry.id === bookId);
    if (!book) return;
    await storage.archiveAndRemoveBook(book);
    removeBook(bookId);
    if (activeBook?.id === bookId) unmountActiveBook();
    setConfirmDelete(null);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-scrim backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: -24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: -24, opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 280 }}
        className="fixed left-20 top-6 z-50 flex max-h-[calc(100dvh-3rem)] w-[min(520px,calc(100vw-6rem))] flex-col overflow-hidden rounded-xl border border-hair bg-panel shadow-2xl shadow-black/40"
        onClick={(event) => event.stopPropagation()}
      >
        {view === "open-shelf" ? (
          <OpenShelfCatalog
            onBack={() => {
              refreshImportHistory();
              setView("library");
            }}
            onClose={onClose}
            onImport={onImport}
            onImportProgress={onImportProgress}
            historyCount={importHistory.length}
            onHistoryUpdated={refreshImportHistory}
            onOpenHistory={() => {
              refreshImportHistory();
              setView("import-history");
            }}
            onBookImported={(structure) => {
              refreshImportHistory();
              onBookImported?.(structure);
            }}
          />
        ) : view === "import-history" ? (
          <ImportHistoryView
            history={importHistory}
            library={library}
            copiedId={copiedId}
            onBack={() => setView("library")}
            onCopy={async (entry) => {
              if (!entry.filename) return;
              try {
                await navigator.clipboard.writeText(entry.filename);
                setCopiedId(entry.gutenbergId);
                setTimeout(() => setCopiedId(null), 2000);
              } catch { /* denied */ }
            }}
            onClear={() => {
              clearImportHistory();
              setImportHistory([]);
            }}
            onImport={onImport}
          />
        ) : (
          <>
        <div className="flex items-center justify-between border-b border-hair px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-hair bg-ink/[0.05] text-ink-soft">
              <BookOpen size={15} />
            </div>
            <div>
              <p className="text-sm font-medium text-ink/80">Library</p>
              <p className="text-xs text-ink-faint">
                {library.length === 1 ? "1 saved book" : `${library.length} saved books`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-ink-faint transition hover:bg-ink/[0.06] hover:text-ink/75"
            aria-label="Close library"
            title="Close library"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {openProgress && (
            <div className="mb-3 rounded-lg border border-hair bg-black/20 px-3 py-2">
              <p className="break-words text-xs text-ink-soft">{openProgress}</p>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              onImportProgress?.("");
              setView("open-shelf");
            }}
            className="mb-2 flex w-full items-center gap-3 rounded-lg border border-lumina-gold/25 bg-lumina-gold/8 p-3 text-left transition-colors hover:bg-lumina-gold/12"
          >
            <div className="flex h-12 w-10 flex-shrink-0 items-center justify-center rounded-md border border-lumina-gold/30 bg-black/15 text-lumina-gold">
              <Sparkles size={17} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-lumina-gold/90">Open Shelf</p>
              <p className="mt-0.5 text-xs text-ink-faint">
                Browse free public-domain books and import them into Lumina.
              </p>
            </div>
            <FolderOpen size={15} className="text-lumina-gold/75" />
          </button>

          {importHistory.length > 0 && (
            <button
              type="button"
              onClick={() => {
                refreshImportHistory();
                setView("import-history");
              }}
              className="mb-3 flex w-full items-center gap-3 rounded-lg border border-hair bg-ink/[0.04] p-3 text-left transition-colors hover:bg-ink/[0.07]"
            >
              <div className="flex h-12 w-10 flex-shrink-0 items-center justify-center rounded-md border border-hair bg-black/10 text-ink-faint">
                <Clock size={15} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink/75">Downloads</p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {importHistory.length} book{importHistory.length !== 1 ? "s" : ""} — filenames and import status
                </p>
              </div>
            </button>
          )}

          {library.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-hair bg-black/10 px-6 text-center">
              <BookOpen size={24} className="text-ink-faint" />
              <p className="mt-4 text-sm text-ink-soft">No books saved yet</p>
              <p className="mt-1 max-w-72 text-xs leading-relaxed text-ink-faint">
                Imported EPUBs will live here so you can reopen them with their reading state.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {library.map((book) => (
                <div
                  key={book.id}
                  className={[
                    "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                    activeBook?.id === book.id
                      ? "border-lumina-gold/25 bg-lumina-gold/8"
                      : "border-hair bg-ink/[0.05] hover:border-hair",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => handleOpen(book)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p
                      className={[
                        "truncate text-sm font-medium",
                        activeBook?.id === book.id ? "text-lumina-gold" : "text-ink/75",
                      ].join(" ")}
                    >
                      {book.title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-faint">{book.author}</p>
                    <p className="mt-1 text-xs text-ink-faint">
                      {book.totalWords.toLocaleString()} words
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpen(book)}
                    className="rounded-md p-2 text-ink-faint transition hover:bg-ink/[0.06] hover:text-ink/75"
                    aria-label={`Open ${book.title}`}
                    title="Open book"
                  >
                    <FolderOpen size={15} />
                  </button>

                  {confirmDelete === book.id ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDelete(book.id)}
                        className="text-xs text-red-300 transition hover:text-red-200"
                      >
                        Archive
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="text-xs text-ink-faint transition hover:text-ink-soft"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(book.id)}
                      className="rounded-md p-2 text-ink-faint transition hover:bg-red-400/8 hover:text-red-300"
                      aria-label={`Archive ${book.title}`}
                      title="Remove from library (artifacts go to Archive)"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-hair p-4">
          {activeBook && (
            <button
              type="button"
              onClick={() => {
                unmountActiveBook();
                onClose();
              }}
              className="rounded-lg border border-hair px-3 py-2 text-xs text-ink-faint transition hover:border-hair hover:text-ink-soft"
            >
              Close current book
            </button>
          )}
          {import.meta.env.DEV && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const { buildSampleEpubFile } = await import("@/utils/sampleBook");
                  const file = await buildSampleEpubFile();
                  await importEpubFile(file);
                  onClose();
                } catch (err) {
                  console.error("[Library] Load sample failed:", err);
                }
              }}
              className="rounded-lg border border-hair px-3 py-2 text-xs text-ink-faint transition hover:border-hair hover:text-ink-soft"
            >
              Load sample
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onClose();
              onImport();
            }}
            className="ml-auto flex items-center gap-2 rounded-lg border border-lumina-gold/30 bg-lumina-gold/10 px-3 py-2 text-xs text-lumina-gold/85 transition hover:bg-lumina-gold/15 hover:text-lumina-gold"
          >
            <Plus size={14} />
            Import EPUB
          </button>
        </div>
        </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Import History sub-view ──────────────────────────────────────────────────

interface ImportHistoryViewProps {
  history: ImportHistoryEntry[];
  library: { id: string; gutenbergId?: number }[];
  copiedId: number | null;
  onBack: () => void;
  onCopy: (entry: ImportHistoryEntry) => void;
  onClear: () => void;
  onImport: () => void;
}

function ImportHistoryView({
  history,
  library,
  copiedId,
  onBack,
  onCopy,
  onClear,
  onImport,
}: ImportHistoryViewProps) {
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const importedIds = new Set(library.map((b) => b.gutenbergId).filter(Boolean));
  const pendingCount = history.filter(
    (entry) => entry.filename && !importedIds.has(entry.gutenbergId)
  ).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-hair px-5 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-hair text-ink-faint transition hover:bg-ink/[0.06] hover:text-ink-soft"
          >
            <ArrowLeft size={15} />
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-hair bg-ink/[0.05] text-ink-soft">
            <Download size={15} />
          </div>
          <div>
            <p className="text-sm font-medium text-ink/80">Downloads</p>
            <p className="text-xs text-ink-faint">History of imported books</p>
          </div>
        </div>
        {history.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 text-xs text-ink-faint/60 transition hover:text-ink-faint"
          >
            <Trash2 size={12} />
            Clear
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {history.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-faint">No downloads yet.</p>
        ) : (
          <>
            <div className="mb-3">
              <button
                type="button"
                onClick={() => setInstructionsOpen((open) => !open)}
                className="flex w-full items-center justify-between rounded-lg border border-hair bg-ink/[0.03] px-3 py-2 text-left transition hover:bg-ink/[0.05]"
              >
                <span className="text-xs text-ink-soft underline decoration-ink-faint/50 underline-offset-2">
                  How to import downloaded files
                  {pendingCount > 0 ? ` (${pendingCount} waiting)` : ""}
                </span>
                <ChevronDown
                  size={14}
                  className={`flex-shrink-0 text-ink-faint transition-transform ${instructionsOpen ? "rotate-180" : ""}`}
                />
              </button>
              {instructionsOpen && (
                <div className="mt-1.5 rounded-lg border border-hair bg-ink/[0.03] px-3 py-2.5">
                  <ManualImportInstructions iconsOnly compact />
                  <button
                    type="button"
                    onClick={onImport}
                    className="mt-2.5 w-full rounded-lg border border-lumina-gold/30 bg-lumina-gold/10 px-3 py-2 text-xs text-lumina-gold transition hover:bg-lumina-gold/15"
                  >
                    Choose downloaded file
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              {history.map((entry) => {
                const isInLibrary = importedIds.has(entry.gutenbergId);
                const isCopied = copiedId === entry.gutenbergId;
                const when = formatHistoryWhen(entry);
                const downloadUrl = entryDownloadUrl(entry);

                return (
                  <div
                    key={entry.gutenbergId}
                    className="rounded-lg border border-hair bg-ink/[0.04] p-3"
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-hair bg-black/15 text-ink-faint">
                        <FileText size={14} />
                      </div>
                      <div className="min-w-0 flex-1">
                        {entry.filename ? (
                          <div className="flex items-center gap-1.5">
                            <p
                              className="truncate font-serif text-sm font-semibold tracking-tight text-ink/92"
                              title={entry.filename}
                            >
                              {entry.filename}
                            </p>
                            <button
                              type="button"
                              onClick={() => onCopy(entry)}
                              className="flex-shrink-0 text-ink-faint transition hover:text-ink-soft"
                              title="Copy filename"
                            >
                              {isCopied ? (
                                <Check size={12} className="text-green-400" />
                              ) : (
                                <Copy size={12} />
                              )}
                            </button>
                          </div>
                        ) : null}
                        <p className="mt-0.5 line-clamp-2 text-xs text-ink/75" title={entry.title}>
                          {entry.title}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-ink-faint">
                          {when ? <span>{when}</span> : null}
                          {isInLibrary ? (
                            <span className="text-green-400/90">Imported</span>
                          ) : entry.filename ? (
                            <span className="text-lumina-gold/80">Ready to import</span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {!isInLibrary && downloadUrl ? (
                      <div className="mt-2 flex justify-end border-t border-hair/60 pt-2">
                        <a
                          href={downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-ink-faint underline decoration-ink-faint/40 underline-offset-2 transition hover:text-ink-soft"
                        >
                          Open download link
                          <ExternalLink size={10} />
                        </a>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatHistoryWhen(entry: ImportHistoryEntry): string {
  const iso = entry.downloadedAt ?? entry.importedAt;
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function entryDownloadUrl(entry: ImportHistoryEntry): string | null {
  if (entry.downloadUrl) return entry.downloadUrl;
  if (entry.gutenbergId) {
    return `https://www.gutenberg.org/ebooks/${entry.gutenbergId}.epub3.images`;
  }
  return null;
}
