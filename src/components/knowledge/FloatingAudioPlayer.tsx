import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Gauge, Pause, Play, Square, Volume2, X } from "lucide-react";
import { useAudioStore } from "@/store/audioStore";
import { useDrawerStore } from "@/store/drawerStore";
import type { AudioArtifact } from "@/types";

const AUDIO_SESSION_KEY = "lumina.voice.activeSession";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function findActiveSpan(artifact: AudioArtifact | null, currentTime: number) {
  if (!artifact?.alignment?.length) return null;
  const nowMs = currentTime * 1000;
  return (
    artifact.alignment.find((item) => nowMs >= item.startMs && nowMs <= item.endMs) ??
    artifact.alignment.find((item) => item.startMs > nowMs) ??
    null
  );
}

export default function FloatingAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const {
    bookId,
    artifacts,
    activeAudioId,
    isPlaying,
    currentTime,
    duration,
    volume,
    playbackRate,
    setIsPlaying,
    setPlaybackPosition,
    setActiveReadAlong,
    setVolume,
    setPlaybackRate,
    setActiveAudio,
    setError,
  } = useAudioStore();
  const { isOpen, view, open } = useDrawerStore();
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState({ x: 24, y: 24 });
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);

  const activeArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === activeAudioId) ?? null,
    [activeAudioId, artifacts]
  );
  const showControls = Boolean(activeArtifact) && !(isOpen && view === "voice-studio");

  useEffect(() => {
    if (!bookId || activeAudioId || artifacts.length === 0) return;
    try {
      const session = JSON.parse(localStorage.getItem(AUDIO_SESSION_KEY) ?? "null") as {
        bookId?: string;
        audioId?: string;
        currentTime?: number;
      } | null;
      if (!session?.audioId || session.bookId !== bookId) return;
      if (!artifacts.some((artifact) => artifact.id === session.audioId)) return;
      setActiveAudio(session.audioId);
      setPlaybackPosition(Math.max(0, session.currentTime ?? 0), 0);
      return;
    } catch {
      // Ignore malformed local session hints.
    }
    const newestReady = [...artifacts]
      .filter((artifact) => artifact.status === "ready")
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())[0];
    if (newestReady) setActiveAudio(newestReady.id);
  }, [activeAudioId, artifacts, bookId, setActiveAudio, setPlaybackPosition]);

  useEffect(() => {
    if (!bookId || !activeAudioId) return;
    localStorage.setItem(
      AUDIO_SESSION_KEY,
      JSON.stringify({ bookId, audioId: activeAudioId, currentTime })
    );
  }, [activeAudioId, bookId, currentTime]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!activeArtifact) {
      audio.pause();
      audio.removeAttribute("src");
      setPlaybackPosition(0, 0);
      setActiveReadAlong(null);
      return;
    }
    if (audio.src !== activeArtifact.filePath) {
      const restoreTime = currentTime > 0 ? currentTime : 0;
      audio.src = activeArtifact.filePath;
      audio.currentTime = restoreTime;
      setPlaybackPosition(restoreTime, duration);
      setActiveReadAlong(null);
    }
  }, [activeArtifact, currentTime, duration, setActiveReadAlong, setPlaybackPosition]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !activeArtifact) return;
    if (isPlaying) {
      audio.play().catch((err) => {
        setIsPlaying(false);
        setError(err instanceof Error ? err.message : "Audio playback failed.");
      });
    } else {
      audio.pause();
    }
  }, [activeArtifact, isPlaying, setError, setIsPlaying]);

  const updateReadAlong = (audio: HTMLAudioElement) => {
    setPlaybackPosition(audio.currentTime, audio.duration);
    const span = findActiveSpan(activeArtifact, audio.currentTime);
    if (!span) {
      setActiveReadAlong(null);
      return;
    }
    setActiveReadAlong(span.absoluteWordStart, span.text);
  };

  const stopPlayback = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setIsPlaying(false);
    setPlaybackPosition(0, duration);
    setActiveReadAlong(null);
    setActiveAudio(null);
    localStorage.removeItem(AUDIO_SESSION_KEY);
  };

  const onPointerMove = (event: PointerEvent) => {
    const start = dragStartRef.current;
    if (!start) return;
    const maxX = window.innerWidth - (collapsed ? 66 : 390);
    const maxY = window.innerHeight - (collapsed ? 66 : 190);
    const nextX = Math.max(10, Math.min(maxX, start.x + event.clientX - start.pointerX));
    const nextY = Math.max(10, Math.min(maxY, start.y + event.clientY - start.pointerY));
    setPosition({ x: nextX, y: nextY });
  };

  const onPointerUp = () => {
    dragStartRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  const startDrag = (event: ReactPointerEvent) => {
    dragStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: position.x,
      y: position.y,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  return (
    <>
      <audio
        ref={audioRef}
        onTimeUpdate={(event) => updateReadAlong(event.currentTarget)}
        onLoadedMetadata={(event) => setPlaybackPosition(event.currentTarget.currentTime, event.currentTarget.duration)}
        onEnded={stopPlayback}
        onPause={() => {
          if (audioRef.current?.ended) return;
          setIsPlaying(false);
        }}
      />

      {showControls && collapsed && (
        <button
          type="button"
          onPointerDown={startDrag}
          onClick={() => setCollapsed(false)}
          className="fixed z-[70] flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-sky-200/45 bg-[radial-gradient(circle_at_30%_20%,rgba(226,246,255,0.88),rgba(107,181,220,0.54)_38%,rgba(22,73,112,0.78)_76%)] text-sky-50 shadow-[0_18px_45px_rgba(5,24,42,0.48),inset_0_1px_8px_rgba(255,255,255,0.55),inset_0_-12px_24px_rgba(8,38,68,0.34)] backdrop-blur-xl transition-transform hover:scale-[1.03]"
          style={{ left: position.x, top: position.y }}
          aria-label="Expand audio player"
        >
          <span className="pointer-events-none absolute left-3 top-2 h-5 w-7 rounded-full bg-white/42 blur-[2px]" />
          <span className="pointer-events-none absolute bottom-1 right-1 h-7 w-7 rounded-full bg-sky-200/20 blur-md" />
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>
      )}

      {showControls && !collapsed && (
        <div
          className="fixed z-[70] w-[min(380px,calc(100vw-2rem))] rounded-xl border border-sky-200/30 bg-[linear-gradient(145deg,rgba(30,77,111,0.88),rgba(7,27,49,0.9))] p-3 text-sky-50 shadow-[0_22px_60px_rgba(1,12,24,0.52),inset_0_1px_8px_rgba(255,255,255,0.18)] backdrop-blur-xl"
          style={{ left: position.x, top: position.y }}
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <button type="button" onPointerDown={startDrag} className="min-w-0 flex-1 cursor-grab text-left">
              <p className="truncate text-[11px] uppercase tracking-[0.16em] text-sky-100/70">
                Voice Studio
              </p>
              <p className="mt-0.5 truncate text-sm font-medium text-sky-50/92">
                {activeArtifact?.segmentTitle ?? "Narration"}
              </p>
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="rounded-md border border-sky-200/20 bg-white/5 px-2 py-1 text-[10px] text-sky-100/68 hover:text-sky-50"
              >
                Min
              </button>
              <button
                type="button"
                onClick={stopPlayback}
                className="rounded-md border border-sky-200/20 bg-white/5 p-1.5 text-sky-100/68 hover:text-sky-50"
                aria-label="Stop audio"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-sky-950/45">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-200 via-sky-100 to-lumina-gold/80"
              style={{ width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }}
            />
          </div>
          <div className="mb-3 flex justify-between text-[10px] text-sky-100/58">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>

          <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-200/30 bg-sky-200/12 text-sky-50"
              aria-label={isPlaying ? "Pause audio" : "Play audio"}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button
              type="button"
              onClick={stopPlayback}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-200/20 text-sky-100/68 hover:text-sky-50"
              aria-label="Stop audio"
            >
              <Square size={14} />
            </button>
            <button
              type="button"
              onClick={() => open("voice-studio")}
              className="rounded-lg border border-sky-200/20 bg-white/5 px-3 py-2 text-xs text-sky-100/72 hover:text-sky-50"
            >
              Open Voice Studio
            </button>
          </div>

          <div className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[11px] text-sky-100/62">
            <Volume2 size={13} className="text-sky-100/70" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              className="accent-sky-200"
            />
            <span>{Math.round(volume * 100)}%</span>
            <Gauge size={13} className="text-sky-100/70" />
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={playbackRate}
              onChange={(event) => setPlaybackRate(Number(event.target.value))}
              className="accent-sky-200"
            />
            <span>{playbackRate.toFixed(2)}x</span>
          </div>
        </div>
      )}
    </>
  );
}
