# PLANvii — Audio Overview
# A generated spoken explanation of a book (NotebookLM-style), distinct from Voice Studio narration

---

## CONTEXT AND RELATIONSHIP TO EXISTING FEATURES

Lumina already has two relevant systems:

- **Voice Studio** (PLANVI) — verbatim text-to-speech narration of the actual book
  prose, with read-along word highlighting. It reads the book *as written*.
  Provider: ElevenLabs (`audioDirector.ts`, `audioStore.ts`, `VoiceStudio.tsx`).
- **Semantic analysis / ingestion map** — when a book is imported and analyzed,
  Lumina builds a semantic map: arc shape, scenes, narrative threads, lore, and a
  per-chapter understanding of the book. (`semanticAnalyzer.ts`, `SemanticMap`.)

**Audio Overview is a third, distinct feature.** It does NOT read the book verbatim.
It generates a spoken *explanation* — a breakdown, summary, or guided teaching of the
material — and voices it. Think NotebookLM's "Audio Overview": you hand it source
material and it produces an explanatory audio piece about that material.

The two audio features must remain conceptually and structurally separate — including
their providers, deliberately:

| Feature | What it produces | Source text | TTS provider | Primary use |
|---|---|---|---|---|
| Voice Studio | Narration of the book, word-for-word | The book's prose | **ElevenLabs** (high fidelity) | Listen to the book |
| Audio Overview | A spoken explanation *about* the book | A generated summary script | **Gemini TTS** (cheaper, workable) | Understand a book without reading it |

This plan covers **Audio Overview only**. The provider split is intentional:
ElevenLabs is expensive and is reserved for full verbatim narration where fidelity
matters. Audio Overview uses **Gemini for both the summary script AND the voicing**,
which is lower quality but much cheaper and entirely workable for an explanatory piece.

**Consequence — a real advantage:** Audio Overview runs entirely on the reader's
**Google AI Studio key**. It needs no ElevenLabs key at all. The same key already used
for analysis and images covers the whole overview pipeline end to end.

### Layer

Audio Overview belongs to the **Atmosphere/Knowledge boundary** but is reached from the
**feature drawer**, where an "Audio Overview" entry already exists. Tapping it opens a
dedicated window (modal) — its own self-contained experience, like the Sunburst.

---

## THE CORE IDEA (in one paragraph)

The reader opens Audio Overview, optionally types what they want explained (or leaves
it empty), chooses roughly how long the overview should be, and Lumina generates a
structured spoken explanation of the chosen material within that time frame. If the
reader types nothing, a finely-tuned default prompt plus the book's ingestion map
produces a thorough, well-structured general overview. The prompt field is pre-seeded
with editable "ghost" suggestions drawn from the book's map — a real outline the reader
can accept, trim, rewrite, or ignore. The purpose: let a reader understand what a book
holds — what there is to learn in it — without having to read it first.

## IT IS MULTI-STEP — narrate the summary, never the raw chapter

The critical structural point: Audio Overview does **not** send book prose to a narrator.
It runs in stages, and the thing that gets voiced is a freshly **generated summary
script**, not the chapter itself:

```
chosen material (scope)
   → SHAPED SUMMARIZER (Gemini, shaped by the user's prompt + time inputs)
   → a shorter SUMMARY SCRIPT (spoken-style, sized to the chosen minutes)
   → NARRATION (Gemini TTS voices that short script)
   → audio
```

This is what makes it cheap and coherent: the expensive/long material is collapsed into
a compact script first (one text generation), and only that compact script is voiced.
The summarizer is "shaped" — its instructions, focus, and length all come from the
prompt + length + scope the reader set in the window.

---

## THE WINDOW (UI)

Tapping **Audio Overview** in the feature drawer opens a focused modal window. It is not
a panel; it is a deliberate, single-purpose surface that can be dismissed back to the
reader/drawer.

### Layout (top to bottom)

```
┌───────────────────────────────────────────────────────────┐
│  Audio Overview                                      [×]  │
│  A spoken explanation of this book — generated, not read. │
├───────────────────────────────────────────────────────────┤
│  SCOPE                                                     │
│  ( Whole book ) ( This chapter ) ( Choose chapters… )     │
│  └ when "Choose chapters" → a compact chapter checklist    │
├───────────────────────────────────────────────────────────┤
│  LENGTH                          ~20 min                   │
│  [ 5 ⏤⏤⏤⏤●⏤⏤⏤ 35 ]   (5-min steps; default 20)        │
├───────────────────────────────────────────────────────────┤
│  WHAT SHOULD IT COVER?                   ✨ Suggest fuller │
│  ( As a story )( Themes )( Relationships )( Chapter…)( ▸ ) │  ← angle chips
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Explain how Hari Seldon's psychohistory unfolds      │  │  ← GHOST text (grey),
│  │ across the Foundation, the tension between the        │  │    discovered from the
│  │ Encyclopedists and the traders…                       │  │    SIP. Tab / tap ⇥
│  │                                          [ ⇥ accept ] │  │    to make it real.
│  └─────────────────────────────────────────────────────┘  │
│  Tab to accept · type to write your own.                  │
├───────────────────────────────────────────────────────────┤
│  Voice: [ Kore ▾ ]                ~larger generation ⓘ    │
│                              [  Generate Overview  ]       │
└───────────────────────────────────────────────────────────┘
```
(For scholarly works the angle chips become: By subject · Key arguments · Methods &
evidence · For a first-time reader · Like a lecture.)

### 1. Scope selector

Three options, tied directly to the parsed EPUB structure (`activeStructure.chapters`):

- **Whole book** — overview spans the entire book.
- **This chapter** — the chapter the reader is currently in (`currentChapterIndex`).
- **Choose chapters…** — reveals a compact checklist of chapters (from the parse) so the
  reader can select any subset. For collection/omnibus EPUBs, respect
  `collectionGroups` so the checklist is grouped by contained book.

Scope determines which part of the ingestion map and which chapter outlines feed the
generator. Reuse existing chapter parsing — no new segmentation logic needed.

### 2. Length selector (approximate, by design)

- A slider/stepper in **5-minute increments**.
- **Default: 20 minutes.** Range: **5 to 35 minutes.**
- The label always reads "**~20 min**" (tilde) — this is a target, not a guarantee.
- Mechanism: minutes do not control audio length directly. They set a **target word
  count** for the generated script via a speaking-rate constant. The script generator is
  told both the minutes and the word target; the TTS result lands close to the target.

```
AUDIO_OVERVIEW_WPM = 140            // spoken words per minute (calm explanatory pace)
targetWords = minutes * AUDIO_OVERVIEW_WPM
// 20 min → ~2,800 words ; 35 min → ~4,900 words
```

### 3. The prompt field — PREFILLED from the Source Intelligence Profile

This is the heart of the feature, and it is a single field with **inline ghost-text
suggestions** — the Gmail Smart Compose pattern. There is **no second suggestion box**.

**The ghost-text model.**
When the field is empty (or the reader pauses), a **greyed suggestion** appears inline in
the field — a discovered overview plan drawn from the book's **Source Intelligence
Profile** (SIP). It is not yet real text; it is a proposal.
- **Accept:** press **Tab** (desktop) or tap the **⇥ accept** affordance (touch) → the
  grey ghost becomes real, editable text the reader can then trim.
- **Ignore / replace:** start typing → the ghost dismisses and the reader's words stand.
- **Generate as-is:** if the reader accepts the ghost and generates, that plan is used; if
  they generate with an empty field (never accepting), the hidden type-aware default runs.

**What the ghost says is discovered meaning, never raw fragments.**
Not: *"Opens: 'His name was Gaal Dornick…'"*
But: *"Explain how Hari Seldon's psychohistory project unfolds across the Foundation, the
tension between the Encyclopedists and the traders, and how the plan keeps re-shaping
politics generations after his death."*
The ghost is generated from the SIP's concepts, entity relationships, and progression.

**Switching what the ghost proposes.**
- **Overview-angle chips** above the field change which SIP suggestion-bank plan is being
  ghosted — "As a story", "Major themes", "Character relationships", "Chapter-by-chapter",
  "For a first-time reader", "Like a lecture" (scholarly: "By subject", "Key arguments",
  "Methods & evidence"). Tapping a chip swaps the ghost; Tab still accepts.
- **✨ Suggest fuller** replaces the current ghost with a richer SIP-derived plan (one
  cheap Gemini call). Still ghost text in the same field — never a second box.

> Implementation reality: a plain `<textarea>` cannot render greyed inline text. The ghost
> needs an overlay technique — the suggestion drawn in a dimmed layer behind a transparent
> input, with Tab (keydown) accepting it. **Touch has no Tab key**, and the primary device
> is a tablet, so a visible **⇥ accept** affordance (or tapping the ghost itself) is
> required, not optional. Build and tune this overlay in isolation first.

> Raw ingestion fragments (chapter opening text, selected snippets) are NOT shown here.
> If surfaced at all, they belong in a developer/debug view, never the generation prompt.

### 4. Voice + generate

- **Voice** dropdown lists **Gemini TTS prebuilt voices** (e.g. the Gemini speech voices
  such as Kore, Puck, Charon, etc.) — NOT ElevenLabs voices. Audio Overview is a separate,
  Gemini-only voice set. Default to a clear, neutral narrator voice.
- A subtle **"~larger generation"** info chip notes that overviews use more of the
  reader's Google quota than a single image (summary tokens + TTS audio seconds). Honest,
  not alarming — and notably cheaper than an ElevenLabs narration of comparable length.
- **Generate Overview** kicks off the pipeline and shows progress (script → voicing →
  ready), then hands off to the existing audio player.

---

## THE DEFAULT PROMPT (hidden system behavior, type-aware)

The default prompt is the hidden system behavior used when the reader clears the field.
No one sees it. It must, on its own, produce a thorough, well-organized explanation — and
crucially it is **type-aware**: it organizes the result by the work's natural structure.

Assembled at generation time from:

1. **Role + organization spine — chosen by detected work type** (from the SIP):

   *Fiction / narrative:*
   > "You are a subject-matter expert and an excellent teacher. In about {minutes} minutes
   > (~{targetWords} spoken words), explain this book clearly and engagingly. Explain the
   > main story arc, the major characters and factions, the central conflicts, the
   > important turning points, and the major themes — and how the relationships and ideas
   > develop across the work. Organize the overview by the book's natural parts or acts.
   > Do not read passages aloud; explain what happens, why it matters, and how it develops.
   > Speak as continuous narration meant to be heard — no headings, labels, or markup."

   *Nonfiction / scholarly:*
   > "You are a subject-matter expert and an excellent teacher. In about {minutes} minutes
   > (~{targetWords} spoken words), give a structured explanation of this work. Explain the
   > central thesis, the major concepts, the subject hierarchy, the supporting arguments,
   > key terminology, important examples and evidence, and the implications. Organize the
   > overview by topic and subject hierarchy — not by simply summarizing chapter openings.
   > Speak as continuous narration meant to be heard — no headings, labels, or markup."

2. **The SIP grounding** for the chosen scope (concepts, entities + relationships,
   progression / subject hierarchy) — the discovered meaning, not chapter openings.

3. **Length + pacing guardrails** — target word count, "approximate," calm explanatory
   pace, no filler to pad time.

When the reader DOES provide text (including an edited SIP prefill), **their text is
primary**; parts 2 and 3 still supply grounding + length control.

---

## SOURCE INTELLIGENCE PROFILE (SIP) — THE INGESTION CHANGE

The prompt prefill and the type-aware default are only as good as what ingestion knows
about the book. Today ingestion captures **visual** meaning (scenes, arc, lore, threads)
and **navigational** scaffolding (TOC, chapter openings). That is weak for explaining a
book. We add a **Source Intelligence Profile** — a hidden, teaching-oriented profile of
the work, saved at ingestion, that answers: *what should a smart narrator know before
explaining this book?*

### What the SIP contains

```
1. Work identity
   - title, author, (best-effort) genre and era
   - work type: fiction | nonfiction | scholarly | manual | memoir | reference | scripture | other
2. Structure map
   - parts / chapters / sections; the natural arc (fiction) OR subject hierarchy (nonfiction)
   - rough importance weight per section
3. Core concepts
   - main ideas, recurring themes, key terms, the central questions the work explores
4. Entity & relationship map
   - major characters / people / organizations / places
   - relationships AND how they evolve across the work (progression, not just presence)
5. Progression
   - fiction: plot movements, conflicts, turning points, reveals
   - nonfiction/scholarly: thesis, supporting arguments, evidence, counterarguments, implications
6. Overview suggestion bank
   - several ready-made overview plans ("angles"): as a story / major themes /
     character relationships / chapter-by-chapter / for a first-time reader / like a
     lecture — and for scholarly works: by subject / key arguments / methods & evidence
```

The SIP is **hidden book intelligence**. The reader never sees its raw form; it powers the
prompt prefill, the angle chips, and the type-aware default.

### Build it mostly from what ingestion ALREADY extracts

Much of this is already produced for the visual system and just needs reframing:

- **Entities** ← `visualLore` already extracts recurring people / places / objects /
  factions / concepts. Reuse as the entity map; add relationship *evolution*.
- **Themes & threads** ← `narrativeBlueprint` already has central themes and
  setup→payoff threads. Reuse for core concepts and progression.
- **Arc / structure** ← `arcShape` + the parsed chapter structure. Reuse directly.
- **Per-chapter understanding** ← the chapter analysis step. **This is where ingestion
  must be enriched:** capture a short *teaching summary* per chapter (what it's about,
  key developments, which relationships/concepts move) — NOT emotional/visual vectors and
  NOT the opening line.

What is genuinely new (a small added delta, not a second heavy pass):
- **Work-type classification** (one cheap call, or inferred from existing signals).
- **Relationship progression** (how entities change) — one consolidation call over the
  already-extracted entities + chapter teaching summaries.
- **Subject hierarchy** for nonfiction/scholarly works.
- **Suggestion bank** — assembled from the above (mostly free; optionally one call).

### Cost & timing (honest) — ONE enriched pass, not a second pass

The rule, set by the reader: **do not add another ingestion pass.** Since most of this is
already pulled during analysis, ingestion simply **asks for more in the same run.**

- **One pass:** the existing analysis pass is enriched to also extract the SIP material.
  Most of it is reframing artifacts already produced in that pass (`visualLore`,
  `narrativeBlueprint`, `arcShape`, structure); the genuinely new fields (work-type,
  relationship evolution, subject hierarchy, suggestion bank) are gathered in the same
  run, ideally folded into existing structured calls rather than added as standalone ones.
- **Enrich the existing per-chapter step** to also emit a `teachingSummary` — no separate
  chapter pass.
- **Lazy backfill (one-time, older books only):** books analyzed before the SIP existed
  build it once on first Audio Overview open, then cache. New imports get it during the
  single enriched analysis pass.
- Cache the SIP like other ingestion artifacts; never regenerate unless re-analyzed.

### How the SIP drives the prompt field (replaces the old "suggestion generator")

- **On window open (instant, no call):** the best suggestion-bank plan for the current
  scope + work type appears as **inline ghost text**; Tab / tap ⇥ accepts it.
- **Angle chips (instant, no call):** swap the ghost to a different suggestion-bank plan.
- **✨ Suggest fuller (one cheap call):** replace the ghost with a richer plan.

No raw fragments, ever. The ghost always holds discovered meaning, and nothing becomes
real text until the reader accepts it (Tab/tap) or types their own.

---

## THE GENERATION PIPELINE

```
[ Audio Overview window: scope + minutes + (prompt | empty) + voice ]
                            │
                            ▼
1. Resolve source context
   - gather grounding from the SOURCE INTELLIGENCE PROFILE for the chosen scope
     (concepts, entities + relationship progression, subject hierarchy / arc) — NOT
     chapter opening lines, NOT full verbatim prose by default
   - the field text (SIP-prefilled or reader-edited) is the primary instruction
                            │
                            ▼
2. Compose the SUMMARIZER prompt (shaped by the reader's inputs)
   - role/time spine (default) OR reader's custom instruction (primary)
   - + scope outline grounding
   - + target word count (minutes × WPM) and pacing guardrails
                            │
                            ▼
3. Gemini → SUMMARY SCRIPT
   - the chosen material is summarized/explained down to a compact, spoken-style script
   - continuous prose, ~targetWords, no markup/stage directions, single narrator (v1)
   - THIS is the only text that gets voiced — never the raw chapter
                            │
                            ▼
4. Voicing via GEMINI TTS (not ElevenLabs)
   - chunk the script under Gemini TTS input limits
   - synthesize each chunk with the chosen Gemini voice
   - decode Gemini's audio output (PCM/L16) and stitch chunks into one continuous
     AudioArtifact (encode to a playable format, e.g. WAV/MP3, as needed)
                            │
                            ▼
5. Store + play
   - persist as an AudioArtifact tagged kind:"overview" (distinct from narration)
   - mount in the audio player; reader listens, scrubs, adjusts speed
```

### Why grounding on the SIP (not raw prose) by default

- **Cost & token limits:** a whole-book overview can't fit the entire book in one Gemini
  call; the SIP is a compact, faithful, teaching-oriented grounding.
- **Quality:** the SIP is discovered meaning (concepts, relationships, progression) —
  exactly the scaffold a good explanation needs, far better than chapter openings.
- **Option:** for single-chapter scope, the chapter's actual text MAY be added on top of
  the SIP (it fits), improving fidelity. Whole-book scope → SIP only.

---

## DATA MODEL

### AudioArtifact (already implemented in v1)

Overviews reuse `AudioArtifact` with `scope: "overview"` and `provider: "gemini"`, plus
`overviewMinutes`, `overviewPrompt`, `overviewScript`. (Shipped.)

### SourceIntelligenceProfile (NEW — the ingestion artifact)

```
SourceIntelligenceProfile {
  bookId: string
  workType: "fiction" | "nonfiction" | "scholarly" | "manual" | "memoir" | "reference" | "scripture" | "other"
  identity: { title; author; genre?; era? }
  structure: {
    kind: "narrative" | "subjectHierarchy"
    sections: Array<{ id; title; importance: number; teachingSummary: string }>
  }
  concepts: { mainIdeas: string[]; themes: string[]; keyTerms: string[]; questions: string[] }
  entities: Array<{
    name; type: "character"|"person"|"org"|"place"|"concept"
    role: string
    relationships: Array<{ to: string; nature: string; evolution: string }>
  }>
  progression: string[]            // plot movements OR argument/evidence flow
  suggestionBank: Array<{          // ready-made overview plans ("angles")
    id; label; workTypes: string[]; planText: string   // planText = the prompt prefill
  }>
  builtAt: string
}
```

Persist alongside the semantic map (SQLite `source_profiles` table on desktop; IndexedDB
store on web). Built during analysis for new imports; lazily built on first Audio Overview
open for older books, then cached.

Per-chapter `teachingSummary` is the enrichment to the existing chapter-analysis step
(what the chapter is about + key developments + which relationships/concepts move) — it
replaces reliance on chapter opening text.

Persist via the existing audio storage (SQLite `audio_cache` on desktop; IndexedDB on
web). Overviews are cached like other audio — reopening a book reloads them rather than
regenerating. Tag `provider: "gemini"` on overview artifacts so they are never confused
with ElevenLabs narration artifacts.

### Config constants (add to config)

```
AUDIO_OVERVIEW_WPM: 140,
AUDIO_OVERVIEW_DEFAULT_MIN: 20,
AUDIO_OVERVIEW_MIN: 5,
AUDIO_OVERVIEW_MAX: 35,
AUDIO_OVERVIEW_STEP: 5,
GEMINI_TTS_MODEL: "gemini-2.5-flash-preview-tts",   // confirm exact id at build time
GEMINI_TTS_DEFAULT_VOICE: "Kore",                    // a clear neutral prebuilt voice
```

---

## IMPLEMENTATION ORDER

### ✅ Phase 1 — Window + scope/length/voice + Gemini summary→TTS (SHIPPED in v1)
- Audio Overview window, scope/length/voice controls, generate, saved-overviews library.
- Gemini summary script → Gemini TTS → WAV → AudioArtifact (scope "overview").
- v1 used a TOC/first-line outline + a second suggestion box. The remaining phases below
  REPLACE that weak grounding and that second box.

### Phase 2 — Source Intelligence Profile at ingestion (the core refinement)
- Define `SourceIntelligenceProfile` + storage (desktop table + web store), cached per book.
- **Enrich the existing per-chapter analysis** to also emit a `teachingSummary`.
- Build the SIP mostly by reframing existing artifacts (`visualLore` entities,
  `narrativeBlueprint` themes/threads, `arcShape`, structure) + a small number of added
  consolidation calls for: work-type classification, relationship progression, subject
  hierarchy (nonfiction), and the suggestion bank.
- New imports build the SIP during analysis; older books lazily build on first Audio
  Overview open, then cache.

### Phase 3 — Ghost-text prompt field driven by the SIP (replace the second box)
- Remove the separate suggestion box. Build the **inline ghost-text overlay** (Gmail
  Smart Compose style): SIP plan shown greyed in the field; **Tab** accepts (desktop);
  a visible **⇥ accept** affordance / tap-the-ghost accepts (tablet — required, no Tab key).
- Typing dismisses the ghost; accepted text is editable/trimmable.
- **Overview-angle chips** swap which SIP plan is ghosted (type-aware).
- **✨ Suggest fuller** swaps in a richer ghost (one cheap call). No raw fragments shown.
- Tune the overlay in isolation first (textareas can't render inline grey text).

### Phase 4 — Type-aware default + SIP grounding in the summarizer
- Replace the single default spine with **fiction vs nonfiction/scholarly** variants.
- Ground the summarizer on the SIP (concepts, relationships+progression, subject
  hierarchy) instead of chapter openings; keep chapter-scope optional prose on top.

### Phase 5 — Polish
- Graceful failure (script ok but TTS fails → keep transcript, retry voicing).
- Remember last-used scope/length/voice/angle per book.
- Optional debug view exposing the raw SIP (developer only, never in the prompt).

---

## OPEN QUESTIONS (resolve during building, not before)

1. **Ghost rendering technique:** dimmed-prefilled textarea (simpler, touch-friendly) vs
   overlay-behind-transparent-textarea (truer "ghost" feel). Lean simpler first.
2. **Chapter-scope fidelity:** include the chapter's actual prose in the script prompt for
   single-chapter scope (fits, higher fidelity) — confirm token budget per chosen model.
3. **Single vs multi-voice:** v1 single expert narrator. Two-host "podcast" mode is a
   future option, not v1.
4. **Whole-book length cap:** very long books at 35 min still summarize hard; consider a
   gentle note when scope is huge relative to the chosen minutes.
5. **Gemini TTS specifics:** confirm the exact TTS model id, the prebuilt voice list, the
   per-request input limit (for chunking), and the returned audio encoding (PCM/L16) so the
   stitch-and-encode step targets the right format. Audio Overview is Gemini-only — it does
   NOT touch the ElevenLabs path used by Voice Studio.
6. **Quality expectation:** Gemini TTS is lower fidelity than ElevenLabs. That is an
   accepted, deliberate trade for cost on an explanatory piece — set reader expectations
   subtly in copy if needed, but do not apologize for it.

---

## WHAT THIS FEATURE IS FOR (the principle)

Audio Overview exists so a reader can find out **what there is to learn in a book before
(or instead of) reading it** — to have the material explained, taught, simplified, and
expanded by a knowledgeable voice, shaped to the time they have and the questions they
bring. It is the "explain this book to me" companion to Voice Studio's "read this book to
me." Both are voices around the text; only one of them is the text itself.

---

*End of PLANvii — Audio Overview.*
*Reference fully before building. No code until this is approved.*
