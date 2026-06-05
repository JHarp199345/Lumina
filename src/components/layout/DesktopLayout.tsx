/**
 * DesktopLayout — the desktop reading environment.
 *
 * Structure:
 *   [DesktopRail 40px fixed] [VisualPanel resizable] [ReaderPanel resizable]
 *   + TocDrawer floating overlay (never displaces Visual or Reader)
 *
 * The TOC is hidden by default. The rail's hamburger button opens it as a
 * floating overlay anchored to the left. Visual and Reader always occupy
 * full remaining width.
 */

import { useState, useCallback } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { Layout } from "react-resizable-panels";
import { useSettingsStore } from "@/store/settingsStore";
import { useReaderStore } from "@/store/readerStore";
import DesktopRail from "./DesktopRail";
import TocDrawer from "./TocDrawer";
import VisualPanel from "./VisualPanel";
import ReaderPanel from "./ReaderPanel";

interface DesktopLayoutProps {
  onImport?: () => void;
  onLibraryOpen?: () => void;
}

export default function DesktopLayout({ onImport, onLibraryOpen }: DesktopLayoutProps) {
  const [tocOpen, setTocOpen] = useState(false);
  const { percentComplete } = useReaderStore();
  const { panelLayout, setPanelLayout } = useSettingsStore();

  const handleLayoutChanged = useCallback(
    (layout: Layout) => {
      setPanelLayout({
        toc: 0,
        visual: layout["visual"] ?? panelLayout.visual,
        reader: layout["reader"] ?? panelLayout.reader,
      });
    },
    [panelLayout, setPanelLayout]
  );

  return (
    <div className="flex-1 flex overflow-hidden relative">

      {/* Fixed left rail — always visible */}
      <DesktopRail
        tocOpen={tocOpen}
        onTocToggle={() => setTocOpen((v) => !v)}
        onLibraryOpen={onLibraryOpen ?? (() => {})}
        percentComplete={percentComplete}
      />

      {/* TOC as floating overlay — sits above panels, never resizes them */}
      <TocDrawer
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        side="left"
      />

      {/* Visual | Reader — resizable, always full remaining width */}
      <Group
        orientation="horizontal"
        className="flex-1 overflow-hidden"
        onLayoutChanged={handleLayoutChanged}
        defaultLayout={{
          visual: panelLayout.visual || 40,
          reader: panelLayout.reader || 60,
        }}
      >
        <Panel
          id="visual"
          defaultSize={panelLayout.visual || 40}
          minSize={20}
          className="flex flex-col overflow-hidden"
        >
          <VisualPanel />
        </Panel>

        <Separator className="group relative w-1 flex-shrink-0 bg-ink/5 hover:bg-white/15 transition-colors duration-150 cursor-col-resize">
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-ink/10 group-hover:bg-lumina-gold/40 transition-colors duration-150" />
        </Separator>

        <Panel
          id="reader"
          defaultSize={panelLayout.reader || 60}
          minSize={30}
          className="flex flex-col overflow-hidden"
        >
          <ReaderPanel onImport={onImport} />
        </Panel>
      </Group>

    </div>
  );
}
