import { useEffect, useMemo, useState } from "react";
import {
  AudioLines,
  BookOpen,
  CheckCircle2,
  Key,
  Pause,
  Play,
  Sparkles,
  Star,
  Trash2,
  Wand2,
} from "lucide-react";
import { useAudioStore } from "@/store/audioStore";
import { useOverviewJobStore } from "@/store/overviewJobStore";
import { useBookStore } from "@/store/bookStore";
import { useReaderStore } from "@/store/readerStore";
import { storage } from "@/storage";
import { LUMINA_CONFIG } from "@/config";
import { getProvider } from "@/api/llmClient";
import {
  GEMINI_VOICES,
  KOKORO_VOICES,
  GOOGLE_KEY_NAME,
  suggestFullerPrompt,
  type OverviewScope,
} from "@/pipeline/audioOverview";
import { knowledgeProtocol, knowledgeWorkType } from "@/pipeline/knowledgeGrounding";
import { buildSourceProfile, fallbackSuggestions, isUsableSourceProfile } from "@/pipeline/sourceProfile";
import { getSkillMemory, rateSkillRun, type SkillRating, type OverallQuality } from "@/services/skillMemory";
import SuggestionComposer from "@/components/knowledge/SuggestionComposer";
import type { AudioArtifact, SourceIntelligenceProfile, SourceProfileSuggestion } from "@/types";

export default function AudioOverview() {
  const { activeBook, activeStructure, activeSemanticMap } = useBookStore();
  const currentChapterIndex = useReaderStore((s) => s.currentChapterIndex);
  const {
    bookId,
    artifacts,
    activeAudioId,
    isPlaying,
    mount,
    setActiveAudio,
    setIsPlaying,
    removeArtifact,
  } = useAudioStore();
  const {
    status: jobStatus,
    progress: jobProgress,
    error: jobError,
    start: startOverviewJob,
    isRunningForBook,
    dismissError,
  } = useOverviewJobStore();

  const overviewGenerating = activeBook ? isRunningForBook(activeBook.id) : false;
  const [localError, setLocalError] = useState<string | null>(null);
  const error = jobError ?? localError;

  const [scopeType, setScopeType] = useState<OverviewScope["type"]>("whole");
  const [chosenChapterIds, setChosenChapterIds] = useState<Set<string>>(new Set());
  const [minutes, setMinutes] = useState<number>(LUMINA_CONFIG.AUDIO_OVERVIEW_DEFAULT_MIN);
  const [voiceId, setVoiceId] = useState<string>(
    getProvider() === "odysseus"
      ? (KOKORO_VOICES[0]?.id ?? LUMINA_CONFIG.AUDIO_OVERVIEW_DEFAULT_VOICE)
      : LUMINA_CONFIG.AUDIO_OVERVIEW_DEFAULT_VOICE
  );
  const [prompt, setPrompt] = useState("");           // the editable instruction text
  const [selectedAngleId, setSelectedAngleId] = useState<string | null>(null);
  const [profile, setProfile] = useState<SourceIntelligenceProfile | null>(null);
  const [profileBuilding, setProfileBuilding] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [hasKey, setHasKey] = useState(true);

  // Rating UI state
  const [ratingOpenId, setRatingOpenId] = useState<string | null>(null);
  const [ratingDraft, setRatingDraft] = useState<Partial<SkillRating>>({});
  const [ratedIds, setRatedIds] = useState<Set<string>>(new Set());

  // The angles offered in the composer. Tailored ones come from the book's
  // Source Intelligence Profile; until that exists we still offer real,
  // title-grounded fallbacks so the field is never dead.
  const suggestions: SourceProfileSuggestion[] = useMemo(() => {
    if (profile?.suggestionBank?.length) return profile.suggestionBank;
    if (activeStructure) {
      const protocol = knowledgeProtocol(activeSemanticMap, profile);
      const workType = knowledgeWorkType(activeSemanticMap, profile);
      return fallbackSuggestions(activeStructure, workType, protocol);
    }
    return [];
  }, [profile, activeStructure, activeSemanticMap]);
  const tailored = (profile?.suggestionBank?.length ?? 0) > 0;

  const scope: OverviewScope = useMemo(
    () => ({
      type: scopeType,
      chapterIds: [...chosenChapterIds],
      currentChapterIndex: Math.max(0, currentChapterIndex),
    }),
    [scopeType, chosenChapterIds, currentChapterIndex]
  );

  // Mount this book's audio artifacts.
  useEffect(() => {
    let cancelled = false;
    if (!activeBook) return;
    if (bookId === activeBook.id) return;
    storage
      .loadAudioArtifacts(activeBook.id)
      .then((loaded) => !cancelled && mount(activeBook.id, loaded))
      .catch(() => !cancelled && mount(activeBook.id, []));
    return () => {
      cancelled = true;
    };
  }, [activeBook, bookId, mount]);

  // Pick up artifacts saved while this panel was closed or the gallery was open.
  useEffect(() => {
    if (!activeBook || jobStatus !== "completed") return;
    void storage.loadAudioArtifacts(activeBook.id).then((loaded) => {
      if (useAudioStore.getState().bookId === activeBook.id) {
        useAudioStore.getState().setArtifacts(loaded);
      }
    });
  }, [activeBook, jobStatus]);

  // Key check — Odysseus provider needs no Google key.
  useEffect(() => {
    if (getProvider() === "odysseus") { setHasKey(true); return; }
    let cancelled = false;
    storage
      .loadApiKey(GOOGLE_KEY_NAME)
      .then((k) => !cancelled && setHasKey(Boolean(k)))
      .catch(() => !cancelled && setHasKey(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const buildAndStoreProfile = async (apiKey: string) => {
    if (!activeBook || !activeStructure || !activeSemanticMap) return null;
    const built = await buildSourceProfile(activeStructure, activeSemanticMap, apiKey);
    await storage.saveSourceProfile(built).catch(() => {});
    setProfile(built);
    return built;
  };

  const ensureProfile = async (apiKey: string) => {
    if (isUsableSourceProfile(profile, activeSemanticMap)) return profile;
    if (!activeSemanticMap) return profile;
    setProfileBuilding(true);
    try {
      return await buildAndStoreProfile(apiKey);
    } catch (err) {
      console.warn("[AudioOverview] SIP enrichment failed:", err);
      return profile;
    } finally {
      setProfileBuilding(false);
    }
  };

  // Load the Source Intelligence Profile for this book; lazily build + cache it if
  // missing or too thin (one enriched call that reuses the existing analysis). Older
  // books build it here on first open; generation also checks once more before running.
  useEffect(() => {
    let cancelled = false;
    if (!activeBook || !activeStructure) {
      setProfile(null);
      return;
    }
    (async () => {
      const existing = await storage.loadSourceProfile(activeBook.id).catch(() => null);
      if (cancelled) return;
      if (isUsableSourceProfile(existing, activeSemanticMap)) {
        setProfile(existing);
        return;
      }
      // No profile yet — build it if we have analysis + a key (or Odysseus mode).
      const apiKey = (await storage.loadApiKey(GOOGLE_KEY_NAME)) ?? "";
      if (cancelled) return;
      if ((!apiKey && getProvider() === "gemini") || !activeSemanticMap) return;
      setProfileBuilding(true);
      try {
        const built = await buildSourceProfile(activeStructure, activeSemanticMap, apiKey);
        if (cancelled) return;
        await storage.saveSourceProfile(built).catch(() => {});
        setProfile(built);
      } catch (err) {
        console.warn("[AudioOverview] SIP build failed:", err);
      } finally {
        if (!cancelled) setProfileBuilding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBook, activeStructure, activeSemanticMap]);

  const overviewArtifacts = useMemo(
    () =>
      artifacts
        .filter((a) => a.scope === "overview" && a.status === "ready")
        .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()),
    [artifacts]
  );
  const activeArtifact = artifacts.find((a) => a.id === activeAudioId) ?? null;

  // Load an angle's plan into the editor as real, trimmable text.
  const pickSuggestion = (id: string) => {
    const plan = suggestions.find((s) => s.id === id)?.planText ?? "";
    if (!plan) return;
    setSelectedAngleId(id);
    setPrompt(plan);
  };

  // Expand the current ghost angle (or a fresh one) into a fuller directive.
  const requestFullerSuggestion = async (ghostAngle?: SourceProfileSuggestion | null) => {
    if (!activeStructure) return;
    const apiKey = (await storage.loadApiKey(GOOGLE_KEY_NAME)) ?? "";
    if (!apiKey && getProvider() === "gemini") {
      setHasKey(false);
      return;
    }
    setIsSuggesting(true);
    try {
      const enrichedProfile = profile ?? (await ensureProfile(apiKey));
      const fuller = await suggestFullerPrompt(scope, activeStructure, activeSemanticMap, apiKey, {
        angleLabel: ghostAngle?.label,
        seedPlan: ghostAngle?.planText ?? prompt,
        profile: enrichedProfile,
      });
      if (fuller) {
        setSelectedAngleId(ghostAngle?.id ?? null);
        setPrompt(fuller);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not generate a suggestion.");
    } finally {
      setIsSuggesting(false);
    }
  };

  const generate = async () => {
    if (!activeBook || !activeStructure) {
      setLocalError("Open a book first.");
      return;
    }
    const apiKey = await storage.loadApiKey(GOOGLE_KEY_NAME);
    if (!apiKey && getProvider() === "gemini") {
      setHasKey(false);
      setLocalError("Add your Google AI Studio key in Settings to generate an overview.");
      return;
    }
    setLocalError(null);
    dismissError();
    startOverviewJob({
      bookId: activeBook.id,
      scope,
      structure: activeStructure,
      semanticMap: activeSemanticMap,
      profile,
      userPrompt: prompt,
      minutes,
      voiceName: voiceId,
    });
  };

  const playArtifact = (artifact: AudioArtifact) => {
    if (activeAudioId === artifact.id && isPlaying) {
      setIsPlaying(false);
      return;
    }
    setActiveAudio(artifact.id);
    setIsPlaying(true);
  };

  if (!activeBook) {
    return (
      <Centered icon={<BookOpen size={20} />} text="Open a book to create an audio overview." />
    );
  }
  if (!activeStructure) {
    return (
      <Centered
        icon={<AudioLines size={20} />}
        text="This book is still being prepared. Once chapters are detected, overviews can be generated."
      />
    );
  }

  if (overviewGenerating) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <span className="flex h-12 w-12 animate-pulse items-center justify-center rounded-xl border border-lumina-gold/20 bg-lumina-gold/[0.06] text-lumina-gold/80">
          <AudioLines size={22} />
        </span>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-ink/85">Generating audio overview</p>
          <p className="text-xs text-ink-faint">
            {jobProgress || "Working…"} You can close this panel — generation continues in
            the background.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-hair px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-lumina-gold/75">
          Audio Overview
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
          A spoken explanation of this book — generated and voiced with Gemini, not read aloud
          word-for-word.
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 scrollbar-thin">
        {!hasKey && (
          <div className="flex items-start gap-2 rounded-xl border border-lumina-gold/28 bg-lumina-gold/[0.055] p-3">
            <Key size={14} className="mt-0.5 shrink-0 text-lumina-gold/75" />
            <p className="text-[11px] leading-relaxed text-ink-faint">
              Audio Overview uses your Google AI Studio key (the same one used for analysis and
              images). Add it in Settings to generate overviews.
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
              {activeStructure.chapters.map((c) => {
                const checked = chosenChapterIds.has(c.id);
                return (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-hair bg-ink/[0.02] px-2.5 py-1.5 text-xs text-ink-soft hover:bg-ink/[0.04]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
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
                );
              })}
            </div>
          )}
        </div>

        {/* Length */}
        <div className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Length</p>
            <p className="text-xs text-lumina-gold/85">~{minutes} min</p>
          </div>
          <input
            type="range"
            min={LUMINA_CONFIG.AUDIO_OVERVIEW_MIN}
            max={LUMINA_CONFIG.AUDIO_OVERVIEW_MAX}
            step={LUMINA_CONFIG.AUDIO_OVERVIEW_STEP}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="mt-2 w-full accent-lumina-gold"
          />
          <p className="mt-1 text-[10px] text-ink-faint">
            Approximate — length is targeted, not exact.
          </p>
        </div>

        {/* Prompt — a window of suggestions that becomes an editor */}
        <div className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
              What should it cover?
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
            promptLabel="Audio overview prompt"
          />

          <p className="mt-1.5 text-[10px] text-ink-faint">
            A suggestion appears as ghost text — press Tab (desktop) or tap Use to accept it, edit
            freely, or leave blank for a full guided overview.
          </p>
        </div>

        {/* Voice */}
        <label className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Voice</span>
          <select
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            className="mt-2 w-full rounded-lg border border-hair bg-surface-dark px-2 py-2 text-xs text-ink-soft focus:outline-none"
          >
            {(getProvider() === "odysseus" ? KOKORO_VOICES : GEMINI_VOICES).map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} — {v.description}
              </option>
            ))}
          </select>
        </label>

        {/* Generate */}
        <button
          onClick={generate}
          disabled={overviewGenerating}
          className="flex items-center justify-center gap-2 rounded-xl border border-lumina-gold/30 bg-lumina-gold/10 px-3 py-3 text-sm font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/15 disabled:cursor-default disabled:border-hair disabled:bg-ink/[0.03] disabled:text-ink-faint"
        >
          <Sparkles size={15} className={overviewGenerating ? "animate-pulse" : ""} />
          {overviewGenerating ? jobProgress || "Generating…" : "Generate Overview"}
        </button>
        <p className="text-center text-[10px] text-ink-faint">
          {getProvider() === "odysseus"
            ? "Runs locally via Odysseus — script and audio generation chained."
            : "Larger generation — uses more of your Google quota than a single image."}
        </p>

        {error && <p className="text-[11px] leading-relaxed text-rose-400/80">{error}</p>}

        {/* Library */}
        <div className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Saved Overviews</p>
          {overviewArtifacts.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-faint">No overviews yet.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {overviewArtifacts.map((artifact) => {
                const actualMin = artifact.durationSeconds
                  ? Math.round(artifact.durationSeconds / 60)
                  : null;
                const targetMin = artifact.overviewMinutes ?? null;
                const durationOk = actualMin !== null && targetMin !== null
                  ? Math.abs(actualMin - targetMin) <= 2
                  : true;
                const isRatingOpen = ratingOpenId === artifact.id;
                const existingRating = getSkillMemory(artifact.id)?.rating;
                const hasRating = ratedIds.has(artifact.id) || Boolean(existingRating);

                return (
                  <div
                    key={artifact.id}
                    className={`group/artifact rounded-lg border transition-colors ${
                      activeAudioId === artifact.id
                        ? "border-lumina-gold/40 bg-lumina-gold/[0.07]"
                        : "border-hair bg-ink/[0.02]"
                    }`}
                  >
                    <div className="flex items-center gap-2 px-2.5 py-2">
                      <button
                        onClick={() => playArtifact(artifact)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-hair text-lumina-gold/80 hover:bg-lumina-gold/10"
                        aria-label={activeAudioId === artifact.id && isPlaying ? "Pause" : "Play"}
                      >
                        {activeAudioId === artifact.id && isPlaying ? (
                          <Pause size={13} />
                        ) : (
                          <Play size={13} />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-ink/85">
                          {artifact.segmentTitle}
                        </p>
                        <p className={`text-[10px] ${durationOk ? "text-ink-faint" : "text-amber-400/80"}`}>
                          {actualMin !== null ? `${actualMin} min actual` : `~${targetMin ?? "?"} min`}
                          {targetMin !== null && actualMin !== null && ` (target ${targetMin})`}
                          {" · "}
                          {(artifact.provider === "local" ? KOKORO_VOICES : GEMINI_VOICES).find(
                            (v) => v.id === artifact.voiceId
                          )?.label ?? artifact.voiceId}
                          {artifact.overviewPrompt ? " · custom" : " · default"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {activeAudioId === artifact.id && (
                          <CheckCircle2 size={14} className="text-lumina-gold/75" />
                        )}
                        {/* Rating toggle — only for local (skill-tracked) overviews */}
                        {artifact.provider === "local" && (
                          <button
                            onClick={() => {
                              if (isRatingOpen) {
                                setRatingOpenId(null);
                              } else {
                                setRatingDraft(existingRating ?? {});
                                setRatingOpenId(artifact.id);
                              }
                            }}
                            className={`rounded p-1 transition-colors ${
                              hasRating
                                ? "text-lumina-gold/60"
                                : "text-ink-faint opacity-0 group-hover/artifact:opacity-100"
                            } hover:text-lumina-gold`}
                            aria-label="Rate overview"
                            title="Rate this overview"
                          >
                            <Star size={12} className={hasRating ? "fill-lumina-gold/40" : ""} />
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            removeArtifact(artifact.id);
                            await storage.deleteAudioArtifact(artifact.id).catch(() => {});
                          }}
                          className="rounded p-1 text-ink-faint opacity-0 transition-opacity hover:text-rose-400 group-hover/artifact:opacity-100"
                          aria-label="Delete overview"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Inline rating form */}
                    {isRatingOpen && (
                      <div className="border-t border-hair px-3 pb-3 pt-2.5">
                        <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                          Rate this overview
                        </p>
                        <div className="space-y-1.5">
                          {(
                            [
                              { key: "duration", label: "Duration", hint: "How close to target length?" },
                              { key: "coverage", label: "Coverage", hint: "Did it cover key concepts?" },
                              { key: "depth",    label: "Depth",    hint: "Were ideas developed fully?" },
                              { key: "flow",     label: "Flow",     hint: "Did it sound natural?" },
                            ] as const
                          ).map(({ key, label, hint }) => (
                            <div key={key} className="flex items-center gap-2">
                              <span className="w-16 shrink-0 text-[10px] text-ink-faint" title={hint}>
                                {label}
                              </span>
                              <div className="flex gap-0.5">
                                {[1, 2, 3, 4, 5].map((v) => (
                                  <button
                                    key={v}
                                    onClick={() => setRatingDraft((d) => ({ ...d, [key]: v }))}
                                    className={`h-4 w-4 rounded-sm transition-colors ${
                                      (ratingDraft[key] ?? 0) >= v
                                        ? "bg-lumina-gold/70"
                                        : "bg-ink/[0.08] hover:bg-lumina-gold/30"
                                    }`}
                                    aria-label={`${label} ${v}/5`}
                                  />
                                ))}
                              </div>
                              <span className="text-[10px] text-ink-faint">
                                {ratingDraft[key] ? `${ratingDraft[key]}/5` : "—"}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Overall quality */}
                        <div className="mt-2 flex gap-1">
                          {(["poor", "ok", "good", "excellent"] as OverallQuality[]).map((q) => (
                            <button
                              key={q}
                              onClick={() => setRatingDraft((d) => ({ ...d, overall: q }))}
                              className={`flex-1 rounded border py-1 text-[10px] capitalize transition-colors ${
                                ratingDraft.overall === q
                                  ? "border-lumina-gold/50 bg-lumina-gold/10 text-lumina-gold"
                                  : "border-hair text-ink-faint hover:text-ink-soft"
                              }`}
                            >
                              {q}
                            </button>
                          ))}
                        </div>

                        {/* Notes */}
                        <input
                          type="text"
                          value={ratingDraft.notes ?? ""}
                          onChange={(e) => setRatingDraft((d) => ({ ...d, notes: e.target.value }))}
                          placeholder="Notes — what was good or off? (optional)"
                          className="mt-2 w-full rounded border border-hair bg-ink/[0.04] px-2 py-1.5 text-[11px] text-ink-soft placeholder-ink-faint/50 focus:outline-none"
                        />

                        <div className="mt-2 flex gap-1.5">
                          <button
                            onClick={() => {
                              if (!ratingDraft.overall) return;
                              const rating: SkillRating = {
                                duration: ratingDraft.duration ?? 3,
                                coverage: ratingDraft.coverage ?? 3,
                                depth:    ratingDraft.depth    ?? 3,
                                flow:     ratingDraft.flow     ?? 3,
                                notes:    ratingDraft.notes    ?? "",
                                overall:  ratingDraft.overall,
                                ratedAt:  Date.now(),
                              };
                              rateSkillRun(artifact.id, rating);
                              setRatedIds((prev) => new Set([...prev, artifact.id]));
                              setRatingOpenId(null);
                            }}
                            disabled={!ratingDraft.overall}
                            className="flex-1 rounded border border-lumina-gold/30 bg-lumina-gold/10 py-1 text-[10px] text-lumina-gold/90 transition-colors hover:bg-lumina-gold/15 disabled:cursor-default disabled:opacity-40"
                          >
                            Save rating
                          </button>
                          <button
                            onClick={() => setRatingOpenId(null)}
                            className="rounded border border-hair px-2 py-1 text-[10px] text-ink-faint hover:text-ink-soft"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
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
