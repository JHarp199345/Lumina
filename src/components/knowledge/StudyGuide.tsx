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
  Map,
  Layers3,
  ChevronLeft,
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
import { generateFlashcards } from "@/pipeline/studyFlashcards";
import { generateChapterQuiz, generateSegmentQuiz, generateWholeBookQuiz } from "@/pipeline/studyQuizzer";
import { knowledgeProtocol } from "@/pipeline/knowledgeGrounding";
import {
  groupSegmentsByChapter,
  isBookComplete,
  isChapterReached,
  isSegmentReached,
  type StudyChapterGroup,
} from "@/utils/studyProgress";
import type { BookStructure, SemanticMap, StudyBadgeAward, StudyGuide, StudyQuiz, StudyQuizAttempt, StudySegment } from "@/types";
import type { StudyFlashcard } from "@/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type QuizMode = "segment" | "chapter" | "book";
type StudyView = "home" | "map" | "quizzes" | "flashcards" | "badges";

function quizModeLabel(mode: QuizMode, isExpository: boolean): string {
  if (mode === "segment") return isExpository ? "Topic" : "Segment";
  if (mode === "chapter") return isExpository ? "Section" : "Chapter";
  return "Book";
}

export default function StudyGuide() {
  const { activeBook, activeStructure, activeSemanticMap } = useBookStore();
  const { guide, isGenerating, progressMessage, mount, setIsGenerating, setProgress } =
    useStudyStore();
  const wordPosition = useReaderStore((s) => s.wordPosition);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<StudyView>("home");
  const [quizzes, setQuizzes] = useState<StudyQuiz[]>([]);
  const [attempts, setAttempts] = useState<StudyQuizAttempt[]>([]);
  const [badges, setBadges] = useState<StudyBadgeAward[]>([]);
  const [flashcards, setFlashcards] = useState<StudyFlashcard[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!activeBook) {
      setQuizzes([]);
      setAttempts([]);
      setBadges([]);
      setFlashcards([]);
      return;
    }
    Promise.all([
      storage.loadStudyQuizzes(activeBook.id).catch(() => [] as StudyQuiz[]),
      storage.loadStudyQuizAttempts(activeBook.id).catch(() => [] as StudyQuizAttempt[]),
      storage.loadStudyBadgeAwards(activeBook.id).catch(() => [] as StudyBadgeAward[]),
      storage.loadStudyFlashcards(activeBook.id).catch(() => [] as StudyFlashcard[]),
    ]).then(([loadedQuizzes, loadedAttempts, loadedBadges, loadedFlashcards]) => {
      if (cancelled) return;
      setQuizzes(loadedQuizzes);
      setAttempts(loadedAttempts);
      setBadges(loadedBadges);
      setFlashcards(loadedFlashcards);
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
      const apiKey = await storage.loadApiKey("lumina_google_ai_key");
      if (apiKey) {
        setProgress("Asking AI to organize the guide around the book itself...");
        const refined = await refineStudyGuide(built, activeStructure, apiKey, (p) => setProgress(p.message));
        await storage.saveStudyGuide(refined);
        mount(activeBook.id, refined);
      } else {
        await storage.saveStudyGuide(built);
        mount(activeBook.id, built);
      }
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

  // ── Guide exists: dashboard ────────────────────────────────────────────────
  if (guide && guide.bookId === activeBook.id) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-hair px-4 py-3">
          <div>
            <p className="text-sm font-medium text-ink/85">Study Guide</p>
            <p className="text-[11px] text-ink-faint">
              {guide.segments.length} segment{guide.segments.length === 1 ? "" : "s"}
              {guide.source === "heuristic" ? " · draft map" : " · refined"}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
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

        {view !== "home" && (
          <button
            onClick={() => setView("home")}
            className="flex items-center gap-1.5 border-b border-hair px-4 py-2 text-[11px] text-ink-faint transition-colors hover:text-ink-soft"
          >
            <ChevronLeft size={13} />
            Study Guide
          </button>
        )}

        {view === "home" && (
          <StudyDashboard
            guide={guide}
            quizzes={quizzes}
            badges={badges}
            flashcards={flashcards}
            wordPosition={wordPosition}
            onOpen={setView}
          />
        )}

        {view === "map" && <StudyMap guide={guide} wordPosition={wordPosition} />}

        {view === "quizzes" && (
          <QuizSelector
            guide={guide}
            activeStructure={activeStructure}
            activeSemanticMap={activeSemanticMap}
            wordPosition={wordPosition}
            quizzes={quizzes}
            attempts={attempts}
            badges={badges}
            onQuizSaved={(quiz) => setQuizzes((current) => [...current.filter((q) => q.id !== quiz.id), quiz])}
            onAttemptSaved={(attempt) => setAttempts((current) => [...current, attempt])}
            onBadgeSaved={(badge) => setBadges((current) => [...current.filter((b) => b.id !== badge.id), badge])}
          />
        )}

        {view === "flashcards" && (
          <FlashcardStudio
            guide={guide}
            activeStructure={activeStructure}
            wordPosition={wordPosition}
            cards={flashcards}
            onCardsSaved={(cards) => setFlashcards((current) => [...current, ...cards])}
          />
        )}

        {view === "badges" && <BadgesView badges={badges} />}
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

function StudyDashboard({
  guide,
  quizzes,
  badges,
  flashcards,
  wordPosition,
  onOpen,
}: {
  guide: StudyGuide;
  quizzes: StudyQuiz[];
  badges: StudyBadgeAward[];
  flashcards: StudyFlashcard[];
  wordPosition: number;
  onOpen: (view: StudyView) => void;
}) {
  const reachedCount = guide.segments.filter((segment) => isSegmentReached(segment, wordPosition)).length;
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 scrollbar-thin">
      <div className="rounded-xl border border-hair bg-ink/[0.025] px-3.5 py-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-lumina-gold/70">Current Book</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          {reachedCount} of {guide.segments.length} study segments reached.
        </p>
      </div>

      <DashboardButton
        icon={<Map size={17} />}
        title="Study Map"
        detail="Readable stopping points created from this book."
        meta={`${guide.segments.length} segment${guide.segments.length === 1 ? "" : "s"}`}
        onClick={() => onOpen("map")}
      />
      <DashboardButton
        icon={<ListChecks size={17} />}
        title="Quizzes"
        detail="Generate checks by segment, chapter, or whole book."
        meta={`${quizzes.length} saved`}
        onClick={() => onOpen("quizzes")}
      />
      <DashboardButton
        icon={<Layers3 size={17} />}
        title="Flashcards"
        detail="Choose any segments and turn them into review cards."
        meta={`${flashcards.length} card${flashcards.length === 1 ? "" : "s"}`}
        onClick={() => onOpen("flashcards")}
      />
      <DashboardButton
        icon={<Trophy size={17} />}
        title="Badges"
        detail="Awards earned from completed quizzes."
        meta={`${badges.length} earned`}
        onClick={() => onOpen("badges")}
      />
    </div>
  );
}

function DashboardButton({
  icon,
  title,
  detail,
  meta,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-xl border border-hair bg-ink/[0.025] px-3.5 py-3 text-left transition-colors hover:border-lumina-gold/30 hover:bg-lumina-gold/[0.04]"
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-lumina-gold/20 bg-lumina-gold/[0.06] text-lumina-gold/75">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink/88">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-faint">{detail}</span>
      </span>
      <span className="shrink-0 rounded-full border border-hair px-2 py-1 text-[10px] text-ink-faint">
        {meta}
      </span>
    </button>
  );
}

function StudyMap({ guide, wordPosition }: { guide: StudyGuide; wordPosition: number }) {
  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3 scrollbar-thin">
      {guide.segments.map((segment) => (
        <SegmentRow key={segment.id} segment={segment} reached={isSegmentReached(segment, wordPosition)} />
      ))}
    </div>
  );
}

function BadgesView({ badges }: { badges: StudyBadgeAward[] }) {
  if (badges.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-lumina-gold/20 bg-lumina-gold/[0.06] text-lumina-gold/75">
          <Trophy size={21} />
        </span>
        <p className="text-sm font-medium text-ink/85">No badges yet</p>
        <p className="max-w-xs text-xs leading-relaxed text-ink-faint">
          Pass quizzes to collect awards for this book.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3 scrollbar-thin">
      {badges.map((badge) => (
        <div key={badge.id} className="rounded-xl border border-lumina-gold/24 bg-lumina-gold/[0.045] px-3.5 py-3">
          <div className="flex items-start gap-2.5">
            <Trophy size={16} className="mt-0.5 shrink-0 text-lumina-gold/75" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink/88">{badge.label}</p>
              <p className="mt-1 text-[11px] text-ink-faint">
                {badge.scope} quiz · {badge.score}% · {new Date(badge.awardedAt).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FlashcardStudio({
  guide,
  activeStructure,
  wordPosition,
  cards,
  onCardsSaved,
}: {
  guide: StudyGuide;
  activeStructure: BookStructure | null;
  wordPosition: number;
  cards: StudyFlashcard[];
  onCardsSaved: (cards: StudyFlashcard[]) => void;
}) {
  const reachedSegments = guide.segments.filter((segment) => isSegmentReached(segment, wordPosition));
  const [selectedIds, setSelectedIds] = useState<string[]>(() => reachedSegments.slice(0, 1).map((s) => s.id));
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [isGeneratingCards, setIsGeneratingCards] = useState(false);
  const [flashcardError, setFlashcardError] = useState<string | null>(null);

  const selectedSegments = guide.segments.filter((segment) => selectedIds.includes(segment.id));
  const activeCard = cards[activeCardIndex] ?? null;

  const toggleSegment = (segmentId: string) => {
    setSelectedIds((current) =>
      current.includes(segmentId)
        ? current.filter((id) => id !== segmentId)
        : [...current, segmentId]
    );
  };

  const runGenerateFlashcards = async () => {
    if (!activeStructure) {
      setFlashcardError("The book structure is still loading. Try again in a moment.");
      return;
    }
    const apiKey = await storage.loadApiKey("lumina_google_ai_key");
    if (!apiKey) {
      setFlashcardError("Add a Google AI key in Settings to generate flashcards.");
      return;
    }
    setFlashcardError(null);
    setIsGeneratingCards(true);
    try {
      const generated = await generateFlashcards({
        segments: selectedSegments,
        structure: activeStructure,
        apiKey,
      });
      await storage.saveStudyFlashcards(generated);
      onCardsSaved(generated);
      setActiveCardIndex(cards.length);
      setShowBack(false);
    } catch (err) {
      console.error("[StudyGuide] Flashcard generation failed:", err);
      setFlashcardError(err instanceof Error ? err.message : "Flashcard generation failed.");
    } finally {
      setIsGeneratingCards(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-hair px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-lumina-gold/75">Flashcards</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
          Select any reached segments, then generate cards from that exact material.
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 scrollbar-thin">
        <div className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Segments</p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSelectedIds(reachedSegments.map((segment) => segment.id))}
                className="rounded-md border border-hair px-2 py-1 text-[10px] text-ink-faint hover:text-ink-soft"
              >
                All
              </button>
              <button
                onClick={() => setSelectedIds([])}
                className="rounded-md border border-hair px-2 py-1 text-[10px] text-ink-faint hover:text-ink-soft"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
            {guide.segments.map((segment) => {
              const reached = isSegmentReached(segment, wordPosition);
              const selected = selectedIds.includes(segment.id);
              return (
                <button
                  key={segment.id}
                  onClick={() => {
                    if (reached) toggleSegment(segment.id);
                  }}
                  disabled={!reached}
                  className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    selected
                      ? "border-lumina-gold/40 bg-lumina-gold/[0.07]"
                      : "border-hair bg-ink/[0.02] hover:bg-ink/[0.04]"
                  } disabled:cursor-default disabled:opacity-45`}
                >
                  <span className={selected ? "mt-0.5 text-lumina-gold/75" : "mt-0.5 text-ink-faint"}>
                    {selected ? <CheckCircle2 size={13} /> : reached ? <Circle size={13} /> : <Lock size={13} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium text-ink/85">{segment.title}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-ink-faint">{segment.chapterTitle}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <button
            onClick={runGenerateFlashcards}
            disabled={selectedSegments.length === 0 || isGeneratingCards}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-lumina-gold/30 bg-lumina-gold/10 px-4 py-2.5 text-xs font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/15 disabled:cursor-default disabled:border-hair disabled:bg-ink/[0.03] disabled:text-ink-faint"
          >
            {isGeneratingCards ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {isGeneratingCards ? "Generating Cards" : "Generate Flashcards"}
          </button>
          {flashcardError && <p className="mt-2 text-[11px] leading-relaxed text-rose-400/80">{flashcardError}</p>}
        </div>

        <div className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Saved Cards</p>
            <p className="text-[10px] text-ink-faint">{cards.length} total</p>
          </div>
          {activeCard ? (
            <>
              <button
                onClick={() => setShowBack((value) => !value)}
                className="min-h-36 w-full rounded-xl border border-lumina-gold/24 bg-lumina-gold/[0.045] px-4 py-5 text-center transition-colors hover:bg-lumina-gold/[0.065]"
              >
                <p className="text-[10px] uppercase tracking-[0.16em] text-lumina-gold/65">
                  {showBack ? "Back" : "Front"} · {activeCard.type}
                </p>
                <p className="mt-3 text-[14px] leading-relaxed text-ink/88">
                  {showBack ? activeCard.back : activeCard.front}
                </p>
                {activeCard.tags.length > 0 && (
                  <p className="mt-3 text-[10px] text-ink-faint">{activeCard.tags.join(" · ")}</p>
                )}
              </button>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setActiveCardIndex((index) => Math.max(0, index - 1));
                    setShowBack(false);
                  }}
                  className="rounded-lg border border-hair px-3 py-2 text-xs text-ink-faint hover:text-ink-soft"
                >
                  Previous
                </button>
                <button
                  onClick={() => {
                    setActiveCardIndex((index) => Math.min(cards.length - 1, index + 1));
                    setShowBack(false);
                  }}
                  className="rounded-lg border border-hair px-3 py-2 text-xs text-ink-faint hover:text-ink-soft"
                >
                  Next
                </button>
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-xs text-ink-faint">No flashcards saved yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function QuizSelector({
  guide,
  activeStructure,
  activeSemanticMap,
  wordPosition,
  quizzes,
  attempts,
  badges,
  onQuizSaved,
  onAttemptSaved,
  onBadgeSaved,
}: {
  guide: StudyGuide;
  activeStructure: BookStructure | null;
  activeSemanticMap: SemanticMap | null;
  wordPosition: number;
  quizzes: StudyQuiz[];
  attempts: StudyQuizAttempt[];
  badges: StudyBadgeAward[];
  onQuizSaved: (quiz: StudyQuiz) => void;
  onAttemptSaved: (attempt: StudyQuizAttempt) => void;
  onBadgeSaved: (badge: StudyBadgeAward) => void;
}) {
  const protocol = knowledgeProtocol(activeSemanticMap);
  const isExpository = protocol === "expository";
  const availableModes: QuizMode[] = isExpository ? ["segment", "chapter", "book"] : ["chapter", "book"];
  const [mode, setMode] = useState<QuizMode>(() => (isExpository ? "segment" : "chapter"));
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

  useEffect(() => {
    if (!availableModes.includes(mode)) {
      setMode(availableModes[0]);
      setNotice(null);
      setActiveQuiz(null);
    }
  }, [availableModes.join("|"), mode]);

  const canGenerate =
    mode === "segment"
      ? Boolean(selectedSegment && isSegmentReached(selectedSegment, wordPosition))
      : mode === "chapter"
        ? Boolean(selectedChapter && isChapterReached(selectedChapter, wordPosition))
        : bookComplete || allowSpoilers;

  const targetLabel =
    mode === "segment"
      ? selectedSegment?.title ?? (isExpository ? "Choose a topic" : "Choose a segment")
      : mode === "chapter"
        ? selectedChapter?.chapterTitle ?? (isExpository ? "Choose a section" : "Choose a chapter")
        : isExpository ? "Whole Book Synthesis" : "Whole Book Review";

  const questionRange =
    mode === "segment"
      ? isExpository ? "4-6 topic questions" : "4-6 questions"
      : mode === "chapter"
        ? isExpository ? "6-10 section questions" : "6-10 chapter questions"
        : isExpository ? "10-14 synthesis questions" : "8-12 book questions";

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
        quiz = await generateSegmentQuiz({ segment: selectedSegment, structure: activeStructure, apiKey, semanticMap: activeSemanticMap });
      } else if (mode === "chapter") {
        if (!selectedChapter) return;
        quiz = await generateChapterQuiz({ chapter: selectedChapter, structure: activeStructure, apiKey, semanticMap: activeSemanticMap });
      } else {
        quiz = await generateWholeBookQuiz({ segments: guide.segments, structure: activeStructure, apiKey, semanticMap: activeSemanticMap });
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
            {isExpository ? "Topic Quizzes" : "Chapter Quizzes"}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {isExpository
              ? "Follow the book's topics and section order."
              : "Review fiction by completed chapter, without later spoilers."}
          </p>
        </div>
        <ListChecks size={15} className="text-lumina-gold/70" />
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-lg border border-hair bg-black/16 p-1">
        {availableModes.map((item) => (
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
            {quizModeLabel(item, isExpository)}
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
                subtitle={`${chapter.segments.length} ${isExpository ? "topic" : "moment"}${chapter.segments.length === 1 ? "" : "s"}`}
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
              {isExpository
                ? "Learning chains across the book's topics, terms, mechanisms, and applications."
                : "High-level comprehension chains focused on causation, callbacks, consequences, and theme."}
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
              : isExpository
                ? "Read past this topic or section before generating its quiz."
                : "Read past this chapter before generating its quiz."}
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
  const answeredCount = answers.filter((answer) => answer >= 0).length;

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
    <div className="mt-3 rounded-xl border border-lumina-gold/24 bg-gradient-to-b from-lumina-gold/[0.075] to-ink/[0.025] p-3">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-lumina-gold/70">
            {quizScopeLabel(quiz.scope)}
          </p>
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

      {!submitted && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-black/20">
          <div
            className="h-full rounded-full bg-lumina-gold/55 transition-all"
            style={{ width: `${Math.round((answeredCount / Math.max(1, quiz.questions.length)) * 100)}%` }}
          />
        </div>
      )}

      <div className="space-y-3">
        {quiz.questions.map((question, questionIndex) => {
          const selected = displayAnswers[questionIndex] ?? -1;
          const previous = quiz.questions[questionIndex - 1];
          const showChainTitle = Boolean(question.chainTitle && question.chainTitle !== previous?.chainTitle);
          return (
            <div key={question.id} className="rounded-lg border border-hair bg-surface-dark/62 p-3 shadow-sm shadow-black/10">
              {showChainTitle && (
                <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-lumina-gold/65">
                  {question.chainTitle}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">
                  Question {question.questionNumber} of {quiz.questions.length}
                </p>
                <span className="rounded-full border border-hair bg-ink/[0.035] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-ink-faint">
                  {question.level}
                </span>
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-ink/88">{question.question}</p>
              {question.purpose && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">{question.purpose}</p>
              )}
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

function quizScopeLabel(scope: StudyQuiz["scope"]): string {
  if (scope === "book") return "Book Review";
  if (scope === "chapter") return "Chapter / Section Quiz";
  return "Topic Quiz";
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
