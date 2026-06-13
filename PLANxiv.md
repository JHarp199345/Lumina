# PLAN XIV: Reader-Controlled Artifact Memory and Image Canon

## Current Build Boundary

Do not build cross-book image canon retrieval or quality reanalysis yet.

Those ideas stay in this plan as future design notes only. The active build is
the safer foundation:

- durable current-book artifact stamps
- current-book blackboard notes
- retrieval helpers that do not affect generation unless explicitly wired later
- no automatic use of archived images
- no automatic image quality scoring/reanalysis loop

## Core Principle

Lumina preserves expensive artifacts by default, but it does not automatically use
old artifacts to influence new generations unless the reader explicitly enables
that behavior.

Artifacts are durable, organized, and deletable by the reader. They are not
deleted by app updates, refreshes, reopens, or version bumps.

## What Already Exists

Lumina already has much of the base:

- archive entries
- generated image records
- image metadata
- book IDs
- scene IDs
- word positions
- semantic maps
- visual lore dossiers
- visual slot keys
- archive/purge UI patterns
- per-book generated artifact storage

The next step is not to preserve artifacts. That is already the direction. The
next step is controlled retrieval: deciding when old artifacts are allowed to
help future generations.

## Reader-Controlled Memory Modes

Add a per-book or global setting later:

1. **Off**
   - Default.
   - New image generation uses only the current book's current semantic map,
     current visual lore, current scene text, and current style seed.
   - Archived/past images do not influence generation.

2. **This Book**
   - Lumina may use older images/artifacts from the same book.
   - Useful when rereading a book and wanting visual continuity.
   - Must still respect stamps: scene position, chapter, visual slot, generation
     version, style seed, and source text range.

3. **Same Series / Same Canon**
   - Lumina may use images/artifacts from related books.
   - Example: several Star Wars books already read, and a new Star Wars book is
     being generated.
   - This requires strong filtering so unrelated images do not contaminate a
     scene just because they share a franchise label.

4. **Library-Wide**
   - Advanced/experimental.
   - Lumina may search the whole local image canon for visual inspiration.
   - Should be opt-in and probably hidden behind a clear warning because it can
     increase compute and produce weird cross-book influence.

## Artifact Stamps

Every artifact used for retrieval should have enough stamp data to explain why it
was selected:

- `bookId`
- `bookTitle`
- `author`
- optional series/canon/universe label
- `sceneId`
- `visualSlotKey`
- `chapterId`
- `chapterTitle`
- `sourceStartWord`
- `sourceEndWord`
- `wordPosition`
- `styleSeed`
- `createdAt`
- `generationVersion`
- `analysisVersion`
- emotional tags
- motifs
- entities
- visual lore terms
- quality score when available
- reader rating when available

If an artifact lacks stamps, it can still remain preserved, but it should be
lower-confidence for retrieval.

## Retrieval Pipeline

When Lumina is generating an image for a current scene:

1. Build a current scene query:
   - current book
   - current chapter
   - absolute word range
   - nearby text
   - scene entities
   - motifs
   - emotional vector
   - visual lore terms
   - style seed

2. Select candidate artifacts:
   - same book first
   - same series/canon only if enabled
   - library-wide only if enabled
   - never include unrelated books by default

3. Score candidates:
   - position proximity
   - entity overlap
   - motif overlap
   - emotional similarity
   - setting/world/canon match
   - style compatibility
   - reader rating
   - image quality score
   - recency only as a weak signal

4. Produce the top candidates.

5. Run a reanalysis/filter step:
   - Ask why each candidate is relevant to the current scene.
   - Reject shallow matches.
   - Example rejection: "Chewbacca rescuing Princess Leia" should not influence
     "Luke fighting Darth Vader" just because both are Star Wars.

6. Use only the final approved artifacts as inspiration.

## Confidence and Reanalysis

Candidate retrieval should produce a confidence score. A second pass should
audit that score:

- Is this actually about the same character, object, place, or visual problem?
- Is it merely the same franchise/universe?
- Does it help composition, palette, silhouette, or continuity?
- Could it confuse the current scene?
- Is the image quality good enough to be worth referencing?

If confidence drops after audit, replace the candidate or proceed without it.

## Quality Score

Image quality can be estimated later from multiple signals:

- reader favorite/rating
- whether the reader regenerated over it
- whether the image was kept through rereads
- technical image analysis
- prompt adherence
- composition clarity
- whether key entities are present
- whether it matches its source passage

Quality score should never be the only retrieval criterion. A beautiful but
irrelevant image is still a bad reference.

## Safety and Control

Past artifacts are inspiration only.

They should not cause Lumina to:

- copy a previous image exactly
- force an old composition into a new scene
- mix unrelated franchises/books
- override the current passage
- override the reader's current style seed unless explicitly requested

The current book passage remains the source of truth.

## UI Direction

Eventually expose this as a controlled option, probably in the image/gallery or
book artifact settings:

- `Use Past Visual Memory`
- Off / This Book / Same Series / Library-Wide
- optional "Prefer continuity" toggle
- optional "Prefer fresh interpretation" toggle
- artifact cleanup panel with delete actions

The UI should make deletion easy and deliberate. It should never bury destructive
actions in automatic maintenance.

## Open Questions

- How should Lumina identify same-series or same-canon relationships?
- Should reader-created tags override automatic canon detection?
- Should image similarity be local-only, Gemini-assisted, or both?
- How much RAM/CPU can Odysseus spend on local image analysis before it hurts the
  reader experience?
- Should library-wide retrieval be hidden until the local confidence scorer is
  proven reliable?

## Current Decision

Do not implement automatic archived-image inspiration yet.

First implementation should be:

1. Preserve artifacts durably.
2. Make artifacts easy to inspect and delete.
3. Add an explicit setting for artifact memory.
4. Retrieve candidates only when enabled.
5. Require a confidence/reanalysis gate before old images influence new ones.
