const productionUrls = {
  app: "https://loohar.com",
  api: "https://api.loohar.com",
  admin: "https://loohar.com/admin",
  platform: "https://loohar.com",
  publicSiteFallback: "https://loohar.com",
  driver: "https://driver.loohar.com"
};

function firstOrigin(value) {
  return String(value || "").split(",")[0].trim().replace(/\/+$/, "");
}

export function appUrl() {
  return firstOrigin(process.env.APP_URL || process.env.PUBLIC_APP_URL || process.env.WEB_ORIGIN || process.env.CORS_ORIGINS) || productionUrls.app;
}

export function apiUrl() {
  return firstOrigin(process.env.API_URL) || productionUrls.api;
}

export function adminUrl() {
  return firstOrigin(process.env.ADMIN_URL) || productionUrls.admin;
}

export function platformUrl() {
  return firstOrigin(process.env.PLATFORM_URL || process.env.PLATFORM_WEBSITE_URL) || productionUrls.platform;
}

export function publicSiteUrl() {
  return publicSiteFallbackUrl();
}

export function publicSiteFallbackUrl() {
  return firstOrigin(process.env.PUBLIC_SITE_FALLBACK_URL || process.env.PUBLIC_SITE_URL || process.env.PUBLIC_SITE_ORIGIN) || productionUrls.publicSiteFallback;
}

export function driverAppUrl() {
  return firstOrigin(process.env.DRIVER_APP_URL || process.env.PUBLIC_DRIVER_APP_URL) || productionUrls.driver;
}

export function tenantRootDomain() {
  return String(process.env.TENANT_ROOT_DOMAIN || "loohar.com").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export function productionOriginAllowlist() {
  return [...new Set([
    "https://loohar.com",
    "https://www.loohar.com",
    "https://admin.loohar.com",
    "https://app.loohar.com",
    "https://driver.loohar.com",
    productionUrls.app,
    productionUrls.driver,
    productionUrls.publicSiteFallback
  ])];
}
