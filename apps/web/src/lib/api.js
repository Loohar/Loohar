import { clearSession, getAccessToken, getRefreshToken, getSessionRevision, storeSession } from "../shared/auth.js";
import { API_HEALTH_TIMEOUT_MS, DEFAULT_API_TIMEOUT_MS, fetchWithTimeout, retryTransientRequest } from "./networkRequest.js";

const isDev = import.meta.env.DEV;
const localDevApiOrigin = [("http" + ":"), "", ("local" + "host")].join("/") + ":5001";
const localApiUrl = `${localDevApiOrigin}/api`;
const defaultApiUrl = "/api";
const runtimeDefaultApiUrl = isDev ? localApiUrl : defaultApiUrl;
const rawConfiguredApiUrl = import.meta.env.VITE_API_URL || runtimeDefaultApiUrl;
const configuredApiUrl = rawConfiguredApiUrl;
const API_URL = configuredApiUrl.replace(/\/+$/, "");
const API_ORIGIN = API_URL.replace(/\/api$/, "");
const rawConfiguredApiHealthUrl = import.meta.env.VITE_API_HEALTH_URL || (isDev ? `${localDevApiOrigin}/health` : "/health");
const configuredApiHealthUrl = rawConfiguredApiHealthUrl;
const API_HEALTH_URL = configuredApiHealthUrl.replace(/\/+$/, "");
const inflightRequests = new Map();
let refreshPromise = null;
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

function isRefreshRequest(path) {
  return path === "/api/auth/refresh" || path === "/api/auth/refresh-token";
}

function resolveRequestToken(options = {}) {
  if (options.skipAuth) return "";
  return options.token || getAccessToken() || "";
}

function clearStoredSessionForToken(requestToken, reason = "unauthorized") {
  const currentToken = getAccessToken();
  if (!requestToken || requestToken !== currentToken) return;
  clearSession(reason);
}

async function parseApiError(response) {
  return response.json().catch(() => ({}));
}

function createApiError(response, payload = {}) {
  const error = new Error(payload.error || `Request failed with ${response.status}`);
  error.status = response.status;
  error.payload = payload;
  error.code = payload.code || null;
  return error;
}

async function refreshStoredSession() {
  if (refreshPromise) return refreshPromise;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  refreshPromise = fetchWithTimeout(`${API_URL}${apiPath("/api/auth/refresh")}`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify({ refreshToken }),
    headers: { "Content-Type": "application/json" }
  }, DEFAULT_API_TIMEOUT_MS)
    .then(async (response) => {
      const payload = await parseApiError(response);
      if (!response.ok) throw createApiError(response, payload);
      if (!payload.accessToken) {
        const error = new Error("Refresh did not return a usable session.");
        error.status = 401;
        error.code = "AUTH_REFRESH_TOKEN_INVALID";
        throw error;
      }
      storeSession(payload);
      return payload;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

function requestMethod(options = {}) {
  return String(options.method || "GET").toUpperCase();
}

function shouldDedupeRequest(path, options = {}) {
  return !options.skipDedupe && requestMethod(options) === "GET" && !options.body && !isAuthPath(path);
}

function requestDedupeKey(path, options = {}, token = "") {
  const headers = options.headers || {};
  const authKey = options.skipAuth ? "public" : token ? `session:${getSessionRevision()}` : "anon";
  return [requestMethod(options), `${API_URL}${apiPath(path)}`, authKey, headers.Accept || headers.accept || ""].join(" ");
}

async function performApiRequest(path, options = {}) {
  const body = options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body;
  const token = resolveRequestToken(options);
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
  delete requestOptions.token;
  delete requestOptions.timeoutMs;
  const timeoutMs = options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  const response = await fetchWithTimeout(url, requestOptions, timeoutMs);

  if (!response.ok) {
    if (response.status === 401 && options.authRetry !== false && !options.skipAuth && !isRefreshRequest(path)) {
      const refreshed = await refreshStoredSession().catch(() => null);
      if (refreshed?.accessToken) {
        const retryResponse = await fetchWithTimeout(url, {
          ...requestOptions,
          headers: {
            ...requestOptions.headers,
            ...authHeaders(refreshed.accessToken)
          }
        }, timeoutMs);
        if (retryResponse.ok) {
          if (retryResponse.status === 204) return null;
          return retryResponse.json();
        }
        const retryPayload = await parseApiError(retryResponse);
        if (retryResponse.status === 401 && options.clearOnUnauthorized !== false) {
          clearStoredSessionForToken(refreshed.accessToken, retryPayload.code || "retry_unauthorized");
        }
        throw createApiError(retryResponse, retryPayload);
      }
    }
    const payload = await parseApiError(response);
    if (response.status === 401 && options.clearOnUnauthorized !== false) clearStoredSessionForToken(token, payload.code || "unauthorized");
    throw createApiError(response, payload);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function api(path, options = {}) {
  if (!shouldDedupeRequest(path, options)) return performApiRequest(path, options);
  const token = resolveRequestToken(options);
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
  const candidates = [...new Set(API_HEALTH_URL ? [API_HEALTH_URL] : inferredCandidates)];
  const deadline = Date.now() + API_HEALTH_TIMEOUT_MS;
  let lastError;
  for (const url of candidates) {
    try {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw lastError || new Error("API health check timed out.");
      const response = await fetchWithTimeout(url, { credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" } }, remainingMs);
      if (!response.ok) {
        const error = new Error(`Health check failed with ${response.status}`);
        error.status = response.status;
        throw error;
      }
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

function isTransientHealthFailure(error) {
  const status = Number(error?.status || 0);
  return !status || status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function checkApiHealthWithRetry(options = {}) {
  const force = Boolean(options.force);
  return retryTransientRequest(
    (attempt) => checkApiHealth({ force: force || attempt > 1 }),
    {
      attempts: options.attempts ?? 2,
      delaysMs: options.delaysMs || [250],
      signal: options.signal,
      shouldRetry: isTransientHealthFailure,
      onRetry: options.onRetry
    }
  );
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
