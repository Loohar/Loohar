import { prisma } from "../config/prisma.js";
import { recordAudit } from "./auditService.js";

const COMPLETED_ORDER_STATUSES = new Set(["READY", "PICKED_UP", "DELIVERED"]);
const CANCELLED_ORDER_STATUSES = new Set(["CANCELLED", "REJECTED"]);
const ACTIVE_DELIVERY_STATUSES = new Set(["ASSIGNED", "ACCEPTED", "ARRIVED_AT_RESTAURANT", "PICKED_UP", "ON_THE_WAY", "ARRIVED_AT_CUSTOMER", "ISSUE_REPORTED"]);
const PAID_ORDER_PAYMENT_STATUSES = new Set(["PROCESSING", "AUTHORIZED", "PAID", "PARTIALLY_REFUNDED"]);
const REFUNDED_ORDER_PAYMENT_STATUSES = new Set(["REFUNDED", "PARTIALLY_REFUNDED"]);
const PAID_LEGACY_PAYMENT_STATUSES = new Set(["AUTHORIZED", "PAID", "REFUNDED"]);
const SUCCEEDED_REFUND_STATUSES = new Set(["SUCCEEDED"]);
const INTERNAL_GUEST_EMAIL_RE = /(^pos-|@guest\.loohar\.local$|@walk-in\.loohar\.local$)/i;

function cents(value = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function rangeFor(query = {}) {
  const now = new Date();
  const explicitFrom = parseDate(query.from);
  const explicitTo = parseDate(query.to);
  const rangeKey = String(query.range || "30d").toLowerCase();
  const end = explicitTo ? endOfDay(explicitTo) : now;
  let start = explicitFrom ? startOfDay(explicitFrom) : null;

  if (!start) {
    start = new Date(end);
    if (rangeKey === "7d") start.setDate(start.getDate() - 6);
    else if (rangeKey === "90d") start.setDate(start.getDate() - 89);
    else if (rangeKey === "ytd") start = new Date(end.getFullYear(), 0, 1);
    else if (rangeKey === "all") start = new Date("2020-01-01T00:00:00.000Z");
    else start.setDate(start.getDate() - 29);
    start = startOfDay(start);
  }

  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
  return {
    key: explicitFrom || explicitTo ? "custom" : rangeKey,
    start,
    end,
    days,
    label: `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`
  };
}

function dateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function monthKey(date) {
  return new Date(date).toISOString().slice(0, 7);
}

function rangeWhere(range) {
  return { createdAt: { gte: range.start, lte: range.end } };
}

function safeString(value = "") {
  return String(value || "").trim();
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isInternalGuestEmail(email = "") {
  return INTERNAL_GUEST_EMAIL_RE.test(String(email || ""));
}

function safeCustomerName(customer = {}) {
  const name = safeString(customer.name);
  if (name && !/^pos guest/i.test(name) && !/^walk[- ]?in guest/i.test(name)) return name;
  if (customer.phone) return "Phone customer";
  if (customer.email && !isInternalGuestEmail(customer.email)) return customer.email.split("@")[0];
  return "Walk-in guest";
}

function safeCustomerContact(customer = {}) {
  const email = safeString(customer.email);
  const phone = safeString(customer.phone);
  if (email && !isInternalGuestEmail(email)) return { safeEmail: email, contactLabel: email, masked: false };
  if (phone) return { safeEmail: null, contactLabel: phone, masked: false };
  return { safeEmail: null, contactLabel: "Guest checkout", masked: true };
}

function customerTypeFor(customer = {}) {
  if (customer.userId) return "REGISTERED";
  if (customer.phone || (customer.email && !isInternalGuestEmail(customer.email))) return "GUEST_CONTACTABLE";
  return "WALK_IN_GUEST";
}

function successfulRefundTotal(payment) {
  return (payment?.refunds || [])
    .filter((refund) => SUCCEEDED_REFUND_STATUSES.has(refund.status))
    .reduce((sum, refund) => sum + cents(refund.amountCents), 0);
}

function orderPaymentIsPaid(order = {}) {
  if (order.restaurantOrderPayment) return PAID_ORDER_PAYMENT_STATUSES.has(order.restaurantOrderPayment.status);
  if (order.payment) return PAID_LEGACY_PAYMENT_STATUSES.has(order.payment.status);
  return !CANCELLED_ORDER_STATUSES.has(order.status);
}

function orderPaymentIsRefunded(order = {}) {
  if (order.restaurantOrderPayment) {
    return REFUNDED_ORDER_PAYMENT_STATUSES.has(order.restaurantOrderPayment.status) || successfulRefundTotal(order.restaurantOrderPayment) > 0;
  }
  return order.payment?.status === "REFUNDED";
}

function financialsForOrder(order = {}) {
  const orderPayment = order.restaurantOrderPayment;
  const payment = order.payment;
  const subtotalCents = cents(orderPayment?.subtotalCents ?? order.subtotalCents);
  const discountCents = cents(orderPayment?.discountCents ?? order.discountCents);
  const taxableAmountCents = cents(orderPayment?.taxableAmountCents ?? Math.max(0, subtotalCents - discountCents));
  const deliveryFeeCents = cents(orderPayment?.deliveryFeeCents ?? order.deliveryFeeCents);
  const taxCents = cents(orderPayment?.taxCents ?? order.taxCents);
  const serviceFeeCents = cents(orderPayment?.serviceFeeCents ?? payment?.technologyFeeCents);
  const restaurantTipCents = cents(orderPayment?.restaurantTipCents ?? order.restaurantTipCents);
  const driverTipCents = cents(orderPayment?.driverTipCents ?? order.driverTipCents ?? payment?.driverTipCents);
  const platformFeeCents = cents(orderPayment?.platformFeeCents ?? payment?.technologyFeeCents);
  const refundsCents = cents(orderPayment ? successfulRefundTotal(orderPayment) : (payment?.status === "REFUNDED" ? payment.amountCents : 0));
  const totalCents = cents(orderPayment?.totalCents ?? payment?.amountCents ?? order.totalCents);
  const grossSalesCents = Math.max(0, subtotalCents - discountCents + deliveryFeeCents);
  const netSalesCents = Math.max(0, cents(orderPayment?.restaurantNetCents ?? payment?.restaurantNetCents ?? (grossSalesCents + restaurantTipCents - platformFeeCents)) - refundsCents);
  return {
    subtotalCents,
    discountCents,
    taxableAmountCents,
    deliveryFeeCents,
    taxCents,
    serviceFeeCents,
    restaurantTipCents,
    driverTipCents,
    totalTipCents: restaurantTipCents + driverTipCents,
    platformFeeCents,
    refundsCents,
    totalCents,
    grossSalesCents,
    netSalesCents,
    paid: orderPaymentIsPaid(order),
    refunded: orderPaymentIsRefunded(order)
  };
}

function qualifyingOrders(orders = []) {
  return orders.filter((order) => !CANCELLED_ORDER_STATUSES.has(order.status) && orderPaymentIsPaid(order));
}

function orderInclude() {
  return {
    customer: true,
    items: { include: { menuItem: { include: { category: true } } } },
    delivery: { include: { driver: { include: { user: true } }, statusHistory: true } },
    payment: true,
    restaurantOrderPayment: { include: { refunds: true } },
    loyaltyPoints: true
  };
}

function favoriteItemsForOrders(orders = []) {
  const itemCounts = new Map();
  for (const order of orders) {
    for (const item of order.items || []) {
      const key = item.menuItemId || item.name;
      const current = itemCounts.get(key) || { id: key, name: item.name, quantity: 0, revenueCents: 0 };
      current.quantity += cents(item.quantity);
      current.revenueCents += cents(item.quantity) * cents(item.unitPriceCents);
      itemCounts.set(key, current);
    }
  }
  return [...itemCounts.values()].sort((a, b) => b.quantity - a.quantity || b.revenueCents - a.revenueCents).slice(0, 5);
}

function segmentForCustomer({ totalOrders = 0, lifetimeSpendCents = 0, lastOrderDate = null, firstOrderDate = null }) {
  if (!totalOrders) return "NEW_CUSTOMER";
  const now = Date.now();
  const last = lastOrderDate ? new Date(lastOrderDate).getTime() : 0;
  const first = firstOrderDate ? new Date(firstOrderDate).getTime() : now;
  const lastAgeDays = last ? Math.floor((now - last) / 86400000) : 999;
  const firstAgeDays = Math.floor((now - first) / 86400000);
  if (totalOrders >= 10 || lifetimeSpendCents >= 50000) return "VIP_CUSTOMER";
  if (lastAgeDays >= 90) return "INACTIVE_CUSTOMER";
  if (lastAgeDays >= 45) return "AT_RISK_CUSTOMER";
  if (totalOrders <= 1 && firstAgeDays <= 30) return "NEW_CUSTOMER";
  return "ACTIVE_CUSTOMER";
}

export function enrichCustomer(customer = {}) {
  const allOrders = customer.orders || [];
  const paidOrders = qualifyingOrders(allOrders);
  const totalOrders = allOrders.length;
  const completedOrders = allOrders.filter((order) => COMPLETED_ORDER_STATUSES.has(order.status)).length;
  const cancelledOrders = allOrders.filter((order) => CANCELLED_ORDER_STATUSES.has(order.status)).length;
  const refundedOrders = allOrders.filter(orderPaymentIsRefunded).length;
  const lifetimeSpendCents = paidOrders.reduce((sum, order) => sum + financialsForOrder(order).netSalesCents, 0);
  const totalTipsCents = paidOrders.reduce((sum, order) => sum + financialsForOrder(order).totalTipCents, 0);
  const sortedOrders = [...allOrders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const firstOrderDate = sortedOrders.at(-1)?.createdAt || null;
  const lastOrderDate = sortedOrders[0]?.createdAt || null;
  const loyaltyPointBalance = (customer.loyaltyPoints || []).reduce((sum, point) => sum + cents(point.points), 0);
  const contact = safeCustomerContact(customer);
  const computedSegment = segmentForCustomer({ totalOrders, lifetimeSpendCents, lastOrderDate, firstOrderDate });

  return {
    ...customer,
    email: contact.safeEmail,
    safeEmail: contact.safeEmail,
    safeName: safeCustomerName(customer),
    contactLabel: contact.contactLabel,
    contactMasked: contact.masked,
    customerType: customerTypeFor(customer),
    segment: customer.segment || computedSegment,
    computedSegment,
    totalOrders,
    completedOrders,
    cancelledOrders,
    refundedOrders,
    paidOrders: paidOrders.length,
    lifetimeSpendCents,
    totalTipsCents,
    averageOrderValueCents: paidOrders.length ? Math.round(lifetimeSpendCents / paidOrders.length) : 0,
    firstOrderDate,
    lastOrderDate,
    favoriteMenuItems: favoriteItemsForOrders(paidOrders),
    loyaltyPointBalance,
    loyaltyPointsIssued: loyaltyPointBalance,
    consentStatus: contact.safeEmail || customer.phone ? "CONTACTABLE" : "NO_CONTACT",
    orders: sortedOrders.map((order) => serializeOrder(order))
  };
}

function serializeOrder(order = {}) {
  const financials = financialsForOrder(order);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    type: order.type,
    status: order.status,
    customerName: order.customer ? safeCustomerName(order.customer) : "Customer",
    createdAt: order.createdAt,
    totalCents: financials.totalCents,
    netSalesCents: financials.netSalesCents,
    tipCents: financials.totalTipCents,
    refunded: financials.refunded,
    items: (order.items || []).map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      categoryName: item.menuItem?.category?.name || "Uncategorized"
    }))
  };
}

function serializeDelivery(delivery = {}) {
  const startedAt = delivery.claimedAt || delivery.createdAt;
  const deliveredAt = delivery.deliveredAt;
  const durationMinutes = startedAt && deliveredAt ? Math.round((new Date(deliveredAt) - new Date(startedAt)) / 60000) : null;
  return {
    id: delivery.id,
    status: delivery.status,
    orderId: delivery.orderId,
    orderNumber: delivery.order?.orderNumber,
    customerName: delivery.order?.customer ? safeCustomerName(delivery.order.customer) : "Customer",
    pickupAddress: delivery.pickupAddress,
    dropoffAddress: delivery.dropoffAddress,
    driverId: delivery.driverId,
    driverName: delivery.driver?.user?.name || "Unassigned",
    baseEarningsCents: delivery.baseEarningsCents || 0,
    tipCents: delivery.tipCents || 0,
    totalEarningsCents: cents(delivery.baseEarningsCents) + cents(delivery.tipCents),
    createdAt: delivery.createdAt,
    claimedAt: delivery.claimedAt,
    pickedUpAt: delivery.pickedUpAt,
    deliveredAt,
    durationMinutes,
    distanceMiles: null,
    distanceStatus: "Not Tracked"
  };
}

function filterCustomers(customers, query = {}) {
  const search = safeString(query.search).toLowerCase();
  const segment = safeString(query.segment || "ALL").toUpperCase();
  const customerType = safeString(query.customerType || "ALL").toUpperCase();
  return customers.filter((customer) => {
    const searchBlob = [customer.safeName, customer.contactLabel, customer.phone, customer.notes, customer.segment, customer.customerType].filter(Boolean).join(" ").toLowerCase();
    if (search && !searchBlob.includes(search)) return false;
    if (segment !== "ALL" && customer.segment !== segment && customer.computedSegment !== segment) return false;
    if (customerType !== "ALL" && customer.customerType !== customerType) return false;
    return true;
  });
}

function sortCustomers(customers, sort = "last_order") {
  const rows = [...customers];
  if (sort === "lifetime_spend") return rows.sort((a, b) => b.lifetimeSpendCents - a.lifetimeSpendCents);
  if (sort === "orders") return rows.sort((a, b) => b.totalOrders - a.totalOrders);
  if (sort === "name") return rows.sort((a, b) => a.safeName.localeCompare(b.safeName));
  return rows.sort((a, b) => new Date(b.lastOrderDate || b.updatedAt || 0) - new Date(a.lastOrderDate || a.updatedAt || 0));
}

function customerSummaryFor(customers = [], range) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const totalCustomers = customers.length;
  const newCustomersThisMonth = customers.filter((customer) => new Date(customer.createdAt) >= monthStart).length;
  const returningCustomers = customers.filter((customer) => customer.totalOrders > 1).length;
  const vipCustomerCount = customers.filter((customer) => customer.segment === "VIP_CUSTOMER" || customer.computedSegment === "VIP_CUSTOMER").length;
  const activeCustomers = customers.filter((customer) => ["ACTIVE_CUSTOMER", "VIP_CUSTOMER"].includes(customer.computedSegment)).length;
  const inactiveCustomers = customers.filter((customer) => customer.computedSegment === "INACTIVE_CUSTOMER").length;
  const atRiskCustomers = customers.filter((customer) => customer.computedSegment === "AT_RISK_CUSTOMER").length;
  const lifetimeSpendCents = customers.reduce((sum, customer) => sum + cents(customer.lifetimeSpendCents), 0);
  const completedCustomerOrders = customers.reduce((sum, customer) => sum + cents(customer.completedOrders), 0);
  return {
    totalCustomers,
    newCustomersThisMonth,
    newCustomersInRange: customers.filter((customer) => new Date(customer.createdAt) >= range.start && new Date(customer.createdAt) <= range.end).length,
    returningCustomers,
    repeatCustomerPercentage: totalCustomers ? Math.round((returningCustomers / totalCustomers) * 100) : 0,
    vipCustomerCount,
    activeCustomers,
    atRiskCustomers,
    inactiveCustomers,
    lifetimeSpendCents,
    completedCustomerOrders,
    averageOrderValueCents: completedCustomerOrders ? Math.round(lifetimeSpendCents / completedCustomerOrders) : 0,
    contactableCustomers: customers.filter((customer) => customer.consentStatus === "CONTACTABLE").length,
    guestCustomers: customers.filter((customer) => customer.customerType !== "REGISTERED").length
  };
}

export async function buildCustomerInsights(restaurantId, query = {}) {
  const range = rangeFor(query);
  const allCustomers = await prisma.customer.findMany({
    where: { restaurantId },
    include: {
      orders: { include: orderInclude(), orderBy: { createdAt: "desc" } },
      loyaltyPoints: true
    },
    orderBy: { updatedAt: "desc" }
  });
  const enriched = allCustomers.map(enrichCustomer);
  const filtered = sortCustomers(filterCustomers(enriched, query), query.sort);
  const pageSize = Math.min(100, Math.max(10, positiveInteger(query.pageSize, 50)));
  const page = Math.max(1, positiveInteger(query.page, 1));
  const start = (page - 1) * pageSize;
  return {
    customers: filtered.slice(start, start + pageSize),
    summary: customerSummaryFor(enriched, range),
    filters: {
      search: query.search || "",
      segment: query.segment || "ALL",
      customerType: query.customerType || "ALL",
      sort: query.sort || "last_order"
    },
    pagination: { page, pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) },
    range
  };
}

export async function buildCustomerSummary(restaurantId, query = {}) {
  const insights = await buildCustomerInsights(restaurantId, { ...query, pageSize: 10 });
  return insights.summary;
}

export async function buildCustomerDetail(restaurantId, customerId, query = {}) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, restaurantId },
    include: {
      orders: { include: orderInclude(), orderBy: { createdAt: "desc" } },
      loyaltyPoints: { orderBy: { createdAt: "desc" } }
    }
  });
  if (!customer) return null;
  const enriched = enrichCustomer(customer);
  return {
    ...enriched,
    range: rangeFor(query),
    rewardHistory: enriched.loyaltyPoints || [],
    favoriteOrders: enriched.orders.slice(0, 3)
  };
}

function buildTrendRows(orders = [], range) {
  const rows = new Map();
  const useMonth = range.days > 93;
  for (const order of orders) {
    const key = useMonth ? monthKey(order.createdAt) : dateKey(order.createdAt);
    const current = rows.get(key) || { date: key, grossSalesCents: 0, netSalesCents: 0, orders: 0, refundsCents: 0, tipsCents: 0 };
    const financials = financialsForOrder(order);
    current.grossSalesCents += financials.grossSalesCents;
    current.netSalesCents += financials.netSalesCents;
    current.orders += 1;
    current.refundsCents += financials.refundsCents;
    current.tipsCents += financials.totalTipCents;
    rows.set(key, current);
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function orderTypeBreakdown(orders = []) {
  const types = new Map();
  for (const order of orders) {
    const current = types.get(order.type) || { type: order.type, label: order.type.replaceAll("_", " "), orders: 0, netSalesCents: 0 };
    current.orders += 1;
    current.netSalesCents += financialsForOrder(order).netSalesCents;
    types.set(order.type, current);
  }
  return [...types.values()].sort((a, b) => b.orders - a.orders);
}

function itemInsights(orders = []) {
  const byItem = new Map();
  const byCategory = new Map();
  for (const order of orders) {
    for (const item of order.items || []) {
      const itemKey = item.menuItemId || item.name;
      const categoryName = item.menuItem?.category?.name || "Uncategorized";
      const current = byItem.get(itemKey) || { id: itemKey, name: item.name, categoryName, quantity: 0, revenueCents: 0, orders: 0 };
      current.quantity += cents(item.quantity);
      current.revenueCents += cents(item.quantity) * cents(item.unitPriceCents);
      current.orders += 1;
      byItem.set(itemKey, current);
      const category = byCategory.get(categoryName) || { name: categoryName, quantity: 0, revenueCents: 0 };
      category.quantity += cents(item.quantity);
      category.revenueCents += cents(item.quantity) * cents(item.unitPriceCents);
      byCategory.set(categoryName, category);
    }
  }
  const rows = [...byItem.values()].map((item) => ({
    ...item,
    averageQuantitySold: item.orders ? Number((item.quantity / item.orders).toFixed(2)) : 0
  }));
  return {
    topSellingItems: [...rows].sort((a, b) => b.quantity - a.quantity || b.revenueCents - a.revenueCents).slice(0, 10),
    leastSellingItems: [...rows].sort((a, b) => a.quantity - b.quantity || a.revenueCents - b.revenueCents).slice(0, 10),
    revenuePerItem: rows,
    mostProfitableCategories: [...byCategory.values()].sort((a, b) => b.revenueCents - a.revenueCents)
  };
}

function customerGrowthRows(customers = [], range) {
  const rows = new Map();
  const useMonth = range.days > 93;
  for (const customer of customers) {
    const key = useMonth ? monthKey(customer.createdAt) : dateKey(customer.createdAt);
    const current = rows.get(key) || { date: key, customers: 0 };
    current.customers += 1;
    rows.set(key, current);
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function loyaltyGrowthRows(points = [], range) {
  const rows = new Map();
  const useMonth = range.days > 93;
  for (const point of points) {
    const key = useMonth ? monthKey(point.createdAt) : dateKey(point.createdAt);
    const current = rows.get(key) || { date: key, issued: 0, redeemed: 0 };
    if (point.points >= 0) current.issued += point.points;
    else current.redeemed += Math.abs(point.points);
    rows.set(key, current);
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function buildDriverInsights(restaurantId, query = {}) {
  const range = rangeFor(query);
  const [drivers, deliveries, ledger] = await Promise.all([
    prisma.driver.findMany({
      where: { restaurantId },
      include: {
        user: true,
        deliveries: {
          where: rangeWhere(range),
          include: { order: { include: { customer: true, items: true } }, statusHistory: true },
          orderBy: { createdAt: "desc" }
        },
        earningLedger: { where: rangeWhere(range), orderBy: { createdAt: "desc" } }
      },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.delivery.findMany({
      where: { restaurantId, ...rangeWhere(range) },
      include: { driver: { include: { user: true } }, order: { include: { customer: true, items: true } }, statusHistory: true },
      orderBy: { createdAt: "desc" }
    }),
    prisma.driverEarningLedger.findMany({ where: { restaurantId, ...rangeWhere(range) }, orderBy: { createdAt: "desc" } })
  ]);

  const driverRows = drivers.map((driver) => {
    const activeDeliveries = (driver.deliveries || []).filter((delivery) => ACTIVE_DELIVERY_STATUSES.has(delivery.status));
    const completedDeliveries = (driver.deliveries || []).filter((delivery) => delivery.status === "DELIVERED");
    const deliveredDurations = completedDeliveries.map((delivery) => serializeDelivery(delivery).durationMinutes).filter((value) => Number.isFinite(value));
    const ledgerRows = driver.earningLedger || [];
    const earningsCents = ledgerRows.reduce((sum, row) => sum + cents(row.totalCents), 0);
    const tipsCents = ledgerRows.reduce((sum, row) => sum + cents(row.tipCents), 0);
    const deliveriesWithLedger = completedDeliveries.reduce((sum, delivery) => sum + cents(delivery.baseEarningsCents) + cents(delivery.tipCents), 0);
    return {
      id: driver.id,
      userId: driver.userId,
      name: driver.user?.name || driver.user?.email || "Driver",
      email: driver.user?.email,
      phone: driver.user?.phone,
      status: driver.user?.status || "UNKNOWN",
      available: driver.available,
      availabilityLabel: driver.user?.status !== "ACTIVE" ? "Offline" : driver.available ? "Available" : "Unavailable",
      activeDeliveries: activeDeliveries.map(serializeDelivery),
      completedDeliveries: completedDeliveries.length,
      deliveryCount: driver.deliveries?.length || 0,
      earningsCents: earningsCents || deliveriesWithLedger,
      tipsCents: tipsCents || completedDeliveries.reduce((sum, delivery) => sum + cents(delivery.tipCents), 0),
      averageDeliveryMinutes: deliveredDurations.length ? Math.round(deliveredDurations.reduce((sum, value) => sum + value, 0) / deliveredDurations.length) : null,
      distanceMiles: null,
      distanceStatus: "Not Tracked",
      hoursStatus: "Setup Required",
      currentLat: driver.currentLat,
      currentLng: driver.currentLng,
      updatedAt: driver.updatedAt
    };
  });

  const availableDrivers = driverRows.filter((driver) => driver.status === "ACTIVE" && driver.available && driver.activeDeliveries.length === 0);
  const busyDrivers = driverRows.filter((driver) => driver.status === "ACTIVE" && driver.activeDeliveries.length > 0);
  const offlineDrivers = driverRows.filter((driver) => driver.status !== "ACTIVE" || (!driver.available && driver.activeDeliveries.length === 0));
  const deliveryRows = deliveries.map(serializeDelivery);
  const completedDeliveryRows = deliveryRows.filter((delivery) => delivery.status === "DELIVERED");
  const durationRows = completedDeliveryRows.map((delivery) => delivery.durationMinutes).filter((value) => Number.isFinite(value));

  return {
    drivers: driverRows,
    availableDrivers,
    busyDrivers,
    offlineDrivers,
    deliveries: deliveryRows,
    summary: {
      totalDrivers: driverRows.length,
      availableDrivers: availableDrivers.length,
      busyDrivers: busyDrivers.length,
      offlineDrivers: offlineDrivers.length,
      totalActiveDrivers: availableDrivers.length + busyDrivers.length,
      activeDeliveries: deliveryRows.filter((delivery) => ACTIVE_DELIVERY_STATUSES.has(delivery.status)).length,
      completedDeliveries: completedDeliveryRows.length,
      deliveryPayoutCents: ledger.reduce((sum, row) => sum + cents(row.totalCents), 0) || completedDeliveryRows.reduce((sum, delivery) => sum + cents(delivery.totalEarningsCents), 0),
      driverTipsCents: ledger.reduce((sum, row) => sum + cents(row.tipCents), 0) || completedDeliveryRows.reduce((sum, delivery) => sum + cents(delivery.tipCents), 0),
      averageDeliveryMinutes: durationRows.length ? Math.round(durationRows.reduce((sum, value) => sum + value, 0) / durationRows.length) : null,
      onTimeRate: null,
      onTimeStatus: "Not Tracked",
      mileageStatus: "Not Tracked",
      schedulingStatus: "Setup Required"
    },
    range
  };
}

export async function buildOperationsReport(restaurantId, query = {}) {
  const range = rangeFor(query);
  const [orders, customers, loyaltyPoints, driverInsights] = await Promise.all([
    prisma.order.findMany({ where: { restaurantId, ...rangeWhere(range) }, include: orderInclude(), orderBy: { createdAt: "desc" } }),
    prisma.customer.findMany({ where: { restaurantId }, include: { orders: { include: orderInclude() }, loyaltyPoints: true } }),
    prisma.loyaltyPoint.findMany({ where: { restaurantId, ...rangeWhere(range) }, orderBy: { createdAt: "asc" } }),
    buildDriverInsights(restaurantId, query)
  ]);

  const paidOrders = qualifyingOrders(orders);
  const cancelledOrders = orders.filter((order) => CANCELLED_ORDER_STATUSES.has(order.status));
  const openOrders = orders.filter((order) => !COMPLETED_ORDER_STATUSES.has(order.status) && !CANCELLED_ORDER_STATUSES.has(order.status));
  const financialRows = paidOrders.map(financialsForOrder);
  const sales = {
    grossSalesCents: financialRows.reduce((sum, row) => sum + row.grossSalesCents, 0),
    netSalesCents: financialRows.reduce((sum, row) => sum + row.netSalesCents, 0),
    totalCollectedCents: financialRows.reduce((sum, row) => sum + row.totalCents, 0),
    dailySalesCents: paidOrders.filter((order) => new Date(order.createdAt) >= startOfDay(new Date())).reduce((sum, order) => sum + financialsForOrder(order).netSalesCents, 0),
    weeklySalesCents: paidOrders.filter((order) => {
      const weekStart = startOfDay(new Date());
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      return new Date(order.createdAt) >= weekStart;
    }).reduce((sum, order) => sum + financialsForOrder(order).netSalesCents, 0),
    monthlySalesCents: paidOrders.filter((order) => {
      const now = new Date();
      return new Date(order.createdAt) >= new Date(now.getFullYear(), now.getMonth(), 1);
    }).reduce((sum, order) => sum + financialsForOrder(order).netSalesCents, 0),
    totalOrders: orders.length,
    completedOrders: orders.filter((order) => COMPLETED_ORDER_STATUSES.has(order.status)).length,
    paidOrders: paidOrders.length,
    openOrders: openOrders.length,
    cancelledOrders: cancelledOrders.length,
    refundedOrders: paidOrders.filter(orderPaymentIsRefunded).length,
    averageOrderValueCents: paidOrders.length ? Math.round(financialRows.reduce((sum, row) => sum + row.netSalesCents, 0) / paidOrders.length) : 0,
    discountsCents: financialRows.reduce((sum, row) => sum + row.discountCents, 0),
    taxesCents: financialRows.reduce((sum, row) => sum + row.taxCents, 0),
    tipsCents: financialRows.reduce((sum, row) => sum + row.totalTipCents, 0),
    restaurantTipsCents: financialRows.reduce((sum, row) => sum + row.restaurantTipCents, 0),
    driverTipsCents: financialRows.reduce((sum, row) => sum + row.driverTipCents, 0),
    deliveryFeesCents: financialRows.reduce((sum, row) => sum + row.deliveryFeeCents, 0),
    serviceFeesCents: financialRows.reduce((sum, row) => sum + row.serviceFeeCents, 0),
    platformFeesCents: financialRows.reduce((sum, row) => sum + row.platformFeeCents, 0),
    refundsCents: financialRows.reduce((sum, row) => sum + row.refundsCents, 0),
    deliveryOrders: paidOrders.filter((order) => order.type === "DELIVERY").length,
    pickupOrders: paidOrders.filter((order) => order.type === "PICKUP").length,
    dineInOrders: paidOrders.filter((order) => order.type === "DINE_IN").length,
    walkInOrders: paidOrders.filter((order) => order.type === "WALK_IN").length,
    completionRate: orders.length ? Math.round((orders.filter((order) => COMPLETED_ORDER_STATUSES.has(order.status)).length / orders.length) * 100) : 0,
    cancellationRate: orders.length ? Math.round((cancelledOrders.length / orders.length) * 100) : 0,
    refundRate: paidOrders.length ? Math.round((paidOrders.filter(orderPaymentIsRefunded).length / paidOrders.length) * 100) : 0,
    laborCostStatus: "Setup Required",
    estimatedProfitStatus: "Setup Required"
  };

  const enrichedCustomers = customers.map(enrichCustomer);
  const customerSummary = customerSummaryFor(enrichedCustomers, range);
  const trendRows = buildTrendRows(paidOrders, range);
  const itemRows = itemInsights(paidOrders);

  return {
    range,
    generatedAt: new Date().toISOString(),
    sales,
    items: itemRows,
    customers: customerSummary,
    drivers: driverInsights.drivers,
    driverSummary: driverInsights.summary,
    charts: {
      salesTrend: trendRows,
      ordersTrend: trendRows.map((row) => ({ date: row.date, orders: row.orders })),
      customerGrowth: customerGrowthRows(enrichedCustomers.filter((customer) => new Date(customer.createdAt) >= range.start && new Date(customer.createdAt) <= range.end), range),
      loyaltyGrowth: loyaltyGrowthRows(loyaltyPoints, range),
      orderTypeBreakdown: orderTypeBreakdown(paidOrders),
      refundsTrend: trendRows.map((row) => ({ date: row.date, refundsCents: row.refundsCents })),
      tipsTrend: trendRows.map((row) => ({ date: row.date, tipsCents: row.tipsCents })),
      driverPerformance: driverInsights.drivers.map((driver) => ({
        driverId: driver.id,
        name: driver.name,
        deliveries: driver.completedDeliveries,
        tipsCents: driver.tipsCents,
        earningsCents: driver.earningsCents,
        averageDeliveryMinutes: driver.averageDeliveryMinutes
      })).sort((a, b) => b.deliveries - a.deliveries)
    },
    drilldowns: {
      ordersByStatus: Object.entries(orders.reduce((acc, order) => ({ ...acc, [order.status]: (acc[order.status] || 0) + 1 }), {})).map(([status, count]) => ({ status, count })),
      recentOrders: paidOrders.slice(0, 12).map(serializeOrder),
      refunds: paidOrders.filter(orderPaymentIsRefunded).map(serializeOrder)
    },
    definitions: {
      revenueSource: "Paid Stripe/order payment records when available; POS or cash orders are included only when their order status is not cancelled.",
      laborCostStatus: "Setup Required",
      mileageStatus: "Not Tracked"
    }
  };
}

function locationSettings(location = {}) {
  return location.settingsJson && typeof location.settingsJson === "object" && !Array.isArray(location.settingsJson) ? location.settingsJson : {};
}

function normalizeLocation(location = {}, restaurant = {}) {
  const settings = locationSettings(location);
  return {
    ...location,
    address2: settings.address2 || "",
    city: settings.city || restaurant.city || "",
    state: settings.state || restaurant.state || "",
    zip: settings.zip || restaurant.zip || "",
    country: settings.country || "US",
    primary: settings.primary !== false,
    statusLabel: location.active ? "Active" : "Inactive"
  };
}

function validTimezone(timezone) {
  if (!timezone) return true;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export async function ensureRestaurantLocations(restaurantId) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!restaurant) return [];
  let locations = await prisma.restaurantLocation.findMany({ where: { restaurantId }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] });
  if (!locations.length) {
    const created = await prisma.restaurantLocation.create({
      data: {
        restaurantId,
        name: restaurant.publicName || restaurant.businessName || restaurant.name || "Primary location",
        address: restaurant.address || "",
        phone: restaurant.phone || "",
        timezone: restaurant.timezone || "America/Denver",
        settingsJson: {
          primary: true,
          city: restaurant.city || "",
          state: restaurant.state || "",
          zip: restaurant.zip || "",
          country: "US"
        }
      }
    });
    locations = [created];
  }
  return locations.map((location) => normalizeLocation(location, restaurant));
}

export async function updateRestaurantLocation({ restaurantId, locationId, data = {}, actorUserId }) {
  const existing = await prisma.restaurantLocation.findFirst({ where: { id: locationId, restaurantId } });
  if (!existing) {
    const error = new Error("Location not found");
    error.status = 404;
    throw error;
  }
  if (data.timezone && !validTimezone(data.timezone)) {
    const error = new Error("Invalid timezone");
    error.status = 400;
    throw error;
  }
  const settings = {
    ...locationSettings(existing),
    address2: safeString(data.address2),
    city: safeString(data.city),
    state: safeString(data.state),
    zip: safeString(data.zip),
    country: safeString(data.country || "US"),
    primary: data.primary !== false
  };
  const updateData = {
    name: safeString(data.name || existing.name),
    address: safeString(data.address),
    phone: safeString(data.phone),
    timezone: safeString(data.timezone || existing.timezone || "America/Denver"),
    active: data.active !== false,
    settingsJson: settings
  };
  const [location, restaurant] = await prisma.$transaction([
    prisma.restaurantLocation.update({ where: { id: existing.id }, data: updateData }),
    settings.primary
      ? prisma.restaurant.update({
          where: { id: restaurantId },
          data: {
            address: updateData.address,
            city: settings.city,
            state: settings.state,
            zip: settings.zip,
            phone: updateData.phone,
            timezone: updateData.timezone
          }
        })
      : prisma.restaurant.findUnique({ where: { id: restaurantId } })
  ]);
  if (actorUserId) {
    await recordAudit({
      actorUserId,
      restaurantId,
      action: "restaurant.location.updated",
      entityType: "RestaurantLocation",
      entityId: location.id,
      metadata: { primary: settings.primary, active: updateData.active }
    });
  }
  return {
    location: normalizeLocation(location, restaurant),
    locations: await ensureRestaurantLocations(restaurantId),
    restaurant
  };
}
