import { useState } from "react";
import { Sparkles, Settings, Sun, Moon, Monitor, Columns3, FolderOpen } from "lucide-react";
import { useSettingsStore } from "@/store/settingsStore";
import { useBookStore } from "@/store/bookStore";
import type { LayoutPreset, Theme } from "@/types";
import SettingsPanel from "@/components/common/SettingsPanel";

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
      <header className={`flex items-center gap-3 px-5 bg-gradient-to-r from-sky-100/[0.055] to-transparent border-b border-sky-200/12 flex-shrink-0 select-none ${isTablet ? "h-14" : "h-12"}`}>
        {/* Logo */}
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-lumina-gold" />
          <span className="text-sm font-semibold tracking-wide text-white/80">LUMINA</span>
        </div>

        <div className="w-px h-4 bg-white/10" />

        {/* Import button */}
        <button
          onClick={onImport}
          className={`flex items-center gap-1.5 rounded-lg border transition-colors ${
            !activeBook
              ? "border-lumina-gold/28 bg-lumina-gold/10 text-lumina-gold/90 hover:bg-lumina-gold/15"
              : "border-sky-200/14 bg-sky-100/[0.035] text-sky-100/48 hover:border-sky-100/24 hover:bg-sky-100/[0.07] hover:text-sky-50/80"
          } ${
            isTablet ? "min-h-[44px] px-3 text-sm" : "px-3 py-2 text-xs"
          }`}
        >
          <FolderOpen size={13} />
          <span>Open Book</span>
        </button>

        {/* Active book title */}
        {activeBook && (
          <span className="text-xs text-white/25 truncate max-w-[200px] hidden sm:block">
            {activeBook.title}
          </span>
        )}

        <div className="flex-1" />

        {/* Layout preset — desktop only (tablet has its own fixed layout) */}
        {!isTablet && (
          <div className="relative">
            <button
              onClick={() => setShowLayoutMenu(!showLayoutMenu)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-sky-200/14 bg-sky-100/[0.035] text-xs text-sky-100/48 hover:border-sky-100/24 hover:bg-sky-100/[0.07] hover:text-sky-50/80 transition-colors"
            >
              <Columns3 size={13} />
              <span>{LAYOUT_LABELS[layoutPreset]}</span>
            </button>

            {showLayoutMenu && (
              <div
                className="absolute right-0 top-full mt-1 w-36 bg-surface-dark border border-white/10 rounded-lg shadow-xl overflow-hidden z-50"
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
                        : "text-white/50 hover:text-white/80 hover:bg-white/5"
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
          className={`rounded-lg border border-sky-200/14 bg-sky-100/[0.035] text-sky-100/42 hover:border-sky-100/24 hover:bg-sky-100/[0.07] hover:text-sky-50/75 active:text-sky-50 transition-colors flex items-center justify-center ${
            isTablet ? "min-w-[44px] min-h-[44px]" : "w-9 h-9"
          }`}
          title={`Theme: ${theme}`}
        >
          <ThemeIcon size={15} />
        </button>

        {/* Settings */}
        <button
          onClick={() => setShowSettings(true)}
          className={`rounded-lg border border-sky-200/14 bg-sky-100/[0.035] text-sky-100/42 hover:border-sky-100/24 hover:bg-sky-100/[0.07] hover:text-sky-50/75 active:text-sky-50 transition-colors flex items-center justify-center ${
            isTablet ? "min-w-[44px] min-h-[44px]" : "w-9 h-9"
          }`}
          title="Settings"
        >
          <Settings size={15} />
        </button>
      </header>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </>
  );
}
