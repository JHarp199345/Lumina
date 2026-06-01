import { useBookStore } from "@/store/bookStore";
import { useReaderStore } from "@/store/readerStore";
import { useSettingsStore } from "@/store/settingsStore";
import { BookOpen } from "lucide-react";
import EpubRenderer from "@/components/reader/EpubRenderer";
import type { NavItem } from "epubjs";

const READING_WIDTH_CLASSES = {
  narrow: "max-w-[480px]",
  medium: "max-w-[640px]",
  wide: "max-w-[800px]",
};

export default function ReaderPanel() {
  const { activeBook, activeStructure, initialCfi, setInitialCfi } = useBookStore();
  const { currentChapterIndex, percentComplete } = useReaderStore();
  const { fontSize, lineHeight, readingWidth } = useSettingsStore();

  const currentChapter = activeStructure?.chapters[currentChapterIndex];

  return (
    <div className="flex flex-col h-full bg-surface-reader">
      {/* Chapter header */}
      {activeBook && currentChapter && (
        <div className="flex-shrink-0 px-8 pt-6 pb-4 border-b border-white/5">
          <p className="text-xs tracking-widest text-white/25 uppercase mb-1">
            {activeBook.title}
          </p>
          <h1
            className="font-serif text-white/90 leading-tight"
            style={{ fontSize: `${fontSize * 1.5}px` }}
          >
            {currentChapter.title || `Chapter ${currentChapterIndex + 1}`}
          </h1>
        </div>
      )}

      {/* EPUB Renderer */}
      <div
        className={`flex-1 overflow-hidden mx-auto w-full ${READING_WIDTH_CLASSES[readingWidth]}`}
        style={{ fontSize: `${fontSize}px`, lineHeight }}
      >
        {!activeBook ? (
          <EmptyReaderState />
        ) : (
          <EpubRenderer
            epubPath={activeBook.filePath}
            bookId={activeBook.id}
            initialCfi={initialCfi ?? undefined}
            onInitialDisplayComplete={() => setInitialCfi(null)}
            onTocReady={(_toc: NavItem[]) => {}}
          />
        )}
      </div>

      {/* Footer */}
      {activeBook && (
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-t border-white/5">
          <span className="text-xs text-white/20">
            {percentComplete > 0 ? `${Math.round(percentComplete)}%` : ""}
          </span>
          <FontSizeControl />
        </div>
      )}
    </div>
  );
}

function FontSizeControl() {
  const { fontSize, setFontSize } = useSettingsStore();

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => setFontSize(Math.max(12, fontSize - 1))}
        className="text-white/20 hover:text-white/50 transition-colors text-xs"
        title="Decrease font size"
      >
        A
      </button>
      <button
        onClick={() => setFontSize(Math.min(28, fontSize + 1))}
        className="text-white/20 hover:text-white/50 transition-colors"
        title="Increase font size"
        style={{ fontSize: "16px" }}
      >
        A
      </button>
    </div>
  );
}

function EmptyReaderState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8">
      <BookOpen size={40} className="text-white/8" />
      <div className="text-center space-y-2">
        <p className="text-white/25 font-serif text-lg">Begin your reading journey</p>
        <p className="text-white/15 text-sm">
          Import an EPUB file to start reading with symbolic visual accompaniment.
        </p>
      </div>
    </div>
  );
}
