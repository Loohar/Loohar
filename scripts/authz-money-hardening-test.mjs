import { readFileSync } from "node:fs";

const failures = [];
function assertCheck(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    failures.push(message);
    console.error(`FAIL ${message}`);
  }
}
const read = (path) => readFileSync(path, "utf8");
const pos = read("apps/api/src/services/posService.js");
const restaurant = read("apps/api/src/routes/restaurant.js");
const quoteRoutes = read("apps/api/src/routes/orderPayments.js");
const quoteService = read("apps/api/src/modules/orderPayments/quoteService.js");
const server = read("apps/api/src/server.js");
const kitchen = read("apps/api/src/routes/kitchen.js");
const realtime = read("apps/api/src/services/realtimeService.js");
const customer = read("apps/api/src/routes/customer.js");
const orderPaymentService = read("apps/api/src/modules/orderPayments/orderPaymentService.js");

assertCheck(!restaurant.includes("data: req.body })") && restaurant.includes("restaurantProfileSchema.safeParse"), "Restaurant profile updates use a strict field allowlist");
assertCheck(!/data: \{ \.\.\.req\.body, restaurantId/.test(restaurant), "Coupon and loyalty creation no longer spread raw request bodies");
assertCheck(restaurant.includes("assertCanManageEmployeeRole(req.user, role)") && restaurant.includes("permissionsFromRequest(req.user, role, req.body.permissionsJson)"), "Staff creation sanitises roles and restricts custom permissions");
assertCheck(pos.includes("POS_PERMISSION.APPLY_DISCOUNT") && pos.includes("POS_DISCOUNT_EXCEEDS_SUBTOTAL"), "POS discounts require a manager permission and cannot exceed the subtotal");
assertCheck(!/CASHIER: \[[^\]]*APPLY_DISCOUNT/.test(pos), "Cashiers do not get the discount permission by default");
assertCheck(pos.includes("POS_OFFLINE_ADJUSTMENT_UNSUPPORTED"), "Offline sales cannot carry unsigned discounts or tips");
assertCheck(pos.includes("POS_CARD_ALREADY_PAID") && pos.includes("POS_ORDER_CLOSED"), "POS card flow cannot downgrade a paid or closed order");
assertCheck(pos.includes("POS_CASH_ONLINE_CHECKOUT_OPEN"), "Cash cannot be taken while an online card checkout is still open");
assertCheck(quoteRoutes.includes("quantity: z.number().int().positive().max(99)") && !quoteRoutes.includes("serviceFeeCents") && quoteService.includes("const serviceFeeCents = 0;"), "Online checkout caps quantities and ignores client service fees");
assertCheck(server.includes('morgan.token("url-path"') && !server.includes('morgan("dev")'), "Request logs omit query strings that can carry tracking tokens");
assertCheck(kitchen.includes("allowedLocationIdsForUser") && realtime.includes("allowedLocationIdsForUser"), "Kitchen REST and realtime honour employee location assignments");
assertCheck(kitchen.includes("HIDE_UNPAID_ONLINE_ORDERS"), "Kitchen hides unpaid online checkouts");
assertCheck(customer.includes('idempotencyKey: req.get("Idempotency-Key")'), "Legacy customer order routes forward the checkout Idempotency-Key");
assertCheck(orderPaymentService.includes("payment_event_mismatch") && orderPaymentService.includes("eventAccount !== merchant?.stripeAccountId"), "Payment webhooks must match the PaymentIntent, connected account, amount and currency");
assertCheck(orderPaymentService.includes('updateMany({ where: { id: payment.orderId, status: "PENDING" }'), "Payment only accepts orders that are waiting for payment");

if (failures.length) {
  console.error(`\n${failures.length} authz/money hardening check(s) failed.`);
  process.exit(1);
}
console.log("\nAuthorization and money hardening checks passed.");
