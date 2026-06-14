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

const CACHE_VERSION = "lumina-v5";
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const scoped = (path) => `${SCOPE_PATH}${path}`.replace(/\/{2,}/g, "/");

// ─── Install ─────────────────────────────────────────────────────────────────
// Pre-cache the app shell (the HTML entry point). Everything else caches
// lazily on first fetch, so we don't need to enumerate hashed asset filenames.

self.addEventListener("install", (event) => {
  // Do NOT precache index.html — a stale shell is the #1 reason PWAs miss deploys.
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll([scoped("manifest.webmanifest"), scoped("icons/icon.svg")]))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate ────────────────────────────────────────────────────────────────
// Remove caches from older versions so stale assets don't pile up.

self.addEventListener("message", (event) => {
  if (event.origin && event.origin !== self.location.origin) {
    return;
  }
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

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

  // version.json must always hit the network — the app uses it to detect deploys.
  if (url.pathname.endsWith("/version.json")) {
    event.respondWith(fetch(request));
    return;
  }

  // Navigation: network-only when online (never write a cached shell on success).
  // Offline fallback uses the last cached copy if one exists.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(SCOPE_PATH) ?? caches.match(request))
    );
    return;
  }

  // JS/CSS app bundles: network-first so deployed updates actually land.
  // If the tablet is offline, fall back to the cached copy.
  if (
    request.destination === "script" ||
    request.destination === "style" ||
    url.pathname.includes("/assets/")
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Other static assets (images, fonts, icons): cache-first.
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
