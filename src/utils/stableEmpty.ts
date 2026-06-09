import type { Chapter } from "@/types";

/** Stable fallback so Zustand selectors never return a fresh [] each render. */
export const EMPTY_CHAPTERS: Chapter[] = [];
