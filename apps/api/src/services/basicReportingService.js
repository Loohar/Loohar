// Basic sales and payment reconciliation summary, included with every plan.
//
// Every number is computed from stored rows (orders, payments, refunds); nothing is taken from the
// request except the day being reported and an optional location filter. Advanced analytics stay in
// buildOperationsReport.
import { prisma } from "../config/prisma.js";

const SETTLED_PAYMENT_STATUSES = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"];
const IN_FLIGHT_PAYMENT_STATUSES = ["REQUIRES_PAYMENT_METHOD", "REQUIRES_CONFIRMATION", "PROCESSING", "AUTHORIZED"];

function zonedDayRange(day, timezone) {
  const base = day ? new Date(`${day}T12:00:00Z`) : new Date();
  if (Number.isNaN(base.getTime())) {
    const error = new Error("Report day must be an ISO date such as 2026-09-18.");
    error.status = 400;
    error.code = "REPORT_DAY_INVALID";
    throw error;
  }
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const localDay = formatter.format(base);
  // Find the UTC instants that bound the local calendar day by probing the offset at midday.
  const offsetMinutes = (() => {
    const probe = new Date(`${localDay}T12:00:00Z`);
    const localised = new Date(probe.toLocaleString("en-US", { timeZone: timezone }));
    const utc = new Date(probe.toLocaleString("en-US", { timeZone: "UTC" }));
    return Math.round((utc.getTime() - localised.getTime()) / 60000);
  })();
  const from = new Date(new Date(`${localDay}T00:00:00Z`).getTime() + offsetMinutes * 60000);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { day: localDay, from, to, timezone };
}

// How the money was taken. Online card payments carry no POS source marker.
function paymentMethod(payment) {
  const source = typeof payment.quoteJson === "object" && payment.quoteJson ? String(payment.quoteJson.source || "") : "";
  if (payment.provider === "MANUAL") return source === "POS_CASH" ? "POS_CASH" : "MANUAL";
  if (source === "POS_TERMINAL") return "POS_CARD_PRESENT";
  if (source === "POS") return "POS_CARD";
  return "ONLINE_CARD";
}

function sumBy(rows, field) {
  return rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
}

// Payments the restaurant can act on: one row per order payment, with how it was taken and how much
// of it has been refunded. Amounts and refund state always come from stored rows.
export async function listRestaurantPayments({ restaurantId, day, locationId, limit = 100 }) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { timezone: true } });
  if (!restaurant) {
    const error = new Error("Restaurant not found.");
    error.status = 404;
    throw error;
  }
  const range = zonedDayRange(day, restaurant.timezone || "America/Denver");
  const location = locationId
    ? await prisma.restaurantLocation.findFirst({ where: { id: locationId, restaurantId }, select: { id: true } })
    : null;
  if (locationId && !location) {
    const error = new Error("Location not found for this restaurant.");
    error.status = 404;
    error.code = "LOCATION_NOT_FOUND";
    throw error;
  }
  const payments = await prisma.restaurantOrderPayment.findMany({
    where: {
      restaurantId,
      createdAt: { gte: range.from, lt: range.to },
      ...(location ? { order: { locationId: location.id } } : {})
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(Number(limit) || 100, 1), 200),
    select: {
      id: true, orderId: true, status: true, provider: true, currency: true, quoteJson: true,
      subtotalCents: true, discountCents: true, taxCents: true, deliveryFeeCents: true,
      restaurantTipCents: true, driverTipCents: true, totalCents: true,
      paidAt: true, createdAt: true, failureReason: true,
      order: { select: { orderNumber: true, type: true, status: true, locationId: true, customer: { select: { name: true } } } },
      refunds: { select: { id: true, amountCents: true, status: true, reason: true, createdAt: true }, orderBy: { createdAt: "desc" } }
    }
  });
  return {
    range: { day: range.day, from: range.from.toISOString(), to: range.to.toISOString(), timezone: range.timezone },
    locationId: location?.id || null,
    payments: payments.map((payment) => {
      const refundedCents = payment.refunds.filter((refund) => refund.status === "SUCCEEDED").reduce((sum, refund) => sum + refund.amountCents, 0);
      return {
        id: payment.id,
        orderId: payment.orderId,
        orderNumber: payment.order?.orderNumber || null,
        orderType: payment.order?.type || null,
        orderStatus: payment.order?.status || null,
        customerName: payment.order?.customer?.name || null,
        method: paymentMethod(payment),
        status: payment.status,
        currency: payment.currency,
        subtotalCents: payment.subtotalCents,
        discountCents: payment.discountCents,
        taxCents: payment.taxCents,
        deliveryFeeCents: payment.deliveryFeeCents,
        tipCents: (payment.restaurantTipCents || 0) + (payment.driverTipCents || 0),
        restaurantTipCents: payment.restaurantTipCents || 0,
        driverTipCents: payment.driverTipCents || 0,
        totalCents: payment.totalCents,
        refundedCents,
        refundableCents: ["PAID", "PARTIALLY_REFUNDED"].includes(payment.status) ? Math.max(0, payment.totalCents - refundedCents) : 0,
        paidAt: payment.paidAt,
        createdAt: payment.createdAt,
        failureReason: payment.failureReason,
        refunds: payment.refunds
      };
    })
  };
}

export async function buildBasicSalesSummary({ restaurantId, day, locationId }) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { timezone: true } });
  if (!restaurant) {
    const error = new Error("Restaurant not found.");
    error.status = 404;
    throw error;
  }
  const range = zonedDayRange(day, restaurant.timezone || "America/Denver");
  const location = locationId
    ? await prisma.restaurantLocation.findFirst({ where: { id: locationId, restaurantId }, select: { id: true } })
    : null;
  if (locationId && !location) {
    const error = new Error("Location not found for this restaurant.");
    error.status = 404;
    error.code = "LOCATION_NOT_FOUND";
    throw error;
  }

  const orderWhere = { restaurantId, createdAt: { gte: range.from, lt: range.to }, ...(location ? { locationId: location.id } : {}) };
  const [orders, payments, refunds] = await Promise.all([
    prisma.order.findMany({
      where: orderWhere,
      select: { id: true, type: true, status: true, subtotalCents: true, discountCents: true, taxCents: true, deliveryFeeCents: true, restaurantTipCents: true, driverTipCents: true, tipCents: true, totalCents: true }
    }),
    prisma.restaurantOrderPayment.findMany({
      where: { restaurantId, createdAt: { gte: range.from, lt: range.to } },
      select: { id: true, orderId: true, provider: true, status: true, totalCents: true, restaurantTipCents: true, driverTipCents: true, taxCents: true, quoteJson: true, order: { select: { locationId: true } } }
    }),
    prisma.restaurantRefund.findMany({
      where: { restaurantId, status: "SUCCEEDED", createdAt: { gte: range.from, lt: range.to } },
      select: { id: true, amountCents: true, orderPayment: { select: { order: { select: { locationId: true } } } } }
    })
  ]);

  const scopedPayments = location ? payments.filter((payment) => payment.order?.locationId === location.id) : payments;
  const scopedRefunds = location ? refunds.filter((refund) => refund.orderPayment?.order?.locationId === location.id) : refunds;
  const settled = scopedPayments.filter((payment) => SETTLED_PAYMENT_STATUSES.includes(payment.status));
  const inFlight = scopedPayments.filter((payment) => IN_FLIGHT_PAYMENT_STATUSES.includes(payment.status));
  const failed = scopedPayments.filter((payment) => ["FAILED", "CANCELED"].includes(payment.status));

  const byMethod = new Map();
  for (const payment of settled) {
    const method = paymentMethod(payment);
    const bucket = byMethod.get(method) || { method, count: 0, amountCents: 0 };
    bucket.count += 1;
    bucket.amountCents += Number(payment.totalCents) || 0;
    byMethod.set(method, bucket);
  }

  const countedOrders = orders.filter((order) => !["CANCELLED", "REJECTED"].includes(order.status));
  // Restaurant and driver tips stay separate: they are paid out to different people.
  const restaurantTipsCents = sumBy(settled, "restaurantTipCents");
  const driverTipsCents = sumBy(settled, "driverTipCents");
  const tipsCents = restaurantTipsCents + driverTipsCents;
  const collectedCents = sumBy(settled, "totalCents");
  const refundedCents = sumBy(scopedRefunds, "amountCents");
  const paidOrderIds = new Set(settled.map((payment) => payment.orderId));

  return {
    range: { day: range.day, from: range.from.toISOString(), to: range.to.toISOString(), timezone: range.timezone },
    locationId: location?.id || null,
    orders: {
      count: countedOrders.length,
      cancelledCount: orders.length - countedOrders.length,
      byType: countedOrders.reduce((counts, order) => ({ ...counts, [order.type]: (counts[order.type] || 0) + 1 }), {})
    },
    sales: {
      subtotalCents: sumBy(countedOrders, "subtotalCents"),
      discountCents: sumBy(countedOrders, "discountCents"),
      taxCents: sumBy(countedOrders, "taxCents"),
      deliveryFeeCents: sumBy(countedOrders, "deliveryFeeCents"),
      orderTotalCents: sumBy(countedOrders, "totalCents")
    },
    payments: {
      collectedCents,
      tipsCents,
      restaurantTipsCents,
      driverTipsCents,
      taxCollectedCents: sumBy(settled, "taxCents"),
      settledCount: settled.length,
      byMethod: [...byMethod.values()].sort((left, right) => right.amountCents - left.amountCents)
    },
    refunds: { count: scopedRefunds.length, amountCents: refundedCents },
    // What the restaurant should be able to tie out at the end of the day.
    reconciliation: {
      netCollectedCents: collectedCents - refundedCents,
      awaitingPaymentCount: inFlight.length,
      awaitingPaymentCents: sumBy(inFlight, "totalCents"),
      failedPaymentCount: failed.length,
      ordersWithoutSettledPaymentCount: countedOrders.filter((order) => !paidOrderIds.has(order.id)).length,
      platformFeeCents: 0
    }
  };
}
