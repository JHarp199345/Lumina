import { useEffect, useMemo, useState } from "react";
import {
  AudioLines,
  BookOpen,
  CheckCircle2,
  Key,
  Pause,
  Play,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useAudioStore } from "@/store/audioStore";
import { useBookStore } from "@/store/bookStore";
import { useReaderStore } from "@/store/readerStore";
import { storage } from "@/storage";
import { LUMINA_CONFIG } from "@/config";
import {
  GEMINI_VOICES,
  GOOGLE_KEY_NAME,
  buildScopeOutline,
  generateAudioOverview,
  scopeLabel,
  suggestOutline,
  type OverviewScope,
} from "@/pipeline/audioOverview";
import type { AudioArtifact } from "@/types";

export default function AudioOverview() {
  const { activeBook, activeStructure, activeSemanticMap } = useBookStore();
  const currentChapterIndex = useReaderStore((s) => s.currentChapterIndex);
  const {
    bookId,
    artifacts,
    activeAudioId,
    isPlaying,
    isGenerating,
    generationProgress,
    error,
    mount,
    addArtifact,
    setActiveAudio,
    setIsPlaying,
    setIsGenerating,
    setProgress,
    setError,
  } = useAudioStore();

  const [scopeType, setScopeType] = useState<OverviewScope["type"]>("whole");
  const [chosenChapterIds, setChosenChapterIds] = useState<Set<string>>(new Set());
  const [minutes, setMinutes] = useState<number>(LUMINA_CONFIG.AUDIO_OVERVIEW_DEFAULT_MIN);
  const [voiceId, setVoiceId] = useState<string>(LUMINA_CONFIG.AUDIO_OVERVIEW_DEFAULT_VOICE);
  const [prompt, setPrompt] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [hasKey, setHasKey] = useState(true);

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

  // Key check.
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

  // Recompute the instant (Tier-1) ghost outline whenever scope/book changes.
  useEffect(() => {
    if (!activeStructure) {
      setSuggestion("");
      return;
    }
    setSuggestion(buildScopeOutline(scope, activeStructure, activeSemanticMap));
  }, [scope, activeStructure, activeSemanticMap]);

  const overviewArtifacts = useMemo(
    () =>
      artifacts
        .filter((a) => a.scope === "overview" && a.status === "ready")
        .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()),
    [artifacts]
  );
  const activeArtifact = artifacts.find((a) => a.id === activeAudioId) ?? null;

  const requestFullerSuggestion = async () => {
    if (!activeStructure) return;
    const apiKey = await storage.loadApiKey(GOOGLE_KEY_NAME);
    if (!apiKey) {
      setHasKey(false);
      return;
    }
    setIsSuggesting(true);
    try {
      const fuller = await suggestOutline(scope, activeStructure, activeSemanticMap, apiKey);
      if (fuller) setSuggestion(fuller);
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
      setError("Add your Google AI Studio key in Settings to generate an overview.");
      return;
    }
    setError(null);
    setIsGenerating(true);
    setProgress("Summarizing the material…");
    try {
      const { script, audio } = await generateAudioOverview({
        scope,
        structure: activeStructure,
        semanticMap: activeSemanticMap,
        userPrompt: prompt,
        minutes,
        apiKey,
        voiceName: voiceId,
        onProgress: setProgress,
      });

      setProgress("Saving overview…");
      const id = `audio-overview-${Date.now()}`;
      const meta: Omit<AudioArtifact, "filePath"> = {
        id,
        bookId: activeBook.id,
        segmentId: id,
        chapterIndex: scopeType === "current" ? Math.max(0, currentChapterIndex) : 0,
        segmentTitle: scopeLabel(scope, activeStructure),
        voiceId,
        provider: "gemini",
        scope: "overview",
        voiceProviderId: voiceId,
        modelId: LUMINA_CONFIG.GEMINI_TTS_MODEL,
        mode: "saved",
        stylePresetId: "overview",
        textHash: "",
        promptHash: "",
        mimeType: audio.mimeType,
        durationSeconds: audio.durationSeconds,
        generatedAt: new Date().toISOString(),
        generationApi: "gemini-tts",
        status: "ready",
        overviewMinutes: minutes,
        overviewPrompt: prompt.trim(),
        overviewScript: script,
      };
      const filePath = await storage.saveAudioArtifact(meta, audio.data);
      const artifact: AudioArtifact = { ...meta, filePath };
      addArtifact(artifact);
      setActiveAudio(artifact.id);
      setIsPlaying(true);
    } catch (err) {
      console.error("[AudioOverview] generation failed:", err);
      setError(err instanceof Error ? err.message : "Overview generation failed.");
    } finally {
      setIsGenerating(false);
      setProgress("");
    }
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

        {/* Prompt + ghost suggestion */}
        <div className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
              What should it cover?
            </p>
            <button
              onClick={requestFullerSuggestion}
              disabled={isSuggesting}
              className="flex items-center gap-1 rounded border border-hair px-2 py-1 text-[10px] text-lumina-gold/75 transition-colors hover:text-lumina-gold disabled:opacity-40"
            >
              <Wand2 size={10} className={isSuggesting ? "animate-pulse" : ""} />
              {isSuggesting ? "Thinking…" : "Suggest fuller"}
            </button>
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Leave empty for a full guided overview…"
            rows={4}
            className="w-full resize-none rounded-lg border border-hair bg-surface-dark px-3 py-2 text-xs leading-relaxed text-ink-soft placeholder:text-ink-faint focus:outline-none"
          />

          {prompt.trim().length === 0 && suggestion && (
            <div className="mt-2 rounded-lg border border-dashed border-lumina-gold/25 bg-lumina-gold/[0.04] p-2.5">
              <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-lumina-gold/60">
                Suggested outline (from this book)
              </p>
              <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-ink-faint scrollbar-thin">
                {suggestion}
              </p>
              <button
                onClick={() => setPrompt(suggestion)}
                className="mt-2 rounded-md border border-lumina-gold/30 bg-lumina-gold/10 px-2.5 py-1 text-[10px] font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/16"
              >
                Use this outline
              </button>
            </div>
          )}
        </div>

        {/* Voice */}
        <label className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Voice</span>
          <select
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            className="mt-2 w-full rounded-lg border border-hair bg-surface-dark px-2 py-2 text-xs text-ink-soft focus:outline-none"
          >
            {GEMINI_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} — {v.description}
              </option>
            ))}
          </select>
        </label>

        {/* Generate */}
        <button
          onClick={generate}
          disabled={isGenerating}
          className="flex items-center justify-center gap-2 rounded-xl border border-lumina-gold/30 bg-lumina-gold/10 px-3 py-3 text-sm font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/15 disabled:cursor-default disabled:border-hair disabled:bg-ink/[0.03] disabled:text-ink-faint"
        >
          <Sparkles size={15} className={isGenerating ? "animate-pulse" : ""} />
          {isGenerating ? generationProgress || "Generating…" : "Generate Overview"}
        </button>
        <p className="text-center text-[10px] text-ink-faint">
          Larger generation — uses more of your Google quota than a single image.
        </p>

        {error && <p className="text-[11px] leading-relaxed text-rose-400/80">{error}</p>}

        {/* Library */}
        <div className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Saved Overviews</p>
          {overviewArtifacts.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-faint">No overviews yet.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {overviewArtifacts.map((artifact) => (
                <div
                  key={artifact.id}
                  className={`rounded-lg border px-2.5 py-2 transition-colors ${
                    activeAudioId === artifact.id
                      ? "border-lumina-gold/40 bg-lumina-gold/[0.07]"
                      : "border-hair bg-ink/[0.02]"
                  }`}
                >
                  <div className="flex items-center gap-2">
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
                      <p className="text-[10px] text-ink-faint">
                        ~{artifact.overviewMinutes ?? "?"} min · {artifact.voiceId}
                        {artifact.overviewPrompt ? " · custom" : " · default"}
                      </p>
                    </div>
                    {activeAudioId === artifact.id && (
                      <CheckCircle2 size={14} className="shrink-0 text-lumina-gold/75" />
                    )}
                  </div>
                </div>
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
