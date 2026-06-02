# Lumina — Plan II
## Evolution: Cinematic Reading Environment

Goal: evolve Lumina from a functional EPUB reader into a genuinely seductive reading environment where prose remains primary, but visuals, typography, and layout create emotional pull.

---

## Build Order

1. `sanitizeRawLabel` + `titleUtils.ts` — foundation, touches nothing else
2. `scenePosition.ts` + image restore fixes + `useImageTrigger` display fix — pure logic, no UI
3. `AmbientSceneLayer` + `globals.css` keyframes + `VisualPanel` wire-up — first visual payoff
4. `ChapterHeader` + `ReaderPanel` swap — second visual payoff, independent of layout
5. `DesktopRail` + `DesktopLayout` + `TocDrawer side` + `settingsStore` default — layout restructure
6. `LibraryPanel` + `LibraryBookCard` + store actions + db functions + App wiring — library feature
7. Tablet landscape right drawer fix — small change, last
8. Polish pass (8a–8e) — after everything else is stable

---

## Step 1 — Title Cleaning

### Problem
`buildHierarchicalTitle` in `epubParser.ts` produces display-hostile strings like `[Red Rising Saga 01] Red Rising / Chapter One — The Reaper`. Two sources of noise: bracket-wrapped metadata from EPUB omnibus packaging, and the parent/child separator slash that made sense in a nav tree but is ugly as a display title.

### Changes

**`src/pipeline/epubParser.ts`**

Add a `sanitizeRawLabel(label: string): string` function immediately after the existing `normalizeTitle` function:

```ts
function sanitizeRawLabel(label: string): string {
  return label
    // Strip leading bracket metadata: [Red Rising Saga 01], [Book 1], etc.
    .replace(/^\[[^\]]+\]\s*/g, "")
    // Strip trailing bracket metadata
    .replace(/\s*\[[^\]]+\]$/g, "")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}
```

Modify `buildHierarchicalTitle(label: string, parentLabels: string[]): string`:

```ts
function buildHierarchicalTitle(label: string, parentLabels: string[]): string {
  const cleanLabel = sanitizeRawLabel(normalizeTitle(label));

  const meaningfulParents = parentLabels
    .map((p) => sanitizeRawLabel(normalizeTitle(p)))
    .filter(Boolean)
    .filter((parent) => parent !== cleanLabel)
    // Drop any parent that is a pure omnibus/bracket artifact now empty after sanitization
    .filter((parent) => parent.length > 0);

  // Find the nearest group label (Book/Part/Volume) that adds useful context
  const nearestGroup = meaningfulParents.find((parent) =>
    /\b(book|saga|volume|vol\.?|part|act)\b/i.test(parent)
  );

  // Only prepend a group label if the chapter title doesn't already contain it
  if (!nearestGroup || cleanLabel.toLowerCase().includes(nearestGroup.toLowerCase())) {
    return cleanLabel;
  }

  return `${nearestGroup} / ${cleanLabel}`;
}
```

Why this is better: the existing function checks for the bracket pattern but only to find a `nearestBook` — it doesn't strip it. `sanitizeRawLabel` strips it before anything else runs. The ` / ` separator still exists in stored titles for group context, but the raw `[Red Rising Saga 01]` noise is gone at storage time.

---

**`src/utils/titleUtils.ts`** — new file

This utility is used by the UI layer only. The parser stores the cleaned title string (`"Book One — Born a Serf / The Reaper"`); the UI needs to break that into parts for display.

```ts
export interface ChapterDisplay {
  groupLabel: string | null;   // "Book One — Born a Serf"
  title: string;               // "The Reaper"
  subtitle: string | null;     // extracted from colon or em-dash after the chapter title
}

/**
 * Parses a stored chapter title string into display parts.
 * Handles:
 *   "The Reaper"                         → { groupLabel: null, title: "The Reaper", subtitle: null }
 *   "Book One / The Reaper"              → { groupLabel: "Book One", title: "The Reaper", subtitle: null }
 *   "Book One / Chapter 1: The Reaper"   → { groupLabel: "Book One", title: "Chapter 1", subtitle: "The Reaper" }
 *   "Chapter One — The Reaper"           → { groupLabel: null, title: "Chapter One", subtitle: "The Reaper" }
 */
export function parseChapterDisplay(raw: string): ChapterDisplay {
  if (!raw) return { groupLabel: null, title: "Untitled", subtitle: null };

  let groupLabel: string | null = null;
  let remainder = raw;

  // Split on the group separator injected by buildHierarchicalTitle
  if (raw.includes(" / ")) {
    const slashIdx = raw.indexOf(" / ");
    groupLabel = raw.slice(0, slashIdx).trim() || null;
    remainder = raw.slice(slashIdx + 3).trim();
  }

  // Split title from subtitle on colon or em-dash
  const colonMatch = remainder.match(/^(.+?):\s+(.+)$/);
  if (colonMatch) {
    return { groupLabel, title: colonMatch[1].trim(), subtitle: colonMatch[2].trim() };
  }

  const dashMatch = remainder.match(/^(.+?)\s+[—–]\s+(.+)$/);
  if (dashMatch) {
    return { groupLabel, title: dashMatch[1].trim(), subtitle: dashMatch[2].trim() };
  }

  return { groupLabel, title: remainder, subtitle: null };
}

/**
 * Returns the shortest human-readable identifier for a chapter,
 * for use in compact contexts (rail indicator, tab title).
 * Prefers subtitle if it's short, else falls back to title.
 */
export function shortChapterLabel(display: ChapterDisplay): string {
  if (display.subtitle && display.subtitle.length <= 28) return display.subtitle;
  if (display.title.length <= 28) return display.title;
  return display.title.slice(0, 26) + "…";
}
```

**`src/types/index.ts`** — no change. The `Chapter.title` field stores the cleaned string. Display parsing happens at render time via `parseChapterDisplay`.

---

## Step 2 — Opening Image Fix for Returning Books

### Problem
`startOrchestration` finds a cached `existingMap` and calls `_queueGenerations`, but never restores the current display image. The visual panel sits blank on every book re-open even if images were previously generated.

Also: the read-ahead trigger only fires when `wordPosition` changes, so at word 0 on book open, scene 0 (which might be at word 8000) never triggers until the reader walks toward it.

### Changes

**`src/utils/scenePosition.ts`** — new file

Extract the word-position calculation into a shared helper so both `useBookOrchestration` and `useImageTrigger` use the same logic. Currently `useImageTrigger` has `getSceneWordPosition` as a local `useCallback`. Extract it:

```ts
import type { IdentifiedScene, Chapter } from "@/types";

export function computeSceneWordPosition(
  scene: IdentifiedScene,
  chapters: Chapter[]
): number {
  if (!chapters.length) return 0;

  const anchor = scene.anchor;
  if (anchor) {
    const chapter =
      chapters.find((ch) => ch.spineIndex === anchor.spineIndex) ??
      chapters.find((ch) => ch.id === scene.chapterId);
    if (!chapter) return 0;
    const wordsBefore = chapters
      .slice(0, chapter.index)
      .reduce((sum, ch) => sum + ch.wordCount, 0);
    return wordsBefore + anchor.wordOffset;
  }

  // Legacy fallback
  const chapter = chapters.find((ch) => ch.id === scene.chapterId);
  if (!chapter) return 0;
  return chapters.slice(0, chapter.index).reduce((s, c) => s + c.wordCount, 0);
}
```

---

**`src/hooks/useImageTrigger.ts`**

Replace the local `getSceneWordPosition` `useCallback` with an import of `computeSceneWordPosition` from `scenePosition.ts`. The function body is identical — this is deduplication only.

Also fix the display window logic. The current check `wordPosition >= scenePos && wordPosition < scenePos + 3000` means the image only shows for a 3,000-word window, then silently persists with no active management. The correct behavior is: always display the most recently passed scene's image. Replace the proximity display section in `checkProximity` with:

```ts
// Find the scene whose position is <= wordPosition and closest to it
let bestScene: IdentifiedScene | null = null;
let bestDist = Infinity;

for (const scene of scenes) {
  const scenePos = computeSceneWordPosition(scene, chapters);
  const dist = wordPosition - scenePos;  // positive = reader has passed this scene
  if (dist >= 0 && dist < bestDist && imageCache[scene.id]) {
    bestDist = dist;
    bestScene = scene;
  }
}

if (bestScene) {
  const cached = imageCache[bestScene.id];
  const current = useImageStore.getState().currentImage;
  if (current?.sceneId !== bestScene.id) {
    transitionToImage(cached);
  }
}
```

Keep the read-ahead queueing logic unchanged. Only the display logic changes. This ensures the most recently passed scene's image is always shown with no empty gap between scenes.

---

**`src/hooks/useBookOrchestration.ts`**

Inside `startOrchestration`, after the `existingMap` branch is confirmed and before `_queueGenerations`, restore the contextually correct image:

```ts
if (existingMap) {
  setActiveSemanticMap(existingMap);

  // Restore current display image from cache (populated in openBook via dbLoadImageCache)
  const { imageCache } = useImageStore.getState();
  const { wordPosition } = useReaderStore.getState();
  const { activeStructure } = useBookStore.getState();
  const chapters = activeStructure?.chapters ?? [];

  let imageToDisplay: CachedImage | null = null;
  let bestSceneWordPos = -1;

  for (const scene of existingMap.scenes) {
    const sceneWordPos = computeSceneWordPosition(scene, chapters);
    if (sceneWordPos <= wordPosition && sceneWordPos > bestSceneWordPos) {
      const cached = imageCache[scene.id];
      if (cached) {
        imageToDisplay = cached;
        bestSceneWordPos = sceneWordPos;
      }
    }
  }

  // Fallback: if no scene is behind the reader, show scene 0's image if available
  if (!imageToDisplay) {
    const firstCached = imageCache[existingMap.scenes[0]?.id];
    if (firstCached) imageToDisplay = firstCached;
  }

  if (imageToDisplay) {
    setCurrentImage(imageToDisplay);
    setCurrentThemes(imageToDisplay.emotionalThemes);
  }

  await _queueGenerations(existingMap.scenes, slice.semanticBookId);
  return;
}
```

`setCurrentImage` and `setCurrentThemes` need to be destructured from `useImageStore` at the top of `useBookOrchestration`.

---

**`src/hooks/useEpubImport.ts`** — `openBook` function

After all stores are populated and before `setActiveBook`, restore the current display image. `setCurrentImage` and `setCurrentThemes` need to be added to the `useImageStore` destructure.

```ts
// Immediately surface the most recently passed scene's image
if (semanticMap && cachedImages.length > 0) {
  const imageMap: Record<string, CachedImage> = {};
  cachedImages.forEach((img) => { imageMap[img.sceneId] = img; });

  const progressPercent = progress?.percentComplete ?? 0;
  const chapters = structure?.chapters ?? [];
  const totalWords = chapters.reduce((s, c) => s + c.wordCount, 0);
  const estimatedWordPos = (totalWords * progressPercent) / 100;

  let imageToDisplay: CachedImage | null = null;
  let bestPos = -1;

  for (const scene of semanticMap.scenes) {
    const pos = computeSceneWordPosition(scene, chapters);
    if (pos <= estimatedWordPos && pos > bestPos && imageMap[scene.id]) {
      imageToDisplay = imageMap[scene.id];
      bestPos = pos;
    }
  }

  if (!imageToDisplay && cachedImages[0]) imageToDisplay = cachedImages[0];

  if (imageToDisplay) {
    setCurrentImage(imageToDisplay);
    setCurrentThemes(imageToDisplay.emotionalThemes);
  }
}
```

---

## Step 3 — Ambient Visual Layer

### Problem
`VisualPanel` shows a static dark panel during all waiting states. No motion, no mood, no indication that something is building.

### New Component

**`src/components/visual/AmbientSceneLayer.tsx`** — new file

Replaces `WaitingState`, `AnalyzingState`, and `EmptyVisualState` in `VisualPanel`. A self-contained living background that responds to arc shape and analysis progress.

```tsx
interface AmbientSceneLayerProps {
  arcShape?: string;         // from activeSemanticMap.arcShape, or undefined
  phase: "empty" | "analyzing" | "waiting" | "generating";
  progressText?: string;     // from analysisProgress in bookStore
}
```

**Internal structure — three layers stacked:**

**Layer 1 — Gradient base:**

A `<div>` with `background` set from an expanded arc-to-gradient map. When `arcShape` is undefined, a neutral dark. When defined, a mood gradient that communicates the arc:

```ts
const AMBIENT_GRADIENTS: Record<string, string> = {
  "rise":           "radial-gradient(ellipse at 20% 80%, #0d1f0e 0%, #071525 55%, #030b12 100%)",
  "fall":           "radial-gradient(ellipse at 80% 20%, #1f0d0d 0%, #120507 55%, #070308 100%)",
  "fall-rise":      "radial-gradient(ellipse at 50% 70%, #0a0a14 0%, #1a0c08 40%, #0a1420 100%)",
  "rise-fall":      "radial-gradient(ellipse at 40% 30%, #141a0a 0%, #0c0a18 50%, #08080e 100%)",
  "rise-fall-rise": "radial-gradient(ellipse at 25% 60%, #1a0c0a 0%, #0c0a14 45%, #0a1a0c 100%)",
  "fall-rise-fall": "radial-gradient(ellipse at 70% 40%, #0c1010 0%, #160c08 45%, #0c1016 100%)",
  "default":        "radial-gradient(ellipse at 50% 50%, #0d1018 0%, #070a10 100%)",
};
```

The gradient div carries a CSS class `animate-ambient-pulse` — a slow scale animation between 100% and 115%, 6-second ease-in-out infinite loop. The movement is barely perceptible but the layer breathes.

**Layer 2 — Particles:**

8 absolutely-positioned `<div>` elements. Each is a small blurred circle (4px to 12px diameter, `border-radius: 50%`, `filter: blur(4px)`, opacity 0.06–0.18). Each carries a unique CSS animation class `animate-float-N` (N = 1 through 8) with different duration (8s–22s), delay (-2s to -15s), and translation path (20px x/y range). Positions and animations are baked into CSS — no JS randomness, no canvas, no library.

Particle color is derived from `arcShape`:
- `rise`, `rise-fall-rise` → warm ember `rgba(180, 120, 60, alpha)`
- `fall`, `fall-rise-fall` → cool ash `rgba(100, 120, 160, alpha)`
- all others → neutral silver `rgba(150, 160, 180, alpha)`

**Layer 3 — Status text:**

Centered flex column:
- `<Sparkles>` icon at 16px, lumina-gold, slow 4-second rotate animation
- Primary status line `text-sm text-white/25 font-light tracking-wide` that changes based on `phase`:
  - `"empty"` → `"Open a book to begin"`
  - `"analyzing"` → `progressText` from the store (passed as prop)
  - `"waiting"` → `"First scene forming…"`
  - `"generating"` → `"Composing the scene…"`
- When `phase === "analyzing"`, add a secondary line with the raw progress message in `text-xs text-white/15`

Status text uses `AnimatePresence` with `opacity: 0 → 1, y: 4 → 0` so progress messages update smoothly without jumping.

---

**`src/components/layout/VisualPanel.tsx`**

Replace `EmptyVisualState`, `AnalyzingState`, and `WaitingState` with `AmbientSceneLayer`. The component tree in the image area becomes:

```tsx
{!activeBook ? (
  <AmbientSceneLayer phase="empty" />
) : !imageGenerationEnabled ? (
  <DisabledState />
) : isAnalyzing ? (
  <AmbientSceneLayer
    arcShape={activeSemanticMap?.arcShape}
    phase="analyzing"
    progressText={analysisProgress}
  />
) : hasFailed ? (
  <AmbientFailureState gradient={ambientGradient} onRetry={handleRegenerate} />
) : currentImage ? (
  <ImageDisplay src={currentImage.filePath} isTransitioning={isTransitioning} isGenerating={isGenerating} />
) : (
  <AmbientSceneLayer
    arcShape={activeSemanticMap?.arcShape}
    phase={isGenerating ? "generating" : "waiting"}
  />
)}
```

Pull `isGenerating` and `analysisProgress` — `isGenerating` from `useImageStore`, `analysisProgress` from `useBookStore` (it's already in the store but not destructured in VisualPanel currently).

`AmbientFailureState` stays as-is — keep it separate.

`ImageDisplay` receives a new `isGenerating` prop and shows a faint generation anticipation indicator (see Step 8a).

---

**`src/styles/globals.css`**

Add keyframe definitions:

```css
/* Ambient gradient pulse */
@keyframes ambient-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}
.animate-ambient-pulse {
  animation: ambient-pulse 6s ease-in-out infinite;
  transform-origin: center;
}

/* Particle float animations — 8 variants */
@keyframes float-1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(8px,-14px)} }
@keyframes float-2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-12px,8px)} }
@keyframes float-3 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(16px,6px)} }
@keyframes float-4 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-6px,-18px)} }
@keyframes float-5 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(10px,12px)} }
@keyframes float-6 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-14px,-8px)} }
@keyframes float-7 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(6px,-10px)} }
@keyframes float-8 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-10px,16px)} }

.animate-float-1 { animation: float-1 14s ease-in-out infinite; animation-delay: -3s; }
.animate-float-2 { animation: float-2 18s ease-in-out infinite; animation-delay: -7s; }
.animate-float-3 { animation: float-3 11s ease-in-out infinite; animation-delay: -1s; }
.animate-float-4 { animation: float-4 22s ease-in-out infinite; animation-delay: -12s; }
.animate-float-5 { animation: float-5 9s ease-in-out infinite; animation-delay: -4s; }
.animate-float-6 { animation: float-6 16s ease-in-out infinite; animation-delay: -9s; }
.animate-float-7 { animation: float-7 13s ease-in-out infinite; animation-delay: -2s; }
.animate-float-8 { animation: float-8 20s ease-in-out infinite; animation-delay: -15s; }
```

---

## Step 4 — ChapterHeader Component

### Problem
`ReaderPanel` renders a raw title string with a single `<h1>`. No hierarchy, no animation, looks like a prototype.

### New Component

**`src/components/reader/ChapterHeader.tsx`** — new file

```tsx
import { motion, AnimatePresence } from "framer-motion";
import { parseChapterDisplay } from "@/utils/titleUtils";

interface ChapterHeaderProps {
  title: string;
  bookTitle: string;
  chapterIndex: number;  // used as AnimatePresence key — triggers re-animation on chapter change
  fontSize: number;
}

export default function ChapterHeader({ title, bookTitle, chapterIndex, fontSize }: ChapterHeaderProps) {
  const display = parseChapterDisplay(title);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={chapterIndex}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
        className="flex-shrink-0 px-8 pt-6 pb-5 border-b border-white/5"
      >
        {/* Book title — always present, smallest, most muted */}
        <p className="text-xs tracking-[0.18em] text-white/20 uppercase mb-1 font-medium">
          {bookTitle}
        </p>

        {/* Group label — Book One / Part Two / Act One — when present */}
        {display.groupLabel && (
          <p className="text-xs tracking-[0.14em] text-lumina-gold/50 uppercase mb-2 font-medium">
            {display.groupLabel}
          </p>
        )}

        {/* Primary chapter title — largest, most prominent */}
        <h1
          className="font-serif text-white/90 leading-tight tracking-tight"
          style={{ fontSize: `${Math.round(fontSize * 1.55)}px` }}
        >
          {display.title}
        </h1>

        {/* Subtitle — when present */}
        {display.subtitle && (
          <p
            className="font-serif text-white/45 leading-snug mt-1 italic"
            style={{ fontSize: `${Math.round(fontSize * 1.1)}px` }}
          >
            {display.subtitle}
          </p>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
```

The `AnimatePresence` key on `chapterIndex` means every chapter change triggers the full enter animation. No additional listener or effect needed.

---

**`src/components/layout/ReaderPanel.tsx`**

Replace the existing chapter header block with:

```tsx
{activeBook && currentChapter && (
  <ChapterHeader
    title={currentChapter.title}
    bookTitle={activeBook.title}
    chapterIndex={currentChapterIndex}
    fontSize={fontSize}
  />
)}
```

Remove the old `<div className="flex-shrink-0 px-8 pt-6 pb-4 border-b border-white/5">` block entirely. Import `ChapterHeader` at the top.

---

## Step 5 — Desktop Rail + TOC as Overlay

### Problem
The TOC permanently occupies 20% of the layout. No rail button, no current-chapter indicator, and closing the TOC just sets its panel to 0% — there's no affordance to re-open it.

### Structural Change

The desktop layout moves from `PanelContainer` (three horizontal resizable panels) to a new structure:

```
[DesktopRail 40px fixed] [VisualPanel flex] [ReaderPanel flex]
+ TocDrawer floating above, anchored left, opens/closes over the visual area
```

The rail never disappears. The TOC never takes column space. Visual and Reader always occupy full remaining width.

---

**`src/components/layout/DesktopRail.tsx`** — new file

A fixed `w-10` (40px) left column, full height, `bg-surface-dark border-r border-white/5`.

Contains three things top-to-bottom:

1. **TOC toggle button** at the top — `<Menu size={16} />` or `<X size={16} />` based on `tocOpen`. Minimum 44px tall. `text-lumina-gold` when open, `text-white/25` when closed.

2. **Progress bar** in the middle — a 2px-wide vertical bar on the left edge of the rail spanning the full height of the rail. Filled to `percentComplete` with `bg-lumina-gold/30`. This is passive and always visible. No text needed. Communicates reading position at a glance.

3. **Library button** at the bottom — `<Library size={16} />` icon. Opens the library panel. Minimum 44px tall.

Props:
```ts
interface DesktopRailProps {
  tocOpen: boolean;
  onTocToggle: () => void;
  onLibraryOpen: () => void;
  percentComplete: number;  // 0–100 from readerStore
}
```

---

**`src/components/layout/DesktopLayout.tsx`** — new file (replaces `PanelContainer`)

```tsx
import { useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import DesktopRail from "./DesktopRail";
import TocDrawer from "./TocDrawer";
import VisualPanel from "./VisualPanel";
import ReaderPanel from "./ReaderPanel";
import { useReaderStore } from "@/store/readerStore";
import { useSettingsStore } from "@/store/settingsStore";

export default function DesktopLayout() {
  const [tocOpen, setTocOpen] = useState(false);
  const { percentComplete } = useReaderStore();
  const { panelLayout, setPanelLayout } = useSettingsStore();

  return (
    <div className="flex-1 flex overflow-hidden relative">
      {/* Fixed left rail */}
      <DesktopRail
        tocOpen={tocOpen}
        onTocToggle={() => setTocOpen(v => !v)}
        onLibraryOpen={() => {}}   // wired in Step 6
        percentComplete={percentComplete}
      />

      {/* TOC as floating overlay — does not displace visual/reader */}
      <TocDrawer
        open={tocOpen}
        onClose={() => setTocOpen(false)}
      />

      {/* Main content: Visual | Reader — resizable */}
      <Group
        orientation="horizontal"
        className="flex-1 overflow-hidden"
        onLayoutChanged={(layout) =>
          setPanelLayout({
            toc: 0,
            visual: layout["visual"] ?? panelLayout.visual,
            reader: layout["reader"] ?? panelLayout.reader,
          })
        }
        defaultLayout={{ visual: panelLayout.visual || 40, reader: panelLayout.reader || 60 }}
      >
        <Panel id="visual" defaultSize={panelLayout.visual || 40} minSize={20}>
          <VisualPanel />
        </Panel>
        <Separator className="group relative w-1 flex-shrink-0 bg-white/5 hover:bg-white/15 transition-colors cursor-col-resize">
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-white/10 group-hover:bg-lumina-gold/40 transition-colors" />
        </Separator>
        <Panel id="reader" defaultSize={panelLayout.reader || 60} minSize={30}>
          <ReaderPanel />
        </Panel>
      </Group>
    </div>
  );
}
```

---

**`src/App.tsx`**

Replace `<PanelContainer />` with `<DesktopLayout />` in the `!isTablet` branch. `PanelContainer` becomes unused.

---

**`src/store/settingsStore.ts`**

Change the default panel layout:
```ts
panelLayout: { toc: 0, visual: 40, reader: 60 },
```

The `toc` field stays in the layout type for backward compat. `visual` and `reader` are the two meaningful values now.

---

## Step 6 — Library Panel

### Problem
No way to access previously imported books. No book switching. No book close. Books are trapped behind re-import.

### Store Changes

**`src/store/bookStore.ts`**

Add `closeActiveBook` action:

```ts
closeActiveBook: () => set({
  activeBook: null,
  activeStructure: null,
  activeSemanticMap: null,
  activeStyleSeed: null,
  isAnalyzing: false,
  analysisProgress: "",
  initialCfi: null,
}),
```

Add `removeBook` action:

```ts
removeBook: (bookId: string) => set(state => ({
  books: state.books.filter(b => b.id !== bookId)
})),
```

Both are added to the store's interface and implementation. The `books` array (library) stays loaded across book switches — only active-book state is cleared.

---

**`src/store/imageStore.ts`**

Add `clearCurrentDisplay` action:

```ts
clearCurrentDisplay: () => set({
  currentImage: null,
  currentThemes: [],
  isTransitioning: false,
  generationQueue: [],
  isGenerating: false,
}),
```

This is separate from `clearImageCache` (which clears the `imageCache` map). `clearCurrentDisplay` only clears what's currently shown — the cache stays populated for when the book is re-opened.

---

**`src/services/db.ts`**

Add two new functions:

```ts
export async function dbDeleteBook(bookId: string): Promise<void>
// deletes the book row from the books table

export async function dbDeleteAllBookData(bookId: string): Promise<void>
// deletes all rows across: books, reading_progress, highlights, notes,
// semantic_maps, image_cache, book_settings where bookId matches
```

---

**`src/hooks/useEpubImport.ts`**

Add `switchBook` function:

```ts
const switchBook = useCallback(async (book: Book) => {
  const { closeActiveBook } = useBookStore.getState();
  const { clearCurrentDisplay } = useImageStore.getState();

  closeActiveBook();
  clearCurrentDisplay();

  // Small yield so React can unmount EpubRenderer cleanly before re-mounting
  await new Promise(resolve => setTimeout(resolve, 50));

  await openBook(book);
}, [openBook]);
```

Return `switchBook` from the hook alongside `importEpub`, `loadLibrary`, `openBook`.

---

### New Components

**`src/components/library/LibraryBookCard.tsx`** — new file

A single book card. Props:

```ts
interface LibraryBookCardProps {
  book: Book;
  isActive: boolean;
  onOpen: (book: Book) => void;
  onDelete: (book: Book) => void;
}
```

Layout:
- Cover image (`book.coverImage` data URL if available, else a placeholder with the book's first letter in serif, `bg-white/5`)
- Title in serif `text-sm text-white/80`, truncated to 2 lines
- Author in `text-xs text-white/35`
- Progress bar at the bottom of the card — a thin `h-0.5` bar, `bg-lumina-gold/40` filled to `percentComplete`
- Last opened: formatted relative date (`"2 days ago"`, `"Today"`) in `text-xs text-white/20`
- If `isActive`: a `border-lumina-gold/40` ring and a small gold dot indicator

Delete interaction:
- Desktop: small trash icon appears on hover in the top-right corner of the card
- Tablet: long-press triggers a confirm state on the card (shows "Delete?" overlay with confirm/cancel)
- Confirmation required before deletion — no accidental wipes

Delete handler:
```ts
const handleDelete = async (book: Book) => {
  if (activeBook?.id === book.id) {
    closeActiveBook();
    clearCurrentDisplay();
  }
  await dbDeleteAllBookData(book.id);
  await deleteDirectory(`books/${book.id}`);
  await deleteDirectory(`lumina/cache/images/${book.id}`);
  removeBook(book.id);
};
```

---

**`src/components/library/LibraryPanel.tsx`** — new file

Full-screen modal overlay. Uses `AnimatePresence` for enter/exit (`opacity: 0 → 1`, `y: 20 → 0`, 0.25s).

```ts
interface LibraryPanelProps {
  open: boolean;
  onClose: () => void;
  onOpenBook: (book: Book) => void;
  onImport: () => void;
}
```

Layout:
```
┌─────────────────────────────────────────────────────────┐
│  LUMINA · Your Library                  [Import] [✕]    │
├─────────────────────────────────────────────────────────┤
│  [Card] [Card] [Card] [Card]                            │
│  [Card] [Card]                                          │
│                                                         │
│  (empty state if no books: "Import your first book")    │
└─────────────────────────────────────────────────────────┘
```

The overlay is `absolute inset-0 z-50 bg-surface-dark/96 backdrop-blur-md`. Not a separate window — sits above the main app layout.

Books sorted by `lastOpened` descending from `useBookStore().books`.

The Import button inside the panel calls `onImport`, which is `handleImport` in `App.tsx`. After import completes (seed selected, orchestration started), close the library.

If `books.length === 0`, show a centered empty state: `<BookOpen>` icon, `"No books yet"`, and a prominent `"Import your first EPUB"` button.

---

**`src/App.tsx`**

Add library state and wire `switchBook`:

```ts
const [libraryOpen, setLibraryOpen] = useState(false);
const { switchBook } = useEpubImport();
```

Add `LibraryPanel` inside `AnimatePresence`:

```tsx
<AnimatePresence>
  {libraryOpen && (
    <LibraryPanel
      open={libraryOpen}
      onClose={() => setLibraryOpen(false)}
      onOpenBook={async (book) => {
        await switchBook(book);
        setLibraryOpen(false);
      }}
      onImport={async () => {
        setLibraryOpen(false);
        await handleImport();
      }}
    />
  )}
</AnimatePresence>
```

Pass `onLibraryOpen={() => setLibraryOpen(true)}` down through `DesktopLayout` → `DesktopRail` (desktop) and through `TopNav` (tablet).

---

## Step 7 — Tablet Landscape TOC to Right Drawer

### Problem
The current `TabletPanelContainer` landscape layout has a collapsible left rail. The plan calls for the TOC to be a right-side drawer so the main reading area is always full-width and unencumbered on both orientations.

### Changes

**`src/components/layout/TocDrawer.tsx`**

Add a `side` prop:

```tsx
interface Props {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";  // default "left"
}
```

When `side === "right"`:
- Slide from right: `initial={{ x: "100%" }}`, `animate={{ x: 0 }}`, `exit={{ x: "100%" }}`
- Position: `right-0` instead of `left-0`
- Width unchanged: `w-72`
- Backdrop unchanged

---

**`src/components/layout/TabletPanelContainer.tsx`**

Remove the `AnimatePresence` TOC rail from `LandscapeLayout`. Replace with a full-width stacked layout identical to portrait, but with a right-side drawer:

```tsx
function LandscapeLayout({ tocOpen, onTocClose }: { tocOpen: boolean; onTocClose: () => void }) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Reader — top 60% */}
      <div className="flex-[3] overflow-hidden min-h-0">
        <ReaderPanel />
      </div>

      <div className="h-px bg-white/5 flex-shrink-0" />

      {/* Visual — bottom 40% */}
      <div className="flex-[2] overflow-hidden min-h-0">
        <VisualPanel />
      </div>

      {/* TOC slides in from the right */}
      <TocDrawer open={tocOpen} onClose={onTocClose} side="right" />
    </div>
  );
}
```

The portrait layout is unchanged (drawer from left is correct for portrait).

`TopNav` hamburger wiring is unchanged — `onTocToggle` fires regardless of which side the drawer opens from.

---

## Step 8 — Polish Pass

### 8a — Generation anticipation text in `ImageDisplay`

**`src/components/layout/VisualPanel.tsx`**

Update `ImageDisplay` props:
```tsx
function ImageDisplay({
  src,
  isTransitioning,
  isGenerating,
}: {
  src: string;
  isTransitioning: boolean;
  isGenerating: boolean;
})
```

Inside `ImageDisplay`, after the gradient overlay `<div>`, add:

```tsx
<AnimatePresence>
  {isGenerating && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
      className="absolute bottom-3 left-4 flex items-center gap-1.5"
    >
      <div className="w-1 h-1 rounded-full bg-lumina-gold/40 animate-pulse" />
      <span className="text-xs text-white/20 tracking-wide">next scene forming</span>
    </motion.div>
  )}
</AnimatePresence>
```

This only shows when the reader is currently looking at an image and the system is generating the *next* one — the anticipation beat. Pass `isGenerating` from `VisualPanel` where it's pulled from `useImageStore`.

---

### 8b — Ambient gradient color tuning

The gradient values in `AmbientSceneLayer` should feel like the emotional world of each arc shape. These are design values, not logic — they need to be dialed in visually. Reference guidance:

- `rise-fall-rise` (Red Rising's arc): Deep Martian red-ember at low — `#1a0805` bleeding into cold space `#0a0d14`. The warmth of something burning against the cold of something vast.
- `rise`: Forest or pre-dawn — `#0a1408` dark green building against `#071020` night. Life accumulating.
- `fall`: Ash and grey — `#12100e` warm ash into `#060608`, colour draining out of the world.
- `fall-rise`: Ice thaw — cold blue-grey `#080d14` warming slowly toward amber `#140d08`.
- `rise-fall`: Gold into shadow — amber `#14100a` into dark violet `#0a0814`, warmth draining as the story turns.
- `fall-rise-fall`: Ember and smoke — `#0e0a08` glowing orange-dark cycling back to `#0a0e14` cold.

Tweak as needed visually once rendered. The code structure holds — only RGB values change.

---

### 8c — `useImageTrigger` display window already covered in Step 2.

---

### 8d — `TopNav` tablet library access

**`src/components/layout/TopNav.tsx`**

Add `onLibraryOpen?: () => void` prop.

When `isTablet`, add a `<Library size={16} />` button next to the hamburger (or after the logo separator). Minimum 44px touch target. Calls `onLibraryOpen`.

When `isTablet && !activeBook`, style the "Open Book" button as `text-lumina-gold/60` — a soft call to action on the landing state.

---

### 8e — Onboarding awareness in `LibraryPanel`

When `hasCompletedOnboarding === false` (from `useSettingsStore`), `LibraryPanel` should not render the full library grid. Instead show only:
- The Lumina logo mark
- A `"Get started — import your first book"` message
- A single prominent import button

This prevents a confusing empty library state during first-launch flow. Check `hasCompletedOnboarding` inside `LibraryPanel` and branch the render accordingly.

---

## File Change Summary

| File | Type | Purpose |
|---|---|---|
| `src/pipeline/epubParser.ts` | Modify | Add `sanitizeRawLabel`, update `buildHierarchicalTitle` |
| `src/utils/titleUtils.ts` | New | `parseChapterDisplay`, `shortChapterLabel` |
| `src/utils/scenePosition.ts` | New | `computeSceneWordPosition` shared utility |
| `src/hooks/useBookOrchestration.ts` | Modify | Restore image on cached map load |
| `src/hooks/useEpubImport.ts` | Modify | Add `switchBook`, restore image on `openBook`, destructure `setCurrentImage`/`setCurrentThemes` |
| `src/hooks/useImageTrigger.ts` | Modify | Use shared `computeSceneWordPosition`, fix display window to always show most-recently-passed scene |
| `src/components/visual/AmbientSceneLayer.tsx` | New | Living ambient background with particles and arc gradient |
| `src/components/layout/VisualPanel.tsx` | Modify | Use `AmbientSceneLayer`, add `isGenerating` to `ImageDisplay`, pull `analysisProgress` |
| `src/styles/globals.css` | Modify | Particle float keyframes, ambient pulse keyframe |
| `src/components/layout/DesktopRail.tsx` | New | 40px left rail with TOC toggle, vertical progress bar, library button |
| `src/components/layout/DesktopLayout.tsx` | New | Two-panel layout (visual + reader) with rail and TOC overlay |
| `src/components/layout/TocDrawer.tsx` | Modify | Add `side` prop for right-side drawer |
| `src/components/layout/TabletPanelContainer.tsx` | Modify | Landscape becomes full-width with right-side drawer, no left rail |
| `src/components/reader/ChapterHeader.tsx` | New | Animated chapter title with hierarchy: group label, title, subtitle |
| `src/components/layout/ReaderPanel.tsx` | Modify | Replace raw title block with `ChapterHeader` |
| `src/components/layout/TopNav.tsx` | Modify | Add `onLibraryOpen` prop, tablet library button, active-state call-to-action |
| `src/components/library/LibraryBookCard.tsx` | New | Individual book card with cover, progress bar, delete |
| `src/components/library/LibraryPanel.tsx` | New | Full-screen library overlay with book grid and import |
| `src/store/bookStore.ts` | Modify | Add `closeActiveBook`, `removeBook` actions |
| `src/store/imageStore.ts` | Modify | Add `clearCurrentDisplay` action |
| `src/store/settingsStore.ts` | Modify | Default `panelLayout` to `{ toc: 0, visual: 40, reader: 60 }` |
| `src/services/db.ts` | Modify | Add `dbDeleteBook`, `dbDeleteAllBookData` |
| `src/App.tsx` | Modify | Wire `DesktopLayout`, `LibraryPanel`, `libraryOpen` state, `switchBook` |
