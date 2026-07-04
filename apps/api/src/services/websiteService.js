import { prisma } from "../config/prisma.js";

export const DNS_TARGET = "sites.loohar.com";

export function defaultWebsiteSettings(restaurant) {
  return {
    websiteEnabled: true,
    heroTitle: restaurant.businessName || restaurant.name,
    heroSubtitle: restaurant.description || "Order directly from our kitchen for pickup and delivery.",
    heroImageUrl: restaurant.brandingJson?.bannerImageUrl || null,
    logoUrl: restaurant.logoUrl,
    brandColor: restaurant.brandingJson?.primaryColor || "#1f9d80",
    accentColor: restaurant.brandingJson?.accentColor || "#f4b740",
    aboutTitle: `About ${restaurant.businessName || restaurant.name}`,
    aboutStory: restaurant.description || "A neighborhood restaurant serving guests directly through our own online ordering platform.",
    missionStatement: "Serve great food, keep customer relationships local, and make ordering easy.",
    ownerStory: "Owner and chef story placeholder.",
    specialOfferText: "Order direct for loyalty points and restaurant-owned delivery.",
    seoTitle: `${restaurant.businessName || restaurant.name} | Direct Online Ordering`,
    seoDescription: restaurant.description || `Order pickup or delivery directly from ${restaurant.businessName || restaurant.name}.`
  };
}

export function defaultDomainFor(restaurant) {
  return {
    defaultSubdomain: restaurant.slug,
    customDomain: null,
    domainStatus: "NOT_CONFIGURED",
    dnsTarget: DNS_TARGET,
    sslStatus: "NOT_CONFIGURED"
  };
}

export async function ensureWebsiteSettings(restaurant) {
  return prisma.restaurantWebsiteSettings.upsert({
    where: { restaurantId: restaurant.id },
    update: {},
    create: { restaurantId: restaurant.id, ...defaultWebsiteSettings(restaurant) }
  });
}

export async function ensureDomain(restaurant) {
  return prisma.restaurantDomain.upsert({
    where: { restaurantId_defaultSubdomain: { restaurantId: restaurant.id, defaultSubdomain: restaurant.slug } },
    update: { dnsTarget: DNS_TARGET },
    create: { restaurantId: restaurant.id, ...defaultDomainFor(restaurant) }
  });
}

export async function getWebsiteBundleBySlug(slug) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    include: {
      categories: {
        where: { active: true },
        include: { items: { where: { available: true }, include: { options: true, optionGroups: { include: { options: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } } }, orderBy: { name: "asc" } } },
        orderBy: { sortOrder: "asc" }
      },
      coupons: { where: { active: true }, orderBy: { createdAt: "desc" }, take: 5 },
      loyaltyRewards: { where: { active: true }, orderBy: { pointsRequired: "asc" } },
      websiteSettings: true,
      domains: true,
      galleryImages: { orderBy: { sortOrder: "asc" } },
      socialLinks: true
    }
  });
  if (!restaurant || restaurant.status !== "ACTIVE") return null;
  const website = restaurant.websiteSettings || await ensureWebsiteSettings(restaurant);
  const domain = restaurant.domains[0] || await ensureDomain(restaurant);
  return { restaurant: { ...restaurant, websiteSettings: website, domains: [domain] }, website, domain, gallery: restaurant.galleryImages, socialLinks: restaurant.socialLinks };
}
