// Central configuration — never hardcode these values inline

export const LUMINA_CONFIG = {
  // Read-ahead generation distances (in words)
  GENERATION_TRIGGER_DISTANCE_WORDS: 2000,
  GENERATION_APPROACH_DISTANCE_WORDS: 5000,

  // Golden number caps by book length
  MAX_IMAGES_SHORT_BOOK: 5,    // < 50k words
  MAX_IMAGES_MEDIUM_BOOK: 8,   // 50k–150k words
  MAX_IMAGES_LONG_BOOK: 12,    // > 150k words
  MIN_IMAGES: 2,

  // UI
  IMAGE_TRANSITION_DURATION_MS: 1500,
  IMAGE_ASPECT_RATIO: "16:9" as const,

  // API
  SEMANTIC_CHUNK_MAX_TOKENS: 400,
  GEMINI_MODEL: "gemini-2.0-flash",
  IMAGEN_MODEL: "imagen-3.0-generate-002",

  // Storage
  IMAGE_CACHE_DIR: "lumina/cache/images",
  DB_NAME: "lumina.db",

  // Reader defaults
  DEFAULT_FONT_SIZE: 18,
  DEFAULT_LINE_HEIGHT: 1.7,
  DEFAULT_READING_WIDTH: "medium" as const,
  DEFAULT_THEME: "dark" as const,

  // Panel layout defaults (percentages)
  // TOC is 0 by default — hidden until summoned via the rail button
  DEFAULT_PANEL_LAYOUT: { toc: 0, visual: 40, reader: 60 },
} as const;

export type ReadingWidth = "narrow" | "medium" | "wide";
export type Theme = "dark" | "light" | "system";
export type LayoutPreset = "classic" | "focused" | "immersive";
