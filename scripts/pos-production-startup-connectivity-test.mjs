import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { POS_CONFIG_STATE, POS_CONNECTION_STATE, posStartupDisplay } from "../apps/web/src/apps/pos/startupReliability.js";
import { retryTransientRequest } from "../apps/web/src/lib/networkRequest.js";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("apps/web/src/App.jsx");
const apiClient = read("apps/web/src/lib/api.js");
const serviceWorker = read("apps/web/public/sw.js");
const packageJson = JSON.parse(read("package.json"));
const workspace = app.slice(app.indexOf("function RestaurantPosWorkspace"), app.indexOf("function RestaurantReceiptPreviewPage"));

let attempts = 0;
const immediate = await retryTransientRequest(async () => {
  attempts += 1;
  return "online";
}, { delaysMs: [0, 0] });
assert.equal(immediate, "online", "1. API available immediately should resolve");
assert.equal(attempts, 1, "1. immediate API should use one attempt");

attempts = 0;
const delayed = await retryTransientRequest(async () => {
  attempts += 1;
  await new Promise((resolve) => setTimeout(resolve, 5));
  return "online";
}, { delaysMs: [0, 0] });
assert.equal(delayed, "online", "2. delayed API should remain connecting and resolve");
assert.equal(attempts, 1, "2. a slow successful request should not be duplicated");

attempts = 0;
const recovered = await retryTransientRequest(async () => {
  attempts += 1;
  if (attempts === 1) throw new TypeError("temporary network failure");
  return "online";
}, { delaysMs: [0, 0] });
assert.equal(recovered, "online", "3. first transient failure should recover");
assert.equal(attempts, 2, "3. recovery should stop after success");

attempts = 0;
await assert.rejects(retryTransientRequest(async () => {
  attempts += 1;
  throw new TypeError("still offline");
}, { delaysMs: [0, 0] }), TypeError, "4. unavailable API should reject after bounded attempts");
assert.equal(attempts, 3, "4. unavailable API should stop after exactly three attempts");

const connecting = posStartupDisplay({ apiMode: "LIVE", apiOnline: true, configState: POS_CONFIG_STATE.LOADING });
assert.equal(connecting.state, POS_CONNECTION_STATE.CONNECTING, "5. unresolved startup should display CONNECTING");
assert.equal(connecting.connectionLabel, "Connecting to Loohar...", "5. connecting copy should be explicit");

const networkFailure = posStartupDisplay({ apiMode: "DEMO", apiOnline: false, configState: POS_CONFIG_STATE.ERROR, connectionFailed: true });
assert.equal(networkFailure.state, POS_CONNECTION_STATE.OFFLINE, "6. network error should be OFFLINE");
assert.equal(networkFailure.registerLabel, "Loading register...", "6. network error must never claim the register is missing");

const missingRegister = posStartupDisplay({ apiMode: "LIVE", apiOnline: true, configState: POS_CONFIG_STATE.READY, device: null, shift: null });
assert.equal(missingRegister.registerLabel, "Register not configured", "7. authoritative empty config should report a missing register");

const delayedShift = posStartupDisplay({ apiMode: "LIVE", apiOnline: true, configState: POS_CONFIG_STATE.LOADING, device: { name: "Front counter POS" }, shift: null });
assert.equal(delayedShift.shiftLabel, "Checking shift...", "8. unresolved shift must not be shown as closed");

assert.ok(app.includes('safePage !== "pos"') && !workspace.includes("Live API") && !workspace.includes("Live POS"), "9. POS should render one authoritative connection status");

assert.ok(app.includes('new globalThis.Event("loohar:api-health-retry")') && app.includes("checkApiHealthWithRetry({ force })") && !workspace.includes("window.location.reload"), "10. Retry should recover without a full page refresh");

assert.equal(workspace.match(/posApi\("\/menu"/g)?.length, 1, "11. POS should retain one menu request site");
assert.ok(workspace.includes("inflightLoadRef.current") && workspace.includes("retryTransientRequest"), "11. concurrent retries should reuse one bootstrap lifecycle");

assert.equal(workspace.includes("io("), false, "12. POS reconnect should not create a Socket.IO client or duplicate listeners");

assert.ok(packageJson.scripts["test:pos-menu-performance"]?.includes("pos-menu-performance-test.mjs"), "13. menu performance regression remains in the required suite");

for (const script of ["test:pos-cash-performance", "test:pos-payment-transition-performance", "test:realtime-kds", "test:pos-kds-latency"]) {
  assert.ok(packageJson.scripts.test.includes(script), `14. ${script} should remain in the full regression suite`);
}

const knownOffline = posStartupDisplay({
  apiMode: "DEMO",
  apiOnline: false,
  configState: POS_CONFIG_STATE.READY,
  connectionFailed: true,
  device: { name: "Front counter POS" },
  shift: { status: "OPEN" }
});
assert.equal(knownOffline.registerLabel, "Front counter POS", "known register UI should survive a transient outage");
assert.equal(knownOffline.shiftLabel, "Shift open", "known shift UI should survive a transient outage");
assert.ok(apiClient.includes('const rawConfiguredApiHealthUrl = import.meta.env.VITE_API_HEALTH_URL || (isDev ? `${localDevApiOrigin}/health` : "/health")'), "production health should resolve to the same-origin production proxy");
assert.ok(serviceWorker.includes("NETWORK_ONLY_PATHS") && serviceWorker.includes('"/health"'), "health responses should never come from the service-worker cache");

console.log("pos-production-startup-connectivity-test passed (14 focused startup, retry, truthful-state, deduplication, and regression checks).\n");
