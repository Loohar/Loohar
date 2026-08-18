import {
  POS_OFFLINE_SCHEMA_VERSION,
  POS_OFFLINE_SYNC_STATUS,
  calculatePosPricingSnapshot,
  resolvePosDeliveryPricingSnapshot
} from "../../../../shared/posOfflinePricing.js";
import { resolveMenuItemTaxTreatment } from "../../../../shared/taxTreatment.js";
import { cashTenderSummary } from "./cashTender.js";

function string(value, maximum = 200) {
  return String(value || "").slice(0, maximum);
}

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function stableId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`;
}

function sanitizeOption(option = {}) {
  return {
    id: string(option.id || option.optionId),
    menuItemId: string(option.menuItemId),
    optionGroupId: string(option.optionGroupId || option.groupId) || null,
    name: string(option.name || option.optionName),
    priceCents: Number(option.priceCents || 0),
    required: Boolean(option.required),
    isDefault: Boolean(option.isDefault),
    sortOrder: Number(option.sortOrder || 0),
    available: option.available !== false
  };
}

function sanitizeGroup(group = {}) {
  return {
    id: string(group.id || group.groupId),
    menuItemId: string(group.menuItemId),
    name: string(group.name),
    required: Boolean(group.required),
    minSelect: Number(group.minSelect || 0),
    maxSelect: Math.max(1, Number(group.maxSelect || 1)),
    sortOrder: Number(group.sortOrder || 0),
    options: (group.options || []).map(sanitizeOption)
  };
}

function sanitizeTaxRule(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null;
  return {
    taxRateBps: Number(rule.taxRateBps),
    sourceReference: string(rule.sourceReference, 240),
    verifiedAt: string(rule.verifiedAt, 80)
  };
}

function sanitizeMenu(categories = []) {
  return categories.map((category) => ({
    id: string(category.id),
    name: string(category.name),
    active: category.active !== false,
    items: (category.items || []).map((item) => ({
      id: string(item.id),
      categoryId: string(item.categoryId || category.id),
      name: string(item.name),
      sku: string(item.sku),
      searchAliases: string(item.searchAliases, 500),
      priceCents: Number(item.priceCents || 0),
      available: item.available !== false,
      customizationMode: string(item.customizationMode || "AUTO", 20),
      sendToKitchen: item.sendToKitchen !== false,
      taxTreatment: string(item.taxTreatment || "LOCATION_DEFAULT", 40),
      taxRuleJson: sanitizeTaxRule(item.taxRuleJson),
      categoryTaxTreatment: string(item.categoryTaxTreatment || category.taxTreatment || "LOCATION_DEFAULT", 40),
      categoryTaxRuleJson: sanitizeTaxRule(item.categoryTaxRuleJson || category.taxRuleJson),
      offlinePricingProof: string(item.offlinePricingProof, 64_000),
      options: (item.options || []).map(sanitizeOption),
      optionGroups: (item.optionGroups || []).map(sanitizeGroup)
    }))
  }));
}

function sanitizeConfig(config = {}) {
  const device = config.device || {};
  const shift = config.shift || null;
  return {
    restaurant: {
      id: string(config.restaurant?.id),
      slug: string(config.restaurant?.slug),
      name: string(config.restaurant?.name),
      timezone: string(config.restaurant?.timezone || "America/Denver", 80),
      deliveryFeeCents: Number(config.restaurant?.deliveryFeeCents || 0)
    },
    staff: config.staff ? { id: string(config.staff.id), userId: string(config.staff.userId), role: string(config.staff.role, 60) } : null,
    locations: (config.locations || []).map((location) => ({ id: string(location.id), name: string(location.name), active: location.active !== false })),
    deliveryZones: (config.deliveryZones || []).map((zone) => ({
      id: string(zone.id),
      name: string(zone.name),
      active: zone.active !== false,
      deliveryFeeCents: Number(zone.deliveryFeeCents || 0),
      minimumOrderCents: Number(zone.minimumOrderCents || 0),
      radiusMiles: Number(zone.radiusMiles || 0)
    })),
    orderFieldPolicy: config.orderFieldPolicy || {},
    permissions: (config.permissions || []).map((permission) => string(permission, 80)),
    device: device.id ? {
      id: string(device.id),
      name: string(device.name),
      deviceType: string(device.deviceType, 40),
      status: string(device.status, 40),
      locationId: string(device.locationId) || null,
      cashDrawerId: string(device.cashDrawerId) || null,
      cardPaymentsEnabled: Boolean(device.cardPaymentsEnabled)
    } : null,
    shift: shift?.id ? {
      id: string(shift.id),
      status: string(shift.status, 40),
      employeeUserId: string(shift.employeeUserId),
      deviceId: string(shift.deviceId) || null,
      locationId: string(shift.locationId) || null,
      cashDrawerId: string(shift.cashDrawerId) || null,
      openedAt: iso(shift.openedAt)
    } : null,
    cashDrawers: (config.cashDrawers || []).map((drawer) => ({
      id: string(drawer.id),
      name: string(drawer.name),
      status: string(drawer.status, 40),
      locationId: string(drawer.locationId) || null,
      currentBalanceCents: Number(drawer.currentBalanceCents || 0),
      active: drawer.active !== false
    })),
    taxConfiguration: config.taxConfiguration ? {
      id: string(config.taxConfiguration.id),
      locationId: string(config.taxConfiguration.locationId),
      provider: string(config.taxConfiguration.provider || "manual", 80),
      source: string(config.taxConfiguration.source, 120),
      taxRateBps: Number(config.taxConfiguration.taxRateBps),
      taxInclusive: Boolean(config.taxConfiguration.taxInclusive),
      enabled: config.taxConfiguration.enabled === true,
      countryCode: string(config.taxConfiguration.countryCode, 8),
      stateCode: string(config.taxConfiguration.stateCode, 40),
      county: string(config.taxConfiguration.county, 120),
      municipality: string(config.taxConfiguration.municipality, 120),
      jurisdictionCode: string(config.taxConfiguration.jurisdictionCode, 160),
      jurisdictionMetadata: config.taxConfiguration.jurisdictionMetadata || {},
      specialDistricts: Array.isArray(config.taxConfiguration.specialDistricts) ? config.taxConfiguration.specialDistricts : [],
      taxComponents: Array.isArray(config.taxConfiguration.taxComponents) ? config.taxConfiguration.taxComponents : [],
      exemption: config.taxConfiguration.exemption || null,
      sourceMetadata: config.taxConfiguration.sourceMetadata || {},
      effectiveAt: iso(config.taxConfiguration.effectiveAt),
      expiresAt: config.taxConfiguration.expiresAt ? iso(config.taxConfiguration.expiresAt) : null,
      verifiedAt: iso(config.taxConfiguration.verifiedAt),
      nextVerificationAt: config.taxConfiguration.nextVerificationAt ? iso(config.taxConfiguration.nextVerificationAt) : null,
      configurationVersion: string(config.taxConfiguration.configurationVersion, 300),
      acknowledgementVersion: string(config.taxConfiguration.acknowledgementVersion, 300),
      acknowledgedAt: config.taxConfiguration.acknowledgedAt ? iso(config.taxConfiguration.acknowledgedAt) : null,
      updatedAt: iso(config.taxConfiguration.updatedAt)
    } : null,
    configurationVersion: string(config.configurationVersion, 500),
    offlineConfigurationProof: string(config.offlineConfigurationProof, 64_000),
    offlineValidUntil: config.offlineValidUntil ? iso(config.offlineValidUntil) : null,
    serverTime: config.serverTime ? iso(config.serverTime) : null
  };
}

export function buildPosOfflineInitialization({ config, menu, registerKey }) {
  const safeConfig = sanitizeConfig(config);
  const safeMenu = sanitizeMenu(menu?.categories || []);
  const menuItems = safeMenu.flatMap((category) => category.items || []);
  const terminalId = safeConfig.device?.id;
  const restaurantId = safeConfig.restaurant.id;
  const locationId = safeConfig.device?.locationId || safeConfig.locations[0]?.id || null;
  if (!restaurantId || !terminalId || !locationId || !safeMenu.length || !menuItems.length) throw new Error("Offline initialization is incomplete.");
  if (menuItems.some((item) => !item.offlinePricingProof)) throw new Error("Offline menu pricing proof is incomplete.");
  if (!safeConfig.taxConfiguration?.enabled || !Number.isSafeInteger(safeConfig.taxConfiguration.taxRateBps)) {
    throw new Error("Offline sales require a synchronized tax configuration.");
  }
  if (
    safeConfig.taxConfiguration.locationId !== locationId
    || !safeConfig.taxConfiguration.configurationVersion
    || !safeConfig.taxConfiguration.jurisdictionCode
    || !safeConfig.taxConfiguration.source
    || safeConfig.taxConfiguration.acknowledgementVersion !== safeConfig.taxConfiguration.configurationVersion
    || !safeConfig.taxConfiguration.acknowledgedAt
  ) {
    throw new Error("Offline sales require a verified location tax profile.");
  }
  const taxExpiresAt = safeConfig.taxConfiguration.expiresAt ? new Date(safeConfig.taxConfiguration.expiresAt).getTime() : null;
  if (taxExpiresAt && taxExpiresAt <= Date.now()) throw new Error("Offline tax configuration has expired.");
  const taxVerificationDueAt = safeConfig.taxConfiguration.nextVerificationAt ? new Date(safeConfig.taxConfiguration.nextVerificationAt).getTime() : null;
  if (taxVerificationDueAt && taxVerificationDueAt <= Date.now()) throw new Error("Offline tax configuration must be refreshed.");
  if (!safeConfig.configurationVersion || !menu?.menuVersion || !safeConfig.offlineConfigurationProof) {
    throw new Error("Offline configuration proof is incomplete.");
  }
  const validUntil = new Date(safeConfig.offlineValidUntil || 0).getTime();
  if (!Number.isFinite(validUntil) || validUntil <= Date.now()) throw new Error("Offline configuration proof has expired.");
  const configurationVersion = `${safeConfig.configurationVersion}::${String(menu.menuVersion)}`;
  return {
    schemaVersion: POS_OFFLINE_SCHEMA_VERSION,
    registerKey,
    tenantId: restaurantId,
    restaurantId,
    locationId,
    terminalId,
    staffId: safeConfig.staff?.id || null,
    configurationVersion,
    configurationTimestamp: iso(menu.generatedAt || config.serverTime),
    offlineValidUntil: safeConfig.offlineValidUntil,
    config: safeConfig,
    menu: {
      categories: safeMenu,
      menuVersion: string(menu.menuVersion, 300),
      generatedAt: iso(menu.generatedAt),
      tenantId: string(menu.tenantId || menu.restaurantId),
      locationId: string(menu.locationId) || locationId
    },
    initializedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function posOfflineInitializationUsable(initialization, now = Date.now()) {
  return Boolean(
    initialization?.schemaVersion === POS_OFFLINE_SCHEMA_VERSION
    && initialization.restaurantId
    && initialization.terminalId
    && initialization.locationId
    && initialization.config?.device?.status === "ACTIVE"
    && initialization.config?.device?.deviceType === "MAIN_TERMINAL"
    && initialization.config?.shift?.status === "OPEN"
    && initialization.config?.cashDrawers?.some((drawer) => drawer.id === initialization.config.shift.cashDrawerId && drawer.status === "OPEN")
    && initialization.config?.permissions?.includes("POS_ACCEPT_CASH")
    && initialization.config?.permissions?.includes("POS_SEND_TO_KITCHEN")
    && initialization.config?.taxConfiguration?.enabled
    && initialization.config.taxConfiguration.locationId === initialization.locationId
    && initialization.config.taxConfiguration.configurationVersion
    && initialization.config.taxConfiguration.acknowledgementVersion === initialization.config.taxConfiguration.configurationVersion
    && initialization.config.taxConfiguration.acknowledgedAt
    && initialization.config.taxConfiguration.jurisdictionCode
    && initialization.config.taxConfiguration.source
    && typeof initialization.config.taxConfiguration.taxInclusive === "boolean"
    && (!initialization.config.taxConfiguration.expiresAt || new Date(initialization.config.taxConfiguration.expiresAt).getTime() > now)
    && (!initialization.config.taxConfiguration.nextVerificationAt || new Date(initialization.config.taxConfiguration.nextVerificationAt).getTime() > now)
    && initialization.config?.offlineConfigurationProof
    && Array.isArray(initialization.menu?.categories)
    && initialization.menu.categories.some((category) => (category.items || []).some((item) => item.available && item.offlinePricingProof))
    && new Date(initialization.offlineValidUntil || 0).getTime() > now
  );
}

function cachedMenuById(initialization) {
  return new Map((initialization?.menu?.categories || []).flatMap((category) => (category.items || []).map((item) => [item.id, item])));
}

export function calculatePosOfflineQuote({ initialization, cart, orderType, customer = {}, locationId }) {
  if (!posOfflineInitializationUsable(initialization)) throw new Error("Offline sales are unavailable until this register completes its first online setup.");
  if (locationId && String(locationId) !== String(initialization.locationId)) throw new Error("The active order location does not match this register.");
  const menuById = cachedMenuById(initialization);
  const lineItems = (cart || []).map((line) => {
    const menuItem = menuById.get(String(line.menuItemId || ""));
    if (!menuItem?.available) throw new Error(`${line.name || "Menu item"} is not available in the synchronized menu.`);
    const modifiers = (line.modifiers || []).map((modifier) => ({
      id: string(modifier.id || modifier.optionId),
      optionId: string(modifier.optionId || modifier.id),
      name: string(modifier.name),
      priceCents: Number(modifier.priceCents || 0),
      groupId: string(modifier.groupId),
      groupName: string(modifier.groupName)
    }));
    const unitPriceCents = Number(menuItem.priceCents || 0) + modifiers.reduce((sum, modifier) => sum + Number(modifier.priceCents || 0), 0);
    if (unitPriceCents !== Number(line.priceCents)) throw new Error("Cart pricing no longer matches the synchronized menu.");
    const taxTreatment = resolveMenuItemTaxTreatment({
      item: { taxTreatment: menuItem.taxTreatment, taxRuleJson: menuItem.taxRuleJson },
      category: {
        taxTreatment: menuItem.categoryTaxTreatment,
        taxRuleJson: menuItem.categoryTaxRuleJson
      },
      locationTaxRateBps: initialization.config.taxConfiguration.taxRateBps
    });
    return {
      menuItemId: menuItem.id,
      name: menuItem.name,
      quantity: Number(line.quantity || 1),
      unitPriceCents,
      basePriceCents: Number(menuItem.priceCents || 0),
      modifierSelections: Array.isArray(line.modifierSelections) ? line.modifierSelections : [],
      modifiers,
      options: modifiers,
      specialInstructions: string(line.specialInstructions, 500),
      sendToKitchen: menuItem.sendToKitchen !== false,
      taxTreatment: taxTreatment.treatment,
      taxTreatmentSource: taxTreatment.source,
      resolvedTaxRateBps: taxTreatment.taxRateBps,
      customTaxRule: taxTreatment.customRule,
      offlinePricingProof: menuItem.offlinePricingProof
    };
  });
  const preliminarySubtotal = lineItems.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
  const delivery = resolvePosDeliveryPricingSnapshot({
    orderType,
    deliveryZones: initialization.config.deliveryZones,
    defaultDeliveryFeeCents: initialization.config.restaurant.deliveryFeeCents,
    deliveryZoneId: customer.deliveryZoneId || null,
    subtotalCents: preliminarySubtotal
  });
  const pricing = calculatePosPricingSnapshot({
    lineItems,
    discountCents: 0,
    deliveryFeeCents: delivery.deliveryFeeCents,
    taxRateBps: initialization.config.taxConfiguration.taxRateBps,
    taxInclusive: initialization.config.taxConfiguration.taxInclusive,
    tipCents: 0
  });
  return {
    id: `offline:${initialization.configurationVersion}`,
    source: "OFFLINE_CACHE",
    configurationVersion: initialization.configurationVersion,
    locationId: initialization.locationId,
    orderType,
    ...pricing,
    lineItemsJson: pricing.lineItems,
    taxSnapshot: {
      provider: initialization.config.taxConfiguration.provider,
      source: initialization.config.taxConfiguration.source,
      locationId: initialization.config.taxConfiguration.locationId,
      jurisdictionCode: initialization.config.taxConfiguration.jurisdictionCode,
      jurisdictionMetadata: initialization.config.taxConfiguration.jurisdictionMetadata,
      specialDistricts: initialization.config.taxConfiguration.specialDistricts,
      taxComponents: initialization.config.taxConfiguration.taxComponents,
      exemption: initialization.config.taxConfiguration.exemption,
      profileVersion: initialization.config.taxConfiguration.configurationVersion,
      acknowledgementVersion: initialization.config.taxConfiguration.acknowledgementVersion,
      effectiveAt: initialization.config.taxConfiguration.effectiveAt,
      expiresAt: initialization.config.taxConfiguration.expiresAt,
      verifiedAt: initialization.config.taxConfiguration.verifiedAt,
      taxInclusive: initialization.config.taxConfiguration.taxInclusive,
      taxRateBps: pricing.taxRateBps,
      taxableAmountCents: pricing.taxableAmountCents,
      taxCents: pricing.taxCents,
      configurationVersion: initialization.configurationVersion
    }
  };
}

export function buildPosOfflineCashTransaction({
  initialization,
  quote,
  customer,
  orderType,
  notes,
  tableNumber,
  amountCents,
  cashier
}) {
  const tender = cashTenderSummary(quote.totalCents, amountCents);
  if (!tender.covered) throw new Error("Cash tender must cover the amount due.");
  const localTransactionId = stableId("offline-pos");
  const idempotencyKey = stableId("offline-cash");
  const now = new Date();
  const restaurant = initialization.config.restaurant;
  const device = initialization.config.device;
  const shift = initialization.config.shift;
  const drawer = initialization.config.cashDrawers.find((row) => row.id === shift.cashDrawerId);
  const orderSnapshot = {
    orderType,
    customer: { ...customer, tableNumber: string(tableNumber, 40) },
    notes: string(notes, 1000),
    lineItems: quote.lineItemsJson,
    subtotalCents: quote.subtotalCents,
    discountCents: quote.discountCents,
    deliveryFeeCents: quote.deliveryFeeCents,
    taxCents: quote.taxCents,
    tipCents: quote.tipCents,
    totalCents: quote.totalCents
  };
  return {
    schemaVersion: POS_OFFLINE_SCHEMA_VERSION,
    registerKey: initialization.registerKey,
    localTransactionId,
    idempotencyKey,
    tenantId: initialization.tenantId,
    restaurantId: initialization.restaurantId,
    locationId: initialization.locationId,
    terminalId: initialization.terminalId,
    staffId: initialization.staffId,
    shiftId: shift.id,
    cashDrawerId: drawer?.id || shift.cashDrawerId,
    createdAt: now.toISOString(),
    completedAt: now.toISOString(),
    timezone: restaurant.timezone,
    configurationVersion: initialization.configurationVersion,
    configurationTimestamp: initialization.configurationTimestamp,
    offlineConfigurationProof: initialization.config.offlineConfigurationProof,
    orderSnapshot,
    paymentSnapshot: {
      method: "CASH",
      amountDueCents: tender.amountDueCents,
      cashTenderedCents: tender.tenderedCents,
      cashAppliedCents: tender.appliedCents,
      changeDueCents: tender.changeDueCents
    },
    taxSnapshot: quote.taxSnapshot,
    kitchenRoutingSnapshot: {
      status: "PENDING_KITCHEN_SYNC",
      lineItems: quote.lineItemsJson.filter((line) => line.sendToKitchen !== false)
    },
    receiptSnapshot: {
      status: "OFFLINE_PENDING_SYNC",
      restaurant: { id: restaurant.id, name: restaurant.name },
      cashier: { id: string(cashier?.id), name: string(cashier?.name || cashier?.email) },
      terminal: { id: device.id, name: device.name },
      shiftId: shift.id,
      localTransactionId,
      completedAt: now.toISOString(),
      timezone: restaurant.timezone,
      order: orderSnapshot,
      payment: {
        method: "CASH",
        tenderedCents: tender.tenderedCents,
        appliedCents: tender.appliedCents,
        changeDueCents: tender.changeDueCents
      }
    },
    syncStatus: POS_OFFLINE_SYNC_STATUS.PENDING_SYNC,
    syncAttempts: 0,
    lastSyncError: "",
    canonicalOrderId: null,
    canonicalPaymentId: null,
    serverSyncedAt: null,
    updatedAt: now.toISOString()
  };
}

export function offlineOrderFromTransaction(transaction) {
  const order = transaction.orderSnapshot;
  return {
    id: `local:${transaction.localTransactionId}`,
    orderNumber: `OFFLINE-${transaction.localTransactionId.slice(-8).toUpperCase()}`,
    restaurantId: transaction.restaurantId,
    locationId: transaction.locationId,
    type: order.orderType,
    status: "PENDING_SYNC",
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    deliveryFeeCents: order.deliveryFeeCents,
    taxCents: order.taxCents,
    tipCents: order.tipCents,
    totalCents: order.totalCents,
    createdAt: transaction.completedAt,
    offlinePendingSync: true,
    localTransactionId: transaction.localTransactionId
  };
}
