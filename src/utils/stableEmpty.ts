import type { Chapter, IdentifiedScene, VisualBeat } from "@/types";

/** Stable fallbacks so selectors/memos never see a fresh [] each render. */
export const EMPTY_CHAPTERS: Chapter[] = [];
export const EMPTY_SCENES: IdentifiedScene[] = [];
export const EMPTY_BEATS: VisualBeat[] = [];
