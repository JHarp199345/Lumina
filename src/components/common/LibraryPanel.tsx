import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, FolderOpen, Plus, Trash2, X } from "lucide-react";
import { useBookStore } from "@/store/bookStore";
import { useEpubImport } from "@/hooks/useEpubImport";
import { dbDeleteBook } from "@/services/db";
import { deleteDirectory, getAppDataDir } from "@/utils/tauriBridge";

interface LibraryPanelProps {
  onClose: () => void;
  onImport: () => void;
}

export default function LibraryPanel({ onClose, onImport }: LibraryPanelProps) {
  const { library, removeBook, activeBook } = useBookStore();
  const { openBook, unmountActiveBook } = useEpubImport();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [openProgress, setOpenProgress] = useState("");

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
    await dbDeleteBook(bookId);
    removeBook(bookId);
    if (activeBook?.id === bookId) unmountActiveBook();
    setConfirmDelete(null);

    try {
      const appData = await getAppDataDir();
      await Promise.allSettled([
        deleteDirectory(`${appData}/books/${bookId}`),
        deleteDirectory(`${appData}/lumina/cache/images/${bookId}`),
        deleteDirectory(`${appData}/lumina/cache/images/${bookId}::`),
      ]);
    } catch {
      // File cleanup is best-effort. The library record is already gone.
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: -24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: -24, opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 280 }}
        className="fixed left-20 top-6 z-50 flex max-h-[calc(100dvh-3rem)] w-[min(520px,calc(100vw-6rem))] flex-col overflow-hidden rounded-xl border border-sky-200/14 bg-[#07192b] shadow-2xl shadow-black/40"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-sky-200/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-sky-200/14 bg-sky-100/[0.04] text-sky-100/65">
              <BookOpen size={15} />
            </div>
            <div>
              <p className="text-sm font-medium text-sky-50/80">Library</p>
              <p className="text-xs text-sky-100/25">
                {library.length === 1 ? "1 saved book" : `${library.length} saved books`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-sky-100/35 transition hover:bg-sky-100/[0.06] hover:text-sky-50/75"
            aria-label="Close library"
            title="Close library"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {openProgress && (
            <div className="mb-3 rounded-lg border border-sky-200/10 bg-black/20 px-3 py-2">
              <p className="break-words text-xs text-sky-50/55">{openProgress}</p>
            </div>
          )}

          {library.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-sky-200/12 bg-black/10 px-6 text-center">
              <BookOpen size={24} className="text-sky-100/25" />
              <p className="mt-4 text-sm text-sky-50/70">No books saved yet</p>
              <p className="mt-1 max-w-72 text-xs leading-relaxed text-sky-100/25">
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
                      : "border-sky-200/10 bg-sky-100/[0.035] hover:border-sky-100/20",
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
                        activeBook?.id === book.id ? "text-lumina-gold" : "text-sky-50/75",
                      ].join(" ")}
                    >
                      {book.title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-sky-100/28">{book.author}</p>
                    <p className="mt-1 text-xs text-sky-100/20">
                      {book.totalWords.toLocaleString()} words
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpen(book)}
                    className="rounded-md p-2 text-sky-100/35 transition hover:bg-sky-100/[0.06] hover:text-sky-50/75"
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
                        className="text-xs text-sky-100/30 transition hover:text-sky-100/55"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(book.id)}
                      className="rounded-md p-2 text-sky-100/20 transition hover:bg-red-400/8 hover:text-red-300"
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

        <div className="flex items-center gap-2 border-t border-sky-200/10 p-4">
          {activeBook && (
            <button
              type="button"
              onClick={() => {
                unmountActiveBook();
                onClose();
              }}
              className="rounded-lg border border-sky-200/10 px-3 py-2 text-xs text-sky-100/42 transition hover:border-sky-100/20 hover:text-sky-50/70"
            >
              Close current book
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
      </motion.div>
    </AnimatePresence>
  );
}
