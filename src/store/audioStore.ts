/**
 * audioStore — Voice Studio playback state (PLANVI).
 *
 * Overview generation lives in overviewJobStore — its own lane, unaffected by
 * mount/clear or image gallery work.
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
  /** Voice Studio narration generation only — not Audio Overview. */
  voiceIsGenerating: boolean;
  currentTime: number;
  duration: number;
  activeWordPosition: number | null;
  activeSpanText: string;
  volume: number;
  playbackRate: number;
  listenAlongMode: boolean;
  voiceGenerationProgress: string;
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
  setVoiceIsGenerating: (voiceIsGenerating: boolean) => void;
  setVoiceProgress: (voiceGenerationProgress: string) => void;
  setPlaybackPosition: (currentTime: number, duration: number) => void;
  setActiveReadAlong: (wordPosition: number | null, spanText?: string) => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (playbackRate: number) => void;
  setListenAlongMode: (listenAlongMode: boolean) => void;
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
  voiceIsGenerating: false,
  currentTime: 0,
  duration: 0,
  activeWordPosition: null,
  activeSpanText: "",
  volume: 1,
  playbackRate: 1,
  listenAlongMode: false,
  voiceGenerationProgress: "",
  error: null,

  mount: (bookId, artifacts) =>
    set({
      bookId,
      artifacts,
      activeSegmentId: null,
      activeAudioId: null,
      queue: [],
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      activeWordPosition: null,
      activeSpanText: "",
      listenAlongMode: false,
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
      voiceIsGenerating: false,
      currentTime: 0,
      duration: 0,
      activeWordPosition: null,
      activeSpanText: "",
      listenAlongMode: false,
      voiceGenerationProgress: "",
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
  setVoiceIsGenerating: (voiceIsGenerating) => set({ voiceIsGenerating }),
  setVoiceProgress: (voiceGenerationProgress) => set({ voiceGenerationProgress }),
  setPlaybackPosition: (currentTime, duration) => set({ currentTime, duration }),
  setActiveReadAlong: (activeWordPosition, activeSpanText = "") => set({ activeWordPosition, activeSpanText }),
  setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)) }),
  setPlaybackRate: (playbackRate) => set({ playbackRate: Math.min(2, Math.max(0.5, playbackRate)) }),
  setListenAlongMode: (listenAlongMode) => set({ listenAlongMode }),
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
