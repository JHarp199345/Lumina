import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UserSettings, Theme, ReadingWidth, LayoutPreset, PanelLayout, PanelOrder } from "@/types";
import { LUMINA_CONFIG } from "@/config";

interface SettingsStore extends UserSettings {
  setTheme: (theme: Theme) => void;
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
  setReadingWidth: (width: ReadingWidth) => void;
  setImageGenerationEnabled: (enabled: boolean) => void;
  setLayoutPreset: (preset: LayoutPreset) => void;
  setPanelLayout: (layout: PanelLayout) => void;
  setPanelOrder: (order: PanelOrder) => void;
  setHasCompletedOnboarding: (completed: boolean) => void;
  setApiKeyConfigured: (configured: boolean) => void;
  resolvedTheme: () => "dark" | "light";
}

const LAYOUT_PRESETS: Record<LayoutPreset, { layout: PanelLayout; order: PanelOrder }> = {
  classic: {
    layout: { toc: 20, visual: 35, reader: 45 },
    order: { panels: ["toc", "visual", "reader"] },
  },
  focused: {
    layout: { toc: 0, visual: 25, reader: 75 },
    order: { panels: ["toc", "reader", "visual"] },
  },
  immersive: {
    layout: { toc: 0, visual: 50, reader: 50 },
    order: { panels: ["toc", "visual", "reader"] },
  },
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      // Defaults
      theme: LUMINA_CONFIG.DEFAULT_THEME,
      fontSize: LUMINA_CONFIG.DEFAULT_FONT_SIZE,
      lineHeight: LUMINA_CONFIG.DEFAULT_LINE_HEIGHT,
      readingWidth: LUMINA_CONFIG.DEFAULT_READING_WIDTH,
      imageGenerationEnabled: true,
      layoutPreset: "classic",
      panelLayout: { toc: 0, visual: 40, reader: 60 },
      panelOrder: { panels: ["toc", "visual", "reader"] },
      hasCompletedOnboarding: false,
      apiKeyConfigured: false,

      // Actions
      setTheme: (theme) => set({ theme }),
      setFontSize: (fontSize) => set({ fontSize }),
      setLineHeight: (lineHeight) => set({ lineHeight }),
      setReadingWidth: (readingWidth) => set({ readingWidth }),
      setImageGenerationEnabled: (imageGenerationEnabled) => set({ imageGenerationEnabled }),
      setPanelLayout: (panelLayout) => set({ panelLayout }),
      setPanelOrder: (panelOrder) => set({ panelOrder }),
      setHasCompletedOnboarding: (hasCompletedOnboarding) => set({ hasCompletedOnboarding }),
      setApiKeyConfigured: (apiKeyConfigured) => set({ apiKeyConfigured }),

      setLayoutPreset: (preset) => {
        const { layout, order } = LAYOUT_PRESETS[preset];
        set({ layoutPreset: preset, panelLayout: layout, panelOrder: order });
      },

      resolvedTheme: () => {
        const { theme } = get();
        if (theme === "system") {
          return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        }
        return theme;
      },
    }),
    {
      name: "lumina-settings",
    }
  )
);
