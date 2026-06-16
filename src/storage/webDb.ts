/**
 * webDb — lightweight IndexedDB wrapper for the Lumina web/PWA runtime.
 *
 * All stores are created in a single database ("lumina", v1).
 * Each helper returns a Promise so callers use async/await naturally.
 */

const DB_NAME = "lumina";
const DB_VERSION = 15;

export const STORES = {
  SOURCE_PROFILES: "source_profiles", // SourceIntelligenceProfile, keyed by bookId
  BOOKS:         "books",           // keyed by book.id
  BOOK_STRUCTURES: "book_structures", // BookStructure snapshots, keyed by bookId
  EPUBS:         "epubs",           // ArrayBuffer EPUB blobs, keyed by bookId
  PROGRESS:      "progress",        // ReadingProgress, keyed by bookId
  HIGHLIGHTS:    "highlights",      // Highlight[], keyed by id, indexed by bookId
  NOTES:         "notes",           // Note[], keyed by id, indexed by bookId
  SEMANTIC_MAPS: "semantic_maps",   // SemanticMap, keyed by bookId
  BOOK_PROFILES: "book_profiles",   // BookProfile, keyed by bookId
  BLACKBOARD_NOTES: "blackboard_notes", // BlackboardNote, keyed by id, indexed by bookId
  STUDY_GUIDES:  "study_guides",    // StudyGuide, keyed by bookId
  STUDY_QUIZZES: "study_quizzes",    // StudyQuiz, keyed by id, indexed by bookId
  STUDY_ATTEMPTS:"study_attempts",   // StudyQuizAttempt, keyed by id, indexed by bookId
  STUDY_BADGES:  "study_badges",     // StudyBadgeAward, keyed by id, indexed by bookId
  STUDY_FLASHCARDS: "study_flashcards", // StudyFlashcard, keyed by id, indexed by bookId
  IMAGE_META:    "image_meta",      // CachedImage metadata, keyed by id, indexed by bookId
  IMAGE_BLOBS:   "image_blobs",     // Uint8Array image data, keyed by `image:${imageId}`
  AUDIO_META:    "audio_meta",      // AudioArtifact metadata, keyed by id, indexed by bookId
  AUDIO_BLOBS:   "audio_blobs",     // Uint8Array audio data, keyed by audio artifact id
  PRESENTATIONS: "presentations",   // PresentationDeck, keyed by id, indexed by bookId
  BOOK_SETTINGS: "book_settings",   // {seedId}, keyed by bookId
  ARCHIVE_BOOKS: "archive_books",   // ArchiveBook, keyed by bookId
  API_KEYS:      "api_keys",        // string values, keyed by key name
  DOWNLOAD_LEDGER: "download_ledger", // Open Shelf download ledger, keyed by gutenbergId
  NOTIFICATIONS: "notifications",   // LuminaNotification, keyed by id, indexed by bookId
  // PLAN IX v2 — Project Studio
  PROJECTS:      "projects",        // Project, keyed by id
  PROJECT_ARTIFACTS: "project_artifacts", // ProjectArtifact, keyed by id, indexed by projectId
  PROJECT_RELATIONS: "project_relations", // ProjectRelation, keyed by id, indexed by projectId
  PROJECT_DOCUMENTS: "project_documents", // ProjectDocument, keyed by id, indexed by projectId
} as const;

// ─── Store registry + lifecycle classes (PLANx) ────────────────────────────────
//
// One declarative source of truth for every object store. The lifecycle class is
// what makes "an app update must never delete the reader's work" enforceable
// rather than remembered:
//
//   userData  — the reader's own irreplaceable data (the book, their annotations,
//               progress, achievements, API keys). NEVER cleared by an update;
//               removed only by an explicit reader action (delete book / note).
//   generated — expensive AI output (images, audio, analysis, study, decks).
//               Preserved across updates; retired only by explicit reader cleanup
//               such as delete-book / purge-artifact. Remaking it costs real quota.
//   cache     — purely derived, cheap to rebuild. The ONLY class an update may
//               prune (by age/size — never a wholesale wipe).
//
// Schema evolution is additive-only: append a store here (and bump DB_VERSION).
// Never remove a store from the registry and never add a destructive op.
export type StoreLifecycle = "userData" | "generated" | "cache";

interface StoreDef {
  name: string;
  lifecycle: StoreLifecycle;
  /** keyPath for in-line keys; omit for stores that pass an explicit key on put(). */
  keyPath?: string;
  indexes?: { name: string; keyPath: string; unique?: boolean }[];
}

const BOOK_INDEX = [{ name: "bookId", keyPath: "bookId" }];
const PROJECT_INDEX = [{ name: "projectId", keyPath: "projectId" }];

export const STORE_REGISTRY: StoreDef[] = [
  { name: STORES.BOOKS,           lifecycle: "userData",  keyPath: "id" },
  { name: STORES.BOOK_STRUCTURES, lifecycle: "userData" },
  { name: STORES.EPUBS,           lifecycle: "userData" },
  { name: STORES.PROGRESS,        lifecycle: "userData",  keyPath: "bookId" },
  { name: STORES.HIGHLIGHTS,      lifecycle: "userData",  keyPath: "id", indexes: BOOK_INDEX },
  { name: STORES.NOTES,           lifecycle: "userData",  keyPath: "id", indexes: BOOK_INDEX },
  { name: STORES.STUDY_ATTEMPTS,  lifecycle: "userData",  keyPath: "id", indexes: BOOK_INDEX },
  { name: STORES.STUDY_BADGES,    lifecycle: "userData",  keyPath: "id", indexes: BOOK_INDEX },
  { name: STORES.BOOK_SETTINGS,   lifecycle: "userData" },
  { name: STORES.API_KEYS,        lifecycle: "userData" },
  { name: STORES.DOWNLOAD_LEDGER, lifecycle: "userData", keyPath: "gutenbergId" },
  { name: STORES.NOTIFICATIONS,   lifecycle: "userData",  keyPath: "id", indexes: BOOK_INDEX },

  { name: STORES.SEMANTIC_MAPS,   lifecycle: "generated" },
  { name: STORES.BOOK_PROFILES,   lifecycle: "generated" },
  { name: STORES.BLACKBOARD_NOTES, lifecycle: "generated", keyPath: "id", indexes: BOOK_INDEX },
  { name: STORES.SOURCE_PROFILES, lifecycle: "generated" },
  { name: STORES.STUDY_GUIDES,    lifecycle: "generated" },
  { name: STORES.STUDY_QUIZZES,   lifecycle: "generated", keyPath: "id", indexes: BOOK_INDEX },
  { name: STORES.STUDY_FLASHCARDS,lifecycle: "generated", keyPath: "id", indexes: BOOK_INDEX },
  { name: STORES.IMAGE_META,      lifecycle: "generated", keyPath: "id", indexes: BOOK_INDEX },
  { name: STORES.IMAGE_BLOBS,     lifecycle: "generated" },
  { name: STORES.AUDIO_META,      lifecycle: "generated", keyPath: "id", indexes: BOOK_INDEX },
  { name: STORES.AUDIO_BLOBS,     lifecycle: "generated" },
  { name: STORES.PRESENTATIONS,   lifecycle: "generated", keyPath: "id", indexes: BOOK_INDEX },
  { name: STORES.ARCHIVE_BOOKS,   lifecycle: "generated" },

  // PLAN IX v2 — Project Studio. Projects + the written document are the reader's
  // own irreplaceable work (userData); artifacts + relations are derived (generated).
  { name: STORES.PROJECTS,          lifecycle: "userData",  keyPath: "id" },
  { name: STORES.PROJECT_DOCUMENTS, lifecycle: "userData",  keyPath: "id", indexes: PROJECT_INDEX },
  { name: STORES.PROJECT_ARTIFACTS, lifecycle: "generated", keyPath: "id", indexes: PROJECT_INDEX },
  { name: STORES.PROJECT_RELATIONS, lifecycle: "generated", keyPath: "id", indexes: PROJECT_INDEX },
];

/** All store names of a given lifecycle class. */
export function storesByLifecycle(lifecycle: StoreLifecycle): string[] {
  return STORE_REGISTRY.filter((s) => s.lifecycle === lifecycle).map((s) => s.name);
}

// Dev-time guard: every store declared in STORES must appear in STORE_REGISTRY,
// or it would never be created and its reads would silently return empty. This is
// the footgun PLANx exists to prevent, caught at load instead of as lost data.
if (import.meta.env?.DEV) {
  const registered = new Set(STORE_REGISTRY.map((s) => s.name));
  const missing = Object.values(STORES).filter((name) => !registered.has(name));
  if (missing.length > 0) {
    console.error("[webDb] STORE_REGISTRY is missing stores declared in STORES:", missing);
  }
}

// ─── DB singleton ──────────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

function dbError(error: DOMException | null, fallback: string): Error {
  if (error instanceof Error) return error;
  return new Error(fallback);
}

export function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  // Bring the database up to the current schema from the STORE_REGISTRY. Purely
  // additive: it only ever CREATES stores/indexes that aren't already present, so
  // it can run from any prior version (or twice) without dropping or clearing a
  // single record. No destructive operation exists in this path by construction.
  const applyUpgrade = (db: IDBDatabase, tx: IDBTransaction | null) => {
    for (const def of STORE_REGISTRY) {
      const exists = db.objectStoreNames.contains(def.name);
      const store = exists
        ? tx?.objectStore(def.name) ?? null
        : db.createObjectStore(def.name, def.keyPath ? { keyPath: def.keyPath } : undefined);

      // Ensure indexes — on a freshly created store, and additively on an existing
      // one that predates an index we've since added.
      if (store && def.indexes) {
        for (const idx of def.indexes) {
          if (!store.indexNames.contains(idx.name)) {
            store.createIndex(idx.name, idx.keyPath, { unique: idx.unique ?? false });
          }
        }
      }
    }
  };

  return new Promise((resolve, reject) => {
    const attach = (db: IDBDatabase) => {
      _db = db;
      _db.onclose = () => { _db = null; }; // reset on unexpected close
      // If another tab opens a newer version, step aside so it isn't blocked.
      _db.onversionchange = () => { try { _db?.close(); } catch { /* ignore */ } _db = null; };
      resolve(_db);
    };

    // Recovery path: if the database ON DISK is at a HIGHER version than this
    // build knows (e.g. a stale/cached PWA bundle meeting a database an updated
    // bundle already upgraded), a versioned open throws VersionError and every
    // query would fail — blanking the library even though the data is intact.
    // Re-open WITHOUT a version to attach to the existing database read-compatibly
    // so the user's books, images, and analysis still load.
    const openExisting = () => {
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => attach(req.result);
      req.onerror = () => reject(dbError(req.error, "Failed to open existing Lumina database"));
      req.onblocked = () => console.warn("[webDb] open blocked by another tab");
    };

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const req = event.target as IDBOpenDBRequest;
      applyUpgrade(req.result, req.transaction);
    };
    request.onsuccess = () => attach(request.result);
    request.onblocked = () => console.warn("[webDb] upgrade blocked by another open tab");
    request.onerror = () => {
      if (request.error?.name === "VersionError") {
        console.warn(
          "[webDb] Database on disk is newer than this build; opening read-compatible so data still loads."
        );
        openExisting();
      } else {
        reject(dbError(request.error, "Failed to open Lumina database"));
      }
    };
  });
}

// ─── Primitive helpers ────────────────────────────────────────────────────────

// Version-skew tolerance (PLANx): if this build is talking to a database that
// doesn't have a store yet (e.g. a stale PWA bundle opened the DB read-compatibly
// without running the upgrade), a read must resolve EMPTY and a delete must no-op
// — never throw. One missing store can never again blank the whole library.
function hasStore(db: IDBDatabase, store: string): boolean {
  return db.objectStoreNames.contains(store);
}

export function dbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!hasStore(db, store)) return resolve(undefined);
        const req = db.transaction(store, "readonly").objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(dbError(req.error, `Failed to read from ${store}`));
      })
  );
}

export function dbPut(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req =
          key !== undefined
            ? db.transaction(store, "readwrite").objectStore(store).put(value, key)
            : db.transaction(store, "readwrite").objectStore(store).put(value);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(dbError(req.error, `Failed to write to ${store}`));
      })
  );
}

export function dbDelete(store: string, key: IDBValidKey): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!hasStore(db, store)) return resolve();
        const req = db.transaction(store, "readwrite").objectStore(store).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(dbError(req.error, `Failed to delete from ${store}`));
      })
  );
}

export function dbGetAll<T>(store: string): Promise<T[]> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!hasStore(db, store)) return resolve([]);
        const req = db.transaction(store, "readonly").objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(dbError(req.error, `Failed to read all from ${store}`));
      })
  );
}

export function dbGetByIndex<T>(
  store: string,
  indexName: string,
  key: IDBValidKey
): Promise<T[]> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!hasStore(db, store)) return resolve([]);
        const req = db
          .transaction(store, "readonly")
          .objectStore(store)
          .index(indexName)
          .getAll(key);
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(dbError(req.error, `Failed to read ${store}.${indexName}`));
      })
  );
}

/** Delete all records in a store whose `indexName` value equals `key`. */
export function dbDeleteByIndex(
  store: string,
  indexName: string,
  key: IDBValidKey
): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!hasStore(db, store)) return resolve();
        const tx = db.transaction(store, "readwrite");
        const objStore = tx.objectStore(store);
        const keyReq = objStore.index(indexName).getAllKeys(key);

        keyReq.onsuccess = () => {
          const keys = keyReq.result;
          if (keys.length === 0) { resolve(); return; }
          let remaining = keys.length;
          for (const k of keys) {
            const del = objStore.delete(k);
            del.onsuccess = () => { if (--remaining === 0) resolve(); };
            del.onerror = () => reject(dbError(del.error, `Failed to delete indexed record from ${store}`));
          }
        };
        keyReq.onerror = () => reject(dbError(keyReq.error, `Failed to read keys from ${store}.${indexName}`));
      })
  );
}

/** Delete all records in a store whose bookId starts with a given prefix. */
export function dbDeleteByPrefix(store: string, indexName: string, prefix: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!hasStore(db, store)) return resolve();
        const range = IDBKeyRange.bound(prefix, prefix + "￿", false, true);
        const tx = db.transaction(store, "readwrite");
        const objStore = tx.objectStore(store);
        const keyReq = objStore.index(indexName).getAllKeys(range);

        keyReq.onsuccess = () => {
          const keys = keyReq.result;
          if (keys.length === 0) { resolve(); return; }
          let remaining = keys.length;
          for (const k of keys) {
            const del = objStore.delete(k);
            del.onsuccess = () => { if (--remaining === 0) resolve(); };
            del.onerror = () => reject(dbError(del.error, `Failed to delete prefixed record from ${store}`));
          }
        };
        keyReq.onerror = () => reject(dbError(keyReq.error, `Failed to read prefixed keys from ${store}.${indexName}`));
      })
  );
}
