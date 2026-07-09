import crypto from "crypto";
import { prisma } from "../config/prisma.js";
import { appUrl, driverAppUrl } from "../config/urls.js";
import { publicUrlForRestaurant } from "./domainService.js";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const customerVisibleStatuses = {
  PENDING: "RECEIVED",
  ACCEPTED: "RECEIVED",
  PREPARING: "PREPARING",
  READY: "READY",
  PICKED_UP: "ON_THE_WAY",
  ON_THE_WAY: "ON_THE_WAY",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
  REJECTED: "CANCELLED"
};

export function money(cents = 0) {
  return currency.format((cents || 0) / 100);
}

export function webAppOrigin() {
  return appUrl();
}

export function driverAppOrigin() {
  return driverAppUrl();
}

export function mobileScheme() {
  return (process.env.MOBILE_DEEP_LINK_SCHEME || "loohar").replace(/:\/+$/, "");
}

export function driverMobileScheme() {
  return (process.env.DRIVER_DEEP_LINK_SCHEME || "loohar-driver").replace(/:\/+$/, "");
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function createTrackingToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function trackingExpiresAt() {
  const days = Number(process.env.ORDER_TRACKING_TOKEN_DAYS || 30);
  return new Date(Date.now() + Math.max(1, days) * 86_400_000);
}

export async function issueOrderTrackingToken(orderId) {
  const trackingToken = createTrackingToken();
  const order = await prisma.order.update({
    where: { id: orderId },
    data: {
      trackingTokenHash: hashToken(trackingToken),
      trackingTokenExpiresAt: trackingExpiresAt()
    },
    include: receiptOrderInclude()
  });
  return { order, trackingToken };
}

export function receiptOrderInclude() {
  return {
    restaurant: { include: { websiteSettings: true, domains: true } },
    customer: true,
    items: true,
    statusHistory: { orderBy: { createdAt: "asc" } },
    delivery: { include: { driver: { include: { user: true } }, statusHistory: { orderBy: { createdAt: "asc" } } } },
    payment: true
  };
}

export function normalizeTipInput({ body = {}, orderType = "PICKUP", subtotalCents = 0 }) {
  const legacyTipCents = Math.max(0, Number(body.tipCents || 0));
  const restaurantTipCents = Math.max(0, Number(body.restaurantTipCents ?? (orderType === "DELIVERY" ? 0 : legacyTipCents)));
  const driverTipCents = orderType === "DELIVERY" ? Math.max(0, Number(body.driverTipCents ?? legacyTipCents)) : 0;
  const customTipCents = Math.max(0, Number(body.customTipCents || 0));
  const tipPercentage = body.tipPercentage === undefined || body.tipPercentage === null ? null : Math.max(0, Number(body.tipPercentage));
  const tipCents = restaurantTipCents + driverTipCents;
  const explicitType = body.tipType || (customTipCents > 0 ? "CUSTOM" : tipPercentage ? "PERCENTAGE" : tipCents > 0 ? "FIXED" : "NONE");

  if (tipPercentage !== null && tipPercentage > 100) {
    const error = new Error("Tip percentage must be 100 or less");
    error.status = 400;
    throw error;
  }
  if (tipCents > Math.max(10_000, subtotalCents * 2)) {
    const error = new Error("Tip amount is outside the allowed range");
    error.status = 400;
    throw error;
  }

  return {
    tipCents,
    restaurantTipCents,
    driverTipCents,
    customTipCents,
    tipPercentage,
    tipType: explicitType,
    tipStatus: tipCents > 0 ? "COLLECTED" : "NONE",
    tipCollectedAt: tipCents > 0 ? new Date() : null
  };
}

export function customerTrackingUrls(order, trackingToken) {
  const webUrl = `${webAppOrigin()}/app/order/${encodeURIComponent(order.id)}?token=${encodeURIComponent(trackingToken)}`;
  return {
    label: "Scan to track your order or reorder in Loohar",
    url: webUrl,
    webUrl,
    deepLink: `${mobileScheme()}://order/${encodeURIComponent(order.id)}`
  };
}

export function driverOrderUrls(order) {
  const webUrl = `${driverAppOrigin()}/order/${encodeURIComponent(order.id)}`;
  return {
    label: "Driver: Scan to accept and deliver this order",
    url: webUrl,
    webUrl,
    deepLink: `${driverMobileScheme()}://delivery/${encodeURIComponent(order.id)}`
  };
}

export function publicRestaurantOrderUrls(order) {
  const webUrl = publicUrlForRestaurant(order.restaurant || { slug: order.restaurantSlug || "restaurant" }, "/order");
  return {
    label: "Order direct from this restaurant",
    url: webUrl,
    webUrl
  };
}

function receiptItems(order) {
  return (order.items || []).map((item) => ({
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    totalCents: item.quantity * item.unitPriceCents,
    modifiers: Array.isArray(item.optionsJson) ? item.optionsJson : []
  }));
}

export function buildReceiptPayload(order, { kind = "customer", trackingToken } = {}) {
  const isDelivery = order.type === "DELIVERY";
  const restaurant = order.restaurant || {};
  const website = restaurant.websiteSettings || {};
  const totals = {
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents || 0,
    taxCents: order.taxCents || 0,
    restaurantTipCents: order.restaurantTipCents || 0,
    driverTipCents: order.driverTipCents ?? order.tipCents ?? 0,
    deliveryFeeCents: order.deliveryFeeCents || 0,
    serviceFeeCents: order.payment?.technologyFeeCents || 0,
    totalCents: order.totalCents
  };

  return {
    kind,
    layout: { format: "80mm", provider: "browser_print" },
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      type: order.type,
      status: order.status,
      createdAt: order.createdAt,
      notes: order.notes || "",
      deliveryAddress: isDelivery ? order.deliveryAddress : null
    },
    restaurant: {
      id: restaurant.id,
      name: restaurant.businessName || restaurant.name,
      logoUrl: website.logoUrl || restaurant.logoUrl || null,
      address: [restaurant.address, restaurant.city, restaurant.state, restaurant.zip].filter(Boolean).join(", "),
      phone: restaurant.phone || null
    },
    customer: {
      name: order.customer?.name || "Customer"
    },
    items: receiptItems(order),
    totals,
    payment: {
      method: order.payment?.provider || "Pending",
      status: order.payment?.status || "PENDING"
    },
    qr: {
      customer: trackingToken ? customerTrackingUrls(order, trackingToken) : null,
      driver: isDelivery && ["driver", "delivery", "customer"].includes(kind) ? driverOrderUrls(order) : null,
      publicOrder: publicRestaurantOrderUrls(order)
    },
    text: {
      totals: [
        ["Subtotal", money(totals.subtotalCents)],
        totals.discountCents ? ["Discount", `-${money(totals.discountCents)}`] : null,
        ["Tax", money(totals.taxCents)],
        totals.restaurantTipCents ? ["Restaurant tip", money(totals.restaurantTipCents)] : null,
        totals.driverTipCents ? ["Driver tip", money(totals.driverTipCents)] : null,
        totals.deliveryFeeCents ? ["Delivery fee", money(totals.deliveryFeeCents)] : null,
        totals.serviceFeeCents ? ["Service fee", money(totals.serviceFeeCents)] : null,
        ["Total", money(totals.totalCents)]
      ].filter(Boolean)
    }
  };
}

export function limitedTrackingOrder(order) {
  const visibleStatus = order.delivery?.status === "ASSIGNED" && order.type === "DELIVERY"
    ? "DRIVER_ASSIGNED"
    : customerVisibleStatuses[order.status] || order.status;
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    type: order.type,
    status: visibleStatus,
    internalStatus: order.status,
    createdAt: order.createdAt,
    restaurant: {
      name: order.restaurant?.businessName || order.restaurant?.name,
      slug: order.restaurant?.slug,
      phone: order.restaurant?.phone || null,
      address: [order.restaurant?.address, order.restaurant?.city, order.restaurant?.state, order.restaurant?.zip].filter(Boolean).join(", ")
    },
    items: (order.items || []).map((item) => ({ name: item.name, quantity: item.quantity })),
    delivery: order.delivery ? { status: order.delivery.status } : null,
    totals: {
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents || 0,
      taxCents: order.taxCents || 0,
      restaurantTipCents: order.restaurantTipCents || 0,
      driverTipCents: order.driverTipCents ?? order.tipCents ?? 0,
      deliveryFeeCents: order.deliveryFeeCents || 0,
      totalCents: order.totalCents
    }
  };
}

export async function findOrderForTracking(orderId, token) {
  if (!token) return null;
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: receiptOrderInclude() });
  if (!order || !order.trackingTokenHash || order.trackingTokenHash !== hashToken(token)) return null;
  if (order.trackingTokenExpiresAt && order.trackingTokenExpiresAt < new Date()) return null;
  return order;
}
