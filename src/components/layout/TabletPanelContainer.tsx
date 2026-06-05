/**
 * TabletPanelContainer — tablet-native layout for Lumina.
 *
 * Landscape:  Full-width [Reader top / Visual bottom] + TOC drawer from right
 * Portrait:   Full-width [Reader top / Visual bottom] + TOC drawer from left
 *
 * The TOC never takes column space — always a floating overlay so the reading
 * area remains full-width in both orientations.
 *
 * Proportions:
 *   Reader  flex-[3]  →  ~60 %
 *   Visual  flex-[2]  →  ~40 %
 */

import ReaderPanel from "./ReaderPanel";
import VisualPanel from "./VisualPanel";
import TocDrawer from "./TocDrawer";

interface Props {
  isPortrait: boolean;
  tocOpen: boolean;
  onTocClose: () => void;
  onImport?: () => void;
}

export default function TabletPanelContainer({ isPortrait, tocOpen, onTocClose, onImport }: Props) {
  if (isPortrait) {
    return <PortraitLayout tocOpen={tocOpen} onTocClose={onTocClose} onImport={onImport} />;
  }
  return <LandscapeLayout tocOpen={tocOpen} onTocClose={onTocClose} onImport={onImport} />;
}

// ─── Portrait layout ──────────────────────────────────────────────────────────

function PortraitLayout({
  tocOpen,
  onTocClose,
  onImport,
}: {
  tocOpen: boolean;
  onTocClose: () => void;
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

      {/* TOC slides in over the content */}
      <TocDrawer open={tocOpen} onClose={onTocClose} />
    </div>
  );
}

// ─── Landscape layout ─────────────────────────────────────────────────────────
// Full-width reading area at all times. TOC floats in from the right as an
// overlay — never displaces the reader or visual pane.

function LandscapeLayout({
  tocOpen,
  onTocClose,
  onImport,
}: {
  tocOpen: boolean;
  onTocClose: () => void;
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

      {/* TOC slides in from the right as a floating overlay */}
      <TocDrawer open={tocOpen} onClose={onTocClose} side="right" />
    </div>
  );
}
