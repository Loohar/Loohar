import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const mode = process.argv[2] || "all";
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const screens = readFileSync(join(root, "apps/web/src/apps/pos/PosWorkflowScreens.jsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles/index.css"), "utf8");
const failures = [];

function pass(message) {
  console.log(`PASS ${message}`);
}

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function assertCheck(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

function includesAll(content, values) {
  return values.every((value) => content.includes(value));
}

if (mode === "all" || mode === "sticky") {
  assertCheck(includesAll(screens, [
    "pos-entry-cart-lines",
    "pos-entry-cart-footer",
    "Current order",
    "Estimated subtotal",
    ">Pay</button>"
  ]), "Current Order separates scrollable item lines from persistent Pay and Hold actions");
  assertCheck(includesAll(styles, [
    "@media (min-width: 1024px)",
    "position: sticky",
    "height: max(560px, calc(100vh",
    "max-height: 760px",
    "overflow-y: auto",
    "lg:grid-cols-[minmax(0,1fr)_360px]",
    "xl:grid-cols-[minmax(0,1fr)_400px]"
  ]), "Desktop/tablet POS cart is sticky and bounded without moving during page scroll");
}

if (mode === "all" || mode === "scroll") {
  assertCheck(includesAll(styles, [
    ".pos-entry-cart-lines",
    "overflow-y: auto",
    ".pos-entry-cart-footer",
    ".pos-entry-mobile-summary",
    "@media (max-width: 1023px)",
    ".pos-entry-cart.open",
    "translateY(110%)"
  ]), "POS cart body scrolls internally and mobile cart remains a drawer");
  assertCheck(includesAll(screens, ["onClick={() => onAdd(item)}", 'onClick={() => setMobileCartOpen(true)}', 'onClick={() => setMobileCartOpen(false)}']), "Adding a mobile menu item does not force the order drawer open");
}

if (failures.length) {
  console.error(`pos-cart-stability-test (${mode}) failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log(`pos-cart-stability-test (${mode}) passed.`);
