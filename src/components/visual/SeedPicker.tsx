import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";
import { STYLE_SEEDS } from "@/data/styleSeeds";
import { useBookStore } from "@/store/bookStore";
import type { StyleSeedId } from "@/types";

interface SeedPickerProps {
  onSelect: (seedId: StyleSeedId) => void;
  bookTitle: string;
}

export default function SeedPicker({ onSelect, bookTitle }: SeedPickerProps) {
  const [selected, setSelected] = useState<StyleSeedId | null>(null);
  const [hoveredId, setHoveredId] = useState<StyleSeedId | null>(null);

  const handleBeginReading = () => {
    if (!selected) return;
    onSelect(selected);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-8"
    >
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="text-center mb-10"
      >
        <div className="flex items-center justify-center gap-2 mb-4">
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

      {/* Seed Grid */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="grid grid-cols-3 gap-4 w-full max-w-2xl mb-8"
      >
        {STYLE_SEEDS.map((seed) => {
          const isSelected = selected === seed.id;
          const isHovered = hoveredId === seed.id;

          return (
            <motion.button
              key={seed.id}
              onClick={() => setSelected(seed.id)}
              onMouseEnter={() => setHoveredId(seed.id)}
              onMouseLeave={() => setHoveredId(null)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className={`relative rounded-xl overflow-hidden border-2 transition-all duration-200 text-left ${
                isSelected
                  ? "border-lumina-gold shadow-lg shadow-lumina-gold/20"
                  : "border-hair hover:border-hair"
              }`}
            >
              {/* Preview area */}
              <div className="w-full aspect-video relative overflow-hidden bg-black">
                <img
                  src={seed.previewImage}
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

              {/* Label */}
              <div className="p-3">
                <p
                  className={`text-sm font-medium mb-0.5 ${
                    isSelected ? "text-lumina-gold" : "text-ink-soft"
                  }`}
                >
                  {seed.name}
                </p>
                <p className="text-xs text-ink-faint leading-snug">{seed.description}</p>
              </div>
            </motion.button>
          );
        })}
      </motion.div>

      {/* Begin button */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: selected ? 1 : 0.4 }}
        onClick={handleBeginReading}
        disabled={!selected}
        className="px-8 py-3 rounded-xl bg-lumina-gold/20 text-lumina-gold border border-lumina-gold/30 text-sm font-medium hover:bg-lumina-gold/30 disabled:cursor-not-allowed transition-all"
      >
        Begin Reading
      </motion.button>

      <p className="text-xs text-ink-faint mt-4">
        Images are generated as you read — never all at once.
      </p>
    </motion.div>
  );
}

// Real seed previews are now SVG assets in public/assets/seed-previews/
