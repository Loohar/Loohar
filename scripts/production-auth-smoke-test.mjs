const apiOrigin = (process.env.PRODUCTION_API_ORIGIN || process.env.VITE_API_URL || "https://loohar-api.onrender.com/api").replace(/\/+$/, "").replace(/\/api$/, "");
const email = process.env.PRODUCTION_SMOKE_EMAIL;
const password = process.env.PRODUCTION_SMOKE_PASSWORD;

async function requestJson(label, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${label} failed with ${response.status}: ${body.error || "unknown error"}`);
  }
  return body;
}

if (!email || !password) {
  console.log("SKIP production auth smoke: set PRODUCTION_SMOKE_EMAIL and PRODUCTION_SMOKE_PASSWORD.");
  process.exit(0);
}

const login = await requestJson("login", `${apiOrigin}/api/auth/login`, {
  method: "POST",
  body: JSON.stringify({ email, password })
});

if (!login.accessToken || !login.user?.id || !login.user?.role) {
  throw new Error("Login response did not include required auth fields.");
}

const current = await requestJson("auth/me", `${apiOrigin}/api/auth/me`, {
  headers: { Authorization: `Bearer ${login.accessToken}` }
});

if (!current.user?.id || current.user.id !== login.user.id) {
  throw new Error("auth/me did not return the logged-in user.");
}

console.log(JSON.stringify({
  ok: true,
  apiOrigin,
  role: current.user.role,
  userIdPresent: Boolean(current.user.id),
  membershipCount: Array.isArray(current.memberships) ? current.memberships.length : 0
}, null, 2));
