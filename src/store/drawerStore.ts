import { create } from "zustand";
import type { Note } from "@/types";

/**
 * Knowledge Layer drawer navigation state.
 *
 * The Annotations Drawer is a navigation hub. It opens to a menu of destinations
 * (Glossary, Notepad). The Sunburst note-reader floats above everything and tracks
 * the origin it was opened from so its close behaviour is correct:
 *   - "tray"    → opened from the book/glossary → close returns to the reader
 *   - "notepad" → opened from the Notepad list → close returns to the Notepad
 */

export type DrawerView = "menu" | "glossary" | "notepad";
export type SunburstOrigin = "tray" | "notepad";

interface DrawerStore {
  // Main drawer
  isOpen: boolean;
  view: DrawerView;
  open: (view?: DrawerView) => void;
  close: () => void;
  setView: (view: DrawerView) => void;

  // Sunburst note reader (floats above the drawer / reader)
  sunburstNote: Note | null;
  sunburstOrigin: SunburstOrigin;
  openSunburst: (note: Note, origin: SunburstOrigin) => void;
  closeSunburst: () => void;
}

export const useDrawerStore = create<DrawerStore>()((set) => ({
  isOpen: false,
  view: "menu",
  open: (view = "menu") => set({ isOpen: true, view }),
  close: () => set({ isOpen: false, view: "menu" }),
  setView: (view) => set({ view }),

  sunburstNote: null,
  sunburstOrigin: "notepad",
  openSunburst: (note, origin) => set({ sunburstNote: note, sunburstOrigin: origin }),
  closeSunburst: () => set({ sunburstNote: null }),
}));
