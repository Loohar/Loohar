import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("apps/web/src/App.jsx");
const screens = read("apps/web/src/apps/pos/PosWorkflowScreens.jsx");
const posRoute = read("apps/api/src/routes/pos.js");
const posSession = read("apps/api/src/middleware/posSession.js");
const posService = read("apps/api/src/services/posService.js");

function sectionBetween(content, start, end) {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `${start} section is missing`);
  assert.notEqual(endIndex, -1, `${end} boundary is missing`);
  return content.slice(startIndex, endIndex);
}

const submitBlock = sectionBetween(app, "async function submitOrder", "async function acceptCashPayment");
const cashBlock = sectionBetween(app, "async function acceptCashPayment", "function openGuestCheck");
const successBlock = sectionBetween(app, "async function completeSuccessfulTransaction", "async function sendCurrentOrderToKitchen");
const finishBlock = sectionBetween(app, "function finishPaidOrder", "function beginNewOrder");
const orderService = sectionBetween(posService, "export async function submitPosOrder", "export async function holdPosOrder");
const cashService = sectionBetween(posService, "export async function cashPayment", "export async function cardPaymentIntent");
const postCommitService = sectionBetween(posService, "async function runCashPostCommitTasks", "export async function cashPayment");

assert.ok(app.includes("const cashPaymentInFlightRef = useRef(false)"), "cash payment should have an immediate in-memory submission lock");
assert.ok(cashBlock.indexOf("if (cashPaymentInFlightRef.current) return") < cashBlock.indexOf('setSaving("cash")'), "double submission should be blocked before async work starts");
assert.ok(cashBlock.includes("cashPaymentInFlightRef.current = false"), "the cash submission lock should release after success or failure");
assert.ok(screens.includes('saving ? "Processing..." : "Complete cash payment"'), "cash payment should show immediate processing feedback");

assert.ok(cashBlock.includes("lastOrder ? null : (quote || await calculateQuote(cart, { trackCashPayment: true }))"), "cash completion should reuse the quote created before payment selection");
assert.ok(cashBlock.includes("refreshAfterSubmit: false"), "cash order submission should skip the broad restaurant refresh");
assert.ok(submitBlock.includes("if (refreshAfterSubmit) void loadOrderLists()"), "non-payment submission should refresh only POS order state in the background");
assert.equal(submitBlock.includes("onRefresh"), false, "POS submission should not trigger the broad restaurant dashboard refresh");
assert.equal(cashBlock.match(/calculateQuote\(/g)?.length, 1, "cash completion should have only a fallback quote call");
assert.ok(cashBlock.includes("cashPaymentRequestCountRef.current += 1"), "cash completion should count each authoritative request");

const cashRequestIndex = cashBlock.indexOf('await posApi("/payments/cash"');
const successIndex = cashBlock.indexOf("completeSuccessfulTransaction(");
assert.ok(cashRequestIndex >= 0 && successIndex > cashRequestIndex, "Payment Complete must wait for the authoritative cash API response");
assert.equal(cashBlock.includes("await completeSuccessfulTransaction"), false, "success rendering should not wait for reconciliation");
assert.equal(successBlock.includes("loadPos("), false, "Payment Complete should not block on POS bootstrap refresh");
assert.equal(successBlock.includes("loadOrderLists("), false, "Payment Complete should not block on order-list reconciliation");
assert.ok(app.includes("<PaymentProcessingScreen") && !app.slice(app.indexOf("case POS_WORKFLOW.PAYMENT_PROCESSING"), app.indexOf("case POS_WORKFLOW.PAYMENT_SUCCESS")).includes("PosBootScreen"), "payment processing should never render the register bootstrap screen");
assert.ok(finishBlock.includes("void Promise.all([refreshPosConfig(), loadOrderLists()])"), "Done should reconcile config and order state without reloading the menu");
assert.equal(finishBlock.includes("loadPos("), false, "Done should preserve the accepted menu for the next customer");

assert.ok(posSession.includes("req.posSessionDevice = device"), "validated POS middleware should expose its device result for reuse");
assert.ok(posRoute.includes("sessionDevice: req.posSessionDevice"), "cash settlement should reuse the already validated session device");
assert.ok(posRoute.includes("entitlementVerified: Boolean(req.entitlementDecision?.allowed)"), "cash and order services should reuse the route entitlement decision");
assert.ok(cashService.includes("const existingPayment = order.payment"), "cash settlement should reuse the payment loaded with the validated order");
assert.equal(cashService.includes("tx.payment.findUnique"), false, "cash settlement should not re-read the payment inside the transaction");
assert.ok(cashService.includes("Promise.all([accessPromise, orderPromise])"), "register access and location-scoped order validation should run in parallel");

assert.ok(cashService.includes("tx.cashLedgerEntry.create") && cashService.includes("tx.cashDrawer.update"), "ledger and drawer balance must remain inside the committed transaction");
assert.ok(cashService.includes("tx.posReceipt.create"), "final receipt persistence must remain inside the transaction");
assert.ok(cashService.includes("void postCommitTask.catch"), "drawer acknowledgement and audit enrichment should not block Payment Complete");
assert.equal(cashService.match(/runCashPostCommitTasks\(/g)?.length, 1, "drawer post-commit work should dispatch once");
assert.ok(postCommitService.includes("requestCashDrawerOpen") && postCommitService.includes('action: "pos.payment.cash.accepted"'), "deferred drawer and payment actions should remain audited");

assert.ok(orderService.indexOf("emitKitchenTicketCreated(result.order)") > orderService.indexOf("await prisma.$transaction"), "KDS emit must remain post-commit");
assert.equal(orderService.match(/emitKitchenTicketCreated\(/g)?.length, 1, "KDS event should emit once");
assert.ok(orderService.includes("kdsMs") && cashService.includes("dbTransactionMs") && posRoute.includes("Server-Timing"), "development timing should cover KDS, transaction, receipt, and total service duration");

assert.ok(successBlock.includes("POS_EVENT.PAYMENT_SUCCEEDED") && !successBlock.includes("resetCurrentOrder()"), "change due should remain visible until Done");
assert.ok(finishBlock.includes("resetCurrentOrder()") && finishBlock.includes("POS_EVENT.HOME"), "Done should still clear the cart and return Register Home");
assert.equal(cashBlock.includes("resetCurrentOrder()"), false, "failed settlement should preserve the active order for retry");

console.log("pos-cash-performance-test passed (critical path, telemetry, idempotency, KDS, drawer, and completion).\n");
