# PLANiv — Reading Surface, Knowledge Layer, and Atmosphere Layer
# Glass Lens Highlighting · Annotations Drawer · Notes · Sound Studio

---

## CONTEXT AND PHILOSOPHY

This plan governs the next phase of Lumina development covering three feature groups
that were conceived together and must be built in a way that leaves room for future
additions without becoming structurally tangled.

### The Three Layers

Every feature in Lumina belongs to one of three conceptual layers:

**Reading Surface** — What happens inside the text itself.
Direct interaction with the content. Highlighting is the primary citizen here.
Future surface features: inline dictionary, translation, text-to-speech triggers.

**Knowledge Layer** — What the reader accumulates about what they have read.
The drawer system is the home for this. Highlights, bookmarks, notes.
Future knowledge features: tags, collections, export to Markdown/PDF, sharing.

**Atmosphere Layer** — What surrounds and enhances the reading experience.
Visual imagery is already built. Sound Studio is the next member.
Future atmosphere features: adaptive lighting integration, haptic patterns on mobile.

These three layers have different interaction models, different persistence needs,
and different UI real estate. Keeping them conceptually separate prevents feature
sprawl from bleeding one into another.

---

## FEATURE DRAWER SYSTEM ARCHITECTURE

### Overview

The feature drawer is a right-side panel that slides in when summoned. It is the
single home for all accumulated features. It has two levels:

**Level 1 — Feature Menu**
The landing view inside the drawer. Lists all available features as tappable entries.
Each entry has a name, an icon, and optionally a badge (e.g., highlight count).

Current entries:
- Highlights
- Notes

Future entries will be added here as features are built. The drawer is the permanent
organizational home. Adding a new feature = adding an entry here + building its sub-view.

**Level 2 — Feature Sub-View**
Tapping an entry in the Feature Menu opens the feature's dedicated sub-view.
This slides in as a second layer within the same drawer (pushes Level 1 to the side)
or replaces Level 1 with a back-button to return to the feature menu.

The drawer does NOT require coding a new navigation system for every new feature.
It uses a simple stack: Feature Menu → Sub-View → (optional deeper view).

### Drawer Summoning

The drawer is summoned via a dedicated icon. Candidates:
- A bookmark/annotation icon in the side rail (on desktop and tablet)
- A bottom bar icon on tablet portrait mode
- A keyboard shortcut on desktop

When the drawer is open, the reader panel either:
a) Compresses to accommodate the drawer (preferred on desktop)
b) Dims/overlays with the drawer on top (preferred on tablet to preserve reading area)

The drawer can be dismissed via:
- The X button in the drawer header
- Tapping outside the drawer (tablet/mobile)
- The keyboard shortcut (desktop)
- Swiping the drawer to the right (tablet/mobile)

### Persistent State

The drawer remembers which feature sub-view was last open and reopens to it.
If the reader was in the Highlights sub-view when they closed the drawer,
it reopens to Highlights. This reduces friction for readers who use it frequently.

---

## FEATURE: GLASS LENS HIGHLIGHTING

### Concept

A highlight in Lumina is not a colored rectangle laid over text.
It is a quality of attention — a lens that focuses the reader's eye.

The visual language:
- The highlight container (the mark element) has a glass/lens aesthetic:
  a soft, semi-transparent wash in the color family, with gently feathered edges
  and a barely-perceptible inner glow that makes the text feel illuminated rather
  than obscured.
- The text INSIDE the highlight receives a micro-enhancement — it is fractionally
  heavier in weight and richer in color.

The effect is: highlighted text feels MORE readable, not just differently colored.

### Color Lenses — Four Distinct Aesthetics

Each lens color is a different quality of light. They share the same glass/glow
character but are lit differently.

**Amber Lens (Yellow)**
Warm. Soft warm gold wash, inner glow in the amber family.
Light mode text: charcoal → near-black with a very slight warm undertone.
Dark mode text: cool white → slightly warmer white, fractionally brighter.

**Sapphire Lens (Blue)**
Cool and focused. A clear cool-blue wash, crisp inner glow.
Light mode text: charcoal → near-black with slight cool undertone.
Dark mode text: matches the existing sky-blue text palette, brighter luminance.

**Verdant Lens (Green)**
Natural, organic. A muted sage or forest green wash, softer glow.
Light mode text: charcoal → near-black with very subtle warm green undertone.
Dark mode text: cool white → fractionally brighter, slight green luminance shift.

**Ember Lens (Red)**
Intense, urgent. A warm amber-to-red wash, a more distinct inner glow.
Light mode text: charcoal → darker black, slightly heavier weight than other lenses.
Dark mode text: cool white → brighter white, slight orange-warm shift at the edge.

### CSS Implementation

Highlights are applied via EPUB.js annotations:
`rendition.annotations.highlight(cfiRange, data, callback, cssClassName)`

The CSS class is injected into the EPUB.js iframe via:
`rendition.themes.default({ ".lumina-hl-amber": { ... }, ... })`

Each lens color is a separate CSS class with:
- `background`: a gradient or solid with appropriate opacity (not flat)
- `border-radius`: softened to avoid hard rectangular edges
- `box-shadow`: inset glow (subtle — not neon)
- `color`: text color enhancement (fractionally richer/darker/brighter)
- `font-weight`: fractional increase (e.g., 400 → 450 if variable font; or subtle letter-spacing)
- Possible: `text-shadow` for a subtle luminous quality on dark mode

The lens aesthetic should be developed by visually testing CSS in isolation
(an HTML test file with sample text) before wiring into the EPUB renderer.
The goal is to find the minimum CSS that achieves the desired effect — 
lens/glow qualities tend to get over-engineered.

### Highlight Creation — Interaction Model

**Desktop (mouse):**
1. User selects text
2. Color picker appears near the selection (small floating chip, not a big modal)
3. User clicks a lens color swatch
4. Highlight is applied and persisted

**Tablet/Mobile (touch):**
1. User long-presses or double-taps to initiate text selection
2. System text selection handles appear
3. A color picker chip appears above/below the selection
4. User taps a lens color swatch
5. Highlight is applied and persisted

**Color Picker Design:**
- Four circular swatches showing the lens colors (small, approximately 28-32px)
- No labels — the colors are self-explanatory after brief use
- Positioned to not obscure the selected text
- Dismisses if the user taps elsewhere

### Highlight Persistence

Highlights are persisted immediately on creation via the storage adapter.
On book open, all saved highlights for the book are loaded into the annotation store
and re-applied to the rendition via `rendition.annotations.highlight()` after each
section renders (this already exists in the codebase via the `rendered` event).

The lens CSS classes must be present in the rendition theme at all times so that
re-applied highlights render correctly on every section load.

### Editing and Deleting Highlights

- Long-press (tablet) or right-click (desktop) on a highlighted region opens a
  context menu: Change Color | Remove Highlight | Add Note
- The same gesture on the annotation in the drawer: Navigate | Edit Note | Remove

### Highlight Data Model

Each highlight stores:
```
{
  id: string
  bookId: string
  cfiRange: string          // EPUB CFI — the canonical location reference
  color: "amber"|"sapphire"|"verdant"|"ember"
  selectedText: string      // The text content of the selection
  chapterId: string
  chapterTitle: string
  chapterIndex: number
  createdAt: string         // ISO timestamp
  wordOffset: number        // approximate word position in book (for sorting)
}
```

---

## FEATURE: ANNOTATIONS DRAWER — HIGHLIGHTS SUB-VIEW

### Layout

The Highlights sub-view inside the feature drawer:

```
┌─────────────────────────────────────────┐
│  ← Highlights              [×]          │
├─────────────────────────────────────────┤
│  🔍 [Search highlights and book...]  ◉  │  ← ◉ = filter bubble
├─────────────────────────────────────────┤
│                                         │
│  Chapter 1 · The Gathering Storm    (3) │
│  ─────────────────────────────────────  │
│  [amber] "The wind came cold across…"   │
│  [sapphire] "Kael tightened his cloak…" │
│  [ember] "Before him, the mountains…"  │
│                                         │
│  Chapter 3 · The Old King           (1) │
│  ─────────────────────────────────────  │
│  [verdant] "Victory had cost him…"      │
│                                         │
│  (etc.)                                 │
└─────────────────────────────────────────┘
```

### Search Bar

The search field searches the ENTIRE book — not just highlights.
It uses EPUB.js's spine-search capability to find passages by text.

Behavior:
- Typing shows results from the full book text, highlighted passages prominently
- Results show: the matching excerpt, the chapter it's in, and whether it
  is highlighted (if so, the lens color is shown as a small swatch)

### Filter Bubble

The filter bubble (◉) sits to the right of the search bar. It is small and minimal.
Tapping it opens a compact filter selector panel (not a full modal):

**Current filter option:**
- "Highlighted passages only" — toggles search to only show results from highlighted text

**Filter selector design:**
- A small popover/sheet with toggle rows
- Each filter has a label and a toggle
- The bubble changes appearance (filled vs outline) to indicate active filters
- Future filter rows can be added here: by date added, by lens color, by chapter

When a filter is active, the search bar shows a subtle indicator (the bubble is lit/colored).

### Highlight Cards

Each highlight in the list is a card showing:
- A thin left border in the lens color (amber/sapphire/verdant/ember)
- The selected text excerpt (truncated at ~80 characters with "…" if longer)
- The chapter name and a position indicator
- A note icon (small) if a note is attached to this highlight

Tapping a card:
- Navigates to the highlight location in the reader
- OPEN QUESTION: does the drawer stay open (reader compresses) or close?
  Default recommendation: drawer stays open, reader jumps to location.
  The reader can dismiss the drawer manually if they want full reading view.

Long-pressing a card:
- Options: Navigate | Change color | Add/edit note | Remove

### Organization

Highlights are grouped by chapter, sorted by reading order (word position) within each chapter.
Chapter groups collapse/expand (tapping the chapter header collapses that group).
An empty state message when no highlights exist: "Select any text while reading to highlight it."

---

## FEATURE: ANNOTATIONS DRAWER — NOTES SUB-VIEW

### Concept

A note is a standalone artifact. It is a thought, observation, or annotation
written by the reader. It exists at a location in the book and can optionally
be linked to one or more highlights.

Three note origins:
1. Created FROM a highlight (most common) — note inherits the highlight's location
   and is displayed with the source text
2. Created at current reading position — no text selected, just a thought at a location
3. Linked to an existing highlight after the fact — from within the note editor

### Notes Sub-View Layout

```
┌─────────────────────────────────────────┐
│  ← Notes                  [+ New] [×]  │
├─────────────────────────────────────────┤
│  🔍 [Search notes...]                   │
├─────────────────────────────────────────┤
│                                         │
│  Chapter 1 · The Gathering Storm    (2) │
│  ─────────────────────────────────────  │
│  [amber] "The wind came cold…"          │
│           Note: The opening sets a      │
│           tone of isolation that…       │
│                                         │
│  Chapter 3 · The Old King           (1) │
│  ─────────────────────────────────────  │
│  ◎ [no highlight]                       │
│           Note: The parallel between    │
│           this king and the one in…     │
│                                         │
└─────────────────────────────────────────┘
```

Notes that are linked to a highlight show the source text in the lens color family.
Notes with no highlight link show a neutral location indicator (◎) with the chapter
and approximate position.

### Note Creation Flow

**From a highlight:**
After a highlight is created (user selected color from color picker), a gentle prompt
appears — a small "add note" affordance either in the color picker or as a follow-up
chip that appears briefly. This should be dismissable with zero friction (tap anywhere
to skip). The note is optional.

If the user taps the note prompt:
- A compact text entry panel slides up (bottom sheet on tablet, inline panel on desktop)
- Text field, character count (optional — generous limit ~2000 chars)
- Save / Dismiss
- Note is linked to the highlight automatically

**From current position (no highlight):**
The [+ New] button in the Notes sub-view header creates a standalone note
stamped at the reader's current position. The reader does NOT need to select text.

**Linking a note to an additional highlight:**
Inside the note editor, an "Add source" button opens a compact highlight picker
showing the reader's existing highlights. They can link the note to multiple highlights.
This is a secondary feature and should be visually subtle — not prominent in the main UI.

### Note Data Model

```
{
  id: string
  bookId: string
  noteText: string
  createdAt: string
  updatedAt: string
  locationBookId: string      // book position where note was written
  locationChapterId: string
  locationChapterTitle: string
  locationWordOffset: number
  linkedHighlightIds: string[] // 0 to many highlight IDs
  isPinned: boolean            // future: allow pinning important notes
}
```

The separation of `linkedHighlightIds` (array) from the note's own location
`locationChapterId/wordOffset` is intentional. The note's location is where the reader
WAS when they wrote it. The linked highlights are what the note is ABOUT.
These may be different locations if the note was written while thinking about
a passage from earlier in the book.

### Note Display in the Highlights Sub-View

When a highlight has an associated note, the note text appears beneath the highlight
card (collapsed by default — a "1 note" chip that expands on tap). This prevents the
Highlights view from becoming a wall of text while still surfacing that notes exist.

### Search in Notes

The search bar in the Notes sub-view searches:
- Note text content
- The source highlight text (if linked)
- Chapter titles

---

## SOUND STUDIO — SETTINGS FEATURE

### Placement

Sound Studio lives in Settings. It is NOT in the feature drawer.
It is a reading preference, not a content feature.

In the Settings panel, Sound Studio appears as its own section with:
- A master toggle (off by default)
- When enabled: mood category selector and volume control become visible
- The section is collapsed/minimal when disabled

### Behavior When Enabled

When Sound Studio is enabled, a minimal persistent audio control appears
at the bottom of the reading interface (small, unobtrusive — a play/pause button
and a volume slider). This is the only visible indicator that Sound Studio is on.

The audio does not autoplay. The reader manually starts playback.
Once started, it continues until manually stopped, the app closes, or the reader
moves to a very different emotional section (optional auto-mood-shift).

### Mood Categories

Lumina already has emotional arc data from the semantic analysis.
Sound Studio uses this to suggest a starting mood, but the reader can override.

Categories (these map to Freesound.org search terms and tags):
- Contemplative (quiet, sparse, ambient)
- Tense (low drones, dissonance, suspense)
- Expansive (orchestral, epic, wide)
- Melancholic (minor key, slow, introspective)
- Mysterious (atmospheric, textural, ambiguous)
- Triumphant (full orchestral, resolving, bright)

The suggestion logic: take the arc shape and dominant emotions from the semantic map
for the current section and map them to the closest mood category.
The reader can tap the mood chip to cycle through other categories manually.

### Audio Source

Primary source: **Freesound.org Public API**
- Free to use with API key registration (another BYOK entry in Settings)
- Massive CC-licensed ambient/atmospheric library
- API supports search by mood, duration, tags
- Returns preview URLs that can be fetched and played directly
- Rate limited but generous for personal use

Freesound API key is entered in Settings → Sound Studio section.
If no key is entered, Sound Studio shows a "Get a free Freesound key" link.

Fallback: a small set of royalty-free ambient tracks bundled with the app
(a few short loops that can tile) for offline use or before the API key is entered.

### Track Behavior

- Tracks play in sequence (next track auto-advances when current ends)
- Tracks are long (prefer ambient pieces > 3 minutes, filter by duration)
- Crossfade between tracks (1-2 second fade, seamless)
- Tracks shuffle within the current mood category
- The reader can skip to next track manually
- Volume is independent from system volume (soft default, ~40%)

### Technical Notes

- Audio plays via the Web Audio API in the PWA and a standard HTML audio element
- Freesound returns audio files as URLs — these are fetched and played directly
- Track metadata (name, artist, license) is stored so it can be displayed (attribution)
- The Freesound API response includes a CC license URL — attribution must be displayed
  somewhere accessible (a small info chip that expands to show it is sufficient)

---

## IMPLEMENTATION ORDER

Build in this sequence. Each feature depends on the previous being stable.

### Phase A — Glass Lens Highlighting

1. Design and validate the lens CSS in isolation (HTML test file, four colors)
2. Replace flat highlight classes in EpubRenderer with lens classes
3. Update the color picker to show lens swatches (not flat color chips)
4. Verify highlight persistence and re-application on section load
5. Update the annotation store color type if needed ("amber"|"sapphire"|"verdant"|"ember")
6. Test in light mode AND dark mode — both must look intentional

### Phase B — Feature Drawer + Highlights Sub-View

1. Build the Feature Drawer shell: slide-in from right, Feature Menu (Level 1)
2. Wire the summoning trigger (icon in side rail / top nav)
3. Build the Highlights Sub-View (Level 2): chapter-grouped list, highlight cards
4. Add navigation: tap a highlight card → jump to location in reader
5. Add search bar: full-book search with filter bubble
6. Add filter bubble: "highlighted passages only" toggle
7. Wire the drawer state persistence (remembers last open sub-view)

### Phase C — Notes

1. Add note creation from highlight (post-highlight note prompt)
2. Add note creation from current position (+ New in Notes sub-view)
3. Build the Notes Sub-View in the feature drawer
4. Display notes with source text context (from linked highlight)
5. Add note editing (tap note in drawer → edit inline or in a sheet)
6. Add note deletion
7. Add search to Notes sub-view

### Phase D — Sound Studio

1. Settings section: Sound Studio toggle (default off)
2. Freesound API key input in Settings → Sound Studio
3. Mood category selector (6 categories)
4. Audio playback engine (Web Audio / HTML audio)
5. Freesound API integration: search by mood/duration, retrieve preview URL
6. Persistent audio control in the reading interface (play/pause, volume, skip)
7. Mood auto-suggestion from semantic map arc data
8. Attribution display (CC license chip)
9. Bundled fallback tracks for offline use

---

## OPEN QUESTIONS (TO RESOLVE DURING BUILDING, NOT BEFORE)

1. **Drawer navigation on tap:** When a highlight card is tapped and the reader
   jumps to that location, does the drawer stay open or close?
   Default implementation: stays open. Revisit based on feel during testing.

2. **Lens color names:** Are "amber / sapphire / verdant / ember" the right names
   in the UI, or should they be presented as purely visual swatches with no text labels?
   Recommendation: swatches only in the color picker, color names only in the drawer
   filter (for accessibility and clarity).

3. **Note prompt timing:** After a highlight is created, how long does the "add note"
   prompt linger before auto-dismissing? Recommendation: 4 seconds, then fades out.
   The reader can also access "add note" from the drawer at any time.

4. **Sound auto-mood-shift:** Should Sound Studio automatically switch mood categories
   when the reader's position crosses into a new emotional section?
   Recommendation: opt-in (a toggle in the Sound Studio settings section).
   Default off — automatic shifts can be jarring.

5. **Standalone note location:** When a standalone note (no highlight link) is created
   at the reader's current position, does it appear in the Highlights sub-view too,
   or only in Notes? Recommendation: Notes sub-view only, but it appears inline in
   the reader as a small margin indicator (a dot or icon in the gutter).

---

## CONSTANTS TO ADD TO config.ts

```typescript
// Highlighting
NOTE_PROMPT_LINGER_MS: 4000,
HIGHLIGHT_COLORS: ["amber", "sapphire", "verdant", "ember"] as const,

// Sound Studio
SOUND_DEFAULT_VOLUME: 0.4,
SOUND_CROSSFADE_MS: 1500,
SOUND_MIN_DURATION_SECONDS: 180,  // prefer tracks > 3 minutes
FREESOUND_BASE: "https://freesound.org/apiv2",

// Drawer
DRAWER_WIDTH_PX: 340,
DRAWER_ANIMATION_MS: 280,
```

---

*End of PLANiv — Reading Surface, Knowledge Layer, and Atmosphere Layer*
*Reference this document during Phases A, B, C, and D.*
*Do not summarize — read fully before building any section.*
