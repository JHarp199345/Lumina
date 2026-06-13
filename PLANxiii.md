# PLAN XIII: Coherent Arc Building — Horizon Awareness, Blackboard Packets, Merge Reconciliation

## The problem

The emotional arc (and other whole-book artifacts) needs the entire book, but a
local model's context window can't hold it — that's why scoring is batched. The
current batching has a coherence flaw: **each batch scores its chapters in a
vacuum.** A batch of 8 chapters is told "score these -1..1" with no knowledge of
the other 40 chapters, so it calibrates to its own slice. A quiet chapter in a
dark book gets scored as if the batch's local range were the whole book. Then we
stitch the blind fragments into an arc. The seams don't line up.

The user's mental model (verbatim intent): a writer doesn't hold every word in
memory, but they always know **where the story started, where they are now, and
that there's an endpoint they're building toward** — so the finished work
represents the book as a whole. We want the AI to build the arc the same way:
incrementally, from the book itself, but always aware of the horizon, producing a
final artifact that is true to the whole.

This is a well-known pattern: **map-reduce with a shared blackboard and merge
reconciliation**, plus a later **persistent artifact workspace** the agent reads
and writes across steps.

The important clarification: stateless parallel LLM calls cannot literally pause
mid-generation, ask another batch a question, wait, then resume. But Odysseus
already has the next-best thing: tasks can emit compact packets, dependent tasks
can read upstream packets, and a merge task can read every packet after the
parallel pass. That gives us real information flow without sacrificing parallel
speed.

## Stages

### Stage 1 — Horizon awareness in scoring (SHIPPED)

Keep the fast parallel batches, but stop scoring in a vacuum. Each batch is told:
the book has N chapters; you are scoring chapters X–Y of N; this is one slice —
calibrate every score to the book's FULL emotional range, beginning to end. No
extra calls, no added latency; the batches simply stop pretending their slice is
the whole book. This is the "know the start, where you are, and the end" principle
applied at the cheapest seam.

Current code: `_buildScoringPrompt(chapters, bookTitle, totalChapters)` in
`src/pipeline/storyShape.ts`.

### Stage 2 — Blackboard packets + merge reconciliation (IMPLEMENTED)

Keep the fast parallel scoring, but stop treating the returned numbers as final.
Each scoring task should publish a compact semantic packet to the blackboard,
then one final merge/reconciliation task should read all packets and recalibrate
the chapter scores into a coherent whole-book emotional arc.

This is the target architecture:

1. **Pass 1: score + report**
   - Every batch scores its chapters as it does now.
   - Every batch also emits a compact "what I found" packet:
     - chapter range
     - score array
     - local min/max
     - major emotional turn(s)
     - dominant emotional labels
     - one short preview sentence for the slice
     - seam notes: how the slice enters and exits emotionally
   - These packets are the blackboard language. They should be terse,
     inspectable, and useful to another agent.

2. **Pass 2: merge/reconcile**
   - One merge task depends on all batch tasks.
   - It receives every packet.
   - It produces final globally calibrated chapter scores.
   - It should preserve local discoveries but normalize scale across the whole
     book.
   - It should explicitly smooth bad seams between adjacent batches.

3. **Fallback**
   - If merge fails, use the current rough batch scores.
   - Never block analysis just because coherence reconciliation failed.

#### Why this design

This preserves parallel speed. A sequential rolling reader would be closer to a
human reading forward, but it would be much slower on local hardware. The
blackboard + merge approach gives most of the coherence benefit with only one
extra reconciliation call.

#### Current Odysseus primitives to use

`src/api/llmClient.ts` already exposes:

- `runOdysseusParallel(request)`
- `OdysseusParallelTask.packet_mode`
- `depends_on`
- `merge_agent`
- `merge_prompt`
- `result.packets`
- `result.merge`

Do not build a new parallel runner for this stage. Use this existing API.

#### Current Lumina entry points

Primary file:

- `src/pipeline/storyShape.ts`

Functions to update:

- `scoreChaptersParallel(...)`
- `_buildScoringPrompt(...)`
- add helper: `buildScoringBlackboardPrompt(...)`
- add helper: `parseScoringBatchResult(...)`
- add helper: `buildArcMergePrompt(...)`
- add helper: `parseMergedScores(...)`

Useful existing types/imports:

- `OdysseusParallelTask`
- `runOdysseusParallel`
- `AnalysisProgressReporter`

#### Batch task output format

Change each parallel score task so it returns JSON, not only a bare array.

Required JSON shape:

```json
{
  "scores": [-0.2, -0.4, 0.1],
  "packet": {
    "range": { "startChapter": 1, "endChapter": 3, "totalChapters": 30 },
    "localMin": -0.4,
    "localMax": 0.1,
    "dominantTone": ["dread", "uncertainty"],
    "turningPoints": [
      { "chapter": 2, "label": "first collapse", "direction": "fall" }
    ],
    "entryTone": "uneasy setup",
    "exitTone": "pressure rising",
    "preview": "The opening slice begins in uncertainty and exits under stronger pressure.",
    "confidence": 0.74
  }
}
```

If Odysseus' packet extraction already creates `_semantic_packet`, the prompt
should still make the model put this same compact packet in the JSON so Lumina
can parse it reliably from `result.content`. The runner-level packet is a bonus;
the local parse is the source of truth.

#### Merge task input

The merge task should receive compact inputs only:

- book title
- total chapter count
- every batch packet
- every rough score with chapter index/title

It does **not** receive full chapter text.

This keeps the merge cheap and context-friendly.

#### Merge task output format

Required JSON shape:

```json
{
  "scores": [-0.35, -0.5, -0.1],
  "globalMin": -0.8,
  "globalMax": 0.7,
  "arcSummary": "The book starts under pressure, falls into collapse, then rises through partial recovery.",
  "seamCorrections": [
    {
      "between": "batch 1 and batch 2",
      "reason": "batch 2 overestimated neutral scenes after a very dark opening",
      "adjustment": "lowered chapters 9-11 by 0.15"
    }
  ],
  "confidence": 0.82
}
```

Only `scores` is required for runtime. The rest is for diagnostics/workflow logs.

#### Implementation details

1. In `scoreChaptersParallel`, still create batches of 8.
2. Each `OdysseusParallelTask` should:
   - use `packet_mode: "compact"`
   - include a prompt requiring the JSON object above
   - include current horizon language from Stage 1
3. Call `runOdysseusParallel` with:
   - same workflow type: `chapter-scoring`
   - `max_concurrency`: keep at 6-8 unless testing shows local workers bottleneck
   - `merge_agent: "reading"`
   - `merge_prompt: buildArcMergePrompt(...)`
4. After result:
   - parse every batch result into rough scores and packet objects
   - fill failed batches with `heuristicSentiment`
   - attempt to parse `result.merge`
   - if merge returns a valid `scores` array with the exact chapter count, use it
   - otherwise use rough scores
5. Clamp all scores to `[-1, 1]`.
6. Preserve chapter order by writing scores into `scores[chapter.index]`, not just
   batch-relative array order.
7. Add diagnostics:
   - `story_shape.parallel_scoring.complete`
   - `story_shape.merge_reconcile.complete`
   - `story_shape.merge_reconcile.failed`
   - include batch count, score count, merge confidence if present.
8. Progress messages:
   - before parallel pass: "Scoring chapters in parallel..."
   - before merge: "Reconciling chapter batches into one emotional arc..."
   - after merge: "Arc scoring reconciled..."

#### Important behavior rules

- The merge task must never receive entire chapter text.
- The merge task must not invent chapter events not represented in packets/titles.
- The merge task may adjust score scale and seams, but not reorder chapters.
- Failed batch packets must not crash the whole analysis.
- If the merge output length does not equal chapter count, reject it and use rough scores.
- If Gemini provider is active, keep the existing sequential Gemini scoring path.
  Stage 2 is for Odysseus parallel scoring first.

#### Acceptance criteria

- An Odysseus analysis still completes if any one scoring batch fails.
- `scoreChaptersParallel` returns exactly one score per chapter.
- Workflow logs show the parallel score batches and the merge/reconcile step.
- Diagnostics show whether merge was used or fallback rough scores were used.
- The resulting emotional arc should have fewer batch seams than Stage 1.
- Build passes with `npm run build`.

Implementation landed in `src/pipeline/storyShape.ts`. Odysseus scoring now asks
each batch for a compact blackboard packet, runs a merge/reconciliation prompt,
uses the merged score array only when it exactly matches the chapter count, and
falls back to parsed batch scores or heuristic scores when needed.

#### Optional but recommended diagnostics artifact

If time allows, persist or expose an inspectable arc summary string somewhere in
diagnostics. Do **not** add new storage tables in this stage unless necessary.
Stage 3 will handle real persistent artifact files.

### Stage 3 — Agent artifact workspace (DESIGNED)

Give each pipeline run a real working directory on the Odysseus side
(`data/artifacts/{run_id}/arc.md`, `lore.md`, `scenes.json`) that agents read and
write across steps, instead of passing everything through prompt context. This is
the "file system for the AI": the arc becomes an inspectable, resumable document
the agent constructs piece by piece. Generalizes the parallel runner's existing
in-memory "packets" into persistent, richer artifacts.

## Principles

1. Never hold the whole book in one context; always know the horizon (start,
   position, end) so each piece is calibrated to the whole.
2. Speed-vs-coherence is a real tradeoff — keep the fast path, make deeper
   coherence opt-in, always have a graceful fallback.
3. Artifacts are documents the AI builds and can re-read — not one-shot prompt
   stuffing.
4. One pipeline owns its run context at a time (see the analysis re-entrancy lock).
5. Parallel workers communicate through packets and merge tasks, not literal
   live chat.
