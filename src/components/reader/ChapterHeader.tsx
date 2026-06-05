/**
 * ChapterHeader — animated chapter title with typographic hierarchy.
 *
 * Breaks the raw stored title string into:
 *   groupLabel  — "Book One — Born a Serf"  (gold, small caps)
 *   title       — "The Reaper"              (large serif, primary)
 *   subtitle    — from "Chapter 1: Subtitle" or "Chapter 1 — Subtitle"
 *
 * Re-animates on every chapter change via the `chapterIndex` key.
 */

import { motion, AnimatePresence } from "framer-motion";
import { parseChapterDisplay } from "@/utils/titleUtils";

interface ChapterHeaderProps {
  title: string;
  bookTitle: string;
  /** Used as AnimatePresence key — triggers the entry animation on each chapter change */
  chapterIndex: number;
  fontSize: number;
}

export default function ChapterHeader({
  title,
  bookTitle,
  chapterIndex,
  fontSize,
}: ChapterHeaderProps) {
  const display = parseChapterDisplay(title);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={chapterIndex}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
        className="flex-shrink-0 px-8 pt-6 pb-5 border-b border-hair"
      >
        {/* Book title — smallest, most muted, always present */}
        <p className="text-xs tracking-[0.18em] text-ink-faint uppercase mb-1 font-medium">
          {bookTitle}
        </p>

        {/* Group label — "Book One", "Part Two", "Act One" — when present */}
        {display.groupLabel && (
          <p className="text-xs tracking-[0.14em] text-lumina-gold/50 uppercase mb-2 font-medium">
            {display.groupLabel}
          </p>
        )}

        {/* Primary chapter title — largest, most prominent */}
        <h1
          className="font-serif text-ink leading-tight tracking-tight"
          style={{ fontSize: `${Math.round(fontSize * 1.55)}px` }}
        >
          {display.title}
        </h1>

        {/* Subtitle — e.g. "The Reaper" from "Chapter One: The Reaper" */}
        {display.subtitle && (
          <p
            className="font-serif text-ink-soft leading-snug mt-1 italic"
            style={{ fontSize: `${Math.round(fontSize * 1.1)}px` }}
          >
            {display.subtitle}
          </p>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
