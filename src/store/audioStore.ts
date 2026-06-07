/**
 * audioStore — active Voice Studio state (PLANVI).
 *
 * Persistent audio artifacts live in storage. This store only tracks the active
 * book's mounted audio, playback state, selected voice/style, and queue.
 */

import { create } from "zustand";
import type { AudioArtifact } from "@/types";

interface AudioStore {
  bookId: string | null;
  artifacts: AudioArtifact[];
  activeSegmentId: string | null;
  activeAudioId: string | null;
  queue: string[];

  selectedVoiceId: string;
  selectedStylePresetId: string;

  isPlaying: boolean;
  isGenerating: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  generationProgress: string;
  error: string | null;

  mount: (bookId: string, artifacts: AudioArtifact[]) => void;
  clear: () => void;
  setArtifacts: (artifacts: AudioArtifact[]) => void;
  addArtifact: (artifact: AudioArtifact) => void;
  setActiveSegment: (segmentId: string | null) => void;
  setActiveAudio: (audioId: string | null) => void;
  setVoice: (voiceId: string) => void;
  setStylePreset: (stylePresetId: string) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setIsGenerating: (isGenerating: boolean) => void;
  setProgress: (generationProgress: string) => void;
  setPlaybackPosition: (currentTime: number, duration: number) => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (playbackRate: number) => void;
  queueSegment: (segmentId: string) => void;
  dequeueSegment: () => string | null;
  setError: (error: string | null) => void;
}

export const useAudioStore = create<AudioStore>()((set, get) => ({
  bookId: null,
  artifacts: [],
  activeSegmentId: null,
  activeAudioId: null,
  queue: [],

  selectedVoiceId: "kore",
  selectedStylePresetId: "clear-narrator",

  isPlaying: false,
  isGenerating: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  playbackRate: 1,
  generationProgress: "",
  error: null,

  mount: (bookId, artifacts) =>
    set({
      bookId,
      artifacts,
      activeSegmentId: null,
      activeAudioId: null,
      queue: [],
      isPlaying: false,
      isGenerating: false,
      currentTime: 0,
      duration: 0,
      generationProgress: "",
      error: null,
    }),
  clear: () =>
    set({
      bookId: null,
      artifacts: [],
      activeSegmentId: null,
      activeAudioId: null,
      queue: [],
      isPlaying: false,
      isGenerating: false,
      currentTime: 0,
      duration: 0,
      generationProgress: "",
      error: null,
    }),
  setArtifacts: (artifacts) => set({ artifacts }),
  addArtifact: (artifact) =>
    set((state) => ({
      artifacts: [...state.artifacts.filter((item) => item.id !== artifact.id), artifact],
      activeAudioId: artifact.id,
    })),
  setActiveSegment: (activeSegmentId) => set({ activeSegmentId }),
  setActiveAudio: (activeAudioId) => set({ activeAudioId }),
  setVoice: (selectedVoiceId) => set({ selectedVoiceId }),
  setStylePreset: (selectedStylePresetId) => set({ selectedStylePresetId }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setProgress: (generationProgress) => set({ generationProgress }),
  setPlaybackPosition: (currentTime, duration) => set({ currentTime, duration }),
  setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)) }),
  setPlaybackRate: (playbackRate) => set({ playbackRate: Math.min(2, Math.max(0.5, playbackRate)) }),
  queueSegment: (segmentId) =>
    set((state) => ({
      queue: state.queue.includes(segmentId) ? state.queue : [...state.queue, segmentId],
    })),
  dequeueSegment: () => {
    const [next, ...rest] = get().queue;
    set({ queue: rest });
    return next ?? null;
  },
  setError: (error) => set({ error }),
}));
