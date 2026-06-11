# PLANxi — Notifications ("What's New")
# A per-book ledger of background-work events, surfaced at every level

*Status: built (this is the as-built record, not a forward plan).*

---

## THE IDEA

Background work in Lumina finishes off-screen — an Audio Overview generates while
the reader keeps reading, a Re-Ingest re-lays a whole book, a job fails quietly.
Notifications make those moments legible without nagging: a single dot tells the
reader *something* is new, and that signal resolves — at every level — into
exactly *what* is new and *where*.

Three levels, the same unread set viewed at increasing resolution:

1. **Rail** — a pulsing gold dot on the Annotations button: "something is new."
2. **Drawer menu** — a per-feature dot + "N new" pill on the feature it belongs
   to, plus a **What's new** strip at the top listing the most recent notices
   (including book-level ones like Re-Ingest that have no feature button).
3. **Feature view** — opening the feature marks *its* notices read, clearing the
   dot. The signal is spent by the act of looking.

The annotation **count** badge (highlights + notes) is unchanged and coexists —
notifications are a distinct "what's new" signal, not a recount.

---

## DATA MODEL (`src/types/index.ts`)

```ts
type NotificationFeature =
  | "audio-overview" | "study-guide" | "presentation-studio"
  | "voice-studio"   | "re-ingest";          // re-ingest is book-level (no feature button)
type NotificationKind = "success" | "error";

interface LuminaNotification {
  id: string; bookId: string;
  feature: NotificationFeature; kind: NotificationKind;
  title: string; detail?: string; artifactId?: string;
  read: boolean; createdAt: string;
}
```

Scoped per book. `feature` drives where the badge lands; most map to a
`DrawerView`, `re-ingest` only appears in the What's-new strip + rail aggregate.

---

## STORAGE (both adapters, via `StorageAdapter`)

A `notifications` store, lifecycle **userData** (the reader's unread markers
persist across app updates; never wiped by a schema bump).

- **Web** — IndexedDB store `notifications`, keyed by `id`, indexed by `bookId`
  (webDb `STORE_REGISTRY`; DB_VERSION 11 → 12, purely additive).
- **Tauri** — SQLite table `notifications` (`db.ts` `initSchema` + `dbSaveNotification`,
  `dbLoadNotifications`, `dbMarkNotificationsRead`, `dbDeleteNotification`,
  `dbClearNotifications`).
- Interface methods: `saveNotification`, `loadNotifications(bookId)`,
  `markNotificationsRead(ids)`, `deleteNotification(id)`, `clearNotifications(bookId)`.

---

## STORE (`src/store/notificationStore.ts`)

Mirrors only the active book's notifications in memory; a `notify` for another
(or not-yet-open) book is still persisted and appears when that book opens.

- `loadForBook(bookId)` — called on book open (`useEpubImport` openBook).
- `notify({ bookId, feature, kind?, title, detail?, artifactId? })` — persists,
  and prepends to in-memory state only when it matches the on-screen book.
- `markFeatureRead(feature)` / `markAllRead()` — persist + update state.
- Selectors: `unreadCount(list)`, `unreadByFeature(list)`.

---

## PRODUCERS (the three trigger classes)

| Event | Site | Notice |
|---|---|---|
| Audio Overview done | `overviewJobStore` success branch | success · `audio-overview` |
| Audio Overview failed | `overviewJobStore` catch branch | error · `audio-overview` |
| Re-Ingest complete | `useBookOrchestration.reIngest` (now try/catch) | success · `re-ingest` |
| Re-Ingest failed | same catch | error · `re-ingest` |

Future producers (study guide, presentation, image batch) call the same
`notify(...)` — adding one is a single line at the job's completion site.
Relational-network suggestions were intentionally **deferred** (PLANix Echo/Harmony).

---

## SURFACING

- **Rail** (`SideRail`) — gold ping dot on the Annotations button when
  `unreadCount > 0`, top-left, distinct from the top-right annotation count.
- **Drawer menu** (`AnnotationsDrawer` → `MenuView`) — `What's new` strip (recent
  unread, success=gold / error=red dot, tap → feature or mark-read for re-ingest);
  per-feature `HubButton` shows a ping dot + "N new" pill from `unreadByFeature`.
- **Feature view** — `AnnotationsDrawer` effect: opening a view whose
  `viewToFeature` is non-null calls `markFeatureRead`, so the dot clears however
  the reader arrived.

---

## VERIFIED

- Round-trip through real IndexedDB: 3 notices persisted, survived reload,
  newest-first; `unreadByFeature` = `{audio-overview: 2, re-ingest: 1}`.
- Opening Audio Overview dropped unread 3 → 1, leaving only the re-ingest notice.
- `tsc --noEmit` clean; production build clean; app boots clean.
