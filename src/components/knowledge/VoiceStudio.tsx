import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  BookOpen,
  CheckCircle2,
  Headphones,
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
import { storage } from "@/storage";
import {
  AUDIO_STYLE_PRESETS,
  VOICE_PRESETS,
  generateSegmentAudio,
  hashText,
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
    setVolume,
    setPlaybackRate,
    queueSegment,
    setError,
  } = useAudioStore();

  const currentGuide = guide && activeBook && guide.bookId === activeBook.id ? guide : null;
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);

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
  const selectedVoice = VOICE_PRESETS.find((voice) => voice.id === selectedVoiceId) ?? VOICE_PRESETS[0];
  const selectedStyle =
    AUDIO_STYLE_PRESETS.find((style) => style.id === selectedStylePresetId) ?? AUDIO_STYLE_PRESETS[0];

  const matchingArtifact = useMemo(() => {
    if (!selectedSegment || !activeStructure) return null;
    const chapter = activeStructure.chapters.find((item) => item.index === selectedSegment.chapterIndex);
    const textHash = segmentTextHash(selectedSegment, chapter?.rawText);
    return (
      artifacts.find(
        (artifact) =>
          artifact.status === "ready" &&
          artifact.segmentId === selectedSegment.id &&
          artifact.voiceId === selectedVoice.id &&
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

  const runGenerate = async () => {
    if (!selectedSegment || !activeStructure) {
      setError("Choose a segment first.");
      return;
    }
    if (matchingArtifact) {
      setActiveAudio(matchingArtifact.id);
      return;
    }
    const apiKey = await storage.loadApiKey("lumina_google_ai_key");
    if (!apiKey) {
      setError("Add a Google AI key in Settings to generate narration.");
      return;
    }
    setError(null);
    setIsGenerating(true);
    setProgress("Directing narration");
    try {
      const generated = await generateSegmentAudio({
        segment: selectedSegment,
        structure: activeStructure,
        apiKey,
        voice: selectedVoice,
        style: selectedStyle,
      });
      setProgress("Saving audio");
      const filePath = await storage.saveAudioArtifact(generated.artifact, generated.data);
      const artifact: AudioArtifact = { ...generated.artifact, filePath };
      addArtifact(artifact);
      setActiveAudio(artifact.id);
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

  const queueNext = () => {
    if (!currentGuide || !selectedSegment) return;
    const index = currentGuide.segments.findIndex((segment) => segment.id === selectedSegment.id);
    const next = currentGuide.segments[index + 1];
    if (next) queueSegment(next.id);
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
          setPlaybackPosition(audio.currentTime, audio.duration);
        }}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          setPlaybackPosition(audio.currentTime, audio.duration);
        }}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="border-b border-hair px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-lumina-gold/75">Voice Studio</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
          Generate one segment at a time using your Google AI key.
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 scrollbar-thin">
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

        <div className="grid grid-cols-2 gap-2">
          <PresetSelect
            label="Voice"
            value={selectedVoice.id}
            options={VOICE_PRESETS}
            onChange={setVoice}
          />
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
              onClick={runGenerate}
              disabled={isGenerating || !selectedSegment}
              className="flex items-center justify-center gap-2 rounded-lg border border-lumina-gold/30 bg-lumina-gold/10 px-3 py-2.5 text-xs font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/15 disabled:cursor-default disabled:border-hair disabled:bg-ink/[0.03] disabled:text-ink-faint"
            >
              {isGenerating ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {matchingArtifact ? "Use Cache" : isGenerating ? "Generating" : "Generate"}
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
                    {artifact.voiceId} · {artifact.stylePresetId}
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
