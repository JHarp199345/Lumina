/**
 * StudyGuide — PLANv Phase 2 (Segment Map).
 *
 * A deliberate, opt-in comprehension layer reached from the Feature Drawer.
 * Phase 1 was the shell. Phase 2 makes Generate Guide real: it builds a
 * heuristic segment map from the parsed book (offline, no AI), persists it as a
 * book-scoped artifact, and renders the segments as a clean list.
 *
 * NOTHING runs automatically — the reader opens this drawer and clicks Generate.
 * The reader asks; Lumina responds.
 */

import { useState } from "react";
import { Brain, Sparkles, BookOpen, RefreshCw, CheckCircle2, Circle } from "lucide-react";
import { useBookStore } from "@/store/bookStore";
import { useStudyStore } from "@/store/studyStore";
import { useReaderStore } from "@/store/readerStore";
import { storage } from "@/storage";
import {
  buildHeuristicStudyGuide,
  STUDY_GUIDE_PROGRESS_STEPS,
} from "@/pipeline/studySegmenter";
import type { StudySegment } from "@/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function StudyGuide() {
  const { activeBook, activeStructure } = useBookStore();
  const { guide, isGenerating, progressMessage, mount, setIsGenerating, setProgress } =
    useStudyStore();
  const wordPosition = useReaderStore((s) => s.wordPosition);
  const [error, setError] = useState<string | null>(null);

  // No book open — nothing to study yet.
  if (!activeBook) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-hair bg-ink/[0.04] text-ink-faint">
          <BookOpen size={20} />
        </span>
        <p className="text-sm text-ink-soft">Open a book to build a study guide.</p>
      </div>
    );
  }

  const runGenerate = async () => {
    if (!activeStructure) {
      setError("The book is still loading its structure. Try again in a moment.");
      return;
    }
    setError(null);
    setIsGenerating(true);
    try {
      // Walk the gentle progress beats so the moment feels deliberate, then do
      // the real (instant) heuristic pass right before saving.
      for (const step of STUDY_GUIDE_PROGRESS_STEPS) {
        setProgress(step);
        await sleep(280);
      }
      const built = buildHeuristicStudyGuide(activeStructure);
      await storage.saveStudyGuide(built);
      mount(activeBook.id, built);
    } catch (err) {
      console.error("[StudyGuide] Generation failed:", err);
      setError(err instanceof Error ? err.message : "Could not build the study guide.");
      setIsGenerating(false);
    }
  };

  // ── Generating: progress UI ────────────────────────────────────────────────
  if (isGenerating) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <span className="flex h-12 w-12 animate-pulse items-center justify-center rounded-xl border border-lumina-gold/20 bg-lumina-gold/[0.06] text-lumina-gold/80">
          <Brain size={22} />
        </span>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-ink/85">Building your study guide</p>
          <p className="text-xs text-ink-faint">{progressMessage || "Working…"}</p>
        </div>
      </div>
    );
  }

  // ── Guide exists: segment list ─────────────────────────────────────────────
  if (guide && guide.bookId === activeBook.id) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-hair px-4 py-3">
          <div>
            <p className="text-sm font-medium text-ink/85">Study Segments</p>
            <p className="text-[11px] text-ink-faint">
              {guide.segments.length} segment{guide.segments.length === 1 ? "" : "s"}
              {guide.source === "heuristic" ? " · draft map" : " · refined"}
            </p>
          </div>
          <button
            onClick={runGenerate}
            title="Rebuild the segment map"
            className="flex items-center gap-1.5 rounded-lg border border-hair px-2.5 py-1.5 text-[11px] text-ink-faint transition-colors hover:text-ink-soft"
          >
            <RefreshCw size={12} />
            Rebuild
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3 scrollbar-thin">
          {guide.segments.map((segment) => (
            <SegmentRow key={segment.id} segment={segment} reached={wordPosition >= segment.approxWordStart} />
          ))}
        </div>
      </div>
    );
  }

  // ── Empty state — the reader must explicitly choose to generate. ───────────
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-lumina-gold/20 bg-lumina-gold/[0.06] text-lumina-gold/80">
        <Brain size={22} />
      </span>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-ink/85">No Study Guide Yet</p>
        <p className="max-w-xs text-xs leading-relaxed text-ink-faint">
          Generate a guide to divide this book into readable study segments.
        </p>
      </div>
      <button
        onClick={runGenerate}
        className="flex items-center gap-2 rounded-lg border border-lumina-gold/30 bg-lumina-gold/10 px-4 py-2.5 text-xs font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/15 hover:text-lumina-gold"
      >
        <Sparkles size={14} />
        Generate Guide
      </button>
      {error && <p className="max-w-xs text-[11px] text-rose-400/80">{error}</p>}
    </div>
  );
}

/** A single segment row: title, length, quiz-worthiness, reached/not-reached. */
function SegmentRow({ segment, reached }: { segment: StudySegment; reached: boolean }) {
  const minutes = Math.max(1, Math.round(segment.wordCount / 220));
  return (
    <div className="rounded-xl border border-hair bg-ink/[0.02] px-3.5 py-3 transition-colors hover:border-hair hover:bg-ink/[0.04]">
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-0.5 shrink-0 ${reached ? "text-lumina-gold/70" : "text-ink-faint/50"}`}
          title={reached ? "You've reached this segment" : "Not yet reached"}
        >
          {reached ? <CheckCircle2 size={15} /> : <Circle size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink/85">{segment.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
            <span>{segment.wordCount.toLocaleString()} words</span>
            <span aria-hidden>·</span>
            <span>~{minutes} min</span>
            {segment.quizWorthy ? (
              <>
                <span aria-hidden>·</span>
                <span className="text-lumina-gold/60">quiz-ready</span>
              </>
            ) : (
              <>
                <span aria-hidden>·</span>
                <span className="text-ink-faint/60">transitional</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
