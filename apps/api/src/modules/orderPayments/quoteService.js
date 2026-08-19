import { prisma } from "../../config/prisma.js";
import { normalizeTipInput } from "../../services/orderWorkflowService.js";
import { findValidLocationTaxConfiguration } from "../../services/taxProfileService.js";
import { calculatePosPricingSnapshot } from "../../../../shared/posOfflinePricing.js";
import { resolveMenuItemTaxTreatment } from "../../../../shared/taxTreatment.js";

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
  const taxRateBps = configuredTaxRateBps(taxConfiguration);

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    const error = new Error("Add at least one item to quote an order");
    error.status = 400;
    throw error;
  }
  const menuItems = await prisma.menuItem.findMany({
    where: { restaurantId: restaurant.id, id: { in: items.map((item) => item.menuItemId) }, available: true },
    include: { category: true }
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
    const selectedOptions = Array.isArray(item.options) ? item.options : [];
    const optionsTotalCents = selectedOptions.reduce((sum, option) => sum + nonnegativeInt(option.priceCents), 0);
    const quantity = nonnegativeInt(item.quantity, 1) || 1;
    const unitPriceCents = menuItem.priceCents + optionsTotalCents;
    const taxTreatment = resolveMenuItemTaxTreatment({
      item: menuItem,
      category: menuItem.category,
      locationTaxRateBps: taxRateBps,
      locationTaxRateMicros: taxConfiguration.taxRateMicros
    });
    return {
      menuItemId: menuItem.id,
      name: menuItem.name,
      quantity,
      baseUnitPriceCents: menuItem.priceCents,
      optionsTotalCents,
      unitPriceCents,
      lineTotalCents: unitPriceCents * quantity,
      taxTreatment: taxTreatment.treatment,
      taxTreatmentSource: taxTreatment.source,
      resolvedTaxRateBps: taxTreatment.taxRateBps,
      resolvedTaxRateMicros: taxTreatment.taxRateMicros,
      customTaxRule: taxTreatment.customRule,
      options: selectedOptions
    };
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
  const deliveryRule = restaurant.deliveryFeeRules?.[0];
  const configuredDeliveryFeeCents = deliveryRule?.deliveryFeeCents ?? restaurant.deliveryFeeCents ?? 0;
  const freeDelivery = Boolean(coupon?.freeDelivery || coupon?.type === "FREE_DELIVERY");
  const deliveryFeeCents = orderType === "DELIVERY" && !freeDelivery ? nonnegativeInt(configuredDeliveryFeeCents) : 0;
  const taxInclusive = taxConfiguration.taxInclusive === true;
  const tipBreakdown = normalizeTipInput({ body, orderType, subtotalCents });
  const serviceFeeCents = nonnegativeInt(body.serviceFeeCents, 0);
  const pricing = calculatePosPricingSnapshot({
    lineItems: quoteItems,
    discountCents,
    deliveryFeeCents,
    taxRateBps,
    taxRateMicros: taxConfiguration.taxRateMicros,
    taxInclusive,
    tipCents: tipBreakdown.tipCents
  });
  const { taxableAmountCents, taxCents } = pricing;
  const totalCents = pricing.totalCents + serviceFeeCents;
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
    taxRateMicros: taxConfiguration.taxRateMicros,
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
