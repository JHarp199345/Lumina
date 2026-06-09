# PLANix — Relational Networks
# Cross-book interconnecting notes: a localized knowledge graph, organized into reader-defined Networks

---

## THE IDEA (in the reader's words)

A reader highlights a passage in Book B and starts a note. Instead of a blank box, Lumina
surfaces notes they wrote weeks or months ago — while reading Book A — that are about the
same idea. The reader can append this new passage to an old note (which then remembers it
came from *both* books, with both passages and both books' metadata), or write a fresh one.

Over time, notes, highlights, books, and even generated assets (audio overviews,
presentation decks) chain together across the whole library. The reader groups these
chains into **Relational Networks** — each network is a body of interrelated thoughts,
ideas, and revelations that the reader builds up over time.

This is Lumina's answer to NotebookLM's notebooks. NotebookLM isolates context into rigid,
self-contained buckets. **Lumina organizes into Networks** — open, cross-document, evolving
graphs of thought that span the entire library.

---

## TWO REALITY CHECKS (corrections to the original spec — read first)

The conceptual brief assumed a Tauri Rust backend with local ONNX vector search and an
EPUB-CFI anchor model. Neither matches how Lumina actually runs today. The plan below
corrects both. These are not optional refinements — they are what makes the feature work
on the reader's actual device.

### 1. Semantic matching is Gemini embeddings + client-side cosine — NOT Rust/ONNX

The reader's primary runtime is the **web/PWA build** (the tablet). That build has **no Rust
backend and no SQLite** — persistence is IndexedDB via `WebStorageAdapter`. A Rust
`#[tauri::command]` vector search exists only on the desktop Tauri build, so it cannot be
the matching engine.

Instead:
- When a note (or highlight selection) is created, compute a **text embedding via the
  Gemini embedding API** (`text-embedding-004` / `gemini-embedding-001`) — one cheap call
  on the BYOK Google key already in use.
- Store the embedding vector **with the note** (a `Float32Array`/number[] field).
- Match by **cosine similarity computed in TypeScript**. A reader's note corpus is small
  (tens to low-hundreds of notes); brute-force cosine over a few hundred vectors is
  sub-millisecond. No vector DB, no ONNX, no native code.
- This is **runtime-agnostic**: identical logic on web and Tauri, routed through the
  `StorageAdapter`. Embeddings are cached so we never re-embed unchanged text.

Offline / no-key fallback: when no embeddings are available, fall back to a lightweight
keyword/tag overlap score so the carousel still surfaces *something* useful.

### 2. Provenance uses Lumina's real anchors — NOT EPUB CFI

On the structured web reader, `Highlight.cfiRange` is empty. The real, durable anchor is:
`locator` (`lumina://chapter/{ch}/page/{pg}`), `chapterIndex`, `chapterStartOffset`,
`chapterEndOffset`, plus the immutable `selectedText` quote. The provenance ledger stores
**these** (and the EPUB CFI too, when present on the desktop EPUB renderer), so a link can
always resolve back to the passage via the existing `luminaNavigate` window API.

---

## GOVERNING PRINCIPLE — THE NETWORK NEVER GATES THE BASELINE

The network is a **non-authoritative, progressively-enhancing overlay**, not a dependency.
This principle outranks every feature below it. Three consequences:

1. **It is both background structure and a surfaceable view.** By default the graph accretes
   invisibly as the reader uses the app. On demand it renders as a navigable web. Same data,
   two faces — never one or the other.

2. **Nothing requires it to exist.** Every experience that *can* be enhanced by the network
   has a complete baseline that works with an empty graph: search falls back to the existing
   library/archive indexes, the suggestion carousel falls back to just "＋ New Note," the
   reader falls back to today's per-book Notepad. Cold start is not an error state — it is the
   honest beginning, and it silently grows teeth as the corpus grows.

3. **Reliance scales with maturity.** The network's influence is *weighted by how much of it
   exists*. A 5-note library barely feels its hand; a 500-note library lets it genuinely
   govern. The reader earns the network's authority by building it through use — the app
   never pretends to know more than the data supports.

A reader who never builds a network still has the full Lumina they have today. A reader who
builds a deep one gets a second brain. There is no cliff between those states — only a slope.

---

## RELATIONSHIP TO WHAT EXISTS TODAY

| Today | Becomes |
|---|---|
| `Note { id, highlightId, bookId, noteText, sourceExcerpt }` — single book, single highlight | A **NetworkNote** with a **provenance ledger** of many (book, anchor, quote) links |
| Notes browsed per-book in the Notepad (drawer) | Notepad still works (filtered to the active book via provenance); a new **Networks** hub shows the cross-book graph |
| `SunburstNote.tsx` reads one note | Reused as the **Network visualizer** (hub = network, rings = books, sectors = notes, points = passages) |
| `audioOverview.ts` / `presentationStudio.ts` read one active book | Can target a **whole network** — pulling every provenance snapshot across books for a comparative synthesis |
| Highlight → SelectionActionBar → "Note" → Sunburst editor | Highlight → background semantic match → **film-strip carousel** of [New Note · suggested existing notes] → editor |
| Drawer views: menu/glossary/notepad/lens/study/voice/audio/presentation | + a **Networks** destination |

Nothing the reader has is lost: existing notes migrate into NetworkNotes (each with one
provenance link), highlights/notes/progress are untouched, and the per-book Notepad keeps
working.

---

## PART 1 — DATA MODEL

The model is **entity-agnostic and many-to-many**: a note can derive from several books;
a book can feed many notes; a network gathers notes + media assets across books.

### Conceptual entities

- **RelationalNetwork** — a reader-defined group: id, name, description, timestamps.
- **NetworkTag** — meta keywords on a network (semantic cluster identity).
- **NetworkNote** — the evolving knowledge node: id, networkId (nullable until filed),
  title, body, embedding vector, timestamps. (This supersedes today's `Note`.)
- **NoteProvenanceLink** — the ledger: every (book, anchor, quote) a note was built from.
  id, noteId, bookId, bookTitle, author, the Lumina anchor (locator + chapterIndex +
  offsets) and/or epubCfi, the immutable quote, linkedAt.
- **NetworkMediaAsset** — registry tying generated assets (audio overview, presentation
  deck) to a network: id, networkId, type, storage reference, source manifest, createdAt.

### TypeScript types (added to `src/types/index.ts`)

```ts
export interface RelationalNetwork {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NoteProvenanceLink {
  id: string;
  noteId: string;
  bookId: string;
  bookTitle: string;
  author?: string;
  // Lumina structured-reader anchor (primary on web):
  locator?: string;            // lumina://chapter/{ch}/page/{pg}
  chapterIndex?: number;
  chapterStartOffset?: number;
  chapterEndOffset?: number;
  cfiRange?: string;           // EPUB CFI (desktop EPUB renderer), when present
  highlightId?: string;        // the originating highlight, when there was one
  quote: string;               // immutable snapshot of the passage
  linkedAt: string;
}

export interface NetworkNote {
  id: string;
  networkId: string | null;    // null = unfiled (lives in the default/Inbox network)
  title: string;
  body: string;                // markdown
  embedding?: number[];        // cached text embedding for matching
  embeddingModel?: string;     // model id used, so stale embeddings can be recomputed
  createdAt: string;
  updatedAt: string;
}

export type NetworkMediaAssetType = "audio_overview" | "presentation_deck";

export interface NetworkMediaAsset {
  id: string;
  networkId: string;
  type: NetworkMediaAssetType;
  storageRef: string;          // artifact id / path the asset lives at
  sourceManifest?: string;     // the inputs passed to the generator
  createdAt: string;
}
```

### Storage (BOTH adapters, via `StorageAdapter`)

Follow the existing pattern (study guides, source profiles). Add to the interface and
implement in **both** `WebStorageAdapter` (new IndexedDB stores, DB version bump) and
`TauriStorageAdapter` + `services/db.ts` (new SQLite tables):

```
saveNetwork / loadNetworks / deleteNetwork
saveNetworkNote / loadNetworkNotes / loadNetworkNotesForBook / deleteNetworkNote
saveProvenanceLink / loadProvenanceForNote / loadProvenanceForBook / deleteProvenanceLink
saveNetworkMediaAsset / loadNetworkMediaAssets / deleteNetworkMediaAsset
loadAllNoteEmbeddings   // tiny projection {noteId, networkId, title, embedding} for matching
```

Tauri SQLite mirrors the spec's relational tables (`relational_networks`,
`network_cluster_tags`, `network_notes`, `note_provenance_links`, `network_media_assets`)
with `ON DELETE CASCADE`. Web stores keep the same shapes keyed by id, indexed by
`networkId` / `noteId` / `bookId`. Embeddings are stored as `number[]` (web) /
JSON (tauri).

### Migration from the current Note model

On first run after upgrade: for each existing `Note`, create a `NetworkNote` (body =
noteText, title = derived first line) with one `NoteProvenanceLink` reconstructed from its
`highlightId` → highlight anchor (or `sourceExcerpt`), `networkId = null` (Inbox). Keep the
old `Note` store readable for one version as a safety net; the Notepad reads NetworkNotes
going forward. No user data is lost; nothing is deleted on migration.

---

## PART 2 — THE SEMANTIC MATCH ENGINE

A new pipeline module `src/pipeline/noteMatching.ts` (runtime-agnostic, TS only):

```
embedText(text, apiKey) -> number[]        // Gemini embeddings, cached
cosine(a, b) -> number                      // standard cosine similarity
suggestRelatedNotes(selectionText, apiKey) -> RankedNote[]
  1. embed the selection (one cheap call; cache by text hash)
  2. load all note embeddings (storage.loadAllNoteEmbeddings) — small set
  3. cosine vs each; keep top N above a similarity floor
  4. return [{ note, networkId, networkName, score, snippet }]
keywordFallback(selectionText) -> RankedNote[]   // when embeddings unavailable
```

- **When notes are embedded:** at create/update time (debounced) and lazily backfilled for
  migrated notes the first time the network engine runs with a key present.
- **Similarity floor + count:** only surface genuinely related notes (e.g. cosine ≥ 0.78,
  top 5). Below the floor → the carousel shows only the "New Note" card.
- **Cost & privacy:** embedding is a small Google API call on the BYOK key; note text is
  sent to Google exactly as analysis text already is. Stated plainly in copy; works with
  no extra key. No embeddings → keyword fallback, never a hard failure.

---

## PART 3 — THE FILM-STRIP SUGGESTION CAROUSEL (UX)

The reader's chosen interaction (confirmed): not a modal, not a cramped sidebar — a
**horizontal film-strip carousel that glides up along the bottom edge**, and on tablet
sits **just above the virtual keyboard** so the active paragraph stays visible.

```
┌───────────────────────────────────────────────────────────────────┐
│  Reader canvas — structured text with the active highlight          │
├───────────────────────────────────────────────────────────────────┤
│  Write your thought…                                   (editor)     │
│  ┌─────────────┬──────────────────────┬───────────────────────┐    │
│  │ ＋ New Note │  Suggested · "Crypto" │  Suggested · "Tech"    │ …  │
│  │ standalone  │  "Bacon's cipher uses │  "Bletchley parsed…"   │    │
│  │ thought     │   5-bit encoding…"    │  Network: Codebreaking │    │
│  └─────────────┴──────────────────────┴───────────────────────┘    │
│   ◀───────── pan / swipe to cycle cards (film-strip) ──────────▶    │
├───────────────────────────────────────────────────────────────────┤
│  [ virtual keyboard / screen boundary ]                             │
└───────────────────────────────────────────────────────────────────┘
```

### Trigger & flow

1. **Highlight created** (existing `useStructuredHighlights` / `SelectionActionBar`) fires a
   background match: `suggestRelatedNotes(selectedText)`.
2. The **carousel slides up**. Card 0 is always **＋ New Note** (clean slot). Cards 1..N are
   suggested existing notes, ranked by similarity, each showing its **network** + a preview
   snippet.
3. **Pan / swipe** horizontally to cycle. As a card takes focus it expands its preview
   (note title, recent body, which books it already draws from).
4. **Select ＋ New Note** → create a `NetworkNote` (Inbox / unfiled) + one provenance link
   from this highlight → open the editor (the existing Sunburst note editor) on it.
5. **Select an existing note** → append a **new provenance link** (this book's metadata +
   anchor + quote) to that note → open the editor on the appended note so the reader can
   extend the body with the new passage. The note now remembers both books.
6. Dismiss → just a highlight, no note (today's behavior).

### Where it mounts

A new `src/components/knowledge/NoteSuggestionCarousel.tsx`, mounted at the app root like
`SelectionActionBar` (which already floats bottom-centre). The carousel **replaces** the
single "Note" affordance's destination: tapping Note (or the post-highlight prompt) opens
the carousel instead of jumping straight to a blank Sunburst. Reuses the selection anchor
already captured by `useStructuredHighlights` so all provenance metadata is grabbed for
free at link time.

Implementation note (touch): horizontal scroll-snap container + pointer/touch panning, with
the keyboard-aware bottom offset (`env(keyboard-inset-height)` / visualViewport on tablet).
Build and tune the carousel motion in isolation first.

---

## PART 4 — NETWORKS: CREATION, TAGS, AUTO-GROUPING

- **Manual:** create a network, name it, give it tags. Move/assign notes into it.
- **Auto-suggest membership:** when a new note clusters (high cosine) with notes already in
  a network, suggest filing it there ("This looks like it belongs to your *Codebreaking*
  network — add it?"). Reader confirms; never silent.
- **Inbox / unfiled:** notes with `networkId = null` live in an Inbox until filed. Nothing
  is forced into a network.
- **Tags** are network-level meta for fast identification and for grounding downstream
  generators. A note inherits its network's tags contextually.
- **Merge / split** networks as the reader's thinking reorganizes (later phase).

Networks are **reader-dictated** — the system suggests, the reader decides. The grouping is
emergent over time, exactly as described.

---

## PART 5 — THE NETWORKS HUB + SUNBURST VISUALIZER

### Hub

A new **Networks** destination, reached from the side rail (`SideRail` / `DesktopRail`)
alongside Library and the Annotations drawer — and as a drawer view (`DrawerView` gains
`"networks"`). It lists the reader's networks with tag chips and counts. Opening one shows:
- its NetworkNotes (each with the books it draws from),
- its media assets (audio overviews, decks) with inline players/openers,
- a timeline of when links were added across the library.

### Sunburst as the network map (reuse `SunburstNote.tsx`)

The radial Sunburst becomes the network navigator:
- **Hub node** = the network's name/theme.
- **Inner ring** = contributing books.
- **Sectors** = the network's notes.
- **Outer points** = individual passages (provenance links) — tapping one calls
  `luminaNavigate(locator)` to jump to that exact passage in that book (opening it if
  needed).

This turns the existing Sunburst from a single-note reader into an active cross-book
knowledge map — the visual identity of a Network.

---

## PART 6 — CROSS-ASSET GENERATION OVER A NETWORK

Because a network aggregates snapshots from many books, the generators scale up:

### Network-wide Audio Overview (`audioOverview.ts`)

A new scope: instead of one book, target a `networkId`. The summarizer pulls **every
provenance quote + note body** in the network and builds a **comparative** brief:

> "Give a structured spoken explanation tracing how this idea evolves across Book A
> (passage X) and Book B (passage Y), as the reader has connected them — what they share,
> where they diverge, and the synthesis the reader is building."

Voiced with Gemini TTS (PLANvii path). Saved as a `NetworkMediaAsset` (`audio_overview`).
This is the verbatim-narration-free Audio Overview, now cross-book.

### Network Presentation deck (`presentationStudio.ts`)

The deck generator reads the network graph directly: node clusters → structural slides; a
**mind-map / sequence deck** showing where ideas intersected across documents and how the
reader's thinking developed over months. Saved as a `NetworkMediaAsset`
(`presentation_deck`).

Both register into `network_media_assets`, so the Sunburst and Hub can show and replay them.

---

## PART 7 — SURFACING: THE CONSTELLATION (two zoom levels of one graph)

The network is background structure *and* a surfaceable view (per the Governing Principle).
The surfaceable form is a single graph rendered at two scales:

### 7a. Library-wide Constellation (the star-field)

A force-directed view of **every node across the whole library**. This is the "web of
interconnected nodes" — the bird's-eye of the reader's thinking.

- **Nodes are heterogeneous.** A node is any knowledge artifact, not just a note:
  highlight, NetworkNote, audio overview, teaching schema (study guide / SIP), generated
  image, presentation deck. Each renders with a glyph for its kind.
- **A node need not be complete to exist.** An orphaned note with zero edges is a
  first-class node — a **lone star**, rendered dim and adrift. It is still indexed and still
  matchable; it simply hasn't been connected yet.
- **Edges are typed and weighted:**
  - `provenance` — note → the passage(s) it was built from (strong, explicit).
  - `similarity` — note ↔ note via cosine ≥ floor (discovered, weight = score).
  - `membership` — node → its network (the clustering force).
  - `derivation` — generated asset → its source notes (audio/deck → inputs).
- **Clusters are networks.** Nodes pulled together by membership + similarity *are* the
  reader's networks — some named, some still emergent. The force layout makes a named
  network read as a constellation and an un-named dense cluster read as a candidate one
  ("you seem to be forming a network here — name it?").
- **Revelation = an edge being born.** When a fresh highlight's embedding crosses the floor
  against a lone star, the new edge **animates into existence** and the star drifts into the
  cluster. That visible moment — a solitary thought suddenly connected — is the emotional
  core of the feature and is on-brand for Lumina's atmosphere.

Reached from the Networks rail destination as the default landing view ("Constellation"),
with the named-network list beside it.

### 7b. Per-network Sunburst (the focused view)

Zooming into one cluster collapses the star-field into the radial `SunburstNote` view from
PART 5 (hub = network, ring = books, sectors = notes, points = passages). The Constellation
is the macro; the Sunburst is the micro. Same underlying graph, different lens.

### Build note

The Constellation is **read-only over the same stores** — it derives nodes from
NetworkNotes + provenance + media assets and edges from membership + an on-demand
similarity pass. It builds nothing new in the data model; it is purely a projection. It can
therefore ship *after* everything else and is never on the critical path.

---

## PART 8 — PROGRESSIVE-ENHANCEMENT SEARCH (how the network governs recall)

This is the concrete mechanism behind the Governing Principle. Search and suggestion are
**two-tier with automatic fallback** — the network re-ranks when present, the baseline
index always answers.

### Baseline tier (always on, ships first, zero graph required)

The existing library + archive lexical search over titles, quotes, and note bodies. Works
with an empty graph, no key, and offline. This is the floor the experience never drops
below.

### Enhanced tier (engages only when the graph is rich enough)

1. Embed the query (one cached Gemini call).
2. Cosine over stored note/highlight embeddings (local, brute-force, instant).
3. **Merge and re-rank** the lexical results — boost semantically-near hits and same-network
   items, and append a "related across your library" strip.
4. Blend: `score = α·lexical + β·semantic + γ·network-bonus`.

**β and γ scale with corpus maturity.** A near-empty library leaves α dominant (the network
barely nudges); a deep one lets β/γ genuinely steer. Maturity is a cheap signal — node
count, edge density, embedding coverage — so reliance grows automatically with how much the
reader has actually built. The app never claims more authority than the data earns.

### The preference + fallback

A browser/app setting — **"Use network relations to enhance search & suggestions"** — with
automatic fallback to the plain index whenever: the graph is below a maturity threshold, no
embedding key is set, or the device is offline. Default: **on-when-available**. The reader
can force baseline-only if they prefer determinism.

The same tiering governs the **suggestion carousel**: rich graph → ranked semantic cards;
sparse graph → just "＋ New Note." Cold start is not an empty state, it is the honest
beginning.

---

## DATA LIFECYCLE (one diagram)

```
[ highlight created ] ──► useStructuredHighlights captures anchor + quote
        │
        ▼
[ suggestRelatedNotes(text) ] ─► embed (Gemini) + cosine vs note embeddings (local)
        │
        ▼
[ NoteSuggestionCarousel slides up ]
   ├─ ＋ New Note  ─► create NetworkNote (Inbox) + provenance link ─► editor
   └─ Existing card ─► append provenance link (book meta + anchor + quote) ─► editor
        │
        ▼
[ annotationStore / networkStore mutate ] ─► persist (StorageAdapter, both runtimes)
        │
        ▼
[ refresh Notepad · Networks Hub · Sunburst map ]
        │
        ▼
[ optional: generate network-wide Audio Overview / Presentation ] ─► NetworkMediaAsset
```

---

## IMPLEMENTATION ORDER

### Phase 1 — Data model + storage + migration
- Add the types. Add `relational_networks`, `network_notes`, `note_provenance_links`,
  `network_cluster_tags`, `network_media_assets` to both adapters (web IndexedDB stores +
  DB-version bump; Tauri SQLite tables + `db.ts`); StorageAdapter methods.
- `networkStore` (zustand) mirroring the annotation-store pattern.
- Migration: existing `Note`s → `NetworkNote` + one provenance link (Inbox), non-destructive.

### Phase 2 — Embedding + match engine
- `noteMatching.ts`: `embedText` (Gemini, cached), `cosine`, `suggestRelatedNotes`,
  `keywordFallback`. Embed on note create/update; lazy backfill migrated notes.

### Phase 3 — Film-strip suggestion carousel
- `NoteSuggestionCarousel.tsx`: bottom, keyboard-aware, pan/swipe, New-Note + ranked cards.
- Wire highlight → carousel → New / append-to-existing → editor + provenance write.

### Phase 4 — Networks hub + management
- Rail destination + `DrawerView "networks"` + Networks panel. Create/rename/tag, file
  notes, auto-suggest membership (confirm-only), Inbox.

### Phase 5 — Sunburst network visualizer
- Extend `SunburstNote.tsx` (or a `SunburstNetwork.tsx`) into the radial network map with
  passage-level navigation via `luminaNavigate`.

### Phase 6 — Cross-asset generation
- Network-scope Audio Overview (comparative cross-book brief → Gemini TTS).
- Network presentation deck (graph → slides). Register both as `NetworkMediaAsset`.

### Phase 7 — Progressive-enhancement search (PART 8)
- Ship the two-tier search/suggestion blend with the maturity-weighted re-rank, the
  preference toggle, and automatic fallback to the existing library/archive index. Note:
  the *baseline tier already exists today* — this phase only adds the enhanced overlay, so
  it can land incrementally and degrade safely from day one.

### Phase 8 — Library-wide Constellation (PART 7a)
- Force-directed star-field over the existing stores (read-only projection — no new data
  model). Heterogeneous node glyphs, typed/weighted edges, lone-star orphans, edge-birth
  animation. Ships last; never on the critical path.

---

## OPEN QUESTIONS / DECISIONS

1. **Carousel rendering inside the structured reader vs app-root overlay.** Recommend
   app-root overlay (like `SelectionActionBar`) for keyboard-offset control; confirm.
2. **Similarity floor + max suggestions.** Start cosine ≥ 0.78, top 5. Tune on real notes.
3. **Embedding model id.** Confirm the current Gemini embedding model available on the
   BYOK key; store `embeddingModel` so a model change can trigger re-embedding.
4. **Auto-grouping aggressiveness.** Recommend suggest-only (never auto-file). Confirm.
5. **Networks vs the per-book Notepad.** Notepad stays as a book-scoped view of
   NetworkNotes (via provenance); the Networks hub is the cross-book view. Confirm both
   coexist rather than replacing the Notepad.
6. **Privacy copy.** One honest line that note text is embedded via the Google key
   (already used for analysis); keyword fallback when no key.
7. **Maturity thresholds (PART 8).** What node-count / edge-density / coverage values flip
   the enhanced tier on and set β/γ weight? Start conservative (enhanced engages only past
   a few dozen embedded nodes) and tune on a real growing library.
8. **Search preference default.** Recommend **on-when-available** with a force-baseline
   escape hatch. Confirm.
9. **Constellation node scope (PART 7a).** Ship with notes + passages + media assets as
   nodes first; fold in highlights/images/teaching-schemas as node kinds once the layout is
   legible. Confirm the v1 node set.

---

## WHY THIS IS THE RIGHT BET

It reframes Lumina from a file-by-file text processor into a **localized semantic graph of
the reader's own thinking** — a centralized brain that treats separate books as pieces of
one ongoing intellectual framework. NotebookLM walls knowledge into notebooks; Lumina lets
a single realization chain independent texts, dynamic summaries, generated media, and old
insights together across time, organized into the reader's own Networks. And it runs on the
reader's tablet today, because the matching is Gemini-embeddings + client-side cosine — no
native code, no separate infrastructure.

*Plan only — no code yet. Reference fully before building Phase 1.*
