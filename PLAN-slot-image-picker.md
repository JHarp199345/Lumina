# PLAN — Slot Image Picker (book-wide archive → current gate)

> Handoff spec. Written so another agent can implement this cold. Read the whole
> file before writing code. Line numbers are approximate — use the quoted search
> anchors (`grep`) to relocate them, since edits shift lines.

## 1. The mental model (read first — everything below follows from this)

Think of it as a horse race:

- **The stable = the archive.** It holds *every* image ever generated for a book,
  durably (`storage.loadImages(bookId)`). Images are stable — a newer image for a
  passage does NOT delete the older ones; they all stay in the stable.
- **Gates = slots.** Fixed word-position anchors in the book. A gate shows exactly
  one image at a time. The gate currently under the reader is the "current gate".
- **Horses = images.** Each image has a **birth passage** — the gate it was
  generated for (`image.visualSlotKey` / its `wordPosition`). That's its default
  home / spawn point.
- **Default behavior:** each gate shows the image **born to it** (the newest such).
- **The feature:** at the **gate currently on display**, the reader can line up
  **any image from that book's archive** — including images born at other
  passages — and that becomes what shows at this gate. The choice is **sticky**
  until the reader changes it or resets the gate to its default.

## 2. Scope

### IN
- A picker, **locked to the current gate** (the slot on display), whose candidate
  pool is the **entire current book's archive**.
- Selecting an image sets a **sticky per-gate override**: that gate now shows the
  chosen image until changed/reset. Persists across refresh/session.
- **Locked at the book level:** pool is always the active book's archive only.

### OUT (do NOT build)
- No cross-book selection / "all books" view (preserves book isolation).
- No moving word-positions. Gates are fixed; birth passages are fixed. The reader
  changes *which image shows at a gate*, never where the gate is.
- No new "slot selector" — the picker always targets the current gate. No
  generation triggering from the picker (exists elsewhere).

## 3. Decisions locked (do not re-litigate)
- Pool scope: **same book, whole archive.**
- Override persistence: **sticky until changed/reset.**
- Default (no override): **newest image born to the gate.**

## 4. Baseline already shipped (branch `fix/image-display-bleed-and-stuck-gen`)
Build on these; don't redo them:
1. **Newest-wins tiebreak** in `src/utils/imagePosition.ts` (`getGoverningImage`/
   `getPreviewImage`, via `isNewer()` on `generatedAt`). This makes the *default*
   gate display the newest image born to it. The override layer sits on top.
2. **`reconcileOrphanedVisualJobs()`** in `src/services/visualGenerationJobs.ts`,
   called once on mount in `src/App.tsx` — drops orphaned "running" jobs so a
   stuck progress bar can't survive a refresh.

## 5. Architecture you need (verified current)

### `CachedImage` (`src/types/index.ts`, search `interface CachedImage`)
```
id: string                 // unique per generation
bookId: string
sceneId: string
wordPosition?: number      // absolute, stable
visualSlotKey?: string     // BIRTH PASSAGE / home gate of this image
filePath: string
generatedAt: string        // ISO; newest-wins ordering
styleSeed, generationApi, emotionalThemes, descriptionUsed, ...
```

### Gate key
`visualSlotKeyForScene(scene, chapters)` in `src/utils/sceneDedup.ts`. A gate is
identified by this slot key. An image's `visualSlotKey` is its **birth gate**.
NOTE: an override lets a gate display an image whose own `visualSlotKey` is a
DIFFERENT gate — that's expected (a horse lined up at another gate).

### Where images live
- **In-memory cache:** `useImageStore.imageCache: Record<sceneId, CachedImage>`
  (`src/store/imageStore.ts`). `addCachedImage` (search it) **evicts** older
  images with the same `visualSlotKey` — so the cache holds only the newest per
  birth gate. It is NOT a complete archive.
- **The stable (complete archive):** `storage.loadImages(bookId)` →
  `CachedImage[]`, ALL generations (`src/storage/StorageAdapter.ts`, search
  `loadImages`). This is the picker's data source AND the resolver for overrides.

### Display pipeline (where overrides take effect)
`src/hooks/useImageTrigger.ts` → `updateDisplay` (search `const updateDisplay`):
1. `cachedImages` = `imageCache` filtered to current-generation sceneIds.
2. `getDisplayImage(cachedImages, readerPos, chapters)` → governing/preview image
   (newest-wins). This determines the **current gate** (its `visualSlotKey`).
3. `setCurrentImage(displayImage)`.
The override must be applied **after** the governing gate is known (step 5.3).

### `imageStore` is NOT persisted (no `persist` middleware). Override map needs
its own persistence (step 5.1).

### Gallery UI host — `src/components/visual/GalleryFocalView.tsx` (≈969 lines)
- `current` = focal scene; `const currentSlotKey = current ? visualSlotKeyForScene(current.scene, chapters) : null;` (search `currentSlotKey`, ≈line 204) = **the current gate**.
- `imageCache` is a prop; `useImageStore` imported; `displaySrc()` helper exists for thumbnail `src` (search `function displaySrc`).
- Existing `showBookMenu` menu (search `showBookMenu`, ≈line 461) — natural place to add the picker entry, or render a thumbnail grid panel.

## 6. Implementation steps

### Step 1 — Persistence `src/services/slotImageOverrides.ts` (NEW)
Mirror `src/services/visualGenerationJobs.ts` (localStorage, `canUseStorage()`
guard). Per-book map of **gate slotKey → chosen imageId** (the imageId may be any
image in the book, regardless of its birth gate).
```ts
// key: `lumina.slotImageOverrides.${bookId}`
export function loadSlotOverrides(bookId: string): Record<string, string>;   // {} if none
export function saveSlotOverride(bookId: string, gateSlotKey: string, imageId: string): void;
export function clearSlotOverride(bookId: string, gateSlotKey: string): void;
export function clearAllSlotOverrides(bookId: string): void;                  // on book deletion
```
No store imports — keep unit-testable in the esbuild|node `npm test` harness.

### Step 2 — Image store: override state + book archive
In `src/store/imageStore.ts` add to `ImageStore`:
```ts
slotOverrides: Record<string, string>;        // gateSlotKey -> imageId (active book)
archiveById: Record<string, CachedImage>;      // active book's FULL archive, by id —
                                               // powers the picker AND resolves overrides
hydrateBookArchive: (bookId: string, archive: CachedImage[]) => void; // sets archiveById +
                                               // loads slotOverrides, dropping ids not in archive
setSlotOverride: (gateSlotKey: string, image: CachedImage) => void;   // slotOverrides[gate]=image.id,
                                               // persist via slotImageOverrides.ts
clearSlotOverride: (bookId: string, gateSlotKey: string) => void;     // remove + persist -> default
```
Notes:
- `archiveById` holds the WHOLE book archive (not just newest-per-gate), so an
  override pointing at an older or foreign-gate image is always resolvable for
  display without an async load. Do NOT route override images through
  `addCachedImage` (it would evict newest-per-gate from the live cache).
- `hydrateBookArchive`: on active-book change/images-load, set `archiveById` from
  `storage.loadImages(bookId)`, load persisted `slotOverrides`, and drop any
  override whose imageId is absent from the archive (image gone). Reset both when
  the active book changes.

### Step 3 — Apply override in the display pipeline
In `updateDisplay` (`src/hooks/useImageTrigger.ts`), after `displayImage` is
resolved and before `setCurrentImage`:
```ts
// Gate currently governing the view:
const gateSlotKey = displayImage?.visualSlotKey ?? null;
const { slotOverrides, archiveById } = useImageStore.getState();
if (gateSlotKey && slotOverrides[gateSlotKey]) {
  const chosen = archiveById[slotOverrides[gateSlotKey]];
  // Same-book guarantee: archiveById only holds the active book's images.
  if (chosen) displayImage = chosen;          // may be born at a different gate — intended
}
```
Edge: if `displayImage` is null (no born image at the gate yet) the gate may not
surface via position. Acceptable for v1 — overrides only apply to gates that have
a default/governing image. (If later you want overrides on empty gates, resolve
the governing gate from `canonicalScenes`/`getCurrentPlannedScene` instead of from
`displayImage.visualSlotKey`.)

### Step 4 — Hydrate on book/images load
Find where images load for the active book (search `loadImages(` in `src/hooks`,
likely `useEpubImport.ts` / `useBookOrchestration.ts` / `useImageTrigger.ts`).
After load: `useImageStore.getState().hydrateBookArchive(bookId, archive)`. Reset
on active-book change.

### Step 5 — Picker UI in `GalleryFocalView.tsx` (locked to current gate)
- **Pool = whole book archive:** `Object.values(archiveById)` (or
  `await storage.loadImages(activeBook.id)`), sorted newest-first (optionally
  grouped/labeled by birth passage / reading order so it's scannable).
- Render a scrollable thumbnail **grid** panel (toggled from the gallery menu, or
  a "Versions/Archive" affordance). Use `displaySrc()` for thumbnails.
- Each thumbnail tap → `setSlotOverride(currentSlotKey, image)` (currentSlotKey =
  the current gate). Then refresh display (store change should drive
  `updateDisplay`; nudge `setCurrentImage` if needed).
- Highlight the active choice for the current gate: `slotOverrides[currentSlotKey]`
  if set, else the gate's newest-born image id.
- A "Reset to default" control → `clearSlotOverride(activeBook.id, currentSlotKey)`.
- Optionally annotate thumbnails born at the current gate ("home") vs. elsewhere.
- Book-scoped only — never show another book's images.

### Step 6 — Book deletion cleanup
Where a book is deleted (search `deleteBook` / `src/storage/archiveOps.ts` and
callers) call `clearAllSlotOverrides(bookId)`.

## 7. Edge cases & invariants
- **One image per gate, always:** display contract = `override for the governing
  gate, else newest image born to the gate`. Never two.
- **Override may point at an image born at another gate** — intended (the horse
  lined up at a different gate). Resolve it from `archiveById` by id.
- **Same image at multiple gates** is allowed (gate A overridden to image born at
  B; gate B still shows its own default). Acceptable; don't add logic to prevent.
- **Override id missing from archive** (image deleted): `hydrateBookArchive` drops
  it → gate falls back to default. Never render a dangling pick.
- **Regeneration while override set:** new image enters the stable and becomes the
  gate's newest-born, but the override stays sticky (per decision). Do NOT
  auto-clear overrides on new generations.
- **Positions/birth passages never change.** Overrides change only *which* image
  shows at a gate.
- **Book isolation preserved:** `archiveById` only ever holds the active book's
  images, so an override can never be another book's art.

## 8. Verification
- `npx tsc --noEmit` clean.
- Unit-test `slotImageOverrides.ts` (save/load/clear/clearAll, missing-id drop) in
  the `npm test` esbuild|node harness (see `package.json` scripts).
- Manual (preview): load a book with several images across passages; open the
  gallery on gate A; the picker shows the whole book's images; pick an image born
  at gate B → gate A now shows it; refresh → still shows it (sticky); "Reset to
  default" → gate A reverts to its own newest-born; regenerate gate A → newest
  grows in the stable but the reader's pick stays until reset.

## 9. Files to touch (summary)
- NEW `src/services/slotImageOverrides.ts` (persistence)
- `src/store/imageStore.ts` (slotOverrides, archiveById, hydrate/set/clear)
- `src/hooks/useImageTrigger.ts` (apply override in `updateDisplay`)
- book/image load site (call `hydrateBookArchive`)
- `src/components/visual/GalleryFocalView.tsx` (book-wide thumbnail grid → current gate)
- book-deletion site (`clearAllSlotOverrides`)
- NEW test for `slotImageOverrides`

## 10. Branch / commit convention
- Branch from `main`: `feat/slot-image-picker`.
- Lumina remote `origin` → github.com/JHarp199345/Lumina. Push, open PR.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Lumina-only; Odysseus server unaffected.
```
