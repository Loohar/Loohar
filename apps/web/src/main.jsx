import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles/index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    if (window.location.pathname.startsWith("/driver")) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
      return;
    }
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .then(() => window.caches?.keys())
      .then((keys = []) => Promise.all(keys.filter((key) => key.startsWith("driver-pwa-shell")).map((key) => window.caches.delete(key))))
      .catch(() => {});
  });
}
