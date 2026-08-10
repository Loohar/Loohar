import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "../config/prisma.js";
import { FEATURE } from "../config/entitlements.js";
import { assertFeatureForRestaurant } from "../middleware/entitlements.js";
import { recordAudit } from "./auditService.js";
import { menuItemSendToKitchen, withMenuCustomizationModes } from "./menuCustomizationService.js";
import { emitKitchenTicketCreated } from "./realtimeService.js";
import { signPosSessionToken } from "../utils/tokens.js";

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

const ORDER_TYPES = new Set(["PICKUP", "DELIVERY", "DINE_IN", "WALK_IN", "DRIVE_THRU", "CURBSIDE", "CATERING"]);
const ACTIVE_RESTAURANT_STATUSES = new Set(["ACTIVE"]);
const POS_ROLES = new Set(["TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_MANAGER", "CASHIER"]);
const PIN_MANAGEMENT_ROLES = new Set(["TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_MANAGER"]);
const POS_PIN_PATTERN = /^\d{4,8}$/;
const POS_PIN_MAX_ATTEMPTS = 5;
const POS_PIN_LOCKOUT_MS = 5 * 60 * 1000;
const OPEN_ORDER_STATUSES = ["PENDING", "ACCEPTED", "PREPARING", "READY", "PICKED_UP", "ON_THE_WAY"];
const POS_ORDER_FIELD_MODES = new Set(["REQUIRED", "OPTIONAL", "HIDDEN"]);
const DEFAULT_POS_ORDER_FIELD_POLICY = Object.freeze({
  WALK_IN: { name: "OPTIONAL", phone: "OPTIONAL" },
  DINE_IN: { tableNumber: "REQUIRED", seat: "OPTIONAL", server: "REQUIRED", guestCount: "REQUIRED", name: "OPTIONAL" },
  PICKUP: { name: "REQUIRED", phone: "REQUIRED", pickupTime: "REQUIRED" },
  DELIVERY: { name: "REQUIRED", phone: "REQUIRED", deliveryAddress: "REQUIRED", deliveryInstructions: "OPTIONAL" },
  DRIVE_THRU: { vehicle: "REQUIRED", name: "REQUIRED", phone: "OPTIONAL" },
  CURBSIDE: { name: "REQUIRED", phone: "REQUIRED", vehicle: "REQUIRED", parkingSpot: "REQUIRED" },
  CATERING: { eventName: "REQUIRED", name: "REQUIRED", phone: "REQUIRED", eventDateTime: "REQUIRED", headcount: "REQUIRED" }
});
const POS_CUSTOMER_FIELDS = new Set([
  "name",
  "phone",
  "email",
  "tableNumber",
  "seat",
  "server",
  "guestCount",
  "pickupTime",
  "deliveryAddress",
  "deliveryInstructions",
  "deliveryZoneId",
  "vehicle",
  "parkingSpot",
  "eventName",
  "eventDateTime",
  "headcount"
]);
const POS_RESTAURANT_INCLUDE = {
  locations: { where: { active: true }, orderBy: { createdAt: "asc" } },
  deliveryZones: { where: { active: true }, orderBy: { createdAt: "asc" } },
  merchantAccounts: true
};

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

export function normalizePosOrderFieldPolicy(settingsJson = {}) {
  const configured = safeJson(safeJson(settingsJson, {}).posOrderFields, {});
  return Object.fromEntries(Object.entries(DEFAULT_POS_ORDER_FIELD_POLICY).map(([orderType, defaults]) => [
    orderType,
    Object.fromEntries(Object.entries(defaults).map(([field, defaultMode]) => {
      const requestedMode = String(configured?.[orderType]?.[field] || defaultMode).toUpperCase();
      return [field, POS_ORDER_FIELD_MODES.has(requestedMode) ? requestedMode : defaultMode];
    }))
  ]));
}

function normalizePosCustomer(customerJson = {}) {
  const source = safeJson(customerJson, {});
  return Object.fromEntries([...POS_CUSTOMER_FIELDS].map((field) => [
    field,
    String(source[field] ?? "").trim().slice(0, field === "deliveryAddress" || field === "deliveryInstructions" ? 500 : 160)
  ]));
}

async function loadPosOrderConfiguration(restaurantId) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      settingsJson: true,
      deliveryFeeCents: true,
      deliveryZones: {
        where: { active: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, deliveryFeeCents: true, minimumOrderCents: true, radiusMiles: true }
      }
    }
  });
  if (!restaurant) throw httpError("Restaurant not found.", 404, { code: "POS_RESTAURANT_NOT_FOUND" });
  return {
    settingsJson: restaurant.settingsJson,
    orderFieldPolicy: normalizePosOrderFieldPolicy(restaurant.settingsJson),
    deliveryFeeCents: cents(restaurant.deliveryFeeCents),
    deliveryZones: restaurant.deliveryZones
  };
}

function resolvePosDeliveryPricing(config, orderType, body, subtotalCents) {
  if (orderType !== "DELIVERY") return { deliveryFeeCents: 0, deliveryZone: null };
  if (!config.deliveryZones.length) {
    return { deliveryFeeCents: config.deliveryFeeCents, deliveryZone: null };
  }
  const deliveryZoneId = String(body?.deliveryZoneId || "").trim();
  if (!deliveryZoneId) {
    throw httpError("Select a delivery zone before continuing.", 400, { code: "POS_DELIVERY_ZONE_REQUIRED" });
  }
  const deliveryZone = config.deliveryZones.find((zone) => zone.id === deliveryZoneId);
  if (!deliveryZone) {
    throw httpError("Delivery zone is not active for this restaurant.", 400, { code: "POS_DELIVERY_ZONE_INVALID" });
  }
  if (subtotalCents < deliveryZone.minimumOrderCents) {
    throw httpError("Order does not meet the delivery zone minimum.", 400, {
      code: "POS_DELIVERY_MINIMUM_NOT_MET",
      minimumOrderCents: deliveryZone.minimumOrderCents
    });
  }
  return { deliveryFeeCents: deliveryZone.deliveryFeeCents, deliveryZone };
}

async function validatePosOrderSetup({ restaurantId, orderType, customerJson, quote }) {
  const config = await loadPosOrderConfiguration(restaurantId);
  const customer = normalizePosCustomer(customerJson);
  const policy = config.orderFieldPolicy[orderType] || {};
  const missingFields = Object.entries(policy)
    .filter(([, mode]) => mode === "REQUIRED")
    .map(([field]) => field)
    .filter((field) => !customer[field]);
  if (missingFields.length) {
    throw httpError("Required order setup details are missing.", 400, { code: "POS_ORDER_SETUP_REQUIRED", fields: missingFields });
  }
  for (const field of ["guestCount", "headcount"]) {
    if (customer[field] && (!Number.isInteger(Number(customer[field])) || Number(customer[field]) < 1)) {
      throw httpError(`${field === "guestCount" ? "Guest count" : "Headcount"} must be at least 1.`, 400, {
        code: "POS_ORDER_SETUP_INVALID",
        field
      });
    }
  }
  if (orderType === "DELIVERY") {
    const pricing = resolvePosDeliveryPricing(config, orderType, { deliveryZoneId: customer.deliveryZoneId }, quote.subtotalCents);
    if (pricing.deliveryFeeCents !== quote.deliveryFeeCents) {
      throw httpError("Delivery pricing changed. Recalculate the order.", 409, { code: "POS_DELIVERY_PRICING_CHANGED" });
    }
  }
  for (const [field, mode] of Object.entries(policy)) {
    if (mode === "HIDDEN") customer[field] = "";
  }
  return customer;
}

export const ZERO_LOOHAR_PLATFORM_FEE_DISCLOSURE =
  "No additional Loohar transaction fee. Standard payment-processing fees may still apply.";

const ZERO_PLATFORM_FEE_QUOTE = Object.freeze({
  zeroLooharPlatformFee: true,
  looharPlatformFeeCents: 0,
  platformFeeCents: 0,
  processorFeesMayApply: true,
  paymentFeeDisclosure: ZERO_LOOHAR_PLATFORM_FEE_DISCLOSURE
});

function zeroPlatformFeeQuoteJson(extra = {}) {
  return { ...ZERO_PLATFORM_FEE_QUOTE, ...extra };
}

function invalidModifierSelection(details = {}) {
  return httpError("Menu item modifier selection is malformed.", 400, {
    code: "POS_MODIFIER_INVALID",
    ...details
  });
}

function normalizedModifierSelection(modifierGroupId, modifierOptionId, details = {}) {
  const groupId = modifierGroupId == null ? null : String(modifierGroupId || "").trim();
  const optionId = String(modifierOptionId || "").trim();
  if (!optionId || (modifierGroupId != null && !groupId)) throw invalidModifierSelection(details);
  return { modifierGroupId: groupId, modifierOptionId: optionId };
}

function resolveLineModifierSelections(line = {}) {
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(line, key);

  // Aliases are alternatives. Prefer the canonical representation when supplied.
  if (hasOwn("modifierSelections")) {
    const source = line.modifierSelections;
    if (Array.isArray(source)) {
      return source.flatMap((selection, selectionIndex) => {
        if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
          throw invalidModifierSelection({ selectionIndex });
        }
        const groupId = selection.modifierGroupId ?? selection.groupId ?? null;
        if (Array.isArray(selection.optionIds)) {
          return selection.optionIds.map((optionId) => normalizedModifierSelection(groupId, optionId, { selectionIndex }));
        }
        const optionId = selection.modifierOptionId ?? selection.optionId;
        if (optionId == null) throw invalidModifierSelection({ selectionIndex });
        return [normalizedModifierSelection(groupId, optionId, { selectionIndex })];
      });
    }
    if (source && typeof source === "object") {
      return Object.entries(source).flatMap(([groupId, value]) => {
        const optionIds = Array.isArray(value) ? value : [value];
        return optionIds.map((optionId) => normalizedModifierSelection(groupId, optionId, { groupId }));
      });
    }
    throw invalidModifierSelection();
  }

  const legacyKey = hasOwn("modifierOptionIds") ? "modifierOptionIds" : hasOwn("optionIds") ? "optionIds" : null;
  if (!legacyKey) return [];
  if (!Array.isArray(line[legacyKey])) throw invalidModifierSelection({ field: legacyKey });
  return line[legacyKey].map((optionId, selectionIndex) => (
    normalizedModifierSelection(null, optionId, { field: legacyKey, selectionIndex })
  ));
}

function rawLineOptionIds(line = {}) {
  return resolveLineModifierSelections(line).map((selection) => selection.modifierOptionId);
}

function normalizeLineOptionIds(line = {}) {
  return [...new Set(rawLineOptionIds(line))];
}

function normalizeMenuItemModifierGroups(menuItem = {}) {
  const groups = (menuItem.optionGroups || [])
    .map((group) => ({
      ...group,
      options: [...(group.options || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const groupedOptionIds = new Set(groups.flatMap((group) => (group.options || []).map((option) => option.id)));
  const ungroupedOptions = (menuItem.options || [])
    .filter((option) => !groupedOptionIds.has(option.id))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  if (ungroupedOptions.length) {
    groups.push({
      id: `__ungrouped:${menuItem.id}`,
      menuItemId: menuItem.id,
      name: "Options",
      required: false,
      minSelect: 0,
      maxSelect: ungroupedOptions.length,
      sortOrder: groups.length + 1,
      options: ungroupedOptions
    });
  }

  return groups;
}

export function validateSelectedModifiers(menuItem, line = {}) {
  const selections = resolveLineModifierSelections(line);
  const rawOptionIds = selections.map((selection) => selection.modifierOptionId);
  const optionIds = normalizeLineOptionIds(line);
  if (rawOptionIds.length !== optionIds.length) {
    throw httpError("Duplicate menu item modifier selected.", 400, { code: "POS_MODIFIER_DUPLICATE" });
  }

  const groups = normalizeMenuItemModifierGroups(menuItem);
  const optionToGroup = new Map();
  for (const group of groups) {
    for (const option of group.options || []) {
      optionToGroup.set(option.id, { group, option });
    }
  }

  const selectedByGroup = new Map(groups.map((group) => [group.id, []]));
  for (const selection of selections) {
    const optionId = selection.modifierOptionId;
    const match = optionToGroup.get(optionId);
    if (!match) throw httpError("Menu item modifier is invalid for this item.", 400, { code: "POS_MODIFIER_INVALID", optionId });
    if (selection.modifierGroupId && selection.modifierGroupId !== match.group.id) {
      throw httpError("Menu item modifier group does not match this option.", 400, {
        code: "POS_MODIFIER_INVALID",
        groupId: selection.modifierGroupId,
        optionId
      });
    }
    selectedByGroup.get(match.group.id).push(match.option);
  }

  for (const group of groups) {
    const selected = selectedByGroup.get(group.id) || [];
    const minSelect = Math.max(0, Number(group.minSelect ?? 0));
    const maxSelect = Math.max(1, Number(group.maxSelect ?? group.options?.length ?? 1));
    if ((group.required || minSelect > 0) && selected.length < Math.max(1, minSelect)) {
      throw httpError(`${group.name} requires a selection.`, 400, { code: "POS_MODIFIER_REQUIRED", groupId: group.id });
    }
    if (selected.length > maxSelect) {
      throw httpError(`${group.name} allows up to ${maxSelect} selection${maxSelect === 1 ? "" : "s"}.`, 400, { code: "POS_MODIFIER_MAXIMUM", groupId: group.id, maxSelect });
    }
  }

  const modifiers = optionIds.map((optionId) => {
    const { group, option } = optionToGroup.get(optionId);
    return {
      id: option.id,
      optionId: option.id,
      name: option.name,
      optionName: option.name,
      priceCents: option.priceCents,
      groupId: group.id,
      groupName: group.name
    };
  });

  return { optionIds, modifiers };
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
  const restaurantIdentifier = String(identifier || "").trim();
  if (!restaurantIdentifier) throw httpError("Restaurant slug or id is required.", 400, { code: "POS_RESTAURANT_IDENTIFIER_REQUIRED" });
  let restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantIdentifier },
    include: POS_RESTAURANT_INCLUDE
  });
  if (!restaurant) {
    restaurant = await prisma.restaurant.findUnique({
      where: { slug: restaurantIdentifier },
      include: POS_RESTAURANT_INCLUDE
    });
  }
  if (!restaurant) throw httpError("Restaurant not found.", 404, { code: "POS_RESTAURANT_NOT_FOUND" });
  if (!ACTIVE_RESTAURANT_STATUSES.has(restaurant.status)) throw httpError("Restaurant is not active.", 403, { code: "POS_RESTAURANT_INACTIVE", restaurantStatus: restaurant.status });
  if (user?.role === "SUPER_ADMIN") throw httpError("Super admin cannot operate a tenant POS register.", 403, { code: "POS_SUPER_ADMIN_DENIED" });
  if (!POS_ROLES.has(user?.role)) throw httpError("POS access is limited to restaurant staff.", 403, { code: "POS_ROLE_DENIED", role: user?.role || null });
  if (!user?.restaurantId || user.restaurantId !== restaurant.id) throw httpError("Tenant access denied.", 403, { code: "POS_TENANT_MISMATCH" });
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

async function activeStaffProfile(restaurantId, userId) {
  return prisma.restaurantStaff.findFirst({
    where: { restaurantId, userId, active: true }
  });
}

function staffLocationIds(staff) {
  return Array.isArray(staff?.locationIdsJson)
    ? staff.locationIdsJson.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
}

function assertStaffLocationAccess(staff, locationId) {
  const locationIds = staffLocationIds(staff);
  if (locationIds.length && (!locationId || !locationIds.includes(locationId))) {
    throw httpError("This employee cannot operate the selected location.", 403, {
      code: "POS_EMPLOYEE_LOCATION_DENIED"
    });
  }
}

async function ensurePinStaffProfile(restaurantId, user) {
  const existing = await activeStaffProfile(restaurantId, user.id);
  if (existing) return existing;
  if (!PIN_MANAGEMENT_ROLES.has(user.role)) {
    throw httpError("An active restaurant employee profile is required.", 403, {
      code: "POS_STAFF_PROFILE_REQUIRED"
    });
  }
  return prisma.restaurantStaff.upsert({
    where: { userId: user.id },
    update: { restaurantId, role: user.role, active: true },
    create: { restaurantId, userId: user.id, role: user.role, active: true }
  });
}

export async function cashierPinStatus({ restaurantId, user }) {
  await assertPosPermission(user, restaurantId, POS_PERMISSION.ACCESS);
  const staff = await activeStaffProfile(restaurantId, user.id);
  return {
    configured: Boolean(staff?.posPinHash),
    lockedUntil: staff?.posPinLockedUntil || null,
    failedAttempts: staff?.posPinFailedAttempts || 0
  };
}

export async function setCashierPin({ restaurantId, user, pin }) {
  await assertPosPermission(user, restaurantId, POS_PERMISSION.ACCESS);
  if (!POS_PIN_PATTERN.test(String(pin || ""))) {
    throw httpError("POS PIN must contain 4 to 8 digits.", 400, { code: "POS_PIN_INVALID" });
  }
  const staff = await ensurePinStaffProfile(restaurantId, user);
  const posPinHash = await bcrypt.hash(String(pin), 12);
  const updated = await prisma.restaurantStaff.update({
    where: { id: staff.id },
    data: {
      posPinHash,
      posPinFailedAttempts: 0,
      posPinLockedUntil: null,
      posPinUpdatedAt: new Date()
    }
  });
  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: "pos.pin.updated",
    entityType: "RestaurantStaff",
    entityId: updated.id,
    metadata: { role: updated.role }
  });
  return { configured: true, lockedUntil: null, failedAttempts: 0 };
}

export async function unlockPosDevice({ restaurantId, user, pin, deviceId, fingerprint, ipAddress = null, userAgent = null }) {
  await assertPosPermission(user, restaurantId, POS_PERMISSION.ACCESS);
  const device = await requireActiveDevice({ restaurantId, deviceId, fingerprint });
  const staff = await activeStaffProfile(restaurantId, user.id);
  if (!staff?.posPinHash) {
    throw httpError("A cashier PIN must be configured before this register can be unlocked.", 409, {
      code: "POS_PIN_NOT_CONFIGURED"
    });
  }
  const locationId = await resolvePosLocationId(restaurantId, device.locationId);
  assertStaffLocationAccess(staff, locationId);
  const now = new Date();
  if (staff.posPinLockedUntil && staff.posPinLockedUntil > now) {
    throw httpError("Too many incorrect PIN attempts. Try again later.", 423, {
      code: "POS_PIN_LOCKED",
      lockedUntil: staff.posPinLockedUntil
    });
  }
  const valid = POS_PIN_PATTERN.test(String(pin || "")) && await bcrypt.compare(String(pin), staff.posPinHash);
  if (!valid) {
    const failedAttempts = (staff.posPinFailedAttempts || 0) + 1;
    const lockedUntil = failedAttempts >= POS_PIN_MAX_ATTEMPTS
      ? new Date(Date.now() + POS_PIN_LOCKOUT_MS)
      : null;
    await prisma.restaurantStaff.update({
      where: { id: staff.id },
      data: {
        posPinFailedAttempts: lockedUntil ? 0 : failedAttempts,
        posPinLockedUntil: lockedUntil
      }
    });
    await recordAudit({
      actorUserId: user.id,
      restaurantId,
      action: "pos.pin.failed",
      entityType: "RestaurantStaff",
      entityId: staff.id,
      metadata: { deviceId: device.id, failedAttempts, locked: Boolean(lockedUntil), ipAddress, userAgent }
    });
    throw httpError(lockedUntil ? "Too many incorrect PIN attempts. Try again later." : "Incorrect POS PIN.", lockedUntil ? 423 : 401, {
      code: lockedUntil ? "POS_PIN_LOCKED" : "POS_PIN_INCORRECT",
      lockedUntil,
      attemptsRemaining: Math.max(0, POS_PIN_MAX_ATTEMPTS - failedAttempts)
    });
  }
  await prisma.restaurantStaff.update({
    where: { id: staff.id },
    data: { posPinFailedAttempts: 0, posPinLockedUntil: null, posLastUnlockedAt: now }
  });
  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: "pos.register.unlocked",
    entityType: "PosDevice",
    entityId: device.id,
    metadata: { employeeUserId: user.id, locationId, ipAddress, userAgent }
  });
  return {
    unlocked: true,
    unlockedAt: now,
    posSessionToken: signPosSessionToken({
      userId: user.id,
      restaurantId,
      staffId: staff.id,
      deviceId: device.id,
      locationId
    }),
    device: { id: device.id, name: device.name, locationId },
    employee: { id: user.id, name: user.name, email: user.email, role: user.role }
  };
}

export async function listPosOrders({ restaurantId, user, deviceId, fingerprint, recent = false }) {
  await assertPosPermission(user, restaurantId, POS_PERMISSION.ACCESS);
  const device = await requireActiveDevice({ restaurantId, deviceId, fingerprint });
  const staff = await activeStaffProfile(restaurantId, user.id);
  const locationId = await resolvePosLocationId(restaurantId, device.locationId);
  if (staff) assertStaffLocationAccess(staff, locationId);
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const orders = await prisma.order.findMany({
    where: {
      restaurantId,
      ...(locationId ? { locationId } : { locationId: null }),
      ...(recent ? { createdAt: { gte: since } } : { status: { in: OPEN_ORDER_STATUSES } })
    },
    include: { customer: true, items: true, payment: true, restaurantOrderPayment: true, location: true },
    orderBy: { createdAt: "desc" },
    take: 50
  });
  return { orders, locationId, scope: recent ? "TODAY" : "OPEN" };
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

async function activeInternalDevelopmentDevice(restaurantId) {
  const device = await prisma.posDevice.findFirst({
    where: {
      restaurantId,
      status: "ACTIVE",
      settingsJson: { path: ["internalDevelopment"], equals: true }
    },
    orderBy: { updatedAt: "desc" }
  });
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
  let device = await touchDevice({ restaurantId: restaurant.id, deviceId, fingerprint });
  if (device?.status !== "ACTIVE") {
    device = null;
  }
  if (!device && restaurant.tenantClassification === "INTERNAL_DEVELOPMENT") {
    device = await activeInternalDevelopmentDevice(restaurant.id);
  }
  const shift = await currentShift({ restaurantId: restaurant.id, userId: user.id, deviceId: device?.id || null });
  const [cashDrawers, registers, devices, pinStatus] = await Promise.all([
    prisma.cashDrawer.findMany({ where: { restaurantId: restaurant.id, active: true }, orderBy: { createdAt: "asc" } }),
    prisma.posRegister.findMany({ where: { restaurantId: restaurant.id, active: true }, orderBy: { createdAt: "asc" } }),
    prisma.posDevice.findMany({ where: { restaurantId: restaurant.id }, orderBy: { updatedAt: "desc" }, take: 25 }),
    cashierPinStatus({ restaurantId: restaurant.id, user })
  ]);
  return {
    restaurant: {
      id: restaurant.id,
      slug: restaurant.slug,
      name: restaurant.businessName || restaurant.name,
      timezone: restaurant.timezone
    },
    locations: restaurant.locations,
    deliveryZones: restaurant.deliveryZones,
    orderFieldPolicy: normalizePosOrderFieldPolicy(restaurant.settingsJson),
    permissions,
    device,
    shift,
    cashDrawers,
    registers,
    devices,
    pinStatus
  };
}

export async function posMenu(restaurantId) {
  const [categories, restaurant] = await Promise.all([
    prisma.menuCategory.findMany({
      where: { restaurantId, active: true },
      include: {
        items: {
          where: { available: true },
          include: {
            options: { orderBy: { sortOrder: "asc" } },
            optionGroups: {
              include: { options: { orderBy: { sortOrder: "asc" } } },
              orderBy: { sortOrder: "asc" }
            }
          },
          orderBy: { name: "asc" }
        }
      },
      orderBy: { name: "asc" }
    }),
    prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { settingsJson: true }
    })
  ]);
  return withMenuCustomizationModes(categories, restaurant?.settingsJson);
}

export async function posMenuAvailabilityDiagnostics(restaurantId, categories = []) {
  const visibleItems = categories.reduce((total, category) => total + (category.items || []).length, 0);
  const [
    totalCategories,
    activeCategories,
    inactiveCategories,
    totalItems,
    availableItemsTotal,
    unavailableItemsTotal,
    activeCategoryAvailableItems
  ] = await prisma.$transaction([
    prisma.menuCategory.count({ where: { restaurantId } }),
    prisma.menuCategory.count({ where: { restaurantId, active: true } }),
    prisma.menuCategory.count({ where: { restaurantId, active: false } }),
    prisma.menuItem.count({ where: { restaurantId } }),
    prisma.menuItem.count({ where: { restaurantId, available: true } }),
    prisma.menuItem.count({ where: { restaurantId, available: false } }),
    prisma.menuItem.count({ where: { restaurantId, available: true, category: { active: true } } })
  ]);

  let reason = "READY";
  if (visibleItems <= 0) {
    if (totalItems <= 0) reason = "NO_MENU_ITEMS";
    else if (activeCategories <= 0) reason = "NO_ACTIVE_CATEGORIES";
    else if (availableItemsTotal <= 0) reason = "NO_AVAILABLE_ITEMS";
    else reason = "MENU_ITEMS_NOT_PUBLISHED_TO_POS";
  }

  return {
    totalCategories,
    activeCategories,
    inactiveCategories,
    totalItems,
    availableItemsTotal,
    unavailableItemsTotal,
    activeCategoryAvailableItems,
    visibleItems,
    hiddenAvailableItems: Math.max(0, availableItemsTotal - visibleItems),
    hasUnpublishedPosItems: totalItems > 0 && visibleItems <= 0,
    reason
  };
}

async function taxRateBps(restaurantId) {
  const config = await prisma.taxConfiguration.findFirst({
    where: { restaurantId, enabled: true },
    orderBy: { updatedAt: "desc" },
    select: { taxRateBps: true }
  });
  return config?.taxRateBps ?? 825;
}

async function resolvePosLocationId(restaurantId, requestedLocationId) {
  const locationId = String(requestedLocationId || "").trim();
  const location = await prisma.restaurantLocation.findFirst({
    where: {
      restaurantId,
      active: true,
      ...(locationId ? { id: locationId } : {})
    },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  if (locationId && !location) {
    throw httpError("POS location access denied.", 403, { code: "POS_LOCATION_FORBIDDEN" });
  }
  return location?.id || null;
}

export async function createPosQuote({ restaurantId, user, body, deviceId = null, sessionId = null }) {
  await assertPosFeature(restaurantId, "POST");
  await assertPosPermission(user, restaurantId, POS_PERMISSION.CREATE_ORDER);
  const orderType = ORDER_TYPES.has(body?.orderType) ? body.orderType : "WALK_IN";
  const rawItems = Array.isArray(body?.lineItems) ? body.lineItems : [];
  if (!rawItems.length) throw httpError("At least one menu item is required.", 400);

  const itemIds = [...new Set(rawItems.map((line) => String(line.menuItemId || "")).filter(Boolean))];
  const [menuItems, orderConfiguration] = await Promise.all([
    prisma.menuItem.findMany({
      where: { restaurantId, id: { in: itemIds }, available: true },
      include: {
        options: { orderBy: { sortOrder: "asc" } },
        optionGroups: {
          include: { options: { orderBy: { sortOrder: "asc" } } },
          orderBy: { sortOrder: "asc" }
        }
      }
    }),
    loadPosOrderConfiguration(restaurantId)
  ]);
  const menuById = new Map(menuItems.map((item) => [item.id, item]));

  const normalizedItems = rawItems.map((line) => {
    const menuItem = menuById.get(String(line.menuItemId || ""));
    if (!menuItem) throw httpError("Menu item is unavailable for this restaurant.", 400);
    const quantity = Math.min(99, Math.max(1, Number.parseInt(line.quantity, 10) || 1));
    const { optionIds, modifiers } = validateSelectedModifiers(menuItem, line);
    const unitPriceCents = menuItem.priceCents + modifiers.reduce((sum, option) => sum + option.priceCents, 0);
    return {
      menuItemId: menuItem.id,
      name: menuItem.name,
      quantity,
      unitPriceCents,
      basePriceCents: menuItem.priceCents,
      optionIds,
      modifierOptionIds: optionIds,
      modifiers,
      options: modifiers,
      sendToKitchen: menuItemSendToKitchen(orderConfiguration.settingsJson, menuItem.id),
      specialInstructions: String(line.specialInstructions || "").slice(0, 500),
      lineTotalCents: unitPriceCents * quantity
    };
  });

  const subtotalCents = normalizedItems.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const discountCents = cents(body?.discountCents);
  const { deliveryFeeCents } = resolvePosDeliveryPricing(orderConfiguration, orderType, body, subtotalCents);
  const tipCents = 0;
  const taxableAmountCents = Math.max(0, subtotalCents - discountCents);
  const taxCents = Math.round((taxableAmountCents * await taxRateBps(restaurantId)) / 10_000);
  const totalCents = Math.max(0, taxableAmountCents + deliveryFeeCents + taxCents + tipCents);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const locationId = await resolvePosLocationId(restaurantId, body?.locationId);

  const quote = await prisma.orderQuote.create({
    data: {
      restaurantId,
      locationId,
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

function receiptLineItems(order, quote) {
  if (Array.isArray(quote?.lineItemsJson) && quote.lineItemsJson.length) return quote.lineItemsJson;
  return (order.items || []).map((item) => ({
    menuItemId: item.menuItemId,
    name: item.name,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    lineTotalCents: item.unitPriceCents * item.quantity,
    options: item.optionsJson?.options || [],
    modifiers: item.optionsJson?.modifiers || item.optionsJson?.options || [],
    specialInstructions: item.optionsJson?.specialInstructions || "",
    sendToKitchen: item.optionsJson?.sendToKitchen !== false
  }));
}

function receiptPayload({ order, quote, payment = null }) {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    type: order.type,
    status: order.status,
    paymentStatus: payment?.status || "PENDING",
    items: receiptLineItems(order, quote),
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    deliveryFeeCents: order.deliveryFeeCents,
    taxCents: order.taxCents,
    tipCents: order.tipCents,
    totalCents: order.totalCents,
    looharPlatformFeeCents: 0,
    platformFeeCents: 0,
    zeroLooharPlatformFee: true,
    processorFeesMayApply: true,
    paymentFeeDisclosure: ZERO_LOOHAR_PLATFORM_FEE_DISCLOSURE,
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
  const normalizedCustomer = await validatePosOrderSetup({ restaurantId, orderType: quote.orderType, customerJson, quote });
  const kitchenLineItems = quote.lineItemsJson.filter((line) => line.sendToKitchen !== false);

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.orderQuote.updateMany({
      where: {
        id: quote.id,
        restaurantId,
        acceptedAt: null,
        voidedAt: null,
        expiresAt: { gt: new Date() }
      },
      data: { acceptedAt: new Date() }
    });
    if (claimed.count !== 1) throw httpError("POS quote has already been submitted or expired.", 409);

    const customer = await ensurePosCustomer(tx, restaurantId, quote.id, normalizedCustomer);
    const orderNumber = await nextOrderNumber(tx, restaurantId);
    const order = await tx.order.create({
      data: {
        restaurantId,
        locationId: quote.locationId,
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
        deliveryAddress: normalizedCustomer.deliveryAddress || null,
        notes: String(notes || "").slice(0, 1000),
        items: {
          create: quote.lineItemsJson.map((line) => ({
            menuItemId: line.menuItemId,
            name: line.name,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            optionsJson: {
              options: line.options || [],
              modifiers: line.modifiers || line.options || [],
              optionIds: line.optionIds || line.modifierOptionIds || [],
              specialInstructions: line.specialInstructions || "",
              sendToKitchen: line.sendToKitchen !== false
            }
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
      include: {
        customer: true,
        location: true,
        items: true,
        statusHistory: { orderBy: { createdAt: "asc" } }
      }
    });
    if (sessionId) {
      await tx.posOrderSession.updateMany({
        where: { id: sessionId, restaurantId },
        data: { status: "SUBMITTED", orderId: order.id, submittedAt: new Date(), updatedByUserId: user.id }
      });
    }
    const receipt = kitchenLineItems.length ? await tx.posReceipt.create({
      data: {
        restaurantId,
        locationId: quote.locationId,
        deviceId,
        sessionId,
        orderId: order.id,
        receiptNumber: randomReceiptNumber("POS"),
        kind: "KITCHEN_TICKET",
        payloadJson: receiptPayload({ order, quote: { lineItemsJson: kitchenLineItems } }),
        createdByUserId: user.id
      }
    }) : null;
    return { order, receipt };
  });

  emitKitchenTicketCreated(result.order);
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
  const locationId = await resolvePosLocationId(restaurantId, body?.locationId);
  const session = await prisma.posOrderSession.create({
    data: {
      restaurantId,
      locationId,
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
    metadata: { name: session.name, locationId }
  });
  return session;
}

export async function cashPayment({ restaurantId, user, orderId, deviceId, fingerprint, amountCents = null }) {
  await assertPosFeature(restaurantId, "POST");
  const { device, shift, cashDrawer } = await requireCashRegisterAccess({ restaurantId, user, deviceId, fingerprint });
  const order = await prisma.order.findFirst({ where: { id: orderId, restaurantId }, include: { items: true } });
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
        platformFeeCents: 0,
        restaurantGrossCents: order.totalCents,
        restaurantNetCents: order.totalCents,
        restaurantTipCents: order.restaurantTipCents,
        driverTipCents: order.driverTipCents,
        quoteJson: zeroPlatformFeeQuoteJson({ source: "POS_CASH", deviceId: device.id })
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
        platformFeeCents: 0,
        restaurantGrossCents: order.totalCents,
        restaurantNetCents: order.totalCents,
        quoteJson: zeroPlatformFeeQuoteJson({ source: "POS_CASH", deviceId: device.id }),
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
  return {
    ...result,
    amountReceivedCents: paidAmount,
    changeDueCents: Math.max(0, paidAmount - order.totalCents)
  };
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
      platformFeeCents: 0,
      restaurantGrossCents: order.totalCents,
      restaurantNetCents: order.totalCents,
      quoteJson: zeroPlatformFeeQuoteJson({ source: "POS", deviceId: device.id })
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
      platformFeeCents: 0,
      restaurantGrossCents: order.totalCents,
      restaurantNetCents: order.totalCents,
      quoteJson: zeroPlatformFeeQuoteJson({ source: "POS", deviceId: device.id })
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
