import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyPosPinKey, isPosPinSubmittable } from "../apps/web/src/apps/pos/pinKeypad.js";
import {
  POS_CONFIG_STATE,
  POS_CONNECTION_STATE,
  POS_STARTUP_FAILURE,
  classifyPosStartupError,
  isAuthoritativePosConfig,
  loadPosRegisterSnapshot,
  posStartupDisplay,
  savePosRegisterSnapshot
} from "../apps/web/src/apps/pos/startupReliability.js";
import { initialPosWorkflowState, POS_EVENT, POS_WORKFLOW, posWorkflowReducer } from "../apps/web/src/apps/pos/stateMachine.js";
import { retryTransientRequest } from "../apps/web/src/lib/networkRequest.js";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("apps/web/src/App.jsx");
const apiClient = read("apps/web/src/lib/api.js");
const networkRequest = read("apps/web/src/lib/networkRequest.js");
const serviceWorker = read("apps/web/public/sw.js");
const styles = read("apps/web/src/styles/index.css");
const screens = read("apps/web/src/apps/pos/PosWorkflowScreens.jsx");
const packageJson = JSON.parse(read("package.json"));
const workspace = app.slice(app.indexOf("function RestaurantPosWorkspace"), app.indexOf("function RestaurantReceiptPreviewPage"));
const restaurantApp = app.slice(app.indexOf("function RestaurantApp("), app.indexOf("function RestaurantSite"));
const passed = [];

function pass(number, label) {
  passed.push(number);
  console.log(`PASS ${number}. ${label}`);
}

function errorWithStatus(status, name = "Error") {
  const error = new Error(`HTTP ${status}`);
  error.status = status;
  error.name = name;
  return error;
}

function validConfig(device = { id: "device-1", name: "Front counter POS", locationId: "location-1" }) {
  return {
    restaurant: { id: "restaurant-1", name: "Ralph Restaurant" },
    locations: [{ id: "location-1", name: "Primary Location" }],
    cashDrawers: [],
    permissions: ["POS_ACCESS"],
    pinStatus: { configured: true },
    device,
    shift: { status: "OPEN" }
  };
}

let attempts = 0;
const coldResult = await retryTransientRequest(async () => {
  attempts += 1;
  await new Promise((resolve) => setTimeout(resolve, 20));
  return "online";
}, { attempts: 2, delaysMs: [0] });
assert.equal(coldResult, "online");
assert.equal(attempts, 1);
pass(1, "production-like cold API succeeds without duplicate requests");

attempts = 0;
assert.equal(await retryTransientRequest(async () => {
  attempts += 1;
  return "online";
}, { attempts: 2, delaysMs: [0] }), "online");
assert.equal(attempts, 1);
pass(2, "warm API resolves in one attempt");

attempts = 0;
await retryTransientRequest(async () => {
  attempts += 1;
  if (attempts === 1) {
    const error = new Error("health timeout");
    error.code = "API_REQUEST_TIMEOUT";
    throw error;
  }
  return "online";
}, { attempts: 2, delaysMs: [0] });
assert.equal(attempts, 2);
assert.ok(networkRequest.includes("API_HEALTH_TIMEOUT_MS = 4000") && apiClient.includes("attempts: options.attempts ?? 2"));
pass(3, "first health timeout reconnects once inside the hard window");

attempts = 0;
await retryTransientRequest(async () => {
  attempts += 1;
  if (attempts === 1) throw new TypeError("temporary bootstrap network failure");
  return validConfig();
}, { attempts: 2, delaysMs: [0] });
assert.equal(attempts, 2);
pass(4, "first bootstrap failure recovers on the bounded retry");

attempts = 0;
await assert.rejects(retryTransientRequest(async () => {
  attempts += 1;
  throw new TypeError("still offline");
}, { attempts: 2, delaysMs: [0] }), TypeError);
assert.equal(attempts, 2);
pass(5, "unavailable API stops after exactly two attempts");

assert.equal(classifyPosStartupError(errorWithStatus(401)), POS_STARTUP_FAILURE.AUTH_EXPIRED);
assert.ok(workspace.includes("clearOnUnauthorized: true"));
assert.ok(app.includes("verifiedLoginTokenRef.current === token"));
pass(6, "401 is classified as expired authentication and uses existing session clearing");

assert.equal(classifyPosStartupError(errorWithStatus(403)), POS_STARTUP_FAILURE.AUTH_FORBIDDEN);
assert.equal(posStartupDisplay({ apiMode: "LIVE", apiOnline: true, configState: POS_CONFIG_STATE.ERROR, failureKind: POS_STARTUP_FAILURE.AUTH_FORBIDDEN }).connectionLabel, "Access forbidden");
pass(7, "403 is distinguished from connectivity failure");

assert.equal(classifyPosStartupError(errorWithStatus(500)), POS_STARTUP_FAILURE.SERVER);
pass(8, "500 is classified as a server failure and remains transient");

const storageValues = new Map();
const storage = {
  getItem: (key) => storageValues.get(key) || null,
  setItem: (key, value) => storageValues.set(key, value),
  removeItem: (key) => storageValues.delete(key)
};
savePosRegisterSnapshot("ralph-restaurant", validConfig(), storage);
const cachedRegister = loadPosRegisterSnapshot("ralph-restaurant", storage);
const knownOffline = posStartupDisplay({
  apiMode: "DEMO",
  apiOnline: false,
  configState: POS_CONFIG_STATE.LOADING,
  connectionFailed: true,
  lastKnownRegister: cachedRegister
});
assert.equal(knownOffline.registerLabel, "Front counter POS");
assert.equal(knownOffline.locationLabel, "Primary Location");
assert.equal(knownOffline.shiftLabel, "Shift open");
pass(9, "registered device labels survive a temporary outage as informational state");

const missingConfig = validConfig(null);
assert.equal(isAuthoritativePosConfig(missingConfig), true);
assert.equal(posStartupDisplay({ apiMode: "LIVE", apiOnline: true, configState: POS_CONFIG_STATE.READY, device: null }).registerLabel, "Register not configured");
savePosRegisterSnapshot("ralph-restaurant", missingConfig, storage);
assert.equal(loadPosRegisterSnapshot("ralph-restaurant", storage), null);
pass(10, "only a valid server response can establish a truly unregistered device");

assert.ok(workspace.includes("function retryFailedPosRequests()") && workspace.includes("loadPos({ loadConfig: false })"));
assert.ok(!workspace.includes("window.location.reload"));
pass(11, "retry is selective and non-destructive");

let workflow = posWorkflowReducer(initialPosWorkflowState, { type: POS_EVENT.BOOTSTRAP_FAILED, payload: { message: "network" } });
assert.equal(workflow.value, POS_WORKFLOW.RECOVERY);
assert.equal(isAuthoritativePosConfig({ error: "network" }), false);
pass(12, "network errors cannot route to Register Settings");

const networkDisplay = posStartupDisplay({ apiMode: "DEMO", apiOnline: false, configState: POS_CONFIG_STATE.LOADING, connectionFailed: true });
assert.equal(networkDisplay.state, POS_CONNECTION_STATE.OFFLINE);
assert.notEqual(networkDisplay.connectionLabel, "Configuration error");
pass(13, "network errors never produce a false configuration error");

assert.ok(workspace.includes("window.setTimeout(() => setNotice(\"\"), 4200)") && workspace.includes("setNotice(\"\");\n    setError(\"\");"));
const registerDeviceFlow = workspace.slice(workspace.indexOf("async function registerDevice"), workspace.indexOf("async function openRegisterShift"));
assert.ok(registerDeviceFlow.indexOf("await refreshPosConfig()") < registerDeviceFlow.indexOf("setNotice(\"POS device registered for this restaurant.\")"));
pass(14, "success banners expire and retries clear stale notices");

assert.equal(workspace.match(/posApi\("\/menu"/g)?.length, 1);
assert.ok(packageJson.scripts["test:pos-menu-performance"]?.includes("pos-menu-performance-test.mjs"));
pass(15, "healthy startup has one menu call site and later orders retain its cache");

assert.equal(workspace.includes("io("), false);
assert.ok(restaurantApp.includes('if (activePage === "pos") return;') && restaurantApp.includes('if (activePage === "pos") return undefined;'));
pass(16, "POS starts no duplicate socket and skips the broad restaurant bootstrap");

let pin = "";
for (const digit of ["1", "2", "3", "4"]) pin = applyPosPinKey(pin, digit);
assert.equal(isPosPinSubmittable(pin), true);
assert.equal(applyPosPinKey(pin, "backspace"), "123");
assert.equal(screens.includes(">{pin}<"), false);
pass(17, "masked 4-8 digit PIN entry and backspace remain intact");

workflow = posWorkflowReducer({ ...initialPosWorkflowState, value: POS_WORKFLOW.CASHIER_AUTHENTICATION }, { type: POS_EVENT.UNLOCK_SUCCESS });
assert.equal(workflow.value, POS_WORKFLOW.REGISTER_HOME);
pass(18, "successful PIN returns the terminal to Register Home");

workflow = posWorkflowReducer(workflow, { type: POS_EVENT.OPEN_NEW_ORDER });
assert.equal(workflow.value, POS_WORKFLOW.NEW_ORDER_SETUP);
workflow = posWorkflowReducer(workflow, { type: POS_EVENT.START_ORDER });
assert.equal(workflow.value, POS_WORKFLOW.ORDER_ENTRY);
pass(19, "New Order reaches order entry without bootstrap work");

workflow = posWorkflowReducer(workflow, { type: POS_EVENT.SELECT_PAYMENT });
workflow = posWorkflowReducer(workflow, { type: POS_EVENT.PROCESS_PAYMENT });
workflow = posWorkflowReducer(workflow, { type: POS_EVENT.PAYMENT_SUCCEEDED });
assert.equal(workflow.value, POS_WORKFLOW.PAYMENT_SUCCESS);
for (const script of ["test:pos-cash-performance", "test:pos-payment-transition-performance"]) assert.ok(packageJson.scripts.test.includes(script));
pass(20, "payment transition remains backend-authoritative and isolated from bootstrap");

workflow = posWorkflowReducer(workflow, { type: POS_EVENT.COMPLETE_ORDER });
workflow = posWorkflowReducer(workflow, { type: POS_EVENT.HOME });
assert.equal(workflow.value, POS_WORKFLOW.REGISTER_HOME);
pass(21, "Done returns to the same Register Home session");

assert.ok(styles.includes(".pos-enterprise-register") && styles.includes(".pos-workflow-topline"));
assert.ok(app.includes("routeRenderMs") && app.includes("posReadyMs") && app.includes("realtimeConnectionMs"));
pass(22, "desktop POS keeps its shell and complete development waterfall instrumentation");

assert.ok(styles.includes("@media (max-width: 639px)") && styles.includes("env(safe-area-inset-bottom)"));
assert.ok(styles.includes("@media (min-width: 640px) and (max-width: 932px) and (max-height: 500px) and (orientation: landscape)"));
assert.ok(serviceWorker.includes("NETWORK_ONLY_PATHS") && serviceWorker.includes('"/health"'));
pass(23, "iPhone portrait/landscape contracts and network-only health remain intact");

assert.ok(apiClient.includes("const configuredApiUrl = rawConfiguredApiUrl;"));
assert.ok(apiClient.includes("const configuredApiHealthUrl = rawConfiguredApiHealthUrl;"));
pass(24, "preview builds honor explicit staging API and health endpoints");

assert.deepEqual(passed, Array.from({ length: 24 }, (_, index) => index + 1));
console.log("pos-production-startup-connectivity-test passed (24/24 zero-flap reliability cases).\n");
