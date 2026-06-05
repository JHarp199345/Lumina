import { useBookStore } from "@/store/bookStore";
import { useReaderStore } from "@/store/readerStore";
import { useSettingsStore } from "@/store/settingsStore";
import { BookOpen, ChevronLeft, ChevronRight, FolderOpen } from "lucide-react";
import EpubRenderer from "@/components/reader/EpubRenderer";
import StructuredTextRenderer from "@/components/reader/StructuredTextRenderer";
import ChapterHeader from "@/components/reader/ChapterHeader";
import { isWeb } from "@/utils/runtime";

const READING_WIDTH_CLASSES = {
  narrow: "max-w-[480px]",
  medium: "max-w-[640px]",
  wide: "max-w-[800px]",
};

interface ReaderPanelProps {
  onImport?: () => void;
}

export default function ReaderPanel({ onImport }: ReaderPanelProps) {
  const { activeBook, activeStructure, initialCfi, setInitialCfi } = useBookStore();
  const { currentChapterIndex, percentComplete } = useReaderStore();
  const { fontSize, lineHeight, readingWidth } = useSettingsStore();

  const currentChapter = activeStructure?.chapters[currentChapterIndex];

  return (
    <div className="reader-paper-surface flex flex-col h-full bg-reader">
      {/* Chapter header — animated, hierarchy-aware */}
      {activeBook && currentChapter && (
        <ChapterHeader
          title={currentChapter.title}
          bookTitle={activeBook.title}
          chapterIndex={currentChapterIndex}
          fontSize={fontSize}
        />
      )}

      {/* EPUB Renderer */}
      <div
        className={`flex-1 overflow-hidden mx-auto w-full ${READING_WIDTH_CLASSES[readingWidth]}`}
        style={{ fontSize: `${fontSize}px`, lineHeight }}
      >
        {!activeBook ? (
          <EmptyReaderState onImport={onImport} />
        ) : isWeb ? (
          <StructuredTextRenderer
            initialCfi={initialCfi ?? undefined}
            onInitialDisplayComplete={() => setInitialCfi(null)}
          />
        ) : (
          <EpubRenderer
            epubPath={activeBook.filePath}
            bookId={activeBook.id}
            initialCfi={initialCfi ?? undefined}
            onInitialDisplayComplete={() => setInitialCfi(null)}
          />
        )}
      </div>

      {/* Footer */}
      {activeBook && (
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-t border-hair bg-ink/[0.03]">
          <span className="text-xs text-ink-faint">
            {percentComplete > 0 ? `${Math.round(percentComplete)}%` : ""}
          </span>
          <div className="flex items-center gap-2">
            <PageTurnControls />
            <FontSizeControl />
          </div>
        </div>
      )}
    </div>
  );
}

function PageTurnControls() {
  const turnPage = (direction: "prev" | "next") => {
    const win = window as Window & {
      luminaPrevPage?: () => void;
      luminaNextPage?: () => void;
    };
    if (direction === "prev") win.luminaPrevPage?.();
    else win.luminaNextPage?.();
  };

  return (
    <div className="flex items-center gap-1 border-r border-hair pr-2">
      <button
        onClick={() => turnPage("prev")}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-faint hover:text-ink-soft active:text-ink transition-colors"
        title="Previous page"
        aria-label="Previous page"
      >
        <ChevronLeft size={17} />
      </button>
      <button
        onClick={() => turnPage("next")}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-faint hover:text-ink-soft active:text-ink transition-colors"
        title="Next page"
        aria-label="Next page"
      >
        <ChevronRight size={17} />
      </button>
    </div>
  );
}

function FontSizeControl() {
  const { fontSize, setFontSize } = useSettingsStore();

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setFontSize(Math.max(12, fontSize - 1))}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-faint hover:text-ink-soft active:text-ink transition-colors text-xs select-none"
        title="Decrease font size"
      >
        A
      </button>
      <button
        onClick={() => setFontSize(Math.min(28, fontSize + 1))}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-faint hover:text-ink-soft active:text-ink transition-colors select-none"
        title="Increase font size"
        style={{ fontSize: "16px" }}
      >
        A
      </button>
    </div>
  );
}

function EmptyReaderState({ onImport }: { onImport?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8">
      <div className="w-16 h-16 rounded-xl border border-hair bg-white/[0.035] flex items-center justify-center">
        <BookOpen size={34} className="text-ink/16" />
      </div>
      <div className="text-center space-y-2 max-w-sm">
        <p className="text-ink-faint font-serif text-lg">Begin your reading journey</p>
        <p className="text-ink-faint text-sm">
          Import an EPUB file to start reading with symbolic visual accompaniment.
        </p>
      </div>
      {onImport && (
        <button
          type="button"
          onClick={onImport}
          className="min-h-[44px] rounded-lg border border-lumina-gold/30 bg-lumina-gold/10 px-4 text-sm text-lumina-gold/90 transition-colors hover:bg-lumina-gold/15 hover:text-lumina-gold active:bg-lumina-gold/20 flex items-center gap-2"
        >
          <FolderOpen size={16} />
          Open Book
        </button>
      )}
    </div>
  );
}
