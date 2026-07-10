import { prisma } from "../config/prisma.js";
import { tenantRootDomain } from "../config/urls.js";

const reservedLooharSubdomains = ["www", "admin", "app", "driver", "api", "sites"];
const reservedLooharHosts = new Set(["loohar.com", ...reservedLooharSubdomains.map((subdomain) => `${subdomain}.${tenantRootDomain()}`)]);
const verifiedDomainStatuses = new Set(["VERIFIED", "SSL_PENDING", "ACTIVE"]);
const activeSslStatuses = new Set(["SSL_PENDING", "ACTIVE"]);
const hostPattern = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.localhost$/;

export function normalizeHost(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const withoutProtocol = raw.replace(/^https?:\/\//, "");
  const hostOnly = withoutProtocol.split("/")[0].split("?")[0].split("#")[0].replace(/\.$/, "");
  if (hostOnly.startsWith("[") && hostOnly.includes("]")) return "";
  return hostOnly.replace(/:\d+$/, "");
}

export function normalizeDomainInput(value = "") {
  const host = normalizeHost(value);
  if (!host) return "";
  if (host.includes("_") || host.includes("*") || host.includes("@")) return "";
  return hostPattern.test(host) ? host : "";
}

export function isReservedPlatformHost(value = "") {
  return reservedLooharHosts.has(normalizeHost(value));
}

export function defaultTenantHost(slug) {
  return `${slug}.${tenantRootDomain()}`;
}

export function defaultTenantUrl(slug, suffix = "") {
  return `https://${defaultTenantHost(slug)}${suffix.startsWith("/") || !suffix ? suffix : `/${suffix}`}`;
}

function isCustomDomainActive(domain = {}) {
  return Boolean(domain.customDomain && verifiedDomainStatuses.has(domain.domainStatus));
}

export function canonicalHostForDomain(restaurant = {}, domain = {}) {
  const defaultHost = normalizeDomainInput(domain.primaryDomain) || defaultTenantHost(domain.defaultSubdomain || restaurant.slug);
  const customHost = normalizeDomainInput(domain.customDomain);
  const canonicalHost = normalizeDomainInput(domain.canonicalDomain);
  if (canonicalHost && canonicalHost === customHost && isCustomDomainActive(domain)) return canonicalHost;
  if (canonicalHost && canonicalHost === defaultHost) return canonicalHost;
  if (!canonicalHost && customHost && domain.domainStatus === "ACTIVE" && activeSslStatuses.has(domain.sslStatus)) return customHost;
  return defaultHost;
}

export function publicUrlForRestaurant(restaurant = {}, suffix = "") {
  const domain = restaurant.domains?.[0] || restaurant.domain || {};
  const host = canonicalHostForDomain(restaurant, domain);
  return `https://${host}${suffix.startsWith("/") || !suffix ? suffix : `/${suffix}`}`;
}

export function domainInfoForRestaurant(restaurant = {}, domain = {}) {
  const defaultHost = defaultTenantHost(domain.defaultSubdomain || restaurant.slug);
  const customHost = normalizeDomainInput(domain.customDomain);
  const canonicalHost = canonicalHostForDomain(restaurant, domain);
  return {
    ...domain,
    defaultSubdomain: domain.defaultSubdomain || restaurant.slug,
    defaultUrl: `https://${defaultHost}`,
    customUrl: customHost ? `https://${customHost}` : null,
    primaryDomain: domain.primaryDomain || defaultHost,
    canonicalDomain: canonicalHost,
    canonicalUrl: `https://${canonicalHost}`,
    dnsTarget: domain.dnsTarget || "cname.vercel-dns.com",
    dnsInstructions: {
      type: "CNAME",
      name: "www",
      value: domain.dnsTarget || "cname.vercel-dns.com"
    }
  };
}

export function domainUpdateDataForRestaurant(restaurant = {}, existing = {}, body = {}) {
  const defaultSubdomain = normalizeDomainInput(`${body.defaultSubdomain || existing.defaultSubdomain || restaurant.slug}.${tenantRootDomain()}`)
    .replace(`.${tenantRootDomain()}`, "");
  const defaultHost = defaultTenantHost(defaultSubdomain || restaurant.slug);
  const customDomain = normalizeDomainInput(body.customDomain || "");
  const requestedCanonical = body.canonicalDomain === "CUSTOM_DOMAIN" ? customDomain : normalizeDomainInput(body.canonicalDomain || "");
  const customIsUsable = customDomain && verifiedDomainStatuses.has(body.domainStatus || existing.domainStatus);
  const canonicalDomain = customIsUsable && requestedCanonical === customDomain ? customDomain : defaultHost;
  const domainStatus = customDomain ? body.domainStatus || "PENDING_VERIFICATION" : "NOT_CONFIGURED";
  const sslStatus = customDomain ? body.sslStatus || "PENDING" : "NOT_CONFIGURED";
  return {
    defaultSubdomain: defaultSubdomain || restaurant.slug,
    primaryDomain: canonicalDomain,
    customDomain: customDomain || null,
    canonicalDomain,
    domainStatus,
    dnsTarget: body.dnsTarget || existing.dnsTarget || "cname.vercel-dns.com",
    sslStatus,
    domainVerifiedAt: verifiedDomainStatuses.has(domainStatus) ? existing.domainVerifiedAt || new Date() : null
  };
}

function slugFromTenantHost(host) {
  const root = tenantRootDomain();
  if (host.endsWith(`.${root}`)) {
    const label = host.slice(0, -(root.length + 1)).split(".").pop();
    return label && !reservedLooharHosts.has(host) ? label : "";
  }
  if (process.env.NODE_ENV !== "production" && host.endsWith(".localhost")) {
    return host.replace(/\.localhost$/, "");
  }
  return "";
}

export async function resolveTenantByHost(rawHost = "") {
  const host = normalizeDomainInput(rawHost);
  if (!host) return { type: "invalid", host: normalizeHost(rawHost), restaurant: null, domain: null };
  if (isReservedPlatformHost(host) || host === "localhost") return { type: "platform", host, restaurant: null, domain: null };

  const slug = slugFromTenantHost(host);
  if (slug) {
    const restaurant = await prisma.restaurant.findFirst({
      where: {
        status: "ACTIVE",
        OR: [
          { slug },
          { domains: { some: { defaultSubdomain: slug } } }
        ]
      },
      include: { domains: true }
    });
    if (!restaurant) return { type: "not_found", host, restaurant: null, domain: null };
    return { type: "tenant_subdomain", host, restaurant, domain: restaurant.domains?.[0] || null };
  }

  const domain = await prisma.restaurantDomain.findFirst({
    where: {
      customDomain: host,
      domainStatus: { in: [...verifiedDomainStatuses] },
      restaurant: { status: "ACTIVE" }
    },
    include: { restaurant: { include: { domains: true } } }
  });
  if (!domain) return { type: "not_found", host, restaurant: null, domain: null };
  return { type: "custom_domain", host, restaurant: domain.restaurant, domain };
}
