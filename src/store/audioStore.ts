/**
 * audioStore — active Voice Studio state (PLANVI).
 *
 * Persistent audio artifacts live in storage. This store only tracks the active
 * book's mounted audio, playback state, selected voice/style, and queue.
 *
 * Overview generation runs here so closing the drawer does not cancel it.
 */

import { create } from "zustand";
import {
  runAudioOverviewJob,
  type AudioOverviewJobParams,
} from "@/services/audioOverviewJob";
import type { AudioArtifact } from "@/types";

export type AudioGenerationSource = "overview" | "voice" | null;

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
  generationSource: AudioGenerationSource;
  overviewGenerationRequestId: number;
  currentTime: number;
  duration: number;
  activeWordPosition: number | null;
  activeSpanText: string;
  volume: number;
  playbackRate: number;
  listenAlongMode: boolean;
  generationProgress: string;
  error: string | null;

  mount: (bookId: string, artifacts: AudioArtifact[]) => void;
  clear: () => void;
  startOverviewGeneration: (
    params: Omit<AudioOverviewJobParams, "onProgress" | "isStale">
  ) => void;
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
  isGenerating: false,
  generationSource: null,
  overviewGenerationRequestId: 0,
  currentTime: 0,
  duration: 0,
  activeWordPosition: null,
  activeSpanText: "",
  volume: 1,
  playbackRate: 1,
  listenAlongMode: false,
  generationProgress: "",
  error: null,

  mount: (bookId, artifacts) =>
    set((state) => {
      const preserveGeneration =
        state.isGenerating && state.bookId === bookId && state.generationSource === "overview";
      return {
        bookId,
        artifacts,
        activeSegmentId: preserveGeneration ? state.activeSegmentId : null,
        activeAudioId: preserveGeneration ? state.activeAudioId : null,
        queue: preserveGeneration ? state.queue : [],
        isPlaying: preserveGeneration ? state.isPlaying : false,
        isGenerating: preserveGeneration ? state.isGenerating : false,
        generationSource: preserveGeneration ? state.generationSource : null,
        overviewGenerationRequestId: preserveGeneration
          ? state.overviewGenerationRequestId
          : state.overviewGenerationRequestId,
        currentTime: preserveGeneration ? state.currentTime : 0,
        duration: preserveGeneration ? state.duration : 0,
        activeWordPosition: preserveGeneration ? state.activeWordPosition : null,
        activeSpanText: preserveGeneration ? state.activeSpanText : "",
        listenAlongMode: preserveGeneration ? state.listenAlongMode : false,
        generationProgress: preserveGeneration ? state.generationProgress : "",
        error: preserveGeneration ? state.error : null,
      };
    }),
  clear: () =>
    set((state) => ({
      bookId: null,
      artifacts: [],
      activeSegmentId: null,
      activeAudioId: null,
      queue: [],
      isPlaying: false,
      isGenerating: false,
      generationSource: null,
      overviewGenerationRequestId: state.overviewGenerationRequestId + 1,
      currentTime: 0,
      duration: 0,
      activeWordPosition: null,
      activeSpanText: "",
      listenAlongMode: false,
      generationProgress: "",
      error: null,
    })),
  startOverviewGeneration: (params) => {
    const state = get();
    if (
      state.isGenerating &&
      state.generationSource === "overview" &&
      state.bookId === params.bookId
    ) {
      return;
    }

    const requestId = state.overviewGenerationRequestId + 1;
    set({
      bookId: params.bookId,
      isGenerating: true,
      generationSource: "overview",
      overviewGenerationRequestId: requestId,
      generationProgress: "Preparing source intelligence…",
      error: null,
    });

    void (async () => {
      const isStale = () =>
        get().overviewGenerationRequestId !== requestId || get().bookId !== params.bookId;

      try {
        const artifact = await runAudioOverviewJob({
          ...params,
          onProgress: (message) => {
            if (!isStale()) set({ generationProgress: message });
          },
          isStale,
        });
        if (isStale() || !artifact) return;
        get().addArtifact(artifact);
        set({
          activeAudioId: artifact.id,
          isPlaying: true,
          generationProgress: "Overview ready.",
        });
      } catch (err) {
        if (isStale()) return;
        console.error("[AudioOverview] generation failed:", err);
        set({
          error: err instanceof Error ? err.message : "Overview generation failed.",
        });
      } finally {
        if (get().overviewGenerationRequestId === requestId) {
          set({
            isGenerating: false,
            generationSource: null,
            generationProgress: "",
          });
        }
      }
    })();
  },
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
