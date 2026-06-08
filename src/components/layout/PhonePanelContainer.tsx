/**
 * PhonePanelContainer — first-pass phone-native shell.
 *
 * Phones show one major surface at a time. The reader is the default, while
 * visual story and contents can be opened without squeezing all panels together.
 */

import { BookOpen, Image, List } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import ReaderPanel from "./ReaderPanel";
import TocPanel from "./TocPanel";
import VisualPanel from "./VisualPanel";

type PhonePanel = "reader" | "visual" | "toc";

interface Props {
  onImport?: () => void;
}

export default function PhonePanelContainer({ onImport }: Props) {
  const [panel, setPanel] = useState<PhonePanel>("reader");

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        {panel === "reader" && <ReaderPanel onImport={onImport} />}
        {panel === "visual" && <VisualPanel />}
        {panel === "toc" && <TocPanel onNavigate={() => setPanel("reader")} />}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-1/2 z-40 flex -translate-x-1/2 justify-center">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-sky-100/[0.08] p-1.5 shadow-[0_12px_34px_rgba(0,0,0,0.36)] backdrop-blur-xl">
          <PhonePanelButton active={panel === "toc"} label="Contents" onClick={() => setPanel("toc")}>
            <List size={17} />
          </PhonePanelButton>
          <PhonePanelButton active={panel === "reader"} label="Reader" onClick={() => setPanel("reader")}>
            <BookOpen size={17} />
          </PhonePanelButton>
          <PhonePanelButton active={panel === "visual"} label="Visuals" onClick={() => setPanel("visual")}>
            <Image size={17} />
          </PhonePanelButton>
        </div>
      </div>
    </div>
  );
}

function PhonePanelButton({
  active,
  children,
  label,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-11 w-11 items-center justify-center rounded-full border transition-colors ${
        active
          ? "border-lumina-gold/45 bg-lumina-gold/18 text-lumina-gold"
          : "border-white/10 bg-sky-100/[0.08] text-sky-100/80 hover:bg-sky-100/[0.12]"
      }`}
    >
      {children}
    </button>
  );
}
