// public/sw.js - minimal app-shell caching
const CACHE_NAME = "hofsmart-shell-v1";
const ASSETS = [
  "/", // index
  "/index.html",
  // add more static assets as needed (CSS / JS built file names) or use Workbox to generate
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // network-first for API calls
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(event.request) // fallback (unlikely)
      )
    );
    return;
  }
  // cache-first for app shell/static assets
  event.respondWith(
    caches.match(event.request).then((resp) => resp || fetch(event.request).then((r) => {
      // optionally cache dynamic assets:
      // const copy = r.clone(); caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
      return r;
    }).catch(() => caches.match("/")))
  );
});
