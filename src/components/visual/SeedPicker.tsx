import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { STYLE_SEEDS } from "@/data/styleSeeds";
import { getDisplayThumb } from "@/pipeline/imageGenerator";
import type { StyleSeedId } from "@/types";

interface SeedPickerProps {
  onSelect: (seedId: StyleSeedId) => void;
  bookTitle: string;
}

const STYLE_GROUPS: { label: string; ids: Set<string> }[] = [
  {
    label: "Painterly",
    ids: new Set([
      "dreamlike-watercolor",
      "dark-ink-shadow",
      "golden-manuscript",
      "cold-northern-light",
      "smoke-ember",
      "pale-surrealism",
    ]),
  },
  {
    label: "Photorealistic",
    ids: new Set(["cinematic-photorealism", "dark-fantasy-photo", "neon-noir-photo"]),
  },
  {
    label: "Fine Art & Concept",
    ids: new Set([
      "oil-painting-master",
      "hyperdetail-concept",
      "graphic-novel-painted",
      "vintage-pulp",
    ]),
  },
];

// Resolve asset paths relative to Vite's base (handles /Lumina/ on GitHub Pages)
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
function assetUrl(path: string) {
  return `${BASE}${path.startsWith("/") ? path : "/" + path}`;
}

function pickThumbs(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const seed of STYLE_SEEDS) {
    const v = getDisplayThumb(seed.id);
    if (v) map[seed.id] = v;
  }
  return map;
}

export default function SeedPicker({ onSelect, bookTitle }: SeedPickerProps) {
  const [selected, setSelected] = useState<StyleSeedId | null>(null);
  // Pick randomly (or pinned) once per mount — re-pick if a new image is generated
  const [realThumbs, setRealThumbs] = useState<Record<string, string>>(pickThumbs);

  useEffect(() => {
    const refresh = () => setRealThumbs(pickThumbs());
    window.addEventListener("lumina:thumbs_updated", refresh);
    return () => window.removeEventListener("lumina:thumbs_updated", refresh);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col"
    >
      {/* ── Header ── pinned, centered */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="flex-none flex flex-col items-center text-center pt-8 pb-5 px-8"
      >
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={16} className="text-lumina-gold" />
          <span className="text-xs tracking-widest text-ink-faint uppercase">Lumina</span>
        </div>
        <h1 className="text-2xl font-serif text-ink/85 mb-2">Choose Your Visual Style</h1>
        <p className="text-sm text-ink-faint max-w-md">
          This shapes the imagery generated throughout{" "}
          <span className="text-ink-soft italic">{bookTitle}</span>. You can change it later
          in settings.
        </p>
      </motion.div>

      {/* ── Scrollable grid — absolute fill so mx-auto works reliably ── */}
      <div className="relative flex-1 min-h-0">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="absolute inset-0 overflow-y-auto"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}
        >
          <div className="max-w-2xl mx-auto px-6 pb-4 space-y-6">
            {STYLE_GROUPS.map((group) => {
              const seeds = STYLE_SEEDS.filter((s) => group.ids.has(s.id));
              const orphan = seeds.length % 3 === 1;

              return (
                <div key={group.label}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-[10px] tracking-widest text-ink-faint/50 uppercase">
                      {group.label}
                    </span>
                    <div className="flex-1 h-px bg-white/6" />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {seeds.map((seed, i) => {
                      const isSelected = selected === seed.id;
                      const isOrphan = orphan && i === seeds.length - 1;

                      return (
                        <motion.button
                          key={seed.id}
                          onClick={() => setSelected(seed.id as StyleSeedId)}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          style={isOrphan ? { gridColumnStart: 2 } : undefined}
                          className={`relative rounded-xl overflow-hidden border-2 transition-all duration-200 text-left ${
                            isSelected
                              ? "border-lumina-gold shadow-lg shadow-lumina-gold/20"
                              : "border-hair hover:border-white/15"
                          }`}
                        >
                          <div className="w-full aspect-video relative overflow-hidden bg-black/60">
                            <img
                              src={realThumbs[seed.id] ?? assetUrl(seed.previewImage)}
                              alt={seed.name}
                              className="w-full h-full object-cover"
                              draggable={false}
                            />
                            {isSelected && (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="absolute top-2 right-2 w-5 h-5 rounded-full bg-lumina-gold flex items-center justify-center"
                              >
                                <span className="text-black text-xs font-bold">✓</span>
                              </motion.div>
                            )}
                          </div>

                          <div className="p-3">
                            <p
                              className={`text-sm font-medium mb-0.5 ${
                                isSelected ? "text-lumina-gold" : "text-ink-soft"
                              }`}
                            >
                              {seed.name}
                            </p>
                            <p className="text-xs text-ink-faint leading-snug">
                              {seed.description}
                            </p>
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* Fade — more content below */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-14 bg-gradient-to-t from-black/75 to-transparent" />
      </div>

      {/* ── Footer ── pinned */}
      <div className="flex-none flex flex-col items-center py-5 px-8">
        <motion.button
          animate={{ opacity: selected ? 1 : 0.4 }}
          onClick={() => selected && onSelect(selected)}
          disabled={!selected}
          className="px-8 py-3 rounded-xl bg-lumina-gold/20 text-lumina-gold border border-lumina-gold/30 text-sm font-medium hover:bg-lumina-gold/30 disabled:cursor-not-allowed transition-all"
        >
          Begin Reading
        </motion.button>
        <p className="text-xs text-ink-faint mt-3">
          Images are generated as you read — never all at once.
        </p>
      </div>
    </motion.div>
  );
}
