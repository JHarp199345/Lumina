/**
 * SunburstNote — the dedicated screen for reading a single note.
 *
 * A dark radial field: the note text rests in the solid dark center; the darkness
 * fades through opaque → translucent → transparent toward the edges, so whatever is
 * behind (the reader, or the Notepad) glows faintly at the rim.
 *
 * Close behaviour is origin-aware (see PLANiv.md):
 *   origin "tray"    → opened over the reader → close returns to the reader
 *   origin "notepad" → opened over the drawer → close returns to the Notepad/Glossary
 * In both cases closing simply removes this overlay; whatever was behind is revealed.
 *
 * See PLANiv.md, "THE SUNBURST NOTE SCREEN".
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Pencil, Check, Trash2 } from "lucide-react";
import { useDrawerStore } from "@/store/drawerStore";
import { useAnnotationStore } from "@/store/annotationStore";

// Radial field: solid to ~42%, then fading to transparent at the edges.
const SUNBURST_FIELD =
  "radial-gradient(circle at 50% 44%, rgba(4,12,22,0.985) 0%, rgba(4,12,22,0.985) 40%, rgba(4,12,22,0.82) 64%, rgba(4,12,22,0.42) 82%, rgba(4,12,22,0) 100%)";

export default function SunburstNote() {
  const { sunburstNote, closeSunburst } = useDrawerStore();
  const { updateNote, removeNote, getNotesForBook } = useAnnotationStore();

  // A note opened with no text (freshly created) starts in edit mode.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!sunburstNote) return;
    setDraft(sunburstNote.noteText);
    setEditing(sunburstNote.noteText.trim().length === 0);
  }, [sunburstNote]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  if (!sunburstNote) return null;

  const save = async () => {
    await updateNote(sunburstNote.id, draft);
    setEditing(false);
  };

  const handleClose = async () => {
    if (editing && draft !== sunburstNote.noteText) {
      await updateNote(sunburstNote.id, draft);
    }
    // If the note is still empty, discard it so empty notes don't accumulate.
    const latest = getNotesForBook(sunburstNote.bookId).find((n) => n.id === sunburstNote.id);
    if (latest && latest.noteText.trim().length === 0) {
      await removeNote(sunburstNote.id);
    }
    closeSunburst();
  };

  const handleDelete = async () => {
    await removeNote(sunburstNote.id);
    closeSunburst();
  };

  const createdLabel = new Date(sunburstNote.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.32 }}
        className="fixed inset-0 z-[60] flex items-center justify-center"
        style={{ background: SUNBURST_FIELD }}
        onClick={handleClose}
      >
        {/* Controls — top right, outside the text column */}
        <div
          className="absolute right-4 top-4 flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {editing ? (
            <ControlButton label="Save" onClick={save}>
              <Check size={16} />
            </ControlButton>
          ) : (
            <ControlButton label="Edit" onClick={() => setEditing(true)}>
              <Pencil size={15} />
            </ControlButton>
          )}
          <ControlButton label="Delete note" onClick={handleDelete} danger>
            <Trash2 size={15} />
          </ControlButton>
          <ControlButton label="Close" onClick={handleClose}>
            <X size={16} />
          </ControlButton>
        </div>

        {/* Note text — in the solid central region */}
        <motion.div
          initial={{ scale: 0.98, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.06, duration: 0.3 }}
          className="w-[min(560px,86vw)] px-2"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-4 text-center text-[11px] uppercase tracking-[0.22em] text-ink-faint/70">
            {createdLabel}
          </p>

          {editing ? (
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
              }}
              placeholder="Write your thought…"
              rows={8}
              className="w-full resize-none bg-transparent text-center font-serif text-[19px] leading-[1.85] text-sky-100/90 placeholder:text-ink-faint/50 focus:outline-none"
              style={{ caretColor: "#c9a84c" }}
            />
          ) : (
            <p className="whitespace-pre-wrap text-center font-serif text-[19px] leading-[1.85] text-sky-100/90">
              {sunburstNote.noteText}
            </p>
          )}

          {editing && (
            <p className="mt-4 text-center text-[11px] text-ink-faint/60">⌘↵ to save · tap outside to close</p>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function ControlButton({
  children,
  label,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/40 backdrop-blur-sm transition-colors ${
        danger
          ? "text-rose-300/70 hover:bg-rose-500/15 hover:text-rose-200"
          : "text-ink-soft hover:bg-white/10 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
