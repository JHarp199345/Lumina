import { create } from "zustand";

/** Which panel, if any, is expanded to fill the reading area. */
export type FocusMode = "reader" | "visual" | null;

interface UiStore {
  focusMode: FocusMode;
  setFocusMode: (mode: FocusMode) => void;
  /** Toggle focus for a panel: focusing it, or clearing focus if already focused. */
  toggleFocus: (panel: Exclude<FocusMode, null>) => void;
  clearFocus: () => void;
}

export const useUiStore = create<UiStore>()((set, get) => ({
  focusMode: null,
  setFocusMode: (focusMode) => set({ focusMode }),
  toggleFocus: (panel) => set({ focusMode: get().focusMode === panel ? null : panel }),
  clearFocus: () => set({ focusMode: null }),
}));
