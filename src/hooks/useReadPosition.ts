/**
 * useReadPosition
 *
 * Single responsibility: estimate the reader's current word-position in the book
 * so the image trigger knows when to generate ahead.
 *
 * Progress persistence is owned entirely by EpubRenderer (relocated events).
 * This hook does NOT write to the database.
 */

import { useEffect, useRef, useCallback } from "react";
import { useReaderStore } from "@/store/readerStore";
import { useBookStore } from "@/store/bookStore";

const POLL_INTERVAL_MS = 2000;

export function useReadPosition(onPositionChange?: (wordPosition: number) => void) {
  const { setWordPosition } = useReaderStore();
  const { activeBook, activeStructure } = useBookStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCfi = useRef<string>("");

  const estimateWordPosition = useCallback((): number => {
    if (!activeStructure) return 0;
    const { percentComplete } = useReaderStore.getState();

    // percentComplete is whole-book progress (0–100) reported directly by
    // EPUB.js via loc.start.percentage × 100. Map it straight to word space.
    // The previous approach multiplied a per-chapter word count by the
    // whole-book percentage, which drifted badly in long omnibus EPUBs.
    const totalWords = activeStructure.chapters.reduce(
      (sum, ch) => sum + ch.wordCount,
      0
    );

    return Math.round(totalWords * (percentComplete / 100));
  }, [activeStructure]);

  useEffect(() => {
    if (!activeBook) return;

    intervalRef.current = setInterval(() => {
      const { currentCfi } = useReaderStore.getState();
      if (currentCfi === lastCfi.current) return;

      lastCfi.current = currentCfi;
      if (currentCfi.startsWith("lumina://")) return;
      const position = estimateWordPosition();
      setWordPosition(position);
      onPositionChange?.(position);
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activeBook, estimateWordPosition, setWordPosition, onPositionChange]);
}
