import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "../config/prisma.js";
import { FEATURE } from "../config/entitlements.js";
import { assertFeatureForRestaurant } from "../middleware/entitlements.js";
import { recordAudit } from "./auditService.js";
import { menuItemSendToKitchen, withMenuCustomizationModes } from "./menuCustomizationService.js";
import { assemblePosMenuCategories } from "./posMenuReadModel.js";
import { requestCashDrawerOpen } from "./posHardwareService.js";
import { emitKitchenTicketCreated } from "./realtimeService.js";
import {
  signPosOfflineConfigurationProof,
  signPosOfflineMenuItemProof,
  signPosSessionToken,
  verifyPosOfflineConfigurationProof,
  verifyPosOfflineMenuItemProof
} from "../utils/tokens.js";
import {
  POS_OFFLINE_SCHEMA_VERSION,
  calculatePosPricingSnapshot,
  resolvePosDeliveryPricingSnapshot,
  validatePosOfflinePricingSnapshot
} from "../../../shared/posOfflinePricing.js";

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
const POS_DEVICE_TOUCH_INTERVAL_MS = 60 * 1000;
const POS_OFFLINE_CONFIGURATION_TTL_MS = 72 * 60 * 60 * 1000;

async function recordPosTiming(timings, name, operation) {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    if (timings) timings[name] = Number((performance.now() - startedAt).toFixed(1));
  }
}

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
  try {
    return resolvePosDeliveryPricingSnapshot({
      orderType,
      deliveryZones: config.deliveryZones,
      defaultDeliveryFeeCents: config.deliveryFeeCents,
      deliveryZoneId: body?.deliveryZoneId,
      subtotalCents
    });
  } catch (error) {
    throw httpError(error.message, 400, { code: error.code, minimumOrderCents: error.minimumOrderCents });
  }
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
  const matchesAuthenticatedTenant = Boolean(user?.restaurantId) && (
    restaurantIdentifier === user.restaurantId || restaurantIdentifier === user.restaurantSlug
  );
  const restaurantQuery = matchesAuthenticatedTenant
    ? prisma.restaurant.findUnique({ where: { id: user.restaurantId } })
    : prisma.restaurant.findFirst({
        where: { OR: [{ id: restaurantIdentifier }, { slug: restaurantIdentifier }] }
      });
  const knownRestaurantId = matchesAuthenticatedTenant ? user.restaurantId : null;
  let restaurant;
  let locations;
  let deliveryZones;
  if (knownRestaurantId) {
    [restaurant, locations, deliveryZones] = await Promise.all([
      restaurantQuery,
      prisma.restaurantLocation.findMany({ where: { restaurantId: knownRestaurantId, active: true }, orderBy: { createdAt: "asc" } }),
      prisma.deliveryZone.findMany({ where: { restaurantId: knownRestaurantId, active: true }, orderBy: { createdAt: "asc" } })
    ]);
  } else {
    restaurant = await restaurantQuery;
    if (restaurant) {
      [locations, deliveryZones] = await Promise.all([
        prisma.restaurantLocation.findMany({ where: { restaurantId: restaurant.id, active: true }, orderBy: { createdAt: "asc" } }),
        prisma.deliveryZone.findMany({ where: { restaurantId: restaurant.id, active: true }, orderBy: { createdAt: "asc" } })
      ]);
    }
  }
  if (!restaurant) throw httpError("Restaurant not found.", 404, { code: "POS_RESTAURANT_NOT_FOUND" });
  if (!ACTIVE_RESTAURANT_STATUSES.has(restaurant.status)) throw httpError("Restaurant is not active.", 403, { code: "POS_RESTAURANT_INACTIVE", restaurantStatus: restaurant.status });
  if (user?.role === "SUPER_ADMIN") throw httpError("Super admin cannot operate a tenant POS register.", 403, { code: "POS_SUPER_ADMIN_DENIED" });
  if (!POS_ROLES.has(user?.role)) throw httpError("POS access is limited to restaurant staff.", 403, { code: "POS_ROLE_DENIED", role: user?.role || null });
  if (!user?.restaurantId || user.restaurantId !== restaurant.id) throw httpError("Tenant access denied.", 403, { code: "POS_TENANT_MISMATCH" });
  return { ...restaurant, locations: locations || [], deliveryZones: deliveryZones || [] };
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

function posPermissionsForStaff(user, staffProfile) {
  const permissions = new Set(ROLE_PERMISSIONS[user?.role] || []);
  const staffPermissions = Array.isArray(staffProfile?.permissionsJson) ? staffProfile.permissionsJson : [];
  for (const permission of staffPermissions) {
    if (ALL_POS_PERMISSIONS.includes(permission)) permissions.add(permission);
  }
  return [...permissions];
}

function pinStatusForStaff(staff) {
  return {
    configured: Boolean(staff?.posPinHash),
    lockedUntil: staff?.posPinLockedUntil || null,
    failedAttempts: staff?.posPinFailedAttempts || 0
  };
}

export async function assertPosPermission(user, restaurantId, permission) {
  const rolePermissions = ROLE_PERMISSIONS[user?.role] || [];
  if (rolePermissions.includes(permission)) return [...rolePermissions];
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
  return pinStatusForStaff(staff);
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
  const lastSeenAt = new Date(device.lastSeenAt || 0).getTime();
  if (Date.now() - lastSeenAt >= POS_DEVICE_TOUCH_INTERVAL_MS) {
    void prisma.posDevice.updateMany({
      where: { id: device.id, restaurantId, lastSeenAt: device.lastSeenAt },
      data: { lastSeenAt: new Date() }
    }).catch(() => {});
  }
  return device;
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
  void prisma.posDevice.updateMany({
    where: { id: device.id, restaurantId, lastSeenAt: device.lastSeenAt },
    data: { lastSeenAt: new Date() }
  }).catch(() => {});
  return device;
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

export async function requireCashRegisterAccess({ restaurantId, user, deviceId, fingerprint, verifiedDevice = null }) {
  await assertPosPermission(user, restaurantId, POS_PERMISSION.ACCEPT_CASH);
  const canReuseVerifiedDevice = verifiedDevice
    && verifiedDevice.id === deviceId
    && verifiedDevice.restaurantId === restaurantId
    && verifiedDevice.status === "ACTIVE";
  const device = canReuseVerifiedDevice
    ? verifiedDevice
    : await requireActiveDevice({ restaurantId, deviceId, fingerprint });
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

function posOfflineConfigurationVersion(snapshot) {
  return `offline-v1:${crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`;
}

function posOfflineConfigurationSnapshot({ restaurant, staff, device, shift, taxConfiguration }) {
  return {
    schemaVersion: POS_OFFLINE_SCHEMA_VERSION,
    restaurantId: restaurant.id,
    userId: staff.userId,
    staffId: staff.id,
    deviceId: device.id,
    locationId: device.locationId || shift.locationId || null,
    shiftId: shift.id,
    cashDrawerId: shift.cashDrawerId,
    timezone: restaurant.timezone || "America/Denver",
    orderFieldPolicy: normalizePosOrderFieldPolicy(restaurant.settingsJson),
    taxConfiguration: {
      id: taxConfiguration.id,
      locationId: taxConfiguration.locationId,
      provider: taxConfiguration.provider,
      source: taxConfiguration.source,
      taxRateBps: taxConfiguration.taxRateBps,
      taxInclusive: taxConfiguration.taxInclusive,
      jurisdictionCode: taxConfiguration.jurisdictionCode,
      jurisdictionMetadata: taxConfiguration.jurisdictionMetadata,
      sourceMetadata: taxConfiguration.sourceMetadata,
      effectiveAt: taxConfiguration.effectiveAt,
      verifiedAt: taxConfiguration.verifiedAt,
      configurationVersion: taxConfiguration.configurationVersion,
      updatedAt: taxConfiguration.updatedAt.toISOString()
    },
    deliveryFeeCents: cents(restaurant.deliveryFeeCents),
    deliveryZones: (restaurant.deliveryZones || []).map((zone) => ({
      id: zone.id,
      deliveryFeeCents: cents(zone.deliveryFeeCents),
      minimumOrderCents: cents(zone.minimumOrderCents),
      updatedAt: zone.updatedAt?.toISOString?.() || null
    }))
  };
}

export async function posConfig({ restaurant, user, deviceId, fingerprint, entitlementVerified = false, timings = null }) {
  if (!entitlementVerified) {
    await recordPosTiming(timings, "config-entitlement", () => assertPosFeature(restaurant.id, "GET"));
  }
  const [staff, initialDevice] = await recordPosTiming(timings, "config-staff-device", () => Promise.all([
    activeStaffProfile(restaurant.id, user.id),
    touchDevice({ restaurantId: restaurant.id, deviceId, fingerprint })
  ]));
  const permissions = posPermissionsForStaff(user, staff);
  if (!permissions.includes(POS_PERMISSION.ACCESS)) throw httpError("POS access denied.", 403);
  let device = initialDevice;
  if (device?.status !== "ACTIVE") {
    device = null;
  }
  if (!device && restaurant.tenantClassification === "INTERNAL_DEVELOPMENT") {
    device = await activeInternalDevelopmentDevice(restaurant.id);
  }
  const profileAsOf = new Date();
  const [shift, cashDrawers, registers, devices, taxProfile] = await recordPosTiming(timings, "config-register-state", () => Promise.all([
    currentShift({ restaurantId: restaurant.id, userId: user.id, deviceId: device?.id || null }),
    prisma.cashDrawer.findMany({ where: { restaurantId: restaurant.id, active: true }, orderBy: { createdAt: "asc" } }),
    prisma.posRegister.findMany({ where: { restaurantId: restaurant.id, active: true }, orderBy: { createdAt: "asc" } }),
    prisma.posDevice.findMany({ where: { restaurantId: restaurant.id }, orderBy: { updatedAt: "desc" }, take: 25 }),
    device?.locationId
      ? prisma.locationTaxProfile.findFirst({
          where: {
            restaurantId: restaurant.id,
            locationId: device.locationId,
            enabled: true,
            effectiveAt: { lte: profileAsOf },
            verifiedAt: { lte: profileAsOf }
          },
          orderBy: [{ effectiveAt: "desc" }, { verifiedAt: "desc" }, { updatedAt: "desc" }]
        })
      : Promise.resolve(null)
  ]));
  const taxConfiguration = taxProfile ? {
    id: taxProfile.id,
    locationId: taxProfile.locationId,
    provider: taxProfile.provider,
    source: taxProfile.source,
    taxRateBps: taxProfile.taxRateBps,
    taxInclusive: taxProfile.taxInclusive,
    enabled: taxProfile.enabled,
    jurisdictionCode: taxProfile.jurisdictionCode,
    jurisdictionMetadata: taxProfile.jurisdictionJson,
    sourceMetadata: taxProfile.sourceMetadataJson,
    effectiveAt: taxProfile.effectiveAt.toISOString(),
    verifiedAt: taxProfile.verifiedAt.toISOString(),
    configurationVersion: taxProfile.configurationVersion,
    updatedAt: taxProfile.updatedAt
  } : null;
  const offlineReady = Boolean(
    staff
    && device?.status === "ACTIVE"
    && device.deviceType === "MAIN_TERMINAL"
    && shift?.status === "OPEN"
    && shift.cashDrawerId
    && shift.cashDrawer?.status === "OPEN"
    && taxConfiguration?.enabled
    && taxConfiguration.locationId === device.locationId
    && taxConfiguration.configurationVersion
    && taxConfiguration.source
    && taxConfiguration.jurisdictionCode
    && taxConfiguration.taxInclusive === false
    && permissions.includes(POS_PERMISSION.ACCEPT_CASH)
    && permissions.includes(POS_PERMISSION.SEND_TO_KITCHEN)
  );
  const offlineSnapshot = offlineReady
    ? posOfflineConfigurationSnapshot({ restaurant, staff, device, shift, taxConfiguration })
    : null;
  const configurationVersion = offlineSnapshot ? posOfflineConfigurationVersion(offlineSnapshot) : null;
  const serverTime = new Date();
  const offlineValidUntil = offlineReady ? new Date(serverTime.getTime() + POS_OFFLINE_CONFIGURATION_TTL_MS) : null;
  const offlineConfigurationProof = offlineSnapshot
    ? signPosOfflineConfigurationProof({
        ...offlineSnapshot,
        configurationVersion,
        validUntil: offlineValidUntil.toISOString()
      })
    : null;
  return {
    restaurant: {
      id: restaurant.id,
      slug: restaurant.slug,
      name: restaurant.businessName || restaurant.name,
      timezone: restaurant.timezone,
      deliveryFeeCents: cents(restaurant.deliveryFeeCents)
    },
    staff: staff ? { id: staff.id, userId: staff.userId, role: staff.role } : null,
    locations: restaurant.locations,
    deliveryZones: restaurant.deliveryZones,
    orderFieldPolicy: normalizePosOrderFieldPolicy(restaurant.settingsJson),
    permissions,
    device,
    shift,
    cashDrawers,
    registers,
    devices,
    pinStatus: pinStatusForStaff(staff),
    taxConfiguration,
    configurationVersion,
    offlineConfigurationProof,
    offlineValidUntil,
    serverTime
  };
}

export function withPosOfflineMenuProofs({ restaurantId, menuVersion, categories = [] }) {
  return categories.map((category) => ({
    ...category,
    items: (category.items || []).map((item) => ({
      ...item,
      offlinePricingProof: signPosOfflineMenuItemProof({
        schemaVersion: POS_OFFLINE_SCHEMA_VERSION,
        restaurantId,
        menuVersion,
        menuItem: {
          id: item.id,
          name: item.name,
          priceCents: item.priceCents,
          available: item.available !== false,
          customizationMode: item.customizationMode || "AUTO",
          sendToKitchen: item.sendToKitchen !== false,
          options: (item.options || []).map((option) => ({
            id: option.id,
            menuItemId: option.menuItemId,
            optionGroupId: option.optionGroupId || null,
            name: option.name,
            priceCents: option.priceCents,
            required: Boolean(option.required),
            isDefault: Boolean(option.isDefault),
            sortOrder: option.sortOrder || 0
          })),
          optionGroups: (item.optionGroups || []).map((group) => ({
            id: group.id,
            menuItemId: group.menuItemId,
            name: group.name,
            required: Boolean(group.required),
            minSelect: group.minSelect || 0,
            maxSelect: group.maxSelect || 1,
            sortOrder: group.sortOrder || 0,
            options: (group.options || []).map((option) => ({
              id: option.id,
              menuItemId: option.menuItemId,
              optionGroupId: option.optionGroupId || group.id,
              name: option.name,
              priceCents: option.priceCents,
              required: Boolean(option.required),
              isDefault: Boolean(option.isDefault),
              sortOrder: option.sortOrder || 0
            }))
          }))
        }
      })
    }))
  }));
}

export async function posMenu(restaurantId, settingsJson, timings = null) {
  const visibleItemWhere = { restaurantId, available: true, category: { active: true } };
  const [categories, items, groups, options, settings] = await Promise.all([
    recordPosTiming(timings, "menu-categories", () => prisma.menuCategory.findMany({
      where: { restaurantId, active: true },
      orderBy: { name: "asc" }
    })),
    recordPosTiming(timings, "menu-items", () => prisma.menuItem.findMany({
      where: visibleItemWhere,
      orderBy: { name: "asc" }
    })),
    recordPosTiming(timings, "menu-groups", () => prisma.menuItemOptionGroup.findMany({
      where: { menuItem: visibleItemWhere },
      orderBy: { sortOrder: "asc" }
    })),
    recordPosTiming(timings, "menu-options", () => prisma.menuItemOption.findMany({
      where: { menuItem: visibleItemWhere },
      orderBy: { sortOrder: "asc" }
    })),
    settingsJson === undefined
      ? recordPosTiming(timings, "menu-settings", () => prisma.restaurant.findUnique({
          where: { id: restaurantId },
          select: { settingsJson: true }
        }).then((restaurant) => restaurant?.settingsJson))
      : Promise.resolve(settingsJson)
  ]);
  const assembled = assemblePosMenuCategories({ categories, items, groups, options });
  return withMenuCustomizationModes(assembled, settings);
}

export async function posMenuAvailabilityDiagnostics(restaurantId, categories = []) {
  const visibleItems = categories.reduce((total, category) => total + (category.items || []).length, 0);
  const [counts] = await prisma.$queryRaw`
    SELECT
      (SELECT COUNT(*)::int FROM "MenuCategory" WHERE "restaurantId" = ${restaurantId}) AS "totalCategories",
      (SELECT COUNT(*)::int FROM "MenuCategory" WHERE "restaurantId" = ${restaurantId} AND "active" = true) AS "activeCategories",
      (SELECT COUNT(*)::int FROM "MenuCategory" WHERE "restaurantId" = ${restaurantId} AND "active" = false) AS "inactiveCategories",
      (SELECT COUNT(*)::int FROM "MenuItem" WHERE "restaurantId" = ${restaurantId}) AS "totalItems",
      (SELECT COUNT(*)::int FROM "MenuItem" WHERE "restaurantId" = ${restaurantId} AND "available" = true) AS "availableItemsTotal",
      (SELECT COUNT(*)::int FROM "MenuItem" WHERE "restaurantId" = ${restaurantId} AND "available" = false) AS "unavailableItemsTotal",
      (SELECT COUNT(*)::int
        FROM "MenuItem" item
        INNER JOIN "MenuCategory" category ON category."id" = item."categoryId"
        WHERE item."restaurantId" = ${restaurantId} AND item."available" = true AND category."active" = true
      ) AS "activeCategoryAvailableItems"
  `;
  const {
    totalCategories = 0,
    activeCategories = 0,
    inactiveCategories = 0,
    totalItems = 0,
    availableItemsTotal = 0,
    unavailableItemsTotal = 0,
    activeCategoryAvailableItems = 0
  } = counts || {};

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
  const pricing = calculatePosPricingSnapshot({
    lineItems: normalizedItems,
    discountCents,
    deliveryFeeCents,
    taxRateBps: await taxRateBps(restaurantId),
    tipCents: 0
  });
  const { taxCents, tipCents, totalCents } = pricing;
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
    cashTenderedCents: payment?.cashTenderedCents ?? null,
    cashAppliedCents: payment?.cashAppliedCents ?? null,
    changeDueCents: payment?.changeDueCents ?? null,
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

async function createPosOrderTransaction({
  tx,
  restaurantId,
  user,
  quote,
  normalizedCustomer,
  sessionId = null,
  notes = "",
  deviceId = null,
  timing = {}
}) {
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
  const kitchenLineItems = quote.lineItemsJson.filter((line) => line.sendToKitchen !== false);
  const receiptStartedAt = Date.now();
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
  timing.kitchenReceiptMs = Date.now() - receiptStartedAt;
  return { order, receipt };
}

export async function submitPosOrder({
  restaurantId,
  user,
  quoteId,
  sessionId = null,
  customerJson = {},
  notes = "",
  deviceId = null,
  entitlementVerified = false
}) {
  const serviceStartedAt = Date.now();
  if (!entitlementVerified) await assertPosFeature(restaurantId, "POST");
  await assertPosPermission(user, restaurantId, POS_PERMISSION.SEND_TO_KITCHEN);
  const quote = await prisma.orderQuote.findFirst({ where: { id: quoteId, restaurantId } });
  if (!quote || quote.voidedAt) throw httpError("POS quote not found.", 404);
  if (quote.expiresAt < new Date()) throw httpError("POS quote expired. Recalculate the cart.", 409);
  if (quote.acceptedAt) throw httpError("POS quote has already been submitted.", 409);
  const normalizedCustomer = await validatePosOrderSetup({ restaurantId, orderType: quote.orderType, customerJson, quote });

  const transactionStartedAt = Date.now();
  const transactionTiming = {};
  const result = await prisma.$transaction((tx) => createPosOrderTransaction({
    tx,
    restaurantId,
    user,
    quote,
    normalizedCustomer,
    sessionId,
    notes,
    deviceId,
    timing: transactionTiming
  }));
  const dbTransactionMs = Date.now() - transactionStartedAt;
  const kdsStartedAt = Date.now();
  emitKitchenTicketCreated(result.order);
  const kdsMs = Date.now() - kdsStartedAt;
  const auditStartedAt = Date.now();
  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: "pos.order.submitted",
    entityType: "Order",
    entityId: result.order.id,
    metadata: { quoteId, sessionId, totalCents: quote.totalCents }
  });
  const performance = process.env.NODE_ENV === "production" ? undefined : {
    dbTransactionMs,
    receiptMs: transactionTiming.kitchenReceiptMs || 0,
    kdsMs,
    auditMs: Date.now() - auditStartedAt,
    serviceTotalMs: Date.now() - serviceStartedAt
  };
  if (performance) console.info(JSON.stringify({ event: "pos.order.performance", ...performance }));
  return { ...result, ...(performance ? { performance } : {}) };
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

export function cashSettlementAmounts(orderTotalCents, tenderedCents = null, alreadyPaidCents = 0) {
  const total = Number(orderTotalCents);
  const alreadyPaid = Number(alreadyPaidCents);
  const tendered = tenderedCents === null ? total - alreadyPaid : Number(tenderedCents);
  if (![total, alreadyPaid, tendered].every(Number.isSafeInteger) || total < 0 || alreadyPaid < 0 || tendered < 0) {
    throw httpError("Enter a valid cash tender amount.", 400, { code: "POS_CASH_TENDER_INVALID" });
  }
  const amountDueCents = Math.max(0, total - alreadyPaid);
  if (amountDueCents === 0) {
    throw httpError("This order is already paid.", 409, { code: "POS_CASH_ALREADY_PAID" });
  }
  if (tendered < amountDueCents) {
    throw httpError("Cash tender must cover the remaining amount due.", 400, {
      code: "POS_CASH_TENDER_INSUFFICIENT",
      amountDueCents,
      remainingDueCents: amountDueCents - tendered
    });
  }
  return {
    amountDueCents,
    cashTenderedCents: tendered,
    cashAppliedCents: amountDueCents,
    changeDueCents: tendered - amountDueCents
  };
}

async function settleCashOrderTransaction({
  tx,
  restaurantId,
  user,
  order,
  device,
  shift,
  cashDrawer,
  settlement,
  cashTender,
  timing = {}
}) {
  const existingPayment = order.payment;
  const paidAt = new Date();
  const paymentData = {
    provider: "manual_cash",
    status: "PAID",
    amountCents: settlement.cashAppliedCents,
    restaurantNetCents: settlement.cashAppliedCents,
    driverTipCents: order.driverTipCents,
    paidAt
  };
  const paymentStartedAt = Date.now();
  let payment;
  if (existingPayment) {
    const claimed = await tx.payment.updateMany({
      where: { id: existingPayment.id, status: { in: ["PENDING", "FAILED"] } },
      data: paymentData
    });
    if (claimed.count !== 1) throw httpError("This order is already paid.", 409, { code: "POS_CASH_ALREADY_PAID" });
    payment = { ...existingPayment, ...paymentData };
  } else {
    payment = await tx.payment.create({
      data: {
        orderId: order.id,
        ...paymentData
      }
    });
  }
  timing.legacyPaymentMs = Date.now() - paymentStartedAt;

  const orderPaymentStartedAt = Date.now();
  const orderPayment = await tx.restaurantOrderPayment.upsert({
    where: { orderId: order.id },
    update: {
      restaurantId,
      provider: "MANUAL",
      status: "PAID",
      paidAt,
      totalCents: order.totalCents,
      platformFeeCents: 0,
      restaurantGrossCents: order.totalCents,
      restaurantNetCents: order.totalCents,
      restaurantTipCents: order.restaurantTipCents,
      driverTipCents: order.driverTipCents,
      quoteJson: zeroPlatformFeeQuoteJson({ source: "POS_CASH", deviceId: device.id, cashTender })
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
      quoteJson: zeroPlatformFeeQuoteJson({ source: "POS_CASH", deviceId: device.id, cashTender }),
      paidAt
    }
  });
  timing.orderPaymentMs = Date.now() - orderPaymentStartedAt;

  const ledgerStartedAt = Date.now();
  const ledger = await tx.cashLedgerEntry.create({
    data: {
      restaurantId,
      locationId: shift.locationId,
      cashDrawerId: cashDrawer.id,
      shiftId: shift.id,
      orderId: order.id,
      paymentId: payment.id,
      actorUserId: user.id,
      amountCents: settlement.cashAppliedCents,
      entryType: "SALE_CASH",
      note: `Cash payment for ${order.orderNumber}; tendered ${settlement.cashTenderedCents}; change ${settlement.changeDueCents}`
    }
  });
  timing.cashLedgerMs = Date.now() - ledgerStartedAt;

  const drawerBalanceStartedAt = Date.now();
  await tx.cashDrawer.update({
    where: { id: cashDrawer.id },
    data: { currentBalanceCents: { increment: settlement.cashAppliedCents } }
  });
  timing.drawerBalanceMs = Date.now() - drawerBalanceStartedAt;

  const receiptStartedAt = Date.now();
  const receipt = await tx.posReceipt.create({
    data: {
      restaurantId,
      locationId: shift.locationId,
      deviceId: device.id,
      orderId: order.id,
      receiptNumber: randomReceiptNumber("CASH"),
      kind: "CUSTOMER_RECEIPT",
      payloadJson: receiptPayload({
        order,
        quote: { lineItemsJson: [] },
        payment: {
          ...payment,
          cashTenderedCents: settlement.cashTenderedCents,
          cashAppliedCents: settlement.cashAppliedCents,
          changeDueCents: settlement.changeDueCents
        }
      }),
      createdByUserId: user.id
    }
  });
  timing.receiptMs = Date.now() - receiptStartedAt;
  return { payment, orderPayment, ledger, receipt };
}

async function runCashPostCommitTasks({ restaurantId, user, device, cashDrawer, shift, order, paymentId, settlement }) {
  const startedAt = Date.now();
  const drawerStartedAt = Date.now();
  const drawerRequest = await requestCashDrawerOpen({
    restaurantId,
    actorUserId: user.id,
    device,
    cashDrawer,
    shift,
    orderId: order.id,
    paymentId,
    reason: "COMPLETED_CASH_SALE"
  }).catch((error) => ({
    requested: false,
    physicalOpenRequested: false,
    hardwareStatus: "REQUEST_FAILED",
    errorCode: error?.code || "DRAWER_REQUEST_FAILED"
  }));
  const drawerMs = Date.now() - drawerStartedAt;
  const auditStartedAt = Date.now();
  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: "pos.payment.cash.accepted",
    entityType: "Payment",
    entityId: paymentId,
    metadata: { orderId: order.id, deviceId: device.id, cashDrawerId: cashDrawer.id, ...settlement, drawerRequest }
  });
  if (process.env.NODE_ENV !== "production") {
    console.info(JSON.stringify({
      event: "pos.cash.post_commit.performance",
      drawerMs,
      auditMs: Date.now() - auditStartedAt,
      totalMs: Date.now() - startedAt,
      hardwareStatus: drawerRequest.hardwareStatus
    }));
  }
}

async function recoverSettledCashQuote({ restaurantId, quoteId, locationId }) {
  const audit = await prisma.auditLog.findFirst({
    where: {
      restaurantId,
      action: "pos.cash.quote.settled",
      entityType: "OrderQuote",
      entityId: quoteId
    },
    orderBy: { createdAt: "desc" }
  });
  const metadata = safeJson(audit?.metadataJson, {});
  if (!metadata.orderId) return null;
  const order = await prisma.order.findFirst({
    where: {
      id: metadata.orderId,
      restaurantId,
      ...(locationId ? { locationId } : { locationId: null })
    },
    include: {
      customer: true,
      location: true,
      items: true,
      statusHistory: { orderBy: { createdAt: "asc" } },
      payment: true,
      restaurantOrderPayment: true
    }
  });
  if (!order?.payment || !order.restaurantOrderPayment) return null;
  const [ledger, receipt] = await Promise.all([
    metadata.ledgerId ? prisma.cashLedgerEntry.findFirst({ where: { id: metadata.ledgerId, restaurantId } }) : null,
    metadata.receiptId ? prisma.posReceipt.findFirst({ where: { id: metadata.receiptId, restaurantId } }) : null
  ]);
  const settlement = safeJson(metadata.settlement, {});
  return {
    order,
    payment: order.payment,
    orderPayment: order.restaurantOrderPayment,
    ledger,
    receipt,
    ...settlement,
    amountReceivedCents: settlement.cashTenderedCents,
    drawerRequest: safeJson(metadata.drawerRequest, {
      requested: true,
      physicalOpenRequested: false,
      hardwareStatus: "ALREADY_DISPATCHED"
    }),
    recovered: true
  };
}

async function cashPaymentFromQuote({
  restaurantId,
  user,
  quoteId,
  customerJson = {},
  notes = "",
  deviceId,
  fingerprint,
  amountCents = null,
  entitlementVerified = false,
  sessionDevice = null
}) {
  const serviceStartedAt = Date.now();
  const entitlementStartedAt = Date.now();
  if (!entitlementVerified) await assertPosFeature(restaurantId, "POST");
  const entitlementMs = Date.now() - entitlementStartedAt;
  const accessStartedAt = Date.now();
  const [{ device, shift, cashDrawer }, quote] = await Promise.all([
    requireCashRegisterAccess({ restaurantId, user, deviceId, fingerprint, verifiedDevice: sessionDevice }),
    prisma.orderQuote.findFirst({ where: { id: quoteId, restaurantId } }),
    assertPosPermission(user, restaurantId, POS_PERMISSION.SEND_TO_KITCHEN)
  ]);
  const locationId = shift.locationId || device.locationId || null;
  const accessAndOrderMs = Date.now() - accessStartedAt;
  if (!quote || quote.voidedAt) throw httpError("POS quote not found.", 404, { code: "POS_CASH_QUOTE_NOT_FOUND" });
  if ((quote.locationId || null) !== locationId) {
    throw httpError("POS quote does not belong to this register location.", 404, { code: "POS_CASH_QUOTE_NOT_FOUND" });
  }
  if (quote.deviceId && quote.deviceId !== device.id) {
    throw httpError("POS quote belongs to a different register.", 403, { code: "POS_CASH_QUOTE_DEVICE_MISMATCH" });
  }
  if (quote.acceptedAt) {
    const recovered = await recoverSettledCashQuote({ restaurantId, quoteId, locationId });
    if (!recovered) throw httpError("POS quote has already been submitted.", 409, { code: "POS_CASH_QUOTE_ALREADY_SUBMITTED" });
    const performance = process.env.NODE_ENV === "production" ? undefined : {
      entitlementMs,
      accessAndOrderMs,
      dbTransactionMs: 0,
      paymentSettlementMs: 0,
      cashLedgerMs: 0,
      drawerBalanceMs: 0,
      receiptMs: 0,
      drawerDispatchMs: 0,
      kdsMs: 0,
      serviceTotalMs: Date.now() - serviceStartedAt,
      postCommit: "already-dispatched",
      recovered: true
    };
    return { ...recovered, ...(performance ? { performance } : {}) };
  }
  if (quote.expiresAt < new Date()) throw httpError("POS quote expired. Recalculate the cart.", 409, { code: "POS_CASH_QUOTE_EXPIRED" });

  const normalizedCustomer = await validatePosOrderSetup({ restaurantId, orderType: quote.orderType, customerJson, quote });
  const settlement = cashSettlementAmounts(quote.totalCents, amountCents, 0);
  const cashTender = {
    tenderType: "CASH",
    restaurantId,
    locationId,
    amountDueCents: settlement.amountDueCents,
    tenderedCents: settlement.cashTenderedCents,
    appliedCents: settlement.cashAppliedCents,
    changeDueCents: settlement.changeDueCents,
    cashierUserId: user.id,
    shiftId: shift.id,
    deviceId: device.id,
    cashDrawerId: cashDrawer.id,
    settledAt: new Date().toISOString()
  };
  const drawerRequest = { requested: true, physicalOpenRequested: false, hardwareStatus: "DISPATCHED" };

  const transactionStartedAt = Date.now();
  const transactionTiming = {};
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const orderResult = await createPosOrderTransaction({
        tx,
        restaurantId,
        user,
        quote,
        normalizedCustomer,
        sessionId: quote.sessionId || null,
        notes,
        deviceId: device.id,
        timing: transactionTiming
      });
      const cashResult = await settleCashOrderTransaction({
        tx,
        restaurantId,
        user,
        order: orderResult.order,
        device,
        shift,
        cashDrawer,
        settlement,
        cashTender,
        timing: transactionTiming
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          restaurantId,
          action: "pos.cash.quote.settled",
          entityType: "OrderQuote",
          entityId: quote.id,
          metadataJson: {
            orderId: orderResult.order.id,
            paymentId: cashResult.payment.id,
            ledgerId: cashResult.ledger.id,
            receiptId: cashResult.receipt.id,
            settlement,
            drawerRequest
          }
        }
      });
      return { order: orderResult.order, kitchenReceipt: orderResult.receipt, ...cashResult };
    });
  } catch (error) {
    if (error?.code === "P2002") {
      throw httpError("This order is already paid.", 409, { code: "POS_CASH_ALREADY_PAID" });
    }
    if (error?.status === 409) {
      const recovered = await recoverSettledCashQuote({ restaurantId, quoteId, locationId });
      if (recovered) return recovered;
    }
    throw error;
  }
  const dbTransactionMs = Date.now() - transactionStartedAt;
  const kdsStartedAt = Date.now();
  emitKitchenTicketCreated(result.order);
  const kdsMs = Date.now() - kdsStartedAt;
  const drawerDispatchStartedAt = Date.now();
  const postCommitTask = Promise.all([
    runCashPostCommitTasks({
      restaurantId,
      user,
      device,
      cashDrawer,
      shift,
      order: result.order,
      paymentId: result.payment.id,
      settlement
    }),
    recordAudit({
      actorUserId: user.id,
      restaurantId,
      action: "pos.order.submitted",
      entityType: "Order",
      entityId: result.order.id,
      metadata: { quoteId, sessionId: quote.sessionId || null, totalCents: quote.totalCents }
    })
  ]);
  void postCommitTask.catch((error) => {
    console.error(JSON.stringify({ event: "pos.cash.post_commit.failed", code: error?.code || "POST_COMMIT_FAILED" }));
  });
  const performance = process.env.NODE_ENV === "production" ? undefined : {
    entitlementMs,
    accessAndOrderMs,
    dbTransactionMs,
    paymentSettlementMs: (transactionTiming.legacyPaymentMs || 0) + (transactionTiming.orderPaymentMs || 0),
    cashLedgerMs: transactionTiming.cashLedgerMs || 0,
    drawerBalanceMs: transactionTiming.drawerBalanceMs || 0,
    receiptMs: (transactionTiming.kitchenReceiptMs || 0) + (transactionTiming.receiptMs || 0),
    drawerDispatchMs: Date.now() - drawerDispatchStartedAt,
    kdsMs,
    serviceTotalMs: Date.now() - serviceStartedAt,
    postCommit: "deferred"
  };
  if (performance) console.info(JSON.stringify({ event: "pos.cash.performance", ...performance }));
  return {
    ...result,
    ...settlement,
    amountReceivedCents: settlement.cashTenderedCents,
    drawerRequest,
    ...(performance ? { performance } : {})
  };
}

function posOfflineError(message, code, status = 422, details = {}) {
  return httpError(message, status, { code, ...details });
}

function requiredPosOfflineString(value, field, maximum = 240) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) {
    throw posOfflineError("Offline transaction identity is invalid.", "POS_OFFLINE_IDENTITY_INVALID", 422, { field });
  }
  return normalized;
}

function assertPosOfflinePayloadSecurity(value, path = "transaction") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (/password|rawpin|cardnumber|card_number|cvv|databaseurl|database_url|servicerole|service_role|jwtsecret|jwt_secret/i.test(key)) {
      throw posOfflineError("Offline transaction contains a prohibited field.", "POS_OFFLINE_PROHIBITED_DATA", 422, { field: nestedPath });
    }
    assertPosOfflinePayloadSecurity(nested, nestedPath);
  }
}

function verifyPosOfflineProofAtCompletion(token, verify, completedAt, invalidCode) {
  let proof;
  try {
    proof = verify(token, { ignoreExpiration: true });
  } catch {
    throw posOfflineError("Offline transaction proof is invalid.", invalidCode);
  }
  const completedAtMs = new Date(completedAt).getTime();
  const issuedAtMs = Number(proof.iat || 0) * 1000;
  const expiresAtMs = Number(proof.exp || 0) * 1000;
  if (
    !Number.isFinite(completedAtMs)
    || !issuedAtMs
    || !expiresAtMs
    || completedAtMs < issuedAtMs - (5 * 60 * 1000)
    || completedAtMs > expiresAtMs
    || completedAtMs > Date.now() + (15 * 60 * 1000)
  ) {
    throw posOfflineError("Offline transaction was not completed during the signed configuration window.", "POS_OFFLINE_PROOF_WINDOW_INVALID");
  }
  return proof;
}

function validatePosOfflineOrderSetup({ orderType, customerJson, orderFieldPolicy }) {
  const customer = normalizePosCustomer(customerJson);
  const policy = safeJson(orderFieldPolicy, {})[orderType] || {};
  const missingFields = Object.entries(policy)
    .filter(([, mode]) => mode === "REQUIRED")
    .map(([field]) => field)
    .filter((field) => !customer[field]);
  if (missingFields.length) {
    throw posOfflineError("Required offline order setup details are missing.", "POS_ORDER_SETUP_REQUIRED", 422, { fields: missingFields });
  }
  for (const field of ["guestCount", "headcount"]) {
    if (customer[field] && (!Number.isInteger(Number(customer[field])) || Number(customer[field]) < 1)) {
      throw posOfflineError("Offline order setup is invalid.", "POS_ORDER_SETUP_INVALID", 422, { field });
    }
  }
  for (const [field, mode] of Object.entries(policy)) {
    if (mode === "HIDDEN") customer[field] = "";
  }
  return customer;
}

function validatePosOfflineMenuLines({ transaction, configurationProof }) {
  const rawLines = transaction.orderSnapshot?.lineItems;
  if (!Array.isArray(rawLines) || !rawLines.length || rawLines.length > 100) {
    throw posOfflineError("Offline transaction requires between 1 and 100 line items.", "POS_OFFLINE_ITEMS_INVALID");
  }
  let menuVersion = null;
  const lines = rawLines.map((line, index) => {
    const proof = verifyPosOfflineProofAtCompletion(
      line?.offlinePricingProof,
      verifyPosOfflineMenuItemProof,
      transaction.completedAt,
      "POS_OFFLINE_MENU_PROOF_INVALID"
    );
    if (proof.restaurantId !== transaction.restaurantId || proof.menuItem?.id !== String(line?.menuItemId || "")) {
      throw posOfflineError("Offline menu item proof does not match this transaction.", "POS_OFFLINE_MENU_PROOF_MISMATCH", 422, { index });
    }
    if (menuVersion && menuVersion !== proof.menuVersion) {
      throw posOfflineError("Offline transaction mixes menu configuration versions.", "POS_OFFLINE_MENU_VERSION_MISMATCH");
    }
    menuVersion = proof.menuVersion;
    const menuItem = proof.menuItem;
    if (!menuItem?.available) {
      throw posOfflineError("Offline menu item was not available in the signed snapshot.", "POS_OFFLINE_MENU_ITEM_UNAVAILABLE", 422, { index });
    }
    let selected;
    try {
      selected = validateSelectedModifiers(menuItem, { modifierSelections: line.modifierSelections || [] });
    } catch (error) {
      throw posOfflineError(error.message, error.code || "POS_OFFLINE_MODIFIER_INVALID", 422, { index });
    }
    const quantity = Number(line.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
      throw posOfflineError("Offline item quantity is invalid.", "POS_OFFLINE_QUANTITY_INVALID", 422, { index });
    }
    const unitPriceCents = cents(menuItem.priceCents) + selected.modifiers.reduce((sum, option) => sum + cents(option.priceCents), 0);
    if (unitPriceCents !== Number(line.unitPriceCents) || Number(line.basePriceCents) !== cents(menuItem.priceCents)) {
      throw posOfflineError("Offline menu item price does not match its signed snapshot.", "POS_OFFLINE_ITEM_PRICE_MISMATCH", 422, { index });
    }
    return {
      menuItemId: menuItem.id,
      name: menuItem.name,
      quantity,
      unitPriceCents,
      basePriceCents: cents(menuItem.priceCents),
      optionIds: selected.optionIds,
      modifierOptionIds: selected.optionIds,
      modifiers: selected.modifiers,
      options: selected.modifiers,
      sendToKitchen: menuItem.sendToKitchen !== false,
      specialInstructions: String(line.specialInstructions || "").slice(0, 500),
      lineTotalCents: unitPriceCents * quantity
    };
  });
  const expectedVersion = `${configurationProof.configurationVersion}::${menuVersion}`;
  if (transaction.configurationVersion !== expectedVersion) {
    throw posOfflineError("Offline configuration version does not match its signed snapshots.", "POS_OFFLINE_CONFIGURATION_VERSION_MISMATCH");
  }
  return lines;
}

function validatePosOfflineTransaction({ transaction, restaurantId, user, sessionStaff, sessionDevice }) {
  if (!transaction || typeof transaction !== "object" || Array.isArray(transaction)) {
    throw posOfflineError("Offline transaction payload is required.", "POS_OFFLINE_TRANSACTION_REQUIRED", 400);
  }
  if (Buffer.byteLength(JSON.stringify(transaction), "utf8") > 512 * 1024) {
    throw posOfflineError("Offline transaction payload is too large.", "POS_OFFLINE_TRANSACTION_TOO_LARGE", 413);
  }
  assertPosOfflinePayloadSecurity(transaction);
  if (Number(transaction.schemaVersion) !== POS_OFFLINE_SCHEMA_VERSION) {
    throw posOfflineError("Offline transaction schema version is unsupported.", "POS_OFFLINE_SCHEMA_UNSUPPORTED");
  }
  const localTransactionId = requiredPosOfflineString(transaction.localTransactionId, "localTransactionId");
  const idempotencyKey = requiredPosOfflineString(transaction.idempotencyKey, "idempotencyKey");
  const transactionRestaurantId = requiredPosOfflineString(transaction.restaurantId, "restaurantId");
  const transactionTenantId = requiredPosOfflineString(transaction.tenantId, "tenantId");
  const terminalId = requiredPosOfflineString(transaction.terminalId, "terminalId");
  const staffId = requiredPosOfflineString(transaction.staffId, "staffId");
  const locationId = requiredPosOfflineString(transaction.locationId, "locationId");
  const shiftId = requiredPosOfflineString(transaction.shiftId, "shiftId");
  const cashDrawerId = requiredPosOfflineString(transaction.cashDrawerId, "cashDrawerId");
  if (
    transactionRestaurantId !== restaurantId
    || transactionTenantId !== restaurantId
    || terminalId !== sessionDevice?.id
    || staffId !== sessionStaff?.id
    || sessionStaff?.id !== transaction.staffId
  ) {
    throw posOfflineError("Offline transaction does not match the authenticated tenant or register.", "POS_OFFLINE_CONTEXT_MISMATCH", 403);
  }
  if ((sessionDevice.locationId || null) !== locationId) {
    throw posOfflineError("Offline transaction location does not match the authenticated register.", "POS_OFFLINE_LOCATION_MISMATCH", 403);
  }
  const configurationProof = verifyPosOfflineProofAtCompletion(
    transaction.offlineConfigurationProof,
    verifyPosOfflineConfigurationProof,
    transaction.completedAt,
    "POS_OFFLINE_CONFIGURATION_PROOF_INVALID"
  );
  for (const [field, expected] of Object.entries({
    restaurantId,
    userId: user.id,
    staffId,
    deviceId: terminalId,
    locationId,
    shiftId,
    cashDrawerId
  })) {
    if ((configurationProof[field] || null) !== (expected || null)) {
      throw posOfflineError("Offline configuration proof does not match the authenticated register.", "POS_OFFLINE_CONFIGURATION_PROOF_MISMATCH", 403, { field });
    }
  }
  const orderType = ORDER_TYPES.has(transaction.orderSnapshot?.orderType) ? transaction.orderSnapshot.orderType : null;
  if (!orderType) throw posOfflineError("Offline order type is invalid.", "POS_OFFLINE_ORDER_TYPE_INVALID");
  const lineItems = validatePosOfflineMenuLines({ transaction, configurationProof });
  const subtotalCents = lineItems.reduce((sum, line) => sum + line.lineTotalCents, 0);
  let delivery;
  try {
    delivery = resolvePosDeliveryPricingSnapshot({
      orderType,
      deliveryZones: configurationProof.deliveryZones,
      defaultDeliveryFeeCents: configurationProof.deliveryFeeCents,
      deliveryZoneId: transaction.orderSnapshot?.customer?.deliveryZoneId,
      subtotalCents
    });
  } catch (error) {
    throw posOfflineError(error.message, error.code || "POS_OFFLINE_DELIVERY_INVALID");
  }
  if (delivery.deliveryFeeCents !== Number(transaction.orderSnapshot?.deliveryFeeCents)) {
    throw posOfflineError("Offline delivery price does not match its signed configuration.", "POS_OFFLINE_DELIVERY_PRICE_MISMATCH");
  }
  if (
    !configurationProof.taxConfiguration
    || configurationProof.taxConfiguration.locationId !== locationId
    || Number(configurationProof.taxConfiguration.taxRateBps) !== Number(transaction.taxSnapshot?.taxRateBps)
    || String(configurationProof.taxConfiguration.provider || "manual") !== String(transaction.taxSnapshot?.provider || "manual")
    || String(configurationProof.taxConfiguration.source || "") !== String(transaction.taxSnapshot?.source || "")
    || String(configurationProof.taxConfiguration.jurisdictionCode || "") !== String(transaction.taxSnapshot?.jurisdictionCode || "")
    || configurationProof.taxConfiguration.configurationVersion !== transaction.taxSnapshot?.profileVersion
    || transaction.taxSnapshot?.configurationVersion !== transaction.configurationVersion
  ) {
    throw posOfflineError("Offline tax does not match its signed configuration.", "POS_OFFLINE_TAX_CONFIGURATION_MISMATCH");
  }
  const normalizedTransaction = {
    ...transaction,
    orderSnapshot: { ...transaction.orderSnapshot, lineItems }
  };
  try {
    validatePosOfflinePricingSnapshot(normalizedTransaction);
  } catch (error) {
    throw posOfflineError(error.message, error.code || "POS_OFFLINE_PRICING_MISMATCH");
  }
  if (transaction.paymentSnapshot?.method !== "CASH") {
    throw posOfflineError("Only cash can be reconciled from Offline v1.", "POS_OFFLINE_PAYMENT_METHOD_INVALID");
  }
  let settlement;
  try {
    settlement = cashSettlementAmounts(
      Number(transaction.orderSnapshot.totalCents),
      Number(transaction.paymentSnapshot.cashTenderedCents),
      0
    );
  } catch (error) {
    throw posOfflineError(error.message, error.code || "POS_OFFLINE_TENDER_INVALID");
  }
  for (const field of ["amountDueCents", "cashTenderedCents", "cashAppliedCents", "changeDueCents"]) {
    if (Number(transaction.paymentSnapshot[field]) !== settlement[field]) {
      throw posOfflineError("Offline cash tender snapshot failed validation.", "POS_OFFLINE_TENDER_MISMATCH", 422, { field });
    }
  }
  const normalizedCustomer = validatePosOfflineOrderSetup({
    orderType,
    customerJson: transaction.orderSnapshot.customer,
    orderFieldPolicy: configurationProof.orderFieldPolicy
  });
  return {
    transaction: normalizedTransaction,
    localTransactionId,
    idempotencyKey,
    terminalId,
    staffId,
    locationId,
    shiftId,
    cashDrawerId,
    orderType,
    lineItems,
    normalizedCustomer,
    configurationProof,
    settlement
  };
}

async function loadPosOfflineCanonicalResult(reconciliation) {
  if (!reconciliation?.orderId || !reconciliation.paymentId) return null;
  const [order, payment, orderPayment, ledger, receipt, kitchenReceipt] = await Promise.all([
    prisma.order.findFirst({
      where: { id: reconciliation.orderId, restaurantId: reconciliation.restaurantId },
      include: { customer: true, location: true, items: true, statusHistory: { orderBy: { createdAt: "asc" } } }
    }),
    prisma.payment.findUnique({ where: { id: reconciliation.paymentId } }),
    prisma.restaurantOrderPayment.findUnique({ where: { orderId: reconciliation.orderId } }),
    reconciliation.cashLedgerEntryId ? prisma.cashLedgerEntry.findUnique({ where: { id: reconciliation.cashLedgerEntryId } }) : null,
    reconciliation.customerReceiptId ? prisma.posReceipt.findUnique({ where: { id: reconciliation.customerReceiptId } }) : null,
    reconciliation.kitchenReceiptId ? prisma.posReceipt.findUnique({ where: { id: reconciliation.kitchenReceiptId } }) : null
  ]);
  if (!order || !payment || !orderPayment || !ledger || !receipt) return null;
  return { order, payment, orderPayment, ledger, receipt, kitchenReceipt };
}

async function dispatchPosOfflinePostCommit({ reconciliation, canonical, user, device, shift, cashDrawer, settlement }) {
  if (canonical.kitchenReceipt && !reconciliation.kdsDispatchedAt) {
    const claimed = await prisma.posOfflineReconciliation.updateMany({
      where: { id: reconciliation.id, kdsDispatchedAt: null },
      data: { kdsDispatchedAt: new Date() }
    });
    if (claimed.count === 1) {
      emitKitchenTicketCreated(canonical.order, { eventId: `pos-offline:${reconciliation.id}` });
    }
  }
  if (!reconciliation.cashDrawerDispatchedAt) {
    const claimed = await prisma.posOfflineReconciliation.updateMany({
      where: { id: reconciliation.id, cashDrawerDispatchedAt: null },
      data: { cashDrawerDispatchedAt: new Date() }
    });
    if (claimed.count === 1) {
      await runCashPostCommitTasks({
        restaurantId: reconciliation.restaurantId,
        user,
        device,
        cashDrawer,
        shift,
        order: canonical.order,
        paymentId: canonical.payment.id,
        settlement
      });
    }
  }
}

export async function reconcilePosOfflineCashTransaction({
  restaurantId,
  user,
  body,
  sessionStaff,
  sessionDevice,
  entitlementVerified = false
}) {
  if (!entitlementVerified) await assertPosFeature(restaurantId, "POST");
  await Promise.all([
    assertPosPermission(user, restaurantId, POS_PERMISSION.ACCEPT_CASH),
    assertPosPermission(user, restaurantId, POS_PERMISSION.SEND_TO_KITCHEN)
  ]);
  const validated = validatePosOfflineTransaction({
    transaction: body?.transaction,
    restaurantId,
    user,
    sessionStaff,
    sessionDevice
  });
  const completedAt = new Date(validated.transaction.completedAt);
  const shift = await prisma.employeeShift.findFirst({
    where: {
      id: validated.shiftId,
      restaurantId,
      employeeUserId: user.id,
      deviceId: validated.terminalId,
      cashDrawerId: validated.cashDrawerId
    },
    include: { cashDrawer: true }
  });
  const effectiveShiftLocationId = shift?.locationId || sessionDevice?.locationId || null;
  if (
    !shift
    || effectiveShiftLocationId !== validated.locationId
    || shift.cashDrawer?.restaurantId !== restaurantId
    || (shift.cashDrawer?.locationId && shift.cashDrawer.locationId !== validated.locationId)
    || shift.openedAt > completedAt
    || (shift.closedAt && shift.closedAt < completedAt)
    || !shift.cashDrawer
  ) {
    throw posOfflineError("The cached shift was not valid when this offline cash sale completed.", "POS_OFFLINE_SHIFT_INVALID", 409);
  }
  // Older open shifts can predate a terminal's location assignment. The signed
  // transaction and authenticated terminal remain authoritative for that null scope.
  const settlementShift = shift.locationId ? shift : { ...shift, locationId: validated.locationId };
  const cashDrawer = shift.cashDrawer;
  let reconciliation;
  let canonical;
  let duplicate = false;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const record = await tx.posOfflineReconciliation.create({
        data: {
          restaurantId,
          locationId: validated.locationId,
          deviceId: validated.terminalId,
          staffId: validated.staffId,
          shiftId: validated.shiftId,
          localTransactionId: validated.localTransactionId,
          idempotencyKey: validated.idempotencyKey,
          configurationVersion: validated.transaction.configurationVersion,
          status: "PROCESSING",
          payloadJson: validated.transaction
        }
      });
      const quote = await tx.orderQuote.create({
        data: {
          restaurantId,
          locationId: validated.locationId,
          deviceId: validated.terminalId,
          createdByUserId: user.id,
          orderType: validated.orderType,
          lineItemsJson: validated.lineItems,
          subtotalCents: validated.transaction.orderSnapshot.subtotalCents,
          discountCents: validated.transaction.orderSnapshot.discountCents,
          deliveryFeeCents: validated.transaction.orderSnapshot.deliveryFeeCents,
          taxCents: validated.transaction.orderSnapshot.taxCents,
          tipCents: validated.transaction.orderSnapshot.tipCents,
          totalCents: validated.transaction.orderSnapshot.totalCents,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000)
        }
      });
      const orderResult = await createPosOrderTransaction({
        tx,
        restaurantId,
        user,
        quote,
        normalizedCustomer: validated.normalizedCustomer,
        notes: validated.transaction.orderSnapshot.notes,
        deviceId: validated.terminalId
      });
      await tx.orderTaxSnapshot.create({
        data: {
          orderId: orderResult.order.id,
          restaurantId,
          provider: validated.configurationProof.taxConfiguration.provider,
          taxableAmountCents: validated.transaction.taxSnapshot.taxableAmountCents,
          taxRateBps: validated.transaction.taxSnapshot.taxRateBps,
          taxCents: validated.transaction.taxSnapshot.taxCents,
          jurisdictionJson: {
            source: validated.configurationProof.taxConfiguration.source,
            sourceMetadata: validated.configurationProof.taxConfiguration.sourceMetadata,
            jurisdictionCode: validated.configurationProof.taxConfiguration.jurisdictionCode,
            jurisdictionMetadata: validated.configurationProof.taxConfiguration.jurisdictionMetadata,
            taxProfileVersion: validated.configurationProof.taxConfiguration.configurationVersion,
            taxProfileEffectiveAt: validated.configurationProof.taxConfiguration.effectiveAt,
            taxProfileVerifiedAt: validated.configurationProof.taxConfiguration.verifiedAt,
            offlineConfigurationVersion: validated.transaction.configurationVersion,
            localTransactionId: validated.localTransactionId,
            localCompletedAt: validated.transaction.completedAt,
            timezone: validated.transaction.timezone || null
          }
        }
      });
      const cashTender = {
        tenderType: "CASH",
        source: "POS_OFFLINE_V1",
        restaurantId,
        locationId: validated.locationId,
        amountDueCents: validated.settlement.amountDueCents,
        tenderedCents: validated.settlement.cashTenderedCents,
        appliedCents: validated.settlement.cashAppliedCents,
        changeDueCents: validated.settlement.changeDueCents,
        cashierUserId: user.id,
        shiftId: shift.id,
        deviceId: sessionDevice.id,
        cashDrawerId: cashDrawer.id,
        localTransactionId: validated.localTransactionId,
        idempotencyKey: validated.idempotencyKey,
        localCompletedAt: validated.transaction.completedAt,
        settledAt: new Date().toISOString()
      };
      const cashResult = await settleCashOrderTransaction({
        tx,
        restaurantId,
        user,
        order: orderResult.order,
        device: sessionDevice,
        shift: settlementShift,
        cashDrawer,
        settlement: validated.settlement,
        cashTender
      });
      const updated = await tx.posOfflineReconciliation.update({
        where: { id: record.id },
        data: {
          status: "SYNCED",
          orderId: orderResult.order.id,
          paymentId: cashResult.payment.id,
          cashLedgerEntryId: cashResult.ledger.id,
          customerReceiptId: cashResult.receipt.id,
          kitchenReceiptId: orderResult.receipt?.id || null,
          reconciledAt: new Date()
        }
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          restaurantId,
          action: "pos.offline.cash.reconciled",
          entityType: "PosOfflineReconciliation",
          entityId: updated.id,
          metadataJson: {
            localTransactionId: validated.localTransactionId,
            idempotencyKey: validated.idempotencyKey,
            orderId: orderResult.order.id,
            paymentId: cashResult.payment.id,
            ledgerId: cashResult.ledger.id,
            receiptId: cashResult.receipt.id,
            kitchenReceiptId: orderResult.receipt?.id || null,
            localCompletedAt: validated.transaction.completedAt
          }
        }
      });
      return {
        reconciliation: updated,
        canonical: { order: orderResult.order, kitchenReceipt: orderResult.receipt, ...cashResult }
      };
    });
    reconciliation = result.reconciliation;
    canonical = result.canonical;
  } catch (error) {
    if (["P2003", "P2025"].includes(error?.code)) {
      throw posOfflineError(
        "Offline transaction can no longer be mapped to canonical cloud data and needs review.",
        "POS_OFFLINE_CANONICAL_CONFLICT",
        409
      );
    }
    if (error?.code !== "P2002") throw error;
    reconciliation = await prisma.posOfflineReconciliation.findFirst({
      where: {
        restaurantId,
        OR: [
          { localTransactionId: validated.localTransactionId },
          { idempotencyKey: validated.idempotencyKey }
        ]
      }
    });
    if (!reconciliation) throw error;
    if (
      reconciliation.localTransactionId !== validated.localTransactionId
      || reconciliation.idempotencyKey !== validated.idempotencyKey
    ) {
      throw posOfflineError("Offline idempotency identity conflicts with another transaction.", "POS_OFFLINE_IDEMPOTENCY_CONFLICT", 409);
    }
    canonical = await loadPosOfflineCanonicalResult(reconciliation);
    if (!canonical) {
      throw posOfflineError("Offline reconciliation is still processing. Retry shortly.", "POS_OFFLINE_SYNC_IN_PROGRESS", 409);
    }
    duplicate = true;
  }
  await dispatchPosOfflinePostCommit({
    reconciliation,
    canonical,
    user,
    device: sessionDevice,
    shift: settlementShift,
    cashDrawer,
    settlement: validated.settlement
  });
  return {
    reconciliationId: reconciliation.id,
    localTransactionId: reconciliation.localTransactionId,
    idempotencyKey: reconciliation.idempotencyKey,
    serverSyncedAt: reconciliation.reconciledAt,
    duplicate,
    ...canonical,
    canonicalOrderId: canonical.order.id,
    canonicalPaymentId: canonical.payment.id,
    canonicalLedgerId: canonical.ledger.id,
    canonicalReceiptId: canonical.receipt.id,
    canonicalKitchenReceiptId: canonical.kitchenReceipt?.id || null,
    ...validated.settlement
  };
}

export async function cashPayment({
  restaurantId,
  user,
  orderId,
  quoteId = null,
  customerJson = {},
  notes = "",
  deviceId,
  fingerprint,
  amountCents = null,
  entitlementVerified = false,
  sessionDevice = null
}) {
  if (!orderId && quoteId) {
    return cashPaymentFromQuote({
      restaurantId,
      user,
      quoteId,
      customerJson,
      notes,
      deviceId,
      fingerprint,
      amountCents,
      entitlementVerified,
      sessionDevice
    });
  }
  if (!orderId) throw httpError("orderId or quoteId is required.", 400, { code: "POS_CASH_ORDER_REQUIRED" });
  const serviceStartedAt = Date.now();
  const entitlementStartedAt = Date.now();
  if (!entitlementVerified) await assertPosFeature(restaurantId, "POST");
  const entitlementMs = Date.now() - entitlementStartedAt;
  const accessStartedAt = Date.now();
  const sessionLocationId = sessionDevice?.locationId || null;
  const findOrder = (locationId) => prisma.order.findFirst({
    where: { id: orderId, restaurantId, ...(locationId ? { locationId } : { locationId: null }) },
    include: { items: true, payment: true, restaurantOrderPayment: true }
  });
  const accessPromise = requireCashRegisterAccess({
    restaurantId,
    user,
    deviceId,
    fingerprint,
    verifiedDevice: sessionDevice
  });
  const orderPromise = sessionDevice ? findOrder(sessionLocationId) : Promise.resolve(null);
  const [{ device, shift, cashDrawer }, sessionScopedOrder] = await Promise.all([accessPromise, orderPromise]);
  const locationId = shift.locationId || device.locationId || null;
  const order = sessionDevice && locationId === sessionLocationId
    ? sessionScopedOrder
    : await findOrder(locationId);
  const accessAndOrderMs = Date.now() - accessStartedAt;
  if (!order) throw httpError("Order not found for this register location.", 404, { code: "POS_CASH_ORDER_NOT_FOUND" });
  const settledPaymentStatuses = new Set(["AUTHORIZED", "PAID", "REFUNDED"]);
  const recoverableOrderPaymentStatuses = new Set(["REQUIRES_PAYMENT_METHOD", "FAILED", "CANCELED"]);
  if (
    settledPaymentStatuses.has(order.payment?.status)
    || (order.restaurantOrderPayment && !recoverableOrderPaymentStatuses.has(order.restaurantOrderPayment.status))
  ) {
    throw httpError("This order already has an active or completed payment.", 409, { code: "POS_CASH_ALREADY_PAID" });
  }
  const settlement = cashSettlementAmounts(order.totalCents, amountCents, 0);
  const cashTender = {
    tenderType: "CASH",
    restaurantId,
    locationId,
    amountDueCents: settlement.amountDueCents,
    tenderedCents: settlement.cashTenderedCents,
    appliedCents: settlement.cashAppliedCents,
    changeDueCents: settlement.changeDueCents,
    cashierUserId: user.id,
    shiftId: shift.id,
    deviceId: device.id,
    cashDrawerId: cashDrawer.id,
    settledAt: new Date().toISOString()
  };

  const transactionStartedAt = Date.now();
  const transactionTiming = {};
  const result = await prisma.$transaction((tx) => settleCashOrderTransaction({
    tx,
    restaurantId,
    user,
    order,
    device,
    shift,
    cashDrawer,
    settlement,
    cashTender,
    timing: transactionTiming
  })).catch((error) => {
    if (error?.code === "P2002") {
      throw httpError("This order is already paid.", 409, { code: "POS_CASH_ALREADY_PAID" });
    }
    throw error;
  });
  const dbTransactionMs = Date.now() - transactionStartedAt;
  const drawerDispatchStartedAt = Date.now();
  const drawerRequest = { requested: true, physicalOpenRequested: false, hardwareStatus: "DISPATCHED" };
  const postCommitTask = runCashPostCommitTasks({
    restaurantId,
    user,
    device,
    cashDrawer,
    shift,
    order,
    paymentId: result.payment.id,
    settlement
  });
  void postCommitTask.catch((error) => {
    console.error(JSON.stringify({ event: "pos.cash.post_commit.failed", code: error?.code || "POST_COMMIT_FAILED" }));
  });
  const performance = process.env.NODE_ENV === "production" ? undefined : {
    entitlementMs,
    accessAndOrderMs,
    dbTransactionMs,
    paymentSettlementMs: transactionTiming.legacyPaymentMs + transactionTiming.orderPaymentMs,
    cashLedgerMs: transactionTiming.cashLedgerMs,
    drawerBalanceMs: transactionTiming.drawerBalanceMs,
    receiptMs: transactionTiming.receiptMs,
    drawerDispatchMs: Date.now() - drawerDispatchStartedAt,
    kdsMs: 0,
    serviceTotalMs: Date.now() - serviceStartedAt,
    postCommit: "deferred"
  };
  if (performance) console.info(JSON.stringify({ event: "pos.cash.performance", ...performance }));
  return {
    ...result,
    ...settlement,
    amountReceivedCents: settlement.cashTenderedCents,
    drawerRequest,
    ...(performance ? { performance } : {})
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
