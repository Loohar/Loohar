import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyCashKey,
  cashTenderInputToCents,
  cashTenderSummary,
  quickCashTenderAmounts
} from "../apps/web/src/apps/pos/cashTender.js";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("apps/web/src/App.jsx");
const screens = read("apps/web/src/apps/pos/PosWorkflowScreens.jsx");
const posService = read("apps/api/src/services/posService.js");

function sectionBetween(content, start, end) {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `${start} section is missing`);
  assert.notEqual(endIndex, -1, `${end} boundary is missing`);
  return content.slice(startIndex, endIndex);
}

const pay = sectionBetween(app, "function payCurrentOrder", "function reportPaymentSelectionRender");
const selectionRender = sectionBetween(app, "function reportPaymentSelectionRender", "function reportPaymentProcessingRender");
const processingRender = sectionBetween(app, "function reportPaymentProcessingRender", "function reportPaymentResultRender");
const resultRender = sectionBetween(app, "function reportPaymentResultRender", "async function completeSuccessfulTransaction");
const submit = sectionBetween(app, "async function submitOrder", "async function acceptCashPayment");
const cash = sectionBetween(app, "async function acceptCashPayment", "function openGuestCheck");
const success = sectionBetween(app, "async function completeSuccessfulTransaction", "async function sendCurrentOrderToKitchen");
const finish = sectionBetween(app, "function finishPaidOrder", "function beginNewOrder");
const processingCase = sectionBetween(app, "case POS_WORKFLOW.PAYMENT_PROCESSING", "case POS_WORKFLOW.PAYMENT_SUCCESS");
const initialLoadEffect = sectionBetween(app, "useEffect(() => {\n    if (!fingerprint) return;", "useEffect(() => {\n    if (!apiOnline)");
const healthEffect = sectionBetween(app, "useEffect(() => {\n    if (!apiOnline)", "useEffect(() => {\n    const timer = window.setInterval");

assert.ok(pay.indexOf("POS_EVENT.SELECT_PAYMENT") < pay.indexOf("globalThis.requestAnimationFrame(() => globalThis.setTimeout(requestQuote, 0))"), "Pay should paint the Cash Payment screen before quote networking begins");
assert.equal(pay.includes("posApi("), false, "Pay should not synchronously issue an API request before Cash Payment renders");
assert.equal(pay.includes("loadPos("), false, "Pay should not bootstrap POS");
assert.equal(pay.includes("loadOrderLists("), false, "Pay should not load order lists");
assert.ok(selectionRender.includes('"payTransitionApiRequestCount"') && selectionRender.includes("payTransitionRequestCountRef.current"), "Pay should record the exact pre-render request count");

assert.ok(processingCase.includes("<PaymentProcessingScreen"), "cash submission should show dedicated processing feedback");
assert.equal(processingCase.includes("PosBootScreen"), false, "cash submission must not display POS startup UI");
const processingScreen = sectionBetween(screens, "export function PaymentProcessingScreen", "export function PaymentResultScreen");
assert.ok(processingScreen.includes("Processing payment...") && processingScreen.includes("Confirming this cash transaction securely."), "cash submission should explain the active payment operation");
assert.equal(processingScreen.includes("Connecting to register"), false, "normal cash submission must not claim the register is reconnecting");
assert.ok(processingRender.includes('"cashProcessingFeedbackMs"'), "processing feedback should be timed from the cashier tap");

assert.equal(cash.match(/posApi\("\/payments\/cash"/g)?.length, 1, "cash settlement should be requested once");
assert.equal(submit.match(/posApi\("\/orders"/g)?.length, 1, "order commit should be requested once");
assert.equal(cash.includes('posApi("/menu"'), false, "cash completion must not reload the menu");
for (const redundantCall of ["loadPos(", "refreshPosConfig(", "loadOrderLists(", "loadRestaurant("]) {
  assert.equal(cash.includes(redundantCall), false, `cash completion must not call ${redundantCall}`);
}
assert.ok(cash.indexOf('await posApi("/payments/cash"') < cash.indexOf("completeSuccessfulTransaction(order, payload)"), "Payment Complete must wait for server settlement confirmation");
assert.ok(resultRender.includes('"cashConfirmationToCompleteUiMs"') && resultRender.includes('"cashPaymentApiRequestCount"'), "server-to-success rendering and request count should be instrumented");
assert.equal(success.includes("resetCurrentOrder()"), false, "success should keep the order and change visible until Done");
assert.equal(cash.includes("resetCurrentOrder()"), false, "a failed payment should preserve the cart and committed order for retry");
assert.ok(finish.includes("resetCurrentOrder()") && finish.includes("POS_EVENT.HOME"), "Done should preserve the established return-home behavior");

assert.ok(app.includes("!apiOnline && !loadedOnceRef.current ? POS_WORKFLOW.OFFLINE : workflow.value"), "only initial startup should be replaced by the offline screen");
assert.ok(initialLoadEffect.includes("if (loadedOnceRef.current)") && initialLoadEffect.indexOf("if (loadedOnceRef.current)") < initialLoadEffect.indexOf("loadPos("), "health recovery should not bootstrap an active register again");
assert.ok(healthEffect.includes("if (!loadedOnceRef.current)") && healthEffect.includes("POS_EVENT.API_OFFLINE"), "global health loss should preserve an already-loaded workflow while marking it degraded");

for (const label of ["Order", "Payment method", "Cash received", "Amount paid", "Change due"]) {
  assert.ok(screens.includes(label), `Payment Complete should show ${label}`);
}
assert.ok(success.includes('paymentMethod: "Cash"'), "successful settlement should identify Cash as the payment method");

assert.ok(app.includes("if (cashPaymentInFlightRef.current) return"), "rapid double taps should be blocked in memory");
assert.ok(posService.includes("tx.payment.updateMany") && posService.includes('code: "POS_CASH_ALREADY_PAID"'), "the server should atomically reject duplicate settlement");
assert.ok(posService.includes("emitKitchenTicketCreated(result.order)"), "order commit should preserve KDS publication");
assert.ok(posService.includes("void postCommitTask.catch"), "drawer dispatch and audit enrichment should remain off the response-critical path");

let tenderInput = "";
for (const key of ["2", "0", ".", "0", "0"]) tenderInput = applyCashKey(tenderInput, key);
assert.equal(cashTenderInputToCents(tenderInput), 2000, "cash keypad should preserve numeric amount entry");
assert.equal(applyCashKey(tenderInput, "backspace"), "20.0", "cash keypad backspace should remain functional");
assert.equal(applyCashKey(tenderInput, "clear"), "", "cash keypad Clear should remain functional");
assert.equal(quickCashTenderAmounts(1867)[0], 2000, "quick tender should preserve the next useful cash amount");
assert.ok(screens.includes("setAmountReceived(cashTenderCentsToInput(total))"), "Exact Cash should continue to enter the authoritative total");
assert.deepEqual(cashTenderSummary(1867, 2000), {
  amountDueCents: 1867,
  tenderedCents: 2000,
  appliedCents: 1867,
  changeDueCents: 133,
  remainingDueCents: 0,
  covered: true
}, "cash change should remain correct");

console.log("pos-payment-transition-performance-test passed (instant Pay, focused cash processing, request counts, failure safety, and session reuse).\n");
