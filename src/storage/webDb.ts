/**
 * webDb — lightweight IndexedDB wrapper for the Lumina web/PWA runtime.
 *
 * All stores are created in a single database ("lumina", v1).
 * Each helper returns a Promise so callers use async/await naturally.
 */

const DB_NAME = "lumina";
const DB_VERSION = 8;

export const STORES = {
  SOURCE_PROFILES: "source_profiles", // SourceIntelligenceProfile, keyed by bookId
  BOOKS:         "books",           // keyed by book.id
  BOOK_STRUCTURES: "book_structures", // BookStructure snapshots, keyed by bookId
  EPUBS:         "epubs",           // ArrayBuffer EPUB blobs, keyed by bookId
  PROGRESS:      "progress",        // ReadingProgress, keyed by bookId
  HIGHLIGHTS:    "highlights",      // Highlight[], keyed by id, indexed by bookId
  NOTES:         "notes",           // Note[], keyed by id, indexed by bookId
  SEMANTIC_MAPS: "semantic_maps",   // SemanticMap, keyed by bookId
  STUDY_GUIDES:  "study_guides",    // StudyGuide, keyed by bookId
  STUDY_QUIZZES: "study_quizzes",    // StudyQuiz, keyed by id, indexed by bookId
  STUDY_ATTEMPTS:"study_attempts",   // StudyQuizAttempt, keyed by id, indexed by bookId
  STUDY_BADGES:  "study_badges",     // StudyBadgeAward, keyed by id, indexed by bookId
  STUDY_FLASHCARDS: "study_flashcards", // StudyFlashcard, keyed by id, indexed by bookId
  IMAGE_META:    "image_meta",      // CachedImage metadata, keyed by id, indexed by bookId
  IMAGE_BLOBS:   "image_blobs",     // Uint8Array image data, keyed by sceneId
  AUDIO_META:    "audio_meta",      // AudioArtifact metadata, keyed by id, indexed by bookId
  AUDIO_BLOBS:   "audio_blobs",     // Uint8Array audio data, keyed by audio artifact id
  BOOK_SETTINGS: "book_settings",   // {seedId}, keyed by bookId
  API_KEYS:      "api_keys",        // string values, keyed by key name
} as const;

// ─── DB singleton ──────────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      const ensure = (name: string, options?: IDBObjectStoreParameters) => {
        if (!db.objectStoreNames.contains(name)) {
          return db.createObjectStore(name, options);
        }
        return null; // already exists
      };

      ensure(STORES.BOOKS,         { keyPath: "id" });
      ensure(STORES.BOOK_STRUCTURES);                  // explicit key on put()
      ensure(STORES.EPUBS);                            // explicit key on put()
      ensure(STORES.PROGRESS,      { keyPath: "bookId" });

      const hlStore = ensure(STORES.HIGHLIGHTS, { keyPath: "id" });
      hlStore?.createIndex("bookId", "bookId", { unique: false });

      const noteStore = ensure(STORES.NOTES, { keyPath: "id" });
      noteStore?.createIndex("bookId", "bookId", { unique: false });

      ensure(STORES.SEMANTIC_MAPS);                    // explicit key on put()
      ensure(STORES.SOURCE_PROFILES);                  // explicit key on put() (bookId)
      ensure(STORES.STUDY_GUIDES);                     // explicit key on put() (bookId)

      const studyQuizzes = ensure(STORES.STUDY_QUIZZES, { keyPath: "id" });
      studyQuizzes?.createIndex("bookId", "bookId", { unique: false });

      const studyAttempts = ensure(STORES.STUDY_ATTEMPTS, { keyPath: "id" });
      studyAttempts?.createIndex("bookId", "bookId", { unique: false });

      const studyBadges = ensure(STORES.STUDY_BADGES, { keyPath: "id" });
      studyBadges?.createIndex("bookId", "bookId", { unique: false });

      const studyFlashcards = ensure(STORES.STUDY_FLASHCARDS, { keyPath: "id" });
      studyFlashcards?.createIndex("bookId", "bookId", { unique: false });

      const imgMeta = ensure(STORES.IMAGE_META, { keyPath: "id" });
      imgMeta?.createIndex("bookId", "bookId", { unique: false });

      ensure(STORES.IMAGE_BLOBS);                      // explicit key (sceneId)

      const audioMeta = ensure(STORES.AUDIO_META, { keyPath: "id" });
      audioMeta?.createIndex("bookId", "bookId", { unique: false });
      ensure(STORES.AUDIO_BLOBS);                      // explicit key (audio artifact id)

      ensure(STORES.BOOK_SETTINGS);                    // explicit key (bookId)
      ensure(STORES.API_KEYS);                         // explicit key (name)
    };

    request.onsuccess = () => {
      _db = request.result;
      _db.onclose = () => { _db = null; }; // reset on unexpected close
      resolve(_db);
    };

    request.onerror = () => reject(request.error);
  });
}

// ─── Primitive helpers ────────────────────────────────────────────────────────

export function dbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, "readonly").objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
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
        req.onerror = () => reject(req.error);
      })
  );
}

export function dbDelete(store: string, key: IDBValidKey): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, "readwrite").objectStore(store).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      })
  );
}

export function dbGetAll<T>(store: string): Promise<T[]> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, "readonly").objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(req.error);
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
        const req = db
          .transaction(store, "readonly")
          .objectStore(store)
          .index(indexName)
          .getAll(key);
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(req.error);
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
            del.onerror = () => reject(del.error);
          }
        };
        keyReq.onerror = () => reject(keyReq.error);
      })
  );
}

/** Delete all records in a store whose bookId starts with a given prefix. */
export function dbDeleteByPrefix(store: string, indexName: string, prefix: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
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
            del.onerror = () => reject(del.error);
          }
        };
        keyReq.onerror = () => reject(keyReq.error);
      })
  );
}
