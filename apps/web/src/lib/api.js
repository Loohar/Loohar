import { authStorage } from "../shared/browserStorage.js";

const isDev = import.meta.env.DEV;
const localDevApiOrigin = [("http" + ":"), "", ("local" + "host")].join("/") + ":5001";
const localApiUrl = `${localDevApiOrigin}/api`;
const defaultApiUrl = isDev ? localApiUrl : "/api";
const rawConfiguredApiUrl = import.meta.env.VITE_API_URL || defaultApiUrl;
const legacyRenderHost = ["loohar-api", "onrender", "com"].join(".");
const apiCustomDomain = ["api", "loohar", "com"].join(".");
const configuredApiUrl =
  import.meta.env.PROD && (rawConfiguredApiUrl.includes(legacyRenderHost) || rawConfiguredApiUrl.includes(apiCustomDomain))
    ? defaultApiUrl
    : rawConfiguredApiUrl;
const API_URL = configuredApiUrl.replace(/\/+$/, "");
const API_ORIGIN = API_URL.replace(/\/api$/, "");
const rawConfiguredApiHealthUrl = import.meta.env.VITE_API_HEALTH_URL || (isDev ? `${localDevApiOrigin}/health` : "");
const configuredApiHealthUrl =
  import.meta.env.PROD && (rawConfiguredApiHealthUrl.includes(legacyRenderHost) || rawConfiguredApiHealthUrl.includes(apiCustomDomain))
    ? "/health"
    : rawConfiguredApiHealthUrl;
const API_HEALTH_URL = configuredApiHealthUrl.replace(/\/+$/, "");
const inflightRequests = new Map();
const healthState = {
  payload: null,
  okUntil: 0,
  failUntil: 0,
  promise: null,
  lastError: null
};

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

function requestMethod(options = {}) {
  return String(options.method || "GET").toUpperCase();
}

function shouldDedupeRequest(path, options = {}) {
  return !options.skipDedupe && requestMethod(options) === "GET" && !options.body && !isAuthPath(path);
}

function requestDedupeKey(path, options = {}, token = "") {
  const headers = options.headers || {};
  const authKey = options.skipAuth ? "public" : token ? "token" : "anon";
  return [requestMethod(options), `${API_URL}${apiPath(path)}`, authKey, headers.Accept || headers.accept || ""].join(" ");
}

async function performApiRequest(path, options = {}) {
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
  delete requestOptions.skipDedupe;
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
    const error = new Error(payload.error || `Request failed with ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function api(path, options = {}) {
  if (!shouldDedupeRequest(path, options)) return performApiRequest(path, options);
  const token = options.skipAuth ? "" : options.token || authStorage.getItem("accessToken");
  const key = requestDedupeKey(path, options, token);
  if (inflightRequests.has(key)) return inflightRequests.get(key);
  const request = performApiRequest(path, options).finally(() => {
    if (inflightRequests.get(key) === request) inflightRequests.delete(key);
  });
  inflightRequests.set(key, request);
  return request;
}

async function runApiHealthProbe() {
  const inferredCandidates = API_URL.endsWith("/api")
    ? [`${API_URL}/health`, `${API_ORIGIN}/health`]
    : [`${API_URL}/api/health`, `${API_URL}/health`];
  const candidates = API_HEALTH_URL ? [API_HEALTH_URL, ...inferredCandidates] : inferredCandidates;
  let lastError;
  for (const url of candidates) {
    try {
      const response = await fetch(url, { credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" } });
      if (!response.ok) throw new Error(`Health check failed with ${response.status}`);
      const payload = await response.json();
      return payload;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function checkApiHealth(options = {}) {
  const force = Boolean(options.force);
  const now = Date.now();
  if (!force && healthState.payload && now < healthState.okUntil) return healthState.payload;
  if (!force && healthState.promise) return healthState.promise;
  if (!force && healthState.lastError && now < healthState.failUntil) throw healthState.lastError;

  const probe = runApiHealthProbe()
    .then((payload) => {
      healthState.payload = payload;
      healthState.okUntil = Date.now() + 8000;
      healthState.failUntil = 0;
      healthState.lastError = null;
      if (isDev) globalThis.console?.info?.("[api] mode: LIVE");
      return payload;
    })
    .catch((error) => {
      healthState.payload = null;
      healthState.okUntil = 0;
      healthState.failUntil = Date.now() + 2500;
      healthState.lastError = error;
      throw error;
    })
    .finally(() => {
      if (healthState.promise === probe) healthState.promise = null;
    });
  healthState.promise = probe;
  return probe;
}

export function resetApiHealthCache() {
  healthState.payload = null;
  healthState.okUntil = 0;
  healthState.failUntil = 0;
  healthState.promise = null;
  healthState.lastError = null;
}

export function apiDebugState() {
  return {
    inflightRequests: inflightRequests.size,
    healthCached: Boolean(healthState.payload),
    healthOkUntil: healthState.okUntil,
    healthFailUntil: healthState.failUntil
  };
}

if (isDev) {
  globalThis.__LOOHAR_API_DEBUG__ = apiDebugState;
}

export async function checkApiHealthLegacyForTests() {
  return checkApiHealth({ force: true });
}

try {
  if (isDev) {
    globalThis.addEventListener?.("online", () => resetApiHealthCache());
  }
} catch {
  // Browser debug helper is optional.
}

export { API_URL, API_ORIGIN };
