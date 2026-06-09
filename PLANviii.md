# PLANviii — Re-Ingestion + clean generation lifecycle

## The problem this fixes

Generated artifacts (images, audio, study, SIP) never cleanly leave the active set, so
a previous generation bleeds into the current gallery. Two root causes:

1. **Deterministic scene ids** — `scene_..._${bookId}_${chapterId}`. bookId (title+author
   hash) and chapter ids are stable across re-analysis/re-import, so old images re-match
   the "same" scene in a new plan and are silently reused.
2. **Archiving never removes the blobs** — `archiveAndRemoveBook` writes archive *counts*
   and deletes the semantic map/structure/etc., but leaves `image_meta/blobs` and
   `audio_meta/blobs` in the active stores. The archived set is still physically active.

Result: archive a set → re-import the same book → its old blobs reload and flood the
current filmstrip. The "don't regenerate" rule, taken to an extreme, means a generation
never actually retires.

## The decision (replaces three fuzzy actions with one explicit one)

**Remove** these actions entirely:
- "Re-analyze This Book"
- "Regenerate All Images"
- "Regenerate Image" (single)

**Add** one action: **Re-Ingest** — a slide-to-confirm control (destructive-adjacent, so
it needs the deliberate slide gesture, like "regenerate all" used to).

### What Re-Ingest does, in order

1. **Snapshot the current active generation into the Archive.** All currently-active
   *generated* artifacts (images, audio, study guide/quizzes/flashcards, semantic map,
   SIP) become an archived generation for this book.
2. **Clear the active generated set.** The gallery is now empty/clean — the active scope
   holds nothing from the prior generation.
3. **Re-lay the groundwork (fresh).** Re-run analysis → new semantic map, SIP, visual
   plan. This is the point of re-ingest (e.g. a corrected fiction/expository
   classification produces a different plan).
4. **Do NOT batch-generate images.** The one-at-a-time read-ahead protocol stays. Images
   fill in as the reader reaches each slot.

### The Archive lifecycle (make it real)

- Archived artifacts are excluded from the active gallery/load filters — they can never
  bleed into the current generation again.
- They remain viewable and deletable in the Archive, and are cleared by wiping browser
  data (web) / deleting the archive (either runtime).
- Implementation: artifacts carry an explicit lifecycle marker (e.g. `archived: true` +
  an `archiveGeneration` id) OR live in archive-scoped stores; the active loaders
  (`loadImages`, `loadAudioArtifacts`, etc.) return only active records.

## What to PRESERVE, REUSE, or make FRESH

### Always preserve — never archived, never touched by Re-Ingest (user data + the book)
- Highlights, notes, reading progress.
- The imported EPUB file and the parsed structure (the book itself — not a "generation").
These survive every Re-Ingest untouched. Notes/highlights are anchored by CFI/char-offset
and remain valid because the text is unchanged.

### Reuse — adopt from the just-archived generation instead of regenerating
The reuse key is **(analysisProtocol, styleSeed, visualSlotKey)**. An archived image is
adopted for a new slot only when all three match. Checked **lazily**, by the read-ahead
trigger, right before it would generate:

```
read-ahead about to fill slot X
  → look in the archived generation for an image with
      same analysisProtocol AND same styleSeed AND same visualSlotKey
  → match  → adopt it into the active set (instant, no API call)
  → none   → generate one image (existing one-at-a-time path)
```

Why this key is correct:
- **Same settings re-ingest** → every slot matches → near-free, reuses everything.
- **Re-ingest after a classification fix** (protocol flips narrative↔expository) → nothing
  matches → correctly regenerates, never resurrects the wrong-style art.
- **Changed style seed** → nothing matches → regenerates in the new style.

Same pattern, lower priority, for:
- **Audio** — reuse key `(scope signature, voice, style, chapter/text hash)`.
- **Study guide / quizzes / flashcards** — reuse key `(chapter/section content hash)`;
  identical text → the study artifacts are still valid.

Adoption COPIES the archived artifact into the new active generation (it stays in the
archive too), so the active gallery is always self-contained and the archive stays a true
historical record.

### Make fresh — the groundwork (cheap relative to images, and the reason to re-ingest)
- Semantic map, Source Intelligence Profile, visual plan. Always re-derived on Re-Ingest.
  (If the EPUB is byte-identical the parsed structure can be reused to skip re-parsing.)

## Why this is the cleanest model

- **One active generation per book** in the gallery. Always self-contained.
- **Every prior generation cleanly filed** in the archive; nothing crosses over.
- **The "don't replace unless explicit" rule stays — but scoped to a generation.**
  Re-Ingest IS the explicit replacement; within a generation, individual slots still
  aren't churned.
- **Cost stays low** via lazy `(protocol, style, slot)` reuse from the archive — re-ingest
  is only as expensive as what genuinely changed.

## Build order (when approved)

1. Lifecycle marker on generated artifacts (`archived` + `archiveGeneration`), and make
   the active loaders filter to active-only. Types + web + tauri storage.
2. `reIngest(book)` orchestration: archive-current → clear-active → fresh analysis →
   leave images to read-ahead.
3. Lazy reuse in the read-ahead trigger: `(protocol, style, slot)` lookup in the archived
   generation before generating; adopt on match.
4. UI: remove Re-analyze / Regenerate-all / Regenerate-single; add the **Re-Ingest**
   slide-to-confirm control (Settings/Visual panel).
5. Audio + study reuse keys (lower priority, same shape).
6. Verify: a corrected classification re-ingest produces clean new-style art with no old
   leakage; a same-settings re-ingest reuses everything; notes/highlights/progress
   survive untouched.

## Open question to confirm before building
- Confirm Re-Ingest fully replaces all three old actions (no "regenerate single image"
  survives in any menu). Recommended: yes — single-image regen is gone; if one slot is
  bad, a Re-Ingest (cheap via reuse) refreshes the plan, or a future per-slot action can
  be added back deliberately.

*Plan only — no code yet.*
