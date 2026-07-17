import { prisma } from "../../config/prisma.js";
import { normalizeTipInput } from "../../services/orderWorkflowService.js";

const ORDERING_TYPES = new Set(["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK"]);

function nonnegativeInt(value, fallback = 0) {
  const next = Number(value ?? fallback);
  return Number.isFinite(next) ? Math.max(0, Math.round(next)) : fallback;
}

function platformFeeCents(totalCents) {
  const bps = nonnegativeInt(process.env.ORDER_PAYMENT_PLATFORM_FEE_BPS, 0);
  const fixed = nonnegativeInt(process.env.ORDER_PAYMENT_PLATFORM_FEE_FIXED_CENTS, 0);
  return Math.round((totalCents * bps) / 10000) + fixed;
}

function defaultTaxRateBps() {
  return nonnegativeInt(process.env.DEFAULT_TAX_RATE_BPS, 825);
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
    include: { taxConfigurations: { where: { enabled: true }, take: 1 }, deliveryFeeRules: { where: { active: true }, orderBy: { createdAt: "asc" } } }
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

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    const error = new Error("Add at least one item to quote an order");
    error.status = 400;
    throw error;
  }
  const menuItems = await prisma.menuItem.findMany({
    where: { restaurantId: restaurant.id, id: { in: items.map((item) => item.menuItemId) }, available: true }
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
    return {
      menuItemId: menuItem.id,
      name: menuItem.name,
      quantity,
      baseUnitPriceCents: menuItem.priceCents,
      optionsTotalCents,
      unitPriceCents,
      lineTotalCents: unitPriceCents * quantity,
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
  const taxableAmountCents = Math.max(0, subtotalCents - discountCents);
  const taxRateBps = restaurant.taxConfigurations?.[0]?.taxRateBps ?? defaultTaxRateBps();
  const taxCents = Math.round((taxableAmountCents * taxRateBps) / 10000);
  const tipBreakdown = normalizeTipInput({ body, orderType, subtotalCents });
  const serviceFeeCents = nonnegativeInt(body.serviceFeeCents, 0);
  const totalCents = taxableAmountCents + deliveryFeeCents + taxCents + serviceFeeCents + tipBreakdown.tipCents;
  const feeCents = platformFeeCents(totalCents);
  const restaurantGrossCents = totalCents - (tipBreakdown.driverTipCents || 0);
  const restaurantNetCents = restaurantGrossCents - feeCents;

  return {
    restaurant,
    coupon,
    items: quoteItems,
    currency: (process.env.ORDER_PAYMENT_CURRENCY || "usd").toLowerCase(),
    subtotalCents,
    discountCents,
    couponCode: coupon?.code || null,
    taxableAmountCents,
    taxRateBps,
    taxCents,
    deliveryFeeCents,
    serviceFeeCents,
    ...tipBreakdown,
    totalCents,
    platformFeeCents: feeCents,
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
      totalCents
    }
  };
}
