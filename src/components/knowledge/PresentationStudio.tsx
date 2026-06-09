import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Key,
  Presentation,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useBookStore } from "@/store/bookStore";
import { useReaderStore } from "@/store/readerStore";
import { storage } from "@/storage";
import { LUMINA_CONFIG } from "@/config";
import { GOOGLE_KEY_NAME } from "@/pipeline/audioOverview";
import type { OverviewScope } from "@/pipeline/audioOverview";
import {
  PRESENTATION_TEMPLATES,
  deckToMarkdown,
  generatePresentationDeck,
  getPresentationTemplate,
  presentationSuggestions,
  suggestPresentationPrompt,
} from "@/pipeline/presentationStudio";
import {
  buildSourceProfile,
  isUsableSourceProfile,
} from "@/pipeline/sourceProfile";
import SuggestionComposer from "@/components/knowledge/SuggestionComposer";
import type {
  PresentationDeck,
  PresentationTemplateId,
  SourceIntelligenceProfile,
} from "@/types";

export default function PresentationStudio() {
  const { activeBook, activeStructure, activeSemanticMap } = useBookStore();
  const currentChapterIndex = useReaderStore((s) => s.currentChapterIndex);

  const [scopeType, setScopeType] = useState<OverviewScope["type"]>("whole");
  const [chosenChapterIds, setChosenChapterIds] = useState<Set<string>>(new Set());
  const [slideCount, setSlideCount] = useState<number>(LUMINA_CONFIG.PRESENTATION_DEFAULT_SLIDES);
  const [templateId, setTemplateId] = useState<PresentationTemplateId>("teach");
  const [prompt, setPrompt] = useState("");
  const [selectedAngleId, setSelectedAngleId] = useState<string | null>(null);
  const [profile, setProfile] = useState<SourceIntelligenceProfile | null>(null);
  const [profileBuilding, setProfileBuilding] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(true);
  const [decks, setDecks] = useState<PresentationDeck[]>([]);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  const suggestions = useMemo(
    () => (activeStructure ? presentationSuggestions(activeStructure, profile) : []),
    [activeStructure, profile]
  );
  const tailored = Boolean(profile?.suggestionBank?.length);

  const scope: OverviewScope = useMemo(
    () => ({
      type: scopeType,
      chapterIds: [...chosenChapterIds],
      currentChapterIndex: Math.max(0, currentChapterIndex),
    }),
    [scopeType, chosenChapterIds, currentChapterIndex]
  );

  const activeDeck = decks.find((d) => d.id === activeDeckId) ?? null;
  const activeSlide = activeDeck?.slides[slideIndex] ?? null;
  const template = getPresentationTemplate(templateId);

  useEffect(() => {
    let cancelled = false;
    if (!activeBook) return;
    storage
      .loadPresentations(activeBook.id)
      .then((loaded) => {
        if (!cancelled) setDecks(loaded);
      })
      .catch(() => {
        if (!cancelled) setDecks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeBook?.id]);

  useEffect(() => {
    let cancelled = false;
    storage
      .loadApiKey(GOOGLE_KEY_NAME)
      .then((k) => !cancelled && setHasKey(Boolean(k)))
      .catch(() => !cancelled && setHasKey(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!activeBook || !activeStructure) {
      setProfile(null);
      return;
    }
    (async () => {
      const existing = await storage.loadSourceProfile(activeBook.id).catch(() => null);
      if (cancelled) return;
      if (isUsableSourceProfile(existing)) {
        setProfile(existing);
        return;
      }
      const apiKey = await storage.loadApiKey(GOOGLE_KEY_NAME);
      if (cancelled || !apiKey || !activeSemanticMap) return;
      setProfileBuilding(true);
      try {
        const built = await buildSourceProfile(activeStructure, activeSemanticMap, apiKey);
        if (cancelled) return;
        await storage.saveSourceProfile(built).catch(() => {});
        setProfile(built);
      } catch (err) {
        console.warn("[PresentationStudio] SIP build failed:", err);
      } finally {
        if (!cancelled) setProfileBuilding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBook, activeStructure, activeSemanticMap]);

  const ensureProfile = async (apiKey: string) => {
    if (isUsableSourceProfile(profile)) return profile;
    if (!activeStructure || !activeSemanticMap) return profile;
    setProfileBuilding(true);
    try {
      const built = await buildSourceProfile(activeStructure, activeSemanticMap, apiKey);
      await storage.saveSourceProfile(built).catch(() => {});
      setProfile(built);
      return built;
    } finally {
      setProfileBuilding(false);
    }
  };

  const pickSuggestion = (id: string) => {
    const plan = suggestions.find((s) => s.id === id)?.planText ?? "";
    if (!plan) return;
    setSelectedAngleId(id);
    setPrompt(plan);
  };

  const requestFullerSuggestion = async (ghostAngle?: (typeof suggestions)[0] | null) => {
    if (!activeStructure) return;
    const apiKey = await storage.loadApiKey(GOOGLE_KEY_NAME);
    if (!apiKey) {
      setHasKey(false);
      return;
    }
    setIsSuggesting(true);
    try {
      const enrichedProfile = profile ?? (await ensureProfile(apiKey));
      const fuller = await suggestPresentationPrompt(scope, activeStructure, activeSemanticMap, apiKey, {
        angleLabel: ghostAngle?.label,
        seedPlan: ghostAngle?.planText ?? prompt,
        profile: enrichedProfile,
      });
      if (fuller) {
        setSelectedAngleId(ghostAngle?.id ?? null);
        setPrompt(fuller);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a suggestion.");
    } finally {
      setIsSuggesting(false);
    }
  };

  const generate = async () => {
    if (!activeBook || !activeStructure) {
      setError("Open a book first.");
      return;
    }
    const apiKey = await storage.loadApiKey(GOOGLE_KEY_NAME);
    if (!apiKey) {
      setHasKey(false);
      setError("Add your Google AI Studio key in Settings to generate presentations.");
      return;
    }
    setError(null);
    setIsGenerating(true);
    setProgress("Preparing source intelligence…");
    try {
      const enrichedProfile = await ensureProfile(apiKey);
      const deck = await generatePresentationDeck({
        scope,
        structure: activeStructure,
        semanticMap: activeSemanticMap,
        userPrompt: prompt,
        slideCount,
        templateId,
        apiKey,
        profile: enrichedProfile,
        onProgress: setProgress,
      });
      await storage.savePresentation(deck);
      setDecks((prev) => [deck, ...prev.filter((d) => d.id !== deck.id)]);
      setActiveDeckId(deck.id);
      setSlideIndex(0);
    } catch (err) {
      console.error("[PresentationStudio] generation failed:", err);
      setError(err instanceof Error ? err.message : "Presentation generation failed.");
    } finally {
      setIsGenerating(false);
      setProgress("");
    }
  };

  const copyOutline = useCallback(async () => {
    if (!activeDeck) return;
    await navigator.clipboard.writeText(deckToMarkdown(activeDeck));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [activeDeck]);

  const downloadJson = useCallback(() => {
    if (!activeDeck) return;
    const blob = new Blob([JSON.stringify(activeDeck, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeDeck.title.replace(/[^\w.-]+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeDeck]);

  if (!activeBook) {
    return <Centered icon={<BookOpen size={20} />} text="Open a book to create a presentation." />;
  }
  if (!activeStructure) {
    return (
      <Centered
        icon={<Presentation size={20} />}
        text="This book is still being prepared. Once chapters are detected, presentations can be generated."
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-hair px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-lumina-gold/75">
          Presentation Studio
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
          A structured slide deck explaining this book — generated from real text and your
          Source Intelligence Profile, not a generic summary.
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 scrollbar-thin">
        {!hasKey && (
          <div className="flex items-start gap-2 rounded-xl border border-lumina-gold/28 bg-lumina-gold/[0.055] p-3">
            <Key size={14} className="mt-0.5 shrink-0 text-lumina-gold/75" />
            <p className="text-[11px] leading-relaxed text-ink-faint">
              Presentation Studio uses your Google AI Studio key (same as analysis, images, and
              Audio Overview).
            </p>
          </div>
        )}

        {/* Scope */}
        <div className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-ink-faint">Scope</p>
          <div className="flex gap-1.5">
            <ScopeButton active={scopeType === "whole"} onClick={() => setScopeType("whole")}>
              Whole book
            </ScopeButton>
            <ScopeButton active={scopeType === "current"} onClick={() => setScopeType("current")}>
              This chapter
            </ScopeButton>
            <ScopeButton active={scopeType === "choose"} onClick={() => setScopeType("choose")}>
              Choose…
            </ScopeButton>
          </div>
          {scopeType === "choose" && (
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
              {activeStructure.chapters.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-hair bg-ink/[0.02] px-2.5 py-1.5 text-xs text-ink-soft hover:bg-ink/[0.04]"
                >
                  <input
                    type="checkbox"
                    checked={chosenChapterIds.has(c.id)}
                    onChange={() =>
                      setChosenChapterIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                    className="accent-lumina-gold"
                  />
                  <span className="truncate">{c.title || `Chapter ${c.index + 1}`}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Slide count */}
        <div className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Deck size</p>
            <p className="text-xs text-lumina-gold/85">~{slideCount} slides</p>
          </div>
          <input
            type="range"
            min={LUMINA_CONFIG.PRESENTATION_MIN_SLIDES}
            max={LUMINA_CONFIG.PRESENTATION_MAX_SLIDES}
            step={LUMINA_CONFIG.PRESENTATION_STEP}
            value={slideCount}
            onChange={(e) => setSlideCount(Number(e.target.value))}
            className="mt-2 w-full accent-lumina-gold"
          />
        </div>

        {/* Template */}
        <label className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Template</span>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value as PresentationTemplateId)}
            className="mt-2 w-full rounded-lg border border-hair bg-surface-dark px-2 py-2 text-xs text-ink-soft focus:outline-none"
          >
            {PRESENTATION_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} — {t.description}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">{template.description}</p>
        </label>

        {/* Prompt */}
        <div className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
              What should the deck cover?
            </p>
            <button
              onClick={() => requestFullerSuggestion()}
              disabled={isSuggesting || !activeStructure}
              className="flex items-center gap-1 rounded border border-hair px-2 py-1 text-[10px] text-lumina-gold/75 transition-colors hover:text-lumina-gold disabled:opacity-40"
            >
              <Wand2 size={10} className={isSuggesting ? "animate-pulse" : ""} />
              {isSuggesting ? "Thinking…" : "Suggest fuller"}
            </button>
          </div>

          <SuggestionComposer
            value={prompt}
            onChange={setPrompt}
            suggestions={suggestions}
            selectedId={selectedAngleId}
            onPick={pickSuggestion}
            onRequestFuller={requestFullerSuggestion}
            isSuggesting={isSuggesting}
            tailored={tailored}
            building={profileBuilding}
            promptLabel="Presentation prompt"
          />

          <p className="mt-1.5 text-[10px] text-ink-faint">
            Ghost text from your book&apos;s suggestion bank — Tab or Use to accept. The{" "}
            <span className="text-ink-soft/80">{template.label}</span> template brief is applied
            automatically on generate.
          </p>
        </div>

        <button
          onClick={generate}
          disabled={isGenerating}
          className="flex items-center justify-center gap-2 rounded-xl border border-lumina-gold/30 bg-lumina-gold/10 px-3 py-3 text-sm font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/15 disabled:cursor-default disabled:border-hair disabled:bg-ink/[0.03] disabled:text-ink-faint"
        >
          <Sparkles size={15} className={isGenerating ? "animate-pulse" : ""} />
          {isGenerating ? progress || "Generating…" : "Generate Presentation"}
        </button>

        {error && <p className="text-[11px] leading-relaxed text-rose-400/80">{error}</p>}

        {/* Active deck viewer */}
        {activeDeck && activeSlide && (
          <div className="rounded-xl border border-lumina-gold/25 bg-lumina-gold/[0.04] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium text-ink/90">{activeDeck.title}</p>
                <p className="text-[10px] text-ink-faint">
                  {activeDeck.scopeLabel} · {activeDeck.slides.length} slides
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={copyOutline}
                  className="flex items-center gap-1 rounded border border-hair px-2 py-1 text-[10px] text-ink-faint hover:text-ink-soft"
                >
                  <Copy size={10} />
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={downloadJson}
                  className="flex items-center gap-1 rounded border border-hair px-2 py-1 text-[10px] text-ink-faint hover:text-ink-soft"
                >
                  <Download size={10} />
                  JSON
                </button>
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-hair bg-surface-dark/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">
                  Slide {slideIndex + 1} of {activeDeck.slides.length} · {activeSlide.layout}
                </p>
                <div className="flex gap-1">
                  <button
                    onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}
                    disabled={slideIndex === 0}
                    className="rounded border border-hair p-1 text-ink-faint disabled:opacity-30"
                    aria-label="Previous slide"
                  >
                    <ChevronLeft size={12} />
                  </button>
                  <button
                    onClick={() =>
                      setSlideIndex((i) => Math.min(activeDeck.slides.length - 1, i + 1))
                    }
                    disabled={slideIndex >= activeDeck.slides.length - 1}
                    className="rounded border border-hair p-1 text-ink-faint disabled:opacity-30"
                    aria-label="Next slide"
                  >
                    <ChevronRight size={12} />
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm font-medium text-ink/90">{activeSlide.title}</p>
              {activeSlide.bullets.length > 0 && (
                <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-ink-soft">
                  {activeSlide.bullets.map((b) => (
                    <li key={b} className="flex gap-2">
                      <span className="text-lumina-gold/60">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
              {activeSlide.speakerNotes && (
                <p className="mt-3 border-t border-hair pt-2 text-[10px] leading-relaxed text-ink-faint">
                  <span className="font-medium text-ink-soft/70">Speaker notes: </span>
                  {activeSlide.speakerNotes}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Library */}
        <div className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Saved Decks</p>
          {decks.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-faint">No presentations yet.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {decks.map((deck) => (
                <button
                  key={deck.id}
                  onClick={() => {
                    setActiveDeckId(deck.id);
                    setSlideIndex(0);
                  }}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    activeDeckId === deck.id
                      ? "border-lumina-gold/40 bg-lumina-gold/[0.07]"
                      : "border-hair bg-ink/[0.02] hover:bg-ink/[0.04]"
                  }`}
                >
                  <p className="truncate text-[12px] font-medium text-ink/85">{deck.title}</p>
                  <p className="text-[10px] text-ink-faint">
                    {deck.scopeLabel} · {deck.slides.length} slides ·{" "}
                    {getPresentationTemplate(deck.templateId).label}
                    {deck.userPrompt ? " · custom" : " · default"}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScopeButton({
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
      className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] transition-colors ${
        active
          ? "border-lumina-gold/40 bg-lumina-gold/[0.1] text-lumina-gold"
          : "border-hair bg-ink/[0.02] text-ink-faint hover:text-ink-soft"
      }`}
    >
      {children}
    </button>
  );
}

function Centered({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-hair bg-ink/[0.04] text-ink-faint">
        {icon}
      </span>
      <p className="max-w-xs text-sm text-ink-soft">{text}</p>
    </div>
  );
}
