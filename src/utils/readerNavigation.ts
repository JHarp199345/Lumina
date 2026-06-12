import { useUiStore } from "@/store/uiStore";

type LuminaNavigationWindow = Window & {
  luminaNavigate?: (target: string) => void;
  luminaNavigateToScene?: (target: string, wordOffset?: number) => void;
};

export function navigateReader(target: string, wordOffset?: number): void {
  const win = window as LuminaNavigationWindow;
  if (wordOffset !== undefined && win.luminaNavigateToScene) {
    win.luminaNavigateToScene(target, wordOffset);
    return;
  }
  if (win.luminaNavigate) {
    win.luminaNavigate(target);
    return;
  }
  useUiStore.getState().requestReaderNavigation(target, wordOffset);
}

export function showReaderAndNavigate(target: string, wordOffset?: number): void {
  const ui = useUiStore.getState();
  ui.closeGallery();
  ui.setPhonePanel("reader");
  navigateReader(target, wordOffset);
}
