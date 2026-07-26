import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const mode = process.argv[2] || "all";
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
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
  assertCheck(includesAll(app, [
    "pos-cart-body",
    "pos-cart-footer",
    "Current order",
    "Server quote",
    "Send to kitchen"
  ]), "Current Order separates scrollable body from persistent quote/actions footer");
  assertCheck(includesAll(styles, [
    "--pos-current-order-top",
    "@media (min-width: 1024px)",
    "position: sticky",
    "max-height: calc(100dvh",
    "overflow: hidden",
    "lg:grid-cols-[minmax(0,1.65fr)_minmax(360px,0.85fr)]"
  ]), "Desktop/tablet POS cart is sticky and bounded without moving during page scroll");
}

if (mode === "all" || mode === "scroll") {
  assertCheck(includesAll(styles, [
    ".pos-cart-body",
    "overflow-y-auto",
    ".pos-cart-footer",
    "shrink-0",
    ".pos-mobile-cart-summary",
    "lg:hidden",
    "@media (max-width: 1023px)",
    ".pos-cart.open",
    "translateY(110%)"
  ]), "POS cart body scrolls internally and mobile cart remains a drawer");
}

if (failures.length) {
  console.error(`pos-cart-stability-test (${mode}) failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log(`pos-cart-stability-test (${mode}) passed.`);
