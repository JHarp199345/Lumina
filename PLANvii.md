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
│  WHAT SHOULD IT COVER?                          ✨ Suggest │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ (ghost suggestion outline appears here, editable)   │  │
│  │                                                     │  │
│  │                                                     │  │
│  └─────────────────────────────────────────────────────┘  │
│  Leave empty for a full guided overview.                  │
├───────────────────────────────────────────────────────────┤
│  Voice: [ Clear Narrator ▾ ]      ~larger generation ⓘ   │
│                              [  Generate Overview  ]       │
└───────────────────────────────────────────────────────────┘
```

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

### 3. The prompt field with ghost-writing suggestions

This is the heart of the feature. The field behaves in three layers:

**a. Ghost suggestion (pre-seeded, not yet "real").**
When the window opens, Lumina populates the field with a **ghost outline** — a low-
opacity, editable-on-accept suggestion derived from the book's ingestion map for the
chosen scope. It reads like a genuine chapter/book outline ("This overview will cover:
the central conflict between …, the turn at …, the thematic throughline of …"). It is
visibly a *suggestion* (dimmed / italic / marked), not committed text.

**b. Accepting / editing / replacing.**
- The reader can **accept** the ghost (a tap, or "Use this") → it becomes real, editable
  text they can then trim.
- The reader can **start typing** → the ghost dismisses and their text is what's
  respected.
- The reader can **trim the outline**: accept it, then highlight the part they care
  about, delete the rest, and generate an overview focused only on that.
- The reader can **leave it empty** → the hidden **default prompt** is used (see below).

**c. Re-suggesting.**
A small **✨ Suggest** affordance regenerates the ghost outline (e.g., if the reader
changed scope, or wants a fuller/different outline). Suggestions are derived from the
map; a richer outline can be produced by a quick Gemini expansion of the map's per-
chapter understanding (see "Suggestion generator" below).

> Interaction note: the "ghost text that doesn't count until selected" is the inline-
> suggestion pattern (Copilot-style). Implementation options to decide at build time:
> (1) a styled overlay behind a transparent textarea, accepted via a Tab/Use-this; or
> (2) prefilled dimmed text in the textarea that "solidifies" on focus/edit. Option (2)
> is simpler and touch-friendly; prefer it unless the overlay feel is clearly better.

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

## THE DEFAULT PROMPT (when the field is empty)

If the reader generates with an empty field, Lumina uses a finely-tuned default that, on
its own, produces a thorough, structured overview — not a thin summary. The default is
NOT shown as text in the field (the field stays empty / shows only the ghost); it is the
system behavior for "no custom instruction."

The default prompt is assembled at generation time from three parts:

1. **Role + time frame instruction** (the spine):

   > "You are a subject-matter expert and an excellent teacher. You have approximately
   > {minutes} minutes (about {targetWords} spoken words) to give a clear, structured
   > breakdown of the following material. Explain it, teach it, simplify the hard parts,
   > and expand on what matters. Move in a logical order. Open by framing what this
   > material is and why it matters, develop the key ideas/sections in sequence, and
   > close with the throughline a listener should walk away understanding. Speak
   > naturally, as continuous narration meant to be heard, not read. Do not include
   > stage directions, headers, or markup — only the spoken words."

2. **The scope outline** — the ingestion-map-derived outline for the chosen scope
   (full book outline, or the selected chapters' outlines). This is what gives the
   default depth: it is grounded in Lumina's actual understanding of the book.

3. **Length + pacing guardrails** — target word count, reminder that it is approximate,
   and a pacing instruction (calm explanatory pace, no filler to pad time).

When the reader DOES provide a custom prompt, part 1's role line is replaced/augmented by
their instruction, **their instruction is respected as primary**, and parts 2 and 3 still
provide grounding + length control (unless the reader's text already constrains scope, in
which case the outline narrows accordingly).

---

## THE SUGGESTION GENERATOR (ghost outlines from the map)

The ghost suggestions are the "weird but cool" part — and they're cheap because the book
is already analyzed.

### Source

For the chosen scope, gather from the existing `SemanticMap` / structure:
- chapter titles (from the parse),
- per-chapter understanding already captured during ingestion (themes, key
  scenes/inflections, narrative threads, lore touchpoints),
- the macro arc and central themes for whole-book scope.

### Two tiers of suggestion

- **Tier 1 — instant, free (no API call):** assemble an outline directly from the stored
  map fields. Fast; shown immediately when the window opens so the field is never empty
  of guidance. Good enough as a starting ghost.
- **Tier 2 — richer, on demand (one Gemini call):** when the reader taps **✨ Suggest**
  (or after scope change), send the map's scope data to Gemini and ask it to write a
  fuller, readable outline of what an overview *could* cover — "better, fuller outlines of
  the chapter" in the reader's words. This is a small, cheap call (outline only, not the
  full script).

The suggestion is always presented as a ghost (not committed). The reader decides whether
it becomes real.

---

## THE GENERATION PIPELINE

```
[ Audio Overview window: scope + minutes + (prompt | empty) + voice ]
                            │
                            ▼
1. Resolve source context
   - gather scope outline from SemanticMap + structure (NOT full verbatim prose by
     default — the map is the grounding; this controls cost and quality)
   - if the reader trimmed/edited the outline, use exactly what they left
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

### Why grounding on the map (not full prose) by default

- **Cost & token limits:** a whole-book overview can't fit the entire book in one Gemini
  call for long books; the map is a compact, faithful grounding.
- **Quality:** the map already represents Lumina's structured understanding — exactly the
  scaffold a good overview needs.
- **Option:** for single-chapter scope, the chapter's actual text MAY be included
  (it fits), improving fidelity. Decide per-scope: chapter scope → include chapter text;
  whole-book scope → map outline only.

---

## DATA MODEL

Reuse the existing `AudioArtifact` type, adding (or reusing) a discriminator so overviews
are not confused with narration segments.

```
AudioArtifact {
  ...existing fields (id, bookId, audio data/url, duration, voice, alignment, etc.)
  kind: "narration" | "overview"      // overview = generated explanation
  // Overview-specific (optional):
  overviewScope?: { type: "whole" | "chapter" | "selection"; chapterIds?: string[] }
  overviewMinutes?: number            // requested target
  overviewPrompt?: string             // the user's prompt, or "" for default
  overviewScript?: string             // the generated script (for transcript display)
}
```

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

### Phase 1 — Window shell + scope/length controls
- Build the Audio Overview modal reached from the feature drawer entry.
- Scope selector (whole / current chapter / choose chapters) wired to `activeStructure`.
- Length stepper (5–35, default 20, 5-min steps) with "~min" label.
- Voice dropdown reusing Voice Studio presets.
- Generate button (disabled if no API key / no book), with the "larger generation" note.

### Phase 2 — Suggestion generator (ghost outlines)
- Tier 1: instant outline assembled from the stored map for the chosen scope.
- Ghost rendering + accept/replace/trim interaction in the prompt field.
- Tier 2: ✨ Suggest → Gemini outline expansion (cheap, outline-only).
- Re-suggest on scope change.

### Phase 3 — Summary script generation
- Default-prompt assembly (role/time spine + outline grounding + length guardrails).
- Custom-prompt path (reader instruction primary, outline + length still applied).
- Gemini call that summarizes/explains the scope down to a ~targetWords spoken-style
  script. Progress reporting. (This is the summarizer step; its output is what gets voiced.)

### Phase 4 — Voicing (Gemini TTS) + playback
- New lightweight Gemini-TTS path (separate from audioDirector's ElevenLabs path).
- Chunk the script under Gemini TTS input limits; synthesize each chunk with the chosen
  Gemini voice; decode PCM/L16 audio and stitch + encode into one playable file.
- Persist a single AudioArtifact tagged kind:"overview", provider:"gemini"
  (audio_cache / IndexedDB); mount in the existing player.
- Transcript view (show `overviewScript`) as a bonus, since it's already generated.

### Phase 5 — Polish
- Cost/length expectation copy; graceful failure (script ok but TTS fails → keep the
  script/transcript, let the reader retry voicing).
- Library of generated overviews per book (list, replay, delete) inside the window.
- Remember last-used scope/length/voice per book.

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
