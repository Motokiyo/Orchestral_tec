/**
 * OrkMap Service Worker — offline support
 *
 * The app must open with no network at all (concert halls). So:
 * - at install, every file of the build is stored (list injected by the build,
 *   see vite.config.js) — not only the pages already visited;
 * - the app itself is served from that copy at once (cache first), a new
 *   version arrives with the next service worker, one opening later;
 * - /api/* is never cached: account data lives in IndexedDB, not here;
 * - Google Fonts are kept after their first download.
 */

const BUILD_VERSION = "__ORKMAP_BUILD_VERSION__";
const PRECACHE = ["/", "/index.html", "/manifest.json"].concat(self.__ORKMAP_PRECACHE__ || []);
const CACHE_NAME = `orkmap-${BUILD_VERSION}`;
const FONT_CACHE = "orkmap-fonts";
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
// In `vite dev` the placeholder is not replaced: no caching at all there, or
// the dev server's live modules would be frozen.
const IS_BUILD = !BUILD_VERSION.startsWith("__");

self.addEventListener("install", (event) => {
  if (!IS_BUILD) {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // One by one: a single missing file must not abort the whole install.
      Promise.all(PRECACHE.map((url) =>
        cache.add(new Request(url, { cache: "reload" })).catch(() => {})
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    // Keep the previous version too: a page opened before the update may
    // still lazy-load its old files (e.g. the PDF reader). Keys come back in
    // creation order, so the last two app caches are the current and previous.
    caches.keys().then((keys) => {
      const appCaches = keys.filter((key) => key !== FONT_CACHE);
      const keep = new Set([CACHE_NAME, ...appCaches.filter((key) => key !== CACHE_NAME).slice(-1)]);
      return Promise.all(appCaches.filter((key) => !keep.has(key)).map((key) => caches.delete(key)));
    })
  );
  self.clients.claim();
});

// Current version first: an older cache kept for already-open pages must never
// answer a fresh opening.
function matchCurrent(request) {
  return caches.match(request, { cacheName: CACHE_NAME }).then((hit) => hit || caches.match(request));
}

function cacheFirst(request, cacheName) {
  return (cacheName === CACHE_NAME ? matchCurrent(request) : caches.match(request, { cacheName })).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      if (response && (response.ok || response.type === "opaque")) {
        const copy = response.clone();
        caches.open(cacheName).then((cache) => cache.put(request, copy));
      }
      return response;
    });
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!IS_BUILD || request.method !== "GET") return;
  const url = new URL(request.url);

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, FONT_CACHE).catch(() => Response.error()));
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/sw.js") return;

  // Page opening: the stored app shell, instantly, network or not.
  if (request.mode === "navigate") {
    event.respondWith(
      matchCurrent("/index.html").then((cached) => cached || fetch(request))
        .catch(() => matchCurrent("/"))
    );
    return;
  }

  event.respondWith(cacheFirst(request, CACHE_NAME).catch(() => matchCurrent(request)));
});
