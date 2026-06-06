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
import { motion } from "framer-motion";
import { X, MapPin, ChevronLeft, ChevronRight, Sparkles, Loader } from "lucide-react";
import { isTauri } from "@/utils/runtime";
import { toAssetUrl } from "@/utils/tauriBridge";
import type { CachedImage, IdentifiedScene, SemanticMap, VisualBeat } from "@/types";

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
  /** Navigate the reader to a passage and CLOSE the gallery (go read it). */
  onVisitPassage: (sceneId: string) => void;
  /** Generate the image for a planned scene. */
  onGenerateScene: (sceneId: string) => Promise<void>;
  onClose: () => void;
}

export default function GalleryFocalView({
  activeSemanticMap,
  imageCache,
  startSceneId,
  onVisitPassage,
  onGenerateScene,
  onClose,
}: GalleryFocalViewProps) {
  // Every planned moment, in reading order — generated and not-yet-generated.
  const items: GalleryItem[] = useMemo(() => {
    const scenes = activeSemanticMap?.scenes ?? [];
    const beats = activeSemanticMap?.storyboard?.beats ?? [];
    return scenes.map((scene) => ({
      scene,
      image: imageCache[scene.id],
      beat: beats.find((b) => b.sceneId === scene.id),
    }));
  }, [activeSemanticMap, imageCache]);

  const startIndex = Math.max(0, items.findIndex((it) => it.scene.id === startSceneId));
  const [index, setIndex] = useState(startIndex < 0 ? 0 : startIndex);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const selectedThumbRef = useRef<HTMLButtonElement>(null);

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

  if (items.length === 0) return null;
  const current = items[index];
  const caption =
    current.scene.directorBrief?.blocking?.focalPoint ||
    current.scene.symbolicMotifs?.slice(0, 3).join(" · ") ||
    current.scene.emotionalVector?.slice(0, 2).join(" · ") ||
    "";
  const beatLabel = current.beat?.beatType?.replace(/_/g, " ") ?? "scene";
  const currentGenerating = generatingId === current.scene.id;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // Dim "gallery room" surround — kept dark in both themes so the art reads.
      className="fixed inset-0 z-[60] flex flex-col bg-[#08070a]/96 backdrop-blur-xl"
      onClick={onClose}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">
          {index + 1} / {items.length}
        </p>
        <button
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/80"
          aria-label="Close gallery"
        >
          <X size={18} />
        </button>
      </div>

      {/* Hero: the piece on the wall ─ matte frame + soft shadow, no lamp */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-6" onClick={(e) => e.stopPropagation()}>
        {items.length > 1 && (
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
      </div>

      {/* Filmstrip — every planned moment; placeholders included */}
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
    </motion.div>
  );
}
