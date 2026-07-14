import { authStorage } from "../shared/browserStorage.js";

const defaultApiUrl = "/api";
const rawConfiguredApiUrl = import.meta.env.VITE_API_URL || defaultApiUrl;
const legacyRenderHost = ["loohar-api", "onrender", "com"].join(".");
const apiCustomDomain = ["api", "loohar", "com"].join(".");
const configuredApiUrl =
  import.meta.env.PROD && (rawConfiguredApiUrl.includes(legacyRenderHost) || rawConfiguredApiUrl.includes(apiCustomDomain))
    ? defaultApiUrl
    : rawConfiguredApiUrl;
const API_URL = configuredApiUrl.replace(/\/+$/, "");
const API_ORIGIN = API_URL.replace(/\/api$/, "");
const rawConfiguredApiHealthUrl = import.meta.env.VITE_API_HEALTH_URL || "";
const configuredApiHealthUrl =
  import.meta.env.PROD && (rawConfiguredApiHealthUrl.includes(legacyRenderHost) || rawConfiguredApiHealthUrl.includes(apiCustomDomain))
    ? "/health"
    : rawConfiguredApiHealthUrl;
const API_HEALTH_URL = configuredApiHealthUrl.replace(/\/+$/, "");
const isDev = import.meta.env.DEV;

function apiPath(path) {
  if (API_URL.endsWith("/api") && path.startsWith("/api/")) return path.slice(4);
  return path;
}

export function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isAuthPath(path) {
  return path.startsWith("/api/auth/") || path === "/api/auth";
}

function clearStoredSession() {
  authStorage.removeItem("accessToken");
  authStorage.removeItem("refreshToken");
  authStorage.removeItem("user");
  if (globalThis.window?.dispatchEvent && typeof globalThis.window.CustomEvent === "function") {
    globalThis.window.dispatchEvent(new globalThis.window.CustomEvent("loohar:auth-expired"));
  }
}

function clearStoredSessionForToken(requestToken) {
  const currentToken = authStorage.getItem("accessToken");
  if (!requestToken || requestToken !== currentToken) return;
  clearStoredSession();
}

async function parseApiError(response) {
  return response.json().catch(() => ({}));
}

async function refreshStoredSession() {
  const refreshToken = authStorage.getItem("refreshToken");
  if (!refreshToken) return null;
  const response = await fetch(`${API_URL}${apiPath("/api/auth/refresh")}`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify({ refreshToken }),
    headers: { "Content-Type": "application/json" }
  });
  if (!response.ok) return null;
  const payload = await response.json();
  if (payload.accessToken) authStorage.setItem("accessToken", payload.accessToken);
  if (payload.refreshToken) authStorage.setItem("refreshToken", payload.refreshToken);
  if (payload.user) authStorage.setItem("user", JSON.stringify(payload.user));
  return payload;
}

export async function api(path, options = {}) {
  const body = options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body;
  const token = options.skipAuth ? "" : options.token || authStorage.getItem("accessToken");
  const url = `${API_URL}${apiPath(path)}`;
  const requestOptions = {
    ...options,
    body,
    credentials: options.credentials || "include",
    cache: options.cache || (isAuthPath(path) ? "no-store" : "default"),
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
      ...options.headers
    }
  };
  delete requestOptions.clearOnUnauthorized;
  delete requestOptions.authRetry;
  delete requestOptions.skipAuth;
  const response = await fetch(url, requestOptions);

  if (!response.ok) {
    if (response.status === 401 && options.authRetry !== false && !path.includes("/auth/refresh")) {
      const refreshed = await refreshStoredSession().catch(() => null);
      if (refreshed?.accessToken) {
        const retryResponse = await fetch(url, {
          ...requestOptions,
          headers: {
            ...requestOptions.headers,
            ...authHeaders(refreshed.accessToken)
          }
        });
        if (retryResponse.ok) {
          if (retryResponse.status === 204) return null;
          return retryResponse.json();
        }
      }
    }
    const payload = await parseApiError(response);
    if (response.status === 401 && options.clearOnUnauthorized !== false) clearStoredSessionForToken(token);
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function checkApiHealth() {
  const inferredCandidates = API_URL.endsWith("/api")
    ? [`${API_URL}/health`, `${API_ORIGIN}/health`]
    : [`${API_URL}/api/health`, `${API_URL}/health`];
  const candidates = API_HEALTH_URL ? [API_HEALTH_URL, ...inferredCandidates] : inferredCandidates;
  let lastError;
  for (const url of candidates) {
    try {
      if (isDev) globalThis.console?.info?.("[api] health check");
      const response = await fetch(url, { credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" } });
      if (!response.ok) throw new Error(`Health check failed with ${response.status}`);
      const payload = await response.json();
      if (isDev) {
        globalThis.console?.info?.("[api] health result:", payload);
        globalThis.console?.info?.("[api] mode: LIVE");
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (isDev) globalThis.console?.warn?.("[api] health failed", error);
    }
  }
  if (isDev) {
    globalThis.console?.warn?.("[api] mode: DEMO");
    globalThis.console?.warn?.("API health check failed. Verify VITE_API_URL and backend /health.", lastError);
  }
  throw lastError;
}

export { API_URL, API_ORIGIN };
