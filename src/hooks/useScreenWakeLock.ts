/**
 * useScreenWakeLock — keep the screen awake while a generation is running.
 *
 * Long jobs (book ingestion, image generation, audio overview) are driven by a
 * client-side poll loop. When the screen sleeps the browser throttles timers and
 * the loop stalls, so the workflow looks abandoned. A Screen Wake Lock keeps the
 * display on while work is in flight, which keeps the poller alive.
 *
 * Scope: this only covers the FOREGROUND case (the tab is visible). The OS still
 * releases the lock when the page is hidden, so a backgrounded/closed PWA is not
 * covered here — that needs job-id persistence + reattach (a separate change).
 * Degrades silently where the Wake Lock API is unavailable.
 */

import { useEffect } from "react";
import { useBookStore } from "@/store/bookStore";
import { useImageStore } from "@/store/imageStore";
import { useOverviewJobStore } from "@/store/overviewJobStore";

type WakeLockSentinelLike = { released: boolean; release: () => Promise<void> };

export function useScreenWakeLock() {
  const isAnalyzing = useBookStore((s) => s.isAnalyzing);
  const isGeneratingImage = useImageStore((s) => s.isGenerating);
  const overviewRunning = useOverviewJobStore((s) => s.status === "running");

  const active = isAnalyzing || isGeneratingImage || overviewRunning;

  useEffect(() => {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock) return; // unsupported — nothing to do

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (!active || document.visibilityState !== "visible" || sentinel) return;
      try {
        const lock = await nav.wakeLock!.request("screen");
        if (cancelled) {
          await lock.release().catch(() => {});
          return;
        }
        sentinel = lock;
      } catch {
        /* request can reject (e.g. tab not focused) — safe to ignore */
      }
    };

    const release = async () => {
      if (!sentinel) return;
      const lock = sentinel;
      sentinel = null;
      await lock.release().catch(() => {});
    };

    // The OS auto-releases the lock when the page is hidden; re-acquire on return
    // if work is still in flight.
    const onVisibility = () => {
      if (document.visibilityState === "visible" && active) void acquire();
    };

    if (active) void acquire();
    else void release();

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void release();
    };
  }, [active]);
}
