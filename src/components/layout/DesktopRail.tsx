/**
 * DesktopRail — the 40px fixed left column on desktop.
 *
 * Always visible. Contains:
 *   - TOC toggle button (top)
 *   - Vertical reading progress bar (middle, left edge)
 *   - Library button (bottom)
 *
 * The rail never takes column space away from Visual or Reader panels.
 * TOC opens as a floating overlay, not a column.
 */

import { BookOpen, Menu, X, Library } from "lucide-react";
import { useBookStore } from "@/store/bookStore";

interface DesktopRailProps {
  tocOpen: boolean;
  onTocToggle: () => void;
  onLibraryOpen: () => void;
  percentComplete: number; // 0–100
}

export default function DesktopRail({
  tocOpen,
  onTocToggle,
  onLibraryOpen,
  percentComplete,
}: DesktopRailProps) {
  const { activeBook } = useBookStore();

  return (
    <div className="relative w-10 flex-shrink-0 flex flex-col items-center bg-surface-dark border-r border-white/5 select-none z-10">

      {/* Vertical progress bar — left edge, full height */}
      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-white/4">
        <div
          className="w-full bg-lumina-gold/30 transition-all duration-1000 ease-out"
          style={{ height: `${Math.min(100, Math.max(0, percentComplete))}%` }}
        />
      </div>

      {/* TOC toggle — top */}
      <button
        onClick={onTocToggle}
        className={`mt-2 min-w-[40px] min-h-[44px] flex items-center justify-center rounded transition-colors ${
          tocOpen
            ? "text-lumina-gold"
            : "text-white/25 hover:text-white/60 active:text-white/60"
        }`}
        aria-label={tocOpen ? "Close contents" : "Open contents"}
        title={tocOpen ? "Close contents" : "Open contents"}
      >
        {tocOpen ? <X size={16} /> : <Menu size={16} />}
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Library button — bottom */}
      <button
        onClick={onLibraryOpen}
        className="mb-2 min-w-[40px] min-h-[44px] flex items-center justify-center rounded text-white/20 hover:text-white/55 active:text-white/55 transition-colors"
        aria-label="Library"
        title="Library"
      >
        <Library size={15} />
      </button>

    </div>
  );
}
