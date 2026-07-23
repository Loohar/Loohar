import { readFileSync } from "node:fs";

const appSource = readFileSync("apps/web/src/App.jsx", "utf8");
const cssSource = readFileSync("apps/web/src/styles/index.css", "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const shellMatch = appSource.match(/function RestaurantAppShell[\s\S]*?function LoginStrip/);
assert(shellMatch, "RestaurantAppShell component was not found.");

const shellSource = shellMatch[0];

assert(shellSource.includes('className="restaurant-shell-drawer-trigger"'), "Restaurant mobile/tablet menu trigger is missing.");
assert(shellSource.includes('aria-label="Open restaurant navigation"'), "Restaurant mobile menu trigger needs an accessible label.");
assert(shellSource.includes("<MenuIcon"), "Hamburger icon should exist as the restaurant drawer trigger.");
assert(shellSource.includes('className="restaurant-shell-mobile-drawer"'), "Restaurant responsive drawer is missing.");
assert(shellSource.includes('aria-modal="true"'), "Restaurant drawer should be modal for assistive technology.");
assert(shellSource.includes("renderSidebarNav(closeDrawer)"), "Restaurant drawer should reuse the sidebar nav source of truth.");
assert(shellSource.includes("trapFocus(event, drawerRef.current, drawerCloseRef.current)"), "Restaurant drawer should trap focus.");
assert(shellSource.includes("document.body.style.overflow = \"hidden\""), "Restaurant drawer should lock background scroll.");
assert(cssSource.includes(".restaurant-shell-drawer-trigger") && cssSource.includes("@media (min-width: 1024px)"), "Restaurant drawer trigger must hide at the desktop breakpoint.");
assert(cssSource.includes(".restaurant-shell-mobile-layer.open"), "Restaurant mobile drawer open state is missing.");
assert(cssSource.includes("width: min(88vw, 360px)"), "Restaurant mobile drawer must fit narrow devices.");

console.log("Restaurant mobile navigation contract passed.");
