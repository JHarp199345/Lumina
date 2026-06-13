# PLAN XIII: Coherent Arc Building — Horizon Awareness, Rolling State, Agent Workspace

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

This is a well-known pattern: **map-reduce / refine with carried state**, plus a
**persistent artifact workspace** the agent reads and writes across steps.

## Stages

### Stage 1 — Horizon awareness in scoring (SHIPPED)

Keep the fast parallel batches, but stop scoring in a vacuum. Each batch is told:
the book has N chapters; you are scoring chapters X–Y of N; this is one slice —
calibrate every score to the book's FULL emotional range, beginning to end. No
extra calls, no added latency; the batches simply stop pretending their slice is
the whole book. This is the "know the start, where you are, and the end" principle
applied at the cheapest seam.

Code: `_buildScoringPrompt(chapters, bookTitle, totalChapters)` in
`src/pipeline/storyShape.ts`.

### Stage 2 — Rolling carried-state refine (DESIGNED)

After the parallel rough pass, walk the chapters in reading order carrying a
compact **arc-so-far** state (running trajectory + one-line beat notes), so each
step scores in the context of what came before — like reading the book forward.
Cheap variant: a single whole-arc recalibration call that sees every chapter's
index/title/rough-score at once (numbers + titles fit the window easily) and
returns a smoothed, globally-calibrated arc. Optional setting for users who want
maximum coherence over raw speed; the rough scores remain the fallback.

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
