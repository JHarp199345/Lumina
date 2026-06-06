import { useState } from "react";
import { Sparkles, Settings, Sun, Moon, Monitor, Columns3, FolderOpen, Search } from "lucide-react";
import { useSettingsStore } from "@/store/settingsStore";
import { useBookStore } from "@/store/bookStore";
import type { LayoutPreset, Theme } from "@/types";
import SettingsPanel from "@/components/common/SettingsPanel";
import SearchBar from "@/components/reader/SearchBar";

const LAYOUT_LABELS: Record<LayoutPreset, string> = {
  classic: "Classic",
  focused: "Focused",
  immersive: "Immersive",
};

interface TopNavProps {
  onImport: () => void;
  /** Tablet-specific: whether we're currently on a tablet */
  isTablet?: boolean;
  /** Tablet-specific: whether the TOC is currently open */
  tocOpen?: boolean;
  /** Tablet-specific: toggle the TOC rail / drawer */
  onTocToggle?: () => void;
}

export default function TopNav({ onImport, isTablet }: TopNavProps) {
  const { theme, setTheme, layoutPreset, setLayoutPreset } = useSettingsStore();
  const { activeBook } = useBookStore();
  const [showSettings, setShowSettings] = useState(false);
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const themeIcon =
    theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const ThemeIcon = themeIcon;

  const cycleTheme = () => {
    const cycle: Theme[] = ["dark", "light", "system"];
    const current = cycle.indexOf(theme);
    setTheme(cycle[(current + 1) % cycle.length]);
  };

  return (
    <>
      {/* Height is taller on tablet (h-14) for easier touch */}
      <header className={`flex items-center gap-3 px-5 bg-gradient-to-r from-sky-100/[0.055] to-transparent border-b border-hair flex-shrink-0 select-none ${isTablet ? "h-14" : "h-12"}`}>
        {/* Logo */}
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-lumina-gold" />
          <span className="text-sm font-semibold tracking-wide text-ink/80">LUMINA</span>
        </div>

        <div className="w-px h-4 bg-ink/10" />

        {/* Import button */}
        <button
          onClick={onImport}
          className={`flex items-center gap-1.5 rounded-lg border transition-colors ${
            !activeBook
              ? "border-lumina-gold/28 bg-lumina-gold/10 text-lumina-gold/90 hover:bg-lumina-gold/15"
              : "border-hair bg-ink/[0.05] text-ink-soft hover:border-hair hover:bg-ink/[0.07] hover:text-ink/80"
          } ${
            isTablet ? "min-h-[44px] px-3 text-sm" : "px-3 py-2 text-xs"
          }`}
        >
          <FolderOpen size={13} />
          <span>Open Book</span>
        </button>

        <button
          onClick={() => setShowSearch((v) => !v)}
          className={`flex items-center justify-center rounded-lg border border-hair bg-ink/[0.05] text-ink-faint transition-colors hover:border-hair hover:bg-ink/[0.07] hover:text-ink/80 ${
            isTablet ? "min-h-[44px] min-w-[44px]" : "h-9 w-9"
          } ${showSearch ? "border-lumina-gold/35 bg-lumina-gold/10 text-lumina-gold" : ""}`}
          title="Search"
          aria-label="Search"
        >
          <Search size={14} />
        </button>

        {/* Active book title */}
        {activeBook && (
          <span className="text-xs text-ink-faint truncate max-w-[200px] hidden sm:block">
            {activeBook.title}
          </span>
        )}

        <div className="flex-1" />

        {/* Layout preset — desktop only (tablet has its own fixed layout) */}
        {!isTablet && (
          <div className="relative">
            <button
              onClick={() => setShowLayoutMenu(!showLayoutMenu)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-hair bg-ink/[0.05] text-xs text-ink-soft hover:border-hair hover:bg-ink/[0.07] hover:text-ink/80 transition-colors"
            >
              <Columns3 size={13} />
              <span>{LAYOUT_LABELS[layoutPreset]}</span>
            </button>

            {showLayoutMenu && (
              <div
                className="absolute right-0 top-full mt-1 w-36 bg-surface-dark border border-hair rounded-lg shadow-xl overflow-hidden z-50"
                onMouseLeave={() => setShowLayoutMenu(false)}
              >
                {(["classic", "focused", "immersive"] as LayoutPreset[]).map((preset) => (
                  <button
                    key={preset}
                    onClick={() => {
                      setLayoutPreset(preset);
                      setShowLayoutMenu(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs transition-colors ${
                      preset === layoutPreset
                        ? "text-lumina-gold bg-lumina-gold/10"
                        : "text-ink-soft hover:text-ink/80 hover:bg-ink/5"
                    }`}
                  >
                    {LAYOUT_LABELS[preset]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Theme toggle */}
        <button
          onClick={cycleTheme}
          className={`rounded-lg border border-hair bg-ink/[0.05] text-ink-faint hover:border-hair hover:bg-ink/[0.07] hover:text-ink/75 active:text-ink transition-colors flex items-center justify-center ${
            isTablet ? "min-w-[44px] min-h-[44px]" : "w-9 h-9"
          }`}
          title={`Theme: ${theme}`}
        >
          <ThemeIcon size={15} />
        </button>

        {/* Settings */}
        <button
          onClick={() => setShowSettings(true)}
          className={`rounded-lg border border-hair bg-ink/[0.05] text-ink-faint hover:border-hair hover:bg-ink/[0.07] hover:text-ink/75 active:text-ink transition-colors flex items-center justify-center ${
            isTablet ? "min-w-[44px] min-h-[44px]" : "w-9 h-9"
          }`}
          title="Settings"
        >
          <Settings size={15} />
        </button>
      </header>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      <AnimateSearch visible={showSearch} onClose={() => setShowSearch(false)} />
    </>
  );
}

function AnimateSearch({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  if (!visible) return null;
  return (
    <div className="fixed left-1/2 top-16 z-[58] w-[min(520px,calc(100vw-1.5rem))] -translate-x-1/2">
      <SearchBar onClose={onClose} />
    </div>
  );
}
