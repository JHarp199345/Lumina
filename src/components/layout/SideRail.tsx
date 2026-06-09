import { Archive, BookOpen, FolderOpen, Menu, Moon, Settings, Sun, Monitor, NotebookTabs } from "lucide-react";
import { useSettingsStore } from "@/store/settingsStore";
import { useReaderStore } from "@/store/readerStore";
import { useBookStore } from "@/store/bookStore";
import { useDrawerStore } from "@/store/drawerStore";
import { useAnnotationStore } from "@/store/annotationStore";
import type { Theme } from "@/types";
import type { ReactNode } from "react";

interface SideRailProps {
  onImport: () => void;
  onLibraryOpen: () => void;
  onArchiveOpen: () => void;
  isTablet?: boolean;
  isPhone?: boolean;
  tocOpen?: boolean;
  onTocToggle?: () => void;
  onSettingsOpen: () => void;
}

export default function SideRail({
  onImport,
  onLibraryOpen,
  onArchiveOpen,
  isTablet,
  isPhone,
  tocOpen,
  onTocToggle,
  onSettingsOpen,
}: SideRailProps) {
  const { theme, setTheme } = useSettingsStore();
  const { percentComplete } = useReaderStore();
  const { activeBook } = useBookStore();
  const openDrawer = useDrawerStore((s) => s.open);
  const { getHighlightsForBook, getNotesForBook } = useAnnotationStore();

  const annotationCount = activeBook
    ? getHighlightsForBook(activeBook.id).length + getNotesForBook(activeBook.id).length
    : 0;

  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  const cycleTheme = () => {
    const cycle: Theme[] = ["dark", "light", "system"];
    const current = cycle.indexOf(theme);
    setTheme(cycle[(current + 1) % cycle.length]);
  };

  return (
    <aside
      className={
        isPhone
          ? "absolute left-2 top-1/2 z-50 flex w-12 -translate-y-1/2 flex-col items-center rounded-full border border-white/10 bg-sky-100/[0.075] py-2 shadow-[0_12px_34px_rgba(0,0,0,0.38)] backdrop-blur-xl"
          : "relative flex w-16 flex-shrink-0 flex-col items-center border-r border-hair bg-panel py-3"
      }
    >
      {/* Reading progress bar — left edge, full height, fills as reader advances */}
      <div className={isPhone ? "hidden" : "absolute left-0 top-0 bottom-0 w-0.5 bg-white/4"}>
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

        <RailButton label="Archive" onClick={onArchiveOpen}>
          <Archive size={17} />
        </RailButton>

        {activeBook && (
          <div className="relative">
            <RailButton label="Annotations" onClick={() => openDrawer("menu")}>
              <NotebookTabs size={17} />
            </RailButton>
            {annotationCount > 0 && (
              <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-lumina-gold px-1 text-[9px] font-semibold text-black">
                {annotationCount > 99 ? "99+" : annotationCount}
              </span>
            )}
          </div>
        )}
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
            : "border-hair bg-ink/[0.05] text-ink-soft hover:border-hair hover:bg-ink/[0.07] hover:text-ink/80",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
