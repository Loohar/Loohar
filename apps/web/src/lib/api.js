const configuredApiUrl = import.meta.env.VITE_API_URL || "https://api.loohar.com";
const API_URL = configuredApiUrl.replace(/\/+$/, "");
const API_ORIGIN = API_URL.replace(/\/api$/, "");
const configuredApiHealthUrl = import.meta.env.VITE_API_HEALTH_URL || "";
const API_HEALTH_URL = configuredApiHealthUrl.replace(/\/+$/, "");
const isDev = import.meta.env.DEV;

function apiPath(path) {
  if (API_URL.endsWith("/api") && path.startsWith("/api/")) return path.slice(4);
  return path;
}

export function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function api(path, options = {}) {
  const body = options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body;
  const token = options.token || localStorage.getItem("accessToken") || "";
  const response = await fetch(`${API_URL}${apiPath(path)}`, {
    ...options,
    body,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
      ...options.headers
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      localStorage.removeItem("user");
    }
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
      const response = await fetch(url, { headers: { "Content-Type": "application/json" } });
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
