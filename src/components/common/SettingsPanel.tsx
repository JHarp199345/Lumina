import { useState } from "react";
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
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-84 bg-surface-dark border-l border-white/10 z-50 flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <span className="text-sm font-semibold text-white/70">Settings</span>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
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
  return <div className="w-full h-px bg-white/5 my-2" />;
}

function SectionHeader({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 px-5 mb-3">
      <Icon size={12} className="text-white/30" />
      <span className="text-xs font-semibold tracking-widest text-white/25 uppercase">{label}</span>
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
          <label className="text-xs text-white/40 mb-2 block">Font Size — {fontSize}px</label>
          <input
            type="range" min={12} max={28} value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="w-full accent-lumina-gold"
          />
        </div>
        <div>
          <label className="text-xs text-white/40 mb-2 block">Line Height — {lineHeight.toFixed(1)}</label>
          <input
            type="range" min={1.2} max={2.2} step={0.1} value={lineHeight}
            onChange={(e) => setLineHeight(Number(e.target.value))}
            className="w-full accent-lumina-gold"
          />
        </div>
        <div>
          <label className="text-xs text-white/40 mb-2 block">Reading Width</label>
          <div className="flex gap-2">
            {(["narrow", "medium", "wide"] as const).map((w) => (
              <button
                key={w}
                onClick={() => setReadingWidth(w)}
                className={`flex-1 py-1.5 rounded text-xs capitalize transition-colors ${
                  readingWidth === w
                    ? "bg-lumina-gold/20 text-lumina-gold border border-lumina-gold/30"
                    : "bg-white/5 text-white/40 border border-transparent hover:border-white/10"
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
  const { reAnalyzeBook, regenerateAllImages } = useBookOrchestration();
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [isRegeneratingAll, setIsRegeneratingAll] = useState(false);

  const currentSeed = activeStyleSeed ? getStyleSeedById(activeStyleSeed) : null;
  const analysisSlice = activeStructure
    ? getAnalysisSlice(activeStructure, currentChapterIndex)
    : null;
  const isCollection = Boolean(analysisSlice?.group);

  const handleReanalyze = async () => {
    if (!activeBook || !activeStructure) return;
    setIsReanalyzing(true);
    try {
      await reAnalyzeBook(activeStructure);
    } catch (err) {
      console.error("[Settings] Re-analysis failed:", err);
      setAnalysisProgressDetail({
        phase: "error",
        message: err instanceof Error ? err.message : "Re-analysis failed before it could finish.",
        percent: 0,
      });
    } finally {
      setIsReanalyzing(false);
    }
  };

  const handleRegenerateAll = async () => {
    if (!activeBook) return;
    setIsRegeneratingAll(true);
    try {
      // Keeps the semantic map — only re-generates image files
      await regenerateAllImages();
    } catch (err) {
      console.error("[Settings] Image regeneration queue failed:", err);
      setAnalysisProgressDetail({
        phase: "error",
        message: err instanceof Error ? err.message : "Image regeneration could not start.",
        percent: 0,
      });
    } finally {
      setIsRegeneratingAll(false);
    }
  };

  return (
    <div className="pb-4">
      <SectionHeader icon={Image} label="Visuals" />
      <div className="px-5 space-y-4">
        {/* Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-white/60">Image Generation</p>
            <p className="text-xs text-white/25 mt-0.5">Generate symbolic imagery as you read</p>
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
          <div className="rounded-lg bg-white/3 border border-white/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Palette size={11} className="text-white/30" />
              <p className="text-xs text-white/40">Current style</p>
            </div>
            <p className="text-xs text-lumina-gold">{currentSeed.name}</p>
            <p className="text-xs text-white/25 leading-relaxed">{currentSeed.description}</p>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-white/40">Visual Style</label>
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
          <div className="mt-1 flex justify-between text-[10px] uppercase tracking-[0.12em] text-white/18">
            <span>Interpretive</span>
            <span>Depictive</span>
          </div>
          <p className="text-xs text-white/22 mt-2 leading-relaxed">
            {visualStyleDescription(visualInterpretationLevel)}
          </p>
        </div>

        {/* Book-specific actions */}
        {activeBook && imageGenerationEnabled && (
          <div className="space-y-2">
            <div>
              <button
                onClick={handleRegenerateAll}
                disabled={isRegeneratingAll}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/3 border border-white/5 text-xs text-white/40 hover:text-white/60 hover:border-white/10 transition-colors disabled:opacity-40"
              >
                <RefreshCw size={11} className={isRegeneratingAll ? "animate-spin" : ""} />
                {isRegeneratingAll
                  ? "Queuing…"
                  : isCollection
                    ? "Queue New Images for Current Book"
                    : "Queue New Images for All Scenes"}
              </button>
              <p className="text-xs text-white/15 mt-1 px-1">
                Clears cached images for {isCollection ? analysisSlice?.label : "this book"} and re-generates as you read.
              </p>
            </div>
            <button
              onClick={handleReanalyze}
              disabled={isReanalyzing}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/3 border border-white/5 text-xs text-white/40 hover:text-white/60 hover:border-white/10 transition-colors disabled:opacity-40"
            >
              <RefreshCw size={11} className={isReanalyzing ? "animate-spin" : ""} />
              {isReanalyzing
                ? "Analyzing…"
                : isCollection
                  ? "Analyze Current Book"
                  : "Re-analyze Book"}
            </button>
          </div>
        )}
      </div>
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
    await storage.deleteAllBookData(bookId);
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
            className="mb-2 w-full rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-left text-xs text-white/40 transition-colors hover:border-white/14 hover:text-white/65"
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
                : "bg-white/3 border-white/5 hover:border-white/10"
            }`}
          >
            {/* Clickable open area */}
            <button
              className="flex-1 min-w-0 text-left"
              onClick={() => handleOpen(book)}
            >
              <p className={`text-xs truncate font-medium ${
                activeBook?.id === book.id ? "text-lumina-gold" : "text-white/60"
              }`}>
                {book.title}
              </p>
              <p className="text-xs text-white/25 truncate">{book.author}</p>
            </button>

            {/* Open icon */}
            {activeBook?.id !== book.id && (
              <button
                onClick={() => handleOpen(book)}
                className="p-1.5 text-white/20 hover:text-white/50 transition-colors flex-shrink-0"
                title="Open book"
              >
                <FolderOpen size={12} />
              </button>
            )}

            {/* Delete */}
            {confirmDelete === book.id ? (
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => handleDelete(book.id)} className="text-xs text-red-400 hover:text-red-300 transition-colors">Delete</button>
                <button onClick={() => setConfirmDelete(null)} className="text-xs text-white/25 hover:text-white/50 transition-colors">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(book.id)}
                className="p-1.5 text-white/15 hover:text-red-400 transition-colors flex-shrink-0"
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
