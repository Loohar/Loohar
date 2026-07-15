import { prisma } from "../config/prisma.js";
import { defaultTenantHost, domainInfoForRestaurant } from "./domainService.js";

export const DNS_TARGET = process.env.TENANT_CNAME_TARGET || "cname.vercel-dns.com";
const DEFAULT_HERO_IMAGE = "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1600&q=80";
const DEFAULT_LOGO_IMAGE = "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80";
const DEFAULT_GALLERY_IMAGES = [
  { imageUrl: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1200&q=80", altText: "Restaurant dining room", category: "interior" },
  { imageUrl: "https://images.unsplash.com/photo-1551218808-94e220e084d2?auto=format&fit=crop&w=1200&q=80", altText: "Chef plating food", category: "team" },
  { imageUrl: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=80", altText: "Prepared restaurant dish", category: "food" },
  { imageUrl: "https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=1200&q=80", altText: "Restaurant bar", category: "interior" }
];
const DEFAULT_MENU_IMAGES = [
  "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=900&q=80"
];

function hasImageUrl(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveImage(liveImage, fallbackImage, defaultImage = DEFAULT_HERO_IMAGE) {
  if (hasImageUrl(liveImage)) return liveImage.trim();
  if (hasImageUrl(fallbackImage)) return fallbackImage.trim();
  return defaultImage;
}

export function defaultWebsiteSettings(restaurant) {
  return {
    websiteEnabled: true,
    heroTitle: restaurant.businessName || restaurant.name,
    heroSubtitle: restaurant.description || "Order directly from our kitchen for pickup and delivery.",
    heroImageUrl: resolveImage(restaurant.brandingJson?.bannerImageUrl, restaurant.logoUrl, DEFAULT_HERO_IMAGE),
    mobileHeroImageUrl: null,
    logoUrl: resolveImage(restaurant.logoUrl, restaurant.brandingJson?.bannerImageUrl, DEFAULT_LOGO_IMAGE),
    faviconUrl: null,
    brandColor: restaurant.brandingJson?.primaryColor || "#1f9d80",
    accentColor: restaurant.brandingJson?.accentColor || "#f4b740",
    buttonColor: null,
    aboutTitle: `About ${restaurant.businessName || restaurant.name}`,
    aboutStory: restaurant.description || "A neighborhood restaurant serving guests directly through our own online ordering platform.",
    missionStatement: "Serve great food, keep customer relationships local, and make ordering easy.",
    ownerStory: "Built by a local restaurant team focused on hospitality, direct customer relationships, and reliable pickup and delivery.",
    specialOfferText: "Order direct for loyalty points and restaurant-owned delivery.",
    ctaText: "Start an order",
    contactMessage: "Call or email the restaurant for order help, catering, and community events.",
    cateringMessage: "Ask the restaurant team about party trays, group meals, and corporate lunches.",
    publicEmail: restaurant.email || null,
    seoTitle: `${restaurant.businessName || restaurant.name} | Direct Online Ordering`,
    seoDescription: restaurant.description || `Order pickup or delivery directly from ${restaurant.businessName || restaurant.name}.`,
    seoKeywords: null,
    canonicalUrl: null,
    ogImageUrl: null,
    indexingEnabled: true
  };
}

export function defaultDomainFor(restaurant) {
  const defaultHost = defaultTenantHost(restaurant.slug);
  return {
    defaultSubdomain: restaurant.slug,
    primaryDomain: defaultHost,
    customDomain: null,
    canonicalDomain: defaultHost,
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

function completeWebsiteSettings(restaurant, websiteSettings) {
  const defaults = defaultWebsiteSettings(restaurant);
  const website = { ...defaults, ...(websiteSettings || {}) };
  website.heroImageUrl = resolveImage(websiteSettings?.heroImageUrl, restaurant.brandingJson?.bannerImageUrl || restaurant.logoUrl, defaults.heroImageUrl);
  website.mobileHeroImageUrl = hasImageUrl(websiteSettings?.mobileHeroImageUrl) ? websiteSettings.mobileHeroImageUrl.trim() : null;
  website.logoUrl = resolveImage(websiteSettings?.logoUrl || restaurant.logoUrl, defaults.logoUrl, website.heroImageUrl);
  website.faviconUrl = hasImageUrl(websiteSettings?.faviconUrl) ? websiteSettings.faviconUrl.trim() : null;
  website.ogImageUrl = resolveImage(websiteSettings?.ogImageUrl, website.heroImageUrl, defaults.heroImageUrl);
  return website;
}

function completeGallery(restaurant, galleryImages, website) {
  const ownedGalleryImages = (galleryImages || []).filter((image) => image.restaurantId === restaurant.id && image.published !== false);
  return ownedGalleryImages.map((image, index) => {
    const fallback = DEFAULT_GALLERY_IMAGES[index % DEFAULT_GALLERY_IMAGES.length];
    return {
      ...image,
      imageUrl: resolveImage(image.imageUrl, "", fallback.imageUrl),
      altText: image.altText || `${restaurant.businessName || restaurant.name} photo`,
      category: image.category || fallback.category || "food"
    };
  });
}

function completeCategories(categories, website, restaurantId) {
  return (categories || []).filter((category) => category.restaurantId === restaurantId).map((category, categoryIndex) => ({
    ...category,
    items: (category.items || []).filter((item) => item.restaurantId === restaurantId).map((item, itemIndex) => ({
      ...item,
      imageUrl: hasImageUrl(item.imageUrl) ? item.imageUrl.trim() : null
    }))
  }));
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
      galleryImages: { where: { published: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      socialLinks: { where: { enabled: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }
    }
  });
  if (!restaurant || restaurant.status !== "ACTIVE") return null;
  const websiteRecord = restaurant.websiteSettings || await ensureWebsiteSettings(restaurant);
  const website = completeWebsiteSettings(restaurant, websiteRecord);
  const domain = domainInfoForRestaurant(restaurant, restaurant.domains[0] || await ensureDomain(restaurant));
  const categories = completeCategories(restaurant.categories, website, restaurant.id);
  const completedRestaurant = {
    ...restaurant,
    logoUrl: website.logoUrl,
    categories,
    websiteSettings: website,
    domains: [domain]
  };
  const gallery = completeGallery(restaurant, restaurant.galleryImages, website);
  const featuredItems = categories.flatMap((category) => category.items || []).filter((item) => item.featured || item.recommended).slice(0, 8);
  return { restaurant: completedRestaurant, website, domain, domainInfo: domain, gallery, socialLinks: restaurant.socialLinks.filter((link) => link.enabled !== false), featuredItems };
}
