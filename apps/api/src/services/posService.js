import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "../config/prisma.js";
import { FEATURE } from "../config/entitlements.js";
import { assertFeatureForRestaurant } from "../middleware/entitlements.js";
import { recordAudit } from "./auditService.js";

export const POS_PERMISSION = {
  ACCESS: "POS_ACCESS",
  CREATE_ORDER: "POS_CREATE_ORDER",
  EDIT_ORDER: "POS_EDIT_ORDER",
  HOLD_ORDER: "POS_HOLD_ORDER",
  RECALL_ORDER: "POS_RECALL_ORDER",
  SEND_TO_KITCHEN: "POS_SEND_TO_KITCHEN",
  ACCEPT_CASH: "POS_ACCEPT_CASH",
  ACCEPT_CARD: "POS_ACCEPT_CARD",
  MANAGE_DEVICES: "POS_MANAGE_DEVICES",
  MANAGE_KIOSK: "POS_MANAGE_KIOSK",
  EXIT_KIOSK: "POS_EXIT_KIOSK",
  PRINT_RECEIPT: "POS_PRINT_RECEIPT",
  VIEW_REPORTS: "POS_VIEW_REPORTS",
  MANAGE_SHIFTS: "POS_MANAGE_SHIFTS",
  OPEN_CASH_DRAWER: "POS_OPEN_CASH_DRAWER",
  CLOSE_CASH_DRAWER: "POS_CLOSE_CASH_DRAWER"
};

const ALL_POS_PERMISSIONS = Object.values(POS_PERMISSION);

const ROLE_PERMISSIONS = {
  TENANT_OWNER: ALL_POS_PERMISSIONS,
  RESTAURANT_OWNER: ALL_POS_PERMISSIONS,
  RESTAURANT_ADMIN: ALL_POS_PERMISSIONS,
  RESTAURANT_MANAGER: ALL_POS_PERMISSIONS,
  CASHIER: [
    POS_PERMISSION.ACCESS,
    POS_PERMISSION.CREATE_ORDER,
    POS_PERMISSION.EDIT_ORDER,
    POS_PERMISSION.HOLD_ORDER,
    POS_PERMISSION.RECALL_ORDER,
    POS_PERMISSION.SEND_TO_KITCHEN,
    POS_PERMISSION.ACCEPT_CASH,
    POS_PERMISSION.ACCEPT_CARD,
    POS_PERMISSION.PRINT_RECEIPT,
    POS_PERMISSION.MANAGE_SHIFTS,
    POS_PERMISSION.OPEN_CASH_DRAWER,
    POS_PERMISSION.CLOSE_CASH_DRAWER
  ],
  KITCHEN_STAFF: [],
  DRIVER: [],
  CUSTOMER: [],
  SUPER_ADMIN: []
};

const ORDER_TYPES = new Set(["PICKUP", "DELIVERY", "DINE_IN", "WALK_IN"]);
const ACTIVE_RESTAURANT_STATUSES = new Set(["ACTIVE"]);
const POS_ROLES = new Set(["TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_MANAGER", "CASHIER"]);

export function httpError(message, status = 400, details = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, details);
  return error;
}

function cents(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function safeJson(value, fallback) {
  return value && typeof value === "object" ? value : fallback;
}

export function hashDeviceFingerprint(restaurantId, fingerprint = "") {
  const normalized = String(fingerprint || "").trim().toLowerCase();
  if (!normalized) return null;
  return crypto.createHash("sha256").update(`${restaurantId}:${normalized}`).digest("hex");
}

function randomReceiptNumber(prefix = "R") {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}

export async function resolveRestaurantForPos(identifier, user) {
  if (!identifier) throw httpError("Restaurant slug or id is required.", 400);
  const restaurant = await prisma.restaurant.findFirst({
    where: { OR: [{ id: identifier }, { slug: identifier }] },
    include: {
      locations: { where: { active: true }, orderBy: { createdAt: "asc" } },
      merchantAccounts: true
    }
  });
  if (!restaurant) throw httpError("Restaurant not found.", 404);
  if (!ACTIVE_RESTAURANT_STATUSES.has(restaurant.status)) throw httpError("Restaurant is not active.", 403);
  if (user?.role === "SUPER_ADMIN") throw httpError("Super admin cannot operate a tenant POS register.", 403);
  if (!POS_ROLES.has(user?.role)) throw httpError("POS access is limited to restaurant staff.", 403);
  if (!user?.restaurantId || user.restaurantId !== restaurant.id) throw httpError("Tenant access denied.", 403);
  return restaurant;
}

export async function assertPosFeature(restaurantId, method = "GET") {
  return assertFeatureForRestaurant({ restaurantId, feature: FEATURE.POS_REGISTER, method });
}

export async function getUserPosPermissions(user, restaurantId) {
  const base = new Set(ROLE_PERMISSIONS[user?.role] || []);
  const staffProfile = await prisma.restaurantStaff.findFirst({
    where: { restaurantId, userId: user?.id, active: true },
    select: { permissionsJson: true }
  });
  const staffPermissions = Array.isArray(staffProfile?.permissionsJson) ? staffProfile.permissionsJson : [];
  for (const permission of staffPermissions) {
    if (ALL_POS_PERMISSIONS.includes(permission)) base.add(permission);
  }
  return [...base];
}

export async function assertPosPermission(user, restaurantId, permission) {
  const permissions = await getUserPosPermissions(user, restaurantId);
  if (!permissions.includes(permission)) {
    throw httpError("Insufficient POS permission.", 403, { code: "POS_PERMISSION_DENIED", permission });
  }
  return permissions;
}

export async function touchDevice({ restaurantId, deviceId, fingerprint }) {
  const fingerprintHash = hashDeviceFingerprint(restaurantId, fingerprint);
  if (!deviceId && !fingerprintHash) return null;
  const where = deviceId
    ? { id: deviceId, restaurantId }
    : { restaurantId, deviceFingerprintHash: fingerprintHash };
  const device = await prisma.posDevice.findFirst({ where });
  if (!device) return null;
  return prisma.posDevice.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date() }
  });
}

export async function requireActiveDevice({ restaurantId, deviceId, fingerprint }) {
  const device = await touchDevice({ restaurantId, deviceId, fingerprint });
  if (!device) throw httpError("Active POS device is required for this action.", 403, { code: "POS_DEVICE_REQUIRED" });
  if (device.status !== "ACTIVE") throw httpError("POS device is not active.", 403, { code: "POS_DEVICE_INACTIVE" });
  return device;
}

export async function currentShift({ restaurantId, userId, deviceId = null }) {
  return prisma.employeeShift.findFirst({
    where: {
      restaurantId,
      employeeUserId: userId,
      status: "OPEN",
      ...(deviceId ? { deviceId } : {})
    },
    include: { cashDrawer: true, register: true, device: true },
    orderBy: { openedAt: "desc" }
  });
}

export async function requireOpenShift({ restaurantId, userId, deviceId = null }) {
  const shift = await currentShift({ restaurantId, userId, deviceId });
  if (!shift) throw httpError("Open POS shift is required.", 403, { code: "POS_SHIFT_REQUIRED" });
  return shift;
}

export async function requireCashRegisterAccess({ restaurantId, user, deviceId, fingerprint }) {
  await assertPosPermission(user, restaurantId, POS_PERMISSION.ACCEPT_CASH);
  const device = await requireActiveDevice({ restaurantId, deviceId, fingerprint });
  if (device.deviceType !== "MAIN_TERMINAL") {
    throw httpError("Cash payments are only allowed from a main terminal.", 403, { code: "POS_CASH_MAIN_TERMINAL_REQUIRED" });
  }
  const shift = await requireOpenShift({ restaurantId, userId: user.id, deviceId: device.id });
  if (!shift.cashDrawerId || !shift.cashDrawer || shift.cashDrawer.status !== "OPEN") {
    throw httpError("Open cash drawer is required for cash payments.", 403, { code: "POS_CASH_DRAWER_REQUIRED" });
  }
  if (device.cashDrawerId && device.cashDrawerId !== shift.cashDrawerId) {
    throw httpError("Cash drawer does not match this terminal.", 403, { code: "POS_CASH_DRAWER_MISMATCH" });
  }
  return { device, shift, cashDrawer: shift.cashDrawer };
}

export async function posConfig({ restaurant, user, deviceId, fingerprint }) {
  await assertPosFeature(restaurant.id, "GET");
  const permissions = await getUserPosPermissions(user, restaurant.id);
  if (!permissions.includes(POS_PERMISSION.ACCESS)) throw httpError("POS access denied.", 403);
  const device = await touchDevice({ restaurantId: restaurant.id, deviceId, fingerprint });
  const shift = await currentShift({ restaurantId: restaurant.id, userId: user.id, deviceId: device?.id || null });
  const [cashDrawers, registers, devices] = await Promise.all([
    prisma.cashDrawer.findMany({ where: { restaurantId: restaurant.id, active: true }, orderBy: { createdAt: "asc" } }),
    prisma.posRegister.findMany({ where: { restaurantId: restaurant.id, active: true }, orderBy: { createdAt: "asc" } }),
    prisma.posDevice.findMany({ where: { restaurantId: restaurant.id }, orderBy: { updatedAt: "desc" }, take: 25 })
  ]);
  return {
    restaurant: {
      id: restaurant.id,
      slug: restaurant.slug,
      name: restaurant.businessName || restaurant.name,
      timezone: restaurant.timezone
    },
    locations: restaurant.locations,
    permissions,
    device,
    shift,
    cashDrawers,
    registers,
    devices
  };
}

export async function posMenu(restaurantId) {
  return prisma.menuCategory.findMany({
    where: { restaurantId, active: true },
    include: {
      items: {
        where: { available: true },
        include: { options: true, optionGroups: { include: { options: true }, orderBy: { sortOrder: "asc" } },
        },
        orderBy: { name: "asc" }
      }
    },
    orderBy: { name: "asc" }
  });
}

async function taxRateBps(restaurantId) {
  const config = await prisma.taxConfiguration.findFirst({
    where: { restaurantId, enabled: true },
    orderBy: { updatedAt: "desc" },
    select: { taxRateBps: true }
  });
  return config?.taxRateBps ?? 825;
}

export async function createPosQuote({ restaurantId, user, body, deviceId = null, sessionId = null }) {
  await assertPosFeature(restaurantId, "POST");
  await assertPosPermission(user, restaurantId, POS_PERMISSION.CREATE_ORDER);
  const orderType = ORDER_TYPES.has(body?.orderType) ? body.orderType : "WALK_IN";
  const rawItems = Array.isArray(body?.lineItems) ? body.lineItems : [];
  if (!rawItems.length) throw httpError("At least one menu item is required.", 400);

  const itemIds = [...new Set(rawItems.map((line) => String(line.menuItemId || "")).filter(Boolean))];
  const menuItems = await prisma.menuItem.findMany({
    where: { restaurantId, id: { in: itemIds }, available: true },
    include: { options: true }
  });
  const menuById = new Map(menuItems.map((item) => [item.id, item]));

  const normalizedItems = rawItems.map((line) => {
    const menuItem = menuById.get(String(line.menuItemId || ""));
    if (!menuItem) throw httpError("Menu item is unavailable for this restaurant.", 400);
    const quantity = Math.min(99, Math.max(1, Number.parseInt(line.quantity, 10) || 1));
    const optionIds = Array.isArray(line.optionIds) ? line.optionIds.map(String) : [];
    const selectedOptions = optionIds.map((optionId) => {
      const option = menuItem.options.find((candidate) => candidate.id === optionId);
      if (!option) throw httpError("Menu item option is invalid for this item.", 400);
      return { id: option.id, name: option.name, priceCents: option.priceCents };
    });
    const unitPriceCents = menuItem.priceCents + selectedOptions.reduce((sum, option) => sum + option.priceCents, 0);
    return {
      menuItemId: menuItem.id,
      name: menuItem.name,
      quantity,
      unitPriceCents,
      basePriceCents: menuItem.priceCents,
      options: selectedOptions,
      specialInstructions: String(line.specialInstructions || "").slice(0, 500),
      lineTotalCents: unitPriceCents * quantity
    };
  });

  const subtotalCents = normalizedItems.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const discountCents = cents(body?.discountCents);
  const deliveryFeeCents = orderType === "DELIVERY" ? cents(body?.deliveryFeeCents) : 0;
  const tipCents = cents(body?.tipCents);
  const taxableAmountCents = Math.max(0, subtotalCents - discountCents);
  const taxCents = Math.round((taxableAmountCents * await taxRateBps(restaurantId)) / 10_000);
  const totalCents = Math.max(0, taxableAmountCents + deliveryFeeCents + taxCents + tipCents);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const quote = await prisma.orderQuote.create({
    data: {
      restaurantId,
      locationId: body?.locationId || null,
      deviceId,
      sessionId,
      createdByUserId: user.id,
      orderType,
      lineItemsJson: normalizedItems,
      subtotalCents,
      discountCents,
      deliveryFeeCents,
      taxCents,
      tipCents,
      totalCents,
      expiresAt
    }
  });
  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: "pos.quote.created",
    entityType: "OrderQuote",
    entityId: quote.id,
    metadata: { orderType, totalCents }
  });
  return quote;
}

async function ensurePosCustomer(tx, restaurantId, quoteId, customerJson = {}) {
  const customer = safeJson(customerJson, {});
  const email = String(customer.email || `pos-${quoteId}@guest.loohar.local`).trim().toLowerCase();
  const existing = await tx.customer.findFirst({ where: { restaurantId, email } });
  if (existing) return existing;
  return tx.customer.create({
    data: {
      restaurantId,
      name: String(customer.name || "Walk-in guest").trim() || "Walk-in guest",
      email,
      phone: customer.phone ? String(customer.phone).slice(0, 40) : null,
      defaultAddress: customer.deliveryAddress ? String(customer.deliveryAddress).slice(0, 500) : null
    }
  });
}

function receiptPayload({ order, quote, payment = null }) {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    type: order.type,
    status: order.status,
    paymentStatus: payment?.status || "PENDING",
    items: quote.lineItemsJson,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    deliveryFeeCents: order.deliveryFeeCents,
    taxCents: order.taxCents,
    tipCents: order.tipCents,
    totalCents: order.totalCents,
    createdAt: order.createdAt
  };
}

async function nextOrderNumber(tx, restaurantId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = `${Date.now().toString(36).toUpperCase()}${attempt || ""}`;
    const orderNumber = `POS-${suffix}`;
    const existing = await tx.order.findFirst({ where: { restaurantId, orderNumber }, select: { id: true } });
    if (!existing) return orderNumber;
  }
  throw httpError("Unable to generate POS order number.", 500);
}

export async function submitPosOrder({ restaurantId, user, quoteId, sessionId = null, customerJson = {}, notes = "", deviceId = null }) {
  await assertPosFeature(restaurantId, "POST");
  await assertPosPermission(user, restaurantId, POS_PERMISSION.SEND_TO_KITCHEN);
  const quote = await prisma.orderQuote.findFirst({ where: { id: quoteId, restaurantId } });
  if (!quote || quote.voidedAt) throw httpError("POS quote not found.", 404);
  if (quote.expiresAt < new Date()) throw httpError("POS quote expired. Recalculate the cart.", 409);
  if (quote.acceptedAt) throw httpError("POS quote has already been submitted.", 409);

  const result = await prisma.$transaction(async (tx) => {
    const customer = await ensurePosCustomer(tx, restaurantId, quote.id, customerJson);
    const orderNumber = await nextOrderNumber(tx, restaurantId);
    const order = await tx.order.create({
      data: {
        restaurantId,
        customerId: customer.id,
        orderNumber,
        type: quote.orderType,
        status: "PENDING",
        subtotalCents: quote.subtotalCents,
        discountCents: quote.discountCents,
        deliveryFeeCents: quote.deliveryFeeCents,
        taxCents: quote.taxCents,
        tipCents: quote.tipCents,
        restaurantTipCents: quote.tipCents,
        totalCents: quote.totalCents,
        deliveryAddress: customerJson?.deliveryAddress || null,
        notes: String(notes || customerJson?.notes || "").slice(0, 1000),
        items: {
          create: quote.lineItemsJson.map((line) => ({
            menuItemId: line.menuItemId,
            name: line.name,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            optionsJson: { options: line.options || [], specialInstructions: line.specialInstructions || "" }
          }))
        },
        statusHistory: {
          create: {
            status: "PENDING",
            note: "Submitted from POS register",
            changedBy: user.id
          }
        }
      },
      include: { items: true }
    });
    await tx.orderQuote.update({ where: { id: quote.id }, data: { acceptedAt: new Date() } });
    if (sessionId) {
      await tx.posOrderSession.updateMany({
        where: { id: sessionId, restaurantId },
        data: { status: "SUBMITTED", orderId: order.id, submittedAt: new Date(), updatedByUserId: user.id }
      });
    }
    const receipt = await tx.posReceipt.create({
      data: {
        restaurantId,
        locationId: quote.locationId,
        deviceId,
        sessionId,
        orderId: order.id,
        receiptNumber: randomReceiptNumber("POS"),
        kind: "KITCHEN_TICKET",
        payloadJson: receiptPayload({ order, quote }),
        createdByUserId: user.id
      }
    });
    return { order, receipt };
  });

  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: "pos.order.submitted",
    entityType: "Order",
    entityId: result.order.id,
    metadata: { quoteId, sessionId, totalCents: quote.totalCents }
  });
  return result;
}

export async function holdPosOrder({ restaurantId, user, body, deviceId = null }) {
  await assertPosFeature(restaurantId, "POST");
  await assertPosPermission(user, restaurantId, POS_PERMISSION.HOLD_ORDER);
  const session = await prisma.posOrderSession.create({
    data: {
      restaurantId,
      locationId: body?.locationId || null,
      deviceId,
      shiftId: body?.shiftId || null,
      name: String(body?.name || "Held order").slice(0, 120),
      status: "HELD",
      orderType: ORDER_TYPES.has(body?.orderType) ? body.orderType : "WALK_IN",
      cartJson: safeJson(body?.cart, { lineItems: [] }),
      customerJson: safeJson(body?.customer, {}),
      heldAt: new Date(),
      createdByUserId: user.id
    }
  });
  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: "pos.order.held",
    entityType: "PosOrderSession",
    entityId: session.id,
    metadata: { name: session.name }
  });
  return session;
}

export async function cashPayment({ restaurantId, user, orderId, deviceId, fingerprint, amountCents = null }) {
  await assertPosFeature(restaurantId, "POST");
  const { device, shift, cashDrawer } = await requireCashRegisterAccess({ restaurantId, user, deviceId, fingerprint });
  const order = await prisma.order.findFirst({ where: { id: orderId, restaurantId } });
  if (!order) throw httpError("Order not found.", 404);
  const paidAmount = amountCents === null ? order.totalCents : cents(amountCents);
  if (paidAmount < order.totalCents) throw httpError("Cash payment must cover the order total.", 400);

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.upsert({
      where: { orderId: order.id },
      update: {
        provider: "manual_cash",
        status: "PAID",
        amountCents: order.totalCents,
        restaurantNetCents: order.totalCents,
        driverTipCents: order.driverTipCents,
        paidAt: new Date()
      },
      create: {
        orderId: order.id,
        provider: "manual_cash",
        status: "PAID",
        amountCents: order.totalCents,
        restaurantNetCents: order.totalCents,
        driverTipCents: order.driverTipCents,
        paidAt: new Date()
      }
    });
    const orderPayment = await tx.restaurantOrderPayment.upsert({
      where: { orderId: order.id },
      update: {
        provider: "MANUAL",
        status: "PAID",
        paidAt: new Date(),
        totalCents: order.totalCents,
        restaurantGrossCents: order.totalCents,
        restaurantNetCents: order.totalCents,
        restaurantTipCents: order.restaurantTipCents,
        driverTipCents: order.driverTipCents
      },
      create: {
        restaurantId,
        orderId: order.id,
        provider: "MANUAL",
        status: "PAID",
        subtotalCents: order.subtotalCents,
        discountCents: order.discountCents,
        taxableAmountCents: Math.max(0, order.subtotalCents - order.discountCents),
        taxCents: order.taxCents,
        deliveryFeeCents: order.deliveryFeeCents,
        restaurantTipCents: order.restaurantTipCents,
        driverTipCents: order.driverTipCents,
        totalCents: order.totalCents,
        restaurantGrossCents: order.totalCents,
        restaurantNetCents: order.totalCents,
        paidAt: new Date()
      }
    });
    const ledger = await tx.cashLedgerEntry.create({
      data: {
        restaurantId,
        locationId: shift.locationId,
        cashDrawerId: cashDrawer.id,
        shiftId: shift.id,
        orderId: order.id,
        paymentId: payment.id,
        actorUserId: user.id,
        amountCents: order.totalCents,
        entryType: "SALE_CASH",
        note: `Cash payment for ${order.orderNumber}`
      }
    });
    await tx.cashDrawer.update({
      where: { id: cashDrawer.id },
      data: { currentBalanceCents: { increment: order.totalCents } }
    });
    const receipt = await tx.posReceipt.create({
      data: {
        restaurantId,
        locationId: shift.locationId,
        deviceId: device.id,
        orderId: order.id,
        receiptNumber: randomReceiptNumber("CASH"),
        kind: "CUSTOMER_RECEIPT",
        payloadJson: receiptPayload({ order, quote: { lineItemsJson: [] }, payment }),
        createdByUserId: user.id
      }
    });
    return { payment, orderPayment, ledger, receipt };
  });

  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: "pos.payment.cash.accepted",
    entityType: "Payment",
    entityId: result.payment.id,
    metadata: { orderId: order.id, deviceId: device.id, cashDrawerId: cashDrawer.id }
  });
  return result;
}

export async function cardPaymentIntent({ restaurantId, user, orderId, deviceId, fingerprint }) {
  await assertPosFeature(restaurantId, "POST");
  await assertPosPermission(user, restaurantId, POS_PERMISSION.ACCEPT_CARD);
  const device = await requireActiveDevice({ restaurantId, deviceId, fingerprint });
  if (!device.cardPaymentsEnabled) throw httpError("Card payments are not enabled for this device.", 403, { code: "POS_CARD_DEVICE_DISABLED" });
  const order = await prisma.order.findFirst({ where: { id: orderId, restaurantId } });
  if (!order) throw httpError("Order not found.", 404);
  const merchant = await prisma.restaurantMerchantAccount.findFirst({
    where: { restaurantId, provider: "STRIPE_CONNECT" }
  });
  if (!merchant?.stripeChargesEnabled || merchant.status !== "ENABLED") {
    throw httpError("Restaurant payment account is not ready for card payments.", 409, { code: "POS_CARD_MERCHANT_NOT_READY" });
  }
  const orderPayment = await prisma.restaurantOrderPayment.upsert({
    where: { orderId: order.id },
    update: {
      provider: "STRIPE_CONNECT",
      status: "REQUIRES_PAYMENT_METHOD",
      totalCents: order.totalCents,
      restaurantGrossCents: order.totalCents,
      restaurantNetCents: order.totalCents,
      quoteJson: { source: "POS", deviceId: device.id }
    },
    create: {
      restaurantId,
      orderId: order.id,
      provider: "STRIPE_CONNECT",
      status: "REQUIRES_PAYMENT_METHOD",
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      taxableAmountCents: Math.max(0, order.subtotalCents - order.discountCents),
      taxCents: order.taxCents,
      deliveryFeeCents: order.deliveryFeeCents,
      restaurantTipCents: order.restaurantTipCents,
      driverTipCents: order.driverTipCents,
      totalCents: order.totalCents,
      restaurantGrossCents: order.totalCents,
      restaurantNetCents: order.totalCents,
      quoteJson: { source: "POS", deviceId: device.id }
    }
  });
  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: "pos.payment.card.requested",
    entityType: "RestaurantOrderPayment",
    entityId: orderPayment.id,
    metadata: { orderId: order.id, deviceId: device.id }
  });
  return {
    orderPayment,
    requiresHostedPayment: true,
    message: "Card collection must use a PCI-compliant hosted payment flow. Raw card numbers are never accepted by Loohar."
  };
}

export async function registerPosDevice({ restaurantId, user, body, fingerprint }) {
  await assertPosFeature(restaurantId, "POST");
  await assertPosPermission(user, restaurantId, POS_PERMISSION.MANAGE_DEVICES);
  const fingerprintHash = hashDeviceFingerprint(restaurantId, fingerprint || body?.fingerprint);
  if (!fingerprintHash) throw httpError("Device fingerprint is required.", 400);
  const data = {
    restaurantId,
    locationId: body?.locationId || null,
    name: String(body?.name || "POS device").slice(0, 120),
    deviceType: body?.deviceType || "POS_KIOSK",
    deviceFingerprintHash: fingerprintHash,
    status: body?.status || "ACTIVE",
    cardPaymentsEnabled: Boolean(body?.cardPaymentsEnabled),
    cashDrawerId: body?.cashDrawerId || null,
    registeredByUserId: user.id,
    lastSeenAt: new Date(),
    settingsJson: safeJson(body?.settings, {})
  };
  const existing = await prisma.posDevice.findFirst({ where: { restaurantId, deviceFingerprintHash: fingerprintHash } });
  const device = existing
    ? await prisma.posDevice.update({ where: { id: existing.id }, data })
    : await prisma.posDevice.create({ data });
  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: "pos.device.registered",
    entityType: "PosDevice",
    entityId: device.id,
    metadata: { deviceType: device.deviceType, status: device.status }
  });
  return device;
}

export async function updatePosDevice({ restaurantId, user, deviceId, body }) {
  await assertPosFeature(restaurantId, "PATCH");
  await assertPosPermission(user, restaurantId, POS_PERMISSION.MANAGE_DEVICES);
  const device = await prisma.posDevice.findFirst({ where: { id: deviceId, restaurantId } });
  if (!device) throw httpError("POS device not found.", 404);
  const updated = await prisma.posDevice.update({
    where: { id: device.id },
    data: {
      name: body?.name ? String(body.name).slice(0, 120) : undefined,
      deviceType: body?.deviceType || undefined,
      status: body?.status || undefined,
      locationId: body?.locationId === undefined ? undefined : body.locationId || null,
      cashDrawerId: body?.cashDrawerId === undefined ? undefined : body.cashDrawerId || null,
      cardPaymentsEnabled: body?.cardPaymentsEnabled === undefined ? undefined : Boolean(body.cardPaymentsEnabled),
      revokedAt: body?.status === "REVOKED" ? new Date() : undefined
    }
  });
  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: "pos.device.updated",
    entityType: "PosDevice",
    entityId: updated.id,
    metadata: { status: updated.status, deviceType: updated.deviceType }
  });
  return updated;
}

export async function setKioskMode({ restaurantId, user, deviceId, enabled, exitPin }) {
  await assertPosFeature(restaurantId, "PATCH");
  await assertPosPermission(user, restaurantId, POS_PERMISSION.MANAGE_KIOSK);
  await assertFeatureForRestaurant({ restaurantId, feature: FEATURE.POS_KIOSK_MODE, method: "PATCH" });
  const device = await prisma.posDevice.findFirst({ where: { id: deviceId, restaurantId } });
  if (!device) throw httpError("POS device not found.", 404);
  const kioskExitPinHash = exitPin ? await bcrypt.hash(String(exitPin), 12) : undefined;
  const updated = await prisma.posDevice.update({
    where: { id: device.id },
    data: {
      kioskModeEnabled: Boolean(enabled),
      kioskExitPinHash,
      kioskExitPinUpdatedAt: kioskExitPinHash ? new Date() : undefined
    }
  });
  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: enabled ? "pos.kiosk.enabled" : "pos.kiosk.disabled",
    entityType: "PosDevice",
    entityId: device.id,
    metadata: {}
  });
  return updated;
}

export async function exitKioskMode({ restaurantId, user, deviceId, pin }) {
  await assertPosFeature(restaurantId, "PATCH");
  const device = await prisma.posDevice.findFirst({ where: { id: deviceId, restaurantId } });
  if (!device) throw httpError("POS device not found.", 404);
  const permissions = await getUserPosPermissions(user, restaurantId);
  const canExitByRole = permissions.includes(POS_PERMISSION.EXIT_KIOSK);
  const canExitByPin = device.kioskExitPinHash && pin
    ? await bcrypt.compare(String(pin), device.kioskExitPinHash)
    : false;
  if (!canExitByRole && !canExitByPin) {
    await recordAudit({
      actorUserId: user.id,
      restaurantId,
      action: "pos.kiosk.exit.denied",
      entityType: "PosDevice",
      entityId: device.id,
      metadata: {}
    });
    throw httpError("Kiosk exit requires manager permission or a valid PIN.", 403, { code: "POS_KIOSK_EXIT_DENIED" });
  }
  const updated = await prisma.posDevice.update({
    where: { id: device.id },
    data: { kioskModeEnabled: false }
  });
  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: "pos.kiosk.exited",
    entityType: "PosDevice",
    entityId: device.id,
    metadata: { via: canExitByRole ? "permission" : "pin" }
  });
  return updated;
}

export async function openShift({ restaurantId, user, body, deviceId = null }) {
  await assertPosFeature(restaurantId, "POST");
  await assertPosPermission(user, restaurantId, POS_PERMISSION.MANAGE_SHIFTS);
  const existing = await currentShift({ restaurantId, userId: user.id, deviceId });
  if (existing) return existing;
  const shift = await prisma.$transaction(async (tx) => {
    const created = await tx.employeeShift.create({
      data: {
        restaurantId,
        locationId: body?.locationId || null,
        employeeUserId: user.id,
        deviceId,
        registerId: body?.registerId || null,
        cashDrawerId: body?.cashDrawerId || null,
        openingCashCents: cents(body?.openingCashCents)
      }
    });
    if (body?.cashDrawerId) {
      await tx.cashDrawer.update({
        where: { id: body.cashDrawerId },
        data: { status: "OPEN", currentBalanceCents: cents(body?.openingCashCents) }
      });
      await tx.cashDrawerSession.create({
        data: {
          restaurantId,
          locationId: body?.locationId || null,
          cashDrawerId: body.cashDrawerId,
          shiftId: created.id,
          openedByUserId: user.id,
          openingCashCents: cents(body?.openingCashCents)
        }
      });
    }
    return created;
  });
  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: "pos.shift.opened",
    entityType: "EmployeeShift",
    entityId: shift.id,
    metadata: { deviceId, cashDrawerId: body?.cashDrawerId || null }
  });
  return shift;
}

export async function closeShift({ restaurantId, user, shiftId, body }) {
  await assertPosFeature(restaurantId, "PATCH");
  const shift = await prisma.employeeShift.findFirst({ where: { id: shiftId, restaurantId } });
  if (!shift) throw httpError("POS shift not found.", 404);
  if (shift.employeeUserId !== user.id) await assertPosPermission(user, restaurantId, POS_PERMISSION.MANAGE_SHIFTS);
  const closingCashCents = cents(body?.closingCashCents);
  const updated = await prisma.$transaction(async (tx) => {
    const closed = await tx.employeeShift.update({
      where: { id: shift.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closingCashCents,
        discrepancyCents: shift.cashDrawerId ? closingCashCents - shift.openingCashCents : null,
        notes: body?.notes ? String(body.notes).slice(0, 500) : null
      }
    });
    if (shift.cashDrawerId) {
      await tx.cashDrawer.update({
        where: { id: shift.cashDrawerId },
        data: { status: "CLOSED", currentBalanceCents: closingCashCents }
      });
      await tx.cashDrawerSession.updateMany({
        where: { shiftId: shift.id, closedAt: null },
        data: { closedAt: new Date(), closingCashCents, closedByUserId: user.id }
      });
    }
    return closed;
  });
  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: "pos.shift.closed",
    entityType: "EmployeeShift",
    entityId: shift.id,
    metadata: { cashDrawerId: shift.cashDrawerId }
  });
  return updated;
}
