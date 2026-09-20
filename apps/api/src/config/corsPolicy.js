import { RESERVED_PLATFORM_SLUGS } from "../../../shared/reservedSlugs.js";
import { productionOriginAllowlist, tenantRootDomain } from "./urls.js";

// The Loohar POS and Driver apps are Capacitor shells that serve the bundled web app from a local
// origin: `capacitor://localhost` on iOS and `https://localhost` on Android. These two exact origins
// are allowed only when ALLOW_NATIVE_APP_ORIGINS=true, with no port and no other scheme.
//
// That grants a browser page nothing: no browser can present a `capacitor://` origin, an
// `https://localhost` page exists only on a machine running its own local server, and the API reads
// credentials solely from the Authorization bearer header and sets no cookies, so there is no ambient
// credential for a cross-origin page to borrow.
export const NATIVE_APP_ORIGINS = Object.freeze(["capacitor://localhost", "https://localhost"]);

export function splitOriginConfig(value = "") {
  return String(value).split(",").map((origin) => origin.trim()).filter(Boolean);
}

export function normalizeCorsOrigin(origin = "") {
  const trimmed = String(origin || "").trim().replace(/\/+$/, "");
  if (!trimmed || trimmed === "*") return trimmed;
  const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const withProtocol = hasProtocol
    ? trimmed
    : /^(localhost|127\.0\.0\.1|\[?::1\]?)(:\d+)?$/i.test(trimmed)
      ? `http://${trimmed}`
      : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.origin;
  } catch {
    return "";
  }
}

// EXTRA_CORS_ORIGINS is an additive source. CORS_ORIGINS is a single value that cannot be appended
// to without reading it first, and rewriting it wholesale risks dropping an origin that is already
// serving someone. Origins listed here go through exactly the same normalisation, exact-match and
// production wildcard checks as every other source; it widens nothing on its own.
function configuredCorsOriginSources(env) {
  return [
    env.CORS_ORIGINS,
    env.EXTRA_CORS_ORIGINS,
    env.CORS_ORIGIN,
    env.WEB_ORIGIN,
    env.APP_URL,
    env.PUBLIC_APP_URL,
    env.PLATFORM_URL,
    env.PLATFORM_WEBSITE_URL,
    env.ADMIN_URL,
    env.DRIVER_APP_URL,
    env.PUBLIC_DRIVER_APP_URL,
    env.PUBLIC_SITE_FALLBACK_URL,
    env.PUBLIC_SITE_URL,
    env.PUBLIC_SITE_ORIGIN
  ];
}

const localDevHosts = new Set(["localhost", ["127", "0", "0", "1"].join("."), "::1"]);

function isLocalDevOrigin(origin = "") {
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) && localDevHosts.has(url.hostname);
  } catch {
    return false;
  }
}

export function createCorsPolicy(env = process.env) {
  const isProduction = env.NODE_ENV === "production";
  const allowLocalCors = !isProduction || env.ALLOW_LOCAL_CORS === "true";
  const allowNativeAppOrigins = env.ALLOW_NATIVE_APP_ORIGINS === "true";
  const allowTenantSubdomainCors = env.ALLOW_TENANT_SUBDOMAIN_CORS === "true";

  const rawCorsOrigins = configuredCorsOriginSources(env).flatMap(splitOriginConfig);
  const configuredCorsOrigins = [...new Set([
    ...(rawCorsOrigins.length ? rawCorsOrigins : productionOriginAllowlist()),
    ...productionOriginAllowlist()
  ].map(normalizeCorsOrigin).filter((origin) => origin && (!isProduction || allowLocalCors || !isLocalDevOrigin(origin))))];

  if (isProduction && configuredCorsOrigins.length === 0) {
    throw new Error("CORS origins are required in production. Set CORS_ORIGINS, WEB_ORIGIN, or APP_URL to explicit Loohar domains before starting the API.");
  }
  if (isProduction && configuredCorsOrigins.includes("*")) {
    throw new Error("Wildcard CORS is not allowed in production. Set CORS_ORIGINS to explicit Loohar domains.");
  }

  const reservedCorsSubdomains = new Set(RESERVED_PLATFORM_SLUGS.filter((slug) => !slug.includes(".")));
  function isTenantSubdomainOrigin(origin = "") {
    if (!allowTenantSubdomainCors) return false;
    try {
      const url = new URL(origin);
      const rootDomain = tenantRootDomain();
      if (url.protocol !== "https:" || !url.hostname.endsWith(`.${rootDomain}`)) return false;
      const subdomain = url.hostname.slice(0, -(rootDomain.length + 1));
      return Boolean(subdomain) && !subdomain.includes(".") && !reservedCorsSubdomains.has(subdomain);
    } catch {
      return false;
    }
  }

  // Exact string match on the raw header: normalizeCorsOrigin discards non-http(s) schemes, and a
  // port or path must never widen the native allowance.
  function isNativeAppOrigin(origin = "") {
    return allowNativeAppOrigins && NATIVE_APP_ORIGINS.includes(String(origin));
  }

  function isCorsOriginAllowed(origin = "") {
    const normalizedOrigin = normalizeCorsOrigin(origin);
    return !origin ||
      configuredCorsOrigins.includes(normalizedOrigin) ||
      isTenantSubdomainOrigin(normalizedOrigin) ||
      isNativeAppOrigin(origin) ||
      (!isProduction && configuredCorsOrigins.includes("*")) ||
      (allowLocalCors && isLocalDevOrigin(normalizedOrigin));
  }

  return { configuredCorsOrigins, isCorsOriginAllowed, allowLocalCors, allowNativeAppOrigins, allowTenantSubdomainCors };
}
