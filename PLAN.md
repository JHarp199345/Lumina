# LUMINA — Full Build Plan
# Symbolic EPUB Reader with AI-Generated Atmospheric Imagery
# Version 0.1 — MVP

---

## TABLE OF CONTENTS

1. Product Philosophy
2. Core Design Principles
3. Technical Stack
4. Application Architecture
5. File & Folder Structure
6. Three-Panel UI System
7. EPUB Import & Adaptive Parsing
8. Semantic Analysis Pipeline
9. Story Shape Algorithm
10. Golden Number Calculation
11. Image Description Generation
12. Style Seed System
13. Image Generation Pipeline
14. Read-Ahead Buffering & Trigger System
15. Local Caching Strategy
16. BYOK Implementation
17. Reader Features (Highlighting, Notes)
18. Style Seed Picker UI
19. Settings & Preferences
20. Implementation Order
21. MVP Boundaries
22. Future Versions (Do Not Build Yet)

---

## 1. PRODUCT PHILOSOPHY

Lumina is a text-first EPUB reader that augments reading with sparse, symbolically generated imagery. The visuals are not illustrations. They are emotional anchors — closer to dream imagery, watercolor atmosphere, illuminated manuscript motifs, and symbolic painting than to literal scene depiction.

The product succeeds if:
- Reading feels enhanced and atmospheric
- Visuals feel meaningful and earned
- Imagination remains active and engaged
- The experience remains calm and uncluttered

The product fails if:
- Visuals become noisy or constant
- Generation interrupts the reading flow
- The system feels like an AI toy rather than a reading tool
- The reader's imagination is replaced rather than guided

The images should convey emotional truth, not visual fact.

---

## 2. CORE DESIGN PRINCIPLES

- Text is always primary. The reading panel is the center of experience.
- Images are sparse. Never generated continuously. Never one per page.
- Visuals are symbolic. Dream imagery. Watercolor. Motif. Atmosphere.
- The system is invisible. The reader should feel wonder, not mechanism.
- No local AI infrastructure. No GPU management. No model hosting.
- External APIs only. Gemini Flash for analysis. Imagen 3 for generation.
- One API key. Google AI Studio key covers both Gemini and Imagen 3.
- BYOK. The reader supplies their own Google AI Studio API key.
- No accounts. No social features. No cloud sync. No servers.
- Offline-capable after initial generation. Images cached locally.
- The reader's imagination is always a participant, never a passenger.

---

## 3. TECHNICAL STACK

### Frontend
- **Tauri** — native desktop shell (Mac primary, Windows/Linux via Tauri cross-compile)
- **React** — UI framework
- **TypeScript** — type safety throughout
- **EPUB.js** — EPUB rendering and location tracking
- **react-resizable-panels** — draggable, resizable panel system
- **Tailwind CSS** — styling
- **Framer Motion** — transitions, image fade-ins, panel animations

### Backend (Tauri Rust layer)
- File system access (EPUB import, image cache read/write)
- Local SQLite database via `tauri-plugin-sql` (book metadata, annotations, notes, highlights, reading progress, image cache index)
- Secure API key storage via `tauri-plugin-store` (encrypted local store)

### External APIs
- **Gemini Flash** (Google AI Studio) — semantic analysis, emotional arc detection, image description generation
- **Imagen 3** (Google AI Studio, same key) — image generation from symbolic descriptions
- **Fallback**: Flux via fal.ai if Imagen 3 is unavailable on user's key

### EPUB Parsing
- **epub.js** for rendering
- **jszip** for raw EPUB extraction and manifest inspection
- Custom adaptive parser for chapter/section detection (see Section 7)

---

## 4. APPLICATION ARCHITECTURE

```
Lumina/
├── Tauri Shell (Rust)
│   ├── File system bridge
│   ├── Secure store (API keys)
│   ├── SQLite bridge (metadata, annotations, cache index)
│   └── System tray / window management
│
├── React Frontend
│   ├── Three-panel layout system
│   ├── EPUB renderer (EPUB.js)
│   ├── Visual panel (image display, style seed UI)
│   ├── TOC panel (navigation)
│   └── Reader features (highlighting, notes)
│
├── Semantic Pipeline (runs at book import)
│   ├── EPUB adaptive parser
│   ├── Text chunking and section mapping
│   ├── Gemini Flash — emotional arc analysis
│   ├── Story shape fitting
│   ├── Golden number calculation
│   ├── Scene identification (key inflection moments)
│   └── Image description generation per scene
│
├── Image Generation System
│   ├── Read-ahead trigger (tracks reader position)
│   ├── Queue manager (generates ahead, not all at once)
│   ├── Imagen 3 API calls (with style seed + prior style context)
│   └── Local cache writer
│
└── Local Cache
    ├── Generated images (keyed by book ID + scene ID)
    ├── Image descriptions (stored, reusable)
    ├── Semantic map (stored, no reanalysis needed)
    └── SQLite: books, progress, highlights, notes, settings
```

---

## 5. FILE & FOLDER STRUCTURE

```
lumina/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/
│   │   │   ├── epub.rs          (EPUB import, extraction)
│   │   │   ├── cache.rs         (image cache read/write)
│   │   │   ├── database.rs      (SQLite operations)
│   │   │   └── keys.rs          (secure API key storage)
│   │   └── lib.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── PanelContainer.tsx      (three-panel root)
│   │   │   ├── TocPanel.tsx            (left panel)
│   │   │   ├── VisualPanel.tsx         (center panel)
│   │   │   └── ReaderPanel.tsx         (right panel)
│   │   │
│   │   ├── reader/
│   │   │   ├── EpubRenderer.tsx        (EPUB.js wrapper)
│   │   │   ├── HighlightLayer.tsx      (text selection + highlighting)
│   │   │   └── NotesSidebar.tsx        (annotations)
│   │   │
│   │   ├── visual/
│   │   │   ├── ImageDisplay.tsx        (current symbolic image)
│   │   │   ├── ThemeDisplay.tsx        (emotional themes shown below image)
│   │   │   ├── SeedPicker.tsx          (style seed selection UI)
│   │   │   └── RegenerateButton.tsx    (right-click/double-click surface)
│   │   │
│   │   ├── toc/
│   │   │   ├── TableOfContents.tsx
│   │   │   ├── ChapterItem.tsx
│   │   │   └── SearchBar.tsx
│   │   │
│   │   └── common/
│   │       ├── Modal.tsx
│   │       ├── Tooltip.tsx
│   │       └── LoadingState.tsx
│   │
│   ├── pipeline/
│   │   ├── epubParser.ts           (adaptive EPUB parsing)
│   │   ├── textChunker.ts          (section chunking strategy)
│   │   ├── semanticAnalyzer.ts     (Gemini Flash calls for arc analysis)
│   │   ├── storyShape.ts           (arc shape fitting algorithm)
│   │   ├── goldenNumber.ts         (calculate optimal image count)
│   │   ├── sceneIdentifier.ts      (find inflection point scenes)
│   │   ├── descriptionGenerator.ts (Gemini Flash: text → symbolic description)
│   │   └── imageGenerator.ts       (Imagen 3 / Flux API calls)
│   │
│   ├── store/
│   │   ├── bookStore.ts            (current book state)
│   │   ├── readerStore.ts          (position, progress)
│   │   ├── imageStore.ts           (image cache state, queue)
│   │   ├── settingsStore.ts        (preferences, API key ref)
│   │   └── annotationStore.ts      (highlights, notes)
│   │
│   ├── hooks/
│   │   ├── useReadPosition.ts      (track reader location)
│   │   ├── useImageTrigger.ts      (detect section approach, fire generation)
│   │   ├── useEpubNavigation.ts    (chapter/section nav)
│   │   └── useAnnotations.ts       (highlight/note management)
│   │
│   ├── utils/
│   │   ├── epubUtils.ts
│   │   ├── cacheUtils.ts
│   │   ├── textUtils.ts
│   │   └── styleUtils.ts
│   │
│   └── styles/
│       ├── globals.css
│       └── reader.css
│
├── public/
│   └── assets/
│       └── seed-previews/          (preset style seed preview images)
│
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── vite.config.ts
└── PLAN.md                         (this file)
```

---

## 6. THREE-PANEL UI SYSTEM

### Layout

```
┌──────────────┬──────────────────────┬──────────────────────┐
│   TOC PANEL  │   VISUAL PANEL       │   READER PANEL       │
│              │                      │                      │
│  Contents    │  [Symbolic Image]    │  Chapter Title       │
│  ──────────  │                      │                      │
│  Chapter 1   │                      │  Reading text here.  │
│  Chapter 2 ◀ │  Themes:             │  Reading text here.  │
│  Chapter 3   │  Isolation · Grief   │  Reading text here.  │
│  Chapter 4   │                      │                      │
│  Chapter 5   │                      │  Page X of Y         │
└──────────────┴──────────────────────┴──────────────────────┘
```

### Panel Behaviors
- All panels are resizable by dragging dividers
- All panels are collapsible (click to collapse, icon remains)
- Panels are reorderable (drag panel headers to swap positions)
- Layout preferences are saved per-book and globally
- Default layout: TOC (20%) | Visual (35%) | Reader (45%)
- Minimum panel width enforced so content never breaks

### Layout Presets
- **Classic**: TOC | Visual | Reader (default)
- **Focused Reading**: TOC (collapsed) | Reader | Visual (narrow)
- **Immersive**: TOC (collapsed) | Visual (full) | Reader

### Panel Persistence
- Current panel layout saved to SQLite per book
- Global default layout saved to settings

---

## 7. EPUB IMPORT & ADAPTIVE PARSING

### Import Flow
1. User selects EPUB file via Tauri file dialog
2. Tauri Rust layer copies file to app data directory
3. JSZip extracts EPUB contents in memory
4. Adaptive parser runs chapter/section detection
5. Semantic pipeline begins (async, non-blocking)
6. Reader opens immediately — user can begin reading while analysis runs

### Adaptive Parser — Fallback Chain

The parser never fails. It works through a priority chain:

**Level 1 — NCX / OPF Manifest (most reliable)**
- Read `toc.ncx` or `nav.xhtml` for explicit chapter structure
- Use spine order from `content.opf`
- Confidence: HIGH

**Level 2 — Heading Tag Detection**
- If Level 1 yields nothing useful, scan HTML for H1, H2 tags
- Group content by heading hierarchy
- Confidence: MEDIUM

**Level 3 — Scene Break Pattern Detection**
- Scan for common scene break markers: `* * *`, `---`, `***`, blank line clusters
- Use these as section boundaries within chapters
- Confidence: MEDIUM-LOW

**Level 4 — Word Count Chunking**
- If all else fails, divide text into equal chunks by word count
- Target ~3000-5000 words per chunk
- Flag as LOW confidence in metadata
- Confidence: LOW (but functional)

**Parser Output**
Regardless of which level succeeded, the parser always outputs:
```typescript
interface BookStructure {
  bookId: string
  title: string
  author: string
  totalWords: number
  parserConfidence: 'high' | 'medium' | 'low'
  chapters: Chapter[]
}

interface Chapter {
  id: string
  index: number
  title: string
  wordCount: number
  startCfi: string       // EPUB.js CFI location
  endCfi: string
  sections: Section[]
  rawText: string        // for analysis only, never sent to image API
}

interface Section {
  id: string
  chapterId: string
  index: number
  wordCount: number
  startCfi: string
  endCfi: string
  rawText: string
}
```

---

## 8. SEMANTIC ANALYSIS PIPELINE

This runs once at book import. Results are stored in SQLite. Never re-runs unless the user explicitly requests re-analysis.

### What Gets Sent to Gemini Flash
- NOT the full book verbatim
- Condensed section summaries (key sentences, not full paragraphs)
- Approximately 200-400 tokens per chapter for the initial arc pass
- Full section text only for the targeted scene identification pass on identified inflection zones

### Pass 1 — Macro Arc Analysis
Send a condensed representation of the full book to Gemini Flash.

**Prompt intent**: Identify the overall emotional arc shape, major turning points, the emotional trajectory, and approximate location of each inflection.

**Output**:
```typescript
interface MacroArc {
  arcShape: 'rise' | 'fall' | 'fall-rise' | 'rise-fall' | 'rise-fall-rise' | 'fall-rise-fall'
  dominantEmotions: string[]
  centralThemes: string[]
  inflectionPoints: InflectionPoint[]
}

interface InflectionPoint {
  approximateChapterIndex: number
  emotionalShift: string        // e.g. "grief transitions to resolve"
  significance: number          // 0-1 score
  narrativeLabel: string        // e.g. "point of no return", "false victory", "collapse"
}
```

### Pass 2 — Scene Identification (targeted)
For each inflection point identified in Pass 1, zoom in on that chapter/section.

Send the relevant section text to Gemini Flash.

**Prompt intent**: Identify the specific moment (scene, event, image, line) that best represents this emotional inflection. Extract its symbolic and emotional essence. Do NOT describe it literally.

**Output**:
```typescript
interface IdentifiedScene {
  inflectionPointId: string
  chapterId: string
  sectionId: string
  anchorCfi: string             // approximate reader location
  emotionalVector: string[]     // e.g. ["grief", "hollow victory", "exhaustion"]
  symbolicMotifs: string[]      // e.g. ["fractured crown", "empty throne", "cold gold"]
  atmosphericQualities: string[] // e.g. ["silence", "weight", "stillness"]
  narrativeWeight: number        // 0-1
}
```

### Pass 3 — Image Description Generation
For each identified scene, generate a visual synthesis prompt.

This prompt goes to Imagen 3. It is intentionally symbolic, not literal.

**Prompt structure sent to Gemini Flash**:
```
Given the following emotional and symbolic context from a literary passage:

Emotional vector: [grief, hollow victory, exhaustion]
Symbolic motifs: [fractured crown, empty throne, cold gold]
Atmospheric qualities: [silence, weight, stillness]
Style: [watercolor, dreamlike, symbolic, non-literal, painterly]
Palette guidance: [cold golds, deep grays, muted blues]

Generate a visual image description for an AI image generator.
The description should:
- Be entirely symbolic and atmospheric
- Avoid depicting specific named characters or literal scenes
- Focus on emotional composition and symbolic objects
- Feel like a painting or illuminated manuscript, not a photograph
- Be 2-4 sentences
```

**Output**: A refined image generation prompt stored per scene.

---

## 9. STORY SHAPE ALGORITHM

Based on Kurt Vonnegut's narrative arc theory, validated computationally by University of Vermont research (2016) identifying 6 fundamental emotional arc types across literature.

### The Six Arc Types
1. **Rise** — Rags to riches. Continuous upward emotional trajectory.
2. **Fall** — Tragedy. Continuous downward trajectory.
3. **Fall → Rise** — Man in Hole. Descent then recovery.
4. **Rise → Fall** — Icarus. Ascent then collapse.
5. **Rise → Fall → Rise** — Cinderella. Gain, loss, redemption.
6. **Fall → Rise → Fall** — Oedipus. Brief hope within tragedy.

### Implementation

**Step 1 — Sentiment scoring per section**
- Use Gemini Flash to score each section's emotional valence: -1.0 (pure despair) to +1.0 (pure joy)
- Secondary axes: tension (0-1), ambiguity (0-1)

**Step 2 — Smooth the curve**
- Apply a rolling average across section scores to produce a smooth arc curve
- This removes noise from individual scenes

**Step 3 — Fit to arc type**
- Compare smoothed curve to the 6 canonical shapes
- Identify best-fit arc type
- This informs the overall emotional frame of the book

**Step 4 — Locate inflection points**
- Mathematically identify where the curve changes direction (peaks and valleys)
- These are candidate image moments
- Weight them by magnitude of change (sharper turn = more significant)

**Step 5 — Confirm with narrative context**
- Cross-reference inflection points with chapter/section boundaries
- Prefer moments that align with structural breaks
- Discard inflections that fall in the middle of scenes with no narrative anchor

---

## 10. GOLDEN NUMBER CALCULATION

The golden number is the ideal number of images for a given book. Not too few (loses impact), not too many (becomes noise).

### Formula

```
Base count = number of confirmed inflection points (from story shape algorithm)

Adjustments:
- If book < 50,000 words: cap at 5 images
- If book 50,000–150,000 words: cap at 8 images
- If book > 150,000 words: cap at 12 images
- Minimum: 2 images (one for opening atmosphere, one for climax)
- If inflection points < minimum: interpolate atmospheric images at act boundaries
```

### Distribution Strategy
- **Image 0**: Opening atmosphere — generated on book import, shown when reader opens the book. Sets the visual tone.
- **Image N**: Each confirmed inflection point scene, in reading order.
- **Spacing**: No two images within the same chapter unless the chapter is exceptionally long (>8,000 words) and contains a verified inflection.

### User Adjustment (future v0.2)
- Allow reader to set image density preference: Minimal / Balanced / Rich
- This multiplies or divides the golden number result

---

## 11. IMAGE DESCRIPTION GENERATION

Already detailed in Section 8 Pass 3. Additional notes:

### Style Injection
Every image description gets the reader's chosen style seed appended before being sent to Imagen 3.

Style seed contributes:
- Palette directives
- Texture and medium descriptors
- Atmospheric quality modifiers
- Brush/rendering style language

### Prior Image Context (style continuity)
For images 2 through N, the description also includes:
- A brief description of the style established in image 1
- Key palette words from prior generations
- A directive to maintain visual continuity

This ensures all images for a book feel like they came from the same artistic hand.

### What Is Never Included
- Character names
- Specific place names from the book
- Plot-literal descriptions
- Photorealistic directives
- Exact scene geometry

---

## 12. STYLE SEED SYSTEM

### Concept
At the beginning of a new book, before reading begins, the reader selects a visual style seed. This seed anchors the aesthetic for every image generated for that book.

The seed is a curated preset with a name, a description, and visual language that feeds into every image generation prompt.

### Preset Seeds (MVP)

| Seed Name | Visual Language |
|---|---|
| **Dreamlike Watercolor** | soft watercolor washes, bleeding edges, muted luminance, impressionistic, ethereal |
| **Dark Ink & Shadow** | high contrast ink illustration, deep blacks, fine linework, woodcut texture, dramatic shadow |
| **Golden Manuscript** | illuminated manuscript style, gold leaf accents, ornate borders, warm amber tones, medieval |
| **Cold Northern Light** | pale blues, silvers, winter atmosphere, Scandinavian minimalism, spare composition |
| **Smoke & Ember** | warm orange and deep brown, ash and fire, chiaroscuro, moody, baroque influence |
| **Pale Surrealism** | desaturated surrealist composition, dreamlike scale distortion, soft diffused light |

### Seed Picker UI
- Displayed as a full-screen modal when a new book is first opened
- Each seed shown with a preview image (pre-generated, stored in app assets)
- Reader selects one, clicks Begin Reading
- Selection stored in SQLite per book — never changes unless reader explicitly resets
- Accessible again via settings if reader wants to regenerate all images with a new seed (treated as full re-generation)

### Seed Storage
```typescript
interface BookSettings {
  bookId: string
  styleSeed: StyleSeedId
  seedName: string
  seedPromptFragment: string    // the actual text injected into every image description
  seedPaletteKeywords: string[]
}
```

---

## 13. IMAGE GENERATION PIPELINE

### Primary: Imagen 3 via Google AI Studio
- Same API key as Gemini Flash
- Called with the symbolic image description + style seed fragment
- Returns image as base64 or URL
- Saved to local cache immediately

### Fallback: Flux via fal.ai
- Activated if Imagen 3 returns unavailable error on user's key
- User prompted once to add fal.ai key
- Same description and style injection logic applies

### Request Structure
```typescript
interface ImageGenRequest {
  sceneId: string
  prompt: string               // symbolic description + style seed
  aspectRatio: '16:9'          // for the visual panel
  style: 'artistic'
  negativePrompt: string       // "photorealistic, photograph, literal, text, words, people"
}
```

### Negative Prompt (always included)
`photorealistic, photograph, literal scene depiction, comic book, anime, cartoon, text, words, letters, people with faces, crowd, modern objects`

### On Failure
- If generation fails: visual panel shows a tasteful ambient color field in the book's dominant emotional palette
- No error message shown to reader — the experience degrades silently and gracefully
- Failure logged internally

---

## 14. READ-AHEAD BUFFERING & TRIGGER SYSTEM

### Core Principle
Images are never generated on-demand as the reader reaches a moment. They are generated ahead of time, silently, as the reader approaches.

### Trigger Logic

**Step 1 — Position tracking**
- EPUB.js exposes current CFI location
- `useReadPosition` hook polls this on scroll/page-turn
- Current position mapped to section/chapter index in the book structure

**Step 2 — Proximity detection**
- For each upcoming image scene, calculate distance in words from current position
- Distance thresholds:
  - **Far** (>5000 words away): do nothing
  - **Approaching** (2000-5000 words away): begin generation if not cached
  - **Near** (<2000 words away): generation should already be complete

**Step 3 — Queue management**
- Maximum 1 generation in flight at a time (prevents API hammering and cost spikes)
- Queue processes in reading order
- If reader jumps forward (chapter skip), queue re-prioritizes

**Step 4 — Image display**
- When reader crosses the anchor CFI for a scene, the visual panel transitions to the cached image
- Transition: slow crossfade (1.5s) — never a hard cut
- If image is not yet cached (rare): visual panel holds current image or ambient state, queues urgently

**Step 5 — First image (Opening Atmosphere)**
- Generated at book import time, not on approach
- Should be ready before reader opens the book
- Shown as soon as the reader opens the first page

### Generation Timing (simplified)
```
Book imported
    → Opening image generated immediately (background)
    → Full semantic analysis runs (background)
    → Image descriptions generated for all scenes (background)
    → Images generated in reading order, 2000+ words ahead of reader
    → Each image cached locally
    → Reader never waits
```

---

## 15. LOCAL CACHING STRATEGY

### Image Cache
Location: `{app_data_dir}/lumina/cache/images/{bookId}/{sceneId}.png`

### Cache Index (SQLite)
```sql
CREATE TABLE image_cache (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  description_used TEXT,
  style_seed TEXT,
  generated_at DATETIME,
  generation_api TEXT         -- 'imagen3' or 'flux'
);
```

### Semantic Map Cache (SQLite)
```sql
CREATE TABLE semantic_maps (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  arc_shape TEXT,
  inflection_points JSON,
  scenes JSON,
  image_descriptions JSON,
  golden_number INTEGER,
  analyzed_at DATETIME
);
```

### Cache Invalidation
- Cache never automatically invalidates
- User can manually "Regenerate All Images" from book settings (clears image cache for that book, re-runs image generation only — not re-analysis)
- Re-analysis only triggered by explicit user action ("Re-analyze Book")

### Book Metadata (SQLite)
```sql
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  title TEXT,
  author TEXT,
  file_path TEXT,
  cover_image BLOB,
  total_words INTEGER,
  parser_confidence TEXT,
  imported_at DATETIME,
  last_opened DATETIME
);

CREATE TABLE reading_progress (
  book_id TEXT PRIMARY KEY,
  current_cfi TEXT,
  current_chapter INTEGER,
  percent_complete REAL,
  last_read DATETIME
);
```

---

## 16. BYOK IMPLEMENTATION

### User Flow
1. First launch: Lumina shows a welcome screen
2. User prompted to enter Google AI Studio API key
3. Key stored via `tauri-plugin-store` in encrypted local store
4. Key never logged, never sent anywhere except directly to Google AI APIs
5. If key invalid: clear error message with link to Google AI Studio

### Key Storage
- Stored in OS keychain via Tauri secure store
- Never in plain text, never in SQLite
- Accessible only to the Lumina process

### BYOK UI
- Settings panel includes API key management
- Shows: "Google AI Studio Key: ••••••••••••••••[last 4]"
- Edit / Remove options
- Optional: fal.ai key field (only shown if Imagen 3 unavailable)

### API Call Routing
- All API calls made from the React frontend via fetch (not Tauri backend)
- API key retrieved from secure store via Tauri command, used in memory only
- Never persisted in frontend state beyond the immediate call

---

## 17. READER FEATURES

### Highlighting
- User selects text in the reader panel
- Context menu appears: highlight color options (yellow, blue, green, red)
- Highlight stored in SQLite with CFI range and color
- Highlights rendered persistently on re-open
- Highlights visible in TOC panel as markers on chapter items

```sql
CREATE TABLE highlights (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  cfi_range TEXT NOT NULL,
  color TEXT NOT NULL,
  selected_text TEXT,
  created_at DATETIME
);
```

### Notes / Annotations
- Right-click on highlighted text → "Add Note"
- Small note modal opens beside the selection
- Note text stored in SQLite linked to highlight
- Notes accessible via TOC panel (note count shown per chapter)
- Notes panel: scrollable list of all notes with chapter context and selected text excerpt

```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  highlight_id TEXT REFERENCES highlights(id),
  book_id TEXT NOT NULL,
  note_text TEXT,
  created_at DATETIME,
  updated_at DATETIME
);
```

### Regenerate Image (Contextual)
- Right-click on the visual panel image OR double-click
- Small context menu surfaces: "Regenerate Image"
- Triggers a new generation call for the current scene
- Old image replaced in cache
- A cost reminder shown once per session: "Each regeneration uses your API quota"

### Font & Display Settings
- Font family: Serif / Sans-serif / Monospace
- Font size: slider (12px–24px)
- Line height: slider
- Reading width: narrow / medium / wide
- Dark mode / Light mode (system default honored)
- All settings saved per-book (with global default)

### Search
- Search within current book
- EPUB.js search integration
- Results highlighted in reader panel
- TOC panel shows chapter result counts

---

## 18. STYLE SEED PICKER UI

### When It Appears
- Modal overlay when a new book is opened for the first time
- Full screen, dark background
- Feels like a ritual, not a settings screen

### Layout
- Title: "Choose Your Visual Style"
- Subtitle: "This shapes the imagery Lumina generates throughout your reading. You can change it later."
- Grid of 6 seed cards (2x3 or 3x2)
- Each card: preview image (pre-generated, in app assets), seed name, one-line description
- Hover: card expands slightly, description becomes more visible
- Click: card selected (ring highlight)
- Bottom: "Begin Reading" button (activates once selection made)

### Seed Preview Images
- Pre-generated and shipped with the app
- All depict the same abstract symbolic subject (e.g., a solitary tree, a doorway, a horizon) rendered in each style
- This makes style comparison intuitive without involving the user's book at all

---

## 19. SETTINGS & PREFERENCES

### Settings Panel (accessible via icon in top navigation)

**Reading**
- Font family
- Font size
- Line height
- Reading width
- Theme (dark/light/system)

**Visuals**
- Image generation: Enabled / Disabled toggle
- Current style seed (with "Change" option — triggers re-generation warning)
- "Re-analyze Book" (re-runs full semantic pipeline)
- "Regenerate All Images" (keeps analysis, regenerates images only)

**API Keys**
- Google AI Studio key: display + edit
- fal.ai key: display + edit (optional, shown as secondary)
- "Test Key" button (sends a minimal test call, returns success/fail)

**Library**
- All imported books listed
- Remove book option (removes from library + clears cache)
- Import new book button

---

## 20. IMPLEMENTATION ORDER

Build in this exact order. Do not skip ahead. Each phase should be stable before the next begins.

### Phase 1 — Shell & Layout
- [ ] Tauri + React + TypeScript scaffold
- [ ] Three-panel layout with react-resizable-panels
- [ ] Panel collapse/expand behavior
- [ ] Panel reordering (drag headers)
- [ ] Layout presets (Classic, Focused, Immersive)
- [ ] Dark mode default, light mode toggle
- [ ] Top navigation bar (app title, settings icon, layout toggle)
- [ ] Settings panel (stub — UI only, no functionality yet)

### Phase 2 — EPUB Import & Reading
- [ ] Tauri file dialog for EPUB import
- [ ] JSZip extraction
- [ ] Adaptive parser (all 4 fallback levels)
- [ ] EPUB.js integration in reader panel
- [ ] TOC panel rendering from parsed structure
- [ ] Chapter navigation from TOC
- [ ] Reading progress tracking (CFI-based)
- [ ] Progress persistence (SQLite)
- [ ] Font/display settings (functional)

### Phase 3 — Reader Features
- [ ] Text selection and highlight system
- [ ] Highlight color options
- [ ] Highlight persistence (SQLite)
- [ ] Note creation (linked to highlight)
- [ ] Notes panel in TOC area
- [ ] Search within book
- [ ] Highlights shown as markers in TOC

### Phase 4 — BYOK & API Integration
- [ ] Welcome screen with API key entry
- [ ] Tauri secure store integration
- [ ] Key validation test call
- [ ] Settings API key management UI

### Phase 5 — Semantic Pipeline
- [ ] Text chunking and section summary generation
- [ ] Gemini Flash integration (sentiment scoring per section)
- [ ] Story shape fitting algorithm
- [ ] Inflection point identification
- [ ] Golden number calculation
- [ ] Scene identification (Pass 2 zoom-in)
- [ ] Image description generation (Pass 3)
- [ ] Store all results in SQLite semantic map

### Phase 6 — Style Seed System
- [ ] Seed presets defined (6 seeds, prompt fragments, palette keywords)
- [ ] Seed picker UI (modal, preview images, selection)
- [ ] Seed stored per book in SQLite
- [ ] Seed injected into image description generation

### Phase 7 — Image Generation
- [ ] Imagen 3 API integration
- [ ] Flux fallback integration
- [ ] Negative prompt system
- [ ] Style continuity injection (prior image context)
- [ ] Image saved to local cache
- [ ] Cache index in SQLite

### Phase 8 — Read-Ahead Trigger System
- [ ] useReadPosition hook (CFI polling)
- [ ] Proximity detection to upcoming image scenes
- [ ] Generation queue manager
- [ ] Opening atmosphere image generated at import
- [ ] Image display in visual panel (crossfade transitions)
- [ ] Theme display below image (from semantic map)

### Phase 9 — Visual Panel Polish
- [ ] Regenerate button (right-click / double-click surface)
- [ ] Cost reminder on regenerate
- [ ] Graceful failure state (ambient color field)
- [ ] Image loading state (tasteful, non-jarring)

### Phase 10 — Final Polish
- [ ] Onboarding flow (first launch → API key → library)
- [ ] Library view (all imported books, covers, progress)
- [ ] Full settings panel (all options functional)
- [ ] Copyright/disclaimer notice on EPUB import
- [ ] Error handling and edge cases throughout
- [ ] Performance pass (memory, load times)
- [ ] Build and package (Mac, Windows)

---

## 21. MVP BOUNDARIES

### In MVP (v0.1)
- EPUB import
- Adaptive chapter/section parsing
- Three-panel layout (draggable, resizable, collapsible, reorderable)
- EPUB.js text rendering
- TOC navigation
- Reading progress persistence
- Text highlighting
- Notes / annotations
- Font and display settings
- BYOK (Google AI Studio key)
- Full semantic pipeline (arc analysis, scene identification, description generation)
- Style seed picker (6 presets)
- Image generation (Imagen 3, Flux fallback)
- Read-ahead buffering system
- Local image cache
- Graceful degradation (works fully without image generation if desired)
- Theme display below image
- Regenerate image (right-click/double-click)
- Dark mode default

### Not In MVP
- Text to speech
- Cloud sync
- User accounts
- Social/sharing features
- Mobile version
- PDF support
- Custom style seeds (user-defined)
- Image density preference slider
- Export notes/highlights
- Dictionary/Wikipedia lookup
- Multiple language support
- Reading statistics / time tracking
- Book recommendations

---

## 22. FUTURE VERSIONS (Do Not Build Yet)

**v0.2**
- Image density preference (Minimal / Balanced / Rich)
- Custom style seeds (user defines their own)
- Export highlights and notes (Markdown, PDF)
- Dictionary integration (on word tap)
- Reading time estimates

**v0.3**
- PDF support
- Reading statistics (time per session, words per minute, streaks)
- Multiple book support improvements (bookshelf view polish)

**v1.0**
- Optional cloud backup of annotations (not images)
- Sharing individual generated images (not book text)
- Additional style seeds (curated expansions)

---

## IMPORTANT CONSTANTS

These values should be in a central config file and never hardcoded inline:

```typescript
export const LUMINA_CONFIG = {
  GENERATION_TRIGGER_DISTANCE_WORDS: 2000,   // start generating when this far ahead
  GENERATION_APPROACH_DISTANCE_WORDS: 5000,  // begin queuing when this far ahead
  MAX_IMAGES_SHORT_BOOK: 5,                  // books under 50k words
  MAX_IMAGES_MEDIUM_BOOK: 8,                 // books 50k-150k words
  MAX_IMAGES_LONG_BOOK: 12,                  // books over 150k words
  MIN_IMAGES: 2,                             // always at least 2
  IMAGE_TRANSITION_DURATION_MS: 1500,        // crossfade duration
  SEMANTIC_CHUNK_MAX_TOKENS: 400,            // max tokens per section summary sent to Gemini
  IMAGE_ASPECT_RATIO: '16:9',
  IMAGE_CACHE_DIR: 'lumina/cache/images',
  DB_NAME: 'lumina.db',
  DEFAULT_FONT_SIZE: 18,
  DEFAULT_LINE_HEIGHT: 1.7,
  DEFAULT_READING_WIDTH: 'medium',
  DEFAULT_THEME: 'system',
  DEFAULT_PANEL_LAYOUT: { toc: 20, visual: 35, reader: 45 },
}
```

---

*End of Plan — Lumina v0.1*
*Reference this document throughout the build. Do not summarize it.*
