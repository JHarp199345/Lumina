import { BookOpen, FolderOpen, Menu, Moon, Settings, Sun, Monitor } from "lucide-react";
import { useSettingsStore } from "@/store/settingsStore";
import { useReaderStore } from "@/store/readerStore";
import type { Theme } from "@/types";
import type { ReactNode } from "react";

interface SideRailProps {
  onImport: () => void;
  onLibraryOpen: () => void;
  isTablet?: boolean;
  tocOpen?: boolean;
  onTocToggle?: () => void;
  onSettingsOpen: () => void;
}

export default function SideRail({
  onImport,
  onLibraryOpen,
  isTablet,
  tocOpen,
  onTocToggle,
  onSettingsOpen,
}: SideRailProps) {
  const { theme, setTheme } = useSettingsStore();
  const { percentComplete } = useReaderStore();

  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  const cycleTheme = () => {
    const cycle: Theme[] = ["dark", "light", "system"];
    const current = cycle.indexOf(theme);
    setTheme(cycle[(current + 1) % cycle.length]);
  };

  return (
    <aside className="relative w-16 flex-shrink-0 flex flex-col items-center border-r border-sky-200/12 bg-[#06182a] py-3">
      {/* Reading progress bar — left edge, full height, fills as reader advances */}
      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-white/4">
        <div
          className="w-full bg-lumina-gold/35 transition-all duration-1000 ease-out"
          style={{ height: `${Math.min(100, Math.max(0, percentComplete))}%` }}
        />
      </div>

      <div className="flex flex-col items-center gap-2">
        {onTocToggle && (
          <RailButton
            active={tocOpen}
            label="Toggle contents"
            onClick={onTocToggle}
          >
            <Menu size={17} />
          </RailButton>
        )}

        <RailButton label="Open book" onClick={onImport} primary>
          <FolderOpen size={17} />
        </RailButton>

        <RailButton label="Library" onClick={onLibraryOpen}>
          <BookOpen size={17} />
        </RailButton>
      </div>

      <div className="mt-auto flex flex-col items-center gap-2">
        <RailButton label={`Theme: ${theme}`} onClick={cycleTheme}>
          <ThemeIcon size={17} />
        </RailButton>

        <RailButton label="Settings" onClick={onSettingsOpen}>
          <Settings size={17} />
        </RailButton>
      </div>
    </aside>
  );
}

function RailButton({
  active,
  children,
  label,
  onClick,
  primary,
}: {
  active?: boolean;
  children: ReactNode;
  label: string;
  onClick?: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={label}
      aria-label={label}
      className={[
        "w-11 h-11 flex items-center justify-center rounded-lg border transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-lumina-gold/60",
        !onClick ? "cursor-default opacity-55" : "",
        active
          ? "border-lumina-gold/45 bg-lumina-gold/12 text-lumina-gold"
          : primary
            ? "border-lumina-gold/30 bg-lumina-gold/10 text-lumina-gold/85 hover:bg-lumina-gold/15 hover:text-lumina-gold"
            : "border-sky-200/14 bg-sky-100/[0.035] text-sky-100/48 hover:border-sky-100/24 hover:bg-sky-100/[0.07] hover:text-sky-50/80",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
