// ─── Book & EPUB Structure ────────────────────────────────────────────────────

export interface Book {
  id: string;
  title: string;
  author: string;
  filePath: string;
  coverImage?: string;
  totalWords: number;
  parserConfidence: "high" | "medium" | "low";
  importedAt: string;
  lastOpened?: string;
}

export interface Chapter {
  id: string;
  index: number;
  title: string;
  wordCount: number;
  href: string;        // real spine item href — use for EPUB.js navigation
  spineIndex: number;  // position in spine — use for CFI-to-chapter mapping
  startCfi: string;    // best-effort CFI (may be empty)
  endCfi: string;
  sections: Section[];
  rawText?: string;
}

export interface Section {
  id: string;
  chapterId: string;
  index: number;
  wordCount: number;
  /** Word offset from the start of the chapter (not a CFI — use for proximity calc). */
  startWordOffset: number;
  rawText?: string;
}

/** Reliable scene location without fake CFIs. */
export interface SceneAnchor {
  href: string;          // spine item href — matches Chapter.href
  spineIndex: number;    // matches Chapter.spineIndex
  wordOffset: number;    // estimated word offset into the spine item
}

export interface BookStructure {
  bookId: string;
  title: string;
  author: string;
  totalWords: number;
  parserConfidence: "high" | "medium" | "low";
  chapters: Chapter[];
}

// ─── Reading Progress ─────────────────────────────────────────────────────────

export interface ReadingProgress {
  bookId: string;
  currentCfi: string;
  currentChapterIndex: number;
  percentComplete: number;
  lastRead: string;
}

// ─── Semantic Analysis ────────────────────────────────────────────────────────

export type ArcShape =
  | "rise"
  | "fall"
  | "fall-rise"
  | "rise-fall"
  | "rise-fall-rise"
  | "fall-rise-fall";

export interface InflectionPoint {
  id: string;
  approximateChapterIndex: number;
  emotionalShift: string;
  significance: number; // 0–1
  narrativeLabel: string;
}

export interface MacroArc {
  arcShape: ArcShape;
  dominantEmotions: string[];
  centralThemes: string[];
  inflectionPoints: InflectionPoint[];
}

export interface IdentifiedScene {
  id: string;
  inflectionPointId: string;
  chapterId: string;
  sectionId: string;
  /** Legacy: kept for DB compat but may be empty. Use anchor instead. */
  anchorCfi: string;
  /** Reliable location: href + spineIndex + wordOffset. */
  anchor: SceneAnchor;
  emotionalVector: string[];
  symbolicMotifs: string[];
  atmosphericQualities: string[];
  narrativeWeight: number; // 0–1
  imageDescription?: string;
}

export interface SemanticMap {
  bookId: string;
  arcShape: ArcShape;
  inflectionPoints: InflectionPoint[];
  scenes: IdentifiedScene[];
  goldenNumber: number;
  analyzedAt: string;
}

// ─── Style Seeds ──────────────────────────────────────────────────────────────

export type StyleSeedId =
  | "dreamlike-watercolor"
  | "dark-ink-shadow"
  | "golden-manuscript"
  | "cold-northern-light"
  | "smoke-ember"
  | "pale-surrealism";

export interface StyleSeed {
  id: StyleSeedId;
  name: string;
  description: string;
  promptFragment: string;
  paletteKeywords: string[];
  previewImage: string; // path to asset
}

// ─── Image Cache ──────────────────────────────────────────────────────────────

export interface CachedImage {
  id: string;
  bookId: string;
  sceneId: string;
  filePath: string;
  descriptionUsed: string;
  styleSeed: StyleSeedId;
  generatedAt: string;
  generationApi: "imagen3" | "flux";
  emotionalThemes: string[];
}

// ─── Annotations ─────────────────────────────────────────────────────────────

export type HighlightColor = "yellow" | "blue" | "green" | "red";

export interface Highlight {
  id: string;
  bookId: string;
  cfiRange: string;
  color: HighlightColor;
  selectedText: string;
  createdAt: string;
}

export interface Note {
  id: string;
  highlightId: string;
  bookId: string;
  noteText: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export type LayoutPreset = "classic" | "focused" | "immersive";
export type Theme = "dark" | "light" | "system";
export type ReadingWidth = "narrow" | "medium" | "wide";

export interface PanelLayout {
  toc: number;
  visual: number;
  reader: number;
}

export interface PanelOrder {
  panels: ("toc" | "visual" | "reader")[];
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface UserSettings {
  theme: Theme;
  fontSize: number;
  lineHeight: number;
  readingWidth: ReadingWidth;
  imageGenerationEnabled: boolean;
  layoutPreset: LayoutPreset;
  panelLayout: PanelLayout;
  panelOrder: PanelOrder;
  hasCompletedOnboarding: boolean;
  apiKeyConfigured: boolean;
}

// ─── Image Generation Queue ───────────────────────────────────────────────────

export type GenerationStatus = "pending" | "generating" | "complete" | "failed";

export interface GenerationQueueItem {
  sceneId: string;
  bookId: string;
  priority: number;
  status: GenerationStatus;
  description: string;
}
