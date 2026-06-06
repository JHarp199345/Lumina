import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, FolderOpen, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useBookStore } from "@/store/bookStore";
import { useEpubImport } from "@/hooks/useEpubImport";
import { storage } from "@/storage";
import OpenShelfCatalog from "@/components/common/OpenShelfCatalog";

interface LibraryPanelProps {
  onClose: () => void;
  onImport: () => void;
}

export default function LibraryPanel({ onClose, onImport }: LibraryPanelProps) {
  const { library, removeBook, activeBook } = useBookStore();
  const { openBook, unmountActiveBook, importEpubFile } = useEpubImport();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [openProgress, setOpenProgress] = useState("");
  const [view, setView] = useState<"library" | "open-shelf">("library");

  const handleOpen = async (book: (typeof library)[0]) => {
    setOpenProgress("Preparing reader…");
    try {
      await openBook(book, setOpenProgress);
      await new Promise((resolve) => setTimeout(resolve, 700));
      onClose();
    } catch (err) {
      setOpenProgress(
        `Open failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleDelete = async (bookId: string) => {
    await storage.deleteAllBookData(bookId);
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
            onBack={() => setView("library")}
            onClose={onClose}
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
            onClick={() => setView("open-shelf")}
            className="mb-3 flex w-full items-center gap-3 rounded-lg border border-lumina-gold/25 bg-lumina-gold/8 p-3 text-left transition-colors hover:bg-lumina-gold/12"
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
                        Delete
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
                      aria-label={`Remove ${book.title}`}
                      title="Remove book"
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
