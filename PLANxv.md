# PLAN XV: One Book Profile — SIP-grounded, passage-grounded image composition

## The problem

The book has **two derived data sources** that drifted apart:

- **Source Intelligence Profile (SIP)** — `src/pipeline/sourceProfile.ts`: rich book
  intelligence (themes, tone, domain, teaching angles). Built early in ingestion
  but only consumed by **audio** generation.
- **Semantic map** — `src/pipeline/semanticAnalyzer.ts`: arc, inflection points,
  scenes, narrative blueprint, storyboard, visual lore. Consumed by **visuals**.

Two sources = drift, duplication, and the visual pipeline ignoring the book's
richest intelligence. Symptom: images that read as "random people and objects in
random orientations" instead of *the actual charged moment*. Separately, the image
composition prompt is built from a thin ~700-char text window — not the real
passage, and not informed by the SIP.

## The vision (one source of truth)

**One canonical Book Profile per book**, built once at ingestion, held in memory,
with the absolute-position spine at the bottom and everything layered on top. The
book *text* is NOT copied into it — the mounted EPUB already holds the text; the
profile holds *derived analysis* + *position pointers*, and passage text is pulled
on demand by position range.

It is **one container with clean, independently-evolvable sections** — NOT a flat
god-object. Each consumer reads its section.

## Decisions (locked with the user)

1. **Scene SELECTION stays as-is** — keep arc-driven inflection-point selection
   (`identifyScenes`, golden number). Do NOT switch to passage-border anchoring
   (deliberately deferred — "a whole nother tamale"). We only change what each
   selected scene is *grounded in* (full passage section + SIP) and how its
   composition is written.
2. **One Book Profile container**, sectioned (below). SIP folds in as a section.
3. **Passage = the SECTION around the scene**, capped (~1,500 words) — NOT a whole
   long chapter. Focus beats volume.
4. **Composition is ~200 words** of evocative prose (matches Flux's ~256-token
   sweet spot, measured in PLAN XIII).
5. **All local enrichment stays Odysseus-only** — the paid Gemini/Imagen path must
   not gain load. Guard every new local step with `getProvider() === "odysseus"`.

## The Book Profile container (sections)

```
BookProfile {
  identity:     { bookId, title, author, workType, domain }          // SIP + parse
  positions:    { passageBoundaries[], frontMatterEndWordPos }       // the spine
  storyCraft:   { arcShape, tensionCurve, inflectionPoints[],        // "storycraft smells"
                  narrativeBlueprint, storyboard }                    // semanticAnalyzer
  intelligence: { themes, tone, motifs, teachingAngles, ... }         // the SIP body
  entities:     visualLore (characters/locations dossier)             // visualLore
  visualPlan:   { scenes[] (inflection-anchored), slots[] }           // selection unchanged
}
```

- `storyCraft` + `intelligence` + `entities` are *derived* → held in memory,
  persisted with the map. **Text is never duplicated here.**
- Implementation note: this is largely a *re-organization* of `SemanticMap` +
  `SourceProfile` under one type, not new analysis. Keep both producers; merge
  their outputs into the container at the end of ingestion.

## Passage access (new, small)

`getPassageForScene(scene, structure) -> { text, startWordPos, endWordPos }` —
pulls the section's text from the mounted EPUB by absolute position range, capped
~1,500 words centered on the scene's focal beat. Reads live from
`structure.chapters[].rawText`; nothing pre-copied.

## Front-matter cut (new, small, discrete brick)

`detectStoryStart(structure) -> wordPos` — skip cover/TOC/copyright/dedication/
epigraph so image positions begin where the story actually starts (Chapter 1).
Heuristic: first chapter past front-matter markers with sustained narrative prose.
Stored as `positions.frontMatterEndWordPos`; scene selection ignores anything before it.

## The composition step (the heart of this plan)

For each selected scene, when `provider === "odysseus"`:

Inputs pushed to Gemma:
- the **passage section** (capped ~1,500 words) — `getPassageForScene`
- the **SIP slice** relevant to this passage (tone/themes/motifs in range),
  tagged clearly as `[SIP]`
- the **pre-identified focal beat** (from the existing director brief / inflection)
- the **art style** (style seed) + any reader direction

Gemma writes ONE ~200-word evocative composition → Flux (single pass, PLAN XIII).

### How to prompt Gemma (decided — light persona, heavy task)

Persona is a minor garnish; these matter more, in order:

1. **Single-frame instruction (the #1 lever):** "Describe only what the viewer SEES
   in one frozen frame — not what happens before or after." Translating narrative
   (events over time) into one instant is the hard part.
2. **Output contract:** one paragraph, 170–210 words, present tense, natural flowing
   language, centered on the focal beat, NO tags, NO "no text"/"no watermark".
3. **One exemplar** (the locket prose from PLAN XIII testing) — beats any persona
   for format adherence.
4. **Grounding:** passage section + `[SIP]` slice + focal beat + style.
5. **Functional framing only:** "You are an art director writing a shot description
   for an illustrator." Primes the output *type*, not a vibe. No heavier persona.

### Prerequisite — Gemma `think:false` (BLOCKER, do first)

`gemma4:12b` (the "reading" agent) is a **thinking model**. Measured: thinking on
burns the whole token budget and returns EMPTY content (66s, nothing); `think:false`
returns clean prose in ~4s. The composition step is useless until thinking is off.

Plumbing (one chain):
- `src/api/llmClient.ts`: add `think?: boolean` to `LLMGenerateOptions`; in
  `_callOdysseus`, include `think` in the request body when defined.
- Odysseus `local_routes/agent_routes.py`: `QueueRequest` + `RunRequest` accept
  `think`; thread to `_run_with_council` → `llm_call_async`.
- Odysseus `src/llm_core.py` `_build_ollama_payload`: set top-level `payload["think"]`
  when provided.
- Composition call passes `think:false`, `maxTokens: ~400`.

BONUS: gemma thinking on *every* local call is likely why scoring batches run
90–195s. Once `think:false` is wired, selectively disabling thinking on other
short-output steps can speed the whole local pipeline (separate follow-up).

## Build order (Lego — each layer depends only on the one below)

```
Stage 0  think:false plumbing (BLOCKER for composition quality)
Stage 1  positions + passage segmentation + front-matter cut
Stage 2  Book Profile container — merge SIP + semantic map under one type
Stage 3  getPassageForScene + SIP-slice selector
Stage 4  composition step: passage + SIP + focal beat -> Gemma(think:false) -> ~200w
Stage 5  feed composition to Flux (PLAN XIII single-pass already shipped)
```

Scene selection (inflection points, golden number) is unchanged throughout.

## Code touchpoints

- `src/pipeline/sourceProfile.ts` — SIP producer (keep; output folds into profile)
- `src/pipeline/semanticAnalyzer.ts` — story-craft producer (keep; folds in)
- `src/hooks/useBookOrchestration.ts` — assembles the Book Profile at end of
  ingestion (SIP already built early here, so ordering is mostly right)
- `src/types/index.ts` — `BookProfile` container type wrapping existing types
- NEW `getPassageForScene`, `detectStoryStart`, SIP-slice selector (utils)
- `src/pipeline/visualDirector.ts` / `imageGenerator.ts` — composition step
  (Odysseus-only), replaces the thin-window prompt with passage+SIP grounding
- `src/api/llmClient.ts` + Odysseus `agent_routes.py` / `llm_core.py` — `think` flag

## Constraints (non-negotiable)

- **Paid path untouched.** Every new local step guarded by `provider === "odysseus"`.
  SIP may stay dual-provider, but the council/composition enrichment is local-only.
- **No book text duplication** — pull passages live by position.
- **Composition ≤ ~210 words** (Flux token reality).
- **Passage ≤ ~1,500 words** to Gemma (focus + cost).
- **Re-ingest required** — the Book Profile schema change means existing analyzed
  books rebuild on next ingest (acceptable; consistent with prior changes).

## Relationship to other plans

- **PLAN XIII** (shipped: single-pass Flux, prose prompts, 1MP) is the renderer this
  feeds. This plan improves WHAT we send it.
- **PLAN XIV** (artifact memory / image canon) is downstream and orthogonal — it
  governs reuse of *past* images; this governs *how a new* image is composed.

## Out of scope (deliberately, for now)

- Switching image anchoring to passage borders (kept inflection-point selection).
- Pipeline-wide thinking-disable speedup (follow-up once Stage 0 lands).
- Pre-warming Flux on startup (separate; kills cold-start latency).
