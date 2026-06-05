# PLANiv — Reading Surface, Knowledge Layer, and Atmosphere Layer
# Glass Lens Highlighting · Main Drawer · Glossary · Notepad · Sunburst · Sound Studio

---

## CONTEXT AND PHILOSOPHY

This plan governs the next phase of Lumina development. It covers three feature groups
that were conceived together and must be built so that each new feature has a clean,
predictable home — so that future additions never require re-architecting what exists.

### The Three Layers

Every feature in Lumina belongs to exactly one of three conceptual layers. This is the
permanent organizing principle. When a new feature is proposed, the first question is
always: which layer does it live in? That answer determines its interaction model, its
persistence strategy, and where its UI lives.

**Reading Surface** — What happens inside the text itself.
Direct interaction with the rendered book content. Highlighting is the primary citizen.
Future surface features: inline dictionary, translation, text-to-speech triggers.

**Knowledge Layer** — What the reader accumulates from what they have read.
Reached through the Main Drawer. Highlights (as a glossary), notes (as a notepad).
Future knowledge features: tags, collections, export to Markdown/PDF, sharing.

**Atmosphere Layer** — What surrounds and enhances the reading experience.
Visual imagery is already built. Sound Studio is the next member. Lives in Settings,
not the drawer, because it is a reading preference rather than accumulated content.
Future atmosphere features: adaptive lighting, haptic patterns on mobile.

Keeping these three layers conceptually separate is what prevents feature sprawl from
bleeding one concern into another as the app grows.

---

# PART ONE — THE KNOWLEDGE LAYER

The Knowledge Layer is the most structurally important part of this plan because it
introduces the navigation model that all future accumulated-content features will use.
It must be designed carefully. Read this entire part before building any of it.

## THE MAIN DRAWER — A NAVIGATION HUB, NOT A CONTENT SURFACE

### What it is

The Main Drawer is a slim panel that slides in from the right when summoned. It is a
**pure navigation hub**. It contains buttons and nothing else. It does not list
highlights. It does not list notes. It does not display any accumulated content of its
own. Its only job is to be the launch point for the features of the Knowledge Layer.

This is the critical correction to the earlier design: the Main Drawer is a menu of
destinations, not a container of entries.

### What it contains

A small set of large, clearly-labeled buttons — each one opening a distinct feature
experience. At launch:

- **Highlights** — opens the Glossary
- **Notes** — opens the Notepad

Room is intentionally left below these for future buttons (Collections, Tags, Export,
and so on). Each future Knowledge Layer feature adds exactly one button here and one
destination experience. The Main Drawer never becomes crowded with content; it only
ever grows by a button at a time.

### Button design

Each button is a full-width tappable row inside the drawer:
- An icon on the left (a lens/marker glyph for Highlights, a page/pen glyph for Notes)
- The feature name
- An optional count badge on the right (e.g., the number of highlights in the current book)
- A subtle chevron or affordance indicating it opens into something

The buttons are generously sized — comfortable for touch on a tablet, not cramped.

### Summoning and dismissing

The Main Drawer is summoned via a dedicated icon in the side rail (desktop and tablet
landscape) or a bottom-bar icon (tablet portrait). It is never opened automatically.

Dismiss via: the X in the drawer header, tapping outside the drawer (touch), a keyboard
shortcut (desktop), or swiping the drawer rightward (touch).

### What the Main Drawer does NOT do

It does not stay open while you read a passage. It does not display highlight text. It
does not display note text. The moment you choose a destination (Highlights or Notes),
you leave the Main Drawer and enter that feature's own experience. The Main Drawer is a
threshold, not a room.

---

## DESTINATION ONE — THE GLOSSARY (Highlights)

### What it is

Tapping **Highlights** in the Main Drawer opens the Glossary. The Glossary is a
reference view of every highlight in the current book, organized exactly like a
glossary or index — **grouped by chapter, in reading order within each chapter.**

The mental model is deliberately bookish: this is the back-of-the-book index of the
passages that mattered to you.

### Layout

```
┌─────────────────────────────────────────┐
│  ←            Glossary             [×]  │
├─────────────────────────────────────────┤
│  🔍 [ Search the book… ]            ◉   │   ◉ = filter bubble
├─────────────────────────────────────────┤
│                                         │
│   CHAPTER 1 · The Gathering Storm   (3) │
│   ───────────────────────────────────   │
│   ▎ "The wind came cold across the…"    │   ▎ = amber lens edge
│   ▎ "Kael tightened his cloak and…"  ◔  │   ◔ = has notes indicator
│   ▎ "Before him, the mountains…"        │
│                                         │
│   CHAPTER 3 · The Old King          (1) │
│   ───────────────────────────────────   │
│   ▎ "Victory had cost him his sons." ◔◔ │   two notes
│                                         │
└─────────────────────────────────────────┘
```

### Glossary entries

Each entry is a card representing one highlight:
- A thin left edge in the highlight's lens color (amber / sapphire / verdant / ember)
- The highlighted text, truncated around 80 characters with an ellipsis
- A small notes indicator if one or more notes are attached (e.g., a single dot, or a
  count of dots up to a small max, then "◔ 3")

Entries are grouped under collapsible chapter headers. Each chapter header shows the
chapter title and a count of highlights in that chapter. Tapping a chapter header
collapses or expands that group.

### Tapping a glossary entry — the core behavior

When the reader taps a glossary entry:

1. **The Main Drawer / Glossary closes completely.** (Confirmed: it closes. The reader
   wants to read, not split attention between a list and the book.)
2. The reader navigates to the highlighted passage. The passage is brought into view —
   positioned in the upper-to-middle region of the reader so it is unmistakably visible
   and there is room below it for the note tray.
3. If the highlight has one or more attached notes, the **Passage Note Tray** slides up
   from the bottom of the reader (see next section).
4. If the highlight has no notes, nothing else happens — the reader simply lands at the
   passage, quietly.

### Search

The search field at the top of the Glossary searches the **entire book**, not just the
highlights. It uses EPUB.js spine search. Results show matching passages with their
chapter context. Passages that are highlighted are flagged with their lens color swatch.

### The filter bubble

The small filter bubble (◉) sits to the right of the search field. Tapping it opens a
compact filter popover — not a full modal — with toggle rows.

At launch, one filter:
- **Highlighted passages only** — restricts search results to highlighted text

The bubble's appearance changes (filled vs. outline, or a small color accent) when any
filter is active, so the reader always knows the search is constrained. Future filters
(by lens color, by date, by "has notes") are added as additional toggle rows here
without any change to the surrounding UI.

### Empty state

If the book has no highlights: a quiet message — "Highlight any passage while reading,
and it will appear here." No clutter.

---

## THE PASSAGE NOTE TRAY — surfacing notes attached to a highlight

### The problem it solves

A highlighted passage may have zero, one, or several notes attached to it. (A long
passage spanning two pages might have accumulated three or four separate thoughts over
multiple readings.) These notes must surface naturally when the reader arrives at the
passage — without covering the passage, without overwhelming the reader, and without
breaking the flow of being in the book.

### The strategy

A slim tray slides up from the bottom edge of the reader. It floats over the lower
portion of the reading area. It never pushes the text up and never covers the
highlighted passage, which is why navigation positions the passage in the upper-middle
of the view.

### Tray anatomy

```
        ┌───────────────────────────────────────┐
        │   the highlighted passage stays        │
        │   visible up here in the reader        │
        │                                        │
        │                                        │
        ├────────────────────────────────────────┤  ← tray top edge
        │  ◔  Note                       1 of 3  │
        │  "The opening sets a tone of isolation │
        │   that the whole first act sustains…"  │
        │                            ‹    ›   [×] │
        └────────────────────────────────────────┘
```

- A small header line: a note glyph, the word "Note", and — if there are multiple —
  a "1 of N" position indicator.
- A preview of the note's text — the first line or two, the way a message preview reads.
- If multiple notes exist: left/right chevrons (‹ ›) to page through them one at a time.
  Each chevron press swaps the preview to the next/previous note. No scrolling stack,
  no chaos — one note at a time, sequenced.
- A close affordance (×) that dismisses the tray and returns to plain reading.

### Expanding a note from the tray

Tapping the tray preview (or an explicit expand affordance) opens the **Sunburst Note
Screen** for that note, as an overlay on top of the reader. Closing the Sunburst returns
the reader to the tray and the passage — not all the way out to a list. (See the
Sunburst section for the two-context close behavior.)

### No-notes case

If the highlight the reader navigated to has no notes, the tray does not appear at all.
There is no empty tray. The reader just lands on the passage.

---

## DESTINATION TWO — THE NOTEPAD (Notes)

### What it is

Tapping **Notes** in the Main Drawer opens the Notepad. The Notepad is the directory of
every note the reader has written in the current book. It is a list — a place to browse,
search, and choose a note to read. It is NOT where a note is read in full; that is the
Sunburst's job. The Notepad is the table of contents for your own thoughts.

### Organization — dual view

Notes have a dual nature. Some are about a specific highlighted passage (and belong, in
the reader's mind, to a chapter). Others are free-floating thoughts written at a moment
in the reading. To honor both, the Notepad supports **two organizations the reader can
toggle between**:

- **By Chapter** (default) — notes grouped under chapter headers, mirroring the Glossary.
  A note linked to a highlight files under that highlight's chapter. A standalone note
  files under the chapter the reader was in when they wrote it.
- **By Time** (journal) — all notes in reverse-chronological order, most recent first,
  like a running journal of thoughts as they occurred.

A small segmented toggle at the top of the Notepad switches between the two. Default is
By Chapter, to stay consistent with the Glossary's bookish logic. The reader's choice is
remembered.

### Layout

```
┌─────────────────────────────────────────┐
│  ←            Notepad         [+]  [×]  │   [+] = new standalone note
├─────────────────────────────────────────┤
│  🔍 [ Search notes… ]                   │
│  ┌─────────────┬─────────────┐          │
│  │ By Chapter ●│  By Time     │          │   segmented toggle
│  └─────────────┴─────────────┘          │
├─────────────────────────────────────────┤
│                                         │
│   CHAPTER 1 · The Gathering Storm       │
│   ───────────────────────────────────   │
│   ▎ "The wind came cold…"               │   linked-highlight source (lens edge)
│      The opening sets a tone of…        │   note preview
│                                         │
│   CHAPTER 3 · The Old King              │
│   ───────────────────────────────────   │
│   ◎ written here                        │   standalone note (no highlight)
│      The parallel between this king…    │
│                                         │
└─────────────────────────────────────────┘
```

### Notepad entries

Each entry is a card:
- If the note is linked to a highlight: a lens-colored edge and the source highlight
  text shown small above the note preview.
- If the note is standalone: a neutral "written here" location marker (◎) with the
  chapter and approximate position, above the note preview.
- The note preview: first line or two of the note text.

Tapping an entry opens the **Sunburst Note Screen** for that note.

### Search

The Notepad search field searches note text, linked source-highlight text, and chapter
titles.

### New note from the Notepad

The [+] in the Notepad header creates a new standalone note, stamped at the reader's
current position in the book. The reader does not need to have selected any text. This
opens directly into the Sunburst in an editable state.

### Back behavior

The Notepad has a back affordance (←) that returns to the Main Drawer — because the
reader came from the drawer and may want to visit another destination. (Contrast with
tapping a glossary entry, which closes everything and returns to the book.)

---

## THE SUNBURST NOTE SCREEN — how a note is read

### What it is

The Sunburst is the dedicated visual space in which a single note is read in full. It is
not the reader. It is not the Notepad. It is its own screen — a deliberate, atmospheric
environment for one thought at a time.

### The visual

A dark radial field. The note's text lives in the solid dark center of the field. Moving
outward from the text toward the edges of the screen, the darkness fades through three
zones:

- **Center (solid):** Full opacity darkness. The text sits here, fully legible, resting
  on solid ground.
- **Mid (opaque → translucent):** The darkness thins. A gradient transition.
- **Edge (transparent):** At the periphery the field becomes transparent, and whatever
  was behind the Sunburst — the reader, or the Notepad — bleeds faintly through.

The effect: the note floats in its own pocket of darkness, focused and quiet, yet not
severed from the world it came from. The book (or the list) glows faintly at the rim.

Implementation note: this is a radial gradient overlay (a dark center fading to
transparent at the edges) layered above the underlying screen, with the note text
composited in the solid center region. The exact gradient stops and the text's maximum
width within the solid zone should be tuned visually in isolation before integration.
The text must always remain within the fully-solid central region so it never loses
legibility against the fading background.

### Reading and editing

- The note text is displayed as the primary, central element — comfortable reading size,
  generous line height.
- An edit affordance turns the text into an editable field in place (the Sunburst
  becomes an editor without changing screens). Save and dismiss controls appear.
- A source affordance (subtle) shows what the note is linked to: the highlighted
  passage(s), if any. Tapping a source could navigate the reader there (closing the
  Sunburst and going to the book). "Add source" lets the reader link the note to an
  additional existing highlight.

### The two close contexts — IMPORTANT

The Sunburst is reached from two different places, and its close behavior differs by
origin. This must be tracked explicitly (a small navigation-origin flag) so it never
becomes a bug.

**Context A — opened from the book (via the Passage Note Tray).**
The reader was reading, navigated to a highlighted passage, and expanded a note from the
tray. Closing the Sunburst returns to the **reader**, with the passage still in view and
the tray still present. The reader never loses their place in the book.

**Context B — opened from the Notepad.**
The reader was browsing the Notepad and tapped a note. Closing the Sunburst returns to
the **Notepad list**, so they can continue browsing or open another note.

The Sunburst itself is identical in both contexts. Only the return destination differs.
A simple origin marker carried when the Sunburst is opened ("from-tray" vs
"from-notepad") drives the close behavior.

---

## NOTE CREATION FLOWS (all paths)

There are three ways a note comes into existence. All three must feel natural.

**1. From a highlight (most common).**
After the reader creates a highlight (selects text, picks a lens color), a gentle,
low-friction "add note" prompt appears briefly near the selection. Tapping it opens a
compact note editor (a bottom sheet on tablet, an inline panel on desktop) pre-linked to
that highlight. Ignoring it (tapping anywhere else, or letting it fade after a few
seconds) simply means no note — the highlight stands alone. The note can always be added
later from the Glossary.

**2. Standalone, from the Notepad.**
The [+] button in the Notepad creates a note stamped at the reader's current position,
with no highlight link. Opens into the Sunburst in editable state.

**3. Retroactively linked.**
From within the Sunburst's source affordance, "Add source" lets the reader link the note
to one or more existing highlights after the fact. This supports the case where a thought
relates to a passage highlighted earlier and the one being read now. This is a secondary,
subtle feature — not prominent, but present.

---

## DATA MODELS (Knowledge Layer)

### Highlight

```
{
  id: string
  bookId: string
  cfiRange: string            // EPUB CFI — canonical location reference
  color: "amber" | "sapphire" | "verdant" | "ember"
  selectedText: string
  chapterId: string
  chapterTitle: string
  chapterIndex: number
  wordOffset: number          // approximate book word position (for sorting)
  createdAt: string           // ISO timestamp
}
```

### Note

```
{
  id: string
  bookId: string
  noteText: string
  createdAt: string
  updatedAt: string

  // Where the reader WAS when the note was written (its own location):
  locationChapterId: string
  locationChapterTitle: string
  locationChapterIndex: number
  locationWordOffset: number

  // What the note is ABOUT (zero to many highlights):
  linkedHighlightIds: string[]
}
```

The deliberate separation between a note's own `location*` fields and its
`linkedHighlightIds` array is what makes the whole notes system coherent. The location
is where the thought was born; the links are what the thought concerns. They are often
the same place but need not be — and a single note can concern several passages.

### Derived relationships (not stored, computed)

- "Notes attached to highlight H" = all notes whose `linkedHighlightIds` includes H.id.
  This is what the Passage Note Tray queries when the reader lands on a highlight.
- "Notes in chapter C" (for the By-Chapter Notepad view) = notes whose
  `locationChapterId` is C, OR notes linked to a highlight whose `chapterId` is C.
  (A linked note files under its source's chapter; a standalone note files under where
  it was written.)

---

## NAVIGATION STACK SUMMARY (Knowledge Layer)

To keep the close/back behaviors unambiguous, here is the full navigation model in one
place. Every transition below must behave exactly as stated.

```
Reader (the book)
  │  summon
  ▼
Main Drawer  ── tap Highlights ─▶  Glossary
  │                                   │  tap entry
  │                                   ▼
  │                            (Glossary closes)
  │                                   ▼
  │                            Reader @ passage
  │                                   │  (if notes) tray slides up
  │                                   ▼
  │                            Passage Note Tray
  │                                   │  expand
  │                                   ▼
  │                            Sunburst (Context A)
  │                                   │  close
  │                                   ▼
  │                            back to Reader + tray + passage
  │
  └── tap Notes ─▶  Notepad
                      │  tap entry              │  back (←)
                      ▼                         ▼
                   Sunburst (Context B)      Main Drawer
                      │  close
                      ▼
                   back to Notepad list
```

Key rules:
- Tapping a **Glossary** entry CLOSES the drawer and returns to the book.
- The **Notepad** back button returns to the Main Drawer (the reader came from there).
- The **Sunburst** close returns to wherever it was opened from (tray → reader;
  notepad → notepad), governed by the origin flag.

---

# PART TWO — THE READING SURFACE: GLASS LENS HIGHLIGHTING

### Concept

A highlight in Lumina is not a colored rectangle laid over text. It is a quality of
attention — a lens that focuses the eye. The text inside a highlight should feel MORE
readable, not merely tinted.

The highlight does two things at once:
- The container (the mark element) carries a glass/lens aesthetic: a soft, semi-
  transparent wash in the color family, gently feathered edges, and a barely-perceptible
  inner glow that makes the text feel illuminated rather than obscured.
- The text inside receives a micro-enhancement: fractionally heavier weight and a richer,
  more saturated/contrasted color value.

### The four lenses — distinct qualities of light

All four share the same glass/glow character but are lit differently. They should feel
like the same kind of object under four different lights.

**Amber Lens (warm gold)**
Soft warm-gold wash, amber inner glow.
Light mode text: charcoal → near-black with a faint warm undertone.
Dark mode text: the existing sky-blue/white text → fractionally brighter and warmer.

**Sapphire Lens (cool blue)**
Clear cool-blue wash, crisp inner glow.
Light mode text: charcoal → near-black with a faint cool undertone.
Dark mode text: aligns to the sky-blue text palette, raised in luminance.

**Verdant Lens (sage/forest green)**
Muted natural-green wash, softer glow.
Light mode text: charcoal → near-black, very subtle green-warm undertone.
Dark mode text: → fractionally brighter, slight green luminance lift.

**Ember Lens (warm red)**
Warm amber-to-red wash, the most distinct inner glow of the four.
Light mode text: charcoal → darker black, marginally heavier weight than the others.
Dark mode text: → brighter white with a faint warm edge.

### Implementation

Highlights are applied through EPUB.js annotations:
`rendition.annotations.highlight(cfiRange, data, callback, cssClassName)`

The lens CSS classes are injected into the EPUB.js iframe via
`rendition.themes.default({ ".lumina-lens-amber": {…}, … })`. Each lens is one class:
- `background`: gradient or low-opacity fill (never a flat slab)
- `border-radius`: softened to avoid hard rectangular corners
- `box-shadow`: subtle inset glow (restrained — not neon)
- `color`: enhanced text color per mode
- `font-weight` / `letter-spacing`: a fractional enhancement for the "slightly bolder"
  feel (exact mechanism depends on the rendered font being variable or not)
- `text-shadow` (dark mode only, optional): a faint luminous lift

The lens aesthetic MUST be developed and approved in an isolated HTML test file
(sample paragraphs, all four colors, both light and dark mode) before being wired into
the renderer. Lens/glow effects are easy to over-engineer; the goal is the minimum CSS
that achieves the intended feeling.

### Open technical question to verify first

Confirm whether the glow can extend slightly beyond the text bounds within the EPUB.js
iframe, or whether iframe isolation constrains it to the mark element's box. If
constrained, the effect is achieved entirely within the box (inset glow, background,
text enhancement) — which is almost certainly sufficient. Verify before designing the
final visual.

### Creation interaction

**Desktop:** select text → a small floating chip of four lens swatches appears near the
selection → click a swatch → highlight applied and persisted.

**Tablet/touch:** long-press or double-tap to select → selection handles appear → a chip
of four lens swatches appears above/below the selection → tap a swatch → applied and
persisted.

The swatch chip is small (circles ~28–32px), label-free, positioned to not obscure the
selected text, and dismisses on outside tap.

### Persistence and re-application

Highlights persist immediately on creation via the storage adapter. On book open, all
highlights load into the annotation store and re-apply to the rendition via
`rendition.annotations.highlight()` after each section renders (the `rendered` event
mechanism already exists). The lens CSS classes must always be present in the rendition
theme so re-applied highlights render correctly on every section load.

### Edit / delete

Long-press (touch) or right-click (desktop) on a highlighted region opens a small
context menu: Change Lens | Remove Highlight | Add Note. The same actions are available
on the entry in the Glossary.

---

# PART THREE — THE ATMOSPHERE LAYER: SOUND STUDIO

### Placement

Sound Studio lives in **Settings**, not the Main Drawer. It is a reading preference, not
accumulated content. It is **toggled OFF by default** and can be toggled on or off at any
time.

In Settings it is its own section: a master toggle, and — when enabled — a mood selector,
volume control, and the Freesound API key field become visible. When disabled, the
section stays collapsed and minimal.

### Behavior when enabled

A minimal, persistent audio control appears at the bottom of the reading interface:
play/pause, volume, skip. It does not autoplay — the reader starts it manually. Once
playing, it continues until manually stopped, the app closes, or (optionally) the reader
crosses into a markedly different emotional section.

### Mood categories

Lumina already derives emotional arc data from semantic analysis. Sound Studio uses it to
suggest a starting mood, which the reader can override by cycling a mood chip.

Categories (mapped to Freesound search terms/tags):
- Contemplative (quiet, sparse, ambient)
- Tense (low drones, dissonance, suspense)
- Expansive (orchestral, epic, wide)
- Melancholic (minor key, slow, introspective)
- Mysterious (atmospheric, textural, ambiguous)
- Triumphant (full orchestral, resolving, bright)

### Audio source

Primary: **Freesound.org public API** — free with API key registration, a large
CC-licensed library strong on ambient/atmospheric/orchestral textures, searchable by
tag and duration, returning playable preview URLs. The Freesound key is entered in
Settings → Sound Studio (another BYOK entry). If no key is present, the section shows a
"Get a free Freesound key" link.

Fallback: a small set of bundled royalty-free ambient loops for offline use or before a
key is entered.

### Track behavior

Tracks play in sequence within the chosen mood, prefer longer ambient pieces (> ~3 min),
crossfade 1–2 seconds between tracks, shuffle within the mood, skip on demand, and start
at a soft default volume (~40%) independent of system volume. Track metadata (name,
attribution, CC license URL) is stored and surfaced via a small info/attribution chip,
as the licenses require.

### Technical notes

Playback via Web Audio API (PWA) / HTML audio element. Freesound returns file URLs that
are fetched and played directly. Attribution (CC license) must be displayed somewhere
accessible.

---

# IMPLEMENTATION ORDER

Build in sequence. Each phase should be stable before the next begins.

### Phase A — Glass Lens Highlighting (Reading Surface)
1. Design and approve lens CSS in an isolated HTML test file — four colors, light + dark.
2. Verify the iframe glow-extent question.
3. Replace existing flat highlight classes in EpubRenderer with the four lens classes.
4. Update the creation color picker to show the four lens swatches.
5. Confirm persistence and re-application on section load in both modes.
6. Update the color type to "amber" | "sapphire" | "verdant" | "ember" across the store
   and data model.

### Phase B — Main Drawer + Glossary (Knowledge Layer)
1. Build the Main Drawer shell: slide-in from right, navigation buttons only.
2. Wire the summon trigger (side rail / bottom bar) and dismiss behaviors.
3. Build the Glossary: chapter-grouped highlight list, lens-edged entry cards, notes
   indicators.
4. Implement tap-entry behavior: close drawer → navigate to passage (positioned upper-
   middle) in the reader.
5. Add the full-book search field and the filter bubble ("highlighted passages only").
6. Empty state.

### Phase C — Passage Note Tray + Notes data model
1. Define the Note data model and storage-adapter methods (save/load/update/delete,
   both Tauri and Web adapters).
2. Build the Passage Note Tray: slides up on arrival at a highlight that has notes;
   preview; "1 of N" paging with chevrons; close.
3. Wire the "notes attached to highlight" query.
4. No-notes case: tray does not appear.

### Phase D — Notepad + Sunburst
1. Build the Notepad: directory list, By Chapter / By Time toggle, search, [+] new note,
   back-to-drawer.
2. Build the Sunburst Note Screen: radial dark-to-transparent field, centered text,
   read + edit states, source affordance + "Add source".
3. Implement the two-context close (origin flag: from-tray → reader; from-notepad →
   notepad).
4. Wire all three note-creation flows (from highlight, standalone, retroactive link).

### Phase E — Sound Studio (Atmosphere Layer)
1. Settings section + master toggle (default off).
2. Freesound API key field (BYOK).
3. Mood selector (6 categories) + volume control.
4. Audio engine (Web Audio / HTML audio), crossfade, shuffle, skip.
5. Freesound integration: search by mood + duration, retrieve and play preview URLs.
6. Persistent reader audio control.
7. Mood auto-suggestion from semantic arc data (manual override always available).
8. Attribution chip; bundled offline fallback loops.

---

# RESOLVED DESIGN DECISIONS

- **Main Drawer is buttons only.** A navigation hub, not a content surface. New Knowledge
  Layer features each add one button + one destination.
- **Glossary entry tap closes everything and returns to the book**, landing on the
  passage with the note tray (if any).
- **Passage Note Tray** surfaces highlight-attached notes from the bottom, one at a time,
  with "1 of N" paging, never covering the passage.
- **Notepad is a directory**, not a reader. It offers By Chapter (default) and By Time
  views. Its back button returns to the Main Drawer.
- **Sunburst is the note-reading screen**, identical from both origins; close behavior is
  governed by an origin flag (tray → reader; notepad → notepad).
- **Sound Studio lives in Settings, off by default.**

# OPEN QUESTIONS (resolve during building, not before)

1. **Lens labels:** swatches only in the picker; color names only where text is needed
   (e.g., a future "by lens color" filter). Confirm naming amber/sapphire/verdant/ember
   reads well in the UI or should be purely visual.
2. **Note prompt linger:** how long the post-highlight "add note" prompt stays before
   fading. Start at ~4s.
3. **Sunburst gradient stops + max text width:** tune visually in isolation.
4. **Sound auto-mood-shift:** opt-in toggle, default off (automatic shifts can jar).
5. **Standalone note in-reader indicator:** whether a standalone note also shows as a
   small gutter mark at its location in the reader (recommended: yes, a subtle dot).

---

# CONSTANTS TO ADD TO config.ts

```
// Highlighting
HIGHLIGHT_COLORS: ["amber", "sapphire", "verdant", "ember"] as const,
NOTE_PROMPT_LINGER_MS: 4000,

// Drawer + Knowledge Layer
DRAWER_WIDTH_PX: 340,
DRAWER_ANIMATION_MS: 280,
PASSAGE_TRAY_ANIMATION_MS: 260,
PASSAGE_LAND_VERTICAL_BIAS: 0.33,   // place passage ~1/3 down the reader on navigate

// Sunburst
SUNBURST_SOLID_RADIUS_PCT: 42,      // % of field that stays fully solid (text zone)
SUNBURST_FADE_END_PCT: 100,         // where the field reaches full transparency

// Sound Studio
SOUND_DEFAULT_VOLUME: 0.4,
SOUND_CROSSFADE_MS: 1500,
SOUND_MIN_DURATION_SECONDS: 180,
FREESOUND_BASE: "https://freesound.org/apiv2",
```

---

*End of PLANiv — Reading Surface, Knowledge Layer, and Atmosphere Layer.*
*Reference this document fully during Phases A through E. Do not summarize before building.*
