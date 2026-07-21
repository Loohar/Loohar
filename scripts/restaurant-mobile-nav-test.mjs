import { readFileSync } from "node:fs";

const appSource = readFileSync("apps/web/src/App.jsx", "utf8");
const cssSource = readFileSync("apps/web/src/styles/index.css", "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const appHeaderMatch = appSource.match(/function AppHeader[\s\S]*?function LoginStrip/);
assert(appHeaderMatch, "AppHeader component was not found.");

const appHeaderSource = appHeaderMatch[0];

assert(appHeaderSource.includes('className="app-menu-toggle"'), "Mobile/tablet menu trigger is missing.");
assert(appHeaderSource.includes('aria-label="Open dashboard navigation"'), "Mobile menu trigger needs an accessible label.");
assert(appHeaderSource.includes("<MenuIcon"), "Hamburger icon should only exist as the mobile/tablet drawer trigger.");
assert(appHeaderSource.includes('className="app-mobile-drawer"'), "Responsive dashboard drawer is missing.");
assert(appHeaderSource.includes('aria-modal="true"'), "Mobile drawer should be modal for assistive technology.");
assert(appHeaderSource.includes("navItems.map"), "Mobile drawer should reuse the role-aware navItems list.");
assert(cssSource.includes(".app-menu-toggle") && cssSource.includes("lg:hidden"), "Mobile menu trigger must hide on desktop.");
assert(cssSource.includes(".app-nav") && cssSource.includes("lg:flex"), "Desktop nav must appear only at the desktop breakpoint.");
assert(cssSource.includes(".app-mobile-layer.open"), "Mobile drawer open state is missing.");

console.log("Restaurant mobile navigation contract passed.");
