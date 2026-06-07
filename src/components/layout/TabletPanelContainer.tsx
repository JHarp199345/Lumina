/**
 * TabletPanelContainer — tablet-native layout for Lumina.
 *
 * Landscape:  Full-width [Reader top / Visual bottom]
 * Portrait:   Full-width [Reader top / Visual bottom]
 *
 * Proportions:
 *   Reader  flex-[3]  →  ~60 %
 *   Visual  flex-[2]  →  ~40 %
 */

import { useEffect } from "react";
import ReaderPanel from "./ReaderPanel";
import VisualPanel from "./VisualPanel";
import { useUiStore } from "@/store/uiStore";

interface Props {
  isPortrait: boolean;
  onImport?: () => void;
}

export default function TabletPanelContainer({ isPortrait, onImport }: Props) {
  const { focusMode, clearFocus } = useUiStore();

  // Esc / back exits focus mode.
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode, clearFocus]);

  // Focus mode: one panel fills the whole reading area.
  if (focusMode) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <div className="flex-1 overflow-hidden min-h-0">
          {focusMode === "reader" ? <ReaderPanel onImport={onImport} /> : <VisualPanel />}
        </div>
      </div>
    );
  }

  if (isPortrait) {
    return <PortraitLayout onImport={onImport} />;
  }
  return <LandscapeLayout onImport={onImport} />;
}

// ─── Portrait layout ──────────────────────────────────────────────────────────

function PortraitLayout({
  onImport,
}: {
  onImport?: () => void;
}) {
  return (
    // `relative` is required so TocDrawer's absolute positioning is contained here
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Reader — top 60 % */}
      <div className="flex-[3] overflow-hidden min-h-0">
        <ReaderPanel onImport={onImport} />
      </div>

      <div className="h-px bg-ink/5 flex-shrink-0" />

      {/* Visual — bottom 40 % */}
      <div className="flex-[2] overflow-hidden min-h-0">
        <VisualPanel />
      </div>
    </div>
  );
}

// ─── Landscape layout ─────────────────────────────────────────────────────────
// Full-width reading area at all times. TOC floats in from the right as an
// overlay — never displaces the reader or visual pane.

function LandscapeLayout({
  onImport,
}: {
  onImport?: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Reader — top 60 % */}
      <div className="flex-[3] overflow-hidden min-h-0">
        <ReaderPanel onImport={onImport} />
      </div>

      <div className="h-px bg-ink/5 flex-shrink-0" />

      {/* Visual — bottom 40 % */}
      <div className="flex-[2] overflow-hidden min-h-0">
        <VisualPanel />
      </div>
    </div>
  );
}
