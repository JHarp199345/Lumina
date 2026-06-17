# PLANxvi — The Starter Kit (pre-baked library, zero setup)
# Open the app cold and three fully-realized books are already there

*Status: plan only — practical, verified against the current storage model.*

---

## GOAL

A brand-new user opens Lumina with an empty library and gets **time-to-zero-value**:
three public-domain books already on the shelf, each with its semantic tension map,
generated imagery, an audio overview, quizzes, and flashcards — explorable
**immediately, with no API key, no Odysseus, no ingestion wait, and $0 of hosting.**

This is the cold-start fix, but the real intent is **access**: the pre-baked books
must be fully usable by someone on a cheap phone, on metered or intermittent data,
who has no key and may never set one up. Everything that *can* be experienced
without generating anything new must work out of the box.

Constraints honored: serverless (GitHub Pages), no always-on server, no recurring
cost, browser-memory-safe, offline-capable after first view.

The pre-baked library makes the app *useful* with zero setup. **Part Two** below
makes it *generative* with zero setup too: a keyless user can upload their own text
and have it processed for free, via a shared best-effort path — so the homeless
clients (and college students) never have to know what an API key is.

---

## WHY THIS IS PRACTICAL (verified, not assumed)

- **Lumina already treats intelligence as a non-authoritative overlay** — missing
  artifacts degrade to nothing, never error. So a book can arrive pre-loaded with
  *some* artifacts and the rest simply absent, and nothing breaks.
- **The media seam already exists.** On load, `WebStorageAdapter.loadImages` /
  `loadAudioArtifacts` rebuild each artifact's `filePath` from an IndexedDB blob
  (e.g. [WebStorageAdapter.ts:415](src/storage/WebStorageAdapter.ts:415)). Teaching
  that path to pass a remote `https://` `filePath` straight through (skip the blob
  lookup) is a ~10-line change and means media never has to enter IndexedDB.
- **Bulk insert is trivial.** Stores are plain keyed object stores; hydration is a
  loop of `dbPut` / existing `storage.save*` calls. Schema is additive
  (`STORE_REGISTRY` in `webDb.ts`).
- **A seeding entry point already exists** (`?test=1` dev loader + `sampleBook.ts`,
  loading `public/test-book.epub`). The starter kit generalizes that pattern.
- **Public-domain only** (Project Gutenberg) → redistributing text + derived media
  is legally clean.

Net: the heavy lifting (analysis, image/audio generation) is done **once, offline,
on your local Odysseus box** by a build script. The shipped app only *hydrates*
pre-computed results. No runtime generation, no server.

---

## ARCHITECTURE (three pieces)

### 1. Pre-baked bundles (static JSON + remote media)

For each starter book, a static JSON bundle describing everything except the heavy
bytes:

```jsonc
// public/starter-kit/gutenberg-1342.json   (Pride and Prejudice)
{
  "bundleVersion": 1,
  "visualPlanVersion": <current VISUAL_PLAN_VERSION>,   // for staleness checks
  "book":        { "id": "starter-gutenberg-1342", "title": "...", "author": "...",
                   "filePath": "https://cdn.example/starter/1342/book.epub", ... },
  "structure":   { ...BookStructure... },
  "semanticMap": { ...SemanticMap... },
  "sourceProfile": { ... },
  "studyGuide":  { ... },
  "quizzes":     [ ... ],
  "flashcards":  [ ... ],
  "notes":       [ ... ],
  "images":      [ { ...CachedImage meta..., "filePath": "https://cdn.example/starter/1342/img/scene_x.png" } ],
  "audio":       [ { ...AudioArtifact meta..., "filePath": "https://cdn.example/starter/1342/audio/overview.wav" } ]
}
```

- **Text artifacts** (maps, quizzes, flashcards, notes, profile, study guide):
  inlined in the JSON. Kilobytes. Inserted into IndexedDB on first boot.
- **Media + the EPUB** (`book.filePath`, each `images[].filePath`,
  `audio[].filePath`): **remote `https://` URLs**, never inlined, never copied into
  IndexedDB. Streamed on demand by native elements when the reader opens that page
  or hits play.

A top-level `public/starter-kit/manifest.json` lists the bundle URLs + book
titles/covers so the shelf can render before bundles are fetched.

### 2. First-boot hydration

On app init, when `STORES.BOOKS` is empty (fresh install / cleared storage):

1. `fetch(BASE_URL + "starter-kit/manifest.json")` (served by GitHub Pages).
2. For each bundle: fetch JSON, check `bundleVersion`/`visualPlanVersion`; if a
   bundle's `visualPlanVersion` is stale, hydrate only the version-agnostic parts
   (book, structure, study, notes) and skip the visual plan — same graceful rule
   the app already applies to stored maps.
3. Bulk-insert via existing storage methods: `saveBook`, `saveBookStructure`,
   `saveSemanticMap`, `saveSourceProfile`, `saveStudyGuide`, `saveStudyQuiz`,
   `saveStudyFlashcards`, `saveNote`, plus **image/audio *metadata only*** (new
   metadata-only save path — see piece 3) with remote `filePath`s.
4. Mark a `starter-kit-hydrated` flag (and the bundleVersion) so it doesn't re-run
   every boot — but hydration is **idempotent**: keyed by stable ids, so a re-run
   after IndexedDB eviction (common on iOS Safari) safely restores the shelf.

Idempotent + empty-gated means it never fights a real user's library: once they
import or generate anything, the empty-check is false and hydration stays dormant.

### 3. Remote-media passthrough in the storage adapter

The one real code change. Today `saveImage`/`saveAudioArtifact` take raw bytes and
`loadImages`/`loadAudioArtifacts` rebuild a blob/data URL from IndexedDB. Add:

- `loadImages` / `loadAudioArtifacts`: **if `meta.filePath` is an `http(s)` URL,
  return it as-is and skip the `IMAGE_BLOBS`/`AUDIO_BLOBS` lookup.** (Local
  generations keep the `idb-img://` / `idb-audio://` path unchanged.)
- A **metadata-only insert** for hydration (`saveImageMeta` / `saveAudioMeta`, or a
  flag on the existing save) that writes the meta row with a remote `filePath` and
  **no blob**.

That's it. Native `<img>`/`<audio>` lazy-load the remote URL; nothing heavy touches
the heap until the reader actually looks at it. Browser-memory footprint stays flat.

### 4. The bake script (dev-time only, never shipped)

`scripts/bake-starter-kit.mjs`:

1. For each target Gutenberg id: import the EPUB, run the real pipeline against the
   **local Odysseus box** (analysis → visual plan → image generation → audio
   overview → study guide → quizzes → flashcards).
2. Export the resulting rows to a bundle JSON.
3. Upload the EPUB + images + audio to the object store; rewrite those `filePath`s
   in the JSON to the public CDN URLs.
4. Write `public/starter-kit/<id>.json` and update `manifest.json`.

Run occasionally by you; output committed (JSON) / uploaded (media). The shipped
app never runs it.

---

## HOSTING

- **GitHub Pages** serves `manifest.json` + the per-book JSON bundles (KB each) and,
  if small enough, the EPUBs. (Gutenberg EPUBs are ~0.3–2 MB; a few fit comfortably
  under the 100 MB-file / 1 GB-repo limits — but prefer the object store to keep the
  repo lean.)
- **Free-tier object storage for media** — **Cloudflare R2 recommended** (10 GB
  free, **zero egress fees**, S3 API). Backblaze B2 is a fine alternative. Images
  and audio (the MBs) live here and stream directly to the client. The bake script
  uploads via the S3 CLI.

No file ever needs to round-trip through a server you run.

---

## DESIGNED FOR THE AUDIENCE (under-resourced readers)

- **No key, no Odysseus, no cost to *explore*.** Generating *new* content still
  needs a key/backend; everything pre-baked does not. The full experience is
  visible before any signup or setup.
- **Tiny first payload.** Only manifest + text bundles load up front (instant on a
  slow phone). Media is per-asset, on open — never a forced multi-MB download on
  metered data.
- **Offline after first view.** The service worker (`public/sw.js`) can cache
  starter media on first fetch, so a book the reader has opened stays available
  with no connection. (Optional explicit "save for offline" per book later.)
- **Public domain only**, so the library is freely shareable.

---

## HONEST CAVEATS

- **Bundles go stale when data shapes change.** A baked semantic map from an old
  `VISUAL_PLAN_VERSION` must be detected and partially skipped (handled in
  hydration step 2). Re-bake when shapes bump. Keep `bundleVersion` honest.
- **Object-store URLs are public.** Fine for public-domain media; don't put
  anything non-public there.
- **iOS storage eviction** can wipe the hydrated rows; idempotent re-hydration
  covers it, but media already cached by the SW may also be evicted and re-fetched.
- **Cover/shelf before hydrate:** render from `manifest.json` so the shelf isn't
  blank during the first fetch.
- This is **web/PWA-scoped.** The Tauri build can reuse the bundles but would store
  media locally instead of streaming; out of scope for v1.

---

## IMPLEMENTATION ORDER

1. **Adapter passthrough** — remote-`filePath` passthrough in `loadImages` /
   `loadAudioArtifacts` + metadata-only image/audio insert. (Small, isolated,
   independently testable with a hand-made remote-URL meta row.)
2. **Hydration** — empty-library check on init → fetch manifest → fetch bundles →
   bulk insert (version-gated, idempotent) → hydrated flag. Reuses existing
   `storage.save*` methods.
3. **One hand-authored bundle** — bake a single book by hand (or a minimal script
   run) to validate the end-to-end shelf-fills-on-first-boot path before automating.
4. **Bake script** — `scripts/bake-starter-kit.mjs` to automate the rest + uploads.
5. **Offline polish** — SW caching of starter media; optional per-book "save
   offline."

Phase 1 + 2 alone (with one bundle from phase 3) already deliver the feature for one
book; the rest is scale + automation.

---

## PART TWO — FREE LIVE GENERATION FOR KEYLESS USERS (best-effort)

Pre-baked books make the app useful with no setup. This part lets a keyless user
upload their *own* text/EPUB and have Lumina process it — free — without ever
touching an API key.

### Reliability hierarchy (and the UI must say so)

1. **Pre-baked library — guaranteed.** No calls, always works. The floor; the app
   is valuable even when every live path is down.
2. **Free live generation — best-effort.** Free hosted models are globally
   rate-limited and *will* fail under load. We make it resilient (queue + backoff,
   never crash, eventually succeed), but never promise instant.
3. **BYO key / Odysseus — reliable upgrade.** A user who adds an OpenRouter/Google
   key, or the operator's own Odysseus box, gets the dependable path.

Keyless live generation shows a calm "working — the free tier can take a while"
state, never a spinner that looks hung.

### The free path: a tiny proxy, NOT a key in the client

The instinct is right: one shared OpenRouter key, routed **only to free models**.
The one correction: **do not embed that key in the client build.** A key shipped to
the browser is trivially extractable (view-source / devtools / network tab) and
bots scrape public keys within minutes. Once leaked, strangers run their own traffic
through it and exhaust the free-tier rate limits so the actual clients get nothing —
and OpenRouter may disable the key outright. A $0 budget cap prevents money loss but
not abuse/exhaustion.

Put the key behind a **free serverless proxy** — a single **Cloudflare Worker**
(free tier ~100k req/day, no card, nothing to maintain). It:

- **holds the key server-side**, never shipped to the client, rotatable without an
  app redeploy;
- **restricts to the free-model allowlist** only;
- **is the shared queue + rate limiter** — the real fix for "everyone piled in,
  first-come-first-served, I came last." A client-side queue can only order *one
  phone's* calls; only a shared proxy can fairly serialize across *all* of the
  operator's users and buffer them against the global free-tier stampede;
- adds cheap **abuse protection** (per-IP limits, a soft origin/token check).

Same serverless, ~$0, MacBook-out-of-the-path properties as the hardcoded idea —
without the leak. Honest ceiling: even a perfect proxy can't make OpenRouter's free
models *reliable*; if they're globally saturated, upstream 429s still happen. The
proxy + backoff turn "constant timeouts / crashes" into "slower, retried,
usually-eventually-works," and the pre-baked library covers the rest. That is the
realistic best a free live path can be — which is why the pre-baked floor matters so
much for this audience.

### Client retry-queue in `llmClient.ts`

A resilience layer on the client, reusing the single-file-line discipline already in
`runOdysseusSequential`:

- **Single-flight + bounded queue.** One live request at a time per client; queue
  depth capped, newest-wins dedup (same policy as the image queue) so an impatient
  double-tap doesn't pile calls.
- **Exponential backoff with jitter.** On 429 / timeout / 5xx: wait and retry, not
  fail. Respect an upstream `Retry-After` when present; jitter so many phones don't
  retry in lockstep.
- **Bounded attempts + calm surrender.** After N tries, stop and say "the free tier
  is busy — try again shortly, or add a key for instant results." Never a crash or a
  silent hang.
- **Provider seam.** Add an `"openrouter-free"` `LLMProvider` pointing at the Worker;
  keep `odysseus` and `gemini` as-is. Keyless → openrouter-free; key present → that
  provider.

### Mini implementation order (Part Two)

1. Cloudflare Worker proxy: key + free-model allowlist + per-IP limit + queue/limiter
   (lives outside the app repo; deploy once).
2. `llmClient.ts`: `"openrouter-free"` provider hitting the Worker; backoff + jitter
   + bounded queue + `Retry-After` handling.
3. Keyless UX: default keyless users to the free path; "working on the free tier"
   state; "add a key for instant results" upsell for students/power users.

---

## OPEN QUESTIONS

1. **Which 3 starter books?** Suggest range over genre so the shelf shows breadth
   (e.g. one narrative, one shorter/dramatic, one accessible nonfiction). Reader's
   call — pick titles the actual audience will open.
2. **Object store:** Cloudflare R2 (recommended, zero egress) vs Backblaze B2.
3. **How much media per book** — every planned scene image + one audio overview, or
   a lighter set to keep the CDN footprint and per-open data small? Lean lighter for
   a metered-data audience; confirm.
4. **Offline default** — auto-cache a starter book's media on first open, or only on
   explicit "save offline"? (Auto is friendlier; costs more of the device's quota.)
5. **Free-model allowlist (Part Two)** — which OpenRouter free model(s), and a
   fallback order among them when one is saturated?
6. **Proxy abuse protection** — per-IP rate limit only, or also a lightweight signed
   app token so the Worker isn't trivially scriptable by outsiders?
7. **Keyless default** — silently use the free proxy, or ask once ("use the free
   shared service? it can be slow at peak") so users understand it's shared?
