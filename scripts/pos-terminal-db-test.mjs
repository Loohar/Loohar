// Database-backed test for Stripe Terminal card-present payments. Stripe is stubbed locally; no
// request leaves the machine and no card data is ever handled by Loohar.
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db node scripts/pos-terminal-db-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";

const databaseUrl = process.env.LOOHAR_TEST_DATABASE_URL || "";
const host = (() => {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
})();
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.log("SKIP POS Terminal DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  NODE_ENV: "test",
  EMAIL_PROVIDER: "console",
  JWT_SECRET: "local-terminal-test-secret",
  STRIPE_CONNECT_SECRET_KEY: "sk_test_local_fake_terminal",
  STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_local_terminal_test_only"
});
console.log = () => {};

const runId = `tm${Date.now().toString(36)}`;
const stripeCalls = [];
const paymentIntents = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (!target.startsWith("https://api.stripe.com/")) return realFetch(url, options);
  const body = options.body ? Object.fromEntries(new URLSearchParams(String(options.body))) : {};
  stripeCalls.push({ url: target, method: options.method || "POST", account: options.headers?.["Stripe-Account"], idempotencyKey: options.headers?.["Idempotency-Key"], body });
  const json = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  if (target.endsWith("/terminal/locations")) return json({ id: `tml_${runId}`, object: "terminal.location" });
  if (target.endsWith("/terminal/readers")) return json({ id: `tmr_${runId}_${stripeCalls.length}`, object: "terminal.reader", device_type: "simulated_wisepos_e", serial_number: `SN${stripeCalls.length}` });
  if (target.endsWith("/terminal/connection_tokens")) return json({ secret: `pst_test_${runId}_secret` });
  if (target.endsWith("/payment_intents")) {
    const intent = { id: `pi_${runId}_${stripeCalls.length}`, object: "payment_intent", status: "requires_payment_method", amount: Number(body.amount), payment_method_types: ["card_present"] };
    paymentIntents.set(intent.id, intent);
    return json(intent);
  }
  if (target.includes("/payment_intents/") && target.endsWith("/cancel")) {
    const intent = paymentIntents.get(target.split("/payment_intents/")[1].replace("/cancel", ""));
    if (intent) intent.status = "canceled";
    return json(intent || { id: "pi_unknown", status: "canceled" });
  }
  if (target.includes("/payment_intents/")) {
    const intent = paymentIntents.get(target.split("/payment_intents/")[1]);
    return intent ? json(intent) : new Response(JSON.stringify({ error: { message: "No such payment_intent" } }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
  if (target.includes("/process_payment_intent")) return json({ id: `tmr_action_${runId}`, action: { status: "in_progress", type: "process_payment_intent" } });
  if (target.includes("/present_payment_method")) return json({ id: `tmr_${runId}`, action: { status: "succeeded" } });
  if (target.includes("/cancel_action")) return json({ id: `tmr_${runId}`, status: "online" });
  return new Response(JSON.stringify({ error: { message: `unexpected Stripe call ${target}` } }), { status: 400, headers: { "Content-Type": "application/json" } });
};

const { prisma } = await import("../apps/api/src/config/prisma.js");
const terminal = await import("../apps/api/src/modules/posTerminal/posTerminalService.js");
const { handleStripeConnectWebhook } = await import("../apps/api/src/modules/orderPayments/orderPaymentService.js");
const { cashPayment, openShift } = await import("../apps/api/src/services/posService.js");

const ctx = {};
const outcome = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, status: error.status, code: error.code, message: error.message }));
const callsTo = (fragment) => stripeCalls.filter((call) => call.url.includes(fragment));
// PaymentIntent creations only: retrieves and cancels hit the same path prefix.
const intentCreations = () => stripeCalls.filter((call) => call.url.endsWith("/payment_intents") && call.method === "POST");

async function seedRestaurant(label, { chargesEnabled = true } = {}) {
  const restaurant = await prisma.restaurant.create({
    data: { name: `Terminal ${label}`, slug: `${runId}-${label}`, status: "ACTIVE", address: "1 Main St", city: "Denver", state: "CO", zip: "80202", tenantClassification: "INTERNAL_DEVELOPMENT", locations: { create: { name: "Main" } } },
    include: { locations: true }
  });
  await prisma.restaurantMerchantAccount.create({
    data: { restaurantId: restaurant.id, provider: "STRIPE_CONNECT", status: chargesEnabled ? "ENABLED" : "NOT_STARTED", stripeAccountId: `acct_${runId}_${label}`, stripeChargesEnabled: chargesEnabled }
  });
  const owner = await prisma.user.create({
    data: { email: `owner-${label}-${runId}@example.test`, passwordHash: "x", name: "Owner", role: "TENANT_OWNER", restaurantId: restaurant.id }
  });
  await prisma.restaurantStaff.create({ data: { restaurantId: restaurant.id, userId: owner.id, role: "TENANT_OWNER", active: true } });
  const device = await prisma.posDevice.create({
    data: { restaurantId: restaurant.id, locationId: restaurant.locations[0].id, name: "Front", deviceType: "MAIN_TERMINAL", status: "ACTIVE", cardPaymentsEnabled: true, deviceFingerprintHash: `fp_${runId}_${label}` }
  });
  const category = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: "Mains" } });
  const menuItem = await prisma.menuItem.create({ data: { restaurantId: restaurant.id, categoryId: category.id, name: "Plate", priceCents: 1500 } });
  const customer = await prisma.customer.create({ data: { restaurantId: restaurant.id, name: "Walk-in", email: `walkin-${label}-${runId}@example.test` } });
  return { restaurant, owner, device, location: restaurant.locations[0], menuItem, customer };
}

let orderCounter = 0;
async function posOrder(seed, { totalCents = 2185 } = {}) {
  orderCounter += 1;
  return prisma.order.create({
    data: {
      restaurant: { connect: { id: seed.restaurant.id } },
      location: { connect: { id: seed.location.id } },
      customer: { connect: { id: seed.customer.id } },
      orderNumber: `${runId}-${orderCounter}`,
      type: "WALK_IN",
      status: "PENDING",
      subtotalCents: 2000,
      taxCents: 185,
      totalCents,
      items: { create: [{ menuItem: { connect: { id: seed.menuItem.id } }, name: "Plate", quantity: 1, unitPriceCents: 2000 }] }
    }
  });
}

const deviceRef = (seed) => ({ deviceId: seed.device.id, fingerprint: null });

before(async () => {
  ctx.a = await seedRestaurant("a");
  ctx.b = await seedRestaurant("b");
});

after(async () => {
  globalThis.fetch = realFetch;
  await prisma.$disconnect();
});

test("registering a simulated reader creates one Terminal location on the connected account", async () => {
  const seed = ctx.a;
  const first = await terminal.registerTerminalReader({ restaurantId: seed.restaurant.id, user: seed.owner, body: { registrationCode: "simulated-wpe", label: "Sim reader", locationId: seed.location.id } });
  ctx.reader = first.reader;
  assert.equal(first.reader.simulated, true);
  const locationCalls = callsTo("/terminal/locations");
  assert.equal(locationCalls.length, 1, "the Terminal location is created once");
  assert.equal(locationCalls[0].account, `acct_${runId}_a`, "the location lives on the restaurant's connected account");
  const merchant = await prisma.restaurantMerchantAccount.findFirst({ where: { restaurantId: seed.restaurant.id } });
  assert.equal(merchant.stripeTerminalLocationId, `tml_${runId}`);
  const stored = await prisma.posTerminalReader.findFirst({ where: { restaurantId: seed.restaurant.id, status: "ACTIVE" } });
  assert.equal(stored.locationId, seed.location.id);
  await terminal.registerTerminalReader({ restaurantId: seed.restaurant.id, user: seed.owner, body: { registrationCode: "simulated-wpe", label: "Second sim" } });
  assert.equal(callsTo("/terminal/locations").length, 1, "the stored Terminal location is reused");
});

test("simulated readers are refused outside Stripe test mode", async () => {
  const seed = ctx.a;
  const previousKey = process.env.STRIPE_CONNECT_SECRET_KEY;
  const previousEnv = process.env.NODE_ENV;
  Object.assign(process.env, { STRIPE_CONNECT_SECRET_KEY: "sk_live_not_real_key", NODE_ENV: "production" });
  try {
    const result = await outcome(terminal.registerTerminalReader({ restaurantId: seed.restaurant.id, user: seed.owner, body: { registrationCode: "simulated-wpe" } }));
    assert.equal(result.ok, false);
    assert.equal(result.code, "POS_TERMINAL_SIMULATED_NOT_ALLOWED");
  } finally {
    Object.assign(process.env, { STRIPE_CONNECT_SECRET_KEY: previousKey, NODE_ENV: previousEnv });
  }
});

test("a connection token is issued for the connected account and never stored", async () => {
  const seed = ctx.a;
  const token = await terminal.createTerminalConnectionToken({ restaurantId: seed.restaurant.id, user: seed.owner, ...deviceRef(seed) });
  assert.match(token.secret, /^pst_test_/);
  assert.equal(token.stripeAccountId, `acct_${runId}_a`);
  assert.equal(callsTo("/terminal/connection_tokens")[0].account, `acct_${runId}_a`);
  const readers = await prisma.posTerminalReader.findMany({ where: { restaurantId: seed.restaurant.id } });
  assert.equal(JSON.stringify(readers).includes(token.secret), false, "connection secrets are not persisted");
  const audits = await prisma.auditLog.findMany({ where: { restaurantId: seed.restaurant.id } });
  assert.equal(JSON.stringify(audits).includes(token.secret), false, "connection secrets are not audited");
});

test("a terminal payment charges the stored order total on the connected account and settles by webhook", async () => {
  const seed = ctx.a;
  const order = await posOrder(seed);
  const result = await terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, readerId: ctx.reader.id, ...deviceRef(seed) });
  const intentCall = intentCreations().at(-1);
  assert.equal(Number(intentCall.body.amount), 2185, "the amount comes from the stored order");
  assert.equal(intentCall.body["payment_method_types[0]"], "card_present");
  assert.equal(intentCall.body["metadata[orderPaymentId]"], result.orderPayment.id);
  assert.equal(intentCall.account, `acct_${runId}_a`);
  assert.equal(intentCall.idempotencyKey, `terminal_pi_${result.orderPayment.id}_2185`, "the key is bound to the payment row and the amount");
  assert.equal(callsTo("/process_payment_intent").length, 1);
  assert.equal(callsTo("/process_payment_intent").at(-1).body["process_config[skip_tipping]"], "true", "on-reader tipping cannot change the captured amount");
  assert.equal("application_fee_amount" in intentCall.body, false, "Loohar takes no platform fee");
  assert.equal(callsTo("/present_payment_method").length, 1, "simulated readers present a test card");
  assert.equal(result.settlement, "AWAITING_WEBHOOK");

  const stored = await prisma.restaurantOrderPayment.findUnique({ where: { id: result.orderPayment.id } });
  assert.equal(stored.status, "REQUIRES_PAYMENT_METHOD", "the response never marks the order paid");
  assert.equal(stored.platformFeeCents, 0);
  assert.equal(stored.providerClientSecret, null, "card-present payments have no browser client secret");

  const settled = await handleStripeConnectWebhook({
    id: `evt_${runId}_terminal`,
    type: "payment_intent.succeeded",
    account: `acct_${runId}_a`,
    data: { object: { id: result.paymentIntentId, amount: 2185, amount_received: 2185, currency: "usd", latest_charge: `ch_${runId}`, metadata: { orderPaymentId: result.orderPayment.id } } }
  });
  assert.equal(settled.received, true);
  assert.equal((await prisma.restaurantOrderPayment.findUnique({ where: { id: result.orderPayment.id } })).status, "PAID");
  assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).status, "ACCEPTED", "settlement accepts the order");
});

test("a retried collection reuses the same PaymentIntent", async () => {
  const seed = ctx.a;
  const order = await posOrder(seed);
  const first = await terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, readerId: ctx.reader.id, ...deviceRef(seed) });
  const intentsBefore = intentCreations().length;
  const retry = await terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, readerId: ctx.reader.id, ...deviceRef(seed) });
  assert.equal(retry.paymentIntentId, first.paymentIntentId);
  assert.equal(intentCreations().length, intentsBefore, "no second PaymentIntent is created");
});

test("a changed order total never reuses the old PaymentIntent", async () => {
  const seed = ctx.a;
  const order = await posOrder(seed);
  const first = await terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, readerId: ctx.reader.id, ...deviceRef(seed) });
  await prisma.order.update({ where: { id: order.id }, data: { subtotalCents: 2500, totalCents: 2685 } });
  const second = await terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, readerId: ctx.reader.id, ...deviceRef(seed) });
  assert.notEqual(second.paymentIntentId, first.paymentIntentId, "the stale PaymentIntent is not handed to the reader");
  assert.equal(Number(intentCreations().at(-1).body.amount), 2685, "the reader is asked for the new total");
  assert.equal(paymentIntents.get(first.paymentIntentId).status, "canceled", "the stale PaymentIntent is cancelled at Stripe");
  const stored = await prisma.restaurantOrderPayment.findUnique({ where: { orderId: order.id } });
  assert.equal(stored.totalCents, 2685);
  assert.equal(stored.providerPaymentIntentId, second.paymentIntentId);
});

test("an order already captured for a different amount needs review instead of another charge", async () => {
  const seed = ctx.a;
  const order = await posOrder(seed);
  const collected = await terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, readerId: ctx.reader.id, ...deviceRef(seed) });
  paymentIntents.get(collected.paymentIntentId).status = "succeeded";
  await prisma.order.update({ where: { id: order.id }, data: { totalCents: 3000 } });
  const again = await outcome(terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, readerId: ctx.reader.id, ...deviceRef(seed) }));
  assert.equal(again.code, "POS_TERMINAL_PAYMENT_NEEDS_REVIEW");
  const audits = await prisma.auditLog.findMany({ where: { restaurantId: seed.restaurant.id, action: "pos.payment.terminal.amount_mismatch" } });
  assert.equal(audits.length >= 1, true, "the mismatch is recorded for a human to reconcile");
});

test("a settled payment is never reset to unpaid by another collect", async () => {
  const seed = ctx.a;
  const order = await posOrder(seed);
  const collected = await terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, readerId: ctx.reader.id, ...deviceRef(seed) });
  await prisma.restaurantOrderPayment.update({ where: { id: collected.orderPayment.id }, data: { status: "PAID", paidAt: new Date() } });
  const again = await outcome(terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, readerId: ctx.reader.id, ...deviceRef(seed) }));
  assert.equal(again.code, "POS_CARD_ALREADY_PAID");
  assert.equal((await prisma.restaurantOrderPayment.findUnique({ where: { id: collected.orderPayment.id } })).status, "PAID");
});

test("cancelling on the reader cancels the PaymentIntent and releases the order", async () => {
  const seed = ctx.a;
  const order = await posOrder(seed);
  const collected = await terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, readerId: ctx.reader.id, ...deviceRef(seed) });
  const cancelled = await terminal.cancelTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, readerId: ctx.reader.id, orderId: order.id, ...deviceRef(seed) });
  assert.equal(cancelled.releasedOrderId, order.id);
  assert.equal(paymentIntents.get(collected.paymentIntentId).status, "canceled");
  const stored = await prisma.restaurantOrderPayment.findUnique({ where: { id: collected.orderPayment.id } });
  assert.equal(stored.status, "CANCELED");
  assert.equal(stored.providerPaymentIntentId, null);
});

test("cash cannot settle an order while a card payment is waiting on a reader", async () => {
  const seed = ctx.a;
  await prisma.posDevice.update({ where: { id: seed.device.id }, data: { cashDrawerId: (await prisma.cashDrawer.create({ data: { restaurantId: seed.restaurant.id, locationId: seed.location.id, name: "Drawer" } })).id } });
  await prisma.restaurantStaff.updateMany({ where: { restaurantId: seed.restaurant.id, userId: seed.owner.id }, data: { posPinHash: null } });
  await openShift({ restaurantId: seed.restaurant.id, user: seed.owner, deviceId: seed.device.id, body: { openingCashCents: 10000 } });
  const order = await posOrder(seed);
  const collected = await terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, readerId: ctx.reader.id, ...deviceRef(seed) });
  const cash = await outcome(cashPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, amountCents: 2185, ...deviceRef(seed) }));
  assert.equal(cash.ok, false);
  assert.equal(cash.code, "POS_CASH_CARD_PAYMENT_OPEN", "cash is refused while the reader still holds a card payment");
  assert.equal((await prisma.restaurantOrderPayment.findUnique({ where: { id: collected.orderPayment.id } })).status, "REQUIRES_PAYMENT_METHOD");

  // Cancelling on the reader releases the order, and cash then settles it normally.
  await terminal.cancelTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, readerId: ctx.reader.id, orderId: order.id, ...deviceRef(seed) });
  const afterCancel = await outcome(cashPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, amountCents: 2185, ...deviceRef(seed) }));
  assert.equal(afterCancel.ok, true, `cash settles after the card payment is cancelled (${afterCancel.code || ""})`);
  const settledPayment = await prisma.restaurantOrderPayment.findUnique({ where: { orderId: order.id } });
  assert.equal(settledPayment.status, "PAID");
  assert.equal(settledPayment.provider, "MANUAL");
});

test("an order with an open online checkout is not charged on a reader", async () => {
  const seed = ctx.a;
  const order = await posOrder(seed);
  await prisma.restaurantOrderPayment.create({
    data: {
      restaurantId: seed.restaurant.id, orderId: order.id, provider: "STRIPE_CONNECT", status: "REQUIRES_PAYMENT_METHOD",
      subtotalCents: 2000, totalCents: 2185, restaurantGrossCents: 2185, restaurantNetCents: 2185,
      checkoutIdempotencyKeyHash: `hash_${runId}_${order.id}`
    }
  });
  const result = await outcome(terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, readerId: ctx.reader.id, ...deviceRef(seed) }));
  assert.equal(result.code, "POS_TERMINAL_ONLINE_CHECKOUT_OPEN");
});

test("a reader registered to another restaurant cannot be taken over", async () => {
  const other = ctx.b;
  const existing = await prisma.posTerminalReader.findFirst({ where: { restaurantId: ctx.a.restaurant.id, status: "ACTIVE" } });
  const previousReaderId = existing.stripeReaderId;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/terminal/readers")) {
      return new Response(JSON.stringify({ id: previousReaderId, object: "terminal.reader", device_type: "simulated_wisepos_e" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(url, options);
  };
  try {
    const result = await outcome(terminal.registerTerminalReader({ restaurantId: other.restaurant.id, user: other.owner, body: { registrationCode: "simulated-wpe", label: "Stolen" } }));
    assert.equal(result.code, "POS_TERMINAL_READER_CONFLICT");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal((await prisma.posTerminalReader.findUnique({ where: { stripeReaderId: previousReaderId } })).restaurantId, ctx.a.restaurant.id);
});

test("readers, orders and devices are tenant scoped and closed orders are refused", async () => {
  const seed = ctx.a;
  const other = ctx.b;
  const order = await posOrder(seed);
  const crossTenantReader = await outcome(terminal.collectTerminalPayment({ restaurantId: other.restaurant.id, user: other.owner, orderId: order.id, readerId: ctx.reader.id, ...deviceRef(other) }));
  assert.equal(crossTenantReader.code, "POS_TERMINAL_READER_NOT_FOUND");

  const paidOrder = await posOrder(seed);
  const paid = await terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: paidOrder.id, readerId: ctx.reader.id, ...deviceRef(seed) });
  await prisma.restaurantOrderPayment.update({ where: { id: paid.orderPayment.id }, data: { status: "PAID" } });
  const again = await outcome(terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: paidOrder.id, readerId: ctx.reader.id, ...deviceRef(seed) }));
  assert.equal(again.code, "POS_CARD_ALREADY_PAID");

  await prisma.posDevice.update({ where: { id: seed.device.id }, data: { cardPaymentsEnabled: false } });
  const disabled = await outcome(terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, readerId: ctx.reader.id, ...deviceRef(seed) }));
  assert.equal(disabled.code, "POS_CARD_DEVICE_DISABLED");
  await prisma.posDevice.update({ where: { id: seed.device.id }, data: { cardPaymentsEnabled: true } });
});

test("terminal payments are refused when the restaurant cannot take cards", async () => {
  const seed = await seedRestaurant("c", { chargesEnabled: false });
  const order = await posOrder(seed);
  const registration = await outcome(terminal.registerTerminalReader({ restaurantId: seed.restaurant.id, user: seed.owner, body: { registrationCode: "simulated-wpe" } }));
  assert.equal(registration.code, "POS_CARD_MERCHANT_NOT_READY");
  // Give this restaurant its own reader row, so the refusal can only come from the merchant check.
  const ownReader = await prisma.posTerminalReader.create({
    data: { restaurantId: seed.restaurant.id, stripeReaderId: `tmr_orphan_${runId}`, stripeLocationId: `tml_orphan_${runId}`, label: "Orphan", simulated: true }
  });
  const result = await outcome(terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, readerId: ownReader.id, ...deviceRef(seed) }));
  assert.equal(result.code, "POS_CARD_MERCHANT_NOT_READY");
});

test("a card payment below Stripe's minimum is refused with a readable message", async () => {
  const seed = ctx.a;
  const order = await posOrder(seed, { totalCents: 25 });
  const result = await outcome(terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, readerId: ctx.reader.id, ...deviceRef(seed) }));
  assert.equal(result.code, "POS_TERMINAL_AMOUNT_TOO_SMALL");
});

test("the register reads settlement from the stored payment, not from the reader response", async () => {
  const seed = ctx.a;
  const order = await posOrder(seed);
  const collected = await terminal.collectTerminalPayment({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, readerId: ctx.reader.id, ...deviceRef(seed) });
  const pending = await terminal.terminalPaymentStatus({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, ...deviceRef(seed) });
  assert.equal(pending.paid, false);
  assert.equal(pending.status, "REQUIRES_PAYMENT_METHOD");
  await handleStripeConnectWebhook({
    id: `evt_${runId}_status`,
    type: "payment_intent.succeeded",
    account: `acct_${runId}_a`,
    data: { object: { id: collected.paymentIntentId, amount: 2185, amount_received: 2185, currency: "usd", latest_charge: `ch_status_${runId}`, metadata: { orderPaymentId: collected.orderPayment.id } } }
  });
  const settled = await terminal.terminalPaymentStatus({ restaurantId: seed.restaurant.id, user: seed.owner, orderId: order.id, ...deviceRef(seed) });
  assert.equal(settled.paid, true);
  assert.equal(settled.totalCents, 2185);
  const otherTenant = await outcome(terminal.terminalPaymentStatus({ restaurantId: ctx.b.restaurant.id, user: ctx.b.owner, orderId: order.id, ...deviceRef(ctx.b) }));
  assert.equal(otherTenant.status, 404, "another tenant cannot read this order's payment status");
});

test("the register offers card payment only with a paired reader, card-enabled device and connectivity", () => {
  const app = readFileSync("apps/web/src/App.jsx", "utf8");
  assert.ok(app.includes("&& activeDevice.cardPaymentsEnabled"));
  assert.ok(app.includes('(config?.permissions || []).includes("POS_ACCEPT_CARD")'));
  assert.ok(app.includes("&& terminalReaders.length > 0"));
  assert.ok(app.includes("Card payments need an internet connection."), "card payments are refused offline");
  assert.ok(app.includes("waitForTerminalSettlement"), "the register waits for webhook settlement");
});

test("register settings can pair and remove a reader", () => {
  const screens = readFileSync("apps/web/src/apps/pos/PosWorkflowScreens.jsx", "utf8");
  const app = readFileSync("apps/web/src/App.jsx", "utf8");
  assert.ok(screens.includes("Card readers"), "register settings shows the card reader panel");
  assert.ok(screens.includes("Pair reader"));
  assert.ok(app.includes("async function pairTerminalReader()"));
  assert.ok(app.includes("async function removeTerminalReader(reader)"));
});

test("terminal routes require an unlocked POS session and Loohar never accepts card numbers", () => {
  const routes = readFileSync("apps/api/src/routes/pos.js", "utf8");
  for (const route of ["/pos/terminal/readers", "/pos/terminal/connection-token", "/pos/payments/terminal"]) {
    const line = routes.split("\n").find((entry) => entry.includes(`"/:restaurantId${route}"`));
    assert.ok(line?.includes("requirePosSession"), `${route} requires a POS session`);
  }
  const service = readFileSync("apps/api/src/modules/posTerminal/posTerminalService.js", "utf8");
  for (const field of ["card[number]", "cardNumber", "cvc"]) {
    assert.equal(service.includes(field), false, `the Terminal service never handles ${field}`);
  }
});
