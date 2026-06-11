const DEFAULT_LOCAL = "http://localhost:7860";

/**
 * Normalize the Odysseus Server URL for cross-origin fetch from the Lumina PWA.
 *
 * Without a protocol, browsers resolve the URL relative to the GitHub Pages
 * origin (e.g. jharp199345.github.io/Lumina/…) — which returns 404 on /api/agents
 * even when the field looks correct.
 */
export function normalizeOdysseusUrl(raw: string | undefined | null): string {
  let u = (raw ?? "").trim();
  if (!u) return DEFAULT_LOCAL;

  // Accidental copy-paste from browser address bar or Lumina link
  u = u.replace(/\/+(login|Lumina|api)\/?$/i, "");

  if (/github\.io/i.test(u)) {
    throw new Error(
      "Server URL must be your Odysseus tunnel (https://….trycloudflare.com), not the Lumina GitHub Pages link."
    );
  }

  if (!/^https?:\/\//i.test(u)) {
    if (/^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(u)) {
      u = `http://${u}`;
    } else {
      u = `https://${u}`;
    }
  }

  return u.replace(/\/+$/, "");
}

export function odysseusApiBase(raw?: string | null): string {
  return normalizeOdysseusUrl(raw);
}
