import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { loadRestaurantEntitlements } from "../src/middleware/entitlements.js";

const prisma = new PrismaClient();

const DEVELOPMENT_SLUG = process.env.DEVELOPMENT_POS_SLUG || "development-restaurant";
const DEMO_SLUG = process.env.DEMO_POS_COMPARE_SLUG || "demo-bistro";

function countWhere(items = [], predicate = () => true) {
  return items.filter(predicate).length;
}

function summarizeRestaurant(restaurant) {
  if (!restaurant) return null;
  const categories = restaurant.categories || [];
  const items = restaurant.menuItems || [];
  const locations = restaurant.locations || [];
  const devices = restaurant.posDevices || [];
  const registers = restaurant.posRegisters || [];
  const cashDrawers = restaurant.cashDrawers || [];
  const openShifts = restaurant.employeeShifts || [];
  const drawerSessions = restaurant.cashDrawerSessions || [];
  const entitlement = restaurant.__entitlement || null;
  return {
    tenantId: restaurant.id,
    restaurantId: restaurant.id,
    slug: restaurant.slug,
    name: restaurant.businessName || restaurant.name,
    status: restaurant.status,
    tenantClassification: restaurant.tenantClassification,
    locationCount: locations.length,
    activeLocationCount: countWhere(locations, (location) => location.active),
    defaultLocationId: locations[0]?.id || null,
    subscriptionStatus: entitlement?.subscriptionStatus || null,
    effectivePlan: entitlement?.planCode || null,
    posEntitled: entitlement?.fullAccess || entitlement?.planCode === "PROFESSIONAL" || entitlement?.planCode === "ENTERPRISE",
    fullAccess: Boolean(entitlement?.fullAccess),
    menuId: null,
    categoryCount: categories.length,
    activeCategoryCount: countWhere(categories, (category) => category.active),
    rawItemCount: items.length,
    visibleItemCount: countWhere(items, (item) => item.available && item.category?.active),
    deviceCount: devices.length,
    activeDeviceCount: countWhere(devices, (device) => device.status === "ACTIVE"),
    kioskDeviceCount: countWhere(devices, (device) => device.deviceType === "POS_KIOSK" || device.kioskModeEnabled),
    registerCount: registers.length,
    activeRegisterCount: countWhere(registers, (register) => register.active),
    cashDrawerCount: cashDrawers.length,
    openCashDrawerCount: countWhere(cashDrawers, (drawer) => drawer.status === "OPEN"),
    openShiftCount: openShifts.length,
    openDrawerSessionCount: drawerSessions.length,
    duplicateCategoryNames: categories
      .map((category) => category.name)
      .filter((name, index, names) => names.indexOf(name) !== index)
  };
}

async function loadRestaurant(slug) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    include: {
      locations: { orderBy: { createdAt: "asc" } },
      categories: { orderBy: { sortOrder: "asc" } },
      menuItems: {
        include: { category: true },
        orderBy: { name: "asc" }
      },
      posDevices: { orderBy: { updatedAt: "desc" } },
      posRegisters: true,
      cashDrawers: true,
      cashDrawerSessions: {
        where: { closedAt: null },
        orderBy: { openedAt: "desc" }
      },
      employeeShifts: {
        where: { status: "OPEN" },
        orderBy: { openedAt: "desc" }
      },
      users: {
        select: { id: true, email: true, role: true, status: true, restaurantId: true }
      },
      staff: {
        select: { id: true, userId: true, role: true, active: true }
      }
    }
  });
  if (!restaurant) return null;
  restaurant.__entitlement = await loadRestaurantEntitlements(restaurant.id);
  return restaurant;
}

async function duplicateSlugs() {
  const groups = await prisma.restaurant.groupBy({
    by: ["slug"],
    _count: { slug: true },
    having: { slug: { _count: { gt: 1 } } }
  });
  return groups.map((group) => ({ slug: group.slug, count: group._count.slug }));
}

async function main() {
  const [development, demo, duplicates] = await Promise.all([
    loadRestaurant(DEVELOPMENT_SLUG),
    loadRestaurant(DEMO_SLUG),
    duplicateSlugs()
  ]);

  const developmentSummary = summarizeRestaurant(development);
  const demoSummary = summarizeRestaurant(demo);
  const developmentOwner = development?.users.find((user) => ["TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN"].includes(user.role));

  const result = {
    checkedAt: new Date().toISOString(),
    routeSlug: DEVELOPMENT_SLUG,
    expectedTenant: developmentSummary?.name || null,
    expectedRestaurant: developmentSummary?.name || null,
    expectedLocation: development?.locations.find((location) => location.active)?.name || null,
    authenticatedUser: developmentOwner
      ? {
          id: developmentOwner.id,
          email: developmentOwner.email,
          role: developmentOwner.role,
          status: developmentOwner.status,
          restaurantId: developmentOwner.restaurantId
        }
      : null,
    developmentRestaurant: developmentSummary,
    demoBistro: demoSummary,
    mismatch: {
      developmentRouteResolvesDemoBistro: Boolean(development && demo && development.id === demo.id),
      duplicateSlugs: duplicates
    },
    menuIntegrity: development
      ? {
          orphanItemCount: countWhere(development.menuItems, (item) => item.category?.restaurantId !== development.id),
          unavailableItemCount: countWhere(development.menuItems, (item) => !item.available),
          categories: development.categories.map((category) => ({
            id: category.id,
            name: category.name,
            active: category.active,
            itemCount: countWhere(development.menuItems, (item) => item.categoryId === category.id),
            visibleItemCount: countWhere(development.menuItems, (item) => item.categoryId === category.id && item.available)
          }))
        }
      : null,
    devices: development
      ? development.posDevices.map((device) => ({
          id: device.id,
          name: device.name,
          type: device.deviceType,
          status: device.status,
          locationId: device.locationId,
          kioskModeEnabled: device.kioskModeEnabled,
          cashDrawerId: device.cashDrawerId,
          cardPaymentsEnabled: device.cardPaymentsEnabled
        }))
      : []
  };

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error("Development POS diagnosis failed.");
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
