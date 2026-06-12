import { create } from "zustand";

/** Which panel, if any, is expanded to fill the reading area. */
export type FocusMode = "reader" | "visual" | null;
export type PhonePanel = "reader" | "visual" | "toc";

export interface PendingReaderNavigation {
  target: string;
  wordOffset?: number;
  createdAt: number;
}

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

  /** Phone shell surface and queued reader navigation when reader is unmounted. */
  phonePanel: PhonePanel;
  setPhonePanel: (panel: PhonePanel) => void;
  pendingReaderNavigation: PendingReaderNavigation | null;
  requestReaderNavigation: (target: string, wordOffset?: number) => void;
  clearPendingReaderNavigation: () => void;
}

export const useUiStore = create<UiStore>()((set, get) => ({
  focusMode: null,
  setFocusMode: (focusMode) => set({ focusMode }),
  toggleFocus: (panel) => set({ focusMode: get().focusMode === panel ? null : panel }),
  clearFocus: () => set({ focusMode: null }),

  galleryOpen: false,
  galleryStartSceneId: undefined,
  openGallery: (sceneId) =>
    set((state) => {
      if (state.galleryOpen && state.galleryStartSceneId === sceneId) return state;
      return { galleryOpen: true, galleryStartSceneId: sceneId };
    }),
  closeGallery: () =>
    set((state) =>
      state.galleryOpen || state.galleryStartSceneId !== undefined
        ? { galleryOpen: false, galleryStartSceneId: undefined }
        : state
    ),

  showPlanStrip: false,
  setShowPlanStrip: (showPlanStrip) =>
    set((state) => (state.showPlanStrip === showPlanStrip ? state : { showPlanStrip })),
  togglePlanStrip: () => set({ showPlanStrip: !get().showPlanStrip }),

  returnCfi: null,
  setReturnCfi: (returnCfi) => set({ returnCfi }),

  phonePanel: "reader",
  setPhonePanel: (phonePanel) => set({ phonePanel }),
  pendingReaderNavigation: null,
  requestReaderNavigation: (target, wordOffset) =>
    set({
      pendingReaderNavigation: {
        target,
        ...(wordOffset !== undefined ? { wordOffset } : {}),
        createdAt: Date.now(),
      },
      phonePanel: "reader",
    }),
  clearPendingReaderNavigation: () => set({ pendingReaderNavigation: null }),
}));
