import "dotenv/config";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEVELOPMENT_SLUG = process.env.DEVELOPMENT_POS_SLUG || "development-restaurant";
const REQUIRED_CLASSIFICATION = "INTERNAL_DEVELOPMENT";

function hashDeviceFingerprint(restaurantId, fingerprint) {
  return crypto.createHash("sha256").update(`${restaurantId}:${String(fingerprint).trim().toLowerCase()}`).digest("hex");
}

async function upsertCategory(tx, restaurantId, name, sortOrder) {
  const existing = await tx.menuCategory.findFirst({
    where: { restaurantId, name },
    select: { id: true }
  });
  if (existing) {
    return tx.menuCategory.update({
      where: { id: existing.id },
      data: { active: true, sortOrder }
    });
  }
  return tx.menuCategory.create({
    data: { restaurantId, name, sortOrder, active: true }
  });
}

async function upsertMenuItem(tx, restaurantId, categoryId, item) {
  const existing = await tx.menuItem.findFirst({
    where: { restaurantId, categoryId, name: item.name },
    select: { id: true }
  });
  const data = {
    restaurantId,
    categoryId,
    name: item.name,
    description: item.description,
    priceCents: item.priceCents,
    imageUrl: item.imageUrl,
    available: true,
    preparationTimeMins: item.preparationTimeMins,
    featured: Boolean(item.featured),
    recommended: Boolean(item.recommended),
    isVegetarian: Boolean(item.isVegetarian),
    isSpicy: Boolean(item.isSpicy)
  };
  return existing
    ? tx.menuItem.update({ where: { id: existing.id }, data })
    : tx.menuItem.create({ data });
}

async function main() {
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug: DEVELOPMENT_SLUG },
    include: {
      locations: { orderBy: { createdAt: "asc" } },
      users: { where: { role: { in: ["TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN"] } }, take: 5 }
    }
  });

  if (!restaurant) {
    throw new Error(`Development restaurant ${DEVELOPMENT_SLUG} was not found.`);
  }
  if (restaurant.tenantClassification !== REQUIRED_CLASSIFICATION) {
    throw new Error(`Refusing to modify ${DEVELOPMENT_SLUG}: tenantClassification must be ${REQUIRED_CLASSIFICATION}.`);
  }

  const owner = restaurant.users[0];
  if (!owner) {
    throw new Error(`Refusing to modify ${DEVELOPMENT_SLUG}: no active owner/admin user is attached.`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedRestaurant = await tx.restaurant.update({
      where: { id: restaurant.id },
      data: {
        status: "ACTIVE",
        pickupEnabled: true,
        deliveryEnabled: true,
        timezone: restaurant.timezone || "America/Denver",
        enabledModules: {
          set: [
            "RESTAURANT_ORDERING",
            "PICKUP",
            "DELIVERY",
            "DRIVER_MANAGEMENT",
            "LOYALTY",
            "COUPONS",
            "DELIVERY_ZONES",
            "FOOD_CATALOG",
            "POS_REGISTER",
            "POS_KIOSK_MODE"
          ]
        }
      },
      select: { id: true, slug: true, status: true }
    });

    const location = restaurant.locations[0]
      ? await tx.restaurantLocation.update({
          where: { id: restaurant.locations[0].id },
          data: {
            active: true,
            name: restaurant.locations[0].name || "Main Location",
            timezone: restaurant.locations[0].timezone || restaurant.timezone || "America/Denver"
          }
        })
      : await tx.restaurantLocation.create({
          data: {
            restaurantId: restaurant.id,
            name: "Main Location",
            address: restaurant.address,
            phone: restaurant.phone,
            timezone: restaurant.timezone || "America/Denver",
            active: true
          }
        });

    const categories = [];
    for (const [index, name] of ["Appetizers", "Entrees", "Drinks"].entries()) {
      categories.push(await upsertCategory(tx, restaurant.id, name, index + 1));
    }

    const [appetizers, entrees, drinks] = categories;
    const items = [
      await upsertMenuItem(tx, restaurant.id, appetizers.id, {
        name: "Garlic Naan Bites",
        description: "Warm naan bites with garlic butter and cilantro.",
        priceCents: 699,
        preparationTimeMins: 8,
        imageUrl: "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=900&q=80",
        featured: true,
        isVegetarian: true
      }),
      await upsertMenuItem(tx, restaurant.id, entrees.id, {
        name: "Tandoori Chicken Bowl",
        description: "Spiced chicken, basmati rice, cucumber salad, and mint chutney.",
        priceCents: 1499,
        preparationTimeMins: 15,
        imageUrl: "https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=900&q=80",
        featured: true,
        recommended: true,
        isSpicy: true
      }),
      await upsertMenuItem(tx, restaurant.id, entrees.id, {
        name: "Paneer Tikka Wrap",
        description: "Paneer, peppers, onions, and creamy masala sauce in a grilled wrap.",
        priceCents: 1299,
        preparationTimeMins: 12,
        imageUrl: "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?auto=format&fit=crop&w=900&q=80",
        recommended: true,
        isVegetarian: true
      }),
      await upsertMenuItem(tx, restaurant.id, drinks.id, {
        name: "Mango Lassi",
        description: "Chilled mango yogurt drink.",
        priceCents: 499,
        preparationTimeMins: 3,
        imageUrl: "https://images.unsplash.com/photo-1626201850129-a42c72f78fa3?auto=format&fit=crop&w=900&q=80",
        isVegetarian: true
      })
    ];

    const cashDrawer = await tx.cashDrawer.upsert({
      where: { id: `dev-cash-${restaurant.id}` },
      update: {
        locationId: location.id,
        name: "Development Cash Drawer",
        status: "OPEN",
        currentBalanceCents: 10000,
        active: true
      },
      create: {
        id: `dev-cash-${restaurant.id}`,
        restaurantId: restaurant.id,
        locationId: location.id,
        name: "Development Cash Drawer",
        status: "OPEN",
        currentBalanceCents: 10000,
        active: true
      }
    });

    const fingerprintHash = hashDeviceFingerprint(restaurant.id, "development-browser-main-terminal");
    const existingDevice = await tx.posDevice.findFirst({
      where: { restaurantId: restaurant.id, deviceFingerprintHash: fingerprintHash },
      select: { id: true }
    });
    const deviceData = {
      restaurantId: restaurant.id,
      locationId: location.id,
      name: "Development Main Terminal",
      deviceType: "MAIN_TERMINAL",
      deviceFingerprintHash: fingerprintHash,
      status: "ACTIVE",
      kioskModeEnabled: true,
      cashDrawerId: cashDrawer.id,
      cardPaymentsEnabled: true,
      registeredByUserId: owner.id,
      lastSeenAt: new Date(),
      settingsJson: { internalDevelopment: true }
    };
    const device = existingDevice
      ? await tx.posDevice.update({ where: { id: existingDevice.id }, data: deviceData })
      : await tx.posDevice.create({ data: deviceData });

    const register = await tx.posRegister.upsert({
      where: { deviceId: device.id },
      update: {
        restaurantId: restaurant.id,
        locationId: location.id,
        cashDrawerId: cashDrawer.id,
        name: "Development Register",
        active: true
      },
      create: {
        restaurantId: restaurant.id,
        locationId: location.id,
        deviceId: device.id,
        cashDrawerId: cashDrawer.id,
        name: "Development Register",
        active: true
      }
    });

    const revokedOrphanDevices = await tx.posDevice.updateMany({
      where: {
        restaurantId: restaurant.id,
        id: { not: device.id },
        status: "ACTIVE",
        locationId: null,
        cashDrawerId: null
      },
      data: {
        status: "REVOKED",
        revokedAt: new Date()
      }
    });

    const existingShift = await tx.employeeShift.findFirst({
      where: {
        restaurantId: restaurant.id,
        employeeUserId: owner.id,
        deviceId: device.id,
        status: "OPEN"
      },
      orderBy: { openedAt: "desc" }
    });
    const shift = existingShift
      ? await tx.employeeShift.update({
          where: { id: existingShift.id },
          data: {
            locationId: location.id,
            registerId: register.id,
            cashDrawerId: cashDrawer.id,
            openingCashCents: existingShift.openingCashCents || 10000
          }
        })
      : await tx.employeeShift.create({
          data: {
            restaurantId: restaurant.id,
            locationId: location.id,
            employeeUserId: owner.id,
            deviceId: device.id,
            registerId: register.id,
            cashDrawerId: cashDrawer.id,
            status: "OPEN",
            openingCashCents: 10000
          }
        });

    const existingDrawerSession = await tx.cashDrawerSession.findFirst({
      where: {
        restaurantId: restaurant.id,
        cashDrawerId: cashDrawer.id,
        shiftId: shift.id,
        closedAt: null
      },
      orderBy: { openedAt: "desc" }
    });
    const drawerSession = existingDrawerSession
      ? await tx.cashDrawerSession.update({
          where: { id: existingDrawerSession.id },
          data: {
            locationId: location.id,
            openedByUserId: owner.id,
            openingCashCents: existingDrawerSession.openingCashCents || 10000
          }
        })
      : await tx.cashDrawerSession.create({
          data: {
            restaurantId: restaurant.id,
            locationId: location.id,
            cashDrawerId: cashDrawer.id,
            shiftId: shift.id,
            openedByUserId: owner.id,
            openingCashCents: 10000
          }
        });

    await tx.taxConfiguration.upsert({
      where: { restaurantId_provider: { restaurantId: restaurant.id, provider: "manual" } },
      update: { enabled: true, taxRateBps: 825, taxInclusive: false },
      create: { restaurantId: restaurant.id, provider: "manual", enabled: true, taxRateBps: 825, taxInclusive: false }
    });

    await tx.restaurantStaff.upsert({
      where: { userId: owner.id },
      update: {
        restaurantId: restaurant.id,
        active: true,
        role: owner.role
      },
      create: {
        restaurantId: restaurant.id,
        userId: owner.id,
        role: owner.role,
        active: true
      }
    });

    await tx.auditLog.create({
      data: {
        restaurantId: restaurant.id,
        actorUserId: owner.id,
        action: "development.pos_fixture.updated",
        entityType: "Restaurant",
        entityId: restaurant.id,
        metadataJson: {
          source: "setup-development-pos",
          billingChanged: false,
          subscriptionChanged: false,
          paymentChanged: false,
          itemCount: items.length,
          locationId: location.id,
          deviceId: device.id,
          registerId: register.id,
          shiftId: shift.id,
          cashDrawerId: cashDrawer.id,
          cashDrawerSessionId: drawerSession.id,
          revokedOrphanDeviceCount: revokedOrphanDevices.count
        }
      }
    });

    return {
      restaurant: updatedRestaurant,
      location,
      categoryCount: categories.length,
      itemCount: items.length,
      device,
      register,
      cashDrawer,
      shift,
      drawerSession,
      revokedOrphanDeviceCount: revokedOrphanDevices.count
    };
  });

  console.log(JSON.stringify({
    ok: true,
    slug: DEVELOPMENT_SLUG,
    restaurantId: result.restaurant.id,
    restaurantStatus: result.restaurant.status,
    locationId: result.location.id,
    locationActive: result.location.active,
    categoryCount: result.categoryCount,
    itemCount: result.itemCount,
    deviceId: result.device.id,
    deviceStatus: result.device.status,
    kioskModeEnabled: result.device.kioskModeEnabled,
    registerId: result.register.id,
    cashDrawerId: result.cashDrawer.id,
    cashDrawerStatus: result.cashDrawer.status,
    shiftId: result.shift.id,
    shiftStatus: result.shift.status,
    cashDrawerSessionId: result.drawerSession.id,
    revokedOrphanDeviceCount: result.revokedOrphanDeviceCount,
    billingChanged: false,
    subscriptionChanged: false,
    paymentChanged: false
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("Development POS setup failed.");
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
