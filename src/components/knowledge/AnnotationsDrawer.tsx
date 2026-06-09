/**
 * AnnotationsDrawer — the Knowledge Layer's right-side panel.
 *
 * A navigation hub, not a content surface. It opens to a menu of destinations
 * (Highlights → Glossary, Notes → Notepad). Each destination is its own sub-view.
 * Tapping a glossary entry closes the drawer and returns to the book at the passage.
 *
 * See PLANiv.md, "PART ONE — THE KNOWLEDGE LAYER".
 */

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  ChevronRight,
  ChevronLeft,
  Highlighter,
  NotebookPen,
  Search,
  SlidersHorizontal,
  Plus,
  StickyNote,
  WandSparkles,
  Brain,
  Headphones,
  AudioLines,
  Presentation,
} from "lucide-react";
import { useDrawerStore } from "@/store/drawerStore";
import { useAnnotationStore } from "@/store/annotationStore";
import { useBookStore } from "@/store/bookStore";
import { useReaderStore } from "@/store/readerStore";
import {
  groupHighlightsByChapter,
  groupNotesByChapter,
  type ChapterGroup,
} from "@/utils/annotationGrouping";
import type { Highlight, Note } from "@/types";
import LensStudio from "@/components/knowledge/LensStudio";
import StudyGuide from "@/components/knowledge/StudyGuide";
import VoiceStudio from "@/components/knowledge/VoiceStudio";
import AudioOverview from "@/components/knowledge/AudioOverview";
import PresentationStudio from "@/components/knowledge/PresentationStudio";

const LENS_EDGE: Record<string, string> = {
  yellow: "border-l-[#d8b24e]",
  blue: "border-l-[#418fcb]",
  green: "border-l-[#46a877]",
  red: "border-l-[#d56a52]",
};

export default function AnnotationsDrawer() {
  const { isOpen, view, close, setView } = useDrawerStore();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[55] bg-scrim backdrop-blur-[2px]"
            onClick={close}
          />

          {/* Drawer */}
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            className="fixed right-0 top-0 z-[56] flex h-full w-[min(360px,92vw)] flex-col border-l border-hair bg-surface-dark shadow-2xl shadow-black/40"
          >
            {view === "menu" && <MenuView onPick={setView} onClose={close} />}
            {view === "glossary" && (
              <GlossaryView onBack={() => setView("menu")} onClose={close} />
            )}
            {view === "notepad" && (
              <NotepadView onBack={() => setView("menu")} onClose={close} />
            )}
            {view === "lens-studio" && (
              <LensStudioView onBack={() => setView("menu")} onClose={close} />
            )}
            {view === "study-guide" && (
              <StudyGuideView onBack={() => setView("menu")} onClose={close} />
            )}
            {view === "voice-studio" && (
              <VoiceStudioView onBack={() => setView("menu")} onClose={close} />
            )}
            {view === "audio-overview" && (
              <AudioOverviewView onBack={() => setView("menu")} onClose={close} />
            )}
            {view === "presentation-studio" && (
              <PresentationStudioView onBack={() => setView("menu")} onClose={close} />
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Header ────────────────────────────────────────────────────────────────────

function DrawerHeader({
  title,
  onBack,
  onClose,
  right,
}: {
  title: string;
  onBack?: () => void;
  onClose: () => void;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-hair px-3 py-3">
      {onBack && (
        <button
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-ink/[0.06] hover:text-ink-soft"
          aria-label="Back"
        >
          <ChevronLeft size={16} />
        </button>
      )}
      <span className="flex-1 text-sm font-semibold tracking-wide text-ink/85">{title}</span>
      {right}
      <button
        onClick={onClose}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-ink/[0.06] hover:text-ink-soft"
        aria-label="Close"
      >
        <X size={15} />
      </button>
    </div>
  );
}

// ─── Menu (the navigation hub) ──────────────────────────────────────────────────

function MenuView({
  onPick,
  onClose,
}: {
  onPick: (
    v:
      | "glossary"
      | "notepad"
      | "lens-studio"
      | "study-guide"
      | "voice-studio"
      | "audio-overview"
      | "presentation-studio"
  ) => void;
  onClose: () => void;
}) {
  const { activeBook } = useBookStore();
  const { getHighlightsForBook, getNotesForBook } = useAnnotationStore();
  const highlightCount = activeBook ? getHighlightsForBook(activeBook.id).length : 0;
  const noteCount = activeBook ? getNotesForBook(activeBook.id).length : 0;

  return (
    <>
      <DrawerHeader title="Annotations" onClose={onClose} />
      <div className="flex flex-col gap-2 p-3">
        <HubButton
          icon={<Highlighter size={18} />}
          label="Highlights"
          sub="Your glossary of passages"
          count={highlightCount}
          onClick={() => onPick("glossary")}
        />
        <HubButton
          icon={<NotebookPen size={18} />}
          label="Notes"
          sub="Your notepad of thoughts"
          count={noteCount}
          onClick={() => onPick("notepad")}
        />
        <HubButton
          icon={<WandSparkles size={18} />}
          label="Lens Studio"
          sub="Design your highlight palette"
          count={0}
          onClick={() => onPick("lens-studio")}
        />
        <HubButton
          icon={<Brain size={18} />}
          label="Study Guide"
          sub="Segments, quizzes, and review"
          count={0}
          onClick={() => onPick("study-guide")}
        />
        <HubButton
          icon={<Headphones size={18} />}
          label="Voice Studio"
          sub="Narration, audio cache, and queue"
          count={0}
          onClick={() => onPick("voice-studio")}
        />
        <HubButton
          icon={<AudioLines size={18} />}
          label="Audio Overview"
          sub="Guided summaries and chapter briefings"
          count={0}
          onClick={() => onPick("audio-overview")}
        />
        <HubButton
          icon={<Presentation size={18} />}
          label="Presentation Studio"
          sub="Slides from the book, guide, and notes"
          count={0}
          onClick={() => onPick("presentation-studio")}
        />
      </div>
      <div className="mt-auto px-4 py-4">
        <p className="text-[11px] leading-relaxed text-ink-faint">
          Highlight any passage while reading to build your glossary. Add notes to capture
          the thoughts a passage inspires.
        </p>
      </div>
    </>
  );
}

function LensStudioView({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  return (
    <>
      <DrawerHeader title="Lens Studio" onBack={onBack} onClose={onClose} />
      <LensStudio />
    </>
  );
}

function StudyGuideView({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  return (
    <>
      <DrawerHeader title="Study Guide" onBack={onBack} onClose={onClose} />
      <StudyGuide />
    </>
  );
}

function VoiceStudioView({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  return (
    <>
      <DrawerHeader title="Voice Studio" onBack={onBack} onClose={onClose} />
      <VoiceStudio />
    </>
  );
}

function AudioOverviewView({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  return (
    <>
      <DrawerHeader title="Audio Overview" onBack={onBack} onClose={onClose} />
      <AudioOverview />
    </>
  );
}

function PresentationStudioView({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  return (
    <>
      <DrawerHeader title="Presentation Studio" onBack={onBack} onClose={onClose} />
      <PresentationStudio />
    </>
  );
}

function UnderConstructionView({
  icon,
  label,
  text,
  points,
}: {
  icon: React.ReactNode;
  label: string;
  text: string;
  points: string[];
}) {
  return (
    <div className="flex flex-1 flex-col p-4">
      <div className="rounded-2xl border border-lumina-gold/25 bg-lumina-gold/[0.05] p-4 shadow-inner shadow-white/[0.02]">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-lumina-gold/25 bg-lumina-gold/[0.08] text-lumina-gold">
            {icon}
          </span>
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-lumina-gold/75">Under Construction</p>
            <h3 className="text-base font-semibold text-ink/90">{label}</h3>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">{text}</p>
        <div className="mt-4 grid gap-2">
          {points.map((point) => (
            <div key={point} className="rounded-lg border border-hair bg-ink/[0.025] px-3 py-2 text-xs text-ink-faint">
              {point}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
        This endpoint is reserved in the drawer so the feature map can grow without moving the reader's controls around later.
      </p>
    </div>
  );
}

function HubButton({
  icon,
  label,
  sub,
  count,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3 rounded-xl border border-hair bg-ink/[0.03] px-4 py-3.5 text-left transition-colors hover:border-lumina-gold/30 hover:bg-lumina-gold/[0.06]"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink/[0.05] text-lumina-gold/85 group-hover:bg-lumina-gold/12">
        {icon}
      </span>
      <span className="flex-1">
        <span className="block text-sm font-medium text-ink/85">{label}</span>
        <span className="block text-[11px] text-ink-faint">{sub}</span>
      </span>
      {count > 0 && (
        <span className="rounded-full bg-ink/[0.07] px-2 py-0.5 text-[11px] text-ink-soft">
          {count}
        </span>
      )}
      <ChevronRight size={15} className="text-ink-faint transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

// ─── Glossary (Highlights) ──────────────────────────────────────────────────────

function GlossaryView({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const { activeBook, activeStructure } = useBookStore();
  const { getHighlightsForBook, getNoteForHighlight } = useAnnotationStore();
  const { close, openSunburst } = useDrawerStore();
  const [query, setQuery] = useState("");
  const [highlightedOnly, setHighlightedOnly] = useState(true);
  const [showFilter, setShowFilter] = useState(false);

  const allHighlights = activeBook ? getHighlightsForBook(activeBook.id) : [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allHighlights;
    return allHighlights.filter((h) => h.selectedText.toLowerCase().includes(q));
  }, [allHighlights, query]);

  const groups = useMemo(
    () => groupHighlightsByChapter(filtered, activeStructure),
    [filtered, activeStructure]
  );

  const navigateTo = (h: Highlight) => {
    const nav = (window as Window & { luminaNavigate?: (t: string) => void }).luminaNavigate;
    const target = h.locator || h.cfiRange; // structured locator first, else EPUB CFI
    if (nav && target) nav(target);
    close(); // glossary entry tap closes the drawer and returns to the book
  };

  return (
    <>
      <DrawerHeader title="Glossary" onBack={onBack} onClose={onClose} />

      {/* Search + filter */}
      <div className="border-b border-hair px-3 py-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-hair bg-black/20 px-2.5 py-1.5">
          <Search size={13} className="text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search highlights…"
            className="flex-1 bg-transparent text-xs text-ink-soft placeholder:text-ink-faint focus:outline-none"
          />
          <button
            onClick={() => setShowFilter((v) => !v)}
            className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
              showFilter || !highlightedOnly
                ? "bg-lumina-gold/15 text-lumina-gold"
                : "text-ink-faint hover:bg-ink/[0.06] hover:text-ink-soft"
            }`}
            aria-label="Filters"
            title="Filters"
          >
            <SlidersHorizontal size={13} />
          </button>
        </div>

        <AnimatePresence>
          {showFilter && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <label className="mt-2 flex items-center justify-between rounded-lg bg-ink/[0.03] px-3 py-2 text-xs text-ink-soft">
                Highlighted passages only
                <input
                  type="checkbox"
                  checked={highlightedOnly}
                  onChange={(e) => setHighlightedOnly(e.target.checked)}
                  className="accent-lumina-gold"
                />
              </label>
              <p className="mt-1 px-1 text-[10px] text-ink-faint">
                More filters (by lens colour, by date) arrive here later.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {allHighlights.length === 0 ? (
          <EmptyState
            icon={<Highlighter size={26} />}
            text="Highlight any passage while reading, and it will appear here."
          />
        ) : groups.length === 0 ? (
          <EmptyState icon={<Search size={24} />} text="No highlights match your search." />
        ) : (
          <div className="py-1">
            {groups.map((group) => (
              <ChapterSection key={group.chapterIndex} group={group}>
                {group.items.map((h) => {
                  const note = getNoteForHighlight(h.id);
                  return (
                    <HighlightCard
                      key={h.id}
                      highlight={h}
                      hasNote={Boolean(note)}
                      onNavigate={() => navigateTo(h)}
                      onOpenNote={note ? () => openSunburst(note, "tray") : undefined}
                    />
                  );
                })}
              </ChapterSection>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ChapterSection<T>({
  group,
  children,
}: {
  group: ChapterGroup<T>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="px-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-2 text-left"
      >
        <ChevronRight
          size={12}
          className={`text-ink-faint transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
          {group.chapterTitle}
        </span>
        <span className="text-[11px] text-ink-faint">{group.items.length}</span>
      </button>
      {open && <div className="space-y-1 pb-2">{children}</div>}
    </div>
  );
}

function HighlightCard({
  highlight,
  hasNote,
  onNavigate,
  onOpenNote,
}: {
  highlight: Highlight;
  hasNote: boolean;
  onNavigate: () => void;
  onOpenNote?: () => void;
}) {
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border border-hair border-l-2 bg-ink/[0.02] py-2 pl-2.5 pr-2 transition-colors hover:bg-ink/[0.05] ${
        LENS_EDGE[highlight.color] ?? LENS_EDGE.yellow
      }`}
    >
      <button onClick={onNavigate} className="flex-1 text-left">
        <p className="line-clamp-3 text-xs leading-relaxed text-ink-soft">
          “{highlight.selectedText}”
        </p>
      </button>
      {onOpenNote && (
        <button
          onClick={onOpenNote}
          title="Open note"
          className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-lumina-gold/70 transition-colors hover:bg-lumina-gold/12 hover:text-lumina-gold"
        >
          <StickyNote size={13} />
        </button>
      )}
    </div>
  );
}

// ─── Notepad (Notes) ────────────────────────────────────────────────────────────

function NotepadView({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const { activeBook, activeStructure } = useBookStore();
  const { getNotesForBook, getHighlightsForBook, addNote } = useAnnotationStore();
  const { currentChapterIndex } = useReaderStore();
  const { openSunburst } = useDrawerStore();
  const [query, setQuery] = useState("");
  const [grouping, setGrouping] = useState<"chapter" | "time">("chapter");

  const notes = activeBook ? getNotesForBook(activeBook.id) : [];
  const highlights = activeBook ? getHighlightsForBook(activeBook.id) : [];
  const highlightById = useMemo(
    () => new Map(highlights.map((h) => [h.id, h])),
    [highlights]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.noteText.toLowerCase().includes(q) ||
        (n.highlightId && highlightById.get(n.highlightId)?.selectedText.toLowerCase().includes(q))
    );
  }, [notes, query, highlightById]);

  const createNote = async () => {
    if (!activeBook) return;
    const note: Note = {
      id: `n_${Date.now()}`,
      highlightId: "",
      bookId: activeBook.id,
      noteText: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await addNote(note);
    openSunburst(note, "notepad");
  };

  return (
    <>
      <DrawerHeader
        title="Notepad"
        onBack={onBack}
        onClose={onClose}
        right={
          <button
            onClick={createNote}
            title="New note"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-lumina-gold/80 transition-colors hover:bg-lumina-gold/12 hover:text-lumina-gold"
          >
            <Plus size={16} />
          </button>
        }
      />

      {/* Search + grouping toggle */}
      <div className="space-y-2 border-b border-hair px-3 py-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-hair bg-black/20 px-2.5 py-1.5">
          <Search size={13} className="text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            className="flex-1 bg-transparent text-xs text-ink-soft placeholder:text-ink-faint focus:outline-none"
          />
        </div>
        <div className="flex overflow-hidden rounded-lg border border-hair text-[11px]">
          <SegButton active={grouping === "chapter"} onClick={() => setGrouping("chapter")}>
            By Chapter
          </SegButton>
          <SegButton active={grouping === "time"} onClick={() => setGrouping("time")}>
            By Time
          </SegButton>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {notes.length === 0 ? (
          <EmptyState
            icon={<NotebookPen size={26} />}
            text="No notes yet. Tap + to write a thought, or add a note to a highlight."
          />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Search size={24} />} text="No notes match your search." />
        ) : grouping === "chapter" ? (
          <div className="py-1">
            {groupNotesByChapter(filtered, highlights, activeStructure).map((group) => (
              <ChapterSection key={group.chapterIndex} group={group}>
                {group.items.map((n) => (
                  <NoteCard
                    key={n.id}
                    note={n}
                    source={n.highlightId ? highlightById.get(n.highlightId) : undefined}
                    onOpen={() => openSunburst(n, "notepad")}
                  />
                ))}
              </ChapterSection>
            ))}
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {[...filtered]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((n) => (
                <NoteCard
                  key={n.id}
                  note={n}
                  source={n.highlightId ? highlightById.get(n.highlightId) : undefined}
                  onOpen={() => openSunburst(n, "notepad")}
                />
              ))}
          </div>
        )}
      </div>
    </>
  );
}

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-1.5 transition-colors ${
        active ? "bg-lumina-gold/15 text-lumina-gold" : "text-ink-faint hover:bg-ink/[0.05]"
      }`}
    >
      {children}
    </button>
  );
}

function NoteCard({
  note,
  source,
  onOpen,
}: {
  note: Note;
  source?: Highlight;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className={`block w-full rounded-lg border border-hair bg-ink/[0.02] px-3 py-2.5 text-left transition-colors hover:bg-ink/[0.05] ${
        source ? `border-l-2 ${LENS_EDGE[source.color] ?? LENS_EDGE.yellow}` : ""
      }`}
    >
      {source ? (
        <p className="mb-1 line-clamp-1 text-[11px] italic text-ink-faint">“{source.selectedText}”</p>
      ) : (
        <p className="mb-1 text-[11px] uppercase tracking-[0.1em] text-ink-faint">written here</p>
      )}
      <p className="line-clamp-2 text-xs leading-relaxed text-ink-soft">
        {note.noteText.trim() || <span className="italic text-ink-faint">Empty note — tap to write…</span>}
      </p>
    </button>
  );
}

// ─── Shared ──────────────────────────────────────────────────────────────────────

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <span className="text-ink/15">{icon}</span>
      <p className="text-xs leading-relaxed text-ink-faint">{text}</p>
    </div>
  );
}
