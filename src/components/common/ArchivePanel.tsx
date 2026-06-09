import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ArrowLeft,
  AudioLines,
  ChevronRight,
  Image as ImageIcon,
  NotebookTabs,
  Pause,
  Play,
  Presentation,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { storage } from "@/storage";
import { archiveSummaryLine, type ArchiveCategory } from "@/storage/archiveOps";
import { useAudioStore } from "@/store/audioStore";
import { isTauri } from "@/utils/runtime";
import { toAssetUrl } from "@/utils/tauriBridge";
import type {
  ArchiveBook,
  AudioArtifact,
  CachedImage,
  Note,
  PresentationDeck,
  StudyBadgeAward,
} from "@/types";

type ArchiveTab = ArchiveCategory;

interface ArchivePanelProps {
  onClose: () => void;
}

function displaySrc(src: string): string {
  const isUrl =
    src.startsWith("blob:") ||
    src.startsWith("data:") ||
    src.startsWith("asset:") ||
    src.startsWith("http:") ||
    src.startsWith("https:");
  return isTauri && !isUrl ? toAssetUrl(src) : src;
}

function audioLabel(artifact: AudioArtifact): string {
  if (artifact.scope === "overview") {
    const mins = artifact.overviewMinutes ?? "?";
    return `Audio Overview · ${mins} min`;
  }
  return artifact.segmentTitle || "Voice segment";
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function ArchivePanel({ onClose }: ArchivePanelProps) {
  const [entries, setEntries] = useState<ArchiveBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ArchiveBook | null>(null);
  const [tab, setTab] = useState<ArchiveTab>("audio");
  const [confirmPurgeBook, setConfirmPurgeBook] = useState(false);
  const [confirmClearTab, setConfirmClearTab] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [audio, setAudio] = useState<AudioArtifact[]>([]);
  const [images, setImages] = useState<CachedImage[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [badges, setBadges] = useState<StudyBadgeAward[]>([]);
  const [presentations, setPresentations] = useState<PresentationDeck[]>([]);
  const [focusedImage, setFocusedImage] = useState<CachedImage | null>(null);

  const {
    bookId: playingBookId,
    activeAudioId,
    isPlaying,
    mount,
    setActiveAudio,
    setIsPlaying,
  } = useAudioStore();

  const refreshList = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await storage.loadArchiveBooks());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const loadDetail = useCallback(
    async (entry: ArchiveBook) => {
      setDetailLoading(true);
      try {
        const [loadedAudio, loadedImages, loadedNotes, loadedBadges, loadedDecks] =
          await Promise.all([
            storage.loadAudioArtifacts(entry.bookId),
            storage.loadImagesForPrefix(entry.bookId),
            storage.loadNotes(entry.bookId),
            storage.loadStudyBadgeAwards(entry.bookId),
            storage.loadPresentations(entry.bookId),
          ]);
        setAudio(loadedAudio);
        setImages(
          [...loadedImages].sort(
            (a, b) =>
              (a.wordPosition ?? 0) - (b.wordPosition ?? 0) ||
              new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime()
          )
        );
        setNotes(loadedNotes);
        setBadges(loadedBadges);
        setPresentations(loadedDecks);
        mount(entry.bookId, loadedAudio);
      } finally {
        setDetailLoading(false);
      }
    },
    [mount]
  );

  const refreshAfterChange = useCallback(async () => {
    const books = await storage.loadArchiveBooks();
    setEntries(books);
    if (!selected) return;
    const still = books.find((entry) => entry.bookId === selected.bookId);
    if (!still) {
      setSelected(null);
      setConfirmPurgeBook(false);
      setConfirmClearTab(false);
      return;
    }
    setSelected(still);
    await loadDetail(still);
  }, [loadDetail, selected]);

  const openEntry = (entry: ArchiveBook) => {
    setSelected(entry);
    setTab("audio");
    setConfirmPurgeBook(false);
    setConfirmClearTab(false);
    void loadDetail(entry);
  };

  const handleBack = () => {
    setSelected(null);
    setConfirmPurgeBook(false);
    setConfirmClearTab(false);
    setFocusedImage(null);
  };

  const handlePurgeBook = async () => {
    if (!selected) return;
    await storage.purgeArchive(selected.bookId);
    handleBack();
    await refreshList();
  };

  const handleClearTab = async () => {
    if (!selected) return;
    await storage.purgeArchiveCategory(selected.bookId, tab);
    setConfirmClearTab(false);
    await refreshAfterChange();
  };

  const handleClearAll = async () => {
    await storage.purgeAllArchives();
    setConfirmClearAll(false);
    handleBack();
    await refreshList();
  };

  const togglePlay = (artifact: AudioArtifact) => {
    if (artifact.status !== "ready") return;
    if (playingBookId !== selected?.bookId) {
      mount(selected!.bookId, audio);
    }
    if (activeAudioId === artifact.id && isPlaying) {
      setIsPlaying(false);
      return;
    }
    setActiveAudio(artifact.id);
    setIsPlaying(true);
  };

  const tabs: { id: ArchiveTab; label: string; icon: typeof AudioLines; count: number }[] =
    selected
      ? [
          { id: "audio", label: "Audio", icon: AudioLines, count: audio.length },
          { id: "images", label: "Images", icon: ImageIcon, count: images.length },
          { id: "notes", label: "Notes", icon: NotebookTabs, count: notes.length },
          { id: "presentations", label: "Presentations", icon: Presentation, count: presentations.length },
          { id: "badges", label: "Badges", icon: Trophy, count: badges.length },
        ]
      : [];

  const activeTabCount = tabs.find((item) => item.id === tab)?.count ?? 0;

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
        <div className="flex items-center justify-between border-b border-hair px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {selected ? (
              <button
                type="button"
                onClick={handleBack}
                className="rounded-md p-1.5 text-ink-faint transition hover:bg-ink/[0.06] hover:text-ink/75"
                aria-label="Back to archive"
              >
                <ArrowLeft size={15} />
              </button>
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-hair bg-ink/[0.05] text-ink-soft">
                <Archive size={15} />
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink/80">
                {selected ? selected.title : "Archive"}
              </p>
              <p className="truncate text-xs text-ink-faint">
                {selected
                  ? `${selected.author} · archived ${formatDate(selected.archivedAt)}`
                  : loading
                    ? "Loading…"
                    : entries.length === 1
                      ? "1 archived book"
                      : `${entries.length} archived books`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-ink-faint transition hover:bg-ink/[0.06] hover:text-ink/75"
            aria-label="Close archive"
          >
            <X size={15} />
          </button>
        </div>

        {!selected ? (
          <>
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <p className="px-2 py-8 text-center text-xs text-ink-faint">Loading archive…</p>
              ) : entries.length === 0 ? (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-hair bg-black/10 px-6 text-center">
                  <Archive size={24} className="text-ink-faint" />
                  <p className="mt-4 text-sm text-ink-soft">Nothing archived yet</p>
                  <p className="mt-1 max-w-72 text-xs leading-relaxed text-ink-faint">
                    When you remove a book from the library, its audio, images, notes, presentations,
                    and quiz badges are kept here.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {entries.map((entry) => (
                    <button
                      key={entry.bookId}
                      type="button"
                      onClick={() => openEntry(entry)}
                      className="flex w-full items-center gap-3 rounded-lg border border-hair bg-ink/[0.05] p-3 text-left transition-colors hover:border-hair hover:bg-ink/[0.07]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink/75">{entry.title}</p>
                        <p className="mt-0.5 truncate text-xs text-ink-faint">{entry.author}</p>
                        <p className="mt-1 text-xs text-ink-faint">
                          {archiveSummaryLine(entry) || "No artifacts saved"}
                        </p>
                      </div>
                      <ChevronRight size={15} className="flex-shrink-0 text-ink-faint" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            {entries.length > 0 && (
              <div className="border-t border-hair px-4 py-3">
                {confirmClearAll ? (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-ink-faint">Delete the entire archive?</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleClearAll()}
                        className="text-xs text-red-300 hover:text-red-200"
                      >
                        Clear all
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClearAll(false)}
                        className="text-xs text-ink-faint hover:text-ink-soft"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(true)}
                    className="flex items-center gap-2 text-xs text-ink-faint transition hover:text-red-300"
                  >
                    <Trash2 size={12} />
                    Clear entire archive
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-1 overflow-x-auto border-b border-hair px-3 py-2">
              {tabs.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTab(item.id);
                      setConfirmClearTab(false);
                    }}
                    className={[
                      "flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                      tab === item.id
                        ? "bg-lumina-gold/12 text-lumina-gold"
                        : "text-ink-faint hover:bg-ink/[0.05] hover:text-ink-soft",
                    ].join(" ")}
                  >
                    <Icon size={12} />
                    {item.label}
                    {item.count > 0 && <span className="text-[10px] opacity-70">{item.count}</span>}
                  </button>
                );
              })}
            </div>

            {activeTabCount > 0 && (
              <div className="border-b border-hair px-4 py-2">
                {confirmClearTab ? (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-ink-faint">Clear all {tab} for this book?</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleClearTab()}
                        className="text-xs text-red-300 hover:text-red-200"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClearTab(false)}
                        className="text-xs text-ink-faint hover:text-ink-soft"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClearTab(true)}
                    className="text-xs text-ink-faint transition hover:text-red-300"
                  >
                    Clear all {tab}
                  </button>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4">
              {detailLoading ? (
                <p className="px-2 py-8 text-center text-xs text-ink-faint">Loading…</p>
              ) : tab === "audio" ? (
                audio.length === 0 ? (
                  <EmptyTab message="No audio saved for this book." />
                ) : (
                  <div className="space-y-2">
                    {audio.map((artifact) => {
                      const isActive =
                        playingBookId === selected.bookId &&
                        activeAudioId === artifact.id &&
                        isPlaying;
                      return (
                        <div
                          key={artifact.id}
                          className="flex items-center gap-3 rounded-lg border border-hair bg-ink/[0.04] p-3"
                        >
                          <button
                            type="button"
                            disabled={artifact.status !== "ready"}
                            onClick={() => togglePlay(artifact)}
                            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-hair bg-ink/[0.06] text-ink-soft transition hover:text-lumina-gold disabled:opacity-40"
                            aria-label={isActive ? "Pause" : "Play"}
                          >
                            {isActive ? <Pause size={14} /> : <Play size={14} />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-ink-soft">
                              {audioLabel(artifact)}
                            </p>
                            <p className="mt-0.5 text-[11px] text-ink-faint">
                              {formatDate(artifact.generatedAt)}
                              {artifact.durationSeconds
                                ? ` · ${Math.round(artifact.durationSeconds / 60)} min`
                                : ""}
                            </p>
                          </div>
                          <ItemDeleteButton
                            onDelete={async () => {
                              await storage.deleteArchivedAudio(artifact.id);
                              await refreshAfterChange();
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )
              ) : tab === "images" ? (
                images.length === 0 ? (
                  <EmptyTab message="No images saved for this book." />
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {images.map((image) => (
                      <div key={image.id} className="relative overflow-hidden rounded-lg border border-hair bg-black/20">
                        <button
                          type="button"
                          onClick={() => setFocusedImage(image)}
                          className="block w-full"
                        >
                          <img
                            src={displaySrc(image.filePath)}
                            alt={image.descriptionUsed || "Generated illustration"}
                            className="aspect-[4/3] w-full object-cover"
                          />
                        </button>
                        <div className="absolute right-1 top-1">
                          <ItemDeleteButton
                            onDelete={async () => {
                              await storage.deleteArchivedImage(image.id, image.sceneId);
                              if (focusedImage?.id === image.id) setFocusedImage(null);
                              await refreshAfterChange();
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : tab === "notes" ? (
                notes.length === 0 ? (
                  <EmptyTab message="No notes saved for this book." />
                ) : (
                  <div className="space-y-2">
                    {notes.map((note) => (
                      <div
                        key={note.id}
                        className="flex gap-2 rounded-lg border border-hair bg-ink/[0.04] p-3"
                      >
                        <div className="min-w-0 flex-1">
                          {note.sourceExcerpt && (
                            <p className="mb-2 border-l-2 border-lumina-gold/40 pl-2 text-xs italic text-ink-faint">
                              {note.sourceExcerpt}
                            </p>
                          )}
                          <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-soft">
                            {note.noteText}
                          </p>
                        </div>
                        <ItemDeleteButton
                          onDelete={async () => {
                            await storage.deleteArchivedNote(note.id);
                            await refreshAfterChange();
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )
              ) : tab === "badges" ? (
                badges.length === 0 ? (
                  <EmptyTab message="No quiz badges saved for this book." />
                ) : (
                  <div className="space-y-2">
                    {badges.map((badge) => (
                      <div
                        key={badge.id}
                        className="flex items-start gap-2 rounded-lg border border-lumina-gold/24 bg-lumina-gold/[0.045] p-3"
                      >
                        <Trophy size={16} className="mt-0.5 shrink-0 text-lumina-gold/75" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-ink-soft">{badge.label}</p>
                          <p className="mt-1 text-[11px] text-ink-faint">
                            {badge.scope} quiz · {badge.score}% · {formatDate(badge.awardedAt)}
                          </p>
                        </div>
                        <ItemDeleteButton
                          onDelete={async () => {
                            await storage.deleteArchivedBadge(badge.id);
                            await refreshAfterChange();
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )
              ) : presentations.length === 0 ? (
                <EmptyTab message="No presentations saved for this book." />
              ) : (
                <div className="space-y-3">
                  {presentations.map((deck) => (
                    <div
                      key={deck.id}
                      className="flex gap-2 rounded-lg border border-hair bg-ink/[0.04] p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-ink-soft">{deck.title}</p>
                        <p className="mt-0.5 text-[11px] text-ink-faint">
                          {deck.scopeLabel} · {deck.slideCount} slides ·{" "}
                          {formatDate(deck.generatedAt)}
                        </p>
                        <div className="mt-2 space-y-1.5">
                          {deck.slides.slice(0, 4).map((slide) => (
                            <div key={slide.index} className="rounded border border-hair/60 px-2 py-1.5">
                              <p className="text-[11px] font-medium text-ink-faint">{slide.title}</p>
                              {slide.bullets[0] && (
                                <p className="mt-0.5 line-clamp-2 text-[10px] text-ink-faint">
                                  {slide.bullets[0]}
                                </p>
                              )}
                            </div>
                          ))}
                          {deck.slides.length > 4 && (
                            <p className="text-[10px] text-ink-faint">
                              +{deck.slides.length - 4} more slides
                            </p>
                          )}
                        </div>
                      </div>
                      <ItemDeleteButton
                        onDelete={async () => {
                          await storage.deleteArchivedPresentation(deck.id);
                          await refreshAfterChange();
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-hair px-4 py-3">
              {confirmPurgeBook ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-ink-faint">Delete everything archived for this book?</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handlePurgeBook()}
                      className="text-xs text-red-300 hover:text-red-200"
                    >
                      Delete all
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmPurgeBook(false)}
                      className="text-xs text-ink-faint hover:text-ink-soft"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmPurgeBook(true)}
                  className="flex items-center gap-2 text-xs text-ink-faint transition hover:text-red-300"
                >
                  <Trash2 size={12} />
                  Delete all artifacts for this book
                </button>
              )}
            </div>
          </>
        )}

        {focusedImage && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-6"
            onClick={() => setFocusedImage(null)}
          >
            <img
              src={displaySrc(focusedImage.filePath)}
              alt={focusedImage.descriptionUsed}
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function ItemDeleteButton({ onDelete }: { onDelete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void onDelete().finally(() => setBusy(false));
      }}
      className="rounded p-1.5 text-ink-faint transition hover:bg-red-400/10 hover:text-red-300 disabled:opacity-40"
      aria-label="Delete item"
      title="Delete"
    >
      <Trash2 size={12} />
    </button>
  );
}

function EmptyTab({ message }: { message: string }) {
  return <p className="px-2 py-8 text-center text-xs text-ink-faint">{message}</p>;
}
