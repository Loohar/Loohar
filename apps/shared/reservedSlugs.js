export const RESERVED_PLATFORM_SLUGS = [
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "catering",
  "contact",
  "customer",
  "discover",
  "driver",
  "favicon.ico",
  "forgot-password",
  "gallery",
  "health",
  "kitchen",
  "loyalty",
  "login",
  "logout",
  "manifest.json",
  "menu",
  "order",
  "orders",
  "payments",
  "pricing",
  "privacy",
  "public",
  "register",
  "restaurant",
  "restaurants",
  "reset-password",
  "robots.txt",
  "sitemap.xml",
  "sites",
  "static",
  "support",
  "terms",
  "uploads",
  "www"
];

const RESERVED_SET = new Set(RESERVED_PLATFORM_SLUGS);
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizePublicSlug(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function isReservedPlatformSlug(value = "") {
  return RESERVED_SET.has(normalizePublicSlug(value));
}

export function isValidPublicSlugFormat(value = "") {
  const slug = normalizePublicSlug(value);
  return SLUG_PATTERN.test(slug) && !slug.includes("--");
}

export function validatePublicSlug(value = "") {
  const slug = normalizePublicSlug(value);
  if (!slug) return { ok: false, slug, error: "Slug is required." };
  if (!isValidPublicSlugFormat(slug)) {
    return {
      ok: false,
      slug,
      error: "Slug must be lowercase letters, numbers, and single hyphens only."
    };
  }
  if (isReservedPlatformSlug(slug)) {
    return {
      ok: false,
      slug,
      error: `"${slug}" is reserved for Loohar platform routes. Choose another restaurant slug.`
    };
  }
  return { ok: true, slug, error: "" };
}
