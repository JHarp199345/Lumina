# PLAN XII: Narrative Illustration Scheduling

## Objective

Lumina should not cap a book at a tiny fixed number of images. It should build a narrative-aware illustration roadmap from the story map, show the reader the intended visual moments up front, then prepare and generate images only when useful.

The short version:

**Full roadmap, paced direction, one-at-a-time generation, weighted reader control.**

The reader should be able to see that the whole book has a visual pathway. Lumina should not spend time, API calls, or local worker time writing every detailed prompt or generating every image before the reader needs them.

## Principles

1. Images are chosen by narrative function, not by a fixed word interval.
2. Payoff, revelation, reversal, promise, cost, and aftermath beats deserve priority.
3. Good illustration does not illustrate everything. It selects moments that add emotional, visual, or structural meaning.
4. Roadmap, direction, and generation are separate costs.
5. Full-book or collection support requires paced preparation.
6. Reader-requested images are a separate layer from the default narrative schedule.
7. Absolute word positions are the source of truth.
8. Local/Odysseus resources must not be flooded by jumpy gallery browsing.

## Vocabulary

### Roadmap Slot

A roadmap slot means:

- an image belongs at this exact book position
- it has a chapter/section anchor
- it has an absolute word position
- it has a public title/label
- it has a story function such as opening, setup, suspense, reveal, payoff, cost, aftermath
- it may not have a detailed image direction yet

Roadmap slots should exist for the whole selected visual story after book analysis.

### Directed Slot

A directed slot means Lumina has written the detailed visual direction for the image.

It has:

- a public-facing visual brief
- weighted visual elements
- hidden internal prompt/director brief
- optional reader edits
- optional analyzed reference images

A directed slot can be generated.

### Generated Slot

A generated slot means the image file exists and is saved.

It has:

- cached image artifact
- stable scene id
- stable visual slot key when applicable
- absolute word position
- generation metadata

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
- batch promotion currently chooses nearby future scenes by word position, not yet by narrative group logic.
- reader-selected image generation exists, but it is not yet polished as a first-class visual slot editor.

## Target Model

### Full Visual Roadmap

When the reader analyzes a book, Lumina should create the whole visual roadmap.

This roadmap should answer:

- where image slots belong
- how many selected visual moments the book should have
- each image slot's absolute word position
- each image slot's story purpose
- whether the slot is planned, directed, generated, or reader-requested

The roadmap should be fast enough to complete during analysis. It should not require generating every prompt or image.

### Paced Direction

Detailed visual directions should be prepared in controlled passes.

Normal reading:

- prepare a small group ahead of the reader
- usually 6-8 slots
- do this only when the reader naturally approaches the end of currently directed slots

Jumping/gallery browsing:

- do not prepare a whole group
- prepare only the one requested slot
- if the reader jumps repeatedly and requests many images quickly, show a resource warning and do not pile up local/API work

This protects Odysseus/local workers and keeps cloud/API usage sane.

### Generation

Images generate when:

- reader reaches an active trigger
- reader taps a gallery placeholder
- reader highlights a passage and explicitly asks for an image

No automatic whole-book generation.

No automatic batch image generation.

Generation remains one-at-a-time unless a future feature deliberately adds a controlled queue with a cost warning.

### Reader-Facing Visual Brief

Readers should not see raw prompts.

Each visual slot can expose a clean public brief:

- title
- story function
- short teaser
- visible tags
- expected depiction summary
- why Lumina chose this moment
- optional reader direction field

Tags can be clickable. Clicking a tag opens a small description of what that tag contributes to the image.

The reader may add direction, but that direction is stored separately from the hidden internal prompt.

### Weighted Reader Direction

Reader edits should support weights so Lumina knows what matters most.

Examples:

- required element, weight 10
- important mood, weight 7
- optional background detail, weight 3
- avoid, weight 10

If the reader asks for something strange, such as a spaceship in Romeo and Juliet, Lumina should honor it as a reader override. The system should know it is not canonical book content, but it is still the reader's requested image.

### Reference Images

Reader visual direction should support image references.

Allowed inputs:

- images the reader owns
- images the reader created
- licensed images
- images they have permission to use
- sketches
- screenshots
- maps
- character sheets
- mood boards

The UI must warn:

**Add only images you own, created, licensed, or have permission to use.**

Reference images should be analyzed before generation.

Provider order:

1. Odysseus/local vision if available
2. Gemini vision if Google key exists
3. store as unanalyzed reference if no vision provider exists

The analysis should extract traits, not copy the source image:

- subject traits
- silhouettes
- palette
- materials
- clothing/armor
- composition
- lighting
- mood
- things to preserve
- things to avoid copying exactly

### Highlight-To-Image

Highlight-to-image should be a first-class reader action.

When the user highlights a passage, the action bar should offer:

- highlight lenses
- note
- generate image

When the reader generates an image from a highlight:

- create a `reader_requested` visual slot
- anchor it to the exact selected word position
- use the selected passage as source material
- preserve the highlight/lens color metadata
- slot it into the gallery by absolute word position
- visually frame/tint it with the highlight style
- allow regeneration without losing the same anchor

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

Current Pass 1 status:

- implemented as foundation
- needs corrected jump behavior so jumps prime one slot, not a whole batch
- needs public warning state for rapid visual requests

## Pass 2

Improve roadmap and schedule intelligence.

- Keep absolute word position display logic simple.
- Use beat types during planning, not display.
- Replace simple forward-window promotion with narrative function grouping during normal reading.
- Favor sequences like setup/build/payoff/cost/aftermath.
- Ensure payoff beats pull in one or two meaningful lead-in beats where available.
- Avoid too many consecutive high-intensity beats.
- Build roadmap slots for the whole selected visual story during analysis.
- Keep later slots as planned placeholders until direction is needed.

## Pass 3

Reader-requested highlight images.

- User highlights passage.
- Action: generate image from highlighted passage.
- Scene becomes `reader_requested`.
- Gallery slots it between surrounding narrative schedule images.
- Gallery frame/border uses highlight color.
- Image remains anchored to highlighted text.
- Add weighted reader direction.
- Add image reference support with ownership warning.
- Analyze reference images into structured visual guidance.

## Pass 4

Visual slot editor.

- Open a planned/generated slot.
- Show clean public visual brief, not raw prompt.
- Show title, story function, teaser, tags, expected depiction.
- Let reader add weighted text direction.
- Let reader add reference images.
- Show reference image analysis status.
- Store reader direction with the slot.
- Regenerate explicitly using the same anchored slot.

## Do Not Build

- Do not add a "generate current batch" button.
- Do not add a "complete visual story" mode.
- Do not auto-generate large groups of images.
- Do not expose raw prompts in the UI.
- Do not let jumpy gallery browsing create uncontrolled background planning calls.
