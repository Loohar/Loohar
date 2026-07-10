import { Router } from "express";
import crypto from "crypto";
import { attachRestaurantIdBySlug, createOrder, createOrderSchema, getOrderStatus } from "./customer.js";
import { validate } from "../middleware/validate.js";
import { getWebsiteBundleBySlug } from "../services/websiteService.js";
import { prisma } from "../config/prisma.js";
import { domainInfoForRestaurant, publicUrlForRestaurant, resolvePublicTenant } from "../services/domainService.js";

const router = Router();
const DISCOVERY_BUSINESS_TYPES = ["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK", "CONVENIENCE_STORE", "GAS_STATION_FOOD_SHOP", "LIQUOR_STORE", "OTHER_FOOD_RETAIL"];

function restaurantName(restaurant = {}) {
  return restaurant.businessName || restaurant.name || "Restaurant";
}

function requestIdFor(req) {
  return req.get("x-request-id") || crypto.randomUUID();
}

function logTenantResolve({ req, requestId, requestedSlug = "", requestedHost = "", resolved, bundle, cacheKey = "", status = "resolved" }) {
  console.info(JSON.stringify({
    event: "tenant.public.resolve",
    requestId,
    requestedSlug,
    requestedHost,
    resolvedTenantId: resolved?.restaurant?.id || bundle?.restaurant?.id || null,
    resolvedSlug: resolved?.restaurant?.slug || bundle?.restaurant?.slug || null,
    cacheKey,
    status,
    path: req.originalUrl
  }));
}

function logIntegrityViolation({ requestId, resolvedTenantId, relatedRecordTenantId, recordType, recordId }) {
  console.warn(JSON.stringify({
    event: "tenant.data_integrity_violation",
    requestId,
    resolvedTenantId,
    relatedRecordTenantId,
    recordType,
    recordId
  }));
}

function belongsToTenant(record = {}, restaurantId) {
  return !record?.restaurantId || record.restaurantId === restaurantId;
}

function sanitizePublicBundle(bundle, requestId) {
  if (!bundle?.restaurant?.id) return bundle;
  const restaurantId = bundle.restaurant.id;
  const categories = (bundle.restaurant.categories || [])
    .filter((category) => {
      const ok = belongsToTenant(category, restaurantId);
      if (!ok) logIntegrityViolation({ requestId, resolvedTenantId: restaurantId, relatedRecordTenantId: category.restaurantId, recordType: "MenuCategory", recordId: category.id });
      return ok;
    })
    .map((category) => ({
      ...category,
      items: (category.items || []).filter((item) => {
        const ok = belongsToTenant(item, restaurantId);
        if (!ok) logIntegrityViolation({ requestId, resolvedTenantId: restaurantId, relatedRecordTenantId: item.restaurantId, recordType: "MenuItem", recordId: item.id });
        return ok;
      })
    }));
  const gallery = (bundle.gallery || []).filter((image) => {
    const ok = belongsToTenant(image, restaurantId);
    if (!ok) logIntegrityViolation({ requestId, resolvedTenantId: restaurantId, relatedRecordTenantId: image.restaurantId, recordType: "RestaurantGalleryImage", recordId: image.id });
    return ok;
  });
  const socialLinks = (bundle.socialLinks || []).filter((link) => {
    const ok = belongsToTenant(link, restaurantId);
    if (!ok) logIntegrityViolation({ requestId, resolvedTenantId: restaurantId, relatedRecordTenantId: link.restaurantId, recordType: "RestaurantSocialLink", recordId: link.id });
    return ok;
  });
  const domain = belongsToTenant(bundle.domain, restaurantId) ? bundle.domain : null;
  if (bundle.domain && !domain) {
    logIntegrityViolation({ requestId, resolvedTenantId: restaurantId, relatedRecordTenantId: bundle.domain.restaurantId, recordType: "RestaurantDomain", recordId: bundle.domain.id });
  }
  const website = belongsToTenant(bundle.website, restaurantId) ? bundle.website : null;
  if (bundle.website && !website) {
    logIntegrityViolation({ requestId, resolvedTenantId: restaurantId, relatedRecordTenantId: bundle.website.restaurantId, recordType: "RestaurantWebsiteSettings", recordId: bundle.website.id });
  }
  return {
    ...bundle,
    restaurant: { ...bundle.restaurant, categories },
    website: website || {},
    domain: domain || {},
    gallery,
    socialLinks,
    featuredItems: (bundle.featuredItems || []).filter((item) => belongsToTenant(item, restaurantId))
  };
}

function fullAddress(restaurant = {}) {
  return [restaurant.address, restaurant.city, restaurant.state, restaurant.zip].filter(Boolean).join(", ");
}

function mapEmbedUrl(address = "") {
  return address ? `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed` : "";
}

function directionsUrl(address = "") {
  return address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : "";
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function distanceMiles(originLat, originLng, targetLat, targetLng) {
  if ([originLat, originLng, targetLat, targetLng].some((value) => typeof value !== "number")) return null;
  const radians = (degrees) => degrees * (Math.PI / 180);
  const earthMiles = 3958.8;
  const dLat = radians(targetLat - originLat);
  const dLng = radians(targetLng - originLng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(originLat)) * Math.cos(radians(targetLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(earthMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function openingHoursSpecifications(hoursJson = {}) {
  return Object.entries(hoursJson || {}).map(([day, hours]) => {
    const [opens = "", closes = ""] = String(hours).split("-").map((value) => value.trim());
    return {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: day.charAt(0).toUpperCase() + day.slice(1),
      opens,
      closes
    };
  });
}

function buildSeo(bundle, req) {
  const restaurant = bundle.restaurant;
  const website = bundle.website;
  const title = website.seoTitle || `${restaurantName(restaurant)} | Direct Online Ordering`;
  const description = website.seoDescription || website.heroSubtitle || restaurant.description || `Order pickup or delivery directly from ${restaurantName(restaurant)}.`;
  const canonicalUrl = publicUrlForRestaurant(restaurant);
  const image = website.heroImageUrl || website.logoUrl || restaurant.logoUrl;
  return {
    title,
    description,
    canonicalUrl,
    openGraphTitle: title,
    openGraphDescription: description,
    openGraphImage: image,
    twitterCard: "summary_large_image",
    twitterTitle: title,
    twitterDescription: description,
    twitterImage: image,
    indexable: true
  };
}

function buildJsonLd(bundle, req) {
  const restaurant = bundle.restaurant;
  const website = bundle.website;
  const categories = restaurant.categories || [];
  const address = fullAddress(restaurant);
  const baseUrl = publicUrlForRestaurant(restaurant);
  const menuUrl = `${baseUrl}/menu`;
  const orderUrl = `${baseUrl}/order`;
  const menuItems = categories.flatMap((category) => (category.items || []).map((item) => ({
    "@type": "MenuItem",
    name: item.name,
    description: item.description,
    image: item.imageUrl,
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: ((item.priceCents || 0) / 100).toFixed(2),
      availability: item.available === false ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      url: orderUrl
    },
    menuAddOn: (item.optionGroups || []).map((group) => group.name).filter(Boolean)
  })));

  return {
    "@context": "https://schema.org",
    "@type": ["Restaurant", "LocalBusiness"],
    "@id": `${baseUrl}#restaurant`,
    name: restaurantName(restaurant),
    description: website.seoDescription || restaurant.description,
    url: baseUrl,
    image: [website.heroImageUrl, website.logoUrl, ...(bundle.gallery || []).map((image) => image.imageUrl)].filter(Boolean),
    logo: website.logoUrl,
    telephone: restaurant.phone,
    servesCuisine: website.cuisineType || restaurant.businessType,
    priceRange: "$$",
    address: {
      "@type": "PostalAddress",
      streetAddress: restaurant.address,
      addressLocality: restaurant.city,
      addressRegion: restaurant.state,
      postalCode: restaurant.zip,
      addressCountry: "US"
    },
    geo: restaurant.latitude && restaurant.longitude ? {
      "@type": "GeoCoordinates",
      latitude: restaurant.latitude,
      longitude: restaurant.longitude
    } : undefined,
    openingHoursSpecification: openingHoursSpecifications(restaurant.storeHoursJson || {}),
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.8",
      reviewCount: "128"
    },
    hasMenu: {
      "@type": "Menu",
      name: `${restaurantName(restaurant)} menu`,
      url: menuUrl,
      hasMenuSection: categories.map((category) => ({
        "@type": "MenuSection",
        name: category.name,
        hasMenuItem: (category.items || []).map((item) => menuItems.find((row) => row.name === item.name)).filter(Boolean)
      }))
    },
    potentialAction: {
      "@type": "OrderAction",
      target: orderUrl
    },
    map: directionsUrl(address),
    sameAs: (bundle.socialLinks || []).map((link) => link.url).filter(Boolean)
  };
}

function buildPublicSiteResponse(bundle, req) {
  const categories = (bundle.restaurant.categories || []).filter((category) => (category.items || []).length > 0);
  const items = categories.flatMap((category) => category.items || []);
  const address = fullAddress(bundle.restaurant);
  const domainInfo = domainInfoForRestaurant(bundle.restaurant, bundle.domain);
  return {
    ...bundle,
    domain: domainInfo,
    domainInfo,
    restaurant: { ...bundle.restaurant, categories },
    tenant: { ...bundle.restaurant, categories },
    websiteSettings: bundle.website,
    menuCategories: categories,
    menuItems: items,
    contactInfo: {
      name: restaurantName(bundle.restaurant),
      phone: bundle.restaurant.phone,
      email: bundle.restaurant.email,
      address,
      city: bundle.restaurant.city,
      state: bundle.restaurant.state,
      zip: bundle.restaurant.zip
    },
    location: {
      address,
      city: bundle.restaurant.city,
      state: bundle.restaurant.state,
      zip: bundle.restaurant.zip,
      latitude: bundle.restaurant.latitude,
      longitude: bundle.restaurant.longitude,
      deliveryRadiusMiles: bundle.restaurant.deliveryRadiusMiles || 5,
      mapEmbedUrl: mapEmbedUrl(address),
      directionsUrl: directionsUrl(address)
    },
    menuSummary: {
      categoryCount: categories.length,
      itemCount: items.length,
      featuredItemCount: bundle.featuredItems?.length || 0
    },
    hours: bundle.restaurant.storeHoursJson || {},
    seo: buildSeo(bundle, req),
    jsonLd: buildJsonLd({ ...bundle, restaurant: { ...bundle.restaurant, categories } }, req),
    routes: {
      home: domainInfo.canonicalUrl,
      menu: `${domainInfo.canonicalUrl}/menu`,
      order: `${domainInfo.canonicalUrl}/order`,
      about: `${domainInfo.canonicalUrl}/about`,
      contact: `${domainInfo.canonicalUrl}/contact`,
      gallery: `${domainInfo.canonicalUrl}/gallery`,
      loyalty: `${domainInfo.canonicalUrl}/loyalty`,
      catering: `${domainInfo.canonicalUrl}/catering`,
      careers: `${domainInfo.canonicalUrl}/careers`,
      preview: `/sites/${bundle.restaurant.slug}`
    }
  };
}

async function bundleForResolvedTenant({ req, slug = "", host = "" }) {
  const requestId = requestIdFor(req);
  const requestedHost = host || req.get("host") || "";
  const resolved = await resolvePublicTenant({ slug, host: requestedHost });
  if (!resolved.restaurant) {
    const cacheKey = slug ? `public-site:slug:${slug}` : `public-site:host:${requestedHost}`;
    logTenantResolve({ req, requestId, requestedSlug: slug, requestedHost, resolved, bundle: null, cacheKey, status: resolved.type || "not_found" });
    return { resolved, bundle: null, requestId, cacheKey };
  }
  const cacheKey = resolved.type === "path_slug" ? `public-site:slug:${resolved.restaurant.slug}` : `public-site:host:${resolved.host}`;
  const bundle = sanitizePublicBundle(await getWebsiteBundleBySlug(resolved.restaurant.slug), requestId);
  logTenantResolve({ req, requestId, requestedSlug: slug, requestedHost, resolved, bundle, cacheKey, status: bundle ? "ok" : "not_found" });
  return { resolved, bundle, requestId, cacheKey };
}

async function bundleForResolvedHost(req, rawHost) {
  return bundleForResolvedTenant({ req, host: rawHost });
}

async function sendWebsiteBundle(req, res, next) {
  try {
    const { resolved, bundle, requestId, cacheKey } = await bundleForResolvedTenant({ req, slug: req.params.slug });
    if (!bundle || bundle.website.websiteEnabled === false) return res.status(404).json({ error: "Website not found" });
    res.json({ ...buildPublicSiteResponse(bundle, req), tenantResolution: { type: resolved.type, slug: resolved.restaurant.slug, host: resolved.host, cacheKey, requestId } });
  } catch (error) {
    next(error);
  }
}

async function sendSiteBundle(req, res, next) {
  try {
    const { bundle } = await bundleForResolvedTenant({ req, slug: req.params.slug });
    if (!bundle || bundle.website.websiteEnabled === false) return res.status(404).json({ error: "Website not found" });
    res.json(bundle);
  } catch (error) {
    next(error);
  }
}

async function sendWebsiteBundleByHost(req, res, next) {
  try {
    const host = req.query.host || req.get("host");
    const { resolved, bundle, requestId, cacheKey } = await bundleForResolvedHost(req, host);
    if (!bundle || bundle.website.websiteEnabled === false) {
      return res.status(404).json({
        error: "Domain is not configured for a Loohar restaurant website",
        host: resolved.host,
        resolution: resolved.type
      });
    }
    res.json({ ...buildPublicSiteResponse(bundle, req), hostResolution: { type: resolved.type, host: resolved.host, cacheKey, requestId } });
  } catch (error) {
    next(error);
  }
}

function sitemapXml(baseUrl) {
  const routes = ["", "/menu", "/order", "/about", "/gallery", "/loyalty", "/catering", "/contact"];
  const lastmod = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routes.map((route) => `  <url><loc>${baseUrl}${route}</loc><lastmod>${lastmod}</lastmod></url>`).join("\n")}\n</urlset>\n`;
}

async function sendSitemapByHost(req, res, next) {
  try {
    const host = req.query.host || req.get("host");
    const { bundle } = await bundleForResolvedHost(req, host);
    if (!bundle || bundle.website.websiteEnabled === false) return res.status(404).type("text/plain").send("Domain not configured");
    const baseUrl = domainInfoForRestaurant(bundle.restaurant, bundle.domain).canonicalUrl;
    res.type("application/xml").send(sitemapXml(baseUrl));
  } catch (error) {
    next(error);
  }
}

async function sendRobotsByHost(req, res, next) {
  try {
    const host = req.query.host || req.get("host");
    const { bundle } = await bundleForResolvedHost(req, host);
    if (!bundle || bundle.website.websiteEnabled === false) return res.status(404).type("text/plain").send("User-agent: *\nDisallow: /\n");
    const baseUrl = domainInfoForRestaurant(bundle.restaurant, bundle.domain).canonicalUrl;
    res.type("text/plain").send(`User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`);
  } catch (error) {
    next(error);
  }
}

async function sendMenu(req, res, next) {
  try {
    const { bundle } = await bundleForResolvedTenant({ req, slug: req.params.slug });
    if (!bundle || bundle.website.websiteEnabled === false) return res.status(404).json({ error: "Menu not found" });
    const site = buildPublicSiteResponse(bundle, req);
    res.json({
      restaurant: site.restaurant,
      website: site.website,
      categories: site.menuCategories,
      menuCategories: site.menuCategories,
      menuItems: site.menuItems,
      featuredItems: bundle.featuredItems
    });
  } catch (error) {
    next(error);
  }
}

async function sendMenuItem(req, res, next) {
  try {
    const { bundle } = await bundleForResolvedTenant({ req, slug: req.params.slug });
    if (!bundle || bundle.website.websiteEnabled === false) return res.status(404).json({ error: "Menu item not found" });
    const item = bundle.restaurant.categories.flatMap((category) => category.items).find((menuItem) => menuItem.id === req.params.itemId);
    if (!item) return res.status(404).json({ error: "Menu item not found" });
    res.json({ item });
  } catch (error) {
    next(error);
  }
}

async function sendGallery(req, res, next) {
  try {
    const { bundle } = await bundleForResolvedTenant({ req, slug: req.params.slug });
    if (!bundle || bundle.website.websiteEnabled === false) return res.status(404).json({ error: "Gallery not found" });
    res.json({ gallery: bundle.gallery });
  } catch (error) {
    next(error);
  }
}

async function sendLoyalty(req, res, next) {
  try {
    const { bundle } = await bundleForResolvedTenant({ req, slug: req.params.slug });
    if (!bundle || bundle.website.websiteEnabled === false) return res.status(404).json({ error: "Loyalty not found" });
    res.json({ settings: bundle.restaurant.loyaltySettingsJson, rewards: bundle.restaurant.loyaltyRewards });
  } catch (error) {
    next(error);
  }
}

async function sendOrderConfig(req, res, next) {
  try {
    const { bundle } = await bundleForResolvedTenant({ req, slug: req.params.slug });
    if (!bundle || bundle.website.websiteEnabled === false) return res.status(404).json({ error: "Order page not found" });
    res.json({
      restaurant: bundle.restaurant,
      orderingEnabled: ["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK"].includes(bundle.restaurant.businessType),
      pickupEnabled: bundle.restaurant.pickupEnabled,
      deliveryEnabled: bundle.restaurant.deliveryEnabled,
      deliveryFeeCents: bundle.restaurant.deliveryFeeCents,
      taxRatePlaceholder: 0.0825,
      coupons: bundle.restaurant.coupons,
      loyaltyRewards: bundle.restaurant.loyaltyRewards
    });
  } catch (error) {
    next(error);
  }
}

async function discoverRestaurants(req, res, next) {
  try {
    const lat = toNumber(req.query.lat);
    const lng = toNumber(req.query.lng);
    const city = typeof req.query.city === "string" ? req.query.city.trim() : "";
    const zip = typeof req.query.zip === "string" ? req.query.zip.trim() : "";
    const businessType = typeof req.query.type === "string" ? req.query.type.trim().toUpperCase() : "";
    const delivery = typeof req.query.delivery === "string" ? req.query.delivery.trim().toLowerCase() : "";
    const where = { status: "ACTIVE" };

    if (DISCOVERY_BUSINESS_TYPES.includes(businessType)) where.businessType = businessType;
    if (delivery === "true") where.deliveryEnabled = true;
    if (delivery === "false") where.pickupEnabled = true;
    if (city) {
      where.OR = [
        { city: { contains: city, mode: "insensitive" } },
        { address: { contains: city, mode: "insensitive" } }
      ];
    }
    if (zip) {
      where.OR = [
        ...(where.OR || []),
        { zip: { startsWith: zip } },
        { address: { contains: zip } }
      ];
    }

    const rows = await prisma.restaurant.findMany({
      where,
      select: { slug: true },
      orderBy: { businessName: "asc" },
      take: 50
    });

    const bundles = (await Promise.all(rows.map((row) => getWebsiteBundleBySlug(row.slug)))).filter((bundle) => bundle && bundle.website.websiteEnabled !== false);
    const restaurants = bundles.map((bundle) => {
      const restaurant = bundle.restaurant;
      const website = bundle.website;
      const address = fullAddress(restaurant);
      const distance = distanceMiles(lat, lng, restaurant.latitude, restaurant.longitude);
      return {
        id: restaurant.id,
        name: restaurantName(restaurant),
        slug: restaurant.slug,
        businessType: restaurant.businessType,
        cuisine: website.cuisineType || restaurant.businessType,
        logoUrl: website.logoUrl || restaurant.logoUrl,
        heroImageUrl: website.heroImageUrl || bundle.gallery?.[0]?.imageUrl,
        address,
        city: restaurant.city,
        state: restaurant.state,
        zip: restaurant.zip,
        phone: restaurant.phone,
        pickupEnabled: restaurant.pickupEnabled,
        deliveryEnabled: restaurant.deliveryEnabled,
        deliveryRadiusMiles: restaurant.deliveryRadiusMiles || 5,
        distanceMiles: distance,
        rating: 4.8,
        reviewCount: 128,
        openStatus: "Hours vary",
        websiteUrl: publicUrlForRestaurant(restaurant),
        orderUrl: publicUrlForRestaurant(restaurant, "/order")
      };
    }).sort((a, b) => {
      if (a.distanceMiles === null && b.distanceMiles === null) return a.name.localeCompare(b.name);
      if (a.distanceMiles === null) return 1;
      if (b.distanceMiles === null) return -1;
      return a.distanceMiles - b.distanceMiles;
    });

    res.json({
      restaurants,
      count: restaurants.length,
      filters: { city, zip, type: businessType || "ALL", delivery: delivery || "ALL" },
      location: { lat, lng }
    });
  } catch (error) {
    next(error);
  }
}

router.get("/discover", discoverRestaurants);
router.get("/site-by-host", sendWebsiteBundleByHost);
router.get("/site-by-host/sitemap.xml", sendSitemapByHost);
router.get("/site-by-host/robots.txt", sendRobotsByHost);
router.get("/restaurants/:slug/website", sendWebsiteBundle);
router.get("/restaurants/:slug/site", sendSiteBundle);
router.get("/restaurants/:slug/menu", sendMenu);
router.get("/restaurants/:slug/menu/:itemId", sendMenuItem);
router.get("/restaurants/:slug/gallery", sendGallery);
router.get("/restaurants/:slug/loyalty", sendLoyalty);
router.get("/restaurants/:slug/order-config", sendOrderConfig);

router.get("/sites/:slug", sendWebsiteBundle);
router.get("/sites/:slug/site", sendSiteBundle);
router.get("/sites/:slug/menu", sendMenu);
router.get("/sites/:slug/menu/:itemId", sendMenuItem);
router.get("/sites/:slug/gallery", sendGallery);
router.get("/sites/:slug/loyalty", sendLoyalty);
router.get("/sites/:slug/order-config", sendOrderConfig);
router.post("/sites/:slug/orders", attachRestaurantIdBySlug, validate(createOrderSchema), createOrder);
router.get("/sites/:slug/orders/:orderId", getOrderStatus);
router.get("/sites/:slug/orders/:orderId/status", getOrderStatus);

export default router;
