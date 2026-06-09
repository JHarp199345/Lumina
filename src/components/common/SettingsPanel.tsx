import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Key, Image, Type, Trash2, RefreshCw, Palette, FolderOpen } from "lucide-react";
import { useSettingsStore } from "@/store/settingsStore";
import { useBookStore } from "@/store/bookStore";
import { useImageStore } from "@/store/imageStore";
import { useReaderStore } from "@/store/readerStore";
import { STYLE_SEEDS, getStyleSeedById } from "@/data/styleSeeds";
import { useBookOrchestration } from "@/hooks/useBookOrchestration";
import { getAnalysisSlice } from "@/pipeline/collectionSlicing";
import { useEpubImport } from "@/hooks/useEpubImport";
import { storage } from "@/storage";
import ApiKeySetup from "./ApiKeySetup";

interface SettingsPanelProps {
  onClose: () => void;
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-scrim backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-84 bg-surface-dark border-l border-hair z-50 flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-hair">
          <span className="text-sm font-semibold text-ink-soft">Settings</span>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-ink-faint hover:text-ink-soft hover:bg-ink/5 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin py-4 space-y-0">
          <ReadingSection />
          <Divider />
          <VisualSection />
          <Divider />
          <ApiSection />
          <Divider />
          <LibrarySection onClose={onClose} />
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function Divider() {
  return <div className="w-full h-px bg-ink/5 my-2" />;
}

function SectionHeader({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 px-5 mb-3">
      <Icon size={12} className="text-ink-faint" />
      <span className="text-xs font-semibold tracking-widest text-ink-faint uppercase">{label}</span>
    </div>
  );
}

// ─── Reading ─────────────────────────────────────────────────────────────────

function ReadingSection() {
  const { fontSize, setFontSize, lineHeight, setLineHeight, readingWidth, setReadingWidth } =
    useSettingsStore();

  return (
    <div className="pb-4">
      <SectionHeader icon={Type} label="Reading" />
      <div className="px-5 space-y-4">
        <div>
          <label className="text-xs text-ink-faint mb-2 block">Font Size — {fontSize}px</label>
          <input
            type="range" min={12} max={28} value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="w-full accent-lumina-gold"
          />
        </div>
        <div>
          <label className="text-xs text-ink-faint mb-2 block">Line Height — {lineHeight.toFixed(1)}</label>
          <input
            type="range" min={1.2} max={2.2} step={0.1} value={lineHeight}
            onChange={(e) => setLineHeight(Number(e.target.value))}
            className="w-full accent-lumina-gold"
          />
        </div>
        <div>
          <label className="text-xs text-ink-faint mb-2 block">Reading Width</label>
          <div className="flex gap-2">
            {(["narrow", "medium", "wide"] as const).map((w) => (
              <button
                key={w}
                onClick={() => setReadingWidth(w)}
                className={`flex-1 py-1.5 rounded text-xs capitalize transition-colors ${
                  readingWidth === w
                    ? "bg-lumina-gold/20 text-lumina-gold border border-lumina-gold/30"
                    : "bg-ink/5 text-ink-faint border border-transparent hover:border-hair"
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Visuals ─────────────────────────────────────────────────────────────────

function VisualSection() {
  const {
    imageGenerationEnabled,
    setImageGenerationEnabled,
    visualInterpretationLevel,
    setVisualInterpretationLevel,
  } = useSettingsStore();
  const { activeBook, activeStyleSeed, activeStructure, setAnalysisProgressDetail } = useBookStore();
  const { currentChapterIndex } = useReaderStore();
  const { clearQueue } = useImageStore();
  const { reIngest } = useBookOrchestration();
  const [isReingesting, setIsReingesting] = useState(false);

  const currentSeed = activeStyleSeed ? getStyleSeedById(activeStyleSeed) : null;
  const analysisSlice = activeStructure
    ? getAnalysisSlice(activeStructure, currentChapterIndex)
    : null;
  const isCollection = Boolean(analysisSlice?.group);

  // Re-Ingest replaces Re-analyze + Regenerate-all + Regenerate-single: it archives the
  // current generation and re-lays fresh groundwork, with images filling in as you read.
  const handleReIngest = async () => {
    if (!activeBook || !activeStructure) return;
    setIsReingesting(true);
    try {
      await reIngest(activeStructure);
    } catch (err) {
      console.error("[Settings] Re-ingest failed:", err);
      setAnalysisProgressDetail({
        phase: "error",
        message: err instanceof Error ? err.message : "Re-ingestion failed before it could finish.",
        percent: 0,
      });
    } finally {
      setIsReingesting(false);
    }
  };

  return (
    <div className="pb-4">
      <SectionHeader icon={Image} label="Visuals" />
      <div className="px-5 space-y-4">
        {/* Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-ink-soft">Image Generation</p>
            <p className="text-xs text-ink-faint mt-0.5">Generate symbolic imagery as you read</p>
          </div>
          <button
            onClick={() => setImageGenerationEnabled(!imageGenerationEnabled)}
            className={`relative w-10 h-5.5 rounded-full transition-colors flex-shrink-0 ${
              imageGenerationEnabled ? "bg-lumina-gold" : "bg-white/15"
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 bg-white rounded-full shadow transition-transform ${
              imageGenerationEnabled ? "translate-x-4.5" : "translate-x-0"
            }`} />
          </button>
        </div>

        {/* Current style seed */}
        {activeBook && currentSeed && (
          <div className="rounded-lg bg-ink/[0.04] border border-hair p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Palette size={11} className="text-ink-faint" />
              <p className="text-xs text-ink-faint">Current style</p>
            </div>
            <p className="text-xs text-lumina-gold">{currentSeed.name}</p>
            <p className="text-xs text-ink-faint leading-relaxed">{currentSeed.description}</p>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-ink-faint">Visual Style</label>
            <span className="text-xs text-lumina-gold/80">
              {visualStyleLabel(visualInterpretationLevel)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={visualInterpretationLevel}
            onChange={(e) => setVisualInterpretationLevel(Number(e.target.value))}
            className="w-full accent-lumina-gold"
          />
          <div className="mt-1 flex justify-between text-[10px] uppercase tracking-[0.12em] text-ink/18">
            <span>Interpretive</span>
            <span>Depictive</span>
          </div>
          <p className="text-xs text-ink/22 mt-2 leading-relaxed">
            {visualStyleDescription(visualInterpretationLevel)}
          </p>
        </div>

        {/* Re-Ingest — one explicit action. Archives the current generation and re-lays
            fresh groundwork; new images fill in as you read. */}
        {activeBook && imageGenerationEnabled && (
          <div className="space-y-1.5">
            <ReIngestSlider onConfirm={handleReIngest} busy={isReingesting} />
            <p className="px-1 text-xs leading-relaxed text-ink-faint">
              Archives this {isCollection ? `book (${analysisSlice?.label})` : "book"}’s current
              images, audio, and analysis, then re-analyzes fresh. Your highlights, notes, and
              reading position are kept. Archived items live in the Archive.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ReIngestSlider({ onConfirm, busy }: { onConfirm: () => void; busy: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [pct, setPct] = useState(0);
  const CONFIRM_AT = 90;

  const setFromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setPct(p);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (busy) return;
    draggingRef.current = true;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setFromPointer(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    setFromPointer(e.clientX);
  };
  const onPointerUp = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (pct >= CONFIRM_AT) onConfirm();
    setPct(0);
  };

  const fill = busy ? 100 : pct;
  const label = busy
    ? "Re-ingesting…"
    : pct >= CONFIRM_AT
      ? "Release to confirm"
      : pct > 4
        ? "Keep sliding…"
        : "Slide to Re-Ingest";

  return (
    <div
      ref={trackRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="relative h-11 w-full select-none overflow-hidden rounded-lg border border-lumina-gold/30 bg-ink/[0.05] touch-none"
      role="button"
      aria-label="Slide to re-ingest this book"
    >
      {/* fill */}
      <div
        className="absolute inset-y-0 left-0 bg-lumina-gold/18 transition-[width] duration-75"
        style={{ width: `${fill}%` }}
      />
      {/* label */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="flex items-center gap-1.5 text-xs font-medium text-lumina-gold/90">
          {busy && <RefreshCw size={12} className="animate-spin" />}
          {label}
          {!busy && pct <= 4 && <span className="text-lumina-gold/55">→</span>}
        </span>
      </div>
      {/* knob */}
      {!busy && (
        <div
          className="pointer-events-none absolute top-1 bottom-1 flex w-9 items-center justify-center rounded-md border border-lumina-gold/40 bg-lumina-gold/25"
          style={{ left: `calc(${fill}% - ${fill > 0 ? 38 : 2}px)` }}
        >
          <RefreshCw size={13} className="text-lumina-gold/90" />
        </div>
      )}
    </div>
  );
}

function visualStyleLabel(level: number): string {
  if (level < 25) return "Interpretive";
  if (level < 50) return "Atmospheric";
  if (level < 70) return "Balanced";
  if (level < 90) return "Depictive";
  return "Scene Detail";
}

function visualStyleDescription(level: number): string {
  if (level < 25) return "Mood, symbol, and atmosphere lead. Figures and action are minimized.";
  if (level < 50) return "Objects, places, and atmosphere carry the scene with light depiction.";
  if (level < 70) return "The scene is recognizable, with figures and action handled through gesture.";
  if (level < 90) return "Concrete scenes, action, setting, and important objects are clearly shown.";
  return "Closest scene depiction the selected art style allows, with cinematic restraint.";
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

function ApiSection() {
  return (
    <div className="pb-4">
      <SectionHeader icon={Key} label="API Keys" />
      <div className="px-5">
        <ApiKeySetup onComplete={() => {}} />
      </div>
    </div>
  );
}

// ─── Library ─────────────────────────────────────────────────────────────────

function LibrarySection({ onClose }: { onClose: () => void }) {
  const { library, removeBook, activeBook } = useBookStore();
  const { openBook, unmountActiveBook } = useEpubImport();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleOpen = async (book: (typeof library)[0]) => {
    await openBook(book);
    onClose();
  };

  const handleCloseBook = () => {
    unmountActiveBook();
    onClose();
  };

  const handleDelete = async (bookId: string) => {
    const book = library.find((entry) => entry.id === bookId);
    if (!book) return;
    await storage.archiveAndRemoveBook(book);
    removeBook(bookId);
    if (activeBook?.id === bookId) unmountActiveBook();
    setConfirmDelete(null);
  };

  if (library.length === 0) return null;

  return (
    <div className="pb-4">
      <SectionHeader icon={BookOpen as React.ElementType} label="Library" />
      <div className="px-5 space-y-2">
        {activeBook && (
          <button
            onClick={handleCloseBook}
            className="mb-2 w-full rounded-lg border border-hair bg-ink/[0.04] px-3 py-2 text-left text-xs text-ink-faint transition-colors hover:border-hair hover:text-ink/65"
          >
            Close current book
          </button>
        )}
        {library.map((book) => (
          <div
            key={book.id}
            className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
              activeBook?.id === book.id
                ? "bg-lumina-gold/8 border-lumina-gold/20"
                : "bg-ink/[0.04] border-hair hover:border-hair"
            }`}
          >
            {/* Clickable open area */}
            <button
              className="flex-1 min-w-0 text-left"
              onClick={() => handleOpen(book)}
            >
              <p className={`text-xs truncate font-medium ${
                activeBook?.id === book.id ? "text-lumina-gold" : "text-ink-soft"
              }`}>
                {book.title}
              </p>
              <p className="text-xs text-ink-faint truncate">{book.author}</p>
            </button>

            {/* Open icon */}
            {activeBook?.id !== book.id && (
              <button
                onClick={() => handleOpen(book)}
                className="p-1.5 text-ink-faint hover:text-ink-soft transition-colors flex-shrink-0"
                title="Open book"
              >
                <FolderOpen size={12} />
              </button>
            )}

            {/* Delete */}
            {confirmDelete === book.id ? (
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => handleDelete(book.id)} className="text-xs text-red-400 hover:text-red-300 transition-colors">Delete</button>
                <button onClick={() => setConfirmDelete(null)} className="text-xs text-ink-faint hover:text-ink-soft transition-colors">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(book.id)}
                className="p-1.5 text-ink-faint hover:text-red-400 transition-colors flex-shrink-0"
                title="Remove book"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Import missing icon
import { BookOpen } from "lucide-react";
