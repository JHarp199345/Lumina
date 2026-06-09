import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useAnnotationStore } from "@/store/annotationStore";
import { useBookStore } from "@/store/bookStore";
import { useReaderStore } from "@/store/readerStore";
import { useImageStore } from "@/store/imageStore";
import { useSettingsStore } from "@/store/settingsStore";
import { getStyleSeedById } from "@/data/styleSeeds";
import { createVisualDirectorBrief } from "@/pipeline/visualDirector";
import { buildVisualStoryboard } from "@/pipeline/visualStoryboard";
import { generateImage } from "@/pipeline/imageGenerator";
import { storage } from "@/storage";
import { lensClassName, lensSwatchStyle, useLensStore } from "@/store/lensStore";
import { computeSceneWordPosition } from "@/utils/scenePosition";
import type { HighlightColor, IdentifiedScene } from "@/types";

interface SelectionMenu {
  x: number;
  y: number;
  selectedText: string;
  range: Range;
}

export default function HighlightLayer() {
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenu | null>(null);
  const [noteModal, setNoteModal] = useState<{ highlightId: string } | null>(null);
  const [noteText, setNoteText] = useState("");
  const { addHighlight, addNote } = useAnnotationStore();
  const { activeBook, activeStructure, activeSemanticMap, activeStyleSeed, setActiveSemanticMap } = useBookStore();
  const { currentChapterIndex, wordPosition } = useReaderStore();
  const { addToCache, setCurrentImage, setCurrentThemes, setIsGenerating } = useImageStore();
  const { visualInterpretationLevel } = useSettingsStore();
  const lenses = useLensStore((s) => s.lenses);
  const visibleLensIds = useLensStore((s) => s.visibleLensIds);

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      if (!activeBook) return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        setSelectionMenu(null);
        return;
      }

      const selectedText = selection.toString().trim();
      if (selectedText.length < 3) {
        setSelectionMenu(null);
        return;
      }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      setSelectionMenu({
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
        selectedText,
        range: range.cloneRange(),
      });
    },
    [activeBook]
  );

  const handleHighlight = useCallback(
    (color: HighlightColor) => {
      if (!selectionMenu || !activeBook) return;

      const highlightId = `h_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const epubCfi = getCfiFromSelection(selectionMenu.range);

      if (!epubCfi) {
        // CFI extraction failed — apply visual-only highlight (not persisted)
        applyHighlightToRange(selectionMenu.range, color, highlightId);
        setSelectionMenu(null);
        window.getSelection()?.removeAllRanges();
        console.info("[Highlight] Could not extract EPUB CFI — highlight is session-only.");
        return;
      }

      // CFI obtained — persist and apply
      addHighlight({
        id: highlightId,
        bookId: activeBook.id,
        cfiRange: epubCfi,
        color,
        selectedText: selectionMenu.selectedText,
        createdAt: new Date().toISOString(),
      });

      applyHighlightToRange(selectionMenu.range, color, highlightId);
      setSelectionMenu(null);
      window.getSelection()?.removeAllRanges();
      setNoteModal({ highlightId });
    },
    [selectionMenu, activeBook, addHighlight]
  );

  const handleAddNote = useCallback(() => {
    if (!noteModal) return;
    if (noteText.trim()) {
      addNote({
        id: `n_${Date.now()}`,
        highlightId: noteModal.highlightId,
        bookId: activeBook?.id || "",
        noteText: noteText.trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    setNoteModal(null);
    setNoteText("");
  }, [noteModal, noteText, addNote, activeBook]);

  const handleGenerateImage = useCallback(async () => {
    if (!selectionMenu || !activeBook || !activeStructure || !activeSemanticMap || !activeStyleSeed) return;
    const chapter = activeStructure.chapters[Math.max(0, currentChapterIndex)];
    if (!chapter) return;

    const styleSeed = getStyleSeedById(activeStyleSeed);
    const googleKey = await storage.loadApiKey("lumina_google_ai_key");
    const falKey = await storage.loadApiKey("lumina_fal_key");
    if (!styleSeed || !googleKey) return;

    const wordsBeforeChapter = activeStructure.chapters
      .slice(0, chapter.index)
      .reduce((sum, item) => sum + item.wordCount, 0);
    const wordOffset = Math.max(0, Math.min(chapter.wordCount, wordPosition - wordsBeforeChapter));
    const keywords = extractSelectionKeywords(selectionMenu.selectedText);
    const sceneId = `scene_custom_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const customScene: IdentifiedScene = {
      id: sceneId,
      inflectionPointId: "reader_selected",
      chapterId: chapter.id,
      sectionId: chapter.sections[0]?.id ?? chapter.id,
      anchorCfi: "",
      anchor: {
        href: chapter.href,
        spineIndex: chapter.spineIndex,
        wordOffset,
      },
      emotionalVector: ["reader-selected", "focused attention"],
      symbolicMotifs: keywords.length ? keywords : ["selected passage", "reader focus"],
      atmosphericQualities: ["scene-specific", "depictive"],
      narrativeWeight: 0.7,
      imageDescription: `Reader-selected passage for depiction: ${selectionMenu.selectedText.slice(0, 700)}`,
    };

    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
    setIsGenerating(true);

    try {
      const brief = await createVisualDirectorBrief({
        scene: customScene,
        semanticMap: activeSemanticMap,
        structure: activeStructure,
        styleSeed,
        interpretationLevel: visualInterpretationLevel,
        recentBriefs: activeSemanticMap.scenes
          .map((scene) => scene.directorBrief)
          .filter((brief): brief is NonNullable<typeof brief> => Boolean(brief)),
        apiKey: googleKey,
      });
      const directedScene = { ...customScene, directorBrief: brief, imageDescription: brief.finalPrompt };
      const mergedScenes = [...activeSemanticMap.scenes.filter((scene) => scene.id !== directedScene.id), directedScene]
        .sort((a, b) => a.anchor.spineIndex - b.anchor.spineIndex || a.anchor.wordOffset - b.anchor.wordOffset);
      const storyboard = buildVisualStoryboard({
        bookId: activeSemanticMap.bookId,
        arcShape: activeSemanticMap.arcShape,
        structure: activeStructure,
        scenes: mergedScenes,
        inflectionPoints: activeSemanticMap.inflectionPoints,
        goldenNumber: Math.max(activeSemanticMap.goldenNumber, mergedScenes.length),
      });
      const nextMap = {
        ...activeSemanticMap,
        scenes: mergedScenes,
        storyboard,
        goldenNumber: Math.max(activeSemanticMap.goldenNumber, mergedScenes.length),
      };
      setActiveSemanticMap(nextMap);
      await storage.saveSemanticMap(nextMap);

      const image = await generateImage({
        scene: directedScene,
        styleSeed,
        bookId: activeSemanticMap.bookId,
        wordPosition: computeSceneWordPosition(directedScene, activeStructure.chapters),
        googleApiKey: googleKey,
        falApiKey: falKey ?? undefined,
      });
      addToCache(image);
      setCurrentImage(image);
      setCurrentThemes(image.emotionalThemes);
    } catch (err) {
      console.error("[HighlightImage] Failed:", err);
    } finally {
      setIsGenerating(false);
    }
  }, [
    selectionMenu,
    activeBook,
    activeStructure,
    activeSemanticMap,
    activeStyleSeed,
    currentChapterIndex,
    wordPosition,
    visualInterpretationLevel,
    setActiveSemanticMap,
    addToCache,
    setCurrentImage,
    setCurrentThemes,
    setIsGenerating,
  ]);

  // Close menu on outside click
  const handleDocClick = useCallback(
    (e: MouseEvent) => {
      if (selectionMenu) {
        const target = e.target as HTMLElement;
        if (!target.closest("[data-highlight-menu]")) {
          setSelectionMenu(null);
        }
      }
    },
    [selectionMenu]
  );

  useEffect(() => {
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("click", handleDocClick);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("click", handleDocClick);
    };
  }, [handleMouseUp, handleDocClick]);

  return (
    <>
      {/* Color picker menu */}
      <AnimatePresence>
        {selectionMenu && (
          <motion.div
            data-highlight-menu
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className="fixed z-50 flex items-center gap-1.5 px-2 py-1.5 bg-surface-dark/95 border border-hair rounded-lg shadow-xl backdrop-blur-sm"
            style={{
              left: selectionMenu.x,
              top: selectionMenu.y,
              transform: "translate(-50%, -100%)",
            }}
          >
            {visibleLensIds.map((color) => (
              <button
                key={color}
                onClick={() => handleHighlight(color)}
                title={lenses[color]?.name ?? "Lens"}
                style={lenses[color] ? lensSwatchStyle(lenses[color]) : undefined}
                className="h-6 w-6 border border-white/20 transition-transform hover:scale-110"
              />
            ))}
            {activeSemanticMap && activeStyleSeed && (
              <button
                onClick={handleGenerateImage}
                title="Generate image from selection"
                className="ml-1 flex h-6 items-center gap-1 rounded-md border border-lumina-gold/25 bg-lumina-gold/10 px-2 text-[10px] uppercase tracking-[0.12em] text-lumina-gold/80 transition-colors hover:bg-lumina-gold/18 hover:text-lumina-gold"
              >
                <Sparkles size={11} />
                Image
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Note modal */}
      <AnimatePresence>
        {noteModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              onClick={() => {
                setNoteModal(null);
                setNoteText("");
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 bg-surface-dark border border-hair rounded-xl shadow-2xl p-4 space-y-3"
            >
              <p className="text-xs text-ink-faint font-medium">Add a note</p>
              <textarea
                autoFocus
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.metaKey) handleAddNote();
                  if (e.key === "Escape") {
                    setNoteModal(null);
                    setNoteText("");
                  }
                }}
                placeholder="Your thoughts..."
                rows={3}
                className="w-full bg-black/30 border border-hair rounded-lg px-3 py-2 text-sm text-ink-soft placeholder:text-ink-faint focus:outline-none focus:border-lumina-gold/40 resize-none transition-colors"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setNoteModal(null);
                    setNoteText("");
                  }}
                  className="px-3 py-1.5 rounded text-xs text-ink-faint hover:text-ink-soft transition-colors"
                >
                  Skip
                </button>
                <button
                  onClick={handleAddNote}
                  className="px-3 py-1.5 rounded text-xs bg-lumina-gold/20 text-lumina-gold hover:bg-lumina-gold/30 transition-colors"
                >
                  Save note
                </button>
              </div>
              <p className="text-xs text-ink-faint">⌘↵ to save</p>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── CFI Extraction ───────────────────────────────────────────────────────────

/**
 * Extract a real EPUB CFI for a selection range.
 * Returns null if CFI extraction fails — callers should not persist null CFIs.
 */
function getCfiFromSelection(range: Range): string | null {
  const epubBook = (
    window as Window & { luminaEpubBook?: { getCfiFromRange?: (r: Range) => string } }
  ).luminaEpubBook;

  if (epubBook?.getCfiFromRange) {
    try {
      const cfi = epubBook.getCfiFromRange(range);
      if (cfi && cfi.startsWith("epubcfi(")) return cfi;
    } catch { /* fall through */ }
  }
  return null;
}

function extractSelectionKeywords(text: string): string[] {
  const stop = new Set([
    "the",
    "and",
    "that",
    "with",
    "from",
    "this",
    "were",
    "they",
    "there",
    "would",
    "could",
    "should",
    "into",
    "upon",
    "about",
    "through",
  ]);
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9'\s-]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 4 && !stop.has(word))
        .slice(0, 8)
    )
  );
}

// ─── DOM Highlight Application ────────────────────────────────────────────────

function applyHighlightToRange(range: Range, color: HighlightColor, id: string) {
  try {
    const mark = document.createElement("mark");
    mark.className = lensClassName(color);
    mark.dataset.highlightId = id;
    mark.style.cursor = "pointer";
    range.surroundContents(mark);
  } catch {
    // Range crosses element boundaries — use extractContents approach
    try {
      const fragment = range.extractContents();
      const mark = document.createElement("mark");
      mark.className = lensClassName(color);
      mark.dataset.highlightId = id;
      mark.style.cursor = "pointer";
      mark.appendChild(fragment);
      range.insertNode(mark);
    } catch {
      // Silently fail — don't crash reader on complex selections
      console.warn("[Highlight] Could not apply highlight to complex selection");
    }
  }
}
