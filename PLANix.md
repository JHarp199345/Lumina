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
