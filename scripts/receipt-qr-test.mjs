import fs from "node:fs";

const mode = process.argv[2] || "all";
const files = {
  app: "apps/web/src/App.jsx",
  css: "apps/web/src/styles/index.css",
  workflow: "apps/api/src/services/orderWorkflowService.js",
  restaurantRoutes: "apps/api/src/routes/restaurant.js",
  orderRoutes: "apps/api/src/routes/orders.js"
};

function read(file) {
  return fs.readFileSync(file, "utf8");
}

const app = read(files.app);
const css = read(files.css);
const workflow = read(files.workflow);
const restaurantRoutes = read(files.restaurantRoutes);
const orderRoutes = read(files.orderRoutes);

function assert(condition, message) {
  if (!condition) {
    console.error(`Receipt QR test failed: ${message}`);
    process.exitCode = 1;
  }
}

function checkPrinting() {
  assert(!app.includes("openReceiptPrintWindow"), "old popup receipt helper must be removed");
  assert(!app.includes("buildReceiptPrintHtml"), "old popup print html helper must be removed");
  assert(app.includes("RestaurantReceiptPreviewPage"), "receipt preview page missing");
  assert(app.includes("window.print()"), "receipt preview must use same-page print");
  assert(css.includes("@media print"), "print CSS missing");
  assert(css.includes("receipt-thermal--58mm"), "58mm print layout missing");
  assert(css.includes("receipt-thermal"), "80mm print layout missing");
}

function checkQr() {
  assert(workflow.includes("driverAppDownloadUrls"), "driver download URL helper missing");
  assert(workflow.includes("/driver-app"), "driver download QR must point to /driver-app");
  assert(workflow.includes("Deliver with Loohar"), "driver QR label missing");
  assert(workflow.includes("Order directly next time"), "customer reorder QR label missing");
  assert(workflow.includes("customerReorderUrl"), "customer reorder URL missing");
  assert(workflow.includes("driverAppDownload: driverDownload"), "driver app QR must use the download destination payload");
  assert(app.includes("ReceiptQr"), "receipt QR component missing");
  assert(app.includes("DriverAppDownloadPage"), "driver app download page missing");
}

function checkBranding() {
  assert(workflow.includes("receiptRestaurant(order)"), "receipt restaurant resolver missing");
  assert(workflow.includes("logoUrl"), "receipt branding logo missing");
  assert(workflow.includes("brandColor"), "receipt brand color missing");
  assert(app.includes("restaurant.logoUrl"), "frontend receipt logo rendering missing");
}

function checkContent() {
  assert(workflow.includes("receiptItems(order)"), "server receipt items missing");
  assert(workflow.includes("receiptTotals(order)"), "server receipt totals missing");
  assert(app.includes("receipt.text?.totals"), "frontend must render server totals text");
  assert(app.includes("modifiers"), "frontend modifier rendering missing");
  assert(app.includes("specialInstructions"), "frontend special instruction rendering missing");
}

function checkReprint() {
  assert(restaurantRoutes.includes("receipt.reprinted") || orderRoutes.includes("receipt.reprinted"), "reprint audit logging missing");
  assert(app.includes("reprint: true"), "frontend reprint action missing");
  assert(app.includes("receiptInfo.isReprint"), "frontend reprint stamp missing");
}

function checkTenantIsolation() {
  assert(restaurantRoutes.includes("id_restaurantId"), "restaurant receipt route must use compound restaurant/order lookup");
  assert(restaurantRoutes.includes("requireTenantAccess"), "restaurant receipt route must use tenant access middleware");
  assert(restaurantRoutes.includes("Tenant access denied"), "restaurant receipt route must reject cross-tenant access");
  assert(orderRoutes.includes("canReadOrder"), "public/order receipt route must verify order access");
}

function checkPublicToken() {
  assert(orderRoutes.includes("trackingToken"), "public receipt route must issue/use tracking token");
  assert(orderRoutes.includes("buildReceiptPayload"), "public receipt route must use server receipt payload");
  assert(workflow.includes("orderTrackingUrl"), "receipt payload must include a scoped order tracking URL");
  assert(!app.includes("Driver: Scan to accept and deliver this order"), "customer receipt UI must not expose a driver order-claim QR");
}

const checks = {
  all: () => {
    checkPrinting();
    checkQr();
    checkBranding();
    checkContent();
    checkReprint();
    checkTenantIsolation();
    checkPublicToken();
  },
  printing: checkPrinting,
  qr: checkQr,
  "driver-app-qr": checkQr,
  "customer-reorder-qr": checkQr,
  branding: checkBranding,
  content: checkContent,
  reprint: checkReprint,
  "tenant-isolation": checkTenantIsolation,
  "public-token": checkPublicToken,
  settings: checkPrinting
};

(checks[mode] || checks.all)();

if (process.exitCode) process.exit(1);
console.log(`Receipt QR ${mode} checks passed.`);
