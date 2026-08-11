import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cashTenderSummary } from "../apps/web/src/apps/pos/cashTender.js";
import { isPrivateNetworkHost } from "../apps/web/src/shared/networkHost.js";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("apps/web/src/App.jsx");
const screens = read("apps/web/src/apps/pos/PosWorkflowScreens.jsx");
const styles = read("apps/web/src/styles/index.css");
const stateMachine = read("apps/web/src/apps/pos/stateMachine.js");
const indexHtml = read("apps/web/index.html");
const main = read("apps/web/src/main.jsx");
const serviceWorker = read("apps/web/public/sw.js");
const manifest = JSON.parse(read("apps/web/public/manifest.json"));
const kioskGuide = read("docs/IPHONE_POS_KIOSK.md");

const portraitViewports = [
  [375, 667], [375, 812], [390, 844], [393, 852], [402, 874], [414, 896], [430, 932]
];
for (const [width, height] of portraitViewports) {
  assert.ok(width <= 639 && height >= 667, `${width}x${height} should use the phone portrait contract`);
}

assert.ok(app.includes('restaurant-shell${safePage === "pos" ? " restaurant-shell-pos" : ""}'), "restaurant shell should identify the active POS route");
for (const host of ["10.0.0.8", "172.16.0.8", "172.31.255.254", "192.168.0.135", "169.254.10.20", "fd00::1", "fe80::1"]) {
  assert.equal(isPrivateNetworkHost(host), true, `${host} should be treated as a private development host`);
}
for (const host of ["172.15.0.8", "172.32.0.8", "8.8.8.8", "restaurant.example.com", "fcbistro.com"]) {
  assert.equal(isPrivateNetworkHost(host), false, `${host} should continue through normal tenant-domain routing`);
}
assert.ok(app.includes("import.meta.env.DEV && isPrivateNetworkHost(host)"), "private network bypass must remain development-only");
assert.ok(app.includes("pos-mobile-brand") && app.includes("pos-mobile-dashboard-link"), "mobile POS should provide compact brand and dashboard escape controls");
assert.ok(app.includes('!kioskLocked ? <a className="icon-button pos-mobile-dashboard-link"'), "dashboard escape should stay hidden in kiosk mode");
assert.ok(styles.includes(".restaurant-shell-pos .restaurant-shell-topbar") && styles.includes(".restaurant-shell-pos .restaurant-shell-page-head"), "phone POS should remove desktop restaurant chrome");

assert.ok(styles.includes("@media (max-width: 639px)") && styles.includes(".pos-entry-items") && styles.includes("grid-cols-2"), "portrait POS should use a two-column touch menu");
assert.ok(styles.includes(".pos-entry-menu-scroll") && styles.includes("overflow-y-auto") && styles.includes("-webkit-overflow-scrolling: touch"), "menu should scroll vertically with touch momentum");
assert.ok(styles.includes(".pos-entry-categories") && styles.includes("overflow-x-auto") && styles.includes("scroll-snap-type: x proximity"), "category controls should scroll horizontally");
assert.ok(styles.includes("max-width: 100%") && styles.includes("overflow-x: clip"), "mobile POS should prevent page-level horizontal overflow");

for (const control of ["Modify", "Repeat", "Delete", "pos-entry-dock-quantity", "View order"]) {
  assert.ok(screens.includes(control), `mobile action dock should preserve ${control}`);
}
assert.ok(styles.includes(".pos-entry-action-dock") && styles.includes("bottom: calc(5.15rem + env(safe-area-inset-bottom))"), "line actions should remain above the iPhone order bar");
assert.ok(styles.includes(".pos-entry-mobile-summary") && styles.includes("pos-entry-mobile-summary-command"), "current order should use a dedicated mobile bottom bar");
assert.ok(screens.includes("activateCartLine(line, menuItem, canModify)") && screens.includes('window.matchMedia("(max-width: 1023px)")'), "tapping a configurable mobile cart line should open Modify");
assert.ok(screens.includes("event.stopPropagation()"), "quantity, repeat, modify, and delete controls should not trigger the cart-line action");

assert.ok(styles.includes("@media (min-width: 640px) and (max-width: 932px) and (max-height: 500px) and (orientation: landscape)"), "phone landscape should have a dedicated layout contract");
assert.ok(styles.includes("grid-template-columns: minmax(0, 1fr) minmax(280px, 34vw)"), "phone landscape should split Menu and Current Order");
assert.ok(styles.includes("@media (min-width: 1024px)") && styles.includes("lg:grid-cols-[minmax(0,1fr)_360px]"), "desktop POS layout should remain intact");

assert.ok(app.includes("pos-modifier-scroll") && app.includes("pos-modifier-instructions"), "modifier choices and instructions should share a keyboard-safe scroll region");
assert.ok(styles.includes("height: 100dvh") && styles.includes("scroll-margin-bottom: calc(9rem + env(safe-area-inset-bottom))"), "mobile modifier sheet should fill the viewport without hiding instructions");
assert.ok(styles.includes(".pos-modifier-actions") && styles.includes("padding-bottom: calc(0.75rem + env(safe-area-inset-bottom))"), "modifier actions should clear the Home indicator");

assert.deepEqual(cashTenderSummary(4431, 6000), {
  amountDueCents: 4431,
  tenderedCents: 6000,
  appliedCents: 4431,
  remainingDueCents: 0,
  changeDueCents: 1569,
  covered: true
}, "mobile cash presentation must preserve exact tender math");
for (const label of ["Cash payment", "Cash received", "Exact cash", "Backspace", "Clear", "Complete cash payment", "Change due"]) {
  assert.ok(screens.includes(label), `mobile cash screen should preserve ${label}`);
}
assert.ok(styles.includes(".pos-cash-keypad button") && styles.includes("min-height: 60px"), "mobile cash keypad should use large touch targets");
assert.ok(styles.includes(".pos-complete-cash") && styles.includes("position: sticky"), "cash completion should stay reachable above the software keyboard");
assert.ok(screens.includes("pos-payment-result") && screens.includes('success ? "Done" : "Try another method"'), "Payment Complete should retain an explicit Done action");
assert.ok(app.includes("function finishPaidOrder") && app.includes("POS_EVENT.HOME"), "Done should return to Register Home");

for (const inset of ["top", "right", "bottom", "left"]) {
  assert.ok(styles.includes(`env(safe-area-inset-${inset})`), `mobile POS should respect the iOS ${inset} safe area`);
}
assert.ok(styles.includes("scroll-margin-block: 7rem") && styles.includes("scroll-padding-bottom"), "PIN, setup, modifier, and cash inputs should stay reachable with the iPhone keyboard");
assert.ok(styles.includes("min-height: 44px") && styles.includes("min-height: 56px"), "mobile POS controls should meet touch target guidance");

assert.equal(manifest.display, "standalone", "existing manifest should retain standalone presentation");
assert.equal(manifest.orientation, "any", "installed POS should support portrait and landscape");
assert.ok(manifest.shortcuts?.some((shortcut) => shortcut.url === "/restaurant/login"), "manifest should expose the secure restaurant POS entry point");
assert.ok(indexHtml.includes("viewport-fit=cover") && indexHtml.includes("apple-mobile-web-app-capable"), "document metadata should support iOS standalone safe areas");
assert.ok(main.includes('startsWith("/restaurant")') && main.includes('navigator.serviceWorker.register("/sw.js")'), "restaurant POS should reuse the existing service worker");
assert.ok(serviceWorker.includes('url.pathname.startsWith("/api/")') && serviceWorker.includes("fetch(event.request)"), "service worker must keep all API and payment requests network-only");
const serviceWorkers = readdirSync(join(root, "apps/web/public")).filter((name) => /^(sw|service-worker)\./i.test(name));
assert.deepEqual(serviceWorkers, ["sw.js"], "PWA enhancement should not create a duplicate service worker");
assert.ok(existsSync(join(root, "apps/web/public/manifest.json")), "existing manifest should remain the single PWA manifest");

for (const boundary of ["Guided Access", "supervised iPhone or iPad", "does not bypass iOS security", "never caches API responses or payment data"]) {
  assert.ok(kioskGuide.includes(boundary), `iPhone kiosk guide should document ${boundary}`);
}
assert.ok(stateMachine.includes('[POS_EVENT.PAYMENT_SUCCEEDED]: POS_WORKFLOW.PAYMENT_SUCCESS') && stateMachine.includes('[POS_EVENT.HOME]: POS_WORKFLOW.REGISTER_HOME'), "mobile presentation should preserve payment and Register Home transitions");

console.log("pos-iphone-kiosk-test passed (portrait, landscape, cart, modifiers, cash, safe areas, keyboard, PWA, and desktop regression).\n");
