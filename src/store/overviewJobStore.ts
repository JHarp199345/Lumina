/**
 * Dedicated lane for Audio Overview generation.
 *
 * Independent from audio playback mount/clear and from image/analysis work so
 * opening the gallery or other panels cannot cancel or hide an in-flight job.
 */

import { create } from "zustand";
import {
  runAudioOverviewJob,
  type AudioOverviewJobParams,
} from "@/services/audioOverviewJob";
import { useAudioStore } from "@/store/audioStore";

export type OverviewJobStatus = "idle" | "running" | "completed" | "failed";

interface OverviewJobStore {
  status: OverviewJobStatus;
  bookId: string | null;
  requestId: number;
  progress: string;
  error: string | null;
  completedArtifactId: string | null;

  start: (params: Omit<AudioOverviewJobParams, "onProgress" | "isStale">) => void;
  dismissError: () => void;
  dismiss: () => void;
  /** Invalidate an in-flight job for a book being unmounted. */
  cancelForBook: (bookId: string) => void;
  isRunningForBook: (bookId: string) => boolean;
}

export const useOverviewJobStore = create<OverviewJobStore>()((set, get) => ({
  status: "idle",
  bookId: null,
  requestId: 0,
  progress: "",
  error: null,
  completedArtifactId: null,

  isRunningForBook: (bookId) =>
    get().status === "running" && get().bookId === bookId,

  dismissError: () => set({ error: null, status: "idle" }),
  dismiss: () => set({ status: "idle", progress: "", error: null, completedArtifactId: null }),

  cancelForBook: (bookId) => {
    const state = get();
    if (state.bookId !== bookId || state.status !== "running") return;
    set({
      requestId: state.requestId + 1,
      status: "idle",
      bookId: null,
      progress: "",
      error: null,
    });
  },

  start: (params) => {
    const state = get();
    if (state.status === "running" && state.bookId === params.bookId) return;

    const requestId = state.requestId + 1;
    set({
      status: "running",
      bookId: params.bookId,
      requestId,
      progress: "Preparing source intelligence…",
      error: null,
      completedArtifactId: null,
    });

    void (async () => {
      const isStale = () => get().requestId !== requestId;

      try {
        const artifact = await runAudioOverviewJob({
          ...params,
          onProgress: (message) => {
            if (!isStale()) set({ progress: message });
          },
          isStale,
        });

        if (isStale()) return;

        if (!artifact) {
          set({ status: "idle", progress: "", bookId: null });
          return;
        }

        const audioStore = useAudioStore.getState();
        if (audioStore.bookId === params.bookId) {
          audioStore.addArtifact(artifact);
          audioStore.setActiveAudio(artifact.id);
          audioStore.setIsPlaying(true);
        }

        set({
          status: "completed",
          progress: "Overview ready.",
          completedArtifactId: artifact.id,
        });
      } catch (err) {
        if (isStale()) return;
        console.error("[AudioOverview] generation failed:", err);
        set({
          status: "failed",
          error: err instanceof Error ? err.message : "Overview generation failed.",
          progress: "",
        });
      } finally {
        if (get().requestId === requestId && get().status === "running") {
          set({ status: "idle", progress: "", bookId: null });
        }
      }
    })();
  },
}));
