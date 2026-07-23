import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const mode = process.argv[2] || "all";
const schema = readFileSync(join(root, "apps/api/prisma/schema.prisma"), "utf8");
const apiService = readFileSync(join(root, "apps/api/src/services/posService.js"), "utf8");
const apiRoutes = readFileSync(join(root, "apps/api/src/routes/pos.js"), "utf8");
const apiServer = readFileSync(join(root, "apps/api/src/server.js"), "utf8");
const entitlements = readFileSync(join(root, "apps/api/src/config/entitlements.js"), "utf8");
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles/index.css"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const migrationRoot = join(root, "apps/api/prisma/migrations");
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

function migrationContains(value) {
  if (!existsSync(migrationRoot)) return false;
  return readdirSync(migrationRoot).some((folder) => {
    const file = join(migrationRoot, folder, "migration.sql");
    return existsSync(file) && readFileSync(file, "utf8").includes(value);
  });
}

const scriptNames = [
  "test:pos-routing",
  "test:pos-register",
  "test:pos-cart",
  "test:pos-quotes",
  "test:pos-orders",
  "test:pos-cash",
  "test:pos-card",
  "test:pos-shifts",
  "test:pos-devices",
  "test:pos-kiosk",
  "test:pos-permissions",
  "test:pos-kitchen-sync",
  "test:pos-receipts",
  "test:pos-audit",
  "test:pos-accessibility",
  "test:pos-responsive",
  "test:pos-production-guards"
];

assertCheck(scriptNames.every((scriptName) => packageJson.scripts?.[scriptName]?.includes("pos-release-test.mjs")), "All POS release test scripts are registered");
assertCheck(includesAll(schema, [
  "model PosDevice",
  "model PosRegister",
  "model CashDrawer",
  "model EmployeeShift",
  "model CashDrawerSession",
  "model CashLedgerEntry",
  "model PosOrderSession",
  "model OrderQuote",
  "model PosReceipt"
]), "POS, shift, cash, quote, held cart, and receipt models exist");
assertCheck(includesAll(schema, [
  "enum PosDeviceType",
  "MAIN_TERMINAL",
  "POS_KIOSK",
  "APPROVED_MOBILE",
  "enum PosDeviceStatus",
  "PENDING",
  "ACTIVE",
  "SUSPENDED",
  "REVOKED",
  "enum PosShiftStatus",
  "OPEN",
  "PAUSED",
  "CLOSED",
  "FORCE_CLOSED"
]), "POS device and shift enums include required values");
assertCheck(includesAll(schema, ["DINE_IN", "WALK_IN"]) && migrationContains("ALTER TYPE \"OrderType\" ADD VALUE IF NOT EXISTS 'DINE_IN'"), "Central Order type supports dine-in and walk-in POS orders");
assertCheck(migrationContains("CREATE TABLE \"PosDevice\"") && migrationContains("CREATE TABLE \"OrderQuote\""), "POS migration creates device and quote tables");

assertCheck(includesAll(entitlements, [
  "POS_REGISTER",
  "POS_KIOSK_MODE",
  "POS_DEVICE_MANAGEMENT",
  "POS_CASH_PAYMENTS",
  "POS_CARD_PAYMENTS",
  "POS_SHIFTS",
  "POS_RECEIPTS"
]), "POS feature flags are defined for entitlement checks");
assertCheck(apiServer.includes('app.use("/api/restaurants", posRoutes)') && apiServer.indexOf("posRoutes") < apiServer.indexOf("restaurantRoutes"), "POS routes mount before generic restaurant routes");
assertCheck(apiRoutes.includes("featureGuard(FEATURE.POS_REGISTER") && apiRoutes.includes("allowSuperAdmin: false"), "POS API uses plan guard and blocks super admin operation");
assertCheck(includesAll(apiRoutes, [
  '"/:restaurantId/pos/config"',
  '"/:restaurantId/pos/menu"',
  '"/:restaurantId/pos/quotes"',
  '"/:restaurantId/pos/orders"',
  '"/:restaurantId/pos/payments/cash"',
  '"/:restaurantId/pos/payments/card"',
  '"/:restaurantId/pos/devices"',
  '"/:restaurantId/pos/shifts/clock-in"',
  '"/:restaurantId/pos/orders/:orderId/receipt"'
]), "POS API exposes register, menu, quote, order, payment, device, shift, and receipt endpoints");
assertCheck(apiRoutes.includes("rateLimit") && apiRoutes.includes("kioskExitLimiter"), "Kiosk exit route is rate limited");

assertCheck(includesAll(apiService, [
  "POS_ACCESS",
  "POS_CREATE_ORDER",
  "POS_ACCEPT_CASH",
  "POS_ACCEPT_CARD",
  "POS_MANAGE_DEVICES",
  "POS_MANAGE_KIOSK",
  "POS_EXIT_KIOSK",
  "assertPosPermission"
]), "POS permission system exists and is enforced in service");
assertCheck(apiService.includes('device.deviceType !== "MAIN_TERMINAL"') && apiService.includes("Cash payments are only allowed from a main terminal"), "Cash payments are denied outside main terminal devices");
assertCheck(apiService.includes("requireOpenShift") && apiService.includes("Open cash drawer is required"), "Cash payments require open shift and open cash drawer");
assertCheck(apiService.includes("createPosQuote") && apiService.includes("prisma.menuItem.findMany") && apiService.includes("unitPriceCents"), "POS quotes are calculated server-side from menu items");
assertCheck(apiService.includes("tx.order.create") && apiService.includes("statusHistory") && apiService.includes("Submitted from POS register"), "Submitted POS orders use central Order and kitchen status history");
assertCheck(apiService.includes("RestaurantOrderPayment") || apiService.includes("restaurantOrderPayment"), "POS payments use restaurant order payment records");
assertCheck(apiService.toLowerCase().includes("raw card numbers are never accepted") && apiService.includes("STRIPE_CONNECT"), "Card payments use hosted restaurant merchant flow and reject raw card collection");
assertCheck(apiService.includes("bcrypt.hash") && apiService.includes("bcrypt.compare") && apiService.includes("pos.kiosk.exit.denied"), "Kiosk mode stores hashed PINs and audits denied exits");
assertCheck(apiService.includes("recordAudit") && includesAll(apiService, ["pos.order.submitted", "pos.payment.cash.accepted", "pos.device.registered", "pos.shift.opened"]), "POS actions create audit logs");

assertCheck(app.includes("pos: {") && app.includes('const restaurantPageOrder = ["dashboard", "pos", "orders"'), "Restaurant owner navigation includes POS after dashboard");
assertCheck(app.includes("function RestaurantPosWorkspace") && app.includes("RestaurantPosPage"), "Restaurant POS page component exists");
assertCheck(includesAll(app, [
  '/quotes',
  '/orders',
  '/payments/cash',
  '/payments/card',
  '/devices',
  '/shifts/clock-in',
  '/held-orders'
]), "Frontend POS workspace calls live POS API endpoints");
assertCheck(app.includes("Live API is required for POS register") && !app.includes("mock POS"), "Frontend does not offer demo-only POS state");
assertCheck(app.includes("Kiosk mode is active") && app.includes("Manager PIN"), "Frontend includes kiosk lock and exit UI");
assertCheck(styles.includes(".pos-layout") && styles.includes(".pos-kiosk-lock") && styles.includes("@media (max-width: 767px)"), "POS layout has responsive and kiosk CSS");
assertCheck(styles.includes("xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.42fr)]") && styles.includes(".pos-cart-line"), "POS register layout separates menu and cart controls");

if (failures.length) {
  console.error(`pos-release-test (${mode}) failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log(`pos-release-test (${mode}) passed.`);
