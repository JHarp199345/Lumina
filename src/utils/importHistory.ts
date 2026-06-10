import type { Book } from "@/types";
import { STORES, dbDelete, dbGetAll, dbPut } from "@/storage/webDb";
import { gutenbergIdFromFilename } from "@/utils/downloadFilename";
import { isTauri } from "@/utils/runtime";

async function tauriLedger() {
  return import("@/services/db");
}

export type DownloadLedgerStatus = "requested" | "confirmed" | "imported";

export interface ImportHistoryEntry {
  gutenbergId: number;
  title: string;
  author: string;
  /** Stable match key: gutenberg id + canonical URL filename. */
  anchor?: string;
  /** Set when the book was imported into the library. */
  importedAt?: string;
  /** Canonical filename from the download URL (stable even if user renames on disk). */
  filename?: string;
  /** When Download was tapped and the browser handoff started. */
  downloadedAt?: string;
  /** When the reader left Lumina (blur / tab hidden) after download — likely on device. */
  downloadConfirmedAt?: string;
  downloadStatus?: DownloadLedgerStatus;
  /** Original download URL for re-download from history. */
  downloadUrl?: string;
}

const LEGACY_LOCAL_KEY = "lumina_import_history";
const MAX_ENTRIES = 100;

let legacyMigrationDone = false;

export function buildLedgerAnchor(gutenbergId: number, filename: string): string {
  return `gutenberg:${gutenbergId}:${normalizeFilenameForMatch(filename)}`;
}

export function normalizeFilenameForMatch(name: string): string {
  const base = name.trim().toLowerCase().split("/").pop() ?? name;
  return base.replace(/\.epub$/i, "");
}

function filenamesLooselyMatch(
  ledgerFilename: string,
  importedName: string,
  gutenbergId: number
): boolean {
  const canonical = normalizeFilenameForMatch(ledgerFilename);
  const picked = normalizeFilenameForMatch(importedName);
  if (canonical === picked) return true;
  if (picked.includes(`pg${gutenbergId}`)) return true;
  if (picked.includes(String(gutenbergId)) && canonical.includes(String(gutenbergId))) return true;
  return false;
}

function entryTimestamp(entry: ImportHistoryEntry): number {
  const iso = entry.importedAt ?? entry.downloadConfirmedAt ?? entry.downloadedAt;
  return iso ? Date.parse(iso) : 0;
}

function sortLedger(entries: ImportHistoryEntry[]): ImportHistoryEntry[] {
  return [...entries].sort((a, b) => entryTimestamp(b) - entryTimestamp(a));
}

function mergeEntry(prior: ImportHistoryEntry | undefined, entry: ImportHistoryEntry): ImportHistoryEntry {
  const filename = entry.filename ?? prior?.filename;
  return {
    ...prior,
    ...entry,
    gutenbergId: entry.gutenbergId,
    title: entry.title || prior?.title || "Unknown title",
    author: entry.author || prior?.author || "Unknown author",
    anchor:
      entry.anchor ??
      prior?.anchor ??
      (filename ? buildLedgerAnchor(entry.gutenbergId, filename) : undefined),
    downloadedAt: entry.downloadedAt ?? prior?.downloadedAt,
    downloadConfirmedAt: entry.downloadConfirmedAt ?? prior?.downloadConfirmedAt,
    importedAt: entry.importedAt ?? prior?.importedAt,
    filename,
    downloadUrl: entry.downloadUrl ?? prior?.downloadUrl,
    downloadStatus: pickStatus(prior?.downloadStatus, entry.downloadStatus, entry.importedAt ?? prior?.importedAt),
  };
}

function pickStatus(
  prior: DownloadLedgerStatus | undefined,
  next: DownloadLedgerStatus | undefined,
  importedAt?: string
): DownloadLedgerStatus | undefined {
  if (importedAt || next === "imported" || prior === "imported") return "imported";
  if (next === "confirmed" || prior === "confirmed") return "confirmed";
  return next ?? prior ?? "requested";
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function libraryBookMatchesLedger(book: Pick<Book, "gutenbergId" | "title" | "editionPipeline" | "importSource">, entry: ImportHistoryEntry): boolean {
  if (book.gutenbergId === entry.gutenbergId) return true;
  const isGutenbergBook =
    book.editionPipeline === "gutenberg" || book.importSource === "gutenberg";
  return isGutenbergBook && normalizeTitle(book.title) === normalizeTitle(entry.title);
}

export function isLedgerEntryImported(
  entry: ImportHistoryEntry,
  library: Pick<Book, "gutenbergId" | "title" | "editionPipeline" | "importSource">[]
): boolean {
  if (entry.downloadStatus === "imported" || Boolean(entry.importedAt)) return true;
  return library.some((book) => libraryBookMatchesLedger(book, entry));
}

export function ledgerStatusLabel(entry: ImportHistoryEntry, imported: boolean): string {
  if (imported) return "Imported";
  if (entry.downloadStatus === "confirmed" || entry.downloadConfirmedAt) return "Likely on device";
  return "Download started";
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

    const migrated = legacy.map((row) =>
      mergeEntry(undefined, {
        ...row,
        downloadStatus: row.importedAt ? "imported" : row.downloadedAt ? "requested" : row.downloadStatus,
      })
    );
    await writeLedger(sortLedger(migrated).slice(0, MAX_ENTRIES));
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
  return sortLedger(
    entries.map((row) =>
      mergeEntry(undefined, {
        ...row,
        downloadStatus: parseDownloadStatus(row.downloadStatus),
      })
    )
  );
}

function parseDownloadStatus(value: unknown): DownloadLedgerStatus | undefined {
  if (value === "requested" || value === "confirmed" || value === "imported") return value;
  return undefined;
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
    const merged = mergeEntry(prior, entry);
    const updated = [merged, ...existing.filter((e) => e.gutenbergId !== entry.gutenbergId)];
    await writeLedger(updated);
  } catch (err) {
    console.error("[DownloadLedger] Record failed:", err);
  }
}

/** Reader left Lumina after download — treat as likely on-device. */
export async function confirmDownloadHandoff(gutenbergId: number): Promise<void> {
  try {
    const existing = await readLedger();
    const row = existing.find((e) => e.gutenbergId === gutenbergId);
    if (!row || row.downloadStatus === "imported") return;
    await recordImportHistory({
      ...row,
      downloadStatus: "confirmed",
      downloadConfirmedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[DownloadLedger] Confirm handoff failed:", err);
  }
}

function resolveGutenbergIdForImport(params: {
  gutenbergId?: number;
  importedFileName?: string;
}): number | undefined {
  return params.gutenbergId ?? (params.importedFileName ? gutenbergIdFromFilename(params.importedFileName) : undefined);
}

export async function matchLedgerForImport(params: {
  gutenbergId?: number;
  importedFileName?: string;
}): Promise<ImportHistoryEntry | undefined> {
  const ledger = await readLedger();
  const gutenbergId = resolveGutenbergIdForImport(params);

  if (gutenbergId) {
    const byId = ledger.find((e) => e.gutenbergId === gutenbergId);
    if (byId) return byId;
  }

  if (!params.importedFileName) return undefined;

  for (const row of ledger) {
    if (row.filename && filenamesLooselyMatch(row.filename, params.importedFileName, row.gutenbergId)) {
      return row;
    }
    if (row.anchor && gutenbergId && row.anchor === buildLedgerAnchor(gutenbergId, params.importedFileName)) {
      return row;
    }
  }

  return undefined;
}

/** Backfill ledger rows that already exist in the library (e.g. pre-tracking imports). */
export async function reconcileLedgerWithLibrary(
  library: Pick<Book, "gutenbergId" | "title" | "editionPipeline" | "importSource">[]
): Promise<void> {
  try {
    const ledger = await readLedger();
    for (const entry of ledger) {
      if (entry.downloadStatus === "imported" || entry.importedAt) continue;
      if (!library.some((book) => libraryBookMatchesLedger(book, entry))) continue;
      await recordImportHistory({
        ...entry,
        downloadStatus: "imported",
        importedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn("[DownloadLedger] Library reconcile failed:", err);
  }
}

export async function markLedgerImportedFromImport(params: {
  gutenbergId?: number;
  importedFileName?: string;
}): Promise<void> {
  try {
    const row = await matchLedgerForImport(params);
    if (!row) return;
    await recordImportHistory({
      ...row,
      downloadStatus: "imported",
      importedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[DownloadLedger] Mark imported failed:", err);
  }
}

/** @deprecated Use markLedgerImportedFromImport */
export async function markImportHistoryImported(gutenbergId: number): Promise<void> {
  return markLedgerImportedFromImport({ gutenbergId });
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
