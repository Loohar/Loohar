import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });
if (process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
}

const prisma = new PrismaClient();

const tenant = {
  slug: "kathmandu-restaurant-ii",
  name: "Kathmandu Restaurant II",
  businessType: "RESTAURANT",
  ownerEmail: "sunuwar2519@gmail.com",
  businessEmail: "kathmandu2@loohar.com",
  phone: "3032465987",
  address: "104 Sundance Cir",
  city: "Nederland",
  state: "CO",
  zip: "80066",
  timezone: "America/Denver"
};

const defaultSubdomain = tenant.slug;
const defaultHost = `${tenant.slug}.loohar.com`;
const dnsTarget = process.env.TENANT_CNAME_TARGET || "cname.vercel-dns.com";

async function main() {
  const restaurant = await prisma.restaurant.findUnique({ where: { slug: tenant.slug } });
  if (!restaurant) {
    throw new Error(`No tenant found for slug ${tenant.slug}. Repair aborted.`);
  }

  const updatedRestaurant = await prisma.restaurant.update({
    where: { id: restaurant.id },
    data: {
      name: tenant.name,
      businessName: tenant.name,
      businessType: tenant.businessType,
      status: "ACTIVE",
      email: tenant.businessEmail,
      phone: tenant.phone,
      address: tenant.address,
      city: tenant.city,
      state: tenant.state,
      zip: tenant.zip,
      timezone: tenant.timezone,
      pickupEnabled: true,
      deliveryEnabled: true,
      enabledModules: {
        set: ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"]
      }
    }
  });

  const websiteSettings = await prisma.restaurantWebsiteSettings.upsert({
    where: { restaurantId: restaurant.id },
    update: {
      websiteEnabled: true,
      heroTitle: tenant.name,
      heroSubtitle: `Order directly from ${tenant.name}.`,
      tagline: "Restaurant",
      cuisineType: "Restaurant",
      aboutTitle: `About ${tenant.name}`,
      aboutStory: `${tenant.name} is setting up direct online ordering for pickup and delivery.`,
      missionStatement: "Serve guests directly with simple pickup, delivery, loyalty, and restaurant-owned ordering.",
      ownerStory: "This restaurant is preparing its public website content.",
      specialOfferText: "Order direct for restaurant-owned rewards.",
      seoTitle: `${tenant.name} | Direct Online Ordering`,
      seoDescription: `Order pickup or delivery directly from ${tenant.name} in ${tenant.city}, ${tenant.state}.`,
      brandColor: "#111827",
      accentColor: "#f59e0b",
      sectionSettingsJson: { hero: true, featuredMenu: true, story: true, gallery: true, catering: true, contact: true }
    },
    create: {
      restaurantId: restaurant.id,
      websiteEnabled: true,
      heroTitle: tenant.name,
      heroSubtitle: `Order directly from ${tenant.name}.`,
      tagline: "Restaurant",
      cuisineType: "Restaurant",
      aboutTitle: `About ${tenant.name}`,
      aboutStory: `${tenant.name} is setting up direct online ordering for pickup and delivery.`,
      missionStatement: "Serve guests directly with simple pickup, delivery, loyalty, and restaurant-owned ordering.",
      ownerStory: "This restaurant is preparing its public website content.",
      specialOfferText: "Order direct for restaurant-owned rewards.",
      seoTitle: `${tenant.name} | Direct Online Ordering`,
      seoDescription: `Order pickup or delivery directly from ${tenant.name} in ${tenant.city}, ${tenant.state}.`,
      brandColor: "#111827",
      accentColor: "#f59e0b",
      sectionSettingsJson: { hero: true, featuredMenu: true, story: true, gallery: true, catering: true, contact: true }
    }
  });

  const domain = await prisma.restaurantDomain.upsert({
    where: { restaurantId_defaultSubdomain: { restaurantId: restaurant.id, defaultSubdomain } },
    update: {
      primaryDomain: defaultHost,
      canonicalDomain: defaultHost,
      dnsTarget
    },
    create: {
      restaurantId: restaurant.id,
      defaultSubdomain,
      primaryDomain: defaultHost,
      canonicalDomain: defaultHost,
      domainStatus: "NOT_CONFIGURED",
      dnsTarget,
      sslStatus: "NOT_CONFIGURED"
    }
  });

  const owner = await prisma.user.findUnique({ where: { email: tenant.ownerEmail } });
  const ownerUpdate = owner
    ? await prisma.user.update({
      where: { id: owner.id },
      data: {
        restaurantId: restaurant.id,
        role: owner.role === "SUPER_ADMIN" ? owner.role : "TENANT_OWNER",
        status: owner.status === "DELETED" ? "ACTIVE" : owner.status
      },
      select: { id: true, email: true, role: true, restaurantId: true }
    })
    : null;

  const location = await prisma.restaurantLocation.findFirst({ where: { restaurantId: restaurant.id, name: tenant.name } });
  const locationRecord = location
    ? await prisma.restaurantLocation.update({
      where: { id: location.id },
      data: { address: `${tenant.address}, ${tenant.city}, ${tenant.state} ${tenant.zip}`, phone: tenant.phone, timezone: tenant.timezone, active: true }
    })
    : await prisma.restaurantLocation.create({
      data: { restaurantId: restaurant.id, name: tenant.name, address: `${tenant.address}, ${tenant.city}, ${tenant.state} ${tenant.zip}`, phone: tenant.phone, timezone: tenant.timezone, active: true }
    });

  const categories = await prisma.menuCategory.findMany({ where: { restaurantId: restaurant.id }, select: { id: true } });
  const categoryIds = categories.map((category) => category.id);
  const repairedMenuItems = categoryIds.length
    ? await prisma.menuItem.updateMany({
      where: { categoryId: { in: categoryIds }, NOT: { restaurantId: restaurant.id } },
      data: { restaurantId: restaurant.id }
    })
    : { count: 0 };

  const auditLog = await prisma.auditLog.create({
    data: {
      restaurantId: restaurant.id,
      action: "tenant.repair.kathmandu",
      entityType: "Restaurant",
      entityId: restaurant.id,
      metadataJson: {
        slug: tenant.slug,
        repairedWebsiteSettingsId: websiteSettings.id,
        repairedDomainId: domain.id,
        repairedLocationId: locationRecord.id,
        repairedMenuItemCount: repairedMenuItems.count,
        ownerLinked: Boolean(ownerUpdate)
      }
    }
  });

  console.log(JSON.stringify({
    ok: true,
    restaurantId: updatedRestaurant.id,
    slug: updatedRestaurant.slug,
    businessName: updatedRestaurant.businessName,
    websiteSettingsId: websiteSettings.id,
    domainId: domain.id,
    defaultSubdomain: domain.defaultSubdomain,
    owner: ownerUpdate,
    locationId: locationRecord.id,
    repairedMenuItemCount: repairedMenuItems.count,
    auditLogId: auditLog.id
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
