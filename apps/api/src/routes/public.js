import { Router } from "express";
import { attachRestaurantIdBySlug, createOrder, createOrderSchema, getOrderStatus } from "./customer.js";
import { validate } from "../middleware/validate.js";
import { getWebsiteBundleBySlug } from "../services/websiteService.js";

const router = Router();

async function sendWebsiteBundle(req, res, next) {
  try {
    const bundle = await getWebsiteBundleBySlug(req.params.slug);
    if (!bundle || bundle.website.websiteEnabled === false) return res.status(404).json({ error: "Website not found" });
    res.json({
      ...bundle,
      seo: {
        title: bundle.website.seoTitle,
        description: bundle.website.seoDescription,
        openGraphImage: bundle.website.heroImageUrl || bundle.restaurant.logoUrl,
        schemaPlaceholder: {
          "@type": "Restaurant",
          name: bundle.restaurant.businessName || bundle.restaurant.name,
          address: bundle.restaurant.address,
          telephone: bundle.restaurant.phone,
          url: `/sites/${bundle.restaurant.slug}`
        }
      },
      routes: {
        home: `/sites/${bundle.restaurant.slug}`,
        menu: `/sites/${bundle.restaurant.slug}/menu`,
        order: `/sites/${bundle.restaurant.slug}/order`,
        about: `/sites/${bundle.restaurant.slug}/about`,
        contact: `/sites/${bundle.restaurant.slug}/contact`,
        gallery: `/sites/${bundle.restaurant.slug}/gallery`,
        loyalty: `/sites/${bundle.restaurant.slug}/loyalty`,
        catering: `/sites/${bundle.restaurant.slug}/catering`,
        careers: `/sites/${bundle.restaurant.slug}/careers`
      }
    });
  } catch (error) {
    next(error);
  }
}

async function sendSiteBundle(req, res, next) {
  try {
    const bundle = await getWebsiteBundleBySlug(req.params.slug);
    if (!bundle || bundle.website.websiteEnabled === false) return res.status(404).json({ error: "Website not found" });
    res.json(bundle);
  } catch (error) {
    next(error);
  }
}

async function sendMenu(req, res, next) {
  try {
    const bundle = await getWebsiteBundleBySlug(req.params.slug);
    if (!bundle || bundle.website.websiteEnabled === false) return res.status(404).json({ error: "Menu not found" });
    res.json({ restaurant: bundle.restaurant, categories: bundle.restaurant.categories });
  } catch (error) {
    next(error);
  }
}

async function sendMenuItem(req, res, next) {
  try {
    const bundle = await getWebsiteBundleBySlug(req.params.slug);
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
    const bundle = await getWebsiteBundleBySlug(req.params.slug);
    if (!bundle || bundle.website.websiteEnabled === false) return res.status(404).json({ error: "Gallery not found" });
    res.json({ gallery: bundle.gallery });
  } catch (error) {
    next(error);
  }
}

async function sendLoyalty(req, res, next) {
  try {
    const bundle = await getWebsiteBundleBySlug(req.params.slug);
    if (!bundle || bundle.website.websiteEnabled === false) return res.status(404).json({ error: "Loyalty not found" });
    res.json({ settings: bundle.restaurant.loyaltySettingsJson, rewards: bundle.restaurant.loyaltyRewards });
  } catch (error) {
    next(error);
  }
}

async function sendOrderConfig(req, res, next) {
  try {
    const bundle = await getWebsiteBundleBySlug(req.params.slug);
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
