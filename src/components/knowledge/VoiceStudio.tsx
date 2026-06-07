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
import { useDrawerStore } from "@/store/drawerStore";
import { useReaderStore } from "@/store/readerStore";
import { useStudyStore } from "@/store/studyStore";
import { useApiKeys } from "@/hooks/useApiKeys";
import { storage } from "@/storage";
import {
  AUDIO_STYLE_PRESETS,
  ELEVENLABS_KEY_NAME,
  VOICE_PRESETS,
  fetchElevenLabsVoices,
  generateSegmentAudio,
  hashText,
  loadCachedElevenLabsVoices,
} from "@/pipeline/audioDirector";
import type { AudioArtifact, AudioStylePreset, AudioVoicePreset, StudySegment } from "@/types";

function segmentTextHash(segment: StudySegment, rawText: string | undefined): string {
  if (!rawText) return "";
  const words = rawText.split(/\s+/).filter(Boolean);
  return hashText(words.slice(segment.startWordOffset, segment.endWordOffset).join(" ").slice(0, 8500));
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function findCurrentSegment(segments: StudySegment[], wordPosition: number): StudySegment | null {
  if (segments.length === 0) return null;
  return (
    segments.find(
      (segment) => wordPosition >= segment.approxWordStart && wordPosition <= segment.approxWordEnd
    ) ??
    [...segments].reverse().find((segment) => segment.approxWordStart <= wordPosition) ??
    segments[0]
  );
}

export default function VoiceStudio() {
  const { activeBook, activeStructure } = useBookStore();
  const { guide } = useStudyStore();
  const wordPosition = useReaderStore((s) => s.wordPosition);
  const setDrawerView = useDrawerStore((s) => s.setView);
  const { saveElevenLabsKey } = useApiKeys();
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
    queueSegment,
    setError,
  } = useAudioStore();

  const currentGuide = guide && activeBook && guide.bookId === activeBook.id ? guide : null;
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
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

  const currentSegment = useMemo(() => {
    if (!currentGuide) return null;
    return findCurrentSegment(currentGuide.segments, wordPosition);
  }, [currentGuide, wordPosition]);

  useEffect(() => {
    if (!selectedSegmentId && currentSegment) {
      setSelectedSegmentId(currentSegment.id);
      setActiveSegment(currentSegment.id);
    }
  }, [currentSegment, selectedSegmentId, setActiveSegment]);

  const selectedSegment =
    currentGuide?.segments.find((segment) => segment.id === selectedSegmentId) ?? currentSegment;
  const selectedVoice = voices.find((voice) => voice.id === selectedVoiceId) ?? voices[0] ?? VOICE_PRESETS[0];
  const selectedStyle =
    AUDIO_STYLE_PRESETS.find((style) => style.id === selectedStylePresetId) ?? AUDIO_STYLE_PRESETS[0];

  useEffect(() => {
    if (selectedVoiceId === "kore" && voices[0]?.id) setVoice(voices[0].id);
  }, [selectedVoiceId, setVoice, voices]);

  const matchingArtifact = useMemo(() => {
    if (!selectedSegment || !activeStructure) return null;
    const chapter = activeStructure.chapters.find((item) => item.index === selectedSegment.chapterIndex);
    const textHash = segmentTextHash(selectedSegment, chapter?.rawText);
    return (
      artifacts.find(
        (artifact) =>
          artifact.status === "ready" &&
          (artifact.provider ?? "gemini") === "elevenlabs" &&
          artifact.segmentId === selectedSegment.id &&
          (artifact.voiceProviderId ?? artifact.voiceId) === selectedVoice.providerVoiceName &&
          artifact.stylePresetId === selectedStyle.id &&
          (!textHash || artifact.textHash === textHash)
      ) ?? null
    );
  }, [activeStructure, artifacts, selectedSegment, selectedStyle.id, selectedVoice.id]);

  const activeArtifact = artifacts.find((artifact) => artifact.id === activeAudioId) ?? matchingArtifact;

  useEffect(() => {
    if (!matchingArtifact || activeAudioId) return;
    setActiveAudio(matchingArtifact.id);
  }, [activeAudioId, matchingArtifact, setActiveAudio]);

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
    if (!selectedSegment || !activeStructure) {
      setError("Choose a segment first.");
      return;
    }
    if (matchingArtifact && !force) {
      setActiveAudio(matchingArtifact.id);
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
      const generated = await generateSegmentAudio({
        segment: selectedSegment,
        structure: activeStructure,
        apiKey,
        voice: selectedVoice,
        style: selectedStyle,
        mode,
      });
      setProgress("Saving audio");
      const filePath = await storage.saveAudioArtifact(generated.artifact, generated.data);
      const artifact: AudioArtifact = { ...generated.artifact, filePath };
      addArtifact(artifact);
      setActiveAudio(artifact.id);
      if (mode === "streamed") {
        setTimeout(() => {
          const audio = audioRef.current;
          if (!audio) return;
          audio.src = artifact.filePath;
          audio.volume = volume;
          audio.playbackRate = playbackRate;
          audio.play().then(() => setIsPlaying(true)).catch(() => {});
        }, 0);
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
    const audio = audioRef.current;
    if (!audio || !activeArtifact) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    audio.src = activeArtifact.filePath;
    audio.volume = volume;
    audio.playbackRate = playbackRate;
    await audio.play();
    setIsPlaying(true);
  };

  const updateReadAlong = (audio: HTMLAudioElement, artifact: AudioArtifact | null) => {
    setPlaybackPosition(audio.currentTime, audio.duration);
    if (!artifact?.alignment?.length) {
      setActiveReadAlong(null);
      return;
    }
    const nowMs = audio.currentTime * 1000;
    const span =
      artifact.alignment.find((item) => nowMs >= item.startMs && nowMs <= item.endMs) ??
      artifact.alignment.find((item) => item.startMs > nowMs) ??
      null;
    if (!span) {
      setActiveReadAlong(null);
      return;
    }
    setActiveReadAlong(span.absoluteWordStart, span.text);
  };

  const queueNext = () => {
    if (!currentGuide || !selectedSegment) return;
    const index = currentGuide.segments.findIndex((segment) => segment.id === selectedSegment.id);
    const next = currentGuide.segments[index + 1];
    if (next) queueSegment(next.id);
  };

  const playVoicePreview = async (voice: AudioVoicePreset) => {
    if (!voice.previewUrl || !audioRef.current) return;
    const audio = audioRef.current;
    audio.pause();
    audio.src = voice.previewUrl;
    audio.volume = volume;
    audio.playbackRate = 1;
    await audio.play();
    setIsPlaying(true);
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

  if (!currentGuide) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-lumina-gold/20 bg-lumina-gold/[0.06] text-lumina-gold/80">
          <Headphones size={22} />
        </span>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-ink/85">Voice Needs a Study Guide</p>
          <p className="max-w-xs text-xs leading-relaxed text-ink-faint">
            Narration is generated from saved Study Guide segments so audio stays organized.
          </p>
        </div>
        <button
          onClick={() => setDrawerView("study-guide")}
          className="flex items-center gap-2 rounded-lg border border-lumina-gold/30 bg-lumina-gold/10 px-4 py-2.5 text-xs font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/15"
        >
          <Sparkles size={14} />
          Open Study Guide
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <audio
        ref={audioRef}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          updateReadAlong(audio, activeArtifact);
        }}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          setPlaybackPosition(audio.currentTime, audio.duration);
        }}
        onEnded={() => {
          setIsPlaying(false);
          setActiveReadAlong(null);
        }}
      />

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
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Segment</p>
          <select
            value={selectedSegment?.id ?? ""}
            onChange={(event) => {
              setSelectedSegmentId(event.target.value);
              setActiveSegment(event.target.value);
              setActiveAudio(null);
            }}
            className="mt-2 w-full rounded-lg border border-hair bg-surface-dark px-3 py-2 text-xs text-ink-soft focus:outline-none"
          >
            {currentGuide.segments.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.title}
              </option>
            ))}
          </select>
          {selectedSegment?.summary && (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">{selectedSegment.summary}</p>
          )}
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

        <div className="rounded-xl border border-lumina-gold/24 bg-lumina-gold/[0.045] p-3">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.14em] text-lumina-gold/70">
                {matchingArtifact ? "Cached Narration" : "Not Generated"}
              </p>
              <p className="mt-1 truncate text-sm font-medium text-ink/88">
                {selectedSegment?.title ?? "Choose a segment"}
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
              disabled={isGenerating || !selectedSegment}
              className="flex items-center justify-center gap-2 rounded-lg border border-lumina-gold/30 bg-lumina-gold/10 px-3 py-2.5 text-xs font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/15 disabled:cursor-default disabled:border-hair disabled:bg-ink/[0.03] disabled:text-ink-faint"
            >
              {isGenerating ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {matchingArtifact ? "Use Cache" : isGenerating ? "Generating" : "Generate"}
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              onClick={() => runGenerate("streamed", true)}
              disabled={isGenerating || !selectedSegment}
              className="rounded-lg border border-hair bg-ink/[0.03] px-3 py-2 text-xs text-ink-faint transition-colors hover:text-ink-soft disabled:opacity-40"
            >
              Stream Now
            </button>
            <button
              onClick={() => runGenerate("saved", true)}
              disabled={isGenerating || !selectedSegment}
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
            Queue Next Segment {queue.length > 0 ? `(${queue.length})` : ""}
          </button>
        </div>

        <div className="rounded-xl border border-hair bg-ink/[0.025] p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Generated Audio</p>
          {artifacts.length === 0 ? (
            <p className="py-5 text-center text-xs text-ink-faint">No narration saved yet.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {artifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  onClick={() => setActiveAudio(artifact.id)}
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
                    {artifact.provider ?? "gemini"} · {artifact.voiceId} · {artifact.mode ?? "saved"}
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
