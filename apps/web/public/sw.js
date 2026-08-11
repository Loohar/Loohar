const CACHE_NAME = "loohar-pwa-shell-v5";
const OFFLINE_URL = "/offline.html";
const APP_SHELL_URLS = [
  "/",
  "/driver",
  "/restaurant/login",
  OFFLINE_URL,
  "/manifest.json",
  "/icons/driver-icon-192.svg",
  "/icons/driver-icon-512.svg",
  "/favicon/android-chrome-192x192.png",
  "/favicon/android-chrome-512x512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS))
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
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }
  const isDriverRoute = url.origin === self.location.origin && url.pathname.startsWith("/driver");
  const isRestaurantRoute = url.origin === self.location.origin && url.pathname.startsWith("/restaurant");
  const isShellAsset = url.origin === self.location.origin && (url.pathname === OFFLINE_URL || url.pathname === "/manifest.json" || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/favicon/"));
  if (!isDriverRoute && !isRestaurantRoute && !isShellAsset) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (isShellAsset || isDriverRoute || isRestaurantRoute) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") return caches.match(isDriverRoute ? "/driver" : "/");
        return Response.error();
      })
  );
});
