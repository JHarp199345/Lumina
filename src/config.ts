// Central configuration — never hardcode these values inline

export const LUMINA_CONFIG = {
  // Read-ahead generation distances (in words)
  GENERATION_TRIGGER_DISTANCE_WORDS: 2000,
  GENERATION_APPROACH_DISTANCE_WORDS: 5000,
  /** Pre-generate planned images when the reader is within this many words. */
  VISUAL_PRELOAD_DISTANCE_WORDS: 1000,
  /** |ΔwordPosition| above this = navigation jump, not continuous reading. */
  VISUAL_JUMP_THRESHOLD_WORDS: 2500,
  /** Re-analysis may shift scene anchors slightly; reuse images within this span. */
  VISUAL_POSITION_MATCH_TOLERANCE: 400,
  /** After a jump, only auto-queue scenes within this many words of the landing spot. */
  VISUAL_JUMP_QUEUE_WINDOW_WORDS: 1000,
  /** Reader must advance at least this many words before read-ahead preloads fire. */
  VISUAL_FORWARD_ADVANCE_WORDS: 80,
  /** Minimum word gap between distinct visual anchor positions in the storyboard. */
  VISUAL_MIN_SCENE_SEPARATION_WORDS: 350,
  /** Number of narrative visual moments to keep active ahead of the reader. */
  VISUAL_ACTIVE_BATCH_SIZE: 8,
  /** Promote the next batch when fewer than this many active moments remain ahead. */
  VISUAL_ACTIVE_BATCH_REFILL_THRESHOLD: 3,
  /** Safety cap for how many planned moments can be activated in one background pass. */
  VISUAL_MAX_BATCH_PROMOTIONS: 8,
  /** Jumps/gallery requests prepare only the requested visual slot, never a local batch. */
  VISUAL_SINGLE_SLOT_PROMOTIONS: 1,
  /** Long local/remote image jobs can survive reloads; after this, Lumina allows retry. */
  VISUAL_GENERATION_STALE_MS: 45 * 60 * 1000,

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
  GEMINI_MODEL: "gemini-3-flash-preview",
  GEMINI_IMAGE_MODEL: "gemini-2.5-flash-image",
  GEMINI_TTS_MODEL: "gemini-2.5-flash-preview-tts",
  IMAGEN_MODEL: "imagen-3.0-generate-002",

  // Audio Overview (Gemini summary script → Gemini TTS)
  AUDIO_OVERVIEW_WPM: 140,            // spoken words per minute (calm explanatory pace)
  AUDIO_OVERVIEW_DEFAULT_MIN: 20,
  AUDIO_OVERVIEW_MIN: 5,
  AUDIO_OVERVIEW_MAX: 35,
  AUDIO_OVERVIEW_STEP: 5,
  AUDIO_OVERVIEW_TTS_CHUNK_CHARS: 1800,   // per Gemini TTS request
  AUDIO_OVERVIEW_DEFAULT_VOICE: "Kore",

  // Presentation Studio (Gemini → structured slide deck)
  PRESENTATION_DEFAULT_SLIDES: 16,
  PRESENTATION_MIN_SLIDES: 8,
  PRESENTATION_MAX_SLIDES: 32,
  PRESENTATION_STEP: 2,

  // Storage
  IMAGE_CACHE_DIR: "lumina/cache/images",
  AUDIO_CACHE_DIR: "lumina/cache/audio",
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
