import { motion, AnimatePresence } from "framer-motion";
import { Info } from "lucide-react";
import { useImageStore } from "@/store/imageStore";
import { useBookStore } from "@/store/bookStore";

export default function ThemeDisplay() {
  const { currentThemes } = useImageStore();
  const { activeSemanticMap } = useBookStore();

  if (currentThemes.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center gap-2"
      >
        <span className="text-xs text-ink-faint font-medium tracking-wider uppercase">
          Themes
        </span>
        <div className="flex items-center gap-0 flex-wrap">
          {currentThemes.map((theme, i) => (
            <span key={i} className="text-xs text-ink-soft">
              {i > 0 && <span className="text-ink-faint mx-1.5">·</span>}
              <span className="capitalize">{theme}</span>
            </span>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
