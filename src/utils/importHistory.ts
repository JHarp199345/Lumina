export interface ImportHistoryEntry {
  gutenbergId: number;
  title: string;
  author: string;
  /** Set when the auto-import succeeded (never went to browser download). */
  importedAt?: string;
  /** Set when a browser download was triggered. */
  filename?: string;
  downloadedAt?: string;
  /** Original download URL for re-download from history. */
  downloadUrl?: string;
}

const HISTORY_KEY = "lumina_import_history";
const MAX_ENTRIES = 30;

export function loadImportHistory(): ImportHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as ImportHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function recordImportHistory(entry: ImportHistoryEntry): void {
  try {
    const existing = loadImportHistory();
    const updated = [entry, ...existing.filter((e) => e.gutenbergId !== entry.gutenbergId)];
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated.slice(0, MAX_ENTRIES)));
  } catch { /* ignore */ }
}

export function clearImportHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch { /* ignore */ }
}
