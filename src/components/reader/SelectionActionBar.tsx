/**
 * SelectionActionBar — the app's own selection menu (the OS callout bar with
 * Copy/Share/Ask is system-level and cannot be extended by a web app).
 *
 * Two phases, anchored bottom-centre (thumb-reachable on a tablet, no fragile
 * in-iframe coordinate math):
 *
 *   PENDING  — text is selected, not yet highlighted. Tap a lens to highlight it.
 *   ACTIVE   — just highlighted. Recolour, add a note, or remove. Auto-dismisses.
 */

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { StickyNote, Trash2, X } from "lucide-react";
import { useSelectionStore } from "@/store/selectionStore";
import { useAnnotationStore } from "@/store/annotationStore";
import { useBookStore } from "@/store/bookStore";
import { useDrawerStore } from "@/store/drawerStore";
import type { HighlightColor, Note } from "@/types";

const LENSES: { color: HighlightColor; label: string; dot: string }[] = [
  { color: "yellow", label: "Amber", dot: "bg-gradient-to-br from-[#fff0b8] to-[#d8b24e]" },
  { color: "blue", label: "Sapphire", dot: "bg-gradient-to-br from-[#bfe6ff] to-[#418fcb]" },
  { color: "green", label: "Verdant", dot: "bg-gradient-to-br from-[#c4f3d4] to-[#46a877]" },
  { color: "red", label: "Ember", dot: "bg-gradient-to-br from-[#ffc7b0] to-[#d56a52]" },
];

const AUTO_DISMISS_MS = 5500;

type Win = Window & {
  luminaCreateHighlight?: (color: HighlightColor) => string;
  luminaSetHighlightColor?: (id: string, color: HighlightColor) => void;
  luminaRemoveHighlight?: (id: string) => void;
};

export default function SelectionActionBar() {
  const { pending, activeHighlightId, activeColor, setActive, setColor, clear } = useSelectionStore();
  const { addNote } = useAnnotationStore();
  const { activeBook } = useBookStore();
  const { openSunburst } = useDrawerStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isActive = Boolean(activeHighlightId);
  const isPending = Boolean(pending) && !isActive;
  const visible = isActive || isPending;

  // Auto-dismiss the ACTIVE bar after a few seconds. Pending stays until acted on
  // or the selection clears (the renderer clears pending when selection collapses).
  useEffect(() => {
    if (!isActive) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => clear(), AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isActive, activeColor, clear]);

  const win = window as Win;

  // PENDING → tap a lens to create the highlight.
  const highlightAs = (color: HighlightColor) => {
    if (!pending) return;
    const id = win.luminaCreateHighlight?.(color);
    if (id) setActive(id, color);
    else clear();
  };

  // ACTIVE → recolour in place.
  const recolour = (color: HighlightColor) => {
    if (!activeHighlightId) return;
    win.luminaSetHighlightColor?.(activeHighlightId, color);
    setColor(color);
  };

  const remove = () => {
    if (!activeHighlightId) return;
    win.luminaRemoveHighlight?.(activeHighlightId);
    clear();
  };

  const addNoteToHighlight = async () => {
    if (!activeHighlightId || !activeBook) return;
    const note: Note = {
      id: `n_${Date.now()}`,
      highlightId: activeHighlightId,
      bookId: activeBook.id,
      noteText: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await addNote(note);
    clear();
    openSunburst(note, "tray");
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ type: "spring", damping: 28, stiffness: 360 }}
          className="fixed bottom-6 left-1/2 z-[58] -translate-x-1/2"
        >
          <div className="flex items-center gap-1.5 rounded-full border border-hair bg-surface-dark/95 px-2.5 py-2 shadow-2xl shadow-black/40 backdrop-blur-md">
            <span className="pl-1 pr-1 text-[11px] font-medium text-ink-faint">
              {isActive ? "Highlighted" : "Highlight"}
            </span>

            <div className="h-5 w-px bg-hair" />

            {/* Lens choices — create (pending) or recolour (active) */}
            <div className="flex items-center gap-1 px-0.5">
              {LENSES.map(({ color, label, dot }) => (
                <button
                  key={color}
                  onClick={() => (isActive ? recolour(color) : highlightAs(color))}
                  title={label}
                  aria-label={label}
                  className={`h-7 w-7 rounded-full ring-1 transition-transform hover:scale-110 active:scale-95 ${dot} ${
                    isActive && activeColor === color ? "ring-2 ring-white/70" : "ring-white/25"
                  }`}
                />
              ))}
            </div>

            {/* Refinement actions only once a highlight exists */}
            {isActive && (
              <>
                <div className="h-5 w-px bg-hair" />
                <button
                  onClick={addNoteToHighlight}
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] text-lumina-gold/85 transition-colors hover:bg-lumina-gold/12 hover:text-lumina-gold"
                >
                  <StickyNote size={13} />
                  Note
                </button>
                <button
                  onClick={remove}
                  title="Remove highlight"
                  aria-label="Remove highlight"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-rose-500/12 hover:text-rose-300"
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}

            <button
              onClick={clear}
              title="Dismiss"
              aria-label="Dismiss"
              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-ink/[0.08] hover:text-ink-soft"
            >
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
