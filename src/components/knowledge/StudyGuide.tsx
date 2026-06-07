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
import {
  Brain,
  Sparkles,
  BookOpen,
  RefreshCw,
  CheckCircle2,
  Circle,
  Wand2,
  ListChecks,
  X,
  Lock,
} from "lucide-react";
import { useBookStore } from "@/store/bookStore";
import { useStudyStore } from "@/store/studyStore";
import { useReaderStore } from "@/store/readerStore";
import { storage } from "@/storage";
import {
  buildHeuristicStudyGuide,
  STUDY_GUIDE_PROGRESS_STEPS,
} from "@/pipeline/studySegmenter";
import { refineStudyGuide } from "@/pipeline/studyRefiner";
import {
  groupSegmentsByChapter,
  isBookComplete,
  isChapterReached,
  isSegmentReached,
  type StudyChapterGroup,
} from "@/utils/studyProgress";
import type { StudyGuide, StudySegment } from "@/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type QuizMode = "segment" | "chapter" | "book";

export default function StudyGuide() {
  const { activeBook, activeStructure } = useBookStore();
  const { guide, isGenerating, progressMessage, mount, setIsGenerating, setProgress } =
    useStudyStore();
  const wordPosition = useReaderStore((s) => s.wordPosition);
  const [error, setError] = useState<string | null>(null);
  const [showQuizSelector, setShowQuizSelector] = useState(false);

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

  const runRefine = async () => {
    if (!guide || !activeStructure) return;
    setError(null);
    const apiKey = await storage.loadApiKey("lumina_google_ai_key");
    if (!apiKey) {
      setError("Add a Google AI key in Settings to refine these segments with AI.");
      return;
    }
    setIsGenerating(true);
    try {
      const refined = await refineStudyGuide(guide, activeStructure, apiKey, (p) =>
        setProgress(p.message)
      );
      await storage.saveStudyGuide(refined);
      mount(activeBook.id, refined);
    } catch (err) {
      console.error("[StudyGuide] Refinement failed:", err);
      setError(err instanceof Error ? err.message : "AI refinement failed. The draft map is unchanged.");
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
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowQuizSelector(true)}
              title="Choose what part of the book to quiz"
              className="flex items-center gap-1.5 rounded-lg border border-lumina-gold/30 bg-lumina-gold/10 px-2.5 py-1.5 text-[11px] font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/15"
            >
              <ListChecks size={12} />
              Quizzes
            </button>
            {guide.source === "heuristic" ? (
              <button
                onClick={runRefine}
                title="Use AI to name and summarise these segments"
                className="flex items-center gap-1.5 rounded-lg border border-lumina-gold/30 bg-lumina-gold/10 px-2.5 py-1.5 text-[11px] font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/15"
              >
                <Wand2 size={12} />
                Refine with AI
              </button>
            ) : (
              <span className="flex items-center gap-1 rounded-lg border border-lumina-gold/20 px-2 py-1 text-[10px] text-lumina-gold/70">
                <Sparkles size={10} />
                Refined
              </span>
            )}
            <button
              onClick={runGenerate}
              title="Rebuild the draft segment map from scratch"
              className="flex items-center gap-1.5 rounded-lg border border-hair px-2.5 py-1.5 text-[11px] text-ink-faint transition-colors hover:text-ink-soft"
            >
              <RefreshCw size={12} />
              Rebuild
            </button>
          </div>
        </div>

        {error && (
          <p className="border-b border-hair px-4 py-2 text-[11px] text-rose-400/80">{error}</p>
        )}

        {showQuizSelector && (
          <QuizSelector
            guide={guide}
            wordPosition={wordPosition}
            onClose={() => setShowQuizSelector(false)}
          />
        )}

        <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3 scrollbar-thin">
          {guide.segments.map((segment) => (
            <SegmentRow key={segment.id} segment={segment} reached={isSegmentReached(segment, wordPosition)} />
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

function QuizSelector({
  guide,
  wordPosition,
  onClose,
}: {
  guide: StudyGuide;
  wordPosition: number;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<QuizMode>("segment");
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [selectedChapterIndex, setSelectedChapterIndex] = useState<number | null>(null);
  const [allowSpoilers, setAllowSpoilers] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const quizSegments = guide.segments.filter((segment) => segment.quizWorthy);
  const chapters = groupSegmentsByChapter(guide).filter((chapter) => chapter.quizWorthy);
  const selectedSegment = quizSegments.find((segment) => segment.id === selectedSegmentId) ?? null;
  const selectedChapter = chapters.find((chapter) => chapter.chapterIndex === selectedChapterIndex) ?? null;
  const bookComplete = isBookComplete(guide, wordPosition);

  const canGenerate =
    mode === "segment"
      ? Boolean(selectedSegment && isSegmentReached(selectedSegment, wordPosition))
      : mode === "chapter"
        ? Boolean(selectedChapter && isChapterReached(selectedChapter, wordPosition))
        : bookComplete || allowSpoilers;

  const targetLabel =
    mode === "segment"
      ? selectedSegment?.title ?? "Choose a segment"
      : mode === "chapter"
        ? selectedChapter?.chapterTitle ?? "Choose a chapter"
        : "Whole Book Review";

  const questionRange =
    mode === "segment" ? "3-5 questions" : mode === "chapter" ? "5-10 questions" : "8-12 questions";

  const handleGenerate = () => {
    if (!canGenerate) return;
    setNotice("Quiz generation is the next build phase. This selector is ready for it.");
  };

  return (
    <div className="border-b border-hair bg-surface-dark/96 px-3 py-3 shadow-inner">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-lumina-gold/75">
            Quiz Selector
          </p>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            Choose the scope before generating a quiz.
          </p>
        </div>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-ink/[0.06] hover:text-ink-soft"
          aria-label="Close quiz selector"
        >
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-lg border border-hair bg-black/16 p-1">
        {(["segment", "chapter", "book"] as const).map((item) => (
          <button
            key={item}
            onClick={() => {
              setMode(item);
              setNotice(null);
            }}
            className={`rounded-md px-2 py-2 text-[10px] font-medium uppercase tracking-[0.1em] transition-colors ${
              mode === item
                ? "bg-lumina-gold/14 text-lumina-gold/90"
                : "text-ink-faint hover:text-ink-soft"
            }`}
          >
            {item === "book" ? "Book" : item}
          </button>
        ))}
      </div>

      <div className="mt-3 max-h-56 overflow-y-auto pr-1 scrollbar-thin">
        {mode === "segment" && (
          <div className="space-y-1.5">
            {quizSegments.map((segment) => (
              <TargetButton
                key={segment.id}
                title={segment.title}
                subtitle={segment.summary || `${segment.wordCount.toLocaleString()} words`}
                active={selectedSegmentId === segment.id}
                locked={!isSegmentReached(segment, wordPosition)}
                onClick={() => {
                  setSelectedSegmentId(segment.id);
                  setNotice(null);
                }}
              />
            ))}
          </div>
        )}

        {mode === "chapter" && (
          <div className="space-y-1.5">
            {chapters.map((chapter) => (
              <TargetButton
                key={chapter.chapterIndex}
                title={chapter.chapterTitle}
                subtitle={`${chapter.segments.length} segment${chapter.segments.length === 1 ? "" : "s"}`}
                active={selectedChapterIndex === chapter.chapterIndex}
                locked={!isChapterReached(chapter, wordPosition)}
                onClick={() => {
                  setSelectedChapterIndex(chapter.chapterIndex);
                  setNotice(null);
                }}
              />
            ))}
          </div>
        )}

        {mode === "book" && (
          <div className="rounded-xl border border-hair bg-ink/[0.025] px-3 py-3">
            <p className="text-[13px] font-medium text-ink/85">Whole Book Review</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
              High-level comprehension chains focused on causation, callbacks,
              consequences, and theme.
            </p>
            {!bookComplete && (
              <label className="mt-3 flex items-start gap-2 rounded-lg border border-hair bg-black/12 px-2.5 py-2 text-[11px] leading-relaxed text-ink-faint">
                <input
                  type="checkbox"
                  checked={allowSpoilers}
                  onChange={(e) => {
                    setAllowSpoilers(e.target.checked);
                    setNotice(null);
                  }}
                  className="mt-0.5 accent-lumina-gold"
                />
                Allow whole-book spoilers before finishing.
              </label>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 rounded-xl border border-hair bg-ink/[0.025] px-3 py-3">
        <p className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Selected</p>
        <p className="mt-1 text-sm font-medium text-ink/85">{targetLabel}</p>
        <p className="mt-1 text-[11px] text-ink-faint">{questionRange}</p>
        {!canGenerate && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-faint">
            <Lock size={12} className="mt-0.5 shrink-0" />
            {mode === "book"
              ? "Finish the book or allow spoilers to unlock this quiz."
              : "Read past this selection before generating its quiz."}
          </p>
        )}
      </div>

      {notice && <p className="mt-2 text-[11px] leading-relaxed text-lumina-gold/70">{notice}</p>}

      <button
        onClick={handleGenerate}
        disabled={!canGenerate}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-lumina-gold/30 bg-lumina-gold/10 px-4 py-2.5 text-xs font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/15 disabled:cursor-default disabled:border-hair disabled:bg-ink/[0.03] disabled:text-ink-faint"
      >
        <Sparkles size={14} />
        Generate Quiz
      </button>
    </div>
  );
}

function TargetButton({
  title,
  subtitle,
  active,
  locked,
  onClick,
}: {
  title: string;
  subtitle: string;
  active: boolean;
  locked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
        active
          ? "border-lumina-gold/45 bg-lumina-gold/[0.07]"
          : "border-hair bg-ink/[0.025] hover:bg-ink/[0.045]"
      }`}
    >
      <span className={locked ? "mt-0.5 text-ink-faint/60" : "mt-0.5 text-lumina-gold/70"}>
        {locked ? <Lock size={13} /> : <CheckCircle2 size={13} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-ink/85">{title}</span>
        <span className="mt-0.5 line-clamp-2 block text-[10px] leading-relaxed text-ink-faint">
          {subtitle}
        </span>
      </span>
    </button>
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
          <p className="text-[13px] font-medium leading-snug text-ink/85">{segment.title}</p>
          {segment.summary && (
            <p className="mt-1 text-[11px] leading-relaxed text-ink-soft/80">{segment.summary}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
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
            {segment.spoilerLevel === "high" && (
              <>
                <span aria-hidden>·</span>
                <span className="text-rose-400/60">spoiler-heavy</span>
              </>
            )}
          </div>
          {segment.concepts && segment.concepts.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {segment.concepts.map((c) => (
                <span
                  key={c}
                  className="rounded-md border border-hair bg-ink/[0.03] px-1.5 py-0.5 text-[10px] text-ink-faint"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
