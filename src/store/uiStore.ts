import { create } from "zustand";

/** Which panel, if any, is expanded to fill the reading area. */
export type FocusMode = "reader" | "visual" | null;

interface UiStore {
  focusMode: FocusMode;
  setFocusMode: (mode: FocusMode) => void;
  /** Toggle focus for a panel: focusing it, or clearing focus if already focused. */
  toggleFocus: (panel: Exclude<FocusMode, null>) => void;
  clearFocus: () => void;

  /** Full-screen gallery (hero + filmstrip) — rendered at app root. */
  galleryOpen: boolean;
  galleryStartSceneId?: string;
  openGallery: (sceneId?: string) => void;
  closeGallery: () => void;

  /** Dismissible plan strip overlay on the visual panel. */
  showPlanStrip: boolean;
  setShowPlanStrip: (show: boolean) => void;
  togglePlanStrip: () => void;

  /** Reading spot saved when jumping from gallery to a passage. */
  returnCfi: string | null;
  setReturnCfi: (cfi: string | null) => void;
}

export const useUiStore = create<UiStore>()((set, get) => ({
  focusMode: null,
  setFocusMode: (focusMode) => set({ focusMode }),
  toggleFocus: (panel) => set({ focusMode: get().focusMode === panel ? null : panel }),
  clearFocus: () => set({ focusMode: null }),

  galleryOpen: false,
  galleryStartSceneId: undefined,
  openGallery: (sceneId) =>
    set({
      galleryOpen: true,
      galleryStartSceneId: sceneId,
    }),
  closeGallery: () => set({ galleryOpen: false, galleryStartSceneId: undefined }),

  showPlanStrip: false,
  setShowPlanStrip: (showPlanStrip) => set({ showPlanStrip }),
  togglePlanStrip: () => set({ showPlanStrip: !get().showPlanStrip }),

  returnCfi: null,
  setReturnCfi: (returnCfi) => set({ returnCfi }),
}));
