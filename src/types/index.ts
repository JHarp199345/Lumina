// ─── Book & EPUB Structure ────────────────────────────────────────────────────

export type BookImportSource = "file" | "gutenberg";
export type EditionPipeline = "standard" | "gutenberg";

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
  /** Where the book entered Lumina (Open Shelf vs file picker). */
  importSource?: BookImportSource;
  /** Gutendex / Project Gutenberg ebook id when applicable. */
  gutenbergId?: number;
  /** Normalization pipeline used at last parse. */
  editionPipeline?: EditionPipeline;
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

export interface CollectionGroup {
  id: string;
  title: string;
  startChapterIndex: number;
  endChapterIndex: number;
  wordCount: number;
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
  collectionGroups?: CollectionGroup[];
  editionPipeline?: EditionPipeline;
  gutenbergId?: number;
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

// ─── Narrative Threads (setup → payoff structure) ─────────────────────────────
//
// The shared dramatic plan every later stage reads and writes. A thread links
// scenes across the book so an image can build toward, or pay off, an earlier one.

export type ThreadKind =
  | "promise"        // a vow/commitment, later kept or broken
  | "mystery"        // a question/secret, later revealed
  | "object"         // a charged object introduced, later decisive
  | "relationship"   // a bond formed, tested, resolved
  | "transformation" // a character or world becoming something else
  | "conflict"       // a tension established, escalated, decided
  | "motif";         // a recurring image/symbol that accrues meaning

export type ThreadRole = "setup" | "build" | "payoff" | "cost" | "echo";

export interface ThreadNode {
  role: ThreadRole;
  approximateChapterIndex: number;
  description: string;   // what happens at this point in the thread
  visualMotif: string;   // the recurring visual anchor to carry across nodes
}

export interface NarrativeThread {
  id: string;
  label: string;         // human-readable: "Darrow's vow at Eo's grave"
  kind: ThreadKind;
  centralMotif: string;  // the visual element that recurs across this thread
  nodes: ThreadNode[];   // ordered: setup → build → payoff/cost (→ echo)
}

export interface NarrativeBlueprint {
  bookId: string;
  generatedAt: string;
  throughLine: string;        // one-sentence spine of the book's dramatic movement
  threads: NarrativeThread[];
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
  directorBrief?: VisualDirectorBrief;
  /** Narrative thread this scene serves, set by thread-aware selection. */
  threadId?: string;
  threadRole?: ThreadRole;
  /** The recurring visual motif to carry from this thread, for cross-image continuity. */
  threadMotif?: string;
  /** Label of the thread, for prompts and diagnostics. */
  threadLabel?: string;
}

export interface SemanticMap {
  bookId: string;
  visualPlanVersion?: number;
  arcShape: ArcShape;
  inflectionPoints: InflectionPoint[];
  scenes: IdentifiedScene[];
  goldenNumber: number;
  analyzedAt: string;
  storyboard?: VisualStoryboard;
  visualLore?: VisualLoreDossier;
  narrativeBlueprint?: NarrativeBlueprint;
}

// ─── Visual Lore Grounding ──────────────────────────────────────────────────

export interface VisualLoreEntity {
  name: string;
  category: "character" | "species" | "faction" | "place" | "object" | "concept" | "unknown";
  confidence: number;
  aliases: string[];
  canonicalTraits: string[];
  silhouette: string;
  materials: string[];
  colors: string[];
  motifs: string[];
  sceneUse: string;
  avoidCopying: string[];
  sourceTitles: string[];
  sourceUrls: string[];
}

export interface VisualLoreDossier {
  bookId: string;
  generatedAt: string;
  universeHint: string;
  searchQueries: string[];
  entities: VisualLoreEntity[];
  globalStyleNotes: string[];
  safetyRules: string[];
}

export type AnalysisProgressPhase =
  | "preparing"
  | "scoring"
  | "mapping"
  | "scenes"
  | "prompts"
  | "opening-image"
  | "queueing"
  | "complete"
  | "error";

export interface AnalysisProgressDetail {
  phase: AnalysisProgressPhase;
  message: string;
  percent: number;
  current?: number;
  total?: number;
  itemLabel?: string;
}

export type AnalysisProgressUpdate = string | AnalysisProgressDetail;

export type AnalysisProgressReporter = (progress: AnalysisProgressUpdate) => void;

// ─── Visual Storyboard ───────────────────────────────────────────────────────

export type VisualBeatType =
  | "opening"
  | "setup"
  | "mystery_seed"
  | "suspense_build"
  | "promise"
  | "reversal"
  | "approach"
  | "payoff"
  | "cost"
  | "aftermath"
  | "closing";

export interface VisualBeat {
  id: string;
  sceneId: string;
  beatIndex: number;
  beatType: VisualBeatType;
  origin: "arc" | "reader_selection";
  generationIntent: "default" | "planned_only" | "reader_requested";
  arcPosition: number;
  readerTriggerWord: number;
  emotionalPurpose: string;
  /** Thread id this beat belongs to (real linkage from the narrative blueprint). */
  setupPayoffThread?: string;
  /** This beat's role within its thread. */
  threadRole?: ThreadRole;
  /** The recurring visual motif this thread carries. */
  threadMotif?: string;
  pacingNote: string;
  visualDensity: "quiet" | "moderate" | "high";
}

export interface VisualStoryboard {
  bookId: string;
  arcShape: ArcShape;
  visualBeatCount: number;
  generatedAt: string;
  densityTarget: "sparse" | "balanced" | "rich";
  pathwaySummary: string;
  beats: VisualBeat[];
}

// ─── Visual Director ─────────────────────────────────────────────────────────

export type MomentFunction =
  | "threshold"
  | "transformation"
  | "loss_of_innocence"
  | "promise_made"
  | "promise_delivered"
  | "promise_broken"
  | "betrayal"
  | "collision"
  | "sacrifice"
  | "cost_of_triumph"
  | "revelation"
  | "recognition"
  | "moral_choice"
  | "dread"
  | "temptation"
  | "grief"
  | "isolation"
  | "gathering"
  | "aftermath"
  | "return"
  | "suspense"
  | "opening_world";

export type VisualStrategy =
  | "literal_iconic"
  | "ritualized_action"
  | "symbolic_abstraction"
  | "object_centered"
  | "threshold_composition"
  | "emotional_landscape"
  | "environmental_pressure"
  | "aftermath_tableau"
  | "anticipation_frame"
  | "scale_contrast"
  | "character_silhouette"
  | "negative_space"
  | "rare_aerial";

export type VisualPerspective =
  | "intimate_close"
  | "medium_human_scale"
  | "wide_establishing"
  | "solitary_figure_against_scale"
  | "low_angle"
  | "high_angle"
  | "rare_aerial"
  | "object_perspective"
  | "over_the_shoulder"
  | "silhouette_from_behind"
  | "environment_first"
  | "negative_space_dominant";

export type SubjectFocus =
  | "person"
  | "object"
  | "place"
  | "crowd_or_mass"
  | "threshold"
  | "natural_force"
  | "symbolic_motif"
  | "aftermath"
  | "absence";

export type MotionLevel =
  | "completely_still"
  | "potential_energy"
  | "slow_movement"
  | "purposeful_motion"
  | "rushing"
  | "violent_collision"
  | "settling_aftermath"
  | "exhausted_stillness";

export type CameraDistance =
  | "extreme_close"
  | "close"
  | "medium"
  | "medium_wide"
  | "wide"
  | "extreme_wide";

export type SceneElementRole =
  | "primary_subject"
  | "secondary_subject"
  | "threat"
  | "ally"
  | "opposing_force"
  | "contested_object"
  | "environment"
  | "symbolic_accent"
  | "motion_group";

export interface SceneElement {
  id: string;
  label: string;
  role: SceneElementRole;
  depiction: string;
  placement: string;
  scale: string;
  motion: string;
  visualPriority: number;
}

export interface SceneRelationship {
  from: string;
  to: string;
  relation: string;
}

export interface SceneBlockingMap {
  stagingSummary: string;
  focalPoint: string;
  elements: SceneElement[];
  relationships: SceneRelationship[];
  cameraLogic: string;
}

export interface VisualDirectorBrief {
  sceneId: string;
  bookId: string;
  generatedAt: string;
  interpretationLevel: number;
  momentFunction: MomentFunction;
  visualStrategy: VisualStrategy;
  perspective: VisualPerspective;
  cameraDistance: CameraDistance;
  subjectFocus: SubjectFocus;
  motionLevel: MotionLevel;
  emotionalTone: string[];
  dominantEmotion: string;
  symbolicAnchors: string[];
  concreteAnchors: string[];
  blocking: SceneBlockingMap;
  loreEntityNames: string[];
  loreDescriptorsUsed: string[];
  loreSourceUrlsUsed: string[];
  chapterContextWords: string[];
  composition: string;
  palette: string[];
  lighting: string;
  texture: string;
  restraintRules: string[];
  avoidExplicitly: string[];
  diversityNotes: string;
  finalPrompt: string;
  negativePrompt: string;
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
  /** Absolute word position (0…N) in the book — stable across re-analysis. */
  wordPosition?: number;
  /** EPUB file slot — at most one cached image per slot. */
  visualSlotKey?: string;
  filePath: string;
  descriptionUsed: string;
  styleSeed: StyleSeedId;
  generatedAt: string;
  generationApi: "imagen3" | "gemini-image" | "flux";
  emotionalThemes: string[];
}

// ─── Annotations ─────────────────────────────────────────────────────────────

export type HighlightColor = string;

export type LensCornerStyle = "sharp" | "soft" | "round";
export type LensTexture = "clean" | "glass" | "marker" | "neon";
export type LensEdgeStyle = "none" | "border" | "underline" | "left";
export type LensTextEmphasis = "normal" | "bold" | "bright" | "lift";

export interface HighlightLens {
  id: HighlightColor;
  name: string;
  color: string;
  opacity: number; // 0-100
  textColorEnabled: boolean;
  textColor: string;
  cornerStyle: LensCornerStyle;
  glow: number; // 0-100
  edgeStyle: LensEdgeStyle;
  texture: LensTexture;
  textEmphasis: LensTextEmphasis;
}

export interface Highlight {
  id: string;
  bookId: string;
  cfiRange: string;          // EPUB.js path. Empty for the structured web reader.
  color: HighlightColor;
  selectedText: string;
  createdAt: string;
  // Structured (web) reader anchor — character-offset position anchor into a page.
  locator?: string;          // lumina://chapter/{ch}/page/{pg}
  startOffset?: number;      // char offset into the page's textContent
  endOffset?: number;
  // Stable structured-reader anchor. Unlike page offsets, these survive
  // re-pagination between browser/PWA/device builds.
  chapterIndex?: number;
  chapterStartOffset?: number;
  chapterEndOffset?: number;
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
  visualInterpretationLevel: number;
}

// ─── Image Generation Queue ───────────────────────────────────────────────────

export type GenerationStatus = "pending" | "generating" | "complete" | "failed";

export interface GenerationQueueItem {
  sceneId: string;
  bookId: string;
  wordPosition?: number;
  /** EPUB section key (spine + href) — one generation per slot. */
  visualSlotKey?: string;
  priority: number;
  status: GenerationStatus;
  description: string;
}

// ─── Study Guide (PLANv) ──────────────────────────────────────────────────────

/**
 * A Study Guide divides a book into meaning-based study segments — natural
 * stopping points a reader can review or be quizzed on. The artifact is
 * book-scoped: opening a book mounts its guide, switching books dismounts it.
 *
 * Phase 2 produces these heuristically (offline, no AI). Phase 3 refines them
 * with AI (better names, summaries, quiz-worthiness). The shape is the same so
 * refinement is an in-place upgrade, not a new model.
 */
export type StudySegmentStatus =
  | "ready"          // segment exists, no quiz yet
  | "quiz-generated" // a quiz has been built for it
  | "passed"         // reader passed its quiz
  | "review"         // reader should review (missed questions)
  | "locked";        // reader hasn't reached this segment yet

export type StudySpoilerLevel = "none" | "low" | "high";

export interface StudySegment {
  id: string;
  bookId: string;
  chapterIndex: number;
  chapterTitle: string;
  title: string;

  /** Stable anchors — chapter index + word offsets, not page numbers. */
  startWordOffset: number; // word offset within the chapter
  endWordOffset: number;   // word offset within the chapter (exclusive)
  approxWordStart: number; // global word offset into the whole book
  approxWordEnd: number;
  wordCount: number;

  summary?: string;
  purpose?: string;
  quizWorthy: boolean;
  spoilerLevel: StudySpoilerLevel;
  concepts?: string[];
  characters?: string[];
  locations?: string[];
  themes?: string[];

  status: StudySegmentStatus;
}

export type StudyGuideSource = "heuristic" | "ai-refined";

export interface StudyGuide {
  bookId: string;
  generatedAt: string;
  version: number;
  source: StudyGuideSource;
  segments: StudySegment[];
}

export type StudyQuizScope = "segment" | "chapter" | "book";
export type StudyQuestionLevel = "recall" | "relationship" | "interpretation" | "synthesis";

export interface StudyQuizQuestion {
  id: string;
  questionNumber: number;
  chainTitle?: string;
  level: StudyQuestionLevel;
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  purpose?: string;
}

export interface StudyQuiz {
  id: string;
  bookId: string;
  scope: StudyQuizScope;
  targetId: string;
  title: string;
  generatedAt: string;
  questionCount: number;
  questions: StudyQuizQuestion[];
}

export interface StudyQuizAttempt {
  id: string;
  quizId: string;
  bookId: string;
  answers: number[];
  score: number;
  passed: boolean;
  completedAt: string;
}

export interface StudyBadgeAward {
  id: string;
  bookId: string;
  quizId: string;
  scope: StudyQuizScope;
  targetId: string;
  label: string;
  score: number;
  awardedAt: string;
}

export type StudyFlashcardType =
  | "term"
  | "character"
  | "event"
  | "concept"
  | "cause-effect"
  | "question";

export interface StudyFlashcard {
  id: string;
  bookId: string;
  segmentIds: string[];
  front: string;
  back: string;
  type: StudyFlashcardType;
  tags: string[];
  createdAt: string;
}

// ─── Voice Studio (PLANVI) ────────────────────────────────────────────────────

export type AudioArtifactStatus = "queued" | "generating" | "ready" | "failed";
export type AudioProvider = "gemini" | "elevenlabs";
export type AudioGenerationMode = "saved" | "streamed";
export type AudioArtifactScope = "segment" | "chapter" | "overview";

// ─── Source Intelligence Profile (Audio Overview, PLANvii) ──────────────────────
// Hidden, teaching-oriented profile of a work, built in the single enriched ingestion
// pass (lazy backfill for older books). Powers Audio Overview ghost-text suggestions
// and the type-aware default prompt.

export type WorkType =
  | "fiction"
  | "nonfiction"
  | "scholarly"
  | "manual"
  | "memoir"
  | "reference"
  | "scripture"
  | "other";

export interface SourceProfileSection {
  id: string;
  title: string;
  importance: number;        // 0–1
  teachingSummary: string;   // what it's about + key developments (not the opening line)
}

export interface SourceProfileRelationship {
  to: string;
  nature: string;
  evolution: string;         // how it changes across the work
}

export interface SourceProfileEntity {
  name: string;
  type: "character" | "person" | "org" | "place" | "concept";
  role: string;
  relationships: SourceProfileRelationship[];
}

export interface SourceProfileSuggestion {
  id: string;
  label: string;             // angle chip label, e.g. "As a story"
  workTypes: WorkType[];     // which work types this angle suits
  planText: string;          // the ghost-text prompt this angle proposes
}

export interface SourceIntelligenceProfile {
  bookId: string;
  builtAt: string;
  workType: WorkType;
  identity: { title: string; author: string; genre?: string; era?: string };
  structureKind: "narrative" | "subjectHierarchy";
  sections: SourceProfileSection[];
  concepts: { mainIdeas: string[]; themes: string[]; keyTerms: string[]; questions: string[] };
  entities: SourceProfileEntity[];
  progression: string[];     // plot movements OR argument/evidence flow
  suggestionBank: SourceProfileSuggestion[];
}

export interface AudioVoicePreset {
  id: string;
  displayName: string;
  description: string;
  providerVoiceName: string;
  provider?: AudioProvider;
  category?: string;
  labels?: Record<string, string>;
  previewUrl?: string;
}

export interface AudioStylePreset {
  id: string;
  displayName: string;
  direction: string;
}

export interface AudioArtifact {
  id: string;
  bookId: string;
  segmentId: string;
  chapterIndex: number;
  segmentTitle: string;
  voiceId: string;
  provider?: AudioProvider;
  scope?: AudioArtifactScope;
  voiceProviderId?: string;
  modelId?: string;
  mode?: AudioGenerationMode;
  stylePresetId: string;
  textHash: string;
  promptHash: string;
  textStartPosition?: number;
  textEndPosition?: number;
  alignment?: AudioAlignmentSpan[];
  durationSeconds?: number;
  mimeType: string;
  filePath: string;
  generatedAt: string;
  generationApi: string;
  status: AudioArtifactStatus;
  error?: string;
  // Audio Overview (Gemini summary → Gemini TTS) — present when scope === "overview".
  overviewMinutes?: number;   // requested target length
  overviewPrompt?: string;    // reader's prompt, or "" when the default was used
  overviewScript?: string;    // the generated summary script that was voiced (transcript)
}

// ─── Presentation Studio ──────────────────────────────────────────────────────

export type PresentationTemplateId = "teach" | "pitch" | "chapter-walkthrough" | "themes-deep";

export type PresentationSlideLayout = "title" | "section" | "content" | "quote" | "summary";

export interface PresentationTemplate {
  id: PresentationTemplateId;
  label: string;
  description: string;
  /** Fixed project-brief instructions sent with every generation for this template. */
  brief: string;
}

export interface PresentationSlide {
  index: number;
  layout: PresentationSlideLayout;
  title: string;
  bullets: string[];
  speakerNotes: string;
  visualHint?: string;
}

export interface PresentationDeck {
  id: string;
  bookId: string;
  title: string;
  scopeLabel: string;
  templateId: PresentationTemplateId;
  projectBrief: string;
  userPrompt: string;
  slideCount: number;
  slides: PresentationSlide[];
  generatedAt: string;
}

export interface AudioAlignmentSpan {
  startMs: number;
  endMs: number;
  text: string;
  charStart: number;
  charEnd: number;
  wordStart: number;
  wordEnd: number;
  absoluteWordStart: number;
  absoluteWordEnd: number;
}
