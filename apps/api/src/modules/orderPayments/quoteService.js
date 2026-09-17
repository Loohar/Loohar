import { prisma } from "../../config/prisma.js";
import { validateSelectedModifiers } from "../../services/modifierValidationService.js";
import { normalizeTipInput } from "../../services/orderWorkflowService.js";
import { findValidLocationTaxConfiguration } from "../../services/taxProfileService.js";

const ORDERING_TYPES = new Set(["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK"]);
export const ZERO_LOOHAR_PLATFORM_FEE_DISCLOSURE =
  "No additional Loohar transaction fee. Standard payment-processing fees may still apply.";

function nonnegativeInt(value, fallback = 0) {
  const next = Number(value ?? fallback);
  return Number.isFinite(next) ? Math.max(0, Math.round(next)) : fallback;
}

function platformFeeCents() {
  return 0;
}

function configuredTaxRateBps(taxConfiguration) {
  const rate = taxConfiguration?.taxRateBps;
  if (!Number.isSafeInteger(rate) || rate < 0 || rate > 100_000) {
    const error = new Error("Tax configuration is required before this restaurant can process sales.");
    error.status = 409;
    error.code = "ORDER_TAX_CONFIGURATION_REQUIRED";
    throw error;
  }
  return rate;
}

function selectedModifierSource(line = {}) {
  if (Array.isArray(line.modifierSelections)) return line.modifierSelections;
  if (Array.isArray(line.selectedModifiers)) return line.selectedModifiers;
  if (Array.isArray(line.options)) return line.options;
  if (Array.isArray(line.modifierOptionIds)) return line.modifierOptionIds;
  if (Array.isArray(line.optionIds)) return line.optionIds;
  return [];
}

export function publicModifierSelectionsForLine(line = {}) {
  return selectedModifierSource(line).flatMap((selection, selectionIndex) => {
    if (selection == null || selection === "") return [];
    if (typeof selection !== "object" || Array.isArray(selection)) {
      return [{ modifierGroupId: null, modifierOptionId: String(selection) }];
    }
    const modifierGroupId = selection.modifierGroupId ?? selection.groupId ?? selection.optionGroupId ?? null;
    if (Array.isArray(selection.optionIds)) {
      return selection.optionIds.map((optionId) => ({
        modifierGroupId,
        modifierOptionId: String(optionId)
      }));
    }
    const modifierOptionId = selection.modifierOptionId ?? selection.optionId ?? selection.id ?? null;
    if (!modifierOptionId) return [];
    return [{
      modifierGroupId,
      modifierOptionId: String(modifierOptionId),
      selectionIndex
    }];
  });
}

function orderModifierError(error) {
  if (!String(error?.code || "").startsWith("POS_MODIFIER_")) return error;
  const invalidCodes = new Set(["POS_MODIFIER_INVALID", "POS_MODIFIER_DUPLICATE"]);
  const next = new Error(invalidCodes.has(error.code) ? "Selected modifier option is unavailable." : error.message);
  next.status = error.status || 400;
  next.code = error.code.replace("POS_", "ORDER_");
  return next;
}

export function canonicalQuoteItem({ menuItem, item }) {
  let selected;
  try {
    selected = validateSelectedModifiers(menuItem, {
      modifierSelections: publicModifierSelectionsForLine(item)
    });
  } catch (error) {
    throw orderModifierError(error);
  }
  const optionsTotalCents = selected.modifiers.reduce((sum, option) => sum + nonnegativeInt(option.priceCents), 0);
  const quantity = nonnegativeInt(item.quantity, 1) || 1;
  const unitPriceCents = menuItem.priceCents + optionsTotalCents;
  const modifierSelections = selected.modifiers.map((modifier) => ({
    modifierGroupId: modifier.groupId,
    modifierOptionId: modifier.optionId
  }));
  return {
    menuItemId: menuItem.id,
    name: menuItem.name,
    quantity,
    baseUnitPriceCents: menuItem.priceCents,
    optionsTotalCents,
    unitPriceCents,
    lineTotalCents: unitPriceCents * quantity,
    optionIds: selected.optionIds,
    modifierOptionIds: selected.optionIds,
    modifierSelections,
    options: selected.modifiers,
    modifiers: selected.modifiers
  };
}

function activeCouponWhere({ restaurantId, couponCode }) {
  const now = new Date();
  return {
    restaurantId,
    code: couponCode.trim().toUpperCase(),
    active: true,
    OR: [{ startsAt: null }, { startsAt: { lte: now } }],
    AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }]
  };
}

function fulfillmentError(message, code) {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

// Online orders may only use fulfilment the restaurant has switched on. Delivery is restaurant-managed:
// no geocoding provider is configured, so Loohar requires an address but cannot verify it against
// delivery zones; the restaurant confirms the address before dispatch.
function assertOnlineFulfillmentAvailable({ restaurant, orderType, body }) {
  if (!["PICKUP", "DELIVERY"].includes(orderType)) throw fulfillmentError("Choose pickup or delivery.", "FULFILLMENT_TYPE_INVALID");
  if (orderType === "PICKUP" && restaurant.pickupEnabled === false) {
    throw fulfillmentError("This restaurant is not accepting pickup orders online.", "PICKUP_UNAVAILABLE");
  }
  if (orderType === "DELIVERY") {
    if (restaurant.deliveryEnabled !== true) throw fulfillmentError("This restaurant is not accepting delivery orders online.", "DELIVERY_UNAVAILABLE");
    if (String(body.deliveryAddress || "").trim().length < 5) throw fulfillmentError("Enter a delivery address.", "DELIVERY_ADDRESS_REQUIRED");
  }
}

export async function calculateOrderQuote({ restaurantId, body }) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    include: {
      locations: { where: { active: true }, orderBy: { createdAt: "asc" } },
      deliveryFeeRules: { where: { active: true }, orderBy: { createdAt: "asc" } }
    }
  });
  if (!restaurant || restaurant.status !== "ACTIVE") {
    const error = new Error("Restaurant unavailable");
    error.status = 404;
    throw error;
  }
  if (!ORDERING_TYPES.has(restaurant.businessType)) {
    const error = new Error("Online ordering is not enabled for this business type yet");
    error.status = 400;
    throw error;
  }
  const requestedLocationId = String(body.locationId || "").trim();
  const location = requestedLocationId
    ? restaurant.locations.find((candidate) => candidate.id === requestedLocationId)
    : restaurant.locations.length === 1 ? restaurant.locations[0] : null;
  if (!location) {
    const error = new Error(restaurant.locations.length > 1
      ? "Choose a restaurant location before requesting a quote."
      : "A configured restaurant location is required before requesting a quote.");
    error.status = 409;
    error.code = requestedLocationId ? "ORDER_LOCATION_INVALID" : "ORDER_LOCATION_REQUIRED";
    throw error;
  }
  const taxConfiguration = await findValidLocationTaxConfiguration({ restaurantId: restaurant.id, locationId: location.id });

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    const error = new Error("Add at least one item to quote an order");
    error.status = 400;
    throw error;
  }
  const menuItems = await prisma.menuItem.findMany({
    where: { restaurantId: restaurant.id, id: { in: items.map((item) => item.menuItemId) }, available: true },
    include: {
      options: { orderBy: { sortOrder: "asc" } },
      optionGroups: {
        include: { options: { orderBy: { sortOrder: "asc" } } },
        orderBy: { sortOrder: "asc" }
      }
    }
  });
  const menuById = new Map(menuItems.map((item) => [item.id, item]));
  const missingItems = items.filter((item) => !menuById.has(item.menuItemId));
  if (missingItems.length > 0) {
    const error = new Error("One or more menu items are unavailable");
    error.status = 400;
    throw error;
  }

  const quoteItems = items.map((item) => {
    const menuItem = menuById.get(item.menuItemId);
    return canonicalQuoteItem({ menuItem, item });
  });
  const subtotalCents = quoteItems.reduce((sum, item) => sum + item.lineTotalCents, 0);

  let coupon = null;
  let discountCents = 0;
  const couponCode = typeof body.couponCode === "string" ? body.couponCode.trim() : "";
  if (couponCode) {
    coupon = await prisma.coupon.findFirst({ where: activeCouponWhere({ restaurantId: restaurant.id, couponCode }) });
    if (!coupon) {
      const error = new Error("Coupon is not valid");
      error.status = 400;
      throw error;
    }
    if (coupon.usageLimit && coupon.redeemedCount >= coupon.usageLimit) {
      const error = new Error("Coupon usage limit reached");
      error.status = 400;
      throw error;
    }
    if (coupon.minimumOrderAmountCents && subtotalCents < coupon.minimumOrderAmountCents) {
      const error = new Error("Order does not meet coupon minimum");
      error.status = 400;
      throw error;
    }
    if (coupon.percentOff) discountCents += Math.round(subtotalCents * (coupon.percentOff / 100));
    if (coupon.amountOffCents) discountCents += coupon.amountOffCents;
    discountCents = Math.min(discountCents, subtotalCents);
  }

  const orderType = body.type || "PICKUP";
  assertOnlineFulfillmentAvailable({ restaurant, orderType, body });
  const deliveryRule = restaurant.deliveryFeeRules?.[0];
  const configuredDeliveryFeeCents = deliveryRule?.deliveryFeeCents ?? restaurant.deliveryFeeCents ?? 0;
  const freeDelivery = Boolean(coupon?.freeDelivery || coupon?.type === "FREE_DELIVERY");
  const deliveryFeeCents = orderType === "DELIVERY" && !freeDelivery ? nonnegativeInt(configuredDeliveryFeeCents) : 0;
  const taxableAmountCents = Math.max(0, subtotalCents - discountCents);
  const taxRateBps = configuredTaxRateBps(taxConfiguration);
  const taxInclusive = taxConfiguration.taxInclusive === true;
  const taxCents = taxInclusive
    ? Math.round((taxableAmountCents * taxRateBps) / (10000 + taxRateBps))
    : Math.round((taxableAmountCents * taxRateBps) / 10000);
  const tipBreakdown = normalizeTipInput({ body, orderType, subtotalCents });
  // No restaurant service fee is configured in Loohar yet; never accept one from the client.
  const serviceFeeCents = 0;
  const totalCents = taxableAmountCents + deliveryFeeCents + (taxInclusive ? 0 : taxCents) + serviceFeeCents + tipBreakdown.tipCents;
  const feeCents = platformFeeCents();
  const restaurantGrossCents = totalCents - (tipBreakdown.driverTipCents || 0);
  const restaurantNetCents = restaurantGrossCents;

  return {
    restaurant,
    coupon,
    items: quoteItems,
    currency: (process.env.ORDER_PAYMENT_CURRENCY || "usd").toLowerCase(),
    subtotalCents,
    discountCents,
    couponCode: coupon?.code || null,
    locationId: location.id,
    taxProfileId: taxConfiguration.id,
    taxConfigurationVersion: taxConfiguration.configurationVersion,
    taxConfiguration,
    taxableAmountCents,
    taxRateBps,
    taxInclusive,
    taxCents,
    deliveryFeeCents,
    serviceFeeCents,
    ...tipBreakdown,
    totalCents,
    platformFeeCents: feeCents,
    looharPlatformFeeCents: 0,
    zeroLooharPlatformFee: true,
    processorFeesMayApply: true,
    paymentFeeDisclosure: ZERO_LOOHAR_PLATFORM_FEE_DISCLOSURE,
    restaurantGrossCents,
    restaurantNetCents,
    provider: "STRIPE_CONNECT",
    breakdown: {
      subtotalCents,
      discountCents,
      taxableAmountCents,
      taxCents,
      deliveryFeeCents,
      serviceFeeCents,
      restaurantTipCents: tipBreakdown.restaurantTipCents,
      driverTipCents: tipBreakdown.driverTipCents,
      totalCents,
      platformFeeCents: 0,
      looharPlatformFeeCents: 0
    }
  };
}
