import { create } from "zustand";
import type { Highlight, Note, HighlightColor } from "@/types";
import {
  dbSaveHighlight,
  dbSaveNote,
  dbUpdateNote,
  dbDeleteHighlight,
  dbDeleteNote,
  dbUpdateHighlightColor,
} from "@/services/db";

interface AnnotationStore {
  highlights: Highlight[];
  notes: Note[];

  addHighlight: (highlight: Highlight) => Promise<void>;
  removeHighlight: (highlightId: string) => Promise<void>;
  updateHighlightColor: (highlightId: string, color: HighlightColor) => Promise<void>;

  addNote: (note: Note) => Promise<void>;
  updateNote: (noteId: string, text: string) => Promise<void>;
  removeNote: (noteId: string) => Promise<void>;

  getHighlightsForBook: (bookId: string) => Highlight[];
  getNotesForBook: (bookId: string) => Note[];
  getNoteForHighlight: (highlightId: string) => Note | undefined;

  loadAnnotations: (highlights: Highlight[], notes: Note[]) => void;
  clearAnnotations: () => void;
}

export const useAnnotationStore = create<AnnotationStore>()((set, get) => ({
  highlights: [],
  notes: [],

  addHighlight: async (highlight) => {
    set((state) => ({ highlights: [...state.highlights, highlight] }));
    await dbSaveHighlight(highlight).catch((e) =>
      console.error("[DB] Failed to save highlight:", e)
    );
  },

  removeHighlight: async (highlightId) => {
    set((state) => ({
      highlights: state.highlights.filter((h) => h.id !== highlightId),
      notes: state.notes.filter((n) => n.highlightId !== highlightId),
    }));
    await dbDeleteHighlight(highlightId).catch((e) =>
      console.error("[DB] Failed to delete highlight:", e)
    );
  },

  updateHighlightColor: async (highlightId, color) => {
    set((state) => ({
      highlights: state.highlights.map((h) =>
        h.id === highlightId ? { ...h, color } : h
      ),
    }));
    await dbUpdateHighlightColor(highlightId, color).catch((e) =>
      console.error("[DB] Failed to update highlight color:", e)
    );
  },

  addNote: async (note) => {
    set((state) => ({ notes: [...state.notes, note] }));
    await dbSaveNote(note).catch((e) =>
      console.error("[DB] Failed to save note:", e)
    );
  },

  updateNote: async (noteId, text) => {
    const updatedAt = new Date().toISOString();
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === noteId ? { ...n, noteText: text, updatedAt } : n
      ),
    }));
    await dbUpdateNote(noteId, text).catch((e) =>
      console.error("[DB] Failed to update note:", e)
    );
  },

  removeNote: async (noteId) => {
    set((state) => ({ notes: state.notes.filter((n) => n.id !== noteId) }));
    await dbDeleteNote(noteId).catch((e) =>
      console.error("[DB] Failed to delete note:", e)
    );
  },

  getHighlightsForBook: (bookId) => get().highlights.filter((h) => h.bookId === bookId),
  getNotesForBook: (bookId) => get().notes.filter((n) => n.bookId === bookId),
  getNoteForHighlight: (highlightId) => get().notes.find((n) => n.highlightId === highlightId),

  loadAnnotations: (highlights, notes) => set({ highlights, notes }),
  clearAnnotations: () => set({ highlights: [], notes: [] }),
}));
