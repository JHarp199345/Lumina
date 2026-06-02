import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { ChevronRight, BookOpen, StickyNote, Search } from "lucide-react";
import { useBookStore } from "@/store/bookStore";
import { useReaderStore } from "@/store/readerStore";
import { useAnnotationStore } from "@/store/annotationStore";
import SearchBar from "@/components/reader/SearchBar";
import type { Chapter, Highlight, Note } from "@/types";
import { formatChapterTitle } from "@/utils/chapterTitles";

interface TocPanelProps {
  /** Called after the user taps a chapter link — used by TocDrawer to close itself. */
  onNavigate?: () => void;
}

export default function TocPanel({ onNavigate }: TocPanelProps = {}) {
  const { activeBook, activeStructure } = useBookStore();
  const { currentChapterIndex } = useReaderStore();
  const { getHighlightsForBook, getNotesForBook } = useAnnotationStore();
  const [activeTab, setActiveTab] = useState<"contents" | "notes">("contents");
  const [showSearch, setShowSearch] = useState(false);

  const highlights = activeBook ? getHighlightsForBook(activeBook.id) : [];
  const notes = activeBook ? getNotesForBook(activeBook.id) : [];

  return (
    <div className="flex flex-col h-full bg-surface-dark border-r border-white/8">
      {/* Panel Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
        <span className="text-xs font-semibold tracking-widest text-white/30 uppercase flex-1">
          {activeTab === "contents" ? "Contents" : "Notes"}
        </span>
        {/* Touch targets: min 44×44px via padding */}
        <button
          onClick={() => setShowSearch(!showSearch)}
          className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg border transition-colors ${
            showSearch
              ? "border-lumina-gold/40 bg-lumina-gold/10 text-lumina-gold"
              : "border-white/10 bg-white/[0.035] text-white/35 hover:border-white/18 hover:bg-white/[0.06] hover:text-white/65"
          }`}
          title="Search"
        >
          <Search size={14} />
        </button>
        <button
          onClick={() => { setActiveTab("contents"); setShowSearch(false); }}
          className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg border transition-colors ${
            activeTab === "contents"
              ? "border-lumina-gold/40 bg-lumina-gold/10 text-lumina-gold"
              : "border-white/10 bg-white/[0.035] text-white/35 hover:border-white/18 hover:bg-white/[0.06] hover:text-white/65"
          }`}
          title="Table of Contents"
        >
          <BookOpen size={14} />
        </button>
        <button
          onClick={() => { setActiveTab("notes"); setShowSearch(false); }}
          className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg border transition-colors relative ${
            activeTab === "notes"
              ? "border-lumina-gold/40 bg-lumina-gold/10 text-lumina-gold"
              : "border-white/10 bg-white/[0.035] text-white/35 hover:border-white/18 hover:bg-white/[0.06] hover:text-white/65"
          }`}
          title="Notes & Highlights"
        >
          <StickyNote size={14} />
          {notes.length > 0 && (
            <span className="absolute top-2 right-2 w-2 h-2 bg-lumina-gold rounded-full" />
          )}
        </button>
      </div>

      {/* Search Bar */}
      <AnimatePresence>
        {showSearch && activeBook && (
          <SearchBar onClose={() => setShowSearch(false)} />
        )}
      </AnimatePresence>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!activeBook ? (
          <EmptyState />
        ) : activeTab === "contents" ? (
          <ChapterList
            chapters={activeStructure?.chapters ?? []}
            currentChapterIndex={currentChapterIndex}
            highlights={highlights}
            onNavigate={onNavigate}
          />
        ) : (
          <NotesList notes={notes} highlights={highlights} />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
      <BookOpen size={32} className="text-white/10" />
      <p className="text-xs text-white/20 leading-relaxed">
        Open a book to see its contents here.
      </p>
    </div>
  );
}

function ChapterList({
  chapters,
  currentChapterIndex,
  highlights,
  onNavigate,
}: {
  chapters: Chapter[];
  currentChapterIndex: number;
  highlights: Highlight[];
  onNavigate?: () => void;
}) {
  if (chapters.length === 0) {
    return (
      <div className="px-4 py-6">
        <p className="text-xs text-white/20">No chapters detected.</p>
      </div>
    );
  }

  return (
    <nav className="py-2">
      {chapters.map((chapter, index) => {
        const isActive = index === currentChapterIndex;
        const displayTitle = formatChapterTitle(chapter.title, index);
        const chapterHighlights = highlights.filter((h) =>
          h.cfiRange.includes(chapter.id)
        ).length;

        return (
          <button
            key={chapter.id}
            className={`w-full flex items-center gap-2 px-4 py-3 text-left transition-colors group ${
              isActive
                ? "bg-lumina-gold/10 border-l-2 border-lumina-gold"
                : "border-l-2 border-transparent hover:bg-white/5"
            }`}
            onClick={() => {
              const nav = (window as Window & { luminaNavigate?: (target: string) => void }).luminaNavigate;
              // Prefer real href for navigation; fall back to CFI if set
              const target = chapter.href || chapter.startCfi;
              if (nav && target) nav(target);
              onNavigate?.();
            }}
          >
            <ChevronRight
              size={12}
              className={isActive ? "text-lumina-gold flex-shrink-0" : "text-transparent group-hover:text-white/20 flex-shrink-0 transition-colors"}
            />

            <div className="flex-1 min-w-0">
              <p className={`text-xs leading-snug truncate ${
                isActive ? "text-white font-medium" : "text-white/50 group-hover:text-white/70"
              }`}>
                {displayTitle.title}
              </p>
              {displayTitle.eyebrow && (
                <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.16em] text-sky-100/20">
                  {displayTitle.eyebrow}
                </p>
              )}
            </div>

            {chapterHighlights > 0 && (
              <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-lumina-gold/60" />
            )}
          </button>
        );
      })}
    </nav>
  );
}

function NotesList({
  notes,
  highlights,
}: {
  notes: Note[];
  highlights: Highlight[];
}) {
  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
        <StickyNote size={28} className="text-white/10" />
        <p className="text-xs text-white/20 leading-relaxed">
          Select text while reading to add highlights and notes.
        </p>
      </div>
    );
  }

  return (
    <div className="py-2 space-y-px">
      {notes.map((note) => {
        const highlight = highlights.find((h) => h.id === note.highlightId);
        return (
          <div key={note.id} className="px-4 py-3 hover:bg-white/5 transition-colors">
            {highlight && (
              <p className="text-xs text-white/30 line-clamp-2 italic mb-1">
                "{highlight.selectedText}"
              </p>
            )}
            <p className="text-xs text-white/70 leading-relaxed">{note.noteText}</p>
          </div>
        );
      })}
    </div>
  );
}
