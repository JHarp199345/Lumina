/**
 * studyStore — active Study Guide state (PLANv).
 *
 * Holds the currently-mounted book's Study Guide. The guide is a book-scoped
 * artifact: opening a book mounts its guide, switching/closing books dismounts
 * it. State lives here (not in the drawer component) so an in-progress
 * generation survives the drawer opening and closing.
 */

import { create } from "zustand";
import type { StudyGuide } from "@/types";

interface StudyStore {
  /** Book this guide belongs to — guards against stale async loads after a switch. */
  bookId: string | null;
  guide: StudyGuide | null;

  isGenerating: boolean;
  progressMessage: string;

  /** Mount the guide for a freshly-opened book (null = no guide yet). */
  mount: (bookId: string, guide: StudyGuide | null) => void;
  setGuide: (guide: StudyGuide | null) => void;
  setIsGenerating: (value: boolean) => void;
  setProgress: (message: string) => void;
  /** Dismount on book close/switch. */
  clear: () => void;
}

export const useStudyStore = create<StudyStore>()((set) => ({
  bookId: null,
  guide: null,
  isGenerating: false,
  progressMessage: "",

  mount: (bookId, guide) => set({ bookId, guide, isGenerating: false, progressMessage: "" }),
  setGuide: (guide) => set({ guide }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setProgress: (progressMessage) => set({ progressMessage }),
  clear: () => set({ bookId: null, guide: null, isGenerating: false, progressMessage: "" }),
}));
