import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cashSettlementAmounts } from "../apps/api/src/services/posService.js";
import {
  applyCashKey,
  cashTenderCentsToInput,
  cashTenderInputToCents,
  cashTenderSummary,
  normalizeCashTenderInput,
  quickCashTenderAmounts
} from "../apps/web/src/apps/pos/cashTender.js";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("apps/web/src/App.jsx");
const screens = read("apps/web/src/apps/pos/PosWorkflowScreens.jsx");
const styles = read("apps/web/src/styles/index.css");
const posService = read("apps/api/src/services/posService.js");
const hardwareService = read("apps/api/src/services/posHardwareService.js");
const receiptService = read("apps/api/src/services/orderWorkflowService.js");

function sectionBetween(content, start, end) {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `${start} section is missing`);
  assert.notEqual(endIndex, -1, `${end} boundary is missing`);
  return content.slice(startIndex, endIndex);
}

assert.equal(cashTenderCentsToInput(2798), "27.98", "Exact Cash should format the amount due without floating-point math");
assert.equal(cashTenderInputToCents("27.98"), 2798, "exact tender should parse to integer cents");
assert.equal(cashTenderInputToCents("40.00"), 4000, "custom tender should parse to integer cents");
assert.equal(normalizeCashTenderInput("12.345"), null, "more than two decimal places should be rejected");
assert.equal(normalizeCashTenderInput("12345678.00"), null, "oversized tender input should be rejected");

const keyedAmount = ["4", "0", ".", "0", "0"].reduce(applyCashKey, "");
assert.equal(keyedAmount, "40.00", "the touch keypad should enter a custom cash amount");
assert.equal(applyCashKey(keyedAmount, "backspace"), "40.0", "Backspace should remove one character");
assert.equal(applyCashKey(keyedAmount, "clear"), "", "Clear should reset cash input");
assert.equal(applyCashKey("40.00", "0"), "40.00", "rapid extra taps should not create invalid precision");

assert.deepEqual(cashTenderSummary(2798, 2798), {
  amountDueCents: 2798,
  tenderedCents: 2798,
  appliedCents: 2798,
  remainingDueCents: 0,
  changeDueCents: 0,
  covered: true
}, "Exact Cash should apply the full amount with zero change");
assert.equal(cashTenderSummary(2798, 4000).changeDueCents, 1202, "$40.00 against $27.98 should return $12.02");
assert.equal(cashTenderSummary(2798, 2000).remainingDueCents, 798, "insufficient cash should show remaining due");
assert.equal(cashTenderSummary(2798, 2000).covered, false, "insufficient cash should not complete");
assert.deepEqual(quickCashTenderAmounts(2798), [3000, 4000, 5000], "quick tender values should derive from amount due");

assert.deepEqual(cashSettlementAmounts(2798, 4000), {
  amountDueCents: 2798,
  cashTenderedCents: 4000,
  cashAppliedCents: 2798,
  changeDueCents: 1202
}, "the server should authoritatively apply cash and calculate change");
assert.throws(() => cashSettlementAmounts(2798, 2000), (error) => error.code === "POS_CASH_TENDER_INSUFFICIENT");
assert.throws(() => cashSettlementAmounts(2798, 2798.5), (error) => error.code === "POS_CASH_TENDER_INVALID");
assert.throws(() => cashSettlementAmounts(2798, 2798, 2798), (error) => error.code === "POS_CASH_ALREADY_PAID");

const modifyBlock = sectionBetween(app, "function modifyCartLine", "function closeModifierDialog");
const modifierOpenBlock = sectionBetween(app, "function openModifierDialog", "function modifyCartLine");
const updateBlock = sectionBetween(app, "function addConfiguredItemToCart", "function adjustQuantity");
assert.ok(screens.includes("onModify(selectedLine, selectedItem)") && screens.includes("onModify(line, menuItem)"), "Modify should pass the exact selected line and item");
assert.ok(modifyBlock.includes("openModifierDialog(item, line)"), "Modify should open the existing customization dialog");
assert.ok(modifierOpenBlock.includes("posSelectionsFromOptionIds") && modifierOpenBlock.includes("cartLine?.specialInstructions"), "Modify should preload choices and instructions");
assert.ok(updateBlock.includes("replacePosCartLineConfiguration(cart, editingCartLineId, configuration)"), "Update Item should replace the same cart line");
assert.ok(updateBlock.includes("void calculateQuote(updatedCart)"), "cart edits should request a fresh server-authoritative quote");

const paymentScreen = sectionBetween(screens, "export function PaymentSelectionScreen", "export function PaymentResultScreen");
for (const label of ["Order total", "Amount paid", "Amount due", "Exact cash", "Cash received", "Complete cash payment", "Backspace", "Clear"]) {
  assert.ok(paymentScreen.includes(label), `cash payment screen should include ${label}`);
}
assert.equal(paymentScreen.includes("Card or wallet"), false, "unfinished card and wallet payment controls should remain hidden");
assert.ok(paymentScreen.includes("disabled={!quoteReady || !canAcceptCash || !tender.covered || saving}"), "unverified totals and insufficient cash should disable settlement");
assert.ok(screens.includes('success ? "Done" : "Try another method"'), "cash confirmation should require Done before returning home");

const cashService = sectionBetween(posService, "export async function cashPayment", "export async function cardPaymentIntent");
for (const value of ["restaurantId", "locationId", "requireCashRegisterAccess", "cashSettlementAmounts", "cashTender", "cashAppliedCents", "changeDueCents"]) {
  assert.ok(cashService.includes(value), `cash settlement should preserve and validate ${value}`);
}
assert.ok(cashService.includes("tx.payment.updateMany") && cashService.includes('code: "POS_CASH_ALREADY_PAID"'), "cash settlement should atomically prevent duplicate payment");
assert.ok(cashService.includes('error?.code === "P2002"'), "concurrent cash creation should map uniqueness conflicts to already paid");
assert.ok(cashService.includes('entryType: "SALE_CASH"') && cashService.includes("settlement.cashAppliedCents"), "cash ledger should record only the applied amount");
assert.ok(cashService.indexOf("runCashPostCommitTasks") > cashService.indexOf("prisma.$transaction"), "drawer requests should dispatch only after committed settlement");

for (const reason of ["COMPLETED_CASH_SALE", "MANAGER_AUTHORIZED_OPEN", "CASH_MANAGEMENT"]) {
  assert.ok(hardwareService.includes(reason), `drawer hook should authorize ${reason}`);
}
assert.ok(hardwareService.includes('hardwareStatus = "NOT_CONFIGURED"'), "drawer hook should report missing physical hardware honestly");
assert.ok(hardwareService.includes('action: "pos.cash-drawer.open.requested"'), "drawer requests should be audited");

const acceptCashBlock = sectionBetween(app, "async function acceptCashPayment", "function openGuestCheck");
const successBlock = sectionBetween(app, "async function completeSuccessfulTransaction", "async function sendCurrentOrderToKitchen");
const finishBlock = sectionBetween(app, "function finishPaidOrder", "function beginNewOrder");
assert.equal(acceptCashBlock.match(/submitOrder\(/g)?.length, 1, "cash retry should not create a duplicate order or KDS ticket");
assert.ok(successBlock.includes("setPaymentResult({") && successBlock.includes("success: true") && !successBlock.includes("resetCurrentOrder()"), "change should remain visible before cart reset");
assert.ok(finishBlock.includes("resetCurrentOrder()") && finishBlock.includes("POS_EVENT.HOME"), "Done should clear temporary state and return Register Home");
assert.equal(acceptCashBlock.includes("resetCurrentOrder()"), false, "failed cash settlement should preserve the cart for retry");

for (const value of ["cashTenderedCents", "cashAppliedCents", "changeDueCents"]) {
  assert.ok(receiptService.includes(value), `final receipt should expose ${value}`);
}
assert.ok(app.includes("Cash tendered") && app.includes("Cash applied") && app.includes("Change"), "printed cash receipts should show tender and change");
assert.ok(styles.includes(".pos-cash-keypad") && styles.includes("min-h-16"), "cash keypad should provide touch-sized controls");
assert.ok(styles.includes("@media (max-width: 1023px)") && styles.includes(".pos-cash-workspace"), "cash payment should collapse responsively for tablet and phone");

console.log("pos-cash-tender-test passed (Modify, cash keypad, settlement, drawer, receipt, and completion).\n");
