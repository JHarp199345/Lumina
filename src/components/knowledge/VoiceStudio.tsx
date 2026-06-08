import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  BookOpen,
  CheckCircle2,
  Headphones,
  Key,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Volume2,
} from "lucide-react";
import { useAudioStore } from "@/store/audioStore";
import { useBookStore } from "@/store/bookStore";
import { useReaderStore } from "@/store/readerStore";
import { useApiKeys } from "@/hooks/useApiKeys";
import { storage } from "@/storage";
import {
  AUDIO_STYLE_PRESETS,
  ELEVENLABS_KEY_NAME,
  VOICE_PRESETS,
  fetchElevenLabsVoices,
  generateChapterGroupAudio,
  hashText,
  loadCachedElevenLabsVoices,
} from "@/pipeline/audioDirector";
import type { ChapterAudioUnit } from "@/pipeline/audioDirector";
import type { AudioArtifact, AudioStylePreset, AudioVoicePreset, Chapter } from "@/types";

function normalizeNarrationTitle(title: string): string {
  const cleaned = title
    .replace(/\s*[•-]\s*Part\s+\d+\s*$/i, "")
    .replace(/\s+Part\s+\d+\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || title.trim() || "Untitled Chapter";
}

function chapterGroupTextHash(unit: ChapterAudioUnit | null | undefined): string {
  if (!unit) return "";
  const text = unit.chapters
    .map((chapter) => (chapter.rawText ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
  return text ? hashText(text) : "";
}

function buildNarrationChapters(chapters: Chapter[]): ChapterAudioUnit[] {
  const units: ChapterAudioUnit[] = [];

  for (const chapter of chapters) {
    const title = normalizeNarrationTitle(chapter.title || `Chapter ${chapter.index + 1}`);
    const last = units[units.length - 1];
    if (last && last.title === title) {
      last.chapters.push(chapter);
      last.endChapterIndex = chapter.index;
      last.wordCount += chapter.wordCount;
      continue;
    }
    units.push({
      id: `chapter-group-${chapter.index}`,
      title,
      chapters: [chapter],
      startChapterIndex: chapter.index,
      endChapterIndex: chapter.index,
      wordCount: chapter.wordCount,
    });
  }

  return units;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export default function VoiceStudio() {
  const { activeBook, activeStructure } = useBookStore();
  const currentChapterIndex = useReaderStore((s) => s.currentChapterIndex);
  const { saveElevenLabsKey } = useApiKeys();
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const {
    bookId,
    artifacts,
    activeAudioId,
    selectedVoiceId,
    selectedStylePresetId,
    isPlaying,
    isGenerating,
    currentTime,
    duration,
    volume,
    playbackRate,
    queue,
    error,
    mount,
    addArtifact,
    setActiveSegment,
    setActiveAudio,
    setVoice,
    setStylePreset,
    setIsPlaying,
    setIsGenerating,
    setProgress,
    setPlaybackPosition,
    setActiveReadAlong,
    setVolume,
    setPlaybackRate,
    setListenAlongMode,
    queueSegment,
    setError,
  } = useAudioStore();
  const listenAlongMode = useAudioStore((s) => s.listenAlongMode);

  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [voices, setVoices] = useState<AudioVoicePreset[]>(() => {
    const cached = loadCachedElevenLabsVoices();
    return cached.length > 0 ? cached : VOICE_PRESETS;
  });
  const [voiceQuery, setVoiceQuery] = useState("");
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [hasVoiceKey, setHasVoiceKey] = useState(false);
  const [showKeyPrompt, setShowKeyPrompt] = useState(false);
  const [voiceKeyInput, setVoiceKeyInput] = useState("");
  const [voiceKeyError, setVoiceKeyError] = useState<string | null>(null);
  const [isSavingVoiceKey, setIsSavingVoiceKey] = useState(false);

  useEffect(() => {
    let cancelled = false;
    storage.loadApiKey(ELEVENLABS_KEY_NAME).then((key) => {
      if (cancelled) return;
      const exists = Boolean(key);
      setHasVoiceKey(exists);
      setShowKeyPrompt(!exists);
    }).catch(() => {
      if (!cancelled) setShowKeyPrompt(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!activeBook) return;
    if (bookId === activeBook.id) return;
    storage.loadAudioArtifacts(activeBook.id).then((loaded) => {
      if (!cancelled) mount(activeBook.id, loaded);
    }).catch(() => {
      if (!cancelled) mount(activeBook.id, []);
    });
    return () => {
      cancelled = true;
    };
  }, [activeBook, bookId, mount]);

  const chapters = activeStructure?.chapters ?? [];
  const narrationChapters = useMemo(() => buildNarrationChapters(chapters), [chapters]);
  const currentNarrationChapter = useMemo(() => {
    if (narrationChapters.length === 0) return null;
    return (
      narrationChapters.find(
        (unit) => currentChapterIndex >= unit.startChapterIndex && currentChapterIndex <= unit.endChapterIndex
      ) ?? narrationChapters[0]
    );
  }, [currentChapterIndex, narrationChapters]);

  useEffect(() => {
    if (selectedUnitId === null && currentNarrationChapter) {
      setSelectedUnitId(currentNarrationChapter.id);
      setActiveSegment(currentNarrationChapter.id);
    }
  }, [currentNarrationChapter, selectedUnitId, setActiveSegment]);

  useEffect(() => {
    setSelectedUnitId(null);
    setActiveAudio(null);
  }, [activeBook?.id, setActiveAudio]);

  const selectedUnit =
    narrationChapters.find((unit) => unit.id === selectedUnitId) ?? currentNarrationChapter;
  const selectedVoice = voices.find((voice) => voice.id === selectedVoiceId) ?? voices[0] ?? VOICE_PRESETS[0];
  const selectedStyle =
    AUDIO_STYLE_PRESETS.find((style) => style.id === selectedStylePresetId) ?? AUDIO_STYLE_PRESETS[0];

  useEffect(() => {
    if (selectedUnit) setActiveSegment(selectedUnit.id);
  }, [selectedUnit, setActiveSegment]);

  useEffect(() => {
    if (selectedVoiceId === "kore" && voices[0]?.id) setVoice(voices[0].id);
  }, [selectedVoiceId, setVoice, voices]);

  const matchingArtifact = useMemo(() => {
    if (!selectedUnit) return null;
    const textHash = chapterGroupTextHash(selectedUnit);
    const chapterArtifacts = artifacts
      .filter(
        (artifact) =>
          artifact.status === "ready" &&
          (artifact.provider ?? "gemini") === "elevenlabs" &&
          (artifact.scope ?? (artifact.segmentId.startsWith("chapter-") ? "chapter" : "segment")) === "chapter" &&
          artifact.segmentId === selectedUnit.id &&
          (!textHash || artifact.textHash === textHash)
      )
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
    const exactArtifact = chapterArtifacts.find(
      (artifact) =>
        (artifact.voiceProviderId ?? artifact.voiceId) === selectedVoice.providerVoiceName &&
        artifact.stylePresetId === selectedStyle.id
    );
    return (
      exactArtifact ?? chapterArtifacts[0] ?? null
    );
  }, [artifacts, selectedStyle.id, selectedUnit, selectedVoice.id, selectedVoice.providerVoiceName]);

  const activeArtifact = artifacts.find((artifact) => artifact.id === activeAudioId) ?? matchingArtifact;

  const findVoiceIdForArtifact = (artifact: AudioArtifact) =>
    voices.find((voice) => voice.id === artifact.voiceId)?.id ??
    voices.find((voice) => voice.providerVoiceName === artifact.voiceProviderId)?.id ??
    voices.find((voice) => voice.id === artifact.voiceProviderId)?.id ??
    null;

  const selectAudioArtifact = (artifact: AudioArtifact) => {
    const artifactVoiceId = findVoiceIdForArtifact(artifact);
    if (artifactVoiceId && selectedVoiceId !== artifactVoiceId) {
      setVoice(artifactVoiceId);
    }
    if (artifact.stylePresetId && selectedStylePresetId !== artifact.stylePresetId) {
      setStylePreset(artifact.stylePresetId);
    }
    setActiveAudio(artifact.id);
  };

  useEffect(() => {
    if (!matchingArtifact || activeAudioId) return;
    setActiveAudio(matchingArtifact.id);
  }, [activeAudioId, matchingArtifact, setActiveAudio]);

  useEffect(() => {
    if (!activeArtifact) return;
    const artifactVoiceId = findVoiceIdForArtifact(activeArtifact);
    if (artifactVoiceId && selectedVoiceId !== artifactVoiceId) {
      setVoice(artifactVoiceId);
    }
    if (activeArtifact.stylePresetId && selectedStylePresetId !== activeArtifact.stylePresetId) {
      setStylePreset(activeArtifact.stylePresetId);
    }
  }, [activeArtifact, selectedStylePresetId, selectedVoiceId, setStylePreset, setVoice, voices]);

  const refreshVoices = async () => {
    const apiKey = await storage.loadApiKey(ELEVENLABS_KEY_NAME);
    if (!apiKey) {
      setShowKeyPrompt(true);
      setError("Add an ElevenLabs key to load voices.");
      return;
    }
    setError(null);
    setIsLoadingVoices(true);
    try {
      const loaded = await fetchElevenLabsVoices(apiKey);
      setVoices(loaded);
      if (!loaded.some((voice) => voice.id === selectedVoiceId)) setVoice(loaded[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load ElevenLabs voices.");
    } finally {
      setIsLoadingVoices(false);
    }
  };

  const runGenerate = async (mode: "saved" | "streamed" = "saved", force = false) => {
    if (!selectedUnit || !activeStructure) {
      setError("Choose a chapter first.");
      return;
    }
    if (matchingArtifact && !force) {
      selectAudioArtifact(matchingArtifact);
      return;
    }
    const apiKey = await storage.loadApiKey(ELEVENLABS_KEY_NAME);
    if (!apiKey) {
      setShowKeyPrompt(true);
      setError("Add an ElevenLabs key to generate narration.");
      return;
    }
    setError(null);
    setIsGenerating(true);
    setProgress(mode === "streamed" ? "Streaming narration" : "Generating narration");
    try {
      const generated = await generateChapterGroupAudio({
        unit: selectedUnit,
        structure: activeStructure,
        apiKey,
        voice: selectedVoice,
        style: selectedStyle,
        mode,
        onProgress: setProgress,
      });
      setProgress("Saving audio");
      const filePath = await storage.saveAudioArtifact(generated.artifact, generated.data);
      const artifact: AudioArtifact = { ...generated.artifact, filePath };
      addArtifact(artifact);
      setActiveAudio(artifact.id);
      if (mode === "streamed") {
        setIsPlaying(true);
      }
    } catch (err) {
      console.error("[VoiceStudio] Audio generation failed:", err);
      setError(err instanceof Error ? err.message : "Narration generation failed.");
    } finally {
      setIsGenerating(false);
      setProgress("");
    }
  };

  const playOrPause = async () => {
    if (!activeArtifact) return;
    if (isPlaying) {
      setIsPlaying(false);
      setActiveReadAlong(null);
      return;
    }
    setActiveAudio(activeArtifact.id);
    setIsPlaying(true);
  };

  const stopPlayback = () => {
    setIsPlaying(false);
    setPlaybackPosition(0, duration);
    setActiveReadAlong(null);
    setActiveAudio(null);
  };

  const queueNext = () => {
    if (!selectedUnit) return;
    const index = narrationChapters.findIndex((unit) => unit.id === selectedUnit.id);
    const next = narrationChapters[index + 1];
    if (next) {
      setSelectedUnitId(next.id);
      setActiveSegment(next.id);
      queueSegment(next.id);
      setActiveAudio(null);
    }
  };

  const playVoicePreview = async (voice: AudioVoicePreset) => {
    if (!voice.previewUrl) return;
    previewAudioRef.current?.pause();
    const audio = new Audio(voice.previewUrl);
    previewAudioRef.current = audio;
    setActiveReadAlong(null);
    audio.volume = volume;
    audio.playbackRate = 1;
    await audio.play();
  };

  const saveInlineVoiceKey = async () => {
    if (!voiceKeyInput.trim()) return;
    setVoiceKeyError(null);
    setIsSavingVoiceKey(true);
    try {
      await saveElevenLabsKey(voiceKeyInput.trim());
      const loaded = loadCachedElevenLabsVoices();
      if (loaded.length > 0) {
        setVoices(loaded);
        setVoice(loaded[0].id);
      }
      setHasVoiceKey(true);
      setShowKeyPrompt(false);
      setVoiceKeyInput("");
      setError(null);
    } catch (err) {
      setVoiceKeyError(err instanceof Error ? err.message : "Could not validate ElevenLabs key.");
    } finally {
      setIsSavingVoiceKey(false);
    }
  };

  if (!activeBook) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-hair bg-ink/[0.04] text-ink-faint">
          <BookOpen size={20} />
        </span>
        <p className="text-sm text-ink-soft">Open a book to use Voice Studio.</p>
      </div>
    );
  }

  if (!activeStructure || narrationChapters.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-lumina-gold/20 bg-lumina-gold/[0.06] text-lumina-gold/80">
          <Headphones size={22} />
        </span>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-ink/85">Voice Needs a Readable Book</p>
          <p className="max-w-xs text-xs leading-relaxed text-ink-faint">
            Open an imported book with detected chapters and Voice Studio will build its own audio library.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-hair px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-lumina-gold/75">Voice Studio</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
          Generate timestamped narration using your ElevenLabs voices.
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 scrollbar-thin">
        {showKeyPrompt && (
          <div className="rounded-xl border border-lumina-gold/28 bg-lumina-gold/[0.055] p-3">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <Key size={14} className="mt-0.5 shrink-0 text-lumina-gold/75" />
                <div>
                  <p className="text-xs font-medium text-ink/85">Connect ElevenLabs</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                    Voice Studio needs an ElevenLabs key for voices, narration, and read-along timing.
                  </p>
                </div>
              </div>
              {hasVoiceKey && (
                <button
                  onClick={() => setShowKeyPrompt(false)}
                  className="text-[11px] text-ink-faint hover:text-ink-soft"
                >
                  Dismiss
                </button>
              )}
            </div>
            <input
              type="password"
              value={voiceKeyInput}
              onChange={(event) => {
                setVoiceKeyInput(event.target.value);
                setVoiceKeyError(null);
              }}
              placeholder="Paste ElevenLabs API key"
              className="w-full rounded-lg border border-hair bg-surface-dark px-3 py-2 text-xs text-ink-soft placeholder:text-ink-faint focus:outline-none"
            />
            {voiceKeyError && <p className="mt-2 text-[11px] text-rose-400/80">{voiceKeyError}</p>}
            <div className="mt-2 flex gap-2">
              <button
                onClick={saveInlineVoiceKey}
                disabled={!voiceKeyInput.trim() || isSavingVoiceKey}
                className="flex-1 rounded-lg border border-lumina-gold/35 bg-lumina-gold/12 px-3 py-2 text-xs font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/16 disabled:opacity-40"
              >
                {isSavingVoiceKey ? "Validating..." : "Save & Load Voices"}
              </button>
              <button
                onClick={() => setShowKeyPrompt(false)}
                className="rounded-lg border border-hair px-3 py-2 text-xs text-ink-faint transition-colors hover:text-ink-soft"
              >
                Preview Studio
              </button>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Chapter</p>
          <select
            value={selectedUnit?.id ?? ""}
            onChange={(event) => {
              setSelectedUnitId(event.target.value);
              setActiveSegment(event.target.value);
              setActiveAudio(null);
            }}
            className="mt-2 w-full rounded-lg border border-hair bg-surface-dark px-3 py-2 text-xs text-ink-soft focus:outline-none"
          >
            {narrationChapters.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.title}
              </option>
            ))}
          </select>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            Voice Studio saves narration as chapter audio, separate from Study Guide segments.
            {selectedUnit ? ` ${selectedUnit.wordCount.toLocaleString()} words in this chapter.` : ""}
          </p>
        </div>

        <div className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Voice</p>
            <button
              onClick={refreshVoices}
              disabled={isLoadingVoices}
              className="flex items-center gap-1 rounded border border-hair px-2 py-1 text-[10px] text-ink-faint hover:text-ink-soft disabled:opacity-40"
            >
              <RefreshCw size={10} className={isLoadingVoices ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
          <input
            value={voiceQuery}
            onChange={(event) => setVoiceQuery(event.target.value)}
            placeholder="Search voices"
            className="mb-2 w-full rounded-lg border border-hair bg-surface-dark px-2 py-2 text-xs text-ink-soft placeholder:text-ink-faint focus:outline-none"
          />
          <div className="max-h-48 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
            {voices
              .filter((voice) => {
                const q = voiceQuery.trim().toLowerCase();
                if (!q) return true;
                return `${voice.displayName} ${voice.description} ${voice.category ?? ""}`.toLowerCase().includes(q);
              })
              .map((voice) => (
                <div
                  key={voice.id}
                  className={`flex gap-2 rounded-lg border px-2.5 py-2 transition-colors ${
                    selectedVoice.id === voice.id
                      ? "border-lumina-gold/40 bg-lumina-gold/[0.08]"
                      : "border-hair bg-ink/[0.02] hover:bg-ink/[0.04]"
                  }`}
                >
                  <button className="min-w-0 flex-1 text-left" onClick={() => setVoice(voice.id)}>
                    <span className="block truncate text-xs font-medium text-ink/85">{voice.displayName}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-ink-faint">{voice.description}</span>
                  </button>
                  {voice.previewUrl && (
                    <button
                      onClick={() => playVoicePreview(voice)}
                      className="shrink-0 rounded border border-hair px-2 text-[10px] text-lumina-gold/70 hover:text-lumina-gold"
                    >
                      Preview
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <PresetSelect
            label="Style"
            value={selectedStyle.id}
            options={AUDIO_STYLE_PRESETS}
            onChange={setStylePreset}
          />
        </div>

        <div className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Listen Along</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                {listenAlongMode
                  ? "Continuous-scroll listening is selected."
                  : "Paged read-along will turn pages while narration plays."}
              </p>
            </div>
            <button
              onClick={() => setListenAlongMode(!listenAlongMode)}
              className={`relative mt-1 h-6 w-11 rounded-full border transition-colors ${
                listenAlongMode
                  ? "border-lumina-gold/45 bg-lumina-gold/24"
                  : "border-hair bg-ink/[0.05]"
              }`}
              aria-pressed={listenAlongMode}
              aria-label="Toggle listen along mode"
            >
              <span
                className={`absolute top-1 h-4 w-4 rounded-full bg-ink-soft transition-transform ${
                  listenAlongMode ? "translate-x-5" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-lumina-gold/24 bg-lumina-gold/[0.045] p-3">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.14em] text-lumina-gold/70">
                {matchingArtifact ? "Cached Narration" : "Not Generated"}
              </p>
              <p className="mt-1 truncate text-sm font-medium text-ink/88">
                {selectedUnit?.title ?? "Choose a chapter"}
              </p>
            </div>
            {matchingArtifact && <CheckCircle2 size={16} className="shrink-0 text-lumina-gold/75" />}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={playOrPause}
              disabled={!activeArtifact}
              className="flex items-center justify-center gap-2 rounded-lg border border-hair bg-ink/[0.03] px-3 py-2.5 text-xs font-medium text-ink-soft transition-colors hover:bg-ink/[0.05] disabled:cursor-default disabled:opacity-45"
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              onClick={() => runGenerate("saved")}
              disabled={isGenerating || !selectedUnit}
              className="flex items-center justify-center gap-2 rounded-lg border border-lumina-gold/30 bg-lumina-gold/10 px-3 py-2.5 text-xs font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/15 disabled:cursor-default disabled:border-hair disabled:bg-ink/[0.03] disabled:text-ink-faint"
            >
              {isGenerating ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {matchingArtifact ? "Use Cache" : isGenerating ? "Generating" : "Generate"}
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              onClick={stopPlayback}
              disabled={!activeArtifact && !isPlaying}
              className="rounded-lg border border-hair bg-ink/[0.03] px-3 py-2 text-xs text-ink-faint transition-colors hover:text-ink-soft disabled:opacity-40"
            >
              Stop
            </button>
            <button
              onClick={() => runGenerate("streamed", true)}
              disabled={isGenerating || !selectedUnit}
              className="rounded-lg border border-hair bg-ink/[0.03] px-3 py-2 text-xs text-ink-faint transition-colors hover:text-ink-soft disabled:opacity-40"
            >
              Stream Now
            </button>
            <button
              onClick={() => runGenerate("saved", true)}
              disabled={isGenerating || !selectedUnit}
              className="rounded-lg border border-hair bg-ink/[0.03] px-3 py-2 text-xs text-ink-faint transition-colors hover:text-ink-soft disabled:opacity-40"
            >
              Regenerate Explicitly
            </button>
          </div>

          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/20">
            <div
              className="h-full rounded-full bg-lumina-gold/70"
              style={{ width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            <AudioLines size={13} />
            Playback
          </div>
          <SliderRow
            icon={<Volume2 size={13} />}
            label="Volume"
            value={volume}
            min={0}
            max={1}
            step={0.05}
            display={`${Math.round(volume * 100)}%`}
            onChange={setVolume}
          />
          <SliderRow
            icon={<Headphones size={13} />}
            label="Speed"
            value={playbackRate}
            min={0.5}
            max={2}
            step={0.05}
            display={`${playbackRate.toFixed(2)}x`}
            onChange={setPlaybackRate}
          />
          <button
            onClick={queueNext}
            className="mt-3 w-full rounded-lg border border-hair px-3 py-2 text-xs text-ink-faint transition-colors hover:text-ink-soft"
          >
            Queue Next Chapter {queue.length > 0 ? `(${queue.length})` : ""}
          </button>
        </div>

        <div className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Voice Library</p>
          {artifacts.length === 0 ? (
            <p className="py-5 text-center text-xs text-ink-faint">No narration saved yet.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {artifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  onClick={() => selectAudioArtifact(artifact)}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    activeAudioId === artifact.id
                      ? "border-lumina-gold/40 bg-lumina-gold/[0.07]"
                      : "border-hair bg-ink/[0.02] hover:bg-ink/[0.04]"
                  }`}
                >
                  <span className="block truncate text-[12px] font-medium text-ink/85">
                    {artifact.segmentTitle}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-ink-faint">
                    {artifact.scope ?? "segment"} · {artifact.provider ?? "gemini"} · {artifact.voiceId} · {artifact.mode ?? "saved"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-[11px] leading-relaxed text-rose-400/80">{error}</p>}
      </div>
    </div>
  );
}

function PresetSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<AudioVoicePreset | AudioStylePreset>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="rounded-xl border border-hair bg-ink/[0.025] p-3">
      <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-lg border border-hair bg-surface-dark px-2 py-2 text-xs text-ink-soft focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}

function SliderRow({
  icon,
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[11px] text-ink-faint">
      <span className="text-lumina-gold/65">{icon}</span>
      <span>{label}</span>
      <span>{display}</span>
      <input
        value={value}
        min={min}
        max={max}
        step={step}
        type="range"
        onChange={(event) => onChange(Number(event.target.value))}
        className="col-span-3 accent-lumina-gold"
      />
    </label>
  );
}
