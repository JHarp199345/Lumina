import { STORES, dbDelete, dbGetAll, dbPut } from "@/storage/webDb";
import { isTauri } from "@/utils/runtime";

async function tauriLedger() {
  return import("@/services/db");
}

export interface ImportHistoryEntry {
  gutenbergId: number;
  title: string;
  author: string;
  /** Set when the book was imported into the library. */
  importedAt?: string;
  /** Set when a browser download was triggered. */
  filename?: string;
  downloadedAt?: string;
  /** Original download URL for re-download from history. */
  downloadUrl?: string;
}

const LEGACY_LOCAL_KEY = "lumina_import_history";
const MAX_ENTRIES = 100;

let legacyMigrationDone = false;

function entryTimestamp(entry: ImportHistoryEntry): number {
  const iso = entry.downloadedAt ?? entry.importedAt;
  return iso ? Date.parse(iso) : 0;
}

function sortLedger(entries: ImportHistoryEntry[]): ImportHistoryEntry[] {
  return [...entries].sort((a, b) => entryTimestamp(b) - entryTimestamp(a));
}

async function migrateLegacyLocalStorage(): Promise<void> {
  if (legacyMigrationDone) return;
  legacyMigrationDone = true;

  try {
    const raw = localStorage.getItem(LEGACY_LOCAL_KEY);
    if (!raw) return;

    const legacy = JSON.parse(raw) as ImportHistoryEntry[];
    if (!Array.isArray(legacy) || legacy.length === 0) {
      localStorage.removeItem(LEGACY_LOCAL_KEY);
      return;
    }

    const existing = isTauri
      ? await (await tauriLedger()).dbLoadDownloadLedger()
      : await dbGetAll<ImportHistoryEntry>(STORES.DOWNLOAD_LEDGER);
    if (existing.length > 0) {
      localStorage.removeItem(LEGACY_LOCAL_KEY);
      return;
    }

    await writeLedger(sortLedger(legacy).slice(0, MAX_ENTRIES));
    localStorage.removeItem(LEGACY_LOCAL_KEY);
    console.info("[DownloadLedger] Migrated", legacy.length, "entries from localStorage to durable storage");
  } catch (err) {
    console.warn("[DownloadLedger] Legacy migration failed:", err);
  }
}

async function readLedger(): Promise<ImportHistoryEntry[]> {
  await migrateLegacyLocalStorage();
  const entries = isTauri
    ? await (await tauriLedger()).dbLoadDownloadLedger()
    : await dbGetAll<ImportHistoryEntry>(STORES.DOWNLOAD_LEDGER);
  return sortLedger(entries);
}

async function writeLedger(entries: ImportHistoryEntry[]): Promise<void> {
  const capped = sortLedger(entries).slice(0, MAX_ENTRIES);

  if (isTauri) {
    await (await tauriLedger()).dbSaveDownloadLedger(capped);
    return;
  }

  const existing = await dbGetAll<ImportHistoryEntry>(STORES.DOWNLOAD_LEDGER);
  const keepIds = new Set(capped.map((e) => e.gutenbergId));
  await Promise.all(
    existing
      .filter((e) => !keepIds.has(e.gutenbergId))
      .map((e) => dbDelete(STORES.DOWNLOAD_LEDGER, e.gutenbergId))
  );
  await Promise.all(capped.map((entry) => dbPut(STORES.DOWNLOAD_LEDGER, entry)));
}

export async function loadImportHistory(): Promise<ImportHistoryEntry[]> {
  try {
    return await readLedger();
  } catch (err) {
    console.warn("[DownloadLedger] Load failed:", err);
    return [];
  }
}

export async function recordImportHistory(entry: ImportHistoryEntry): Promise<void> {
  try {
    const existing = await readLedger();
    const prior = existing.find((e) => e.gutenbergId === entry.gutenbergId);
    const merged: ImportHistoryEntry = {
      ...prior,
      ...entry,
      gutenbergId: entry.gutenbergId,
      title: entry.title || prior?.title || "Unknown title",
      author: entry.author || prior?.author || "Unknown author",
      downloadedAt: entry.downloadedAt ?? prior?.downloadedAt,
      importedAt: entry.importedAt ?? prior?.importedAt,
      filename: entry.filename ?? prior?.filename,
      downloadUrl: entry.downloadUrl ?? prior?.downloadUrl,
    };
    const updated = [merged, ...existing.filter((e) => e.gutenbergId !== entry.gutenbergId)];
    await writeLedger(updated);
  } catch (err) {
    console.error("[DownloadLedger] Record failed:", err);
  }
}

/** Mark a ledger row imported after a successful library import. */
export async function markImportHistoryImported(gutenbergId: number): Promise<void> {
  try {
    const existing = await readLedger();
    const row = existing.find((e) => e.gutenbergId === gutenbergId);
    if (!row) return;
    await recordImportHistory({
      ...row,
      importedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[DownloadLedger] Mark imported failed:", err);
  }
}

export async function clearImportHistory(): Promise<void> {
  try {
    if (isTauri) {
      await (await tauriLedger()).dbClearDownloadLedger();
    } else {
      const existing = await dbGetAll<ImportHistoryEntry>(STORES.DOWNLOAD_LEDGER);
      await Promise.all(existing.map((e) => dbDelete(STORES.DOWNLOAD_LEDGER, e.gutenbergId)));
    }
    localStorage.removeItem(LEGACY_LOCAL_KEY);
  } catch (err) {
    console.warn("[DownloadLedger] Clear failed:", err);
  }
}
