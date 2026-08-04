// ─── pi-web-switch Service Worker ───────────────────────
// Strategy:
//   - HTML navigation (index.html / SPA routes): NETWORK-FIRST.
//     Every refresh must hit the network so deploys show up on a plain
//     Cmd+R reload; the cached copy is only a fallback for offline use.
//   - Static assets (hashed js/css): CACHE-FIRST — safe because Vite
//     fingerprints filenames, so a new deploy means new URLs.
//   - API calls: NETWORK-FIRST, fallback to cache.
// Bump CACHE_VERSION when the SW logic changes to purge old caches.

const CACHE_VERSION = "pi-web-switch-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// NOTE: index.html is intentionally NOT precached. Pre-caching it would
// make Cmd+R reloads serve the stale page after a deploy.
const PRECACHE_URLS = [
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

// ─── Install: precache core assets ─────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate: clean old caches ────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(CACHE_VERSION))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── Fetch: strategy by request type ───────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET; ignore cross-origin and chrome-extension.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API calls: network-first, fallback to cache.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // HTML navigation: network-first so a plain refresh always gets the
  // latest build. Fall back to the last cached copy only when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put("/index.html", copy));
          }
          return response;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Static assets: cache-first, then network (and cache the result).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }
        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
