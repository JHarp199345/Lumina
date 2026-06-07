export type DiagnosticLevel = "info" | "warn" | "error";

export interface DiagnosticEntry {
  id: string;
  timestamp: string;
  level: DiagnosticLevel;
  event: string;
  message?: string;
  data?: unknown;
}

const STORAGE_KEY = "lumina.diagnostics.v1";
const MAX_ENTRIES = 1000;

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { value: safeStringify(error) };
}

function readEntries(): DiagnosticEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getDiagnosticEntries(): DiagnosticEntry[] {
  return readEntries();
}

function writeEntries(entries: DiagnosticEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Logging must never break the reader.
  }
}

export function diagnosticLog(
  level: DiagnosticLevel,
  event: string,
  message?: string,
  data?: unknown
): DiagnosticEntry {
  const entry: DiagnosticEntry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    level,
    event,
    message,
    data,
  };

  const entries = [...readEntries(), entry].slice(-MAX_ENTRIES);
  writeEntries(entries);

  const consolePayload = data === undefined ? "" : data;
  if (level === "error") console.error(`[Lumina:${event}] ${message ?? ""}`, consolePayload);
  else if (level === "warn") console.warn(`[Lumina:${event}] ${message ?? ""}`, consolePayload);
  else console.info(`[Lumina:${event}] ${message ?? ""}`, consolePayload);

  return entry;
}

export function diagnosticInfo(event: string, message?: string, data?: unknown): DiagnosticEntry {
  return diagnosticLog("info", event, message, data);
}

export function diagnosticWarn(event: string, message?: string, data?: unknown): DiagnosticEntry {
  return diagnosticLog("warn", event, message, data);
}

export function diagnosticError(event: string, message?: string, data?: unknown): DiagnosticEntry {
  return diagnosticLog("error", event, message, data);
}

export function installDiagnostics(): void {
  const hostApi = {
    entries: readEntries,
    clear: () => writeEntries([]),
    export: () => JSON.stringify(readEntries(), null, 2),
  };

  (window as Window & { __luminaDiagnostics?: typeof hostApi }).__luminaDiagnostics = hostApi;

  window.addEventListener("error", (event) => {
    diagnosticError("window.error", event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: serializeError(event.error),
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    diagnosticError("window.unhandledrejection", "Unhandled promise rejection", {
      reason: serializeError(event.reason),
    });
  });

  diagnosticInfo("diagnostics.ready", "Diagnostics installed", {
    href: window.location.href,
    userAgent: navigator.userAgent,
  });
}
