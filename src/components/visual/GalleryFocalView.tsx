/**
 * GalleryFocalView
 *
 * A reverent, gallery-style presentation of the book's images. Clicking the
 * visual panel's image opens this: one piece centered and large in a dim room
 * with a matte frame (passe-partout) and soft shadow — no lamp — with a
 * filmstrip along the bottom to pan through every planned moment.
 *
 * Filmstrip behaviour per item:
 *   - has image → view it on the wall without moving the reader
 *   - planned   → generate that planned image without moving the reader
 */

import { useEffect, useMemo, useRef, useState } from "react";
import ModalPortal from "@/components/common/ModalPortal";
import { animate, AnimatePresence, motion, useMotionValue } from "framer-motion";
import { X, MapPin, ChevronLeft, ChevronRight, ChevronDown, Sparkles, Loader, ListFilter, RefreshCw, Check, AlertTriangle, BookOpen, Image, List, Wand2 } from "lucide-react";
import { isTauri } from "@/utils/runtime";
import { toAssetUrl } from "@/utils/tauriBridge";
import { useAnalysisOutcome } from "@/hooks/useAnalysisOutcome";
import { useBookStore } from "@/store/bookStore";
import { useImageStore } from "@/store/imageStore";
import { useUiStore } from "@/store/uiStore";
import { visualSlotKeyForScene } from "@/utils/sceneDedup";
import { getImageForScene } from "@/utils/imagePosition";
import { segmentScenesForSemanticMap } from "@/utils/sceneDedup";
import { EMPTY_BEATS, EMPTY_CHAPTERS, EMPTY_SCENES } from "@/utils/stableEmpty";
import { buildPublicVisualBrief } from "@/utils/publicVisualBrief";
import { storage } from "@/storage";
import { analyzeReferenceImage } from "@/services/referenceImageAnalysis";
import type { AnalysisProgressPhase, CachedImage, IdentifiedScene, SemanticMap, VisualBeat, VisualDirectionWeightKind, VisualReferenceImage } from "@/types";

function displaySrc(src: string): string {
  const isUrl =
    src.startsWith("blob:") ||
    src.startsWith("data:") ||
    src.startsWith("asset:") ||
    src.startsWith("http:") ||
    src.startsWith("https:");
  return isTauri && !isUrl ? toAssetUrl(src) : src;
}

// Calm visual treatment for each direction kind — replaces raw weight numbers
// and the internal `kind · source` debug tooltip with a quiet colour + label.
const DIRECTION_STYLES: Record<VisualDirectionWeightKind, { dot: string; ring: string; text: string; label: string }> = {
  required:    { dot: "bg-lumina-gold",     ring: "border-lumina-gold/35 bg-lumina-gold/[0.07]", text: "text-lumina-gold/90", label: "Must include" },
  important:   { dot: "bg-amber-200/80",    ring: "border-white/12 bg-white/[0.03]",             text: "text-white/65",      label: "Important" },
  style:       { dot: "bg-sky-300/70",      ring: "border-sky-300/15 bg-sky-300/[0.045]",        text: "text-sky-100/65",    label: "Style" },
  composition: { dot: "bg-violet-300/70",   ring: "border-violet-300/15 bg-violet-300/[0.045]",  text: "text-violet-100/65", label: "Composition" },
  optional:    { dot: "bg-white/40",        ring: "border-white/10 bg-white/[0.02]",             text: "text-white/45",      label: "Optional" },
  avoid:       { dot: "bg-rose-400/80",     ring: "border-rose-400/20 bg-rose-400/[0.05]",       text: "text-rose-200/75",   label: "Avoid" },
};

function directionSourceNote(source: string): string {
  if (source === "reader") return " · your direction";
  if (source === "reference_image") return " · from a reference";
  if (source === "lore") return " · from the book's lore";
  return "";
}

// Reader-friendly labels for the reference analysis lifecycle — no raw enums.
const REFERENCE_STATUS: Record<VisualReferenceImage["analysisStatus"], { label: string; dot: string; text: string }> = {
  analyzed:   { label: "Analyzed",         dot: "bg-emerald-300/80", text: "text-emerald-200/75" },
  pending:    { label: "Analyzing…",       dot: "bg-lumina-gold/70", text: "text-lumina-gold/72" },
  unanalyzed: { label: "Not analyzed yet", dot: "bg-white/35",       text: "text-white/40" },
  failed:     { label: "Couldn't analyze", dot: "bg-rose-400/70",    text: "text-rose-200/70" },
};

interface GalleryItem {
  scene: IdentifiedScene;
  image?: CachedImage;
  beat?: VisualBeat;
}

interface GalleryFocalViewProps {
  activeSemanticMap: SemanticMap | null;
  imageCache: Record<string, CachedImage>;
  startSceneId?: string;
  isAnalyzing: boolean;
  analysisProgress?: string;
  analysisPercent?: number;
  /** Current analysis phase — used to tell a finished run from a failed one. */
  analysisPhase?: AnalysisProgressPhase;
  /** Navigate the reader to a passage and CLOSE the gallery (go read it). */
  onVisitPassage: (sceneId: string) => void;
  /** Generate the image for a planned scene. */
  onGenerateScene: (sceneId: string) => Promise<void>;
  onAnalyze: () => void;
  onRegenerateAll: () => void | Promise<void>;
  onClose: () => void;
}

export default function GalleryFocalView({
  activeSemanticMap,
  imageCache,
  startSceneId,
  isAnalyzing,
  analysisProgress,
  analysisPercent,
  analysisPhase,
  onVisitPassage,
  onGenerateScene,
  onAnalyze,
  onRegenerateAll,
  onClose,
}: GalleryFocalViewProps) {
  // Every planned moment, in reading order — generated and not-yet-generated.
  const chapters = useBookStore((state) => state.activeStructure?.chapters ?? EMPTY_CHAPTERS);
  const items: GalleryItem[] = useMemo(() => {
    const allScenes = activeSemanticMap?.scenes ?? EMPTY_SCENES;
    const scenes = segmentScenesForSemanticMap(allScenes, chapters, activeSemanticMap);
    const beats = activeSemanticMap?.storyboard?.beats ?? EMPTY_BEATS;
    const cached = Object.values(imageCache);
    return scenes.map((scene) => ({
      scene,
      image: getImageForScene(scene, cached, chapters, allScenes),
      beat: beats.find((b) => b.sceneId === scene.id),
    }));
  }, [activeSemanticMap, imageCache, chapters]);

  const startIndex = Math.max(0, items.findIndex((it) => it.scene.id === startSceneId));
  const [index, setIndex] = useState(startIndex < 0 ? 0 : startIndex);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [showBookMenu, setShowBookMenu] = useState(false);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [readerDirection, setReaderDirection] = useState("");
  const [showDirector, setShowDirector] = useState(false);
  const [referenceRightsConfirmed, setReferenceRightsConfirmed] = useState(false);
  const [analyzingReferences, setAnalyzingReferences] = useState(false);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const selectedThumbRef = useRef<HTMLButtonElement>(null);
  const openedAtRef = useRef(Date.now());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setActiveSemanticMap = useBookStore((state) => state.setActiveSemanticMap);

  useEffect(() => {
    openedAtRef.current = Date.now();
  }, []);
  const generatedCount = items.filter((item) => item.image).length;

  // Surface a calm, always-visible status for re-analysis — independent of the
  // Book Visuals menu. The done/failed confirmation is held briefly after the
  // run ends (see useAnalysisOutcome for why the transition is observed here).
  const outcome = useAnalysisOutcome(isAnalyzing, analysisPhase, analysisProgress);
  const analysisPct = Math.max(6, Math.min(100, analysisPercent ?? 12));

  const clamp = (i: number) => Math.max(0, Math.min(items.length - 1, i));

  const runGenerate = async (sceneId: string) => {
    if (generatingId) return;
    setGenerateError(null);
    setGeneratingId(sceneId);
    try {
      await onGenerateScene(sceneId);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Image generation failed");
    } finally {
      setGeneratingId(null);
    }
  };

  const activateItem = (i: number) => {
    const it = items[i];
    if (!it) return;
    setIndex(i);
    if (it.image) return; // generated: view only, inert
    if (generatingId) return;
    void runGenerate(it.scene.id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIndex((i) => clamp(i + 1));
      else if (e.key === "ArrowLeft") setIndex((i) => clamp(i - 1));
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, onClose]);

  useEffect(() => {
    selectedThumbRef.current?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [index]);

  const current = items[index];
  const currentBrief = current
    ? current.scene.publicVisualBrief ?? buildPublicVisualBrief(current.scene, current.beat)
    : null;
  const activeTag = currentBrief?.tags.find((tag) => tag.id === activeTagId);
  const caption = current
    ? current.scene.expositoryBeat?.centralClaim ||
      current.scene.expositoryBeat?.sectionTitle ||
      current.scene.directorBrief?.blocking?.focalPoint ||
      current.scene.symbolicMotifs?.slice(0, 3).join(" · ") ||
      current.scene.emotionalVector?.slice(0, 2).join(" · ") ||
      ""
    : "";
  const beatLabel = current?.beat?.beatType?.replace(/_/g, " ") ?? "scene";
  const activeSlot = useImageStore((s) => s.activeGenerationSlot);
  const isGenerating = useImageStore((s) => s.isGenerating);
  const setPhonePanel = useUiStore((s) => s.setPhonePanel);
  const currentSlotKey = current ? visualSlotKeyForScene(current.scene, chapters) : null;
  const currentGenerating = current
    ? generatingId === current.scene.id ||
      (isGenerating && !!currentSlotKey && activeSlot === currentSlotKey)
    : false;

  useEffect(() => {
    setActiveTagId(null);
    setReaderDirection(currentBrief?.readerDirection ?? "");
    setReferenceRightsConfirmed(false);
    setShowDirector(false);
  }, [current?.scene.id, currentBrief?.readerDirection]);

  const handleBackdropClose = () => {
    if (Date.now() - openedAtRef.current < 350) return;
    onClose();
  };

  const switchPhonePanel = (panel: "reader" | "visual" | "toc") => {
    setPhonePanel(panel);
    onClose();
  };

  const updateCurrentBrief = async (patch: Partial<NonNullable<typeof currentBrief>>) => {
    if (!current || !activeSemanticMap || !currentBrief) return;
    const nextBrief = {
      ...currentBrief,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    const nextMap: SemanticMap = {
      ...activeSemanticMap,
      scenes: activeSemanticMap.scenes.map((scene) =>
        scene.id === current.scene.id ? { ...scene, publicVisualBrief: nextBrief } : scene
      ),
    };
    setActiveSemanticMap(nextMap);
    await storage.saveSemanticMap(nextMap).catch(() => {});
  };

  const saveReaderDirection = () => {
    if (!currentBrief) return;
    const trimmed = readerDirection.trim();
    const withoutPrevious = currentBrief.weightedDirections.filter((item) => item.id !== "reader_override_direction");
    void updateCurrentBrief({
      readerDirection,
      weightedDirections: trimmed
        ? [
            {
              id: "reader_override_direction",
              label: trimmed,
              kind: "required",
              weight: 10,
              source: "reader",
            },
            ...withoutPrevious,
          ]
        : withoutPrevious,
    });
  };

  const addReferenceImages = async (files: FileList | null) => {
    if (!files?.length || !currentBrief || !referenceRightsConfirmed) return;
    const nextRefs = await Promise.all(
      Array.from(files).slice(0, 4).map(
        (file) =>
          new Promise<NonNullable<typeof currentBrief>["referenceImages"][number]>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                id: `ref_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                fileName: file.name,
                dataUrl: typeof reader.result === "string" ? reader.result : undefined,
                addedAt: new Date().toISOString(),
                rightsConfirmed: true,
                analysisStatus: "unanalyzed",
              });
            };
            reader.onerror = () => {
              resolve({
                id: `ref_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                fileName: file.name,
                addedAt: new Date().toISOString(),
                rightsConfirmed: true,
                analysisStatus: "failed",
              });
            };
            reader.readAsDataURL(file);
          })
      )
    );
    await updateCurrentBrief({
      referenceImages: [...currentBrief.referenceImages, ...nextRefs],
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const analyzeCurrentReferences = async () => {
    if (!currentBrief || analyzingReferences) return;
    const pendingRefs = currentBrief.referenceImages.filter((ref) =>
      ref.rightsConfirmed && (ref.analysisStatus === "pending" || ref.analysisStatus === "unanalyzed" || ref.analysisStatus === "failed")
    );
    if (!pendingRefs.length) return;

    setReferenceError(null);
    setAnalyzingReferences(true);
    // Track reference-image analysis as its own job (one run per "Analyze"
    // action, one step per image) so every AI vision event shows in the log.
    const { startWorkflow, trackStep, completeWorkflow } = await import("@/services/workflowTracker");
    const refBookTitle = useBookStore.getState().activeBook?.title ?? "Book";
    const refWorkflowId = await startWorkflow(
      "reference-analysis",
      `${refBookTitle} — reference image analysis`,
      {
        book_id: activeSemanticMap?.bookId,
        scene_id: current?.scene.id,
        reference_count: pendingRefs.length,
      },
      "Analyze reader reference images into broad visual guidance"
    );
    try {
      const analyzed = [];
      const referenceDirections = [];
      for (const ref of currentBrief.referenceImages) {
        if (!pendingRefs.some((item) => item.id === ref.id)) {
          analyzed.push(ref);
          continue;
        }
        try {
          const analysis = await trackStep(
            refWorkflowId,
            {
              name: "reference-image",
              goal: `Extract visual guidance from ${ref.fileName}`,
              agent: "visual_analyst",
              skill: "reference-image-analysis",
            },
            () => analyzeReferenceImage(ref),
            (a) => ({
              metrics: {
                file_name: ref.fileName,
                provider: a.provider,
                traits: a.visualTraits.length,
                palette: a.palette.length,
              },
              goal_achieved: a.provider === "unavailable" ? 0.4 : 1,
              unblocked_next: a.provider !== "unavailable",
            }),
            (err) => ({
              metrics: { file_name: ref.fileName, error: err instanceof Error ? err.message : String(err) },
              goal_achieved: 0,
              unblocked_next: true,
            })
          );
          analyzed.push({
            ...ref,
            analysis,
            analysisStatus: analysis.provider === "unavailable" ? "unanalyzed" as const : "analyzed" as const,
          });
          if (analysis.provider !== "unavailable") {
            referenceDirections.push(
              ...analysis.visualTraits.slice(0, 4).map((label, i) => ({
                id: `${ref.id}_trait_${i}`,
                label,
                kind: "important" as const,
                weight: Math.max(5, 8 - i),
                source: "reference_image" as const,
              })),
              ...analysis.palette.slice(0, 3).map((label, i) => ({
                id: `${ref.id}_palette_${i}`,
                label,
                kind: "style" as const,
                weight: Math.max(4, 6 - i),
                source: "reference_image" as const,
              })),
              ...analysis.compositionHints.slice(0, 2).map((label, i) => ({
                id: `${ref.id}_composition_${i}`,
                label,
                kind: "composition" as const,
                weight: Math.max(4, 6 - i),
                source: "reference_image" as const,
              })),
              ...analysis.avoidCopying.slice(0, 3).map((label, i) => ({
                id: `${ref.id}_avoid_${i}`,
                label,
                kind: "avoid" as const,
                weight: 10,
                source: "reference_image" as const,
              }))
            );
          }
        } catch (err) {
          analyzed.push({ ...ref, analysisStatus: "failed" as const });
          setReferenceError(err instanceof Error ? err.message : "Reference analysis failed");
        }
      }
      const existing = currentBrief.weightedDirections.filter((item) => item.source !== "reference_image");
      await updateCurrentBrief({
        referenceImages: analyzed,
        weightedDirections: [...existing, ...referenceDirections],
      });
    } finally {
      setAnalyzingReferences(false);
      await completeWorkflow(refWorkflowId, {
        outcome_metrics: { reference_count: pendingRefs.length, scene_id: current?.scene.id },
      });
    }
  };

  return (
    <ModalPortal>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // Dim "gallery room" surround — kept dark in both themes so the art reads.
      className="fixed inset-0 z-[100] flex flex-col bg-[#08070a]/96 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label="Visual gallery"
      onClick={handleBackdropClose}
    >
      {/* Top bar */}
      <div className="relative flex items-center justify-between px-5 py-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">
          {index + 1} / {items.length}
        </p>
        <div className="flex items-center gap-2">
          <div className="mr-1 flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.025] p-1 md:hidden">
            <button
              onClick={() => switchPhonePanel("toc")}
              className="flex h-9 w-9 items-center justify-center rounded-full text-white/42 transition-colors hover:bg-white/[0.06] hover:text-lumina-gold/85"
              aria-label="Contents"
            >
              <List size={16} />
            </button>
            <button
              onClick={() => switchPhonePanel("reader")}
              className="flex h-9 w-9 items-center justify-center rounded-full text-white/42 transition-colors hover:bg-white/[0.06] hover:text-lumina-gold/85"
              aria-label="Reader"
            >
              <BookOpen size={16} />
            </button>
            <button
              onClick={() => switchPhonePanel("visual")}
              className="flex h-9 w-9 items-center justify-center rounded-full text-white/42 transition-colors hover:bg-white/[0.06] hover:text-lumina-gold/85"
              aria-label="Visuals"
            >
              <Image size={16} />
            </button>
          </div>
          <button
            onClick={() => setShowBookMenu((open) => !open)}
            className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.025] text-white/42 backdrop-blur-sm transition-colors hover:border-lumina-gold/35 hover:bg-white/[0.06] hover:text-lumina-gold/85"
            aria-label="Book visual controls"
            aria-expanded={showBookMenu}
          >
            <ListFilter size={18} />
          </button>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/80"
            aria-label="Close gallery"
          >
            <X size={18} />
          </button>
        </div>

        {showBookMenu && (
          <div
            className="absolute right-16 top-14 z-30 w-[min(360px,calc(100vw-32px))] rounded-xl border border-white/12 bg-[#081522]/92 p-3 text-left shadow-2xl shadow-black/45 backdrop-blur-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-lumina-gold/75">
                  Book Visuals
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/42">
                  Analysis rebuilds the plan. Image regeneration only happens from the slide action.
                </p>
              </div>
              <button
                onClick={() => setShowBookMenu(false)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/35 transition-colors hover:bg-white/[0.06] hover:text-white/75"
                aria-label="Close visual controls"
              >
                <X size={14} />
              </button>
            </div>

            <button
              onClick={() => {
                onAnalyze();
                setShowBookMenu(false);
              }}
              disabled={isAnalyzing}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-lumina-gold/30 bg-lumina-gold/[0.075] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-lumina-gold/88 transition-colors hover:border-lumina-gold/50 hover:bg-lumina-gold/[0.11] disabled:cursor-default disabled:opacity-70"
            >
              {isAnalyzing ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {isAnalyzing ? "Analyzing" : activeSemanticMap ? "Re-analyze This Book" : "Analyze This Book"}
            </button>

            {generatedCount > 0 && !isAnalyzing && (
              <div className="mt-3 border-t border-white/10 pt-3">
                <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-white/35">
                  Generated images
                </p>
                <FocalSlideToRegenerate
                  onConfirm={async () => {
                    await onRegenerateAll();
                    setShowBookMenu(false);
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Re-analysis status — floats below the top bar, always visible while a
          run is in flight (or just finished), regardless of the menu state. */}
      <div className="pointer-events-none absolute inset-x-0 top-16 z-40 flex justify-center px-4">
        <AnimatePresence>
          {(isAnalyzing || outcome) && (
            <motion.div
              key={isAnalyzing ? "analyzing" : outcome?.kind}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-auto w-[min(440px,calc(100vw-32px))] rounded-xl border border-white/12 bg-[#081522]/92 px-4 py-3 shadow-2xl shadow-black/45 backdrop-blur-xl"
            >
              {isAnalyzing ? (
                <>
                  <div className="flex items-center gap-2.5">
                    <Loader size={14} className="shrink-0 animate-spin text-lumina-gold/85" />
                    <p className="flex-1 truncate text-[12px] text-white/80">
                      {analysisProgress || "Reading the book's emotional landscape…"}
                    </p>
                    <span className="shrink-0 text-[11px] tabular-nums text-white/45">
                      {Math.round(analysisPct)}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className="h-full rounded-full bg-lumina-gold/75 transition-all duration-500"
                      style={{ width: `${analysisPct}%` }}
                    />
                  </div>
                </>
              ) : outcome?.kind === "done" ? (
                <div className="flex items-center gap-2.5">
                  <Check size={14} className="shrink-0 text-emerald-300/90" />
                  <p className="text-[12px] text-white/80">{outcome.message}</p>
                </div>
              ) : (
                <div className="flex items-center gap-2.5">
                  <AlertTriangle size={14} className="shrink-0 text-rose-300/90" />
                  <p className="text-[12px] text-white/80">{outcome?.message}</p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Hero: the piece on the wall ─ matte frame + soft shadow, no lamp.
          Top-aligned + internally scrollable so a long expanded brief scrolls
          here instead of overlapping the filmstrip; the image sits up top. */}
      <div className="relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-3 scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        {items.length === 0 ? (
          <div className="m-auto max-w-md text-center">
            <Sparkles size={24} className="mx-auto text-lumina-gold/45" />
            <p className="mt-4 text-sm text-white/50">No visual plan yet.</p>
            <p className="mt-2 text-xs text-white/35">Run analysis to map the book&apos;s visual moments.</p>
            <button
              onClick={onAnalyze}
              disabled={isAnalyzing}
              className="mt-5 rounded-full border border-lumina-gold/35 px-5 py-2 text-[11px] uppercase tracking-[0.16em] text-lumina-gold/80 transition-colors hover:border-lumina-gold/55"
            >
              {isAnalyzing ? "Analyzing…" : "Analyze This Book"}
            </button>
          </div>
        ) : items.length > 1 && (
          <>
            <button
              onClick={() => setIndex((i) => clamp(i - 1))}
              disabled={index === 0}
              className="absolute left-3 top-1/2 z-10 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white/85 disabled:opacity-25"
              aria-label="Previous"
            >
              <ChevronLeft size={26} />
            </button>
            <button
              onClick={() => setIndex((i) => clamp(i + 1))}
              disabled={index === items.length - 1}
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white/85 disabled:opacity-25"
              aria-label="Next"
            >
              <ChevronRight size={26} />
            </button>
          </>
        )}

        {current && (
        <motion.div
          key={current.scene.id}
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="my-auto flex w-full max-w-[min(1100px,92vw)] flex-col items-center"
        >
          {/* Matte / passe-partout frame */}
          <div className="rounded-[3px] bg-[#16140f] p-[clamp(10px,2.2vw,26px)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)] ring-1 ring-white/[0.06]">
            <div className="rounded-[2px] bg-[#0c0b09] p-[3px] ring-1 ring-black/40">
              {current.image ? (
                <img
                  src={displaySrc(current.image.filePath)}
                  alt={caption || "Generated visual"}
                  className="block max-h-[46vh] w-auto max-w-full rounded-[1px] object-contain"
                  draggable={false}
                />
              ) : (
                // Planned placeholder — empty frame awaiting its image.
                <div className="flex h-[42vh] w-[min(620px,82vw)] flex-col items-center justify-center gap-4 rounded-[1px] bg-[#0b0a08] px-8 text-center">
                  {currentGenerating ? (
                    <>
                      <Loader size={22} className="animate-spin text-lumina-gold/70" />
                      <p className="text-xs uppercase tracking-[0.2em] text-white/40">Composing this scene…</p>
                    </>
                  ) : (
                    <>
                      <Sparkles size={22} className="text-lumina-gold/45" />
                      <p className="text-xs uppercase tracking-[0.2em] text-white/35">Planned moment</p>
                      <button
                        onClick={() => activateItem(index)}
                        className="rounded-full border border-white/15 px-4 py-2 text-[11px] uppercase tracking-[0.16em] text-white/55 transition-colors hover:border-lumina-gold/45 hover:text-lumina-gold/85"
                      >
                        Generate image
                      </button>
                      {generateError && (
                        <p className="max-w-xs text-[11px] leading-relaxed text-rose-300/80">{generateError}</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Plaque */}
          <div className="mt-5 max-w-xl text-center">
            <p className="text-[10px] uppercase tracking-[0.28em] text-lumina-gold/55">{beatLabel}</p>
            <p className="mt-1 font-serif text-lg leading-tight text-white/78">
              {currentBrief?.title ?? caption}
            </p>
            {currentBrief?.teaser && (
              <p className="mt-1 text-xs leading-relaxed text-white/45">{currentBrief.teaser}</p>
            )}
            {caption && !currentBrief?.teaser && <p className="mt-2 font-serif text-sm leading-relaxed text-white/55">{caption}</p>}
            {currentBrief && (
              <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] text-left">
                {/* ── About this moment — calm, read-only placard ── */}
                <div className="p-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">About this moment</p>
                  <p className="mt-2 text-xs leading-relaxed text-white/60">{currentBrief.expectedDepiction}</p>
                  <p className="mt-2 text-[11px] italic leading-relaxed text-white/38">{currentBrief.whyChosen}</p>

                  {currentBrief.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {currentBrief.tags.map((tag) => (
                        <button
                          key={tag.id}
                          onClick={() => setActiveTagId((id) => id === tag.id ? null : tag.id)}
                          className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.11em] transition-colors ${
                            activeTagId === tag.id
                              ? "border-lumina-gold/55 bg-lumina-gold/12 text-lumina-gold/90"
                              : "border-white/10 text-white/42 hover:border-lumina-gold/35 hover:text-lumina-gold/75"
                          }`}
                        >
                          {tag.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {activeTag && (
                    <p className="mt-2 rounded-lg border border-lumina-gold/15 bg-lumina-gold/[0.045] px-3 py-2 text-[11px] leading-relaxed text-white/52">
                      {activeTag.description}
                    </p>
                  )}

                  {currentBrief.weightedDirections.length > 0 && (
                    <div className="mt-4">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-white/30">
                        What this image emphasizes
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {currentBrief.weightedDirections
                          .slice()
                          .sort((a, b) => b.weight - a.weight)
                          .slice(0, 8)
                          .map((item) => {
                            const ds = DIRECTION_STYLES[item.kind] ?? DIRECTION_STYLES.optional;
                            const strength = item.weight >= 8 ? 3 : item.weight >= 5 ? 2 : 1;
                            return (
                              <span
                                key={item.id}
                                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${ds.ring} ${ds.text}`}
                                title={`${ds.label}${directionSourceNote(item.source)}`}
                              >
                                <span className={`h-1.5 w-1.5 rounded-full ${ds.dot}`} />
                                {item.label.length > 34 ? `${item.label.slice(0, 34)}…` : item.label}
                                <span className="ml-0.5 flex items-end gap-px" aria-hidden="true">
                                  {[0, 1, 2].map((n) => (
                                    <span
                                      key={n}
                                      className={`w-0.5 rounded-full ${n < strength ? ds.dot : "bg-white/12"}`}
                                      style={{ height: `${4 + n * 2}px` }}
                                    />
                                  ))}
                                </span>
                              </span>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Direct this image — editing tools, tucked away by default ── */}
                <div className="border-t border-white/[0.07]">
                  <button
                    onClick={() => setShowDirector((open) => !open)}
                    className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
                    aria-expanded={showDirector}
                  >
                    <span className="flex items-center gap-2 text-[11px] font-medium text-white/55">
                      <Wand2 size={13} className="text-lumina-gold/65" />
                      Direct this image
                      {(readerDirection.trim() || currentBrief.referenceImages.length > 0) && !showDirector && (
                        <span className="rounded-full bg-lumina-gold/15 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-lumina-gold/75">
                          edited
                        </span>
                      )}
                    </span>
                    <ChevronDown
                      size={15}
                      className={`text-white/35 transition-transform ${showDirector ? "rotate-180" : ""}`}
                    />
                  </button>

                  {showDirector && (
                    <div className="space-y-3 px-4 pb-4">
                      <div>
                        <label className="text-[10px] uppercase tracking-[0.14em] text-white/30">Your direction</label>
                        <textarea
                          value={readerDirection}
                          onChange={(event) => setReaderDirection(event.target.value)}
                          onBlur={saveReaderDirection}
                          placeholder="Tell Lumina what matters most for this image…"
                          rows={3}
                          className="mt-1.5 w-full resize-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-white/70 outline-none transition-colors placeholder:text-white/25 focus:border-lumina-gold/35"
                        />
                      </div>

                      <div className="rounded-lg border border-white/[0.07] bg-black/15 p-3">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-white/30">Reference images</p>
                        <label className="mt-2 flex items-start gap-2 text-[11px] leading-relaxed text-white/42">
                          <input
                            type="checkbox"
                            checked={referenceRightsConfirmed}
                            onChange={(event) => setReferenceRightsConfirmed(event.target.checked)}
                            className="mt-0.5 accent-[#c9a83f]"
                          />
                          <span>Add only images you own, created, licensed, or have permission to use.</span>
                        </label>
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={(event) => void addReferenceImages(event.target.files)}
                          />
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={!referenceRightsConfirmed}
                            className="rounded-full border border-white/12 px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] text-white/42 transition-colors hover:border-lumina-gold/35 hover:text-lumina-gold/75 disabled:opacity-40"
                          >
                            Add reference
                          </button>
                          {currentBrief.referenceImages.some((ref) => ref.analysisStatus !== "analyzed") && (
                            <button
                              onClick={() => void analyzeCurrentReferences()}
                              disabled={analyzingReferences}
                              className="inline-flex items-center gap-1.5 rounded-full border border-lumina-gold/25 px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] text-lumina-gold/72 transition-colors hover:border-lumina-gold/45 hover:text-lumina-gold disabled:opacity-45"
                            >
                              {analyzingReferences && <Loader size={11} className="animate-spin" />}
                              {analyzingReferences ? "Analyzing…" : "Analyze references"}
                            </button>
                          )}
                        </div>
                        {currentBrief.referenceImages.length > 0 && (
                          <div className="mt-2.5 grid gap-1">
                            {currentBrief.referenceImages.slice(0, 4).map((ref) => {
                              const rs = REFERENCE_STATUS[ref.analysisStatus] ?? REFERENCE_STATUS.unanalyzed;
                              return (
                                <div key={ref.id} className="flex items-center justify-between gap-2 rounded-md bg-white/[0.025] px-2.5 py-1.5 text-[10px] text-white/45">
                                  <span className="truncate">{ref.fileName}</span>
                                  <span className={`inline-flex shrink-0 items-center gap-1.5 ${rs.text}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${rs.dot}`} />
                                    {rs.label}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {referenceError && (
                          <p className="mt-2 text-[11px] leading-relaxed text-rose-300/80">{referenceError}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            <button
              onClick={() => onVisitPassage(current.scene.id)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-white/45 transition-colors hover:border-lumina-gold/40 hover:text-lumina-gold/80"
            >
              <MapPin size={12} />
              Visit passage
            </button>
          </div>
        </motion.div>
        )}
      </div>

      {/* Filmstrip — every planned moment; placeholders included */}
      {items.length > 0 && (
      <div className="flex-shrink-0 overflow-x-auto px-5 py-4 scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto flex w-max items-center gap-3">
          {items.map((it, i) => {
            const selected = i === index;
            const gen = generatingId === it.scene.id;
            return (
              <button
                key={it.scene.id}
                ref={selected ? selectedThumbRef : undefined}
                onClick={() => activateItem(i)}
                className={`relative h-16 w-24 flex-shrink-0 overflow-hidden rounded-[2px] transition-all ${
                  selected
                    ? "ring-2 ring-lumina-gold/70 opacity-100"
                    : "opacity-50 ring-1 ring-white/10 hover:opacity-85"
                }`}
                aria-label={it.image ? `View image ${i + 1}` : `Planned moment ${i + 1}`}
                title={it.image ? undefined : "Generate image"}
              >
                {it.image ? (
                  <img src={displaySrc(it.image.filePath)} alt="" className="h-full w-full object-cover" draggable={false} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[#100e0b]">
                    {gen ? (
                      <Loader size={14} className="animate-spin text-lumina-gold/70" />
                    ) : (
                      <Sparkles size={14} className="text-lumina-gold/35" />
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
      )}
    </motion.div>
    </ModalPortal>
  );
}

function FocalSlideToRegenerate({ onConfirm }: { onConfirm: () => void | Promise<void> }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const [maxX, setMaxX] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const HANDLE = 36;
  const PADDING = 4;

  useEffect(() => {
    const measure = () => {
      if (trackRef.current) {
        setMaxX(Math.max(0, trackRef.current.offsetWidth - HANDLE - PADDING * 2));
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return (
    <div
      ref={trackRef}
      className="relative h-11 select-none overflow-hidden rounded-full border border-white/12 bg-sky-50/[0.055] shadow-inner shadow-black/20 backdrop-blur-md"
    >
      <div className="pointer-events-none absolute inset-[3px] rounded-full border border-white/[0.055] bg-gradient-to-r from-sky-100/[0.035] via-sky-100/[0.075] to-sky-100/[0.035]" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-12 text-center text-[10px] uppercase tracking-[0.12em] text-white/42">
        {confirmed ? "Preparing repaint..." : "Slide to erase images"}
      </div>
      <motion.div
        drag={confirmed ? false : "x"}
        dragConstraints={{ left: 0, right: maxX }}
        dragElastic={0}
        dragMomentum={false}
        style={{ x, left: PADDING, width: HANDLE }}
        onDragEnd={() => {
          if (x.get() >= maxX - 6) {
            setConfirmed(true);
            animate(x, maxX, { type: "spring", stiffness: 420, damping: 38 });
            void onConfirm();
          } else {
            animate(x, 0, { type: "spring", stiffness: 420, damping: 38 });
          }
        }}
        onClick={(event) => event.stopPropagation()}
        className="absolute top-1 flex h-9 cursor-grab items-center justify-center rounded-full border border-lumina-gold/45 bg-lumina-gold/78 text-[#071525] shadow-[0_8px_22px_rgba(0,0,0,0.35)] active:cursor-grabbing"
        aria-label="Slide to erase generated images and regenerate from reading anchors"
      >
        <RefreshCw size={14} />
      </motion.div>
    </div>
  );
}
