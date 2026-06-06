/**
 * Lumina Service Worker
 *
 * Strategy: cache-first for all same-origin assets, network-first for navigation.
 * All assets fetched successfully are added to the cache automatically, so the
 * app becomes fully available offline after first load without listing hashed
 * filenames in advance (Vite changes them on every build).
 *
 * Books and generated images are stored in IndexedDB by the app — NOT here.
 */

const CACHE_VERSION = "lumina-v2";
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const scoped = (path) => `${SCOPE_PATH}${path}`.replace(/\/{2,}/g, "/");

// ─── Install ─────────────────────────────────────────────────────────────────
// Pre-cache the app shell (the HTML entry point). Everything else caches
// lazily on first fetch, so we don't need to enumerate hashed asset filenames.

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll([SCOPE_PATH, scoped("manifest.webmanifest"), scoped("icons/icon.svg")]))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate ────────────────────────────────────────────────────────────────
// Remove caches from older versions so stale assets don't pile up.

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // The recovery page should never be trapped behind a stale cached copy.
  if (url.pathname.endsWith("/clear-sw.html")) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  // Navigation requests (HTML pages): network-first so updates land immediately,
  // falling back to cached index.html for offline use.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(SCOPE_PATH))
    );
    return;
  }

  // Static assets (JS, CSS, images, fonts): cache-first.
  // On cache miss, fetch from network and add to cache for next time.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          }
          return response;
        })
    )
  );
});
