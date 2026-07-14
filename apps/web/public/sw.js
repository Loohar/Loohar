const CACHE_NAME = "driver-pwa-shell-v2";
const OFFLINE_URL = "/offline.html";
const DRIVER_SHELL_URLS = ["/driver", OFFLINE_URL, "/manifest.json", "/icons/driver-icon-192.svg", "/icons/driver-icon-512.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(DRIVER_SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isDriverRoute = url.origin === self.location.origin && url.pathname.startsWith("/driver");
  const isDriverAsset = url.origin === self.location.origin && (url.pathname === OFFLINE_URL || url.pathname === "/manifest.json" || url.pathname.startsWith("/icons/"));
  if (!isDriverRoute && !isDriverAsset) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (isDriverAsset || isDriverRoute) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate" && isDriverRoute) return caches.match(OFFLINE_URL);
        return Response.error();
      })
  );
});
