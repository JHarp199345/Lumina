import { useEffect, useRef, useState } from "react";
import { Pencil, Sparkles, Wand2 } from "lucide-react";
import { useDeviceLayout } from "@/hooks/useDeviceLayout";
import type { SourceProfileSuggestion } from "@/types";

export interface SuggestionComposerProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: SourceProfileSuggestion[];
  selectedId: string | null;
  onPick: (id: string) => void;
  onRequestFuller: (ghostAngle?: SourceProfileSuggestion | null) => void | Promise<void>;
  isSuggesting: boolean;
  tailored: boolean;
  building: boolean;
  /** Accessible name for the textarea */
  promptLabel?: string;
}

/**
 * Ghost-text prompt field — suggestions from the Source Intelligence Profile bank.
 * Tab (desktop) or Use (touch) accepts ghost text without committing until accepted.
 */
export default function SuggestionComposer({
  value,
  onChange,
  suggestions,
  selectedId,
  onPick,
  onRequestFuller,
  isSuggesting,
  tailored,
  building,
  promptLabel = "Prompt instruction",
}: SuggestionComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const { isTablet, isPhone } = useDeviceLayout();
  const showTouchAccept = isTablet || isPhone;

  const [browseOpen, setBrowseOpen] = useState(false);
  const [ghostIndex, setGhostIndex] = useState(0);

  const hasValue = Boolean(value.trim());
  const ghostSuggestion = suggestions[ghostIndex] ?? null;
  const ghostText = ghostSuggestion?.planText ?? "";
  const showGhost = !hasValue && Boolean(ghostText) && !browseOpen;

  useEffect(() => {
    if (selectedId) {
      const idx = suggestions.findIndex((s) => s.id === selectedId);
      if (idx >= 0) setGhostIndex(idx);
    }
  }, [selectedId, suggestions]);

  useEffect(() => {
    if (ghostIndex >= suggestions.length) setGhostIndex(0);
  }, [ghostIndex, suggestions.length]);

  const focusSoon = () => requestAnimationFrame(() => inputRef.current?.focus());

  const acceptGhost = () => {
    if (!ghostSuggestion || !ghostText) return;
    onPick(ghostSuggestion.id);
    focusSoon();
  };

  const syncGhostScroll = () => {
    if (ghostRef.current && inputRef.current) {
      ghostRef.current.scrollTop = inputRef.current.scrollTop;
    }
  };

  if (browseOpen) {
    return (
      <div className="overflow-hidden rounded-lg border border-hair bg-surface-dark/62 shadow-inner shadow-black/10">
        <div className="flex items-center gap-1.5 border-b border-hair px-3 py-1.5">
          <Sparkles size={11} className="shrink-0 text-lumina-gold/70" />
          <p className="text-[10px] text-ink-faint">
            {building
              ? "Tailoring suggestions to this book…"
              : tailored
                ? "Suggested from this book"
                : "Starting points · analyze the book for tailored ones"}
          </p>
        </div>

        <div className="max-h-64 space-y-1 overflow-y-auto p-2 scrollbar-thin">
          {suggestions.length === 0 ? (
            <p className="px-1 py-3 text-center text-[11px] text-ink-faint">
              Suggestions will appear once the book is ready.
            </p>
          ) : (
            suggestions.map((s, i) => (
              <button
                key={s.id}
                onClick={() => {
                  setGhostIndex(i);
                  setBrowseOpen(false);
                  focusSoon();
                }}
                className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                  ghostIndex === i
                    ? "border-lumina-gold/45 bg-lumina-gold/[0.1]"
                    : "border-hair bg-ink/[0.02] hover:border-lumina-gold/30 hover:bg-ink/[0.04]"
                }`}
              >
                <p className="text-[12px] font-medium text-ink/85">{s.label}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">{s.planText}</p>
              </button>
            ))
          )}
        </div>

        <button
          onClick={() => {
            setBrowseOpen(false);
            focusSoon();
          }}
          className="flex w-full items-center gap-1.5 border-t border-hair px-3 py-2 text-[11px] text-ink-soft transition-colors hover:bg-ink/[0.03] hover:text-ink"
        >
          <Pencil size={11} className="text-lumina-gold/70" />
          Back to editor
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-hair bg-surface-dark/62 shadow-inner shadow-black/10 transition-colors focus-within:border-lumina-gold/35 focus-within:bg-surface-dark/72">
      <div className="flex items-center justify-between gap-2 border-b border-hair px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Sparkles size={11} className="shrink-0 text-lumina-gold/70" />
          <p className="truncate text-[10px] text-ink-faint">
            {building
              ? "Tailoring suggestions…"
              : showGhost && ghostSuggestion
                ? `${ghostSuggestion.label} · suggestion`
                : hasValue
                  ? "Your instruction"
                  : "Write your own instruction"}
          </p>
        </div>
        {suggestions.length > 1 && showGhost && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setGhostIndex((i) => (i - 1 + suggestions.length) % suggestions.length)}
              className="rounded border border-hair px-1.5 py-0.5 text-[10px] text-ink-faint hover:text-ink-soft"
              aria-label="Previous suggestion"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setGhostIndex((i) => (i + 1) % suggestions.length)}
              className="rounded border border-hair px-1.5 py-0.5 text-[10px] text-ink-faint hover:text-ink-soft"
              aria-label="Next suggestion"
            >
              ›
            </button>
          </div>
        )}
      </div>

      <div className="relative">
        {showGhost && (
          <div
            ref={ghostRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden px-3 py-2.5 text-xs leading-relaxed text-ink-faint/42 whitespace-pre-wrap"
          >
            {ghostText}
          </div>
        )}
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncGhostScroll}
          onKeyDown={(e) => {
            if (e.key === "Tab" && showGhost && !showTouchAccept) {
              e.preventDefault();
              acceptGhost();
            }
          }}
          aria-label={promptLabel}
          rows={8}
          className={`block max-h-80 min-h-36 w-full resize-y border-0 bg-transparent px-3 py-2.5 text-xs leading-relaxed caret-lumina-gold outline-none ${
            showGhost ? "text-transparent selection:bg-lumina-gold/25" : "text-ink-soft"
          }`}
        />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-hair px-3 py-2">
        <button
          type="button"
          onClick={() => setBrowseOpen(true)}
          className="flex items-center gap-1.5 text-[11px] text-ink-faint transition-colors hover:text-ink-soft"
        >
          <Sparkles size={11} className="text-lumina-gold/70" />
          {suggestions.length > 0 ? "Browse suggestions" : "Suggestions"}
        </button>

        {showGhost && (
          <div className="flex items-center gap-2">
            {!showTouchAccept && (
              <span className="hidden text-[10px] text-ink-faint/70 sm:inline">Tab to use</span>
            )}
            {showTouchAccept && (
              <button
                type="button"
                onClick={acceptGhost}
                className="flex items-center gap-1 rounded border border-lumina-gold/35 bg-lumina-gold/[0.08] px-2 py-1 text-[10px] font-medium text-lumina-gold/90 transition-colors hover:bg-lumina-gold/[0.14]"
              >
                Use
                <kbd className="rounded border border-hair/80 bg-ink/[0.06] px-1 py-px text-[9px] text-ink-faint">
                  Tab
                </kbd>
              </button>
            )}
            <button
              type="button"
              onClick={() => onRequestFuller(ghostSuggestion)}
              disabled={isSuggesting}
              className="flex items-center gap-1 rounded border border-hair px-2 py-1 text-[10px] text-lumina-gold/75 transition-colors hover:text-lumina-gold disabled:opacity-40"
            >
              <Wand2 size={10} className={isSuggesting ? "animate-pulse" : ""} />
              {isSuggesting ? "…" : "Expand"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
