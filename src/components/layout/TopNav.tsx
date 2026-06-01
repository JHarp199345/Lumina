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

export default function TopNav({ onImport }: { onImport: () => void }) {
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
      <header className="flex items-center gap-4 px-4 h-12 bg-surface-dark border-b border-white/5 flex-shrink-0 select-none">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-lumina-gold" />
          <span className="text-sm font-semibold tracking-wide text-white/80">LUMINA</span>
        </div>

        <div className="w-px h-4 bg-white/10" />

        {/* Import button */}
        <button
          onClick={onImport}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
        >
          <FolderOpen size={13} />
          <span>Open Book</span>
        </button>

        {/* Active book title */}
        {activeBook && (
          <span className="text-xs text-white/25 truncate max-w-[200px]">
            {activeBook.title}
          </span>
        )}

        <div className="flex-1" />

        {/* Layout preset */}
        <div className="relative">
          <button
            onClick={() => setShowLayoutMenu(!showLayoutMenu)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
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

        {/* Theme toggle */}
        <button
          onClick={cycleTheme}
          className="p-1.5 rounded text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
          title={`Theme: ${theme}`}
        >
          <ThemeIcon size={14} />
        </button>

        {/* Settings */}
        <button
          onClick={() => setShowSettings(true)}
          className="p-1.5 rounded text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
          title="Settings"
        >
          <Settings size={14} />
        </button>
      </header>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </>
  );
}
