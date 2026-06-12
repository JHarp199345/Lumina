# PLAN XII: Narrative Illustration Scheduling

## Objective

Lumina should not cap a book at a tiny fixed number of images. It should build a narrative-aware illustration schedule from the story map, then plan and generate images in batches as the reader moves through the book.

The reader experience should feel expansive: a long book or collection can eventually produce a large visual story. The app should not spend time or money planning/generating the whole thing up front.

## Principles

1. Images are chosen by narrative function, not by a fixed word interval.
2. Payoff, revelation, reversal, promise, cost, and aftermath beats deserve priority.
3. Good illustration does not illustrate everything. It selects moments that add emotional, visual, or structural meaning.
4. Planning and generation are separate costs.
5. Full-book or collection support requires batching.
6. Reader-requested images are a separate layer from the default narrative schedule.

## Current State

Lumina already creates a semantic map with:

- emotional arc
- inflection points
- narrative blueprint
- planned scenes
- storyboard beats
- generation intent

Current limitation:

- `goldenNumber` selects only a small default set.
- `planned_only` scenes appear in the gallery but do not auto-generate.
- visual direction briefs are only generated for default scenes.
- a long book/collection can feel visually underplanned even when the parser has more usable chapters.

## Target Model

### Narrative Illustration Schedule

Stored in the semantic map as storyboard beats.

Each beat should answer:

- where in the book it happens
- what narrative function it serves
- whether it is currently active for generation
- whether it is only planned for later
- whether it was reader-requested

### Batch Promotion

Instead of a permanent cap:

- first batch activates around the opening
- as the reader advances, Lumina activates the next batch
- if the reader jumps ahead, Lumina activates the batch near that position
- activated scenes receive visual director briefs
- generated images are still created only on demand/read-ahead

### Generation

Images generate when:

- reader reaches an active trigger
- reader taps a gallery placeholder
- reader explicitly generates current/all active batch images

No automatic whole-book generation unless the user deliberately requests it.

## Pass 1

Implement the batch promotion foundation.

- Add visual scheduling config:
  - active batch size
  - promotion threshold
  - max newly activated scenes per pass
- Add a service that promotes `planned_only` storyboard beats to `default` near the current reader position.
- Persist the updated semantic map.
- Generate director briefs for newly activated scenes only.
- Call promotion from read-ahead and manual gallery generation before image generation.
- Keep gallery language simple: planned moments remain visible; active moments can be composed.

## Pass 2

Improve schedule intelligence.

- Replace simple forward-window promotion with narrative function grouping.
- Favor sequences like setup/build/payoff/cost/aftermath.
- Ensure payoff beats pull in one or two meaningful lead-in beats where available.
- Avoid too many consecutive high-intensity beats.

## Pass 3

Reader-requested highlight images.

- User highlights passage.
- Action: generate image from highlighted passage.
- Scene becomes `reader_requested`.
- Gallery slots it between surrounding narrative schedule images.
- Gallery frame/border uses highlight color.
- Image remains anchored to highlighted text.

## Pass 4

Advanced gallery controls.

- Generate current active batch.
- Continue planning next batch.
- Generate all currently planned images.
- Optional long-running "complete visual story" mode with clear cost/time warning.

