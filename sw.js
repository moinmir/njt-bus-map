const APP_SHELL_CACHE = "njt-app-shell-v1";
const ROUTE_DATA_CACHE = "njt-route-data-v1";

const APP_SHELL_PATHS = new Set([
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
  "/data/manifest.json",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(Array.from(APP_SHELL_PATHS)))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== APP_SHELL_CACHE && key !== ROUTE_DATA_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigate(request));
    return;
  }

  if (url.pathname.startsWith("/data/routes/")) {
    event.respondWith(networkFirst(request, ROUTE_DATA_CACHE));
    return;
  }

  if (APP_SHELL_PATHS.has(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, APP_SHELL_CACHE));
  }
});

async function handleNavigate(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match("/index.html");
    return cached || Response.error();
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw new Error("Network error and no cache entry");
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }

  const network = await networkFetch;
  return network || Response.error();
}
