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

const service = readFileSync("apps/api/src/modules/orderPayments/orderPaymentService.js", "utf8");
const routes = readFileSync("apps/api/src/routes/orderPayments.js", "utf8");
const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
const submit = service.slice(service.indexOf("async function submitRefundToStripe("), service.indexOf("export async function refundOrderPayment("));
const refund = service.slice(service.indexOf("export async function refundOrderPayment("), service.indexOf("export async function statusForOrder("));

assertCheck(submit.includes("stripeAccount: merchant.stripeAccountId"), "Refunds are created on the restaurant's connected account like the direct charge");
assertCheck(submit.includes("idempotencyKey: orderRefundIdempotencyKey(refund.id)"), "Stripe refund requests carry an idempotency key bound to the refund row");
assertCheck(refund.includes("normalizeRefundIdempotencyKey(idempotencyKey)") && routes.includes("idempotencyKey: req.get(CHECKOUT_IDEMPOTENCY_HEADER)"), "Refund route requires and forwards an Idempotency-Key");
assertCheck(refund.includes('SELECT id FROM "RestaurantOrderPayment" WHERE id = ${payment.id} FOR UPDATE') && refund.includes("REFUND_EXCEEDS_REMAINING"), "Refund reservations lock the payment and cap at the remaining balance");
assertCheck(refund.includes("REFUND_PAYMENT_NOT_REFUNDABLE"), "Only paid payments can be refunded");
assertCheck(schema.includes("idempotencyKey        String?                 @unique"), "Refund idempotency key is modelled with its existing unique index");
assertCheck(!refund.includes("Math.min(Math.max(0, Number(amountCents || payment.totalCents)), payment.totalCents)"), "Refund amount no longer ignores prior refunds");

if (failures.length) {
  console.error(`\n${failures.length} refund idempotency check(s) failed.`);
  process.exit(1);
}
console.log("\nRefund idempotency checks passed.");
