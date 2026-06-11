/**
 * fetch() header values must be ISO-8859-1 (ByteString). Unicode in book titles
 * (em-dashes, curly quotes) otherwise breaks every Odysseus agent call during ingestion.
 */
export function httpHeaderSafe(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2026]/g, "...")
    .replace(/[^\x00-\xFF]/g, "?");
}

export function httpHeaderSafeRecord(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v) out[k] = httpHeaderSafe(v);
  }
  return out;
}
