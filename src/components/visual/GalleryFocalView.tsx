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
import { X, MapPin, ChevronLeft, ChevronRight, Sparkles, Loader, ListFilter, RefreshCw, Check, AlertTriangle } from "lucide-react";
import { isTauri } from "@/utils/runtime";
import { toAssetUrl } from "@/utils/tauriBridge";
import { useAnalysisOutcome } from "@/hooks/useAnalysisOutcome";
import { useBookStore } from "@/store/bookStore";
import { getImageForScene } from "@/utils/imagePosition";
import { segmentScenesOnePerSlot } from "@/utils/sceneDedup";
import { EMPTY_BEATS, EMPTY_CHAPTERS, EMPTY_SCENES } from "@/utils/stableEmpty";
import type { AnalysisProgressPhase, CachedImage, IdentifiedScene, SemanticMap, VisualBeat } from "@/types";

function displaySrc(src: string): string {
  const isUrl =
    src.startsWith("blob:") ||
    src.startsWith("data:") ||
    src.startsWith("asset:") ||
    src.startsWith("http:") ||
    src.startsWith("https:");
  return isTauri && !isUrl ? toAssetUrl(src) : src;
}

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
    const scenes = segmentScenesOnePerSlot(allScenes, chapters);
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
  const [showBookMenu, setShowBookMenu] = useState(false);
  const selectedThumbRef = useRef<HTMLButtonElement>(null);
  const openedAtRef = useRef(Date.now());

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
    setGeneratingId(sceneId);
    try {
      await onGenerateScene(sceneId);
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
  const caption = current
    ? current.scene.directorBrief?.blocking?.focalPoint ||
      current.scene.symbolicMotifs?.slice(0, 3).join(" · ") ||
      current.scene.emotionalVector?.slice(0, 2).join(" · ") ||
      ""
    : "";
  const beatLabel = current?.beat?.beatType?.replace(/_/g, " ") ?? "scene";
  const currentGenerating = current ? generatingId === current.scene.id : false;

  const handleBackdropClose = () => {
    if (Date.now() - openedAtRef.current < 350) return;
    onClose();
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

      {/* Hero: the piece on the wall ─ matte frame + soft shadow, no lamp */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-6" onClick={(e) => e.stopPropagation()}>
        {items.length === 0 ? (
          <div className="max-w-md text-center">
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
          className="flex max-h-full max-w-[min(1100px,92vw)] flex-col items-center"
        >
          {/* Matte / passe-partout frame */}
          <div className="rounded-[3px] bg-[#16140f] p-[clamp(10px,2.2vw,26px)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)] ring-1 ring-white/[0.06]">
            <div className="rounded-[2px] bg-[#0c0b09] p-[3px] ring-1 ring-black/40">
              {current.image ? (
                <img
                  src={displaySrc(current.image.filePath)}
                  alt={caption || "Generated visual"}
                  className="block max-h-[62vh] w-auto max-w-full rounded-[1px] object-contain"
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
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Plaque */}
          <div className="mt-5 max-w-xl text-center">
            <p className="text-[10px] uppercase tracking-[0.28em] text-lumina-gold/55">{beatLabel}</p>
            {caption && <p className="mt-2 font-serif text-sm leading-relaxed text-white/55">{caption}</p>}
            {current.image && (
              <button
                onClick={() => onVisitPassage(current.scene.id)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-white/45 transition-colors hover:border-lumina-gold/40 hover:text-lumina-gold/80"
              >
                <MapPin size={12} />
                Visit passage
              </button>
            )}
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
