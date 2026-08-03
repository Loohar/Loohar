import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  POS_EVENT,
  POS_WORKFLOW,
  initialPosWorkflowState,
  loadPosOrderDraft,
  posWorkflowReducer,
  savePosOrderDraft
} from "../apps/web/src/apps/pos/stateMachine.js";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const expectedStates = [
  "BOOTING",
  "OFFLINE",
  "LOCKED",
  "CASHIER_AUTHENTICATION",
  "REGISTER_HOME",
  "NEW_ORDER_SETUP",
  "ORDER_ENTRY",
  "ITEM_CUSTOMIZATION",
  "ORDER_REVIEW",
  "PAYMENT_SELECTION",
  "PAYMENT_PROCESSING",
  "PAYMENT_SUCCESS",
  "PAYMENT_FAILED",
  "SEND_TO_KITCHEN",
  "PRINTING",
  "ORDER_COMPLETE",
  "HELD_ORDERS",
  "RECENT_ORDERS",
  "SHIFT_MANAGEMENT",
  "REGISTER_SETTINGS",
  "MANAGER_OVERRIDE",
  "RECOVERY"
];

assert.deepEqual(Object.values(POS_WORKFLOW), expectedStates, "POS workflow must expose exactly the 22 approved states");
assert.equal(POS_EVENT.HOLD_ORDER, "HOLD_ORDER", "Hold Order must be an event");
assert.equal(POS_WORKFLOW.HOLD_ORDER, undefined, "Hold Order must not be a workflow state");

let workflow = { ...initialPosWorkflowState, context: {} };
const transition = (type, payload) => {
  workflow = posWorkflowReducer(workflow, { type, payload });
  return workflow.value;
};

assert.equal(transition(POS_EVENT.BOOTSTRAP_READY, { hasDevice: true, pinConfigured: true }), POS_WORKFLOW.LOCKED);
assert.equal(transition(POS_EVENT.BEGIN_UNLOCK), POS_WORKFLOW.CASHIER_AUTHENTICATION);
assert.equal(transition(POS_EVENT.UNLOCK_SUCCESS, { unlockedBy: { id: "staff-1" } }), POS_WORKFLOW.REGISTER_HOME);
assert.equal(transition(POS_EVENT.OPEN_NEW_ORDER), POS_WORKFLOW.NEW_ORDER_SETUP);
assert.equal(transition(POS_EVENT.START_ORDER, { orderType: "DINE_IN" }), POS_WORKFLOW.ORDER_ENTRY);
assert.equal(transition(POS_EVENT.CUSTOMIZE_ITEM), POS_WORKFLOW.ITEM_CUSTOMIZATION);
assert.equal(transition(POS_EVENT.CLOSE_CUSTOMIZATION), POS_WORKFLOW.ORDER_ENTRY);
assert.equal(transition(POS_EVENT.REVIEW_ORDER), POS_WORKFLOW.ORDER_REVIEW);
assert.equal(transition(POS_EVENT.SELECT_PAYMENT), POS_WORKFLOW.PAYMENT_SELECTION);
assert.equal(transition(POS_EVENT.PROCESS_PAYMENT), POS_WORKFLOW.PAYMENT_PROCESSING);
assert.equal(transition(POS_EVENT.PAYMENT_SUCCEEDED), POS_WORKFLOW.PAYMENT_SUCCESS);
assert.equal(transition(POS_EVENT.SEND_TO_KITCHEN), POS_WORKFLOW.SEND_TO_KITCHEN);
assert.equal(transition(POS_EVENT.START_PRINTING), POS_WORKFLOW.PRINTING);
assert.equal(transition(POS_EVENT.PRINTING_FINISHED), POS_WORKFLOW.ORDER_COMPLETE);
assert.equal(transition(POS_EVENT.HOME), POS_WORKFLOW.REGISTER_HOME);

workflow = posWorkflowReducer(workflow, { type: POS_EVENT.OPEN_NEW_ORDER });
workflow = posWorkflowReducer(workflow, { type: POS_EVENT.START_ORDER });
assert.equal(transition(POS_EVENT.HOLD_ORDER), POS_WORKFLOW.REGISTER_HOME, "Holding an order must return to register home");
const beforeInvalid = workflow.value;
workflow = posWorkflowReducer(workflow, { type: POS_EVENT.PROCESS_PAYMENT });
assert.equal(workflow.value, beforeInvalid, "Invalid transitions must not change screens");
assert.deepEqual(workflow.invalidTransition?.from, POS_WORKFLOW.REGISTER_HOME);
assert.deepEqual(workflow.invalidTransition?.event, POS_EVENT.PROCESS_PAYMENT);

assert.equal(transition(POS_EVENT.API_OFFLINE), POS_WORKFLOW.OFFLINE);
assert.equal(transition(POS_EVENT.API_ONLINE), POS_WORKFLOW.BOOTING);
workflow = posWorkflowReducer(workflow, { type: POS_EVENT.BOOTSTRAP_READY, payload: { hasDevice: false, pinConfigured: false } });
assert.equal(workflow.value, POS_WORKFLOW.REGISTER_SETTINGS, "Unconfigured registers must open settings");
workflow = posWorkflowReducer(workflow, { type: POS_EVENT.LOCK });
assert.equal(workflow.value, POS_WORKFLOW.LOCKED);
assert.equal(workflow.context.unlockedBy, null, "Locking must clear the cashier identity");

const storage = new Map();
globalThis.window = {
  sessionStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  }
};
savePosOrderDraft("restaurant-1", {
  orderType: "DELIVERY",
  locationId: "location-1",
  tableNumber: "12",
  notes: "private note",
  customer: { name: "Private Person", email: "person@example.com", phone: "555-555-5555" },
  cart: [{
    cartLineId: "line-1",
    menuItemId: "item-1",
    name: "Lunch",
    priceCents: 1200,
    quantity: 1,
    specialInstructions: "allergy details",
    rogue: "must not persist"
  }]
});
const storedDraft = loadPosOrderDraft("restaurant-1");
assert.deepEqual(storedDraft.customer, { name: "Walk-in guest" });
assert.equal(storedDraft.notes, "");
assert.equal(storedDraft.cart[0].specialInstructions, "");
assert.equal(storedDraft.cart[0].rogue, undefined);
assert.equal(JSON.stringify(storedDraft).includes("person@example.com"), false);
delete globalThis.window;

const schema = read("apps/api/prisma/schema.prisma");
const migration = read("apps/api/prisma/migrations/20260802120000_enterprise_pos_workflows/migration.sql");
const service = read("apps/api/src/services/posService.js");
const routes = read("apps/api/src/routes/pos.js");
const sessionGuard = read("apps/api/src/middleware/posSession.js");
const tokens = read("apps/api/src/utils/tokens.js");
const app = read("apps/web/src/App.jsx");
const screens = read("apps/web/src/apps/pos/PosWorkflowScreens.jsx");

for (const value of ["DRIVE_THRU", "CURBSIDE", "CATERING", "posPinHash", "posPinFailedAttempts", "posPinLockedUntil", "locationIdsJson"]) {
  assert.equal(schema.includes(value), true, `Prisma schema must include ${value}`);
}
for (const value of ["DRIVE_THRU", "CURBSIDE", "CATERING", "posPinHash", "posPinFailedAttempts", "posPinLockedUntil", "locationIdsJson"]) {
  assert.equal(migration.includes(value), true, `Migration must include ${value}`);
}
for (const value of ["bcrypt.hash", "bcrypt.compare", "POS_PIN_MAX_ATTEMPTS = 5", "POS_PIN_LOCKOUT_MS", "assertStaffLocationAccess", "signPosSessionToken", "recordAudit"]) {
  assert.equal(service.includes(value), true, `POS service security must include ${value}`);
}
for (const value of ["normalizePosOrderFieldPolicy", "POS_DELIVERY_ZONE_REQUIRED", "POS_DELIVERY_ZONE_INVALID", "POS_DELIVERY_MINIMUM_NOT_MET", "POS_ORDER_SETUP_REQUIRED"]) {
  assert.equal(service.includes(value), true, `POS service workflow validation must include ${value}`);
}
assert.equal(service.includes("cents(body?.deliveryFeeCents)"), false, "POS delivery fees must never trust a client-provided amount");
assert.equal(service.includes("const tipCents = 0"), true, "Cashier-created POS quotes must not manufacture customer tips");
for (const value of ["posPinLimiter", '"/:restaurantId/pos/pin"', '"/:restaurantId/pos/unlock"', '"/:restaurantId/pos/open-orders"', '"/:restaurantId/pos/recent-orders"', "requirePosSession"]) {
  assert.equal(routes.includes(value), true, `POS routes must include ${value}`);
}
for (const value of ["payload.purpose !== \"POS_SESSION\"", "active: true", "status: \"ACTIVE\"", "payload.restaurantId", "payload.locationId", "POS_SESSION_LOCATION_DENIED"]) {
  assert.equal(sessionGuard.includes(value), true, `POS session guard must include ${value}`);
}
assert.equal(tokens.includes('purpose: "POS_SESSION"'), true, "POS session tokens must carry a purpose claim");
assert.equal(app.includes('const posSessionTokenRef = useRef("")'), true, "POS session must be held in memory");
assert.equal(app.includes("localStorage.setItem(\"posSessionToken"), false, "POS session must not enter local storage");
assert.equal(app.includes("sessionStorage.setItem(\"posSessionToken"), false, "POS session must not enter session storage");
assert.equal(app.includes("deliveryZoneId: customer.deliveryZoneId || null"), true, "Delivery quotes must identify the tenant delivery zone");
assert.equal(app.includes("deliveryZones={config?.deliveryZones || []}"), true, "Order setup must receive live delivery zones");
assert.equal(app.includes("orderFieldPolicy={config?.orderFieldPolicy || {}}"), true, "Order setup must receive the restaurant field policy");
assert.equal(screens.includes('type="password" name="pos-pin"'), true, "Cashier PIN must use a masked input");
assert.equal(screens.includes("cardNumber"), false, "POS screens must not collect raw card numbers");
assert.equal(screens.includes("pos-tip-selector"), false, "Cashier payment screens must not collect customer gratuity");
assert.equal(screens.includes("setTipCents"), false, "Cashier payment screens must not mutate customer gratuity");
for (const value of ["WALK_IN", "DINE_IN", "PICKUP", "DELIVERY", "DRIVE_THRU", "CURBSIDE", "CATERING", "Skip guest details"]) {
  assert.equal(screens.includes(value), true, `Order setup must include ${value}`);
}
const itemTap = screens.slice(screens.indexOf("onClick={() => onAdd(item)}"), screens.indexOf("pos-entry-mobile-summary"));
assert.equal(itemTap.includes("setMobileCartOpen(true)"), false, "Adding a menu item must not close the mobile menu");

console.log("pos-enterprise-workflow-test passed.");
