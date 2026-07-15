import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { recordAudit } from "../services/auditService.js";
import { uploadImageToSupabaseStorage } from "../services/uploadService.js";

const router = Router();
const uploadKinds = new Set(["restaurant-logo", "restaurant-hero", "restaurant-mobile-hero", "restaurant-favicon", "menu-item", "gallery"]);
const uploadRoles = ["SUPER_ADMIN", "TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER"];

router.use(requireAuth, requireRole(...uploadRoles));

function requestedRestaurantId(req) {
  if (req.user.role === "SUPER_ADMIN") return req.body.restaurantId || req.tenantId;
  return req.tenantId;
}

function toBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  return fallback;
}

async function ensureUploadRestaurant(req, res) {
  const restaurantId = requestedRestaurantId(req);
  if (!restaurantId) {
    res.status(400).json({ error: "restaurantId is required." });
    return null;
  }
  if (req.user.role !== "SUPER_ADMIN" && req.body.restaurantId && req.body.restaurantId !== req.tenantId) {
    res.status(403).json({ error: "Tenant access denied" });
    return null;
  }
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!restaurant || restaurant.status === "DELETED") {
    res.status(404).json({ error: "Restaurant not found" });
    return null;
  }
  return restaurant;
}

router.post("/:kind", async (req, res, next) => {
  try {
    const kind = req.params.kind;
    if (!uploadKinds.has(kind)) return res.status(404).json({ error: "Upload type not found" });

    const restaurant = await ensureUploadRestaurant(req, res);
    if (!restaurant) return;

    if (kind === "menu-item" && !req.body.menuItemId) {
      return res.status(400).json({ error: "menuItemId is required for menu item image uploads." });
    }

    if (kind === "menu-item") {
      const existingMenuItem = await prisma.menuItem.findUnique({
        where: { id_restaurantId: { id: req.body.menuItemId, restaurantId: restaurant.id } },
        select: { id: true }
      });
      if (!existingMenuItem) return res.status(404).json({ error: "Menu item not found" });
    }

    const upload = await uploadImageToSupabaseStorage({
      restaurantId: restaurant.id,
      kind,
      fileName: req.body.fileName,
      mimeType: req.body.mimeType,
      dataUrl: req.body.dataUrl,
      base64: req.body.base64,
      menuItemId: req.body.menuItemId
    });

    if (kind === "restaurant-logo") {
      const [updatedRestaurant, website] = await prisma.$transaction([
        prisma.restaurant.update({ where: { id: restaurant.id }, data: { logoUrl: upload.publicUrl } }),
        prisma.restaurantWebsiteSettings.upsert({
          where: { restaurantId: restaurant.id },
          update: { logoUrl: upload.publicUrl },
          create: { restaurantId: restaurant.id, logoUrl: upload.publicUrl }
        })
      ]);
      await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "website.logo.uploaded", entityType: "RestaurantWebsiteSettings", entityId: website.id, metadata: { provider: upload.provider, key: upload.key } });
      return res.status(201).json({ upload, restaurant: updatedRestaurant, website });
    }

    if (kind === "restaurant-hero") {
      const website = await prisma.restaurantWebsiteSettings.upsert({
        where: { restaurantId: restaurant.id },
        update: { heroImageUrl: upload.publicUrl },
        create: { restaurantId: restaurant.id, heroImageUrl: upload.publicUrl }
      });
      await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "website.hero.uploaded", entityType: "RestaurantWebsiteSettings", entityId: website.id, metadata: { provider: upload.provider, key: upload.key } });
      return res.status(201).json({ upload, website });
    }

    if (kind === "restaurant-mobile-hero") {
      const website = await prisma.restaurantWebsiteSettings.upsert({
        where: { restaurantId: restaurant.id },
        update: { mobileHeroImageUrl: upload.publicUrl },
        create: { restaurantId: restaurant.id, mobileHeroImageUrl: upload.publicUrl }
      });
      await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "website.hero.uploaded", entityType: "RestaurantWebsiteSettings", entityId: website.id, metadata: { variant: "mobile", provider: upload.provider, key: upload.key } });
      return res.status(201).json({ upload, website });
    }

    if (kind === "restaurant-favicon") {
      const website = await prisma.restaurantWebsiteSettings.upsert({
        where: { restaurantId: restaurant.id },
        update: { faviconUrl: upload.publicUrl },
        create: { restaurantId: restaurant.id, faviconUrl: upload.publicUrl }
      });
      await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "website.favicon.uploaded", entityType: "RestaurantWebsiteSettings", entityId: website.id, metadata: { provider: upload.provider, key: upload.key } });
      return res.status(201).json({ upload, website });
    }

    if (kind === "menu-item") {
      const item = await prisma.menuItem.update({
        where: { id_restaurantId: { id: req.body.menuItemId, restaurantId: restaurant.id } },
        data: { imageUrl: upload.publicUrl },
        include: { category: true, options: true, optionGroups: { include: { options: true } } }
      });
      await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "menu.item.image.uploaded", entityType: "MenuItem", entityId: item.id, metadata: { imageUrl: upload.publicUrl, provider: upload.provider, key: upload.key } });
      return res.status(201).json({ upload, item });
    }

    const count = await prisma.restaurantGalleryImage.count({ where: { restaurantId: restaurant.id } });
    const image = await prisma.restaurantGalleryImage.create({
      data: {
        restaurantId: restaurant.id,
        imageUrl: upload.publicUrl,
        title: req.body.title ? String(req.body.title).trim() : null,
        altText: req.body.altText || req.body.title || `${restaurant.businessName || restaurant.name} photo`,
        caption: req.body.caption ? String(req.body.caption).trim() : null,
        category: req.body.category || "food",
        published: toBoolean(req.body.published, true),
        sortOrder: Number.isInteger(Number(req.body.sortOrder)) ? Number(req.body.sortOrder) : count + 1
      }
    });
    await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "gallery.image.uploaded", entityType: "RestaurantGalleryImage", entityId: image.id, metadata: { provider: upload.provider, key: upload.key } });
    return res.status(201).json({ upload, image });
  } catch (error) {
    next(error);
  }
});

export default router;
