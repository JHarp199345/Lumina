import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Gauge, Pause, Play, Square, Volume2, X } from "lucide-react";
import { useAudioStore } from "@/store/audioStore";
import { useDrawerStore } from "@/store/drawerStore";
import type { AudioArtifact } from "@/types";

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
  const [position, setPosition] = useState({ x: 22, y: 22 });
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);

  const activeArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === activeAudioId) ?? null,
    [activeAudioId, artifacts]
  );
  const showControls = Boolean(activeArtifact) && !(isOpen && view === "voice-studio");

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
      audio.src = activeArtifact.filePath;
      audio.currentTime = 0;
      setPlaybackPosition(0, duration);
      setActiveReadAlong(null);
    }
  }, [activeArtifact, duration, setActiveReadAlong, setPlaybackPosition]);

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
  };

  const onPointerMove = (event: PointerEvent) => {
    const start = dragStartRef.current;
    if (!start) return;
    const nextX = Math.max(10, Math.min(window.innerWidth - 90, start.x + event.clientX - start.pointerX));
    const nextY = Math.max(10, Math.min(window.innerHeight - 90, start.y + event.clientY - start.pointerY));
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
          className="fixed z-[70] flex h-14 w-14 items-center justify-center rounded-full border border-lumina-gold/35 bg-surface-dark/88 text-lumina-gold shadow-2xl shadow-black/40 backdrop-blur-xl"
          style={{ right: position.x, bottom: position.y }}
          aria-label="Expand audio player"
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>
      )}

      {showControls && !collapsed && (
        <div
          className="fixed z-[70] w-[min(380px,calc(100vw-2rem))] rounded-xl border border-lumina-gold/28 bg-surface-dark/90 p-3 text-ink-soft shadow-2xl shadow-black/45 backdrop-blur-xl"
          style={{ right: position.x, bottom: position.y }}
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <button type="button" onPointerDown={startDrag} className="min-w-0 flex-1 cursor-grab text-left">
              <p className="truncate text-[11px] uppercase tracking-[0.16em] text-lumina-gold/70">
                Voice Studio
              </p>
              <p className="mt-0.5 truncate text-sm font-medium text-ink/88">
                {activeArtifact?.segmentTitle ?? "Narration"}
              </p>
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="rounded-md border border-hair px-2 py-1 text-[10px] text-ink-faint hover:text-ink-soft"
              >
                Min
              </button>
              <button
                type="button"
                onClick={stopPlayback}
                className="rounded-md border border-hair p-1.5 text-ink-faint hover:text-ink-soft"
                aria-label="Stop audio"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-black/25">
            <div
              className="h-full rounded-full bg-lumina-gold/75"
              style={{ width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }}
            />
          </div>
          <div className="mb-3 flex justify-between text-[10px] text-ink-faint">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>

          <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-lumina-gold/30 bg-lumina-gold/10 text-lumina-gold"
              aria-label={isPlaying ? "Pause audio" : "Play audio"}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button
              type="button"
              onClick={stopPlayback}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-hair text-ink-faint hover:text-ink-soft"
              aria-label="Stop audio"
            >
              <Square size={14} />
            </button>
            <button
              type="button"
              onClick={() => open("voice-studio")}
              className="rounded-lg border border-hair px-3 py-2 text-xs text-ink-faint hover:text-ink-soft"
            >
              Open Voice Studio
            </button>
          </div>

          <div className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[11px] text-ink-faint">
            <Volume2 size={13} className="text-lumina-gold/65" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              className="accent-lumina-gold"
            />
            <span>{Math.round(volume * 100)}%</span>
            <Gauge size={13} className="text-lumina-gold/65" />
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={playbackRate}
              onChange={(event) => setPlaybackRate(Number(event.target.value))}
              className="accent-lumina-gold"
            />
            <span>{playbackRate.toFixed(2)}x</span>
          </div>
        </div>
      )}
    </>
  );
}
