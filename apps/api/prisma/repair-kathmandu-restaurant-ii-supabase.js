import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

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

const enabledModules = ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"];
const defaultSubdomain = tenant.slug;
const defaultHost = `${tenant.slug}.loohar.com`;
const dnsTarget = process.env.TENANT_CNAME_TARGET || "cname.vercel-dns.com";
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Supabase REST repair requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
}

function repairId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function restUrl(table, filters = {}) {
  const url = new URL(`${supabaseUrl}/rest/v1/${encodeURIComponent(table)}`);
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function rest(table, { method = "GET", filters = {}, body, prefer = "return=representation" } = {}) {
  const response = await fetch(restUrl(table, filters), {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: prefer
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const details = typeof payload === "string" ? payload : payload?.message || JSON.stringify(payload);
    throw new Error(`${method} ${table} failed: ${response.status} ${details}`);
  }
  return payload;
}

async function findOne(table, filters, select = "*") {
  const rows = await rest(table, { filters: { ...filters, select }, prefer: "" });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function updateRows(table, filters, body) {
  return rest(table, { method: "PATCH", filters, body });
}

async function createRow(table, body) {
  const rows = await rest(table, { method: "POST", body });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function upsertWebsite(restaurantId) {
  const body = {
    restaurantId,
    websiteEnabled: true,
    heroTitle: tenant.name,
    heroSubtitle: `Order directly from ${tenant.name}.`,
    tagline: "Restaurant",
    cuisineType: "Restaurant",
    heroImageUrl: null,
    logoUrl: null,
    brandColor: "#111827",
    accentColor: "#f59e0b",
    headingFont: "",
    bodyFont: "",
    sectionSettingsJson: { hero: true, featuredMenu: true, story: true, gallery: true, catering: true, contact: true },
    storeHoursJson: {},
    aboutTitle: `About ${tenant.name}`,
    aboutStory: `${tenant.name} is setting up direct online ordering for pickup and delivery.`,
    missionStatement: "Serve guests directly with simple pickup, delivery, loyalty, and restaurant-owned ordering.",
    ownerStory: "This restaurant is preparing its public website content.",
    specialOfferText: "Order direct for restaurant-owned rewards.",
    seoTitle: `${tenant.name} | Direct Online Ordering`,
    seoDescription: `Order pickup or delivery directly from ${tenant.name} in ${tenant.city}, ${tenant.state}.`,
    updatedAt: nowIso()
  };
  const existing = await findOne("RestaurantWebsiteSettings", { restaurantId: `eq.${restaurantId}` }, "id");
  if (existing) {
    const rows = await updateRows("RestaurantWebsiteSettings", { id: `eq.${existing.id}` }, body);
    return rows[0];
  }
  return createRow("RestaurantWebsiteSettings", { id: repairId("website"), ...body, createdAt: nowIso() });
}

async function upsertDomain(restaurantId) {
  const body = {
    restaurantId,
    defaultSubdomain,
    primaryDomain: defaultHost,
    customDomain: null,
    canonicalDomain: defaultHost,
    domainStatus: "NOT_CONFIGURED",
    dnsTarget,
    sslStatus: "NOT_CONFIGURED",
    updatedAt: nowIso()
  };
  const existing = await findOne("RestaurantDomain", { restaurantId: `eq.${restaurantId}`, defaultSubdomain: `eq.${defaultSubdomain}` }, "id");
  if (existing) {
    const rows = await updateRows("RestaurantDomain", { id: `eq.${existing.id}` }, body);
    return rows[0];
  }
  return createRow("RestaurantDomain", { id: repairId("domain"), ...body, createdAt: nowIso() });
}

async function upsertLocation(restaurantId) {
  const body = {
    restaurantId,
    name: tenant.name,
    address: `${tenant.address}, ${tenant.city}, ${tenant.state} ${tenant.zip}`,
    phone: tenant.phone,
    timezone: tenant.timezone,
    active: true,
    updatedAt: nowIso()
  };
  const existing = await findOne("RestaurantLocation", { restaurantId: `eq.${restaurantId}`, name: `eq.${tenant.name}` }, "id");
  if (existing) {
    const rows = await updateRows("RestaurantLocation", { id: `eq.${existing.id}` }, body);
    return rows[0];
  }
  return createRow("RestaurantLocation", { id: repairId("location"), ...body, createdAt: nowIso() });
}

async function linkOwner(restaurantId) {
  const owner = await findOne("User", { email: `eq.${tenant.ownerEmail}` }, "id,email,role,status");
  if (!owner) return null;
  const rows = await updateRows("User", { id: `eq.${owner.id}` }, {
    restaurantId,
    role: owner.role === "SUPER_ADMIN" ? owner.role : "TENANT_OWNER",
    status: owner.status === "DELETED" ? "ACTIVE" : owner.status,
    updatedAt: nowIso()
  });
  return rows[0];
}

async function deleteDemoGalleryRows(restaurantId) {
  const deleted = await rest("RestaurantGalleryImage", {
    method: "DELETE",
    filters: { restaurantId: `eq.${restaurantId}`, altText: "ilike.*Demo Bistro*" },
    prefer: "return=representation"
  });
  return Array.isArray(deleted) ? deleted.length : 0;
}

async function main() {
  const restaurant = await findOne("Restaurant", { slug: `eq.${tenant.slug}` });
  if (!restaurant) {
    throw new Error(`No tenant found for slug ${tenant.slug}. Repair aborted.`);
  }

  const restaurantRows = await updateRows("Restaurant", { id: `eq.${restaurant.id}` }, {
    name: tenant.name,
    businessName: tenant.name,
    businessType: tenant.businessType,
    enabledModules,
    slug: tenant.slug,
    status: "ACTIVE",
    description: null,
    brandingJson: null,
    settingsJson: { createdBy: "MASTER_ADMIN", enabledModules },
    logoUrl: null,
    phone: tenant.phone,
    email: tenant.businessEmail,
    address: tenant.address,
    city: tenant.city,
    state: tenant.state,
    zip: tenant.zip,
    timezone: tenant.timezone,
    deliveryRadiusMiles: 5,
    deliveryEnabled: true,
    pickupEnabled: true,
    deliveryFeeCents: 399,
    updatedAt: nowIso()
  });
  const updatedRestaurant = restaurantRows[0];
  const website = await upsertWebsite(updatedRestaurant.id);
  const domain = await upsertDomain(updatedRestaurant.id);
  const location = await upsertLocation(updatedRestaurant.id);
  const owner = await linkOwner(updatedRestaurant.id);
  const deletedDemoGalleryRows = await deleteDemoGalleryRows(updatedRestaurant.id);
  const auditLog = await createRow("AuditLog", {
    id: repairId("audit"),
    restaurantId: updatedRestaurant.id,
    action: "tenant.repair.kathmandu.rest",
    entityType: "Restaurant",
    entityId: updatedRestaurant.id,
    metadataJson: {
      slug: tenant.slug,
      repairedWebsiteSettingsId: website.id,
      repairedDomainId: domain.id,
      repairedLocationId: location.id,
      ownerLinked: Boolean(owner),
      deletedDemoGalleryRows
    },
    createdAt: nowIso()
  });

  console.log(JSON.stringify({
    ok: true,
    transport: "supabase_rest",
    restaurantId: updatedRestaurant.id,
    slug: updatedRestaurant.slug,
    businessName: updatedRestaurant.businessName,
    websiteSettingsId: website.id,
    domainId: domain.id,
    defaultSubdomain: domain.defaultSubdomain,
    owner: owner ? { id: owner.id, email: owner.email, role: owner.role, restaurantId: owner.restaurantId } : null,
    locationId: location.id,
    deletedDemoGalleryRows,
    auditLogId: auditLog.id
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
