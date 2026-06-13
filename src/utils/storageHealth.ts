import { diagnosticInfo, diagnosticWarn } from "@/utils/diagnostics";

const PROBE_DB = "lumina-storage-probe";
const PROBE_STORE = "probe";
const PROBE_KEY = "last-write";

function isTauriRuntime(): boolean {
  return typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";
}

function testLocalStorage(): boolean {
  try {
    const key = "lumina-storage-probe";
    const value = `${Date.now()}`;
    window.localStorage.setItem(key, value);
    const ok = window.localStorage.getItem(key) === value;
    window.localStorage.removeItem(key);
    return ok;
  } catch {
    return false;
  }
}

function testIndexedDb(): Promise<boolean> {
  if (!("indexedDB" in window)) return Promise.resolve(false);

  return new Promise((resolve) => {
    const request = indexedDB.open(PROBE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROBE_STORE)) {
        db.createObjectStore(PROBE_STORE);
      }
    };
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result;
      try {
        const tx = db.transaction(PROBE_STORE, "readwrite");
        tx.objectStore(PROBE_STORE).put(Date.now(), PROBE_KEY);
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => {
          db.close();
          resolve(false);
        };
      } catch {
        db.close();
        resolve(false);
      }
    };
  });
}

async function requestPersistentStorage(): Promise<{ persisted?: boolean; granted?: boolean; estimate?: StorageEstimate }> {
  const storageManager = navigator.storage;
  if (!storageManager) return {};

  const [persisted, estimate] = await Promise.all([
    storageManager.persisted?.().catch(() => undefined),
    storageManager.estimate?.().catch(() => undefined),
  ]);

  const granted = persisted || await storageManager.persist?.().catch(() => undefined);
  return { persisted, granted, estimate };
}

export async function checkWebStorageHealth(): Promise<void> {
  if (isTauriRuntime()) return;

  const localStorageOk = testLocalStorage();
  const indexedDbOk = await testIndexedDb();
  const persistence = await requestPersistentStorage();

  const data = {
    localStorageOk,
    indexedDbOk,
    persisted: persistence.persisted,
    persistenceGranted: persistence.granted,
    quota: persistence.estimate?.quota,
    usage: persistence.estimate?.usage,
    userAgent: navigator.userAgent,
    standalone:
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  };

  if (!localStorageOk || !indexedDbOk) {
    diagnosticWarn("storage.health.unavailable", "Browser storage is unavailable; settings, keys, or books may not survive reload.", data);
    return;
  }

  if (persistence.granted === false) {
    diagnosticWarn("storage.health.not_persistent", "Browser storage works, but persistent storage was not granted.", data);
    return;
  }

  diagnosticInfo("storage.health.ready", "Browser storage health check passed.", data);
}
