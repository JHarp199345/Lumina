import { useCallback } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { Layout } from "react-resizable-panels";
import { useSettingsStore } from "@/store/settingsStore";
import TocPanel from "./TocPanel";
import VisualPanel from "./VisualPanel";
import ReaderPanel from "./ReaderPanel";

const PANEL_COMPONENTS = {
  toc: TocPanel,
  visual: VisualPanel,
  reader: ReaderPanel,
};

const PANEL_MIN_SIZES: Record<string, number> = {
  toc: 0,
  visual: 15,
  reader: 25,
};

interface PanelContainerProps {
  onImport?: () => void;
  tocOpen?: boolean;
  onTocClose?: () => void;
}

export default function PanelContainer({ onImport, tocOpen = false, onTocClose }: PanelContainerProps) {
  const { panelOrder, panelLayout, setPanelLayout } = useSettingsStore();

  const handleLayoutChanged = useCallback(
    (layout: Layout) => {
      // layout is keyed by panel id
      setPanelLayout({
        toc: layout["toc"] ?? panelLayout.toc,
        visual: layout["visual"] ?? panelLayout.visual,
        reader: layout["reader"] ?? panelLayout.reader,
      });
    },
    [panelLayout, setPanelLayout]
  );

  const orderedPanels = panelOrder.panels.filter((panelId) => tocOpen || panelId !== "toc");

  // Build defaultLayout keyed by panel id
  const defaultLayout: Layout = {
    toc: panelLayout.toc,
    visual: panelLayout.visual,
    reader: panelLayout.reader,
  };

  return (
    <Group
      orientation="horizontal"
      className="flex-1 overflow-hidden flex"
      onLayoutChanged={handleLayoutChanged}
      defaultLayout={defaultLayout}
    >
      {orderedPanels.map((panelId, index) => {
        const PanelComponent = PANEL_COMPONENTS[panelId];
        const size = panelLayout[panelId];
        const minSize = PANEL_MIN_SIZES[panelId];

        // When TOC is toggled open from its default 0%, give it a usable opening size
        const effectiveSize = panelId === "toc" && size === 0 ? 22 : size;

        return (
          <div key={panelId} className="contents">
            <Panel
              id={panelId}
              defaultSize={effectiveSize}
              minSize={minSize}
              collapsible={panelId === "toc"}
              collapsedSize={0}
              className="flex flex-col overflow-hidden"
            >
              <PanelComponent
                {...(panelId === "reader" ? { onImport } : {})}
                {...(panelId === "toc" ? { onNavigate: onTocClose } : {})}
              />
            </Panel>

            {index < orderedPanels.length - 1 && (
              <Separator className="group relative w-1 flex-shrink-0 bg-ink/5 hover:bg-white/15 transition-colors duration-150 cursor-col-resize">
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-ink/10 group-hover:bg-lumina-gold/40 transition-colors duration-150" />
              </Separator>
            )}
          </div>
        );
      })}
    </Group>
  );
}
