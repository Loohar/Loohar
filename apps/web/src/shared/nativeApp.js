// Loohar ships two native apps, POS and Driver, that bundle this same web build inside a Capacitor
// shell (apps/mobile/*). VITE_NATIVE_APP is set only for those builds. The apps reuse every screen,
// API call, permission check and server-computed amount of the web product; nothing about money or
// tenancy is decided on the device.
export const NATIVE_APP = String(import.meta.env.VITE_NATIVE_APP || "").trim();

const START_PATHS = Object.freeze({ pos: "/restaurant/pos", driver: "/driver" });

// True only inside the packaged app. A native build opened in an ordinary browser behaves like the web.
export function isNativeApp() {
  return Boolean(START_PATHS[NATIVE_APP]) && Boolean(globalThis.window?.Capacitor?.isNativePlatform?.());
}

export function nativeStartPath(app = NATIVE_APP) {
  return START_PATHS[app] || "/";
}

// The shell always opens index.html at "/"; send it to the app's own surface instead of the
// marketing homepage.
export function ensureNativeStartPath(location = globalThis.window?.location, history = globalThis.window?.history) {
  if (!location || !history) return;
  if (location.pathname === "/" || location.pathname === "/index.html") {
    history.replaceState(null, "", nativeStartPath());
  }
}
