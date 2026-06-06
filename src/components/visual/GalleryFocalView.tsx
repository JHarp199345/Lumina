/**
 * GalleryFocalView
 *
 * A reverent, gallery-style presentation of the book's generated images.
 * Clicking the visual panel's image opens this: one piece centered and large
 * in a dim room with a matte frame (passe-partout) and soft shadow — no lamp,
 * no gimmick — with a filmstrip along the bottom to pan through the others.
 * Whichever scene is centered in the strip is the one on the wall.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, MapPin, ChevronLeft, ChevronRight } from "lucide-react";
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
  image: CachedImage;
  beat?: VisualBeat;
}

interface GalleryFocalViewProps {
  activeSemanticMap: SemanticMap | null;
  imageCache: Record<string, CachedImage>;
  startSceneId?: string;
  onVisitPassage: (sceneId: string) => void;
  onClose: () => void;
}

export default function GalleryFocalView({
  activeSemanticMap,
  imageCache,
  startSceneId,
  onVisitPassage,
  onClose,
}: GalleryFocalViewProps) {
  // Ordered list of scenes that actually have a generated image.
  const items: GalleryItem[] = useMemo(() => {
    const scenes = activeSemanticMap?.scenes ?? [];
    const beats = activeSemanticMap?.storyboard?.beats ?? [];
    return scenes
      .map((scene): GalleryItem | null => {
        const image = imageCache[scene.id];
        if (!image) return null;
        return { scene, image, beat: beats.find((b) => b.sceneId === scene.id) };
      })
      .filter((x): x is GalleryItem => x !== null);
  }, [activeSemanticMap, imageCache]);

  const startIndex = Math.max(
    0,
    items.findIndex((it) => it.scene.id === startSceneId)
  );
  const [index, setIndex] = useState(startIndex < 0 ? 0 : startIndex);
  const selectedThumbRef = useRef<HTMLButtonElement>(null);

  const clamp = (i: number) => Math.max(0, Math.min(items.length - 1, i));
  const go = (i: number) => setIndex(clamp(i));

  // Keyboard: arrows pan, Esc closes.
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

  // Keep the selected thumbnail centered in the filmstrip.
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
      <div
        className="flex items-center justify-between px-5 py-3"
        onClick={(e) => e.stopPropagation()}
      >
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
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pan arrows */}
        {items.length > 1 && (
          <>
            <button
              onClick={() => go(index - 1)}
              disabled={index === 0}
              className="absolute left-3 top-1/2 z-10 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white/85 disabled:opacity-25"
              aria-label="Previous image"
            >
              <ChevronLeft size={26} />
            </button>
            <button
              onClick={() => go(index + 1)}
              disabled={index === items.length - 1}
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white/85 disabled:opacity-25"
              aria-label="Next image"
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
              <img
                src={displaySrc(current.image.filePath)}
                alt={caption || "Generated visual"}
                className="block max-h-[62vh] w-auto max-w-full rounded-[1px] object-contain"
                draggable={false}
              />
            </div>
          </div>

          {/* Plaque */}
          <div className="mt-5 max-w-xl text-center">
            <p className="text-[10px] uppercase tracking-[0.28em] text-lumina-gold/55">{beatLabel}</p>
            {caption && (
              <p className="mt-2 font-serif text-sm leading-relaxed text-white/55">{caption}</p>
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
      </div>

      {/* Filmstrip */}
      <div
        className="flex-shrink-0 overflow-x-auto px-5 py-4 scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto flex w-max items-center gap-3">
          {items.map((it, i) => (
            <button
              key={it.scene.id}
              ref={i === index ? selectedThumbRef : undefined}
              onClick={() => go(i)}
              className={`relative h-16 w-24 flex-shrink-0 overflow-hidden rounded-[2px] transition-all ${
                i === index
                  ? "ring-2 ring-lumina-gold/70 opacity-100"
                  : "opacity-45 ring-1 ring-white/10 hover:opacity-80"
              }`}
              aria-label={`View image ${i + 1}`}
            >
              <img
                src={displaySrc(it.image.filePath)}
                alt=""
                className="h-full w-full object-cover"
                draggable={false}
              />
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
