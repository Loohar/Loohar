const configuredApiUrl = import.meta.env.VITE_API_URL || "http://localhost:5001/api";
const API_URL = configuredApiUrl.replace(/\/+$/, "");

function apiPath(path) {
  if (API_URL.endsWith("/api") && path.startsWith("/api/")) return path.slice(4);
  return path;
}

export function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function api(path, options = {}) {
  const body = options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body;
  const response = await fetch(`${API_URL}${apiPath(path)}`, {
    ...options,
    body,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(options.token),
      ...options.headers
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function checkApiHealth() {
  const candidates = API_URL.endsWith("/api") ? ["/health", "/../health"] : ["/api/health", "/health"];
  let lastError;
  for (const candidate of candidates) {
    try {
      const response = await fetch(`${API_URL}${candidate}`, { headers: { "Content-Type": "application/json" } });
      if (!response.ok) throw new Error(`Health check failed with ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
    }
  }
  globalThis.console?.warn?.(`API health check failed for ${API_URL}. Verify VITE_API_URL and backend /health.`, lastError);
  throw lastError;
}

export { API_URL };
