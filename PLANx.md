# PLANx — Durable Modular Persistence
# The "never lose the reader's work on an update" database

*Plan only — no code yet. This is the foundation the sidelined plans (PLANviii Re-Ingest,
PLANix Networks) sit on. Build this first.*

---

## THE PROBLEM (from lived experience, not theory)

Lumina is a **PWA that auto-deploys several times a day** (GitHub Pages → the reader's
installed app). The reader's entire library — imported EPUBs, generated images, analysis,
notes, highlights, progress — lives in **IndexedDB** on the web build (`WebStorageAdapter`)
and **SQLite** on Tauri (`services/db.ts`). The reader's primary runtime is the tablet PWA.

What went wrong: over a few days the IndexedDB version climbed **2 → 8** (one bump per
feature). A version/service-worker desync then made `indexedDB.open(name, lowerVersion)`
throw `VersionError`, every read failed, and the **whole library appeared to vanish** —
even though the data was physically intact on disk. The fragility was structural:

- A single hand-bumped `DB_VERSION` and one all-at-once `onupgradeneeded`.
- No tolerance for the running code being *older or newer* than the on-disk schema.
- No structural distinction between "the reader's irreplaceable stuff" and "scratch."

**The requirement, in the reader's words:** updating the app — several times a day —
must **never delete the images (or notes, or anything) the reader already has.** The
schema grows by *adding* (new tables/stores, new columns/fields) and *only* adding. If we
ever reach a point where an update deletes a reader's images, we've designed it wrong.

---

## PRINCIPLES (the non-negotiables)

1. **Additive-only schema.** A migration may CREATE stores / tables / indexes / columns.
   It may **never** drop, clear, truncate, or rewrite existing data. There is no
   "destructive migration" path at all.

2. **Reader data is sacred; the boundary is structural, not a convention.** Every store
   carries a lifecycle class (below). App updates touch only `cache`. `userData` and
   `generated` are removed **only by explicit reader action** (delete book, Re-Ingest →
   archive, purge archive) — never by a deploy.

3. **Forward/backward tolerant.** The app must open and read its database whether the
   on-disk schema is **older or newer** than the running code:
   - on-disk newer than code (stale bundle) → open *versionless*, read what exists,
     ignore unknown stores. (Already shipped as the `VersionError` fallback in `openDb`.)
   - on-disk older than code → additive upgrade brings it forward.
   - missing store / missing field → read as empty / default, never throw.
   No version skew may ever blank the library again.

4. **Idempotent, declarative migrations.** A registry of append-only steps, each
   "ensure-style" (create-if-absent). Running any subset, or all of them twice, is safe.
   `DB_VERSION` is **derived from the registry length**, not hand-edited.

5. **One interface, two engines.** Everything routes through `StorageAdapter`. Web
   (IndexedDB) and Tauri (SQLite) implement the same additive contract; neither is allowed
   a destructive shortcut.

6. **Adding a field is free.** On web, IndexedDB stores whole objects — a new field on a
   record needs **no migration**; old records simply lack it and read with a default. On
   SQLite it's an additive `ALTER TABLE ADD COLUMN … DEFAULT` (the pattern already used for
   `semantic_maps`). "Add a column when we need more info later" — exactly, and never a
   rewrite.

---

## DATA CLASSIFICATION (the heart of it)

Every store/table is tagged with one lifecycle class. This single tag is what makes
"never delete the reader's stuff on update" enforceable instead of remembered.

| Class | What's in it | On app update | Removed only by |
|---|---|---|---|
| **userData** | imported EPUB bytes, parsed structure, highlights, notes, reading progress, study attempts/badges, (future) networks & note provenance | **never touched** | explicit "delete book" / "delete note" |
| **generated** | images, audio, semantic map, SIP, study guide/quizzes/flashcards, presentation decks | **never touched** | explicit Re-Ingest (→ archived, PLANviii) or delete-book |
| **cache** | purely derived, cheap to rebuild (session blob URLs already; future paragraph embeddings, search indexes) | **safe to clear** | freely, on a cache-epoch bump |

The registry holds `{ storeName, class, keyPath, indexes[] }` for every store. The rule
"a deploy may only ever clear `cache`" becomes a property the code can assert, not a habit.

> Note: `generated` is preserved by default precisely because remaking it costs the reader
> Google quota and time. Deleting images is the worst-case outcome; the design's whole job
> is to make that *structurally impossible* outside an explicit, reader-initiated action.

---

## THE MIGRATION FRAMEWORK — WEB (IndexedDB, the primary runtime)

Replace the single hand-bumped `DB_VERSION` + monolithic `onupgradeneeded` in `webDb.ts`
with a **declarative, append-only migration registry**:

```
// conceptual shape — not final code
const MIGRATIONS = [
  { id: 1, ensure: (db) => { /* books, structures, epubs, progress … */ } },
  { id: 2, ensure: (db) => { /* highlights, notes (+ bookId index) */ } },
  … one entry per feature, in the order they shipped …
];
const DB_VERSION = MIGRATIONS.length;   // derived, never hand-edited
```

- `onupgradeneeded` runs every migration with `id > event.oldVersion`. Each migration is
  **idempotent** (`createObjectStore`/`createIndex` only if absent), so a partial or
  repeated run is harmless.
- **Append-only law:** you never edit a shipped migration; new work appends a new one.
- **Resilience helpers** (so version skew can't crash a read):
  - `openDb` keeps the shipped `VersionError → versionless open` fallback.
  - a `withStore(name, mode, fn)` wrapper that, if `name` doesn't exist on this DB,
    returns the empty/no-op result instead of throwing. An older bundle meeting newer data
    (store it doesn't know) ignores it; a newer bundle meeting older data (store not yet
    created) reads empty.
- **Guard rail (test):** a unit test asserts (a) no migration string contains
  `deleteObjectStore`/`.clear(`, and (b) the already-shipped migrations are unchanged
  (hash check) so nobody accidentally rewrites history.

This is a **pure refactor of today's behavior** — same stores, same data, just expressed
as an additive registry with skew-tolerance. It changes nothing the reader sees; it makes
the next 100 deploys safe.

---

## THE MIGRATION FRAMEWORK — TAURI (SQLite)

Mirror the same discipline in `services/db.ts`:

- `CREATE TABLE IF NOT EXISTS` for new types (already the pattern).
- Additive `ALTER TABLE … ADD COLUMN … DEFAULT …` wrapped in `try/catch` for new fields
  (already used for `semantic_maps`). Never `DROP`/`DELETE` on upgrade.
- `ON DELETE CASCADE` is allowed only for *explicit* deletes (delete-book), never triggered
  by a schema change.
- Same lifecycle classes; the active loaders filter to active (non-archived) records.

---

## ESCAPE HATCH — EXPORT / IMPORT (belt and suspenders)

Because this deploys several times a day to real readers, give them a self-rescue that's
independent of schema entirely (the lineage of the existing `clear-sw.html` recovery page):

- **Export** — dump all `userData` + `generated` records (metadata as JSON, image/audio as
  blobs) into a single downloadable `.lumina` bundle.
- **Import** — restore a bundle into the current schema (additively; never wipes first).

This means even a worst-case future bug can't permanently cost a reader their library — they
hold a portable copy. It also fits "open-source, publicly available": a reader can back up
and move their own data.

---

## HOW THIS UNLOCKS THE SIDELINED PLANS (modularity, concretely)

- **PLANviii (Re-Ingest + archive):** archived artifacts become new `generated`-class,
  **archive-scoped stores**; the active loaders filter by class, so a prior generation can
  never bleed into the current gallery. Adding them = appending migrations. Nothing existing
  is touched.
- **PLANix (Networks):** `relational_networks`, `network_notes`, `note_provenance_links`,
  `network_media_assets`, and note embeddings are just new `userData`/`generated` stores +
  additive fields. The Note→NetworkNote migration is **shadow-written** (write the new
  shape alongside the old; remove nothing) — exactly the additive law above.

So "build the modular database first" isn't busywork — it's the safety substrate that makes
every later feature a safe append instead of a risky rewrite.

---

## BUILD ORDER

1. **Store registry + lifecycle classes.** Define `{ store, class, keyPath, indexes }` for
   every existing store. Pure inventory; no behavior change.
2. **Declarative migration list (web).** Refactor the monolithic `onupgradeneeded` into the
   append-only registry; derive `DB_VERSION` from it. Behavior-identical, verified against a
   populated DB (existing data still loads).
3. **Skew tolerance.** `withStore` safe-missing-store wrapper; formalize the versionless
   fallback. Add tests that a missing/extra store and a missing field never throw.
4. **Guard rail test.** Assert migrations are append-only and contain no destructive calls.
5. **Export / Import rescue bundle.**
6. **Mirror in SQLite (Tauri).** Same registry discipline + additive ALTERs.
7. **Write the rule down** (AGENTS.md / CONTRIBUTING): schema changes are additive; never
   edit a shipped migration; classify every new store; only `cache` may be cleared on update.

Steps 1–4 are the ones that directly end the data-loss risk and are worth doing before any
new feature. 5–7 harden it.

---

## OPEN QUESTIONS

1. **Cache-clear mechanism.** A `cacheEpoch` constant that, when bumped, clears only
   `cache`-class stores on next open — vs. letting cache grow and pruning by age/size. Lean:
   age/size prune, no epoch, so an update never even clears cache unless asked.
2. **Export bundle format & size.** JSON manifest + raw blobs zipped? Cap or stream for
   large image libraries?
3. **`DB_VERSION` as a content hash of the registry** (vs. length) to make an accidental
   skipped/duplicate migration impossible. Probably overkill at this scale — length + the
   append-only test is enough. Confirm.
4. **Do we ever *need* a destructive change?** Design says no. If a stored shape becomes
   genuinely wrong, the answer is a new additive store + a lazy reader-side translator
   (read old, write new on access), never an in-place delete. Confirm we accept that
   constraint permanently.

---

## WHY THIS IS THE RIGHT FIRST MOVE

Every feature Lumina wants next (networks, re-ingest, embeddings, the constellation) adds
data. On the current foundation, each addition is a hand-bumped version and a chance to
blank a reader's library. On this foundation, each addition is a safe append that *cannot*
touch what's already there. The reader's work stops being collateral of your deploy
cadence — which, given you ship several times a day, is the whole game.
