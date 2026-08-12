import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyPosPinKey, isPosPinSubmittable, normalizePosPin, POS_PIN_MAX_LENGTH, POS_PIN_MIN_LENGTH } from "../apps/web/src/apps/pos/pinKeypad.js";
import { posWorkflowReducer, POS_EVENT, POS_WORKFLOW } from "../apps/web/src/apps/pos/stateMachine.js";
import { fetchWithTimeout } from "../apps/web/src/lib/networkRequest.js";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("apps/web/src/App.jsx");
const screens = read("apps/web/src/apps/pos/PosWorkflowScreens.jsx");
const styles = read("apps/web/src/styles/index.css");
const apiClient = read("apps/web/src/lib/api.js");
const serviceWorker = read("apps/web/public/sw.js");
const posService = read("apps/api/src/services/posService.js");
const posRoutes = read("apps/api/src/routes/pos.js");

let pin = "";
for (const digit of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) pin = applyPosPinKey(pin, digit);
assert.equal(pin, "12345678", "PIN keypad should accept digits and enforce the eight-digit maximum");
assert.equal(applyPosPinKey(pin, "backspace"), "1234567", "PIN keypad should delete one digit");
assert.equal(applyPosPinKey(pin, "clear"), "", "PIN keypad should clear all digits");
assert.equal(normalizePosPin("12a3-4"), "1234", "PIN state should contain digits only");
assert.equal(isPosPinSubmittable("123"), false, "PIN shorter than policy should not submit");
assert.equal(isPosPinSubmittable("1234"), true, "minimum-length PIN should submit");
assert.equal(isPosPinSubmittable("12345678"), true, "maximum-length PIN should submit");
assert.equal(POS_PIN_MIN_LENGTH, 4);
assert.equal(POS_PIN_MAX_LENGTH, 8);

const pinScreen = screens.slice(screens.indexOf("export function CashierPinScreen"), screens.indexOf("export function RegisterHomeScreen"));
const maskedDotCount = (value) => normalizePosPin(value).length;
assert.equal(maskedDotCount(""), 0, "zero entered digits should render no PIN dots");
assert.equal(maskedDotCount("1"), 1, "one entered digit should render one masked dot");
assert.equal(maskedDotCount("1234"), 4, "four entered digits should render four masked dots");
assert.equal(maskedDotCount("12345678"), 8, "eight entered digits should render eight masked dots");
assert.equal(maskedDotCount(applyPosPinKey("1234", "backspace")), 3, "Backspace should reduce the masked-dot count");
assert.equal(maskedDotCount(applyPosPinKey("1234", "clear")), 0, "Clear should remove every masked dot");
assert.ok(pinScreen.includes("pos-pin-dots") && pinScreen.includes("Array.from({ length: pin.length }") && pinScreen.includes("aria-hidden=\"true\""), "PIN digits should be represented only by entered-length masked dots");
assert.equal(pinScreen.includes("Array.from({ length: maxLength }"), false, "PIN UI must not render unused placeholder dots");
assert.equal(pinScreen.includes('name="pos-pin"') || pinScreen.includes("value={pin}") || pinScreen.includes(">{pin}<"), false, "cashier PIN must never render in plaintext");
for (const label of ["Delete last PIN digit", "Clear PIN", "Unlock register", "Cancel"]) {
  assert.ok(screens.includes(label), `PIN screen should expose ${label}`);
}

assert.ok(styles.includes("@media (max-width: 639px)") && styles.includes(".pos-pin-keypad button") && styles.includes("min-height: 56px"), "portrait PIN keypad should have iPhone-sized touch targets");
assert.ok(styles.includes("@media (min-width: 640px) and (max-width: 932px) and (max-height: 500px) and (orientation: landscape)"), "landscape PIN layout should have a dedicated media contract");
assert.ok(styles.includes("grid-template-columns: minmax(200px, 0.8fr) minmax(300px, 1fr)"), "landscape PIN should split introduction and keypad");
assert.ok(styles.includes("overflow-x: hidden") && styles.includes("env(safe-area-inset-bottom)"), "PIN layout should prevent horizontal overflow and respect iPhone safe areas");
assert.ok(app.includes("pinScreenActive") && styles.includes(".pos-enterprise-register.pin-active"), "portrait PIN should not inherit the mobile order-bar whitespace reserve");
assert.ok(styles.includes(".pos-pin-layout") && styles.includes("max-w-md"), "desktop PIN layout should retain a bounded centered presentation");

const originalFetch = globalThis.fetch;
let timeoutCalls = 0;
globalThis.fetch = (_input, options = {}) => {
  timeoutCalls += 1;
  return new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
};
const timeoutStartedAt = Date.now();
await assert.rejects(fetchWithTimeout("http://unreachable.test", {}, 30), (error) => error.code === "API_REQUEST_TIMEOUT");
assert.ok(Date.now() - timeoutStartedAt < 500, "unreachable request should stop at its configured timeout");
assert.equal(timeoutCalls, 1, "a timed-out request should not duplicate itself");

let recoveryCalls = 0;
globalThis.fetch = (_input, options = {}) => {
  recoveryCalls += 1;
  if (recoveryCalls === 1) {
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
  }
  return Promise.resolve({ ok: true, json: async () => ({ status: "ok" }) });
};
await assert.rejects(fetchWithTimeout("http://recover.test", {}, 30), (error) => error.code === "API_REQUEST_TIMEOUT");
const recovered = await fetchWithTimeout("http://recover.test", {}, 30);
assert.deepEqual(await recovered.json(), { status: "ok" }, "retry should recover after the API becomes reachable");
assert.equal(recoveryCalls, 2, "retry should issue exactly one new request");
globalThis.fetch = originalFetch;

assert.ok(apiClient.includes("API_HEALTH_TIMEOUT_MS = 6000") || read("apps/web/src/lib/networkRequest.js").includes("API_HEALTH_TIMEOUT_MS = 6000"), "API health should fail within the 5-10 second requirement");
assert.ok(app.includes("const POS_STARTUP_TIMEOUT_MS = 8000"), "critical POS startup should have an eight-second request limit");
assert.ok(app.includes('const configPromise = posApi("/config"') && app.includes('const menuOutcomePromise = posApi("/menu"'), "register config and menu should start concurrently");
assert.ok(app.indexOf("const configPromise") < app.indexOf("await configPromise") && app.indexOf("const menuOutcomePromise") < app.indexOf("await configPromise"), "independent startup requests should launch before awaiting critical config");
assert.ok(app.includes("if (inflightLoadRef.current && !startupAbortRef.current?.signal.aborted) return inflightLoadRef.current"), "startup retries should share one active in-flight initialization");
assert.ok(app.includes("inflightLoadRef.current === startupRequest"), "an aborted startup should not clear a newer Retry request");
assert.ok(app.includes("startupAbortRef.current?.abort()"), "POS startup should cancel abandoned requests");
assert.ok(app.includes('setStartupStage("Loading register...")') && app.includes('setStartupStage("Loading menu...")') && app.includes('setStartupStage("Ready")'), "startup should expose useful progress stages");
assert.ok(app.includes("Unable to connect to Loohar POS server."), "API failure should show the required recovery title");
assert.ok(app.includes('new globalThis.Event("loohar:api-health-retry")') && app.includes("checkApiHealth({ force })"), "Retry should request a fresh authoritative API health probe");
assert.ok(serviceWorker.includes('url.pathname.startsWith("/api/")') && serviceWorker.includes("fetch(event.request)"), "service worker must never serve cached API responses");
assert.ok(!app.slice(app.indexOf("function RestaurantPosWorkspace"), app.indexOf("function RestaurantReceiptPreviewPage")).includes("io("), "POS workspace should not create duplicate sockets or KDS listeners");

let workflow = { value: POS_WORKFLOW.BOOTING, previous: null, context: {}, lastEvent: null, invalidTransition: null, transitionCount: 0 };
workflow = posWorkflowReducer(workflow, { type: POS_EVENT.BOOTSTRAP_FAILED, payload: { message: "connection failed" } });
assert.equal(workflow.value, POS_WORKFLOW.RECOVERY, "failed startup should enter recovery");
workflow = posWorkflowReducer(workflow, { type: POS_EVENT.RECOVER });
assert.equal(workflow.value, POS_WORKFLOW.BOOTING, "Retry should restart required initialization");
workflow = posWorkflowReducer(workflow, { type: POS_EVENT.BOOTSTRAP_READY, payload: { hasDevice: true, pinConfigured: true } });
assert.equal(workflow.value, POS_WORKFLOW.LOCKED, "recovered startup should return to the verified register lock screen");

assert.match(posService, /POS_PIN_PATTERN = \/\^\\d\{4,8\}\$\//, "backend should remain authoritative for supported PIN lengths");
assert.ok(posService.includes("POS_PIN_MAX_ATTEMPTS = 5") && posService.includes("posPinLockedUntil"), "five-attempt PIN lockout should remain enforced server-side");
assert.ok(posService.includes('action: "pos.pin.failed"') && posService.includes('action: "pos.register.unlocked"'), "failed and successful unlocks should remain audited");
assert.ok(posRoutes.includes('router.post("/:restaurantId/pos/unlock", posPinLimiter'), "unlock route should retain PIN rate limiting");
const unlockSlice = app.slice(app.indexOf("async function unlockRegister"), app.indexOf("async function loadOrderLists"));
assert.ok(unlockSlice.indexOf("POS_EVENT.UNLOCK_SUCCESS") < unlockSlice.indexOf("void loadOrderLists"), "successful PIN should render Register Home before background order-list refresh");
assert.ok(unlockSlice.includes("POS_EVENT.UNLOCK_FAILED") && unlockSlice.includes("setPinLockedUntil"), "failed PIN and lockout response should remain visible");

for (const timing of ["apiHealthMs", "authenticationSessionMs", "restaurantLocationMs", "registerDeviceShiftMs", "menuModifierMs", "paymentReadinessMs", "criticalRegisterReadyMs", "pinVerificationMs", "pinToRegisterHomeMs"]) {
  assert.ok(app.includes(`\"${timing}\"`), `development timing should record ${timing}`);
}

console.log("pos-mobile-startup-reliability-test passed (PIN portrait/landscape/keypad/security, startup timeout/retry/progression, request and socket deduplication, desktop regression).\n");
