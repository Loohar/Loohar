import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  POS_OFFLINE_SYNC_STATUS,
  validatePosOfflinePricingSnapshot
} from "../apps/shared/posOfflinePricing.js";
import {
  buildPosOfflineCashTransaction,
  buildPosOfflineInitialization,
  calculatePosOfflineQuote,
  posOfflineInitializationUsable
} from "../apps/web/src/apps/pos/offlinePricing.js";
import { posOfflineRegisterKey } from "../apps/web/src/apps/pos/offlineStorage.js";
import { classifyPosOfflineSyncError, runPosOfflineSyncBatch } from "../apps/web/src/apps/pos/offlineSync.js";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("apps/web/src/App.jsx");
const screens = read("apps/web/src/apps/pos/PosWorkflowScreens.jsx");
const storageSource = read("apps/web/src/apps/pos/offlineStorage.js");
const service = read("apps/api/src/services/posService.js");
const route = read("apps/api/src/routes/pos.js");
const schema = read("apps/api/prisma/schema.prisma");
const migration = read("apps/api/prisma/migrations/20260815090000_pos_offline_reconciliation/migration.sql");
const taxProfileMigration = read("apps/api/prisma/migrations/20260815130000_location_tax_profiles/migration.sql");
const stagingTaxProfileScript = read("scripts/configure-staging-tax-profile.mjs");

function fixture({ priceCents = 1000, taxRateBps = 825 } = {}) {
  const now = new Date();
  const validUntil = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const config = {
    restaurant: { id: "restaurant-1", slug: "restaurant", name: "Restaurant", timezone: "America/Denver", deliveryFeeCents: 399 },
    staff: { id: "staff-1", userId: "user-1", role: "CASHIER" },
    locations: [{ id: "location-1", name: "Main", active: true }],
    deliveryZones: [{ id: "zone-1", name: "Local", active: true, deliveryFeeCents: 499, minimumOrderCents: 500 }],
    orderFieldPolicy: { WALK_IN: { name: "OPTIONAL" }, DELIVERY: { name: "REQUIRED", deliveryAddress: "REQUIRED" } },
    permissions: ["POS_ACCESS", "POS_ACCEPT_CASH", "POS_SEND_TO_KITCHEN"],
    device: { id: "terminal-1", name: "Counter", deviceType: "MAIN_TERMINAL", status: "ACTIVE", locationId: "location-1", cashDrawerId: "drawer-1" },
    shift: { id: "shift-1", status: "OPEN", employeeUserId: "user-1", deviceId: "terminal-1", locationId: "location-1", cashDrawerId: "drawer-1", openedAt: now.toISOString() },
    cashDrawers: [{ id: "drawer-1", name: "Drawer", status: "OPEN", locationId: "location-1", currentBalanceCents: 10000, active: true }],
    taxConfiguration: {
      id: "tax-profile-1",
      locationId: "location-1",
      provider: "loohar-tax-sync",
      source: "SYNTHETIC_CERTIFICATION_FIXTURE",
      taxRateBps,
      taxInclusive: false,
      enabled: true,
      jurisdictionCode: "STAGING:restaurant:main",
      jurisdictionMetadata: { environment: "staging", synthetic: true },
      sourceMetadata: { reference: "offline-v1-test", synthetic: true },
      effectiveAt: now.toISOString(),
      verifiedAt: now.toISOString(),
      configurationVersion: "tax-profile-v1",
      updatedAt: now.toISOString()
    },
    configurationVersion: `config-${taxRateBps}`,
    offlineConfigurationProof: "signed-config-proof",
    offlineValidUntil: validUntil,
    serverTime: now.toISOString()
  };
  const menu = {
    menuVersion: `menu-${priceCents}`,
    generatedAt: now.toISOString(),
    tenantId: "restaurant-1",
    locationId: "location-1",
    categories: [{
      id: "category-1",
      name: "Lunch",
      items: [{
        id: "item-1",
        categoryId: "category-1",
        name: "Rice Bowl",
        priceCents,
        available: true,
        sendToKitchen: true,
        customizationMode: "OPTIONAL",
        offlinePricingProof: "signed-item-proof",
        options: [],
        optionGroups: [{
          id: "group-1",
          menuItemId: "item-1",
          name: "Protein",
          required: false,
          minSelect: 0,
          maxSelect: 1,
          options: [{ id: "option-1", menuItemId: "item-1", optionGroupId: "group-1", name: "Chicken", priceCents: 250 }]
        }]
      }]
    }]
  };
  const registerKey = posOfflineRegisterKey("restaurant-1", "terminal-1");
  return { config, menu, initialization: buildPosOfflineInitialization({ config, menu, registerKey }) };
}

function cart({ quantity = 1, modifier = false } = {}) {
  return [{
    cartLineId: "line-1",
    menuItemId: "item-1",
    name: "Rice Bowl",
    basePriceCents: 1000,
    priceCents: modifier ? 1250 : 1000,
    quantity,
    modifierSelections: modifier ? [{ modifierGroupId: "group-1", modifierOptionId: "option-1" }] : [],
    modifiers: modifier ? [{ id: "option-1", optionId: "option-1", name: "Chicken", priceCents: 250, groupId: "group-1", groupName: "Protein" }] : [],
    specialInstructions: modifier ? "Sauce on side" : ""
  }];
}

const { initialization } = fixture();
assert.equal(posOfflineInitializationUsable(initialization), true, "a fully initialized open register should be offline-ready");
assert.equal(posOfflineInitializationUsable(null), false, "an uninitialized register must not sell offline");
assert.equal(initialization.menu.categories[0].items[0].imageUrl, undefined, "offline cache should not duplicate menu images");
const inclusiveTaxFixture = fixture();
inclusiveTaxFixture.config.taxConfiguration.taxInclusive = true;
assert.throws(
  () => buildPosOfflineInitialization({ config: inclusiveTaxFixture.config, menu: inclusiveTaxFixture.menu, registerKey: inclusiveTaxFixture.initialization.registerKey }),
  /verified location tax profile/i,
  "Offline v1 must fail closed for tax-inclusive profiles until inclusive arithmetic is supported"
);

const simpleQuote = calculatePosOfflineQuote({ initialization, cart: cart(), orderType: "WALK_IN", customer: {}, locationId: "location-1" });
assert.equal(simpleQuote.subtotalCents, 1000, "simple cached item pricing should be deterministic");
assert.equal(simpleQuote.taxCents, 83, "cached integer-cent tax should match online rounding");
assert.equal(simpleQuote.totalCents, 1083, "cached total should include synchronized tax");
assert.equal(simpleQuote.taxSnapshot.locationId, "location-1", "tax snapshot must be scoped to the register location");
assert.equal(simpleQuote.taxSnapshot.profileVersion, "tax-profile-v1", "tax snapshot must retain its source profile version");
assert.equal(simpleQuote.taxSnapshot.jurisdictionCode, "STAGING:restaurant:main", "tax snapshot must retain jurisdiction identity");

const modifiedQuote = calculatePosOfflineQuote({ initialization, cart: cart({ quantity: 2, modifier: true }), orderType: "WALK_IN", customer: {}, locationId: "location-1" });
assert.equal(modifiedQuote.subtotalCents, 2500, "modifier and quantity pricing should remain deterministic");
assert.equal(modifiedQuote.lineItemsJson[0].modifiers[0].name, "Chicken", "modifier metadata should remain available offline");

const deliveryQuote = calculatePosOfflineQuote({
  initialization,
  cart: cart(),
  orderType: "DELIVERY",
  customer: { deliveryZoneId: "zone-1" },
  locationId: "location-1"
});
assert.equal(deliveryQuote.deliveryFeeCents, 499, "cached delivery configuration should be honored");

assert.throws(() => calculatePosOfflineQuote({ initialization: null, cart: cart(), orderType: "WALK_IN" }), /first online setup/i);
assert.throws(() => calculatePosOfflineQuote({ initialization, cart: cart(), orderType: "WALK_IN", locationId: "other-location" }), /does not match/i);
assert.throws(() => calculatePosOfflineQuote({ initialization, cart: [{ ...cart()[0], priceCents: 999 }], orderType: "WALK_IN", locationId: "location-1" }), /pricing no longer matches/i);

const transaction = buildPosOfflineCashTransaction({
  initialization,
  quote: simpleQuote,
  customer: { name: "Walk-in guest" },
  orderType: "WALK_IN",
  notes: "",
  tableNumber: "",
  amountCents: 2000,
  cashier: { id: "user-1", name: "Cashier" }
});
assert.equal(transaction.syncStatus, POS_OFFLINE_SYNC_STATUS.PENDING_SYNC, "completed cash should enter Pending Sync");
assert.equal(transaction.paymentSnapshot.cashAppliedCents, 1083, "cash applied should equal amount due");
assert.equal(transaction.paymentSnapshot.changeDueCents, 917, "custom tender change should be exact");
assert.equal(transaction.kitchenRoutingSnapshot.status, "PENDING_KITCHEN_SYNC", "KDS delivery should be explicitly pending");
assert.equal(validatePosOfflinePricingSnapshot(transaction).totalCents, 1083, "persisted pricing should pass integrity validation");
assert.throws(() => buildPosOfflineCashTransaction({ initialization, quote: simpleQuote, customer: {}, orderType: "WALK_IN", amountCents: 1000 }), /cover the amount due/i);

const originalQuote = calculatePosOfflineQuote({ initialization, cart: cart(), orderType: "WALK_IN", locationId: "location-1" });
const changed = fixture({ priceCents: 1100 }).initialization;
assert.equal(originalQuote.totalCents, 1083, "a completed cached-price sale must not be repriced");
assert.equal(calculatePosOfflineQuote({ initialization: changed, cart: [{ ...cart()[0], basePriceCents: 1100, priceCents: 1100 }], orderType: "WALK_IN", locationId: "location-1" }).subtotalCents, 1100, "future orders should use the refreshed configuration");

const records = ["a", "b", "c"].map((id, index) => ({
  localTransactionId: id,
  idempotencyKey: `key-${id}`,
  completedAt: new Date(Date.now() + index).toISOString(),
  syncStatus: POS_OFFLINE_SYNC_STATUS.PENDING_SYNC,
  syncAttempts: 0
}));
const state = new Map(records.map((record) => [record.localTransactionId, record]));
const sent = [];
const syncResult = await runPosOfflineSyncBatch({
  records,
  updateRecord: async (id, patch) => state.set(id, { ...state.get(id), ...patch }),
  sendRecord: async (record) => {
    sent.push(record.localTransactionId);
    return { canonicalOrderId: `order-${record.localTransactionId}`, canonicalPaymentId: `payment-${record.localTransactionId}` };
  }
});
assert.deepEqual(sent, ["a", "b", "c"], "sync should remain oldest-first and sequential");
assert.equal(syncResult.synced, 3, "all healthy records should synchronize");
assert.equal(state.get("a").canonicalOrderId, "order-a", "canonical identity should be stored after sync");

let lostResponseAttempts = 0;
const lostRecord = { ...records[0], localTransactionId: "lost", idempotencyKey: "stable-lost-key" };
const lostState = new Map([["lost", lostRecord]]);
const updateLost = async (id, patch) => lostState.set(id, { ...lostState.get(id), ...patch });
await runPosOfflineSyncBatch({
  records: [lostRecord],
  updateRecord: updateLost,
  sendRecord: async () => {
    lostResponseAttempts += 1;
    const error = new Error("response lost");
    error.status = 0;
    throw error;
  }
});
assert.equal(lostState.get("lost").syncStatus, POS_OFFLINE_SYNC_STATUS.FAILED_RETRYABLE, "lost responses must remain retryable");
await runPosOfflineSyncBatch({
  records: [lostState.get("lost")],
  updateRecord: updateLost,
  sendRecord: async (record) => {
    lostResponseAttempts += 1;
    assert.equal(record.idempotencyKey, "stable-lost-key", "retry must preserve idempotency identity");
    return { canonicalOrderId: "order-lost", canonicalPaymentId: "payment-lost" };
  }
});
assert.equal(lostResponseAttempts, 2, "lost response should retry once without changing identity");
assert.equal(lostState.get("lost").syncStatus, POS_OFFLINE_SYNC_STATUS.SYNCED);

const permanent = new Error("location conflict");
permanent.status = 409;
permanent.code = "POS_OFFLINE_LOCATION_MISMATCH";
assert.equal(classifyPosOfflineSyncError(permanent).retryable, false, "permanent validation conflicts should need review");
const expiredSession = new Error("unlock again");
expiredSession.status = 401;
expiredSession.code = "POS_SESSION_EXPIRED";
assert.equal(classifyPosOfflineSyncError(expiredSession).retryable, true, "expired sessions should retry after a secure unlock");

assert.ok(storageSource.includes('database.createObjectStore(TRANSACTION_STORE, { keyPath: "localTransactionId" })'), "one IndexedDB record should own the complete local transaction");
assert.ok(storageSource.includes('store.createIndex("idempotencyKey", "idempotencyKey", { unique: true })'), "local idempotency keys should be unique");
assert.ok(storageSource.includes("transactionFinished(transaction)"), "Payment Complete must wait for IndexedDB commit completion");
assert.ok(storageSource.includes("sort((left, right)"), "pending queue ordering should be deterministic after reload");
assert.ok(app.includes("await persistPosOfflineTransaction(transaction)"), "local durable commit must finish before offline success");
assert.ok(app.indexOf("await persistPosOfflineTransaction(transaction)") < app.indexOf("completeSuccessfulTransaction(order"), "offline Payment Complete must follow durable persistence");
assert.equal(app.includes("!posSessionActive\n      || !offlineStorageRegisterKey"), false, "signed initialization caching must not depend on a transient unlocked session");
assert.ok(app.includes("&& posSessionActive\n    && posOfflineInitializationUsable(offlineInitialization)"), "offline selling must still require an active in-memory POS session");
assert.ok(app.includes("offlineMode && !offlineOperational ? POS_WORKFLOW.OFFLINE : workflow.value"), "operational offline mode must not replace the active workflow with a blocking screen");
assert.ok(screens.includes("Card requires internet") && screens.includes("Offline cash available"), "offline tender availability should be explicit");
assert.ok(app.includes("Pending Sync") && screens.includes("Pending Sync:"), "pending count should be visible without a reconciliation dashboard");
assert.equal(app.includes("window.location.reload"), false, "offline recovery must not reload the POS");

assert.ok(schema.includes("model PosOfflineReconciliation"), "server reconciliation must have a durable database record");
assert.ok(schema.includes("model LocationTaxProfile"), "offline tax must use a first-class location profile");
assert.ok(schema.includes("@@unique([restaurantId, locationId, configurationVersion])"), "tax profile versions must be unique per tenant location");
assert.equal(/model LocationTaxProfile[\s\S]*?taxRateBps\s+Int\s+@default/.test(schema), false, "location tax profiles must not have a global default rate");
assert.ok(schema.includes("@@unique([restaurantId, localTransactionId])"), "local transaction identity must be database-unique per tenant");
assert.ok(schema.includes("@@unique([restaurantId, idempotencyKey])"), "idempotency key must be database-unique per tenant");
assert.ok(migration.includes('CREATE UNIQUE INDEX "PosOfflineReconciliation_restaurantId_idempotencyKey_key"'), "migration must enforce idempotency in PostgreSQL");
assert.ok(taxProfileMigration.includes('CREATE TABLE "LocationTaxProfile"'), "location tax profile migration must be additive");
assert.ok(taxProfileMigration.includes('CONSTRAINT "LocationTaxProfile_taxRateBps_check"'), "database must reject invalid synchronized tax rates");
assert.equal(taxProfileMigration.includes('DEFAULT 825'), false, "location tax profile migration must not install the staging rate as a default");
assert.ok(route.includes('router.post("/:restaurantId/pos/offline/reconcile"') && route.includes("requirePosSession"), "one authenticated reconciliation route should control replay");
assert.ok(service.includes("validatePosOfflinePricingSnapshot") && service.includes("verifyPosOfflineConfigurationProof") && service.includes("verifyPosOfflineMenuItemProof"), "server should verify signed configuration, menu, tax, and arithmetic");
assert.ok(service.includes("prisma.locationTaxProfile.findFirst") && service.includes("locationId: device.locationId"), "signed offline initialization must select the terminal location's active tax profile");
assert.ok(service.includes("configurationProof.taxConfiguration.configurationVersion !== transaction.taxSnapshot?.profileVersion"), "reconciliation must verify the signed tax profile version");
assert.ok(service.includes("createPosOrderTransaction") && service.includes("settleCashOrderTransaction"), "reconciliation should reuse canonical order and cash services");
assert.ok(service.includes("tx.orderTaxSnapshot.create") && service.includes("tx.posOfflineReconciliation.update"), "tax and canonical IDs should commit atomically");
assert.ok(service.includes("kdsDispatchedAt: null") && service.includes("cashDrawerDispatchedAt: null"), "post-commit side effects should be database-gated");
assert.ok(service.includes("eventId: `pos-offline:${reconciliation.id}`"), "KDS replay identity should be deterministic");
assert.ok(service.includes("transactionTenantId !== restaurantId") && service.includes("terminalId !== sessionDevice?.id"), "tenant and terminal isolation must be enforced server-side");
assert.ok(stagingTaxProfileScript.includes('appEnv !== "staging"') && stagingTaxProfileScript.includes("EXPECTED_SUPABASE_PROJECT_REF"), "tax profile writer must fail closed outside the verified staging database");
assert.ok(stagingTaxProfileScript.includes('required("STAGING_TAX_EXPECTED_TENANT_CLASSIFICATION")') && stagingTaxProfileScript.includes("restaurant.tenantClassification !== expectedTenantClassification"), "tax profile writer must match the exact staging tenant classification supplied at execution");
assert.ok(stagingTaxProfileScript.includes('required("STAGING_TAX_RATE_BPS")'), "staging tax rate must be supplied as data at execution time");
assert.equal(stagingTaxProfileScript.includes("825"), false, "the approved certification rate must not be hardcoded in the staging writer");

const persistedText = JSON.stringify(transaction).toLowerCase();
for (const forbidden of ["rawpin", "password", "cardnumber", "cvv", "database_url", "service_role", "jwt_secret"]) {
  assert.equal(persistedText.includes(forbidden), false, `offline transaction must not contain ${forbidden}`);
}

console.log("pos-offline-test passed (pricing, cash, durability, sync, idempotency, isolation, KDS, and security).\n");
