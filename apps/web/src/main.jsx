import React from "react";
import { createRoot } from "react-dom/client";
import App, { NativeUpdateNotice } from "./App.jsx";
import { attachSecureStore, memoryOnlySecureStore } from "./shared/browserStorage.js";
import { ensureNativeStartPath, isNativeApp } from "./shared/nativeApp.js";
import "./styles/index.css";

function renderApp() {
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
      {/* Outside App so it survives every route and never depends on which surface is showing. */}
      <NativeUpdateNotice />
    </React.StrictMode>
  );
}

// Inside the POS and Driver apps the bundle is already local, so there is no service worker. Tokens
// are loaded from the platform keystore before the first render so every synchronous read sees them.
async function bootNativeApp() {
  document.documentElement.classList.add("loohar-native", `loohar-native-${window.Capacitor?.getPlatform?.() || "unknown"}`);
  ensureNativeStartPath();
  try {
    const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
    await SecureStorage.setKeyPrefix("loohar_");
    await attachSecureStore({
      get: (key) => SecureStorage.getItem(key),
      set: (key, value) => SecureStorage.setItem(key, value),
      remove: (key) => SecureStorage.removeItem(key)
    });
  } catch {
    // The device keystore could not be opened. Fail closed: credentials stay in memory for this
    // launch and the user signs in again next time, rather than falling back to WebView storage.
    await attachSecureStore(memoryOnlySecureStore);
  }
}

if (isNativeApp()) {
  bootNativeApp().finally(renderApp);
} else {
  renderApp();
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      const usesOperationalPwa = window.location.pathname.startsWith("/driver") || window.location.pathname.startsWith("/restaurant");
      if (usesOperationalPwa) {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
        return;
      }
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .then(() => window.caches?.keys())
        .then((keys = []) => Promise.all(keys.filter((key) => key.startsWith("driver-pwa-shell") || key.startsWith("loohar-pwa-shell")).map((key) => window.caches.delete(key))))
        .catch(() => {});
    });
  }
}
