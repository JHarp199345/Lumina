# PLAN IX v2 — Relational Networks → Project Studio & the Writer

> **Status:** Planning only. Nothing here is built yet. PLAN IX (v1, see `PLANix.md`)
> was never implemented; this supersedes it and is the living document we keep
> improving. Write code only when explicitly told.
>
> **Audience:** an implementer with NO prior context. This document is
> self-contained — you should be able to build it true to spirit from this file
> alone. Read the "Context" section first.

---

## 0. CONTEXT — what Lumina is (read this first)

Lumina is a reading/learning app. A reader imports a book (EPUB), and Lumina
analyzes it and generates **artifacts**: a semantic map (emotional arc, scenes),
a Source/Book Profile (themes, entities, intelligence), visual lore, generated
images, audio overviews, narration, study guides, highlights, and notes.

**How it runs (this constrains everything):**
- **Primary runtime = web/PWA** (deployed to GitHub Pages: `https://jharp199345.github.io/Lumina/`),
  used on a tablet. That build has **no Rust backend and no SQLite** — persistence
  is **IndexedDB** via `WebStorageAdapter`. All storage goes through a
  `StorageAdapter` interface so web and the optional desktop (Tauri) build share logic.
- **Optional local AI = "Odysseus"** — a local server (default `http://localhost:7860`,
  reachable via a Cloudflare tunnel) that runs local models (e.g. gemma via Ollama,
  Flux via ComfyUI for images). Selected per the `getProvider()` setting `"odysseus"`.
- **Optional cloud AI = Gemini** (BYOK Google key), `getProvider() === "gemini"`.
- **Positions are the spine.** Scenes/images/notes anchor to **absolute word
  positions** and a Lumina locator (`lumina://chapter/{ch}/page/{pg}` + chapterIndex
  + offsets), NOT EPUB CFI (CFI is empty on the web reader). `computeSceneWordPosition`
  is the canonical position function.

**Two hard rules already enforced in the reader (do not break them):**
1. **Per-book isolation.** One book's lore/artifacts must never leak into another
   book's generation (a real bug once shipped Red Rising lore into Gatsby images).
   The reader keeps each book's working memory walled off.
2. **Non-authoritative enhancement.** Optional intelligence never gates the baseline;
   absence is a normal state, not an error.

---

## 1. THE IDEA (v2, in one breath)

PLAN IX v1 built a **relational network of notes across books** — a NotebookLM-killer
where notes, highlights, books, and generated assets chain into reader-defined
**Networks**. Good, but it had no *purpose*: the network just sat there.

**v2 gives the network a job.** A reader assembles a **Project** (drag several books
in, hit Analyze), Lumina builds a project-scoped relational network from their
artifacts, and a **Writer view** surfaces the right material *into the act of
writing* — driven by the project's **thesis/intent** and by cheap, fast **triggers**
(not live keystroke watching). Every generated artifact becomes **infrastructure for
creation**, not dead output.

It serves essays/research AND fiction (canon/timeline/character continuity).

This is a passion project; category breadth is acceptable. The discipline is
**staging** (Section 8), not scope-policing.

### 1.1 Why this is the "boom" moment

The breakthrough is not "notes can connect to other notes." That is useful, but inert.
The breakthrough is:

> **Every reading artifact becomes callable creative infrastructure.**

Lumina already makes expensive understanding artifacts while someone reads: profiles,
positions, semantic maps, notes, images, passages, study guides, summaries. PLAN IX v2
turns those artifacts into an active project memory that can be mounted when the reader
becomes a writer. This gives the whole app a second mode of value:

- Reader mode: understand and experience one book without cross-contamination.
- Writer mode: deliberately combine many books into a controlled, project-scoped memory.

That is the category move. The graph is not the product. The **Project Studio + Writer
that uses the graph at the exact moment of composition** is the product.

The plan is worth building, but only if the implementation is conservative about
state, versions, and retrieval. The rest of this document reinforces that methodology.

---

## 2. GOVERNING PRINCIPLES

1. **Relational, local-first.** The relationship analysis runs on **Odysseus
   (local) first**, Gemini as fallback, keyword/tag overlap as the no-AI floor.
2. **Build once, recall fast.** Expensive analysis (drawing connections, typed
   relations, embeddings) happens at **Analyze-Project time** and at **copy-over
   time** — never on a trigger. A trigger does a **cheap in-memory lookup** against
   the already-built project memory. Ideas must be fed back in well under a second.
3. **Two buckets, different rules** (Section 4). Reader memory is isolated per book.
   Writer memory is project-scoped and deliberately cross-book. They are separate
   stores with separate rules, mounted/unmounted on view switch.
4. **Non-authoritative.** Empty project / cold start is normal; the Writer works as a
   plain editor with an empty shelf. Influence scales with how much network exists.
5. **Never re-do settled work.** Mounting is idempotent: if a project's memory is
   already built and current, switching into the Writer must NOT re-import or
   re-analyze (Section 4.3).
6. **Every expensive operation is resumable.** Analyze/copy-over/build-network must
   write progress checkpoints. A browser close, app reload, or network change must
   resume from the last successful checkpoint, not start over or silently corrupt state.
7. **Every derived artifact is content-addressed.** If the same source hash +
   project intent hash + analysis version already produced a project artifact, reuse it.
   This avoids duplicated artifacts and "why did it analyze twice?" failures.
8. **No silent magic.** Background work may be quiet, but not invisible. Project analysis
   gets a small status surface: queued/running/partial/complete/failed, current phase,
   last checkpoint, retry action. The Writer never blocks forever with no explanation.

---

## 3. RELATIONSHIP TO EXISTING PLANS (so you reuse, not reinvent)

- **PLAN IX v1 (`PLANix.md`)** — the note-relational substrate: `NetworkNote`,
  `NoteProvenanceLink`, `RelationalNetwork`, embeddings + client-side cosine
  (`noteMatching.ts`), the film-strip suggestion carousel. v2 KEEPS all of this as
  the per-reader note graph; a Project is a higher-level container that can pull
  from it. Do not rebuild it.
- **PLAN XIV (`PLANxiv.md`)** — artifact memory & retrieval: artifact stamps,
  candidate retrieval, confidence/reanalysis gates, reader-controlled scope (Off /
  This Book / Series / Library). **This is the retrieval engine the Writer needs.**
  The Writer's "surface relevant artifacts" = PLAN XIV retrieval scoped to a project.
- **PLAN XV (`PLANxv.md`)** — the per-book "Book Profile": one sectioned intelligence
  container per book (identity, positions, story-craft, intelligence, entities,
  visual plan) built at ingestion. **A Project Profile is the multi-book
  generalization of the Book Profile.** Same pattern, wider scope.

v2 is the convergence: PLAN IX graph + PLAN XIV retrieval + PLAN XV profile, with a
NEW consumer (the Writer) and a NEW scope (the Project).

---

## 4. THE TWO-BUCKET MEMORY ARCHITECTURE (the core of v2)

There are two working-memory buckets with different rules. Only ONE is mounted in
working memory at a time; the other is persisted to storage and unmounted.

### 4.1 Reader memory (bucket A) — isolated, per-book
- What the reader app already uses: the mounted book's structure, semantic map /
  Book Profile, visual lore, image cache, highlights, notes for THAT book.
- **Rule: strict per-book isolation.** Generation for book X may only use book X's
  data. (Unchanged from today; keep the guards.)

### 4.2 Writer memory (bucket B) — project-scoped, deliberately cross-book
- Holds a **Project**: its `ProjectIntent`, the set of attached sources, and **copies**
  of the relevant artifacts pulled from each source's reader memory, PLUS the
  project's relational network and the working document(s).
- **Rule: cross-book mixing is allowed and expected** *within the project bucket only*.
  This is the explicit, scoped exception to per-book isolation. The mixing lives in
  bucket B; it can never reach back and contaminate bucket A's reader generation.
- Artifacts are **copied in** (snapshots), not referenced live — so the writer is
  stable even if the source book is later edited/re-ingested, and so the reader's
  isolation is never violated by a live cross-reference.

### 4.3 The MOUNT / UNMOUNT protocol (must be clean and safe)

Switching views is a deliberate, transactional handoff. Define a small state machine.

**Reader → Writer (entering a project):**
1. **Persist** the reader's current working memory to storage (don't lose place,
   highlights, in-flight state). Then **unmount** bucket A from working memory.
2. **Mount** the project (bucket B) for the target project id:
   - **If the project memory already exists and is current** (every attached source's
     copied-artifact snapshot matches the source's current `analysisVersion`/hash):
     mount it as-is. **Do NOT re-import or re-analyze.** (Idempotency rule.)
   - **If the project is new, or a source was added, or a source's snapshot is stale:**
     run **copy-over** for the missing/stale sources only (Section 4.4), then mount.
3. The Writer is now active with bucket B in working memory.

**Writer → Reader:**
1. **Persist** bucket B (project memory, document, network) to storage. **Unmount** it.
2. **Re-mount** bucket A for the book the reader was on (or the library). If the book's
   reader memory is still persisted and current, re-mount as-is — no re-ingest.

**Safety requirements (write these as invariants):**
- Exactly one bucket mounted at a time; never both, never neither mid-switch.
- Persist-before-unmount always (no data lost on a crash mid-switch — on reload,
  recover the last persisted state of whichever bucket was active).
- Mount is **idempotent and content-addressed**: keyed by project id + per-source
  snapshot version, so repeated switches are no-ops when nothing changed.
- A failed copy-over leaves the project in a clearly "incomplete" state with a retry,
  never a half-mounted bucket.

### 4.4 Copy-over (Reader bucket → Writer bucket)
When a source is first added to a project (or its snapshot is stale), copy the
**relevant** artifacts from that book's reader memory into the project bucket:
- Book/Source Profile sections (themes, entities, intelligence) — see PLAN XV.
- Notes + provenance for that book (from the PLAN IX v1 note graph).
- Generated assets registry (audio overviews, generated images, compositions,
  study guides) — copy the **stamps/metadata + storage refs**, not necessarily the
  bytes (images stay where they are; the project references them).
- Passage index: chapter/section boundaries + absolute positions, so the project can
  pull passage text on demand (do NOT duplicate full book text into the project; pull
  live by position from the source, exactly as PLAN XV does).
- Each copied bundle is stamped with the source's `analysisVersion`/content hash so
  staleness is detectable (drives the idempotency check in 4.3).

---

## 5. DATA MODEL (added to `src/types/index.ts`, stored via `StorageAdapter`)

Reuse PLAN IX v1 types (`RelationalNetwork`, `NetworkNote`, `NoteProvenanceLink`,
`NetworkMediaAsset`). Add:

```ts
export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sourceBookIds: string[];          // attached sources
  intent: ProjectIntent;
  status: "draft" | "copying" | "analyzing" | "partial" | "ready" | "failed";
  activeJobId?: string;             // resumable background job, if any
  lastError?: string;
  // snapshot bookkeeping for idempotent mount (Section 4.3):
  sourceSnapshots: Record<string, { analysisVersion: number; hash: string; copiedAt: string }>;
  networkBuiltAt?: string;          // when the relational analysis last ran
  projectMemoryHash?: string;       // hash(sourceSnapshots + intent + schemaVersion)
  schemaVersion: number;
}

export interface ProjectIntent {            // the "source of truth" for retrieval
  assignmentPrompt?: string;        // the essay/assignment prompt, if any
  thesis?: string;
  workingTitle?: string;
  goal?: string;                    // what the writer is trying to produce
  audience?: string;
  keyQuestions?: string[];
  userInstructions?: string;
  currentSection?: string;          // updated as the writer moves between headings
}

// One node in the project network. Artifacts are COPIES (snapshots) from sources.
export interface ProjectArtifact {
  id: string;
  projectId: string;
  sourceBookId: string;
  type: "passage" | "note" | "summary" | "audio" | "image" | "composition"
      | "theme" | "claim" | "character" | "concept";
  title: string;
  // Self-describing header — like a filename that announces its contents. A dense,
  // human-skimmable line: subject + key entities + themes + type. This is the CHEAP
  // pre-filter key (the "tag gate" in §7.1): a query whose topic doesn't intersect a
  // descriptor skips that artifact before any vector math, shrinking the candidate set.
  descriptor: string;
  summary: string;                  // compact, embeddable text (NOT full book text)
  storageRef?: string;              // where the real asset lives (image/audio), if any
  startWord?: number;               // absolute position for "return to source"
  endWord?: number;
  locator?: string;                 // lumina:// anchor for navigation
  visibleTags: string[];
  hiddenTags: string[];             // search-only tags for retrieval
  embedding?: number[];             // cached, for fast cosine recall
  weight: number;                   // importance 0..1
}

export type ProjectRelationType =
  | "supports" | "contradicts" | "defines" | "expands"
  | "example_of" | "cites" | "theme_link" | "cause_effect";

export interface ProjectRelation {  // typed edge (LATER stage — see §8)
  id: string;
  projectId: string;
  fromArtifactId: string;
  toArtifactId: string;
  relationType: ProjectRelationType;
  confidence: number;
  explanation?: string;
}

export interface ProjectDocument {  // the thing being written
  id: string;
  projectId: string;
  title: string;
  body: string;                     // markdown
  updatedAt: string;
}

export interface ProjectBuildJob {
  id: string;
  projectId: string;
  kind: "copy-over" | "analyze-project" | "rebuild-network";
  status: "queued" | "running" | "paused" | "complete" | "failed" | "cancelled";
  phase: "snapshot" | "copy" | "embed" | "connect" | "persist" | "done";
  sourceBookIds: string[];
  completedSourceBookIds: string[];
  startedAt: string;
  updatedAt: string;
  checkpoint: Record<string, unknown>;
  error?: string;
}
```

Storage methods (both adapters, mirror the existing study-guide/profile pattern):
`save/load/deleteProject`, `save/loadProjectArtifacts`, `save/loadProjectRelations`,
`save/loadProjectDocument`, `save/loadProjectBuildJob`, `loadProjectArtifactEmbeddings`
(tiny projection for recall).

### 5.1 Storage invariants

Implement these as boring guards, not vibes:

- Project writes are **two-phase**:
  1. write artifacts/job/checkpoint under a temporary build id,
  2. commit the project manifest only after all required pieces exist.
- Loading a project must validate the manifest:
  - every `sourceBookId` has a `sourceSnapshots` entry,
  - every artifact belongs to the current `projectId`,
  - every artifact's `sourceBookId` is attached to the project,
  - every artifact with `startWord/endWord` has `startWord <= endWord`,
  - `schemaVersion` is supported or migratable.
- On failure, mark the project `partial` or `failed`; do not delete previous good memory.
- Never overwrite a ready project memory with an incomplete rebuild. Keep the old ready
  snapshot until the new one commits successfully.
- Deleting a project deletes project copies and project documents only. It must not
  delete source book reader artifacts, notes, images, or highlights.

---

## 6. RELATIONAL ANALYSIS — "Analyze Project" (local-first)

Runs when the reader adds sources and presses **Analyze** (and incrementally on
copy-over of a new source). This is the EXPENSIVE step; it is done once, not per trigger.

1. **Collect** `ProjectArtifact`s from copy-over (Section 4.4): every source's themes,
   entities, notes, claims, asset stamps, plus passage candidates.
2. **Embed** each artifact's `summary` (cache by text hash). Provider order: Odysseus
   local embedding if available → Gemini embeddings → skip (tag-only mode).
3. **Cross-source connections (the project map):** ask the model (Odysseus first) for
   shared themes, overlapping concepts, and *candidate* tensions across sources. Output
   feeds `hiddenTags` and (later) `ProjectRelation` edges. Keep this compact and
   book-text-free (feed summaries/profiles, not whole books) so it's cheap and runs locally.
4. **Persist** the project network; stamp `networkBuiltAt`.

**Typed relations (`ProjectRelation`) are a LATER stage.** Local models produce noisy
"supports/contradicts" edges; do not block the useful retrieval on a pretty graph.
Stage 1–3 use semantic + tag overlap; typed edges arrive in Stage 4.

### 6.1 Analyze Project as a resumable pipeline

Do not implement Analyze Project as one giant function. Build it as a checkpointed
pipeline so it can survive reloads and partial failures:

1. **Snapshot phase**
   - Read attached source manifests.
   - Compute `projectMemoryHash`.
   - If hash matches existing ready project memory, return `ready` immediately.
2. **Copy phase**
   - Copy only missing/stale source bundles.
   - Checkpoint after each source.
   - If a source fails, keep completed sources and mark project `partial`.
3. **Embed phase**
   - Embed artifact summaries by stable text hash.
   - Cache embedding failures as "tag-only" rather than failing the project.
4. **Connect phase**
   - Build hidden tags and candidate cross-source clusters.
   - Local model optional; no-AI fallback is descriptor/tag overlap.
5. **Persist phase**
   - Save artifacts, embeddings, and manifest atomically.
   - Only then set project `ready`.

### 6.2 Fallback ladder

Project memory must still be useful when AI is missing:

1. Full mode: Odysseus embeddings + Odysseus relation pass.
2. Cloud fallback: Gemini embeddings/relation pass if configured.
3. Hybrid: embeddings available, no relation model.
4. Floor mode: descriptor + visible/hidden tags + note titles + source titles only.

Floor mode should still produce a Writer shelf. It will be less clever, but it cannot
be blank unless there are genuinely no artifacts.

### 6.3 Bail-safe rules

- If a source book is missing or archived, keep its last project snapshot if one exists
  and flag it `sourceUnavailable`. The writer can still use copied summaries/notes.
- If embedding fails for one artifact, skip embedding for that artifact only.
- If relation analysis fails, save artifacts anyway and mark relation coverage as `none`.
- If project analysis is already running and the user clicks Analyze again, show the
  current progress surface and do not start a second job.
- If analysis appears stale, compare `updatedAt` to the active job heartbeat. If heartbeat
  is older than the timeout, mark the job failed and expose Retry.

---

## 7. TRIGGER-BASED RECALL + THE WRITER VIEW

### 7.1 Triggers, the recall scheduler, and tiered retrieval

**Triggers are NOT calls.** They are *requests* fed to a single **recall scheduler**.
Without this, scroll + 10s-pause + Enter-3× all fire at once and pile up — different
queries racing, stale results flickering in. The scheduler prevents that.

**Trigger sources (two priorities):**
- **Ambient** (low priority): scrolled to a new page/section; idle pause (~10s);
  Enter-3× / new paragraph or heading. These mean "what's relevant to where I am now."
- **Explicit** (high priority): the reader acts — selects text, "find relevant",
  "support this", "find counterargument". These mean "what's relevant to *this*."

**Scheduler rules (implement exactly):**
1. **Single-flight.** At most ONE recall runs at a time.
2. **Coalesce ambient, latest-wins.** Rapid ambient triggers collapse into one pending
   request (debounce ~300–500ms). The query text is rebuilt from the **current**
   paragraph/section **at execution time**, so a coalesced request reflects where the
   user is *now*, never a stale position.
3. **Explicit preempts and sticks.** An explicit request cancels any in-flight ambient
   recall and runs immediately. Its result is **pinned** to the shelf until the user
   moves on or dismisses; ambient triggers are **suppressed for a short window** after
   an explicit ask so the answer the user asked for isn't overwritten a second later.
4. **Cancel-stale / out-of-order guard.** Every request carries a monotonic sequence id.
   If a newer or higher-priority request supersedes an in-flight one, the older result
   is **discarded, not rendered**. The shelf only ever shows the latest honored result.
5. **No queue depth > 1.** Beyond the single in-flight + one pending, drop intermediate
   ambient requests (latest pending wins).
6. **Stable render contract.** The shelf never clears while a new ambient recall is
   running. It keeps the previous result with a subtle updating state, then swaps only
   when the new result passes validation. Failed ambient recall leaves the old shelf.
7. **Result validation.** Before rendering, every result must still belong to the active
   project id and the active request sequence. If either differs, discard it.

**Tiered retrieval (what a recall actually does):**
- **Tier 1 — tag gate (cheap, always):** intersect the query topic/entities/themes with
  each artifact's `descriptor` (§5). Drop artifacts with no overlap *before* vector math.
  This is the "filename tells you if it's worth opening" filter — it shrinks the
  candidate set and is the main precision win.
- **Tier 2 — cosine rank (cheap, always):** embed-or-reuse the current text (cache the
  current paragraph's embedding so repeated triggers are near-instant) and cosine-rank
  the Tier-1 survivors. Cosine over a few hundred items is microseconds.
- **Tier 3 — intent bias (cheap, always):** reweight by `ProjectIntent.thesis` +
  `currentSection` so results serve the project's goal, not just local similarity.
- **Tier 4 — small reranker (OPTIONAL, EXPLICIT-ONLY):** for explicit asks *only*, a
  small fast local model may rerank the top survivors and demote the irrelevant. This is
  the one place a model call is allowed in recall — justified because the user
  explicitly asked and will tolerate ~1s. **Never run Tier 4 on ambient triggers** —
  repeated local model loads thrash the hardware (the budget rule from §2/§9). Tier 4 is
  a Stage-3/4 enhancement; Tiers 1–3 ship first and handle the common case alone.

### 7.1.1 Recall reliability methodology

Recall is where "works once" systems become annoying. Build this part like a tiny
database query engine:

- Normalize query terms before tag matching: lowercase, singular-ish stemming where
  cheap, strip punctuation, keep proper nouns.
- Cache query embeddings by `(projectId + normalizedQueryHash + embeddingProvider)`.
- Score must be explainable:
  - tag overlap score,
  - cosine score,
  - intent score,
  - final score.
- Keep a minimum diversity rule: do not fill the shelf with ten artifacts from the
  same source unless the project has only one source.
- Keep a recency/section bias but cap it so it cannot bury a highly relevant older note.
- Empty result fallback:
  1. loosen tag gate,
  2. ignore current section bias,
  3. show top project artifacts by weight,
  4. only then show an empty state.

### 7.1.2 Recall scheduler pseudocode

```ts
let inFlight: RecallRequest | null = null;
let pendingAmbient: RecallRequest | null = null;
let pinnedExplicitUntil = 0;
let sequence = 0;

function requestRecall(input: RecallInput) {
  const req = buildRequest(input, ++sequence);
  if (req.priority === "explicit") {
    cancelAmbientInFlight();
    inFlight = req;
    run(req);
    return;
  }
  if (Date.now() < pinnedExplicitUntil) return;
  pendingAmbient = req; // latest wins
  scheduleDebouncedDrain();
}

async function run(req: RecallRequest) {
  const result = await retrieve(req);
  if (req.sequence !== sequence) return;            // stale
  if (req.projectId !== activeProjectId()) return;  // wrong bucket
  renderShelf(result);
}
```

This is intentionally simple. The danger is not algorithm complexity; the danger is
race conditions and stale results rendering into the wrong project.

### 7.2 The Writer view (the consumer)
- **Center:** the `ProjectDocument` editor.
- **Left:** outline / thesis / sources / sections.
- **Right rail = the "artifact shelf":** horizontal **Netflix-style rows by type** —
  Relevant Passages · Your Notes · Concepts & Themes · Tensions/Counterarguments ·
  Audio/Narration clips · Citation candidates. Each card has a **"return to source"**
  link (resolves via `locator`/position through the existing `luminaNavigate` API) and
  a **"back to writer"** button. Rows pan like a film strip; never a chatbot feed.
- **Principle:** assist attention, don't hijack it. The shelf is a living research
  shelf that refreshes on triggers, not a stream of "AI suggestion!" popups.

### 7.3 Where it lives
The Writer is its own view, reachable from the **feature/annotation drawer**. The
**Project panel** attaches to the **Library window** (not the main reader): New Project
→ drag books in → they populate → an **Analyze** button appears at the panel bottom.

---

## 8. STAGED BUILD (ship narrow, grow)

- **Stage 0 — Storage + migration scaffold.** Add project types, adapter methods,
  schema version, build jobs, and validation helpers. No UI yet. Write tests for
  manifest validation, idempotent save/load, and failed-build recovery.
- **Stage 1 — Project panel + Analyze.** Library-attached panel; create project, drag
  books in, copy-over (Section 4.4), Analyze → project map (themes + candidate
  passages). No Writer yet. Establishes bucket B + the mount protocol.
- **Stage 2 — Writer + manual recall.** Writer view, `ProjectIntent` (thesis/goal),
  document editing, a manual **"Find relevant artifacts"** button filling the shelf.
  Retrieval uses Tiers 1–3 only.
- **Stage 3 — Trigger recall.** Build the recall **scheduler** (§7.1: single-flight,
  priority, coalescing, cancel-stale) and wire the ambient + explicit triggers. No
  model calls yet.
- **Stage 4 — Typed relations + explicit reranker.** Add `ProjectRelation` edges
  (supports/contradicts/…) via Odysseus with confidence gating; add the optional Tier-4
  small reranker on explicit asks only; optional graph visualization (reuse
  `SunburstNote.tsx`).
- **Stage 5 — Project polish.** Project export/import, duplicate-source detection,
  shelf row personalization, project-level cleanup tools, and conflict repair UI.

Mount/unmount (Section 4) is foundational — implement it in Stage 1 and keep it honest
throughout.

### 8.1 Definition of done by stage

- Stage 0 is done when a project can be saved, loaded, validated, migrated, and failed
  builds cannot overwrite prior ready state.
- Stage 1 is done when adding the same book twice is rejected/merged, Analyze is
  idempotent, browser reload resumes or clearly fails the build job, and project memory
  never writes into reader memory.
- Stage 2 is done when manual recall works with no AI provider configured.
- Stage 3 is done when trigger storms cannot flicker, queue up, or render stale results.
- Stage 4 is done when relation edges are optional; deleting all edges does not break
  recall.
- Stage 5 is done when a reader can clean up a project without damaging source books.

## 9. CAUTIONS (do not skip)
1. **Don't let the typed graph eat the useful retrieval.** Intent-driven semantic
   surfacing is the value; typed edges are garnish (Stage 4).
2. **No LLM on ambient recall.** Build the network once; ambient triggers recall from
   memory (Tiers 1–3: tag gate → cosine → intent). A model call (Tier 4 reranker) is
   allowed ONLY on explicit, user-initiated asks. Repeated local model loads thrash
   Apple-Silicon MPS — the exact failure we fixed earlier.
3. **One recall at a time.** The scheduler (§7.1) is foundational: single-flight,
   explicit-preempts-and-sticks, coalesce-ambient-latest-wins, discard stale results.
   Trigger storms must never pile up or flicker.
4. **The project bucket is the ONLY place cross-book mixing is allowed.** It must never
   write back into a book's reader memory or its generation inputs.
5. **Never duplicate full book text** into the project; pull passages live by absolute
   position from the source (PLAN XV pattern).
6. **Mount idempotency is a correctness requirement**, not an optimization — re-entering
   a built project must not re-ingest/re-analyze.
7. **Never let an incomplete rebuild replace a complete project.** New analysis commits
   only after validation. Until then, the old ready project remains the active one.
8. **Never show cross-project results.** Every rendered shelf card validates `projectId`
   at render time, not just retrieval time.

## 10. TEST MATRIX

These are not optional nice-to-haves. They are what keeps the idea reliable.

### Storage and mount tests
- Create project → attach two books → save → reload → same project and sources return.
- Re-enter a ready project five times → no copy-over/analyze calls fire.
- Crash/reload during copy-over → project returns as `partial` with Retry.
- Rebuild fails → previous ready memory remains available.
- Delete project → source book artifacts remain.
- Archive/delete source book → project snapshot either remains usable or shows
  `sourceUnavailable`; it never crashes the Writer.

### Isolation tests
- Reader generation for book A cannot access project artifacts.
- Project with books A+B can access copied artifacts from A+B.
- Leaving Writer and returning to Reader restores book A state without project data.
- Shelf result from project A cannot render after switching to project B.

### Recall tests
- Ambient trigger storm produces one final shelf update.
- Explicit request cancels/suppresses ambient recall and remains pinned.
- Slow old request resolving after a fast new request is discarded.
- No embeddings available still returns descriptor/tag results.
- Empty tag gate fallback loosens filters before showing empty state.

### UX failure tests
- Analyze button clicked twice while running → shows existing progress, starts no new job.
- Network/offline during analysis → job pauses/fails with retry, no data loss.
- Missing AI provider → analysis uses floor mode and tells the user what is limited.

## 11. IMPLEMENTATION NOTES FOR FUTURE AGENTS

- Start with storage and invariants. Do not begin with the graph visualization.
- Keep project memory boringly explicit: manifests, hashes, statuses, checkpoints.
- Treat the Writer shelf like a query result, not a chatbot. It should feel fast,
  stable, and intentional.
- Build fallbacks first. If floor mode works, AI-enhanced mode becomes an upgrade
  instead of a dependency.
- Prefer small pure functions for scoring, validation, and snapshot checks. They are
  easy to test and hard to accidentally break.
- When in doubt, preserve existing reader behavior. PLAN IX v2 adds a second memory
  bucket; it does not loosen book isolation in Reader mode.
