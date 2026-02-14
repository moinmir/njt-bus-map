const APP_SHELL_CACHE = "njt-app-shell-v5";
const ROUTE_DATA_CACHE = "njt-route-data-v3";
const SCHEDULE_DATA_CACHE = "njt-schedule-data-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) =>
        cache.addAll([
          "/",
          "/index.html",
          "/data/manifest.json",
        ]),
      )
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
            .filter(
              (key) =>
                key !== APP_SHELL_CACHE &&
                key !== ROUTE_DATA_CACHE &&
                key !== SCHEDULE_DATA_CACHE,
            )
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

  if (url.pathname.startsWith("/data/schedules/")) {
    event.respondWith(networkFirst(request, SCHEDULE_DATA_CACHE));
    return;
  }

  // Cache Vite-built assets (they have content hashes)
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request, APP_SHELL_CACHE));
    return;
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

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}
