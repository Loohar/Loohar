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
    restaurant: { include: { websiteSettings: true, domains: true, locations: true } },
    customer: true,
    items: true,
    statusHistory: { orderBy: { createdAt: "asc" } },
    delivery: { include: { driver: { include: { user: true } }, statusHistory: { orderBy: { createdAt: "asc" } } } },
    payment: true,
    restaurantOrderPayment: { include: { refunds: true } }
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
    label: "Scan to track your order",
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

export function driverAppDownloadUrls() {
  const webUrl = `${webAppOrigin().replace(/\/+$/, "")}/driver-app`;
  return {
    label: "Deliver with Loohar",
    url: webUrl,
    webUrl,
    deepLink: `${driverMobileScheme()}://download`
  };
}

export function publicRestaurantOrderUrls(order) {
  const webUrl = publicUrlForRestaurant(order.restaurant || { slug: order.restaurantSlug || "restaurant" }, "/order");
  return {
    label: "Order directly next time",
    url: webUrl,
    webUrl
  };
}

function safeText(value, fallback = "") {
  const text = value === null || value === undefined ? "" : String(value);
  return text.trim() || fallback;
}

function asCents(value) {
  const cents = Number(value || 0);
  return Number.isFinite(cents) ? Math.round(cents) : 0;
}

function firstActiveLocation(restaurant) {
  return (restaurant?.locations || []).find((location) => location.active) || restaurant?.locations?.[0] || null;
}

function compactAddress(parts = []) {
  return parts.map((part) => safeText(part)).filter(Boolean).join(", ");
}

function receiptTypeForKind(kind = "customer") {
  const normalized = String(kind || "customer").toLowerCase();
  if (normalized === "kitchen" || normalized === "kitchen_ticket") return "KITCHEN_TICKET";
  if (normalized === "driver" || normalized === "driver_slip") return "DRIVER_SLIP";
  if (normalized === "guest" || normalized === "guest_check") return "GUEST_CHECK";
  if (normalized === "test") return "TEST_RECEIPT";
  return "CUSTOMER_RECEIPT";
}

function receiptTitleForType(type) {
  if (type === "KITCHEN_TICKET") return "Kitchen ticket";
  if (type === "DRIVER_SLIP") return "Driver delivery slip";
  if (type === "GUEST_CHECK") return "Guest check - unpaid";
  if (type === "TEST_RECEIPT") return "Printer test receipt";
  return "Customer receipt";
}

function formatReceiptDate(value, timeZone) {
  const date = value ? new Date(value) : new Date();
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone || undefined
    }).format(date);
  } catch {
    return date.toLocaleString("en-US");
  }
}

function normalizeOrderItemModifiers(optionsJson) {
  const rawModifiers = Array.isArray(optionsJson)
    ? optionsJson
    : Array.isArray(optionsJson?.modifiers)
      ? optionsJson.modifiers
      : Array.isArray(optionsJson?.options)
        ? optionsJson.options
        : [];
  return rawModifiers.map((modifier) => ({
    group: safeText(modifier.group || modifier.groupName || modifier.optionGroupName),
    name: safeText(modifier.name || modifier.label || modifier.optionName || modifier.value, "Modifier"),
    priceCents: asCents(modifier.priceCents)
  }));
}

function lineItemTotal(item, modifiers) {
  const modifierTotal = modifiers.reduce((sum, modifier) => sum + asCents(modifier.priceCents), 0);
  return asCents(item.quantity || 1) * (asCents(item.unitPriceCents) + modifierTotal);
}

function receiptItems(order, { kitchenOnly = false } = {}) {
  const items = kitchenOnly
    ? (order.items || []).filter((item) => item.optionsJson?.sendToKitchen !== false)
    : (order.items || []);
  return items.map((item) => {
    const modifiers = normalizeOrderItemModifiers(item.optionsJson);
    return {
      id: item.id,
      name: safeText(item.name, "Menu item"),
      quantity: asCents(item.quantity || 1),
      unitPriceCents: asCents(item.unitPriceCents),
      totalCents: lineItemTotal(item, modifiers),
      modifiers
    };
  });
}

function refundedCentsFor(payment) {
  return (payment?.refunds || [])
    .filter((refund) => ["SUCCEEDED", "PENDING"].includes(refund.status))
    .reduce((sum, refund) => sum + asCents(refund.amountCents), 0);
}

function maskedReference(value = "") {
  const text = safeText(value);
  if (!text) return null;
  if (text.length <= 8) return `...${text}`;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function receiptTotals(order) {
  const payment = order.restaurantOrderPayment || null;
  const subtotalCents = asCents(payment?.subtotalCents ?? order.subtotalCents);
  const discountCents = asCents(payment?.discountCents ?? order.discountCents);
  const taxCents = asCents(payment?.taxCents ?? order.taxCents);
  const deliveryFeeCents = asCents(payment?.deliveryFeeCents ?? order.deliveryFeeCents);
  const serviceFeeCents = asCents(payment?.serviceFeeCents ?? order.payment?.technologyFeeCents);
  const restaurantTipCents = asCents(payment?.restaurantTipCents ?? order.restaurantTipCents);
  const driverTipCents = asCents(payment?.driverTipCents ?? order.driverTipCents ?? order.tipCents);
  const customTipCents = asCents(order.customTipCents);
  const totalCents = asCents(payment?.totalCents ?? order.totalCents);
  const expectedTotalCents = subtotalCents - discountCents + taxCents + deliveryFeeCents + serviceFeeCents + restaurantTipCents + driverTipCents;
  const otherFeesCents = Math.max(0, totalCents - expectedTotalCents);
  return { subtotalCents, discountCents, taxCents, deliveryFeeCents, serviceFeeCents, restaurantTipCents, driverTipCents, customTipCents, otherFeesCents, totalCents, currency: "USD" };
}

function receiptPayment(order, totals) {
  const payment = order.restaurantOrderPayment || order.payment || null;
  const provider = safeText(payment?.provider || order.payment?.provider, "Manual");
  const status = safeText(payment?.status || order.payment?.status, "PENDING");
  const refundedCents = refundedCentsFor(payment) || (order.payment?.refundedAt ? asCents(order.payment?.amountCents) : 0);
  const paidStatuses = new Set(["PAID", "AUTHORIZED", "PARTIALLY_REFUNDED", "REFUNDED", "SUCCEEDED", "COMPLETED", "CAPTURED"]);
  const paidCents = paidStatuses.has(status) ? asCents(payment?.totalCents || order.payment?.amountCents || totals.totalCents) : 0;
  return {
    provider,
    status,
    paidAt: payment?.paidAt || order.payment?.paidAt || null,
    authorizedAt: payment?.authorizedAt || null,
    refundedAt: payment?.refundedAt || order.payment?.refundedAt || null,
    refundedCents,
    balanceCents: Math.max(0, totals.totalCents - paidCents),
    reference: maskedReference(payment?.providerPaymentIntentId || payment?.providerChargeId || order.payment?.providerPaymentId || order.payment?.stripePaymentIntentId)
  };
}

function receiptRestaurant(order) {
  const restaurant = order.restaurant || {};
  const website = restaurant.websiteSettings || {};
  const location = firstActiveLocation(restaurant);
  const locationAddress = safeText(location?.address);
  const address = locationAddress || compactAddress([restaurant.address, restaurant.city, restaurant.state, restaurant.zip]);
  const name = safeText(restaurant.publicBusinessName || restaurant.businessName || restaurant.name, "Restaurant");
  return {
    id: restaurant.id,
    name,
    legalName: safeText(restaurant.businessName || restaurant.name, name),
    slug: restaurant.slug,
    businessType: restaurant.businessType || "RESTAURANT",
    logoUrl: website.logoUrl || restaurant.logoUrl || null,
    address,
    phone: safeText(location?.phone || restaurant.phone),
    email: safeText(restaurant.email || restaurant.businessEmail),
    websiteUrl: publicUrlForRestaurant(restaurant, ""),
    orderUrl: publicRestaurantOrderUrls(order).webUrl,
    timezone: safeText(location?.timezone || restaurant.timezone, "America/Denver"),
    brandColor: safeText(website.brandColor || website.primaryColor || restaurant.brandingJson?.brandColor, "#111827"),
    accentColor: safeText(website.accentColor || website.secondaryColor || restaurant.brandingJson?.accentColor, "#10b981"),
    location: location ? { id: location.id, name: location.name, address: locationAddress, phone: location.phone, timezone: location.timezone } : null
  };
}

function totalsTextRows(totals, payment) {
  return [
    ["Subtotal", money(totals.subtotalCents)],
    totals.discountCents ? ["Discount", `-${money(totals.discountCents)}`] : null,
    ["Tax", money(totals.taxCents)],
    totals.restaurantTipCents ? ["Restaurant tip", money(totals.restaurantTipCents)] : null,
    totals.driverTipCents ? ["Driver tip", money(totals.driverTipCents)] : null,
    totals.deliveryFeeCents ? ["Delivery fee", money(totals.deliveryFeeCents)] : null,
    totals.serviceFeeCents ? ["Service fee", money(totals.serviceFeeCents)] : null,
    totals.otherFeesCents ? ["Other fees", money(totals.otherFeesCents)] : null,
    ["Total", money(totals.totalCents)],
    payment.refundedCents ? ["Refunded", `-${money(payment.refundedCents)}`] : null,
    payment.balanceCents ? ["Balance due", money(payment.balanceCents)] : null
  ].filter(Boolean);
}

function receiptQrCodes(order, trackingToken, receiptType) {
  const publicOrder = publicRestaurantOrderUrls(order);
  const tracking = trackingToken ? customerTrackingUrls(order, trackingToken) : null;
  const driverDownload = ["CUSTOMER_RECEIPT", "DRIVER_SLIP"].includes(receiptType) ? driverAppDownloadUrls() : null;
  return {
    customer: publicOrder,
    publicOrder,
    tracking,
    driver: driverDownload,
    driverAppDownload: driverDownload
  };
}

export function buildReceiptPayload(order, { kind = "customer", trackingToken, format = "80mm", isReprint = false } = {}) {
  const isDelivery = order.type === "DELIVERY";
  const receiptType = receiptTypeForKind(kind);
  const receiptNumberSuffix = receiptType === "KITCHEN_TICKET" ? "K" : receiptType === "DRIVER_SLIP" ? "D" : receiptType === "GUEST_CHECK" ? "G" : receiptType === "TEST_RECEIPT" ? "T" : "C";
  const receiptNumber = `R-${order.orderNumber}-${receiptNumberSuffix}`;
  const receiptId = `${order.id}:${receiptType}`;
  const restaurant = receiptRestaurant(order);
  const totals = receiptTotals(order);
  const settledPayment = receiptPayment(order, totals);
  const payment = receiptType === "GUEST_CHECK"
    ? {
        provider: null,
        status: "UNPAID",
        paidAt: null,
        authorizedAt: null,
        refundedAt: null,
        refundedCents: 0,
        balanceCents: totals.totalCents,
        reference: null
      }
    : settledPayment;
  const qr = receiptQrCodes(order, trackingToken, receiptType);
  const issuedAt = new Date();

  return {
    receipt: {
      id: receiptId,
      receiptNumber,
      type: receiptType,
      issuedAt,
      reprintCount: null,
      isReprint: Boolean(isReprint)
    },
    receiptNumber,
    kind,
    type: receiptType,
    title: receiptTitleForType(receiptType),
    isPaymentReceipt: receiptType !== "GUEST_CHECK",
    issuedAt,
    isReprint: Boolean(isReprint),
    layout: { format: format === "58mm" ? "58mm" : "80mm", provider: "browser_print" },
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      publicOrderNumber: order.orderNumber,
      type: order.type,
      status: order.status,
      createdAt: order.createdAt,
      printedAt: issuedAt,
      displayCreatedAt: formatReceiptDate(order.createdAt, restaurant.timezone),
      notes: safeText(order.notes),
      deliveryAddress: isDelivery ? order.deliveryAddress : null,
      couponCode: safeText(order.couponCode)
    },
    restaurant,
    customer: {
      name: safeText(order.customer?.name, "Customer"),
      email: safeText(order.customer?.email),
      phone: safeText(order.customer?.phone)
    },
    items: receiptItems(order, { kitchenOnly: receiptType === "KITCHEN_TICKET" }),
    totals,
    payment,
    qr,
    qrCodes: {
      customerReorderUrl: qr.customer?.webUrl || null,
      customerReorderToken: null,
      orderTrackingUrl: qr.tracking?.webUrl || null,
      driverAppDownloadUrl: qr.driverAppDownload?.webUrl || null
    },
    platform: {
      name: "Loohar",
      supportEmail: "support@loohar.com",
      websiteUrl: webAppOrigin()
    },
    text: {
      totals: totalsTextRows(totals, payment),
      notice: receiptType === "GUEST_CHECK" ? "GUEST CHECK - UNPAID - NOT A PAYMENT RECEIPT" : null,
      footer: receiptType === "GUEST_CHECK" ? "Amount due - not a payment receipt" : "Powered by Loohar"
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
