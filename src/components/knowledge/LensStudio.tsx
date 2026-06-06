import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Shuffle, Trash2 } from "lucide-react";
import {
  DEFAULT_VISIBLE_LENS_IDS,
  lensPreviewStyle,
  lensSwatchStyle,
  randomLensName,
  useLensStore,
} from "@/store/lensStore";
import { useAnnotationStore } from "@/store/annotationStore";
import { useBookStore } from "@/store/bookStore";
import type {
  HighlightColor,
  LensCornerStyle,
  LensEdgeStyle,
  LensTextEmphasis,
  LensTexture,
} from "@/types";

const SAMPLE_TEXT =
  "The lantern trembled at the margin of the page, catching one phrase in a small field of light while the rest of the room fell quiet around it.";

const CORNERS: { value: LensCornerStyle; label: string }[] = [
  { value: "sharp", label: "Sharp" },
  { value: "soft", label: "Soft" },
  { value: "round", label: "Round" },
];

const EDGES: { value: LensEdgeStyle; label: string }[] = [
  { value: "none", label: "None" },
  { value: "border", label: "Border" },
  { value: "underline", label: "Stroke" },
  { value: "left", label: "Left" },
];

const TEXTURES: { value: LensTexture; label: string }[] = [
  { value: "clean", label: "Clean" },
  { value: "glass", label: "Glass" },
  { value: "marker", label: "Marker" },
  { value: "neon", label: "Neon" },
];

const EMPHASIS: { value: LensTextEmphasis; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "bold", label: "Bold" },
  { value: "bright", label: "Bright" },
  { value: "lift", label: "Lift" },
];

const BUILT_IN_SET = new Set<HighlightColor>(DEFAULT_VISIBLE_LENS_IDS);

export default function LensStudio() {
  const { activeBook } = useBookStore();
  const { getHighlightsForBook } = useAnnotationStore();
  const {
    lenses,
    visibleLensIds,
    updateLens,
    resetLens,
    resetAll,
    createLens,
    deleteLens,
    toggleVisibleLens,
    moveVisibleLens,
    showAllLenses,
    showDefaultLenses,
  } = useLensStore();
  const [selectedId, setSelectedId] = useState<HighlightColor>("yellow");
  const lensIds = useMemo(() => Object.keys(lenses), [lenses]);
  const lens = lenses[selectedId] ?? lenses[DEFAULT_VISIBLE_LENS_IDS[0]];

  const previewText = useMemo(() => {
    if (!activeBook) return SAMPLE_TEXT;
    const highlights = getHighlightsForBook(activeBook.id);
    const recent = highlights[highlights.length - 1]?.selectedText.trim();
    return recent && recent.length > 12 ? recent : SAMPLE_TEXT;
  }, [activeBook, getHighlightsForBook]);

  const previewStart = Math.max(0, Math.floor(previewText.length * 0.22));
  const previewEnd = Math.max(previewStart + 12, Math.floor(previewText.length * 0.62));
  const before = previewText.slice(0, previewStart);
  const marked = previewText.slice(previewStart, previewEnd);
  const after = previewText.slice(previewEnd);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <section className="border-b border-hair p-4">
          <div className="rounded-xl border border-hair bg-reader p-4 shadow-inner">
            <p className="font-serif text-[18px] leading-[1.75] text-ink-soft">
              {before}
              <mark className="px-[0.12em]" style={lensPreviewStyle(lens)}>
                {marked}
              </mark>
              {after}
            </p>
          </div>
        </section>

        <section className="border-b border-hair p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">
              Quick wheel · {visibleLensIds.length} shown
            </p>
            <div className="flex gap-1">
              <button
                onClick={showDefaultLenses}
                className="rounded-md border border-hair px-2 py-1 text-[10px] text-ink-faint transition-colors hover:bg-ink/[0.06] hover:text-ink-soft"
              >
                Four
              </button>
              <button
                onClick={showAllLenses}
                className="rounded-md border border-hair px-2 py-1 text-[10px] text-ink-faint transition-colors hover:bg-ink/[0.06] hover:text-ink-soft"
              >
                All
              </button>
              <button
                onClick={() => {
                  const id = createLens();
                  setSelectedId(id);
                }}
                title="Create lens"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-lumina-gold/30 text-lumina-gold transition-colors hover:bg-lumina-gold/10"
              >
                <Plus size={13} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {lensIds.map((id) => {
              const visible = visibleLensIds.includes(id);
              const order = visibleLensIds.indexOf(id);
              return (
              <button
                key={id}
                onClick={() => setSelectedId(id)}
                className={`rounded-xl border p-2 text-left transition-colors ${
                  selectedId === id
                    ? "border-lumina-gold/45 bg-lumina-gold/10"
                    : "border-hair bg-ink/[0.03] hover:bg-ink/[0.06]"
                }`}
              >
                <span className="mb-2 flex items-center gap-2">
                  <span
                    className="block h-8 flex-1 border border-white/15"
                    style={lensSwatchStyle(lenses[id])}
                  />
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                    visible ? "bg-lumina-gold/15 text-lumina-gold" : "bg-ink/[0.06] text-ink-faint"
                  }`}>
                    {visible ? order + 1 : "off"}
                  </span>
                </span>
                <span className="block truncate text-[10px] text-ink-soft">{lenses[id].name}</span>
              </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-4 p-4">
          <label className="space-y-1.5">
            <span className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Name</span>
            <div className="flex gap-2">
              <input
                value={lens.name}
                onChange={(e) => updateLens(selectedId, { name: e.target.value })}
                className="min-w-0 flex-1 rounded-lg border border-hair bg-black/20 px-3 py-2 text-sm text-ink-soft focus:border-lumina-gold/45 focus:outline-none"
              />
              <button
                onClick={() => updateLens(selectedId, { name: randomLensName() })}
                title="Randomize name"
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-hair text-lumina-gold/80 transition-colors hover:bg-lumina-gold/10 hover:text-lumina-gold"
              >
                <Shuffle size={15} />
              </button>
            </div>
          </label>

          <div className="rounded-lg border border-hair bg-ink/[0.025] p-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-ink-soft">Show in quick wheel</span>
              <button
                onClick={() => toggleVisibleLens(selectedId)}
                className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                  visibleLensIds.includes(selectedId)
                    ? "bg-lumina-gold/15 text-lumina-gold"
                    : "bg-ink/[0.06] text-ink-faint hover:text-ink-soft"
                }`}
              >
                {visibleLensIds.includes(selectedId) ? "Visible" : "Hidden"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => moveVisibleLens(selectedId, -1)}
                disabled={!visibleLensIds.includes(selectedId)}
                className="flex items-center justify-center gap-2 rounded-md border border-hair px-2 py-1.5 text-[11px] text-ink-faint transition-colors hover:bg-ink/[0.06] hover:text-ink-soft disabled:opacity-35"
              >
                <ArrowUp size={12} />
                Earlier
              </button>
              <button
                onClick={() => moveVisibleLens(selectedId, 1)}
                disabled={!visibleLensIds.includes(selectedId)}
                className="flex items-center justify-center gap-2 rounded-md border border-hair px-2 py-1.5 text-[11px] text-ink-faint transition-colors hover:bg-ink/[0.06] hover:text-ink-soft disabled:opacity-35"
              >
                <ArrowDown size={12} />
                Later
              </button>
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-hair bg-ink/[0.025] px-3 py-2">
            <span className="text-xs text-ink-soft">Color</span>
            <input
              type="color"
              value={lens.color}
              onChange={(e) => updateLens(selectedId, { color: e.target.value })}
              className="h-8 w-12 rounded border border-hair bg-transparent"
            />
          </label>

          <Slider
            label="Opacity"
            value={lens.opacity}
            onChange={(opacity) => updateLens(selectedId, { opacity })}
          />
          <Slider
            label="Glow"
            value={lens.glow}
            onChange={(glow) => updateLens(selectedId, { glow })}
          />

          <Segmented
            label="Corners"
            value={lens.cornerStyle}
            options={CORNERS}
            onChange={(cornerStyle) => updateLens(selectedId, { cornerStyle })}
          />
          <Segmented
            label="Texture"
            value={lens.texture}
            options={TEXTURES}
            onChange={(texture) => updateLens(selectedId, { texture })}
          />
          <Segmented
            label="Edge"
            value={lens.edgeStyle}
            options={EDGES}
            onChange={(edgeStyle) => updateLens(selectedId, { edgeStyle })}
          />
          <Segmented
            label="Text"
            value={lens.textEmphasis}
            options={EMPHASIS}
            onChange={(textEmphasis) => updateLens(selectedId, { textEmphasis })}
          />
        </section>
      </div>

      <div className="flex gap-2 border-t border-hair p-3">
        <button
          onClick={() => resetLens(selectedId)}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-hair px-3 py-2 text-xs text-ink-soft transition-colors hover:bg-ink/[0.06]"
        >
          <RotateCcw size={13} />
          Reset lens
        </button>
        <button
          onClick={resetAll}
          className="rounded-lg border border-hair px-3 py-2 text-xs text-ink-faint transition-colors hover:bg-ink/[0.06] hover:text-ink-soft"
        >
          Reset all
        </button>
        {!BUILT_IN_SET.has(selectedId) && (
          <button
            onClick={() => {
              deleteLens(selectedId);
              setSelectedId("yellow");
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-rose-400/20 text-rose-300/70 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
            title="Delete lens"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1.5">
      <span className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-ink-faint">
        {label}
        <span className="font-mono text-ink-soft">{Math.round(value)}</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-lumina-gold"
      />
    </label>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">{label}</p>
      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-hair text-[11px]">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`px-2 py-2 transition-colors ${
              option.value === value
                ? "bg-lumina-gold/15 text-lumina-gold"
                : "bg-ink/[0.02] text-ink-faint hover:bg-ink/[0.06] hover:text-ink-soft"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
