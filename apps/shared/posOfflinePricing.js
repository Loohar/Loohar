export const POS_OFFLINE_SCHEMA_VERSION = 1;

export const POS_OFFLINE_SYNC_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  LOCAL_COMPLETED: "LOCAL_COMPLETED",
  PENDING_SYNC: "PENDING_SYNC",
  SYNCING: "SYNCING",
  SYNCED: "SYNCED",
  FAILED_RETRYABLE: "FAILED_RETRYABLE",
  NEEDS_REVIEW: "NEEDS_REVIEW"
});

export const POS_OFFLINE_UNSYNCED_STATUSES = Object.freeze([
  POS_OFFLINE_SYNC_STATUS.LOCAL_COMPLETED,
  POS_OFFLINE_SYNC_STATUS.PENDING_SYNC,
  POS_OFFLINE_SYNC_STATUS.SYNCING,
  POS_OFFLINE_SYNC_STATUS.FAILED_RETRYABLE,
  POS_OFFLINE_SYNC_STATUS.NEEDS_REVIEW
]);

export class PosOfflinePricingError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "PosOfflinePricingError";
    this.code = code;
    Object.assign(this, details);
  }
}

function integerCents(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new PosOfflinePricingError(`${name} must be a non-negative integer amount.`, "POS_OFFLINE_PRICING_INVALID", { field: name });
  }
  return number;
}

export function resolvePosDeliveryPricingSnapshot({
  orderType,
  deliveryZones = [],
  defaultDeliveryFeeCents = 0,
  deliveryZoneId = null,
  subtotalCents = 0
} = {}) {
  if (String(orderType || "WALK_IN") !== "DELIVERY") return { deliveryFeeCents: 0, deliveryZone: null };
  const subtotal = integerCents(subtotalCents, "subtotalCents");
  const zones = Array.isArray(deliveryZones) ? deliveryZones : [];
  if (!zones.length) {
    return { deliveryFeeCents: integerCents(defaultDeliveryFeeCents, "deliveryFeeCents"), deliveryZone: null };
  }
  const requestedId = String(deliveryZoneId || "").trim();
  if (!requestedId) {
    throw new PosOfflinePricingError("Select a delivery zone before continuing.", "POS_DELIVERY_ZONE_REQUIRED");
  }
  const deliveryZone = zones.find((zone) => String(zone?.id || "") === requestedId && zone?.active !== false);
  if (!deliveryZone) {
    throw new PosOfflinePricingError("Delivery zone is not active for this restaurant.", "POS_DELIVERY_ZONE_INVALID");
  }
  const minimumOrderCents = integerCents(deliveryZone.minimumOrderCents || 0, "minimumOrderCents");
  if (subtotal < minimumOrderCents) {
    throw new PosOfflinePricingError("Order does not meet the delivery zone minimum.", "POS_DELIVERY_MINIMUM_NOT_MET", { minimumOrderCents });
  }
  return {
    deliveryFeeCents: integerCents(deliveryZone.deliveryFeeCents || 0, "deliveryFeeCents"),
    deliveryZone
  };
}

export function calculatePosPricingSnapshot({
  lineItems = [],
  discountCents = 0,
  deliveryFeeCents = 0,
  taxRateBps,
  taxInclusive = false,
  tipCents = 0
} = {}) {
  if (!Array.isArray(lineItems) || !lineItems.length) {
    throw new PosOfflinePricingError("At least one menu item is required.", "POS_OFFLINE_ITEMS_REQUIRED");
  }
  const normalizedLines = lineItems.map((line, index) => {
    const quantity = Number(line?.quantity);
    const unitPriceCents = integerCents(line?.unitPriceCents, `lineItems[${index}].unitPriceCents`);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new PosOfflinePricingError("Item quantity must be between 1 and 99.", "POS_OFFLINE_QUANTITY_INVALID", { index });
    }
    return { ...line, quantity, unitPriceCents, lineTotalCents: unitPriceCents * quantity };
  });
  const subtotalCents = normalizedLines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const discount = integerCents(discountCents, "discountCents");
  const deliveryFee = integerCents(deliveryFeeCents, "deliveryFeeCents");
  const tip = integerCents(tipCents, "tipCents");
  const rate = Number(taxRateBps);
  if (!Number.isSafeInteger(rate) || rate < 0 || rate > 100_000) {
    throw new PosOfflinePricingError("A valid synchronized tax rate is required.", "POS_OFFLINE_TAX_INVALID");
  }
  const taxableAmountCents = Math.max(0, subtotalCents - discount);
  const inclusive = taxInclusive === true;
  const taxCents = inclusive
    ? Math.round((taxableAmountCents * rate) / (10_000 + rate))
    : Math.round((taxableAmountCents * rate) / 10_000);
  const totalCents = Math.max(0, taxableAmountCents + deliveryFee + (inclusive ? 0 : taxCents) + tip);
  return {
    lineItems: normalizedLines,
    subtotalCents,
    discountCents: discount,
    taxableAmountCents,
    deliveryFeeCents: deliveryFee,
    taxRateBps: rate,
    taxInclusive: inclusive,
    taxCents,
    tipCents: tip,
    totalCents
  };
}

export function validatePosOfflinePricingSnapshot(transaction = {}) {
  const order = transaction.orderSnapshot || {};
  const tax = transaction.taxSnapshot || {};
  const pricing = calculatePosPricingSnapshot({
    lineItems: order.lineItems,
    discountCents: order.discountCents,
    deliveryFeeCents: order.deliveryFeeCents,
    taxRateBps: tax.taxRateBps,
    taxInclusive: tax.taxInclusive,
    tipCents: order.tipCents
  });
  for (const field of ["subtotalCents", "discountCents", "deliveryFeeCents", "taxCents", "tipCents", "totalCents"]) {
    if (Number(order[field] || 0) !== pricing[field]) {
      throw new PosOfflinePricingError("Offline pricing snapshot failed integrity validation.", "POS_OFFLINE_PRICING_MISMATCH", { field });
    }
  }
  if (Number(tax.taxableAmountCents) !== pricing.taxableAmountCents || Number(tax.taxCents) !== pricing.taxCents) {
    throw new PosOfflinePricingError("Offline tax snapshot failed integrity validation.", "POS_OFFLINE_TAX_MISMATCH");
  }
  return pricing;
}
