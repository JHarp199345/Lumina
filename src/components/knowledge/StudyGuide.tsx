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

import { useEffect, useState } from "react";
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
  Trophy,
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
import { generateChapterQuiz, generateSegmentQuiz, generateWholeBookQuiz } from "@/pipeline/studyQuizzer";
import {
  groupSegmentsByChapter,
  isBookComplete,
  isChapterReached,
  isSegmentReached,
  type StudyChapterGroup,
} from "@/utils/studyProgress";
import type { BookStructure, StudyBadgeAward, StudyGuide, StudyQuiz, StudyQuizAttempt, StudySegment } from "@/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type QuizMode = "segment" | "chapter" | "book";

export default function StudyGuide() {
  const { activeBook, activeStructure } = useBookStore();
  const { guide, isGenerating, progressMessage, mount, setIsGenerating, setProgress } =
    useStudyStore();
  const wordPosition = useReaderStore((s) => s.wordPosition);
  const [error, setError] = useState<string | null>(null);
  const [showQuizSelector, setShowQuizSelector] = useState(false);
  const [quizzes, setQuizzes] = useState<StudyQuiz[]>([]);
  const [attempts, setAttempts] = useState<StudyQuizAttempt[]>([]);
  const [badges, setBadges] = useState<StudyBadgeAward[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!activeBook) {
      setQuizzes([]);
      setAttempts([]);
      setBadges([]);
      return;
    }
    Promise.all([
      storage.loadStudyQuizzes(activeBook.id).catch(() => [] as StudyQuiz[]),
      storage.loadStudyQuizAttempts(activeBook.id).catch(() => [] as StudyQuizAttempt[]),
      storage.loadStudyBadgeAwards(activeBook.id).catch(() => [] as StudyBadgeAward[]),
    ]).then(([loadedQuizzes, loadedAttempts, loadedBadges]) => {
      if (cancelled) return;
      setQuizzes(loadedQuizzes);
      setAttempts(loadedAttempts);
      setBadges(loadedBadges);
    });
    return () => {
      cancelled = true;
    };
  }, [activeBook?.id]);

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
            activeStructure={activeStructure}
            wordPosition={wordPosition}
            quizzes={quizzes}
            attempts={attempts}
            badges={badges}
            onQuizSaved={(quiz) => setQuizzes((current) => [...current.filter((q) => q.id !== quiz.id), quiz])}
            onAttemptSaved={(attempt) => setAttempts((current) => [...current, attempt])}
            onBadgeSaved={(badge) => setBadges((current) => [...current.filter((b) => b.id !== badge.id), badge])}
            onClose={() => setShowQuizSelector(false)}
          />
        )}

        {badges.length > 0 && (
          <div className="border-b border-hair px-3 py-2">
            <div className="flex gap-1.5 overflow-x-auto scrollbar-thin">
              {badges.map((badge) => (
                <span
                  key={badge.id}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-lumina-gold/24 bg-lumina-gold/[0.06] px-2.5 py-1 text-[10px] text-lumina-gold/75"
                  title={`${badge.label} · ${badge.score}%`}
                >
                  <Trophy size={11} />
                  {badge.label}
                </span>
              ))}
            </div>
          </div>
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
  activeStructure,
  wordPosition,
  quizzes,
  attempts,
  badges,
  onQuizSaved,
  onAttemptSaved,
  onBadgeSaved,
  onClose,
}: {
  guide: StudyGuide;
  activeStructure: BookStructure | null;
  wordPosition: number;
  quizzes: StudyQuiz[];
  attempts: StudyQuizAttempt[];
  badges: StudyBadgeAward[];
  onQuizSaved: (quiz: StudyQuiz) => void;
  onAttemptSaved: (attempt: StudyQuizAttempt) => void;
  onBadgeSaved: (badge: StudyBadgeAward) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<QuizMode>("segment");
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [selectedChapterIndex, setSelectedChapterIndex] = useState<number | null>(null);
  const [allowSpoilers, setAllowSpoilers] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState<StudyQuiz | null>(null);
  const [quizError, setQuizError] = useState<string | null>(null);

  const quizSegments = guide.segments.filter((segment) => segment.quizWorthy);
  const chapters = groupSegmentsByChapter(guide).filter((chapter) => chapter.quizWorthy);
  const selectedSegment = quizSegments.find((segment) => segment.id === selectedSegmentId) ?? null;
  const selectedChapter = chapters.find((chapter) => chapter.chapterIndex === selectedChapterIndex) ?? null;
  const bookComplete = isBookComplete(guide, wordPosition);
  const existingSegmentQuiz = selectedSegment
    ? quizzes.find((quiz) => quiz.scope === "segment" && quiz.targetId === selectedSegment.id)
    : null;
  const existingChapterQuiz = selectedChapter
    ? quizzes.find((quiz) => quiz.scope === "chapter" && quiz.targetId === `chapter-${selectedChapter.chapterIndex}`)
    : null;
  const existingBookQuiz = quizzes.find((quiz) => quiz.scope === "book" && quiz.targetId === "whole-book") ?? null;
  const existingQuiz =
    mode === "segment" ? existingSegmentQuiz : mode === "chapter" ? existingChapterQuiz : existingBookQuiz;
  const latestAttempt = activeQuiz
    ? [...attempts].reverse().find((attempt) => attempt.quizId === activeQuiz.id)
    : null;

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
    setNotice(null);
    setQuizError(null);
    if (existingQuiz) {
      setActiveQuiz(existingQuiz);
      return;
    }
    void generateSelectedQuiz();
  };

  const generateSelectedQuiz = async () => {
    if (!activeStructure) {
      setQuizError("The book structure is still loading. Try again in a moment.");
      return;
    }
    const apiKey = await storage.loadApiKey("lumina_google_ai_key");
    if (!apiKey) {
      setQuizError("Add a Google AI key in Settings to generate quizzes.");
      return;
    }
    setIsGeneratingQuiz(true);
    try {
      let quiz: StudyQuiz;
      if (mode === "segment") {
        if (!selectedSegment) return;
        quiz = await generateSegmentQuiz({ segment: selectedSegment, structure: activeStructure, apiKey });
      } else if (mode === "chapter") {
        if (!selectedChapter) return;
        quiz = await generateChapterQuiz({ chapter: selectedChapter, structure: activeStructure, apiKey });
      } else {
        quiz = await generateWholeBookQuiz({ segments: guide.segments, structure: activeStructure, apiKey });
      }
      await storage.saveStudyQuiz(quiz);
      onQuizSaved(quiz);
      setActiveQuiz(quiz);
    } catch (err) {
      console.error("[StudyGuide] Quiz generation failed:", err);
      setQuizError(err instanceof Error ? err.message : "Quiz generation failed.");
    } finally {
      setIsGeneratingQuiz(false);
    }
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
        {mode === "segment" && existingSegmentQuiz && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-lumina-gold/70">
            <CheckCircle2 size={12} />
            Quiz generated
          </p>
        )}
        {mode === "chapter" && existingChapterQuiz && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-lumina-gold/70">
            <CheckCircle2 size={12} />
            Quiz generated
          </p>
        )}
        {mode === "book" && existingBookQuiz && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-lumina-gold/70">
            <CheckCircle2 size={12} />
            Quiz generated
          </p>
        )}
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
      {quizError && <p className="mt-2 text-[11px] leading-relaxed text-rose-400/80">{quizError}</p>}

      {activeQuiz && (
        <QuizRunner
          quiz={activeQuiz}
          latestAttempt={latestAttempt}
          onClose={() => setActiveQuiz(null)}
          onComplete={async (answers) => {
            const correct = answers.reduce(
              (sum, answer, index) => sum + (answer === activeQuiz.questions[index]?.correctOptionIndex ? 1 : 0),
              0
            );
            const score = Math.round((correct / activeQuiz.questions.length) * 100);
            const attempt: StudyQuizAttempt = {
              id: `attempt-${activeQuiz.id}-${Date.now()}`,
              quizId: activeQuiz.id,
              bookId: activeQuiz.bookId,
              answers,
              score,
              passed: score >= 70,
              completedAt: new Date().toISOString(),
            };
            await storage.saveStudyQuizAttempt(attempt);
            onAttemptSaved(attempt);
            if (attempt.passed && !badges.some((badge) => badge.quizId === activeQuiz.id)) {
              const badge: StudyBadgeAward = {
                id: `badge-${activeQuiz.id}`,
                bookId: activeQuiz.bookId,
                quizId: activeQuiz.id,
                scope: activeQuiz.scope,
                targetId: activeQuiz.targetId,
                label:
                  activeQuiz.scope === "book"
                    ? "Whole Book Mastery"
                    : activeQuiz.scope === "chapter"
                      ? "Chapter Mastered"
                      : "Segment Cleared",
                score,
                awardedAt: new Date().toISOString(),
              };
              await storage.saveStudyBadgeAward(badge);
              onBadgeSaved(badge);
            }
          }}
        />
      )}

      <button
        onClick={handleGenerate}
        disabled={!canGenerate || isGeneratingQuiz}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-lumina-gold/30 bg-lumina-gold/10 px-4 py-2.5 text-xs font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/15 disabled:cursor-default disabled:border-hair disabled:bg-ink/[0.03] disabled:text-ink-faint"
      >
        {isGeneratingQuiz ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {existingQuiz ? "Take Quiz" : isGeneratingQuiz ? "Generating Quiz" : "Generate Quiz"}
      </button>
    </div>
  );
}

function QuizRunner({
  quiz,
  latestAttempt,
  onClose,
  onComplete,
}: {
  quiz: StudyQuiz;
  latestAttempt?: StudyQuizAttempt | null;
  onClose: () => void;
  onComplete: (answers: number[]) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<number[]>(() => Array(quiz.questions.length).fill(-1));
  const [submitted, setSubmitted] = useState(Boolean(latestAttempt));
  const [completedAttempt, setCompletedAttempt] = useState<StudyQuizAttempt | null>(latestAttempt ?? null);
  const displayAttempt = completedAttempt ?? latestAttempt ?? null;
  const displayAnswers = submitted && displayAttempt ? displayAttempt.answers : answers;
  const score = displayAttempt?.score;

  const submit = async () => {
    if (answers.some((answer) => answer < 0)) return;
    await onComplete(answers);
    const correct = answers.reduce(
      (sum, answer, index) => sum + (answer === quiz.questions[index]?.correctOptionIndex ? 1 : 0),
      0
    );
    const score = Math.round((correct / quiz.questions.length) * 100);
    setCompletedAttempt({
      id: "local-preview",
      quizId: quiz.id,
      bookId: quiz.bookId,
      answers,
      score,
      passed: score >= 70,
      completedAt: new Date().toISOString(),
    });
    setSubmitted(true);
  };

  return (
    <div className="mt-3 rounded-xl border border-lumina-gold/24 bg-lumina-gold/[0.045] p-3">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-lumina-gold/70">Segment Quiz</p>
          <p className="mt-1 text-sm font-medium text-ink/85">{quiz.title}</p>
          {submitted && score != null && (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-faint">
              <Trophy size={12} className={score >= 70 ? "text-lumina-gold/75" : "text-ink-faint"} />
              Score: {score}%
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint hover:bg-ink/[0.06] hover:text-ink-soft"
          aria-label="Close quiz"
        >
          <X size={13} />
        </button>
      </div>

      <div className="space-y-3">
        {quiz.questions.map((question, questionIndex) => {
          const selected = displayAnswers[questionIndex] ?? -1;
          const previous = quiz.questions[questionIndex - 1];
          const showChainTitle = Boolean(question.chainTitle && question.chainTitle !== previous?.chainTitle);
          return (
            <div key={question.id} className="rounded-lg border border-hair bg-surface-dark/55 p-3">
              {showChainTitle && (
                <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-lumina-gold/65">
                  {question.chainTitle}
                </p>
              )}
              <p className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">
                Question {question.questionNumber} of {quiz.questions.length}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink/88">{question.question}</p>
              <div className="mt-2 space-y-1.5">
                {question.options.map((option, optionIndex) => {
                  const isSelected = selected === optionIndex;
                  const isCorrect = submitted && question.correctOptionIndex === optionIndex;
                  const isWrong = submitted && isSelected && !isCorrect;
                  return (
                    <button
                      key={option}
                      onClick={() => {
                        if (submitted) return;
                        setAnswers((current) =>
                          current.map((answer, index) => (index === questionIndex ? optionIndex : answer))
                        );
                      }}
                      className={`w-full rounded-md border px-2.5 py-2 text-left text-[12px] leading-relaxed transition-colors ${
                        isCorrect
                          ? "border-lumina-gold/45 bg-lumina-gold/[0.09] text-ink"
                          : isWrong
                            ? "border-rose-400/35 bg-rose-400/[0.08] text-ink"
                            : isSelected
                              ? "border-lumina-gold/35 bg-lumina-gold/[0.055] text-ink"
                              : "border-hair bg-ink/[0.025] text-ink-soft hover:bg-ink/[0.045]"
                      }`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
              {submitted && (
                <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">{question.explanation}</p>
              )}
            </div>
          );
        })}
      </div>

      {!submitted && (
        <button
          onClick={submit}
          disabled={answers.some((answer) => answer < 0)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-lumina-gold/30 bg-lumina-gold/10 px-4 py-2.5 text-xs font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/15 disabled:cursor-default disabled:border-hair disabled:bg-ink/[0.03] disabled:text-ink-faint"
        >
          Submit Quiz
        </button>
      )}
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
