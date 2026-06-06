import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CSSProperties } from "react";
import type {
  HighlightColor,
  HighlightLens,
  LensCornerStyle,
  LensEdgeStyle,
  LensTextEmphasis,
  LensTexture,
} from "@/types";

export const BUILT_IN_LENS_IDS = ["yellow", "blue", "green", "red"] as const;
export const DEFAULT_VISIBLE_LENS_IDS: HighlightColor[] = [...BUILT_IN_LENS_IDS];

export const DEFAULT_LENSES: Record<string, HighlightLens> = {
  yellow: {
    id: "yellow",
    name: "Amber Glass",
    color: "#d8b24e",
    opacity: 32,
    cornerStyle: "round",
    glow: 34,
    edgeStyle: "border",
    texture: "glass",
    textEmphasis: "lift",
  },
  blue: {
    id: "blue",
    name: "Sapphire Drift",
    color: "#418fcb",
    opacity: 30,
    cornerStyle: "round",
    glow: 30,
    edgeStyle: "border",
    texture: "glass",
    textEmphasis: "normal",
  },
  green: {
    id: "green",
    name: "Verdant Field",
    color: "#46a877",
    opacity: 28,
    cornerStyle: "round",
    glow: 24,
    edgeStyle: "border",
    texture: "glass",
    textEmphasis: "normal",
  },
  red: {
    id: "red",
    name: "Ember Veil",
    color: "#d56a52",
    opacity: 28,
    cornerStyle: "round",
    glow: 28,
    edgeStyle: "border",
    texture: "glass",
    textEmphasis: "normal",
  },
};

interface LensStore {
  lenses: Record<string, HighlightLens>;
  visibleLensIds: HighlightColor[];
  updateLens: (id: HighlightColor, patch: Partial<Omit<HighlightLens, "id">>) => void;
  resetLens: (id: HighlightColor) => void;
  resetAll: () => void;
  randomizeName: (id: HighlightColor) => void;
  createLens: () => HighlightColor;
  deleteLens: (id: HighlightColor) => void;
  toggleVisibleLens: (id: HighlightColor) => void;
  moveVisibleLens: (id: HighlightColor, direction: -1 | 1) => void;
  showAllLenses: () => void;
  showDefaultLenses: () => void;
}

export const useLensStore = create<LensStore>()(
  persist(
    (set) => ({
      lenses: DEFAULT_LENSES,
      visibleLensIds: DEFAULT_VISIBLE_LENS_IDS,
      updateLens: (id, patch) =>
        set((state) => ({
          lenses: {
            ...state.lenses,
            [id]: normalizeLens({ ...state.lenses[id], ...patch, id }),
          },
        })),
      resetLens: (id) =>
        set((state) => ({
          lenses: {
            ...state.lenses,
            [id]: DEFAULT_LENSES[id] ?? state.lenses[id],
          },
        })),
      resetAll: () => set({ lenses: DEFAULT_LENSES, visibleLensIds: DEFAULT_VISIBLE_LENS_IDS }),
      randomizeName: (id) =>
        set((state) => ({
          lenses: {
            ...state.lenses,
            [id]: { ...state.lenses[id], name: randomLensName() },
          },
        })),
      createLens: () => {
        const id = `lens_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        set((state) => ({
          lenses: {
            ...state.lenses,
            [id]: {
              ...DEFAULT_LENSES.yellow,
              id,
              name: randomLensName(),
              color: randomLensColor(),
            },
          },
          visibleLensIds: [...state.visibleLensIds, id],
        }));
        return id;
      },
      deleteLens: (id) =>
        set((state) => {
          if (id in DEFAULT_LENSES) return state;
          const { [id]: _deleted, ...lenses } = state.lenses;
          return {
            lenses,
            visibleLensIds: state.visibleLensIds.filter((lensId) => lensId !== id),
          };
        }),
      toggleVisibleLens: (id) =>
        set((state) => {
          const exists = state.visibleLensIds.includes(id);
          if (exists && state.visibleLensIds.length <= 1) return state;
          return {
            visibleLensIds: exists
              ? state.visibleLensIds.filter((lensId) => lensId !== id)
              : [...state.visibleLensIds, id],
          };
        }),
      moveVisibleLens: (id, direction) =>
        set((state) => {
          const index = state.visibleLensIds.indexOf(id);
          const nextIndex = index + direction;
          if (index < 0 || nextIndex < 0 || nextIndex >= state.visibleLensIds.length) return state;
          const visibleLensIds = [...state.visibleLensIds];
          const [item] = visibleLensIds.splice(index, 1);
          visibleLensIds.splice(nextIndex, 0, item);
          return { visibleLensIds };
        }),
      showAllLenses: () =>
        set((state) => ({ visibleLensIds: Object.keys(state.lenses) })),
      showDefaultLenses: () => set({ visibleLensIds: DEFAULT_VISIBLE_LENS_IDS }),
    }),
    {
      name: "lumina-highlight-lenses",
      merge: (persisted, current) => {
        const saved = persisted as Partial<LensStore> | undefined;
        return {
          ...current,
          ...saved,
          lenses: {
            ...DEFAULT_LENSES,
            ...(saved?.lenses ?? {}),
          },
          visibleLensIds: normalizeVisibleLensIds(
            saved?.visibleLensIds,
            {
              ...DEFAULT_LENSES,
              ...(saved?.lenses ?? {}),
            }
          ),
        };
      },
    }
  )
);

function normalizeLens(lens: HighlightLens): HighlightLens {
  return {
    ...lens,
    name: lens.name.trim() || DEFAULT_LENSES[lens.id]?.name || "Custom Lens",
    color: /^#[0-9a-f]{6}$/i.test(lens.color) ? lens.color : DEFAULT_LENSES[lens.id]?.color ?? DEFAULT_LENSES.yellow.color,
    opacity: clamp(lens.opacity, 0, 100),
    glow: clamp(lens.glow, 0, 100),
    cornerStyle: oneOf<LensCornerStyle>(lens.cornerStyle, ["sharp", "soft", "round"], "round"),
    edgeStyle: oneOf<LensEdgeStyle>(lens.edgeStyle, ["none", "border", "underline", "left"], "border"),
    texture: oneOf<LensTexture>(lens.texture, ["clean", "glass", "marker", "neon"], "glass"),
    textEmphasis: oneOf<LensTextEmphasis>(
      lens.textEmphasis,
      ["normal", "bold", "bright", "lift"],
      "normal"
    ),
  };
}

function normalizeVisibleLensIds(
  ids: HighlightColor[] | undefined,
  lenses: Record<string, HighlightLens>
): HighlightColor[] {
  const valid = (ids ?? DEFAULT_VISIBLE_LENS_IDS).filter((id) => lenses[id]);
  return valid.length ? Array.from(new Set(valid)) : DEFAULT_VISIBLE_LENS_IDS;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function oneOf<T extends string>(value: string, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

const NAME_ADJECTIVES = [
  "Amber",
  "Astral",
  "Blue",
  "Brass",
  "Celestial",
  "Electric",
  "Ember",
  "Glass",
  "Golden",
  "Hallowed",
  "Ink",
  "Iris",
  "Lantern",
  "Moonlit",
  "Opal",
  "Sapphire",
  "Solar",
  "Verdant",
  "Violet",
  "Wild",
];

const NAME_NOUNS = [
  "Afterglow",
  "Bloom",
  "Current",
  "Field",
  "Halo",
  "Lacquer",
  "Lens",
  "Margin",
  "Mist",
  "Pulse",
  "Ribbon",
  "Signal",
  "Trace",
  "Veil",
  "Vellum",
  "Wake",
];

export function randomLensName(): string {
  const adjective = NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)];
  const noun = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)];
  return `${adjective} ${noun}`;
}

function randomLensColor(): string {
  const colors = ["#d8b24e", "#418fcb", "#46a877", "#d56a52", "#a86fe8", "#e85fa7", "#38c5b8", "#f0833f"];
  return colors[Math.floor(Math.random() * colors.length)];
}

export function lensClassName(id: HighlightColor): string {
  return `highlight-${cssSafeLensId(id)}`;
}

export function epubLensClassName(id: HighlightColor): string {
  return `lumina-hl-${cssSafeLensId(id)}`;
}

export function cssSafeLensId(id: HighlightColor): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function getLensRadius(lens: HighlightLens): string {
  if (lens.cornerStyle === "sharp") return "0.08em";
  if (lens.cornerStyle === "soft") return "0.28em";
  return "0.52em";
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function lensBackground(lens: HighlightLens): string {
  const base = lens.opacity / 100;
  if (lens.texture === "clean") {
    return `linear-gradient(180deg, ${rgba(lens.color, base)}, ${rgba(lens.color, base * 0.72)})`;
  }
  if (lens.texture === "marker") {
    return [
      `linear-gradient(180deg, ${rgba(lens.color, base * 0.64)}, ${rgba(lens.color, base)})`,
      `repeating-linear-gradient(102deg, ${rgba("#ffffff", 0.10)} 0 2px, transparent 2px 8px)`,
    ].join(", ");
  }
  if (lens.texture === "neon") {
    return [
      `linear-gradient(180deg, ${rgba(lens.color, base * 0.8)}, ${rgba(lens.color, base * 0.5)})`,
      `radial-gradient(ellipse at 50% 70%, ${rgba(lens.color, Math.min(0.45, base * 1.25))}, transparent 72%)`,
    ].join(", ");
  }
  return [
    `linear-gradient(180deg, ${rgba("#ffffff", base * 0.64)}, ${rgba(lens.color, base * 0.76)})`,
    `radial-gradient(ellipse at 50% 72%, ${rgba(lens.color, base * 0.72)}, transparent 70%)`,
  ].join(", ");
}

export function lensBoxShadow(lens: HighlightLens): string {
  const glow = lens.glow / 100;
  const edge = lens.edgeStyle === "border" ? `0 0 0 1px ${rgba(lens.color, 0.22)}` : "";
  const halo = glow > 0 ? `0 0 ${Math.round(8 + glow * 24)}px ${rgba(lens.color, 0.08 + glow * 0.32)}` : "";
  const inset = lens.texture === "glass" ? "inset 0 1px 0 rgba(255,255,255,0.30)" : "";
  return [edge, halo, inset].filter(Boolean).join(", ") || "none";
}

export function lensTextShadow(lens: HighlightLens): string {
  if (lens.textEmphasis === "bright") return `0 0 10px ${rgba("#ffffff", 0.22)}`;
  if (lens.textEmphasis === "lift") return `0 1px 0 ${rgba("#ffffff", 0.10)}`;
  return "0 0 0.01px currentColor";
}

export function lensFontWeight(lens: HighlightLens): string {
  return lens.textEmphasis === "bold" ? "600" : "inherit";
}

export function lensBorder(lens: HighlightLens): string {
  if (lens.edgeStyle === "underline") return `0 -0.11em 0 ${rgba(lens.color, 0.56)} inset`;
  if (lens.edgeStyle === "left") return `0.16em 0 0 ${rgba(lens.color, 0.72)} inset`;
  return lensBoxShadow(lens);
}

export function lensCss(lens: HighlightLens): string {
  const shadow = lens.edgeStyle === "underline" || lens.edgeStyle === "left"
    ? `${lensBoxShadow(lens)}, ${lensBorder(lens)}`
    : lensBoxShadow(lens);
  return `
    background: ${lensBackground(lens)};
    border-radius: ${getLensRadius(lens)};
    box-shadow: ${shadow};
    font-weight: ${lensFontWeight(lens)};
    text-shadow: ${lensTextShadow(lens)};
  `;
}

export function lensThemeProperties(lens: HighlightLens): Record<string, string> {
  const shadow = lens.edgeStyle === "underline" || lens.edgeStyle === "left"
    ? `${lensBoxShadow(lens)}, ${lensBorder(lens)}`
    : lensBoxShadow(lens);
  return {
    "background": lensBackground(lens),
    "border-radius": getLensRadius(lens),
    "box-shadow": shadow,
    "box-decoration-break": "clone",
    "-webkit-box-decoration-break": "clone",
    "padding": "0.02em 0.12em",
    "text-shadow": lensTextShadow(lens),
    "font-weight": lensFontWeight(lens),
  };
}

export function buildLensStyleSheet(lenses: Record<string, HighlightLens>): string {
  return Object.keys(lenses).map((id) => {
    const lens = lenses[id];
    return `
      .${lensClassName(id)},
      .${epubLensClassName(id)} {
        ${lensCss(lens)}
      }
    `;
  }).join("\n");
}

export function lensSwatchStyle(lens: HighlightLens): CSSProperties {
  return {
    background: lensBackground(lens),
    boxShadow: lensBoxShadow(lens),
    borderRadius: getLensRadius(lens),
  };
}

export function lensPreviewStyle(lens: HighlightLens): CSSProperties {
  return {
    background: lensBackground(lens),
    borderRadius: getLensRadius(lens),
    boxShadow:
      lens.edgeStyle === "underline" || lens.edgeStyle === "left"
        ? `${lensBoxShadow(lens)}, ${lensBorder(lens)}`
        : lensBoxShadow(lens),
    fontWeight: lensFontWeight(lens),
    textShadow: lensTextShadow(lens),
  };
}

export function lensSvgFill(lens: HighlightLens): Record<string, string> {
  return {
    fill: lens.color,
    "fill-opacity": String(Math.max(0.08, Math.min(0.65, lens.opacity / 100))),
    stroke: lens.edgeStyle === "border" ? rgba(lens.color, 0.48) : "transparent",
    "stroke-width": lens.edgeStyle === "border" ? "0.6" : "0",
    "mix-blend-mode": lens.texture === "neon" ? "screen" : "multiply",
  };
}
