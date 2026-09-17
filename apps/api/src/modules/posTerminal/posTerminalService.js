// Stripe Terminal card-present payments for the POS.
//
// Card data never reaches Loohar: the reader talks to Stripe directly. Loohar creates the
// PaymentIntent on the restaurant's connected account (direct charge, zero platform fee), hands it
// to a reader the restaurant registered, and lets the existing Stripe Connect webhook settle it.
// Simulated readers are for staging rehearsal and are refused outside Stripe test mode. Terminal
// payments always require connectivity; there is no offline card capture.
import { prisma } from "../../config/prisma.js";
import { recordAudit } from "../../services/auditService.js";
import { POS_PERMISSION, assertPosFeature, assertPosPermission, httpError, requireActiveDevice } from "../../services/posService.js";
import {
  assertStripeConnectConfigured,
  assertStripeConnectModeAllowed,
  stripeForm,
  stripeKeyMode,
  stripeRequest
} from "../paymentProviders/stripeRest.js";

const SIMULATED_REGISTRATION_CODES = new Set(["simulated-wpe", "simulated-bbpos-wisepos-e", "simulated-stripe-s700"]);
const PAYABLE_BLOCKING_STATUSES = new Set(["AUTHORIZED", "PAID", "PARTIALLY_REFUNDED", "REFUNDED", "PROCESSING"]);
// A stored PaymentIntent may only be handed to a reader again while it is still waiting for a card.
const REUSABLE_INTENT_STATUSES = new Set(["requires_payment_method", "requires_confirmation"]);
const CANCELLABLE_INTENT_STATUSES = new Set(["requires_payment_method", "requires_confirmation", "requires_capture", "requires_action", "processing"]);
// Stripe rejects card charges below this; fail with a readable message instead of a raw Stripe error.
const MINIMUM_CHARGE_CENTS = 50;

function assertSimulationAllowed(reader) {
  if (!reader?.simulated) return;
  if (stripeKeyMode(process.env.STRIPE_CONNECT_SECRET_KEY || "") !== "TEST") {
    throw httpError("Simulated readers are only available with Stripe test credentials.", 403, { code: "POS_TERMINAL_SIMULATED_NOT_ALLOWED" });
  }
}

function connectSecretKey() {
  assertStripeConnectConfigured();
  assertStripeConnectModeAllowed();
  return process.env.STRIPE_CONNECT_SECRET_KEY;
}

function terminalRequest({ path, body, stripeAccount, idempotencyKey }) {
  return stripeRequest({ secretKey: connectSecretKey(), path, body, stripeAccount, idempotencyKey });
}

async function readyMerchant(restaurantId) {
  const merchant = await prisma.restaurantMerchantAccount.findFirst({ where: { restaurantId, provider: "STRIPE_CONNECT" } });
  if (!merchant?.stripeAccountId || !merchant.stripeChargesEnabled || merchant.status !== "ENABLED") {
    throw httpError("Restaurant payment account is not ready for card payments.", 409, { code: "POS_CARD_MERCHANT_NOT_READY" });
  }
  return merchant;
}

// Every reader belongs to a Stripe Terminal location on the restaurant's own connected account.
async function ensureTerminalLocation({ restaurant, merchant }) {
  if (merchant.stripeTerminalLocationId) return merchant.stripeTerminalLocationId;
  const location = await terminalRequest({
    path: "/terminal/locations",
    stripeAccount: merchant.stripeAccountId,
    idempotencyKey: `terminal_location_${merchant.id}`,
    body: stripeForm({
      display_name: String(restaurant.businessName || restaurant.name || "Restaurant").slice(0, 100),
      "address[line1]": restaurant.address || "Address on file",
      "address[city]": restaurant.city || "",
      "address[state]": restaurant.state || "",
      "address[postal_code]": restaurant.zip || "",
      "address[country]": merchant.country || "US"
    })
  });
  await prisma.restaurantMerchantAccount.update({ where: { id: merchant.id }, data: { stripeTerminalLocationId: location.id } });
  return location.id;
}

export async function listTerminalReaders({ restaurantId, user }) {
  await assertPosFeature(restaurantId, "GET");
  await assertPosPermission(user, restaurantId, POS_PERMISSION.ACCESS);
  const readers = await prisma.posTerminalReader.findMany({
    where: { restaurantId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, locationId: true, stripeReaderId: true, deviceTypeLabel: true, serialNumber: true, simulated: true, lastSeenAt: true, createdAt: true }
  });
  return { readers };
}

export async function registerTerminalReader({ restaurantId, user, body = {} }) {
  await assertPosFeature(restaurantId, "POST");
  await assertPosPermission(user, restaurantId, POS_PERMISSION.MANAGE_DEVICES);
  const registrationCode = String(body.registrationCode || "").trim();
  if (!registrationCode) throw httpError("Enter the pairing code shown on the reader.", 400, { code: "POS_TERMINAL_REGISTRATION_CODE_REQUIRED" });
  const simulated = SIMULATED_REGISTRATION_CODES.has(registrationCode);
  assertSimulationAllowed({ simulated });
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!restaurant) throw httpError("Restaurant not found.", 404);
  const merchant = await readyMerchant(restaurantId);
  const locationId = body.locationId
    ? (await prisma.restaurantLocation.findFirst({ where: { id: String(body.locationId), restaurantId }, select: { id: true } }))?.id
    : null;
  if (body.locationId && !locationId) throw httpError("Location not found for this restaurant.", 404, { code: "POS_LOCATION_NOT_FOUND" });
  const stripeLocationId = await ensureTerminalLocation({ restaurant, merchant });
  const label = String(body.label || "Card reader").slice(0, 120);
  const reader = await terminalRequest({
    path: "/terminal/readers",
    stripeAccount: merchant.stripeAccountId,
    body: stripeForm({ registration_code: registrationCode, label, location: stripeLocationId })
  });
  const existingReader = await prisma.posTerminalReader.findUnique({ where: { stripeReaderId: reader.id }, select: { restaurantId: true } });
  if (existingReader && existingReader.restaurantId !== restaurantId) {
    throw httpError("That card reader is registered to another restaurant.", 409, { code: "POS_TERMINAL_READER_CONFLICT" });
  }
  const stored = await prisma.posTerminalReader.upsert({
    where: { stripeReaderId: reader.id },
    update: { label, locationId, status: "ACTIVE", removedAt: null, stripeLocationId, deviceTypeLabel: reader.device_type || null, serialNumber: reader.serial_number || null, simulated },
    create: {
      restaurantId,
      locationId,
      stripeReaderId: reader.id,
      stripeLocationId,
      label,
      deviceTypeLabel: reader.device_type || null,
      serialNumber: reader.serial_number || null,
      simulated,
      registeredByUserId: user.id
    }
  });
  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: "pos.terminal.reader.registered",
    entityType: "PosTerminalReader",
    entityId: stored.id,
    metadata: { simulated, locationId, deviceType: reader.device_type || null }
  });
  return { reader: { id: stored.id, label: stored.label, simulated: stored.simulated, locationId: stored.locationId, deviceTypeLabel: stored.deviceTypeLabel } };
}

export async function removeTerminalReader({ restaurantId, user, readerId }) {
  await assertPosFeature(restaurantId, "DELETE");
  await assertPosPermission(user, restaurantId, POS_PERMISSION.MANAGE_DEVICES);
  const reader = await prisma.posTerminalReader.findFirst({ where: { id: readerId, restaurantId, status: "ACTIVE" } });
  if (!reader) throw httpError("Card reader not found.", 404, { code: "POS_TERMINAL_READER_NOT_FOUND" });
  const merchant = await readyMerchant(restaurantId);
  // Best effort: Stripe may already have the reader unregistered; the local row is the source of truth.
  await stripeRequest({
    secretKey: connectSecretKey(),
    path: `/terminal/readers/${reader.stripeReaderId}`,
    stripeAccount: merchant.stripeAccountId,
    method: "DELETE"
  }).catch(() => null);
  await prisma.posTerminalReader.update({ where: { id: reader.id }, data: { status: "REMOVED", removedAt: new Date() } });
  await recordAudit({ actorUserId: user.id, restaurantId, action: "pos.terminal.reader.removed", entityType: "PosTerminalReader", entityId: reader.id });
  return { removed: true };
}

// The Terminal SDK on the register exchanges this short-lived secret for a reader connection.
// It is returned to an authenticated POS session and never stored or logged.
export async function createTerminalConnectionToken({ restaurantId, user, deviceId, fingerprint }) {
  await assertPosFeature(restaurantId, "POST");
  await assertPosPermission(user, restaurantId, POS_PERMISSION.ACCEPT_CARD);
  await requireActiveDevice({ restaurantId, deviceId, fingerprint });
  const merchant = await readyMerchant(restaurantId);
  const token = await terminalRequest({ path: "/terminal/connection_tokens", stripeAccount: merchant.stripeAccountId, body: stripeForm({}) });
  return { secret: token.secret, stripeAccountId: merchant.stripeAccountId };
}

async function payableOrderForTerminal({ restaurantId, orderId, device }) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, restaurantId, ...(device.locationId ? { locationId: device.locationId } : {}) },
    include: { restaurantOrderPayment: true, payment: { select: { status: true } } }
  });
  if (!order) throw httpError("Order not found.", 404);
  if (PAYABLE_BLOCKING_STATUSES.has(order.restaurantOrderPayment?.status) || ["AUTHORIZED", "PAID", "REFUNDED"].includes(order.payment?.status)) {
    throw httpError("This order already has a completed payment.", 409, { code: "POS_CARD_ALREADY_PAID" });
  }
  // The customer's own checkout could still be confirmed in their browser; cancel it first.
  if (order.restaurantOrderPayment?.checkoutIdempotencyKeyHash && !["CANCELED"].includes(order.restaurantOrderPayment.status)) {
    throw httpError("This order has an open online card checkout. Cancel the online order before charging a reader.", 409, { code: "POS_TERMINAL_ONLINE_CHECKOUT_OPEN" });
  }
  if (["CANCELLED", "REJECTED"].includes(order.status)) throw httpError("This order is closed.", 409, { code: "POS_ORDER_CLOSED" });
  if (order.totalCents < MINIMUM_CHARGE_CENTS) {
    throw httpError(`Card payments must be at least ${(MINIMUM_CHARGE_CENTS / 100).toFixed(2)}.`, 400, { code: "POS_TERMINAL_AMOUNT_TOO_SMALL" });
  }
  return order;
}

// Amounts always come from the stored order, never from the register's request body. The row is
// claimed under a per-order lock and re-read inside it, so a payment the webhook settled in the
// meantime can never be reset to unpaid.
async function claimTerminalOrderPayment({ order, device }) {
  const amounts = {
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
    quoteJson: { zeroLooharPlatformFee: true, looharPlatformFeeCents: 0, source: "POS_TERMINAL", deviceId: device.id }
  };
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-payment:${order.id}`}))`;
    const existing = await tx.restaurantOrderPayment.findUnique({ where: { orderId: order.id } });
    if (existing && PAYABLE_BLOCKING_STATUSES.has(existing.status)) {
      throw httpError("This order already has a completed payment.", 409, { code: "POS_CARD_ALREADY_PAID" });
    }
    if (existing) {
      return tx.restaurantOrderPayment.update({
        where: { id: existing.id },
        data: { provider: "STRIPE_CONNECT", status: "REQUIRES_PAYMENT_METHOD", ...amounts }
      });
    }
    return tx.restaurantOrderPayment.create({
      data: { restaurantId: order.restaurantId, orderId: order.id, provider: "STRIPE_CONNECT", status: "REQUIRES_PAYMENT_METHOD", ...amounts }
    });
  });
}

// A stored PaymentIntent is only reusable while it is still waiting for a card AND still matches the
// order total. Anything else (a changed total, a cancelled or captured intent) is resolved before a
// reader is ever asked to charge again.
async function usablePaymentIntentId({ payment, merchant, restaurantId }) {
  if (!payment.providerPaymentIntentId) return null;
  const intent = await stripeRequest({
    secretKey: connectSecretKey(),
    path: `/payment_intents/${payment.providerPaymentIntentId}`,
    method: "GET",
    stripeAccount: merchant.stripeAccountId
  }).catch(() => null);
  const reusable = intent
    && REUSABLE_INTENT_STATUSES.has(intent.status)
    && Number(intent.amount) === payment.totalCents;
  if (reusable) return intent.id;
  if (intent?.status === "succeeded" || intent?.status === "requires_capture") {
    // Money has already been taken for a different amount; a human has to reconcile this order.
    await recordAudit({
      restaurantId,
      action: "pos.payment.terminal.amount_mismatch",
      entityType: "RestaurantOrderPayment",
      entityId: payment.id,
      metadata: { paymentIntentId: intent.id, capturedAmount: intent.amount, orderTotalCents: payment.totalCents, requiresReview: true }
    });
    throw httpError("A card payment for a different amount was already taken for this order. Refund or reconcile it before charging again.", 409, { code: "POS_TERMINAL_PAYMENT_NEEDS_REVIEW" });
  }
  if (intent && CANCELLABLE_INTENT_STATUSES.has(intent.status)) {
    await stripeRequest({
      secretKey: connectSecretKey(),
      path: `/payment_intents/${intent.id}/cancel`,
      stripeAccount: merchant.stripeAccountId,
      body: stripeForm({})
    }).catch(() => null);
  }
  await prisma.restaurantOrderPayment.update({ where: { id: payment.id }, data: { providerPaymentIntentId: null } });
  return null;
}

export async function collectTerminalPayment({ restaurantId, user, orderId, readerId, deviceId, fingerprint }) {
  await assertPosFeature(restaurantId, "POST");
  await assertPosPermission(user, restaurantId, POS_PERMISSION.ACCEPT_CARD);
  const device = await requireActiveDevice({ restaurantId, deviceId, fingerprint });
  if (!device.cardPaymentsEnabled) throw httpError("Card payments are not enabled for this device.", 403, { code: "POS_CARD_DEVICE_DISABLED" });
  const reader = await prisma.posTerminalReader.findFirst({ where: { id: readerId, restaurantId, status: "ACTIVE" } });
  if (!reader) throw httpError("Card reader not found.", 404, { code: "POS_TERMINAL_READER_NOT_FOUND" });
  if (reader.locationId && device.locationId && reader.locationId !== device.locationId) {
    throw httpError("That card reader belongs to another location.", 409, { code: "POS_TERMINAL_READER_LOCATION_MISMATCH" });
  }
  assertSimulationAllowed(reader);
  const merchant = await readyMerchant(restaurantId);
  const order = await payableOrderForTerminal({ restaurantId, orderId, device });
  const payment = await claimTerminalOrderPayment({ order, device });

  let paymentIntentId = await usablePaymentIntentId({ payment, merchant, restaurantId });
  if (!paymentIntentId) {
    const intent = await terminalRequest({
      path: "/payment_intents",
      stripeAccount: merchant.stripeAccountId,
      // Bound to the payment row and the amount, so a retry never creates a second PaymentIntent and
      // a changed total never collides with the previous attempt's key.
      idempotencyKey: `terminal_pi_${payment.id}_${payment.totalCents}`,
      body: stripeForm({
        amount: payment.totalCents,
        currency: payment.currency || "usd",
        "payment_method_types[0]": "card_present",
        capture_method: "automatic",
        "metadata[domain]": "RESTAURANT_ORDER_PAYMENT",
        "metadata[source]": "POS_TERMINAL",
        "metadata[restaurantId]": restaurantId,
        "metadata[orderId]": order.id,
        "metadata[orderPaymentId]": payment.id,
        "metadata[orderNumber]": order.orderNumber,
        "metadata[connectedAccountId]": merchant.stripeAccountId
      })
    });
    paymentIntentId = intent.id;
    await prisma.restaurantOrderPayment.update({
      where: { id: payment.id },
      data: { providerPaymentIntentId: intent.id, providerClientSecret: null }
    });
  }

  const readerAction = await terminalRequest({
    path: `/terminal/readers/${reader.stripeReaderId}/process_payment_intent`,
    stripeAccount: merchant.stripeAccountId,
    // On-reader tipping would capture more than the order total and break settlement; tips are taken
    // in Loohar, on the order, before the card is charged.
    body: stripeForm({ payment_intent: paymentIntentId, "process_config[skip_tipping]": "true" })
  });

  let simulatedPresentment = null;
  if (reader.simulated) {
    simulatedPresentment = await terminalRequest({
      path: `/test_helpers/terminal/readers/${reader.stripeReaderId}/present_payment_method`,
      stripeAccount: merchant.stripeAccountId,
      body: stripeForm({ type: "card_present" })
    });
  }

  await prisma.posTerminalReader.update({ where: { id: reader.id }, data: { lastSeenAt: new Date() } });
  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: "pos.payment.terminal.requested",
    entityType: "RestaurantOrderPayment",
    entityId: payment.id,
    metadata: { orderId: order.id, deviceId: device.id, readerId: reader.id, simulated: reader.simulated }
  });

  return {
    orderPayment: { id: payment.id, status: payment.status, totalCents: payment.totalCents, currency: payment.currency },
    paymentIntentId,
    reader: { id: reader.id, label: reader.label, simulated: reader.simulated },
    readerAction: { status: readerAction.action?.status || readerAction.status || null, failureCode: readerAction.action?.failure_code || null },
    simulatedPresentment: simulatedPresentment ? { presented: true } : null,
    // Settlement is confirmed by the Stripe Connect webhook, never by this response.
    settlement: "AWAITING_WEBHOOK"
  };
}

// The register polls this after handing a payment to a reader; the status always comes from the
// stored payment row, which only the verified Stripe webhook can move to PAID.
export async function terminalPaymentStatus({ restaurantId, user, orderId, deviceId, fingerprint }) {
  await assertPosFeature(restaurantId, "GET");
  await assertPosPermission(user, restaurantId, POS_PERMISSION.ACCEPT_CARD);
  const device = await requireActiveDevice({ restaurantId, deviceId, fingerprint });
  const order = await prisma.order.findFirst({
    where: { id: orderId, restaurantId, ...(device.locationId ? { locationId: device.locationId } : {}) },
    select: { id: true, orderNumber: true, totalCents: true, restaurantOrderPayment: { select: { status: true, totalCents: true, paidAt: true, failureReason: true } } }
  });
  if (!order) throw httpError("Order not found.", 404);
  const payment = order.restaurantOrderPayment;
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: payment?.status || "REQUIRES_PAYMENT_METHOD",
    paid: payment?.status === "PAID",
    totalCents: payment?.totalCents ?? order.totalCents,
    paidAt: payment?.paidAt || null,
    failureReason: payment?.failureReason || null
  };
}

export async function cancelTerminalPayment({ restaurantId, user, readerId, orderId, deviceId, fingerprint }) {
  await assertPosFeature(restaurantId, "POST");
  await assertPosPermission(user, restaurantId, POS_PERMISSION.ACCEPT_CARD);
  const device = await requireActiveDevice({ restaurantId, deviceId, fingerprint });
  const reader = await prisma.posTerminalReader.findFirst({ where: { id: readerId, restaurantId, status: "ACTIVE" } });
  if (!reader) throw httpError("Card reader not found.", 404, { code: "POS_TERMINAL_READER_NOT_FOUND" });
  const merchant = await readyMerchant(restaurantId);
  const readerAction = await terminalRequest({
    path: `/terminal/readers/${reader.stripeReaderId}/cancel_action`,
    stripeAccount: merchant.stripeAccountId,
    body: stripeForm({})
  });

  // Cancelling only the reader would leave a live PaymentIntent that could still be tapped, so the
  // order's own card payment is cancelled too and the order is released for another tender.
  let releasedOrderId = null;
  if (orderId) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, restaurantId, ...(device.locationId ? { locationId: device.locationId } : {}) },
      select: { id: true, restaurantOrderPayment: { select: { id: true, status: true, provider: true, providerPaymentIntentId: true } } }
    });
    const payment = order?.restaurantOrderPayment;
    if (payment && payment.provider === "STRIPE_CONNECT" && !PAYABLE_BLOCKING_STATUSES.has(payment.status)) {
      if (payment.providerPaymentIntentId) {
        await stripeRequest({
          secretKey: connectSecretKey(),
          path: `/payment_intents/${payment.providerPaymentIntentId}/cancel`,
          stripeAccount: merchant.stripeAccountId,
          body: stripeForm({})
        }).catch(() => null);
      }
      const released = await prisma.restaurantOrderPayment.updateMany({
        where: { id: payment.id, status: { notIn: ["PAID", "AUTHORIZED", "PARTIALLY_REFUNDED", "REFUNDED", "PROCESSING"] } },
        data: { status: "CANCELED", providerPaymentIntentId: null, providerClientSecret: null }
      });
      if (released.count) releasedOrderId = order.id;
    }
  }

  await recordAudit({
    actorUserId: user.id,
    restaurantId,
    action: "pos.payment.terminal.cancelled",
    entityType: "PosTerminalReader",
    entityId: reader.id,
    metadata: { orderId: releasedOrderId }
  });
  return { cancelled: true, readerStatus: readerAction.status || null, releasedOrderId };
}
