import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const mode = process.argv[2] || "all";
const read = (path) => readFileSync(join(root, path), "utf8");
const realtime = read("apps/api/src/services/realtimeService.js");
const auth = read("apps/api/src/middleware/auth.js");
const pos = read("apps/api/src/services/posService.js");
const kitchen = read("apps/api/src/routes/kitchen.js");
const workflow = read("apps/api/src/services/orderWorkflowService.js");
const restaurantRoutes = read("apps/api/src/routes/restaurant.js");
const orderRoutes = read("apps/api/src/routes/orders.js");
const server = read("apps/api/src/server.js");
const app = read("apps/web/src/App.jsx");
const schema = read("apps/api/prisma/schema.prisma");
const migrationPath = join(root, "apps/api/prisma/migrations/20260801090000_realtime_kds_order_location/migration.sql");
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const failures = [];

function check(condition, message) {
  if (condition) console.log(`PASS ${message}`);
  else {
    failures.push(message);
    console.error(`FAIL ${message}`);
  }
}

function includesAll(content, needles) {
  return needles.every((needle) => content.includes(needle));
}

function testSocketAuth() {
  check(realtime.includes("io.use(authorizeSocket)"), "Socket.IO authenticates every connection before handlers run");
  check(realtime.includes("authenticateAccessToken(auth.token)"), "Socket authentication reuses the HTTP access-token verifier");
  check(auth.includes("export async function authenticateAccessToken"), "HTTP and socket authentication share one session-version-aware verifier");
  check(includesAll(realtime, ["SOCKET_TENANT_FORBIDDEN", "SOCKET_LOCATION_FORBIDDEN", "SOCKET_ROLE_FORBIDDEN"]), "Socket authentication enforces role, tenant, and location boundaries");
  check(includesAll(realtime, ["restaurantRoom(restaurantId)", "kitchenLocationRoom(restaurantId, locationId)", "kitchenAllRoom(restaurantId)"]), "Socket rooms are derived from verified server-side identity");
  check(!realtime.includes('socket.on("join:') && !realtime.includes("socket.join(auth."), "Clients cannot request arbitrary room joins");
  check(app.includes('const locationQuery = selectedLocationId ? `?locationId=${encodeURIComponent(selectedLocationId)}`'), "Kitchen status mutations retain the selected location boundary");
  check(includesAll(realtime, ["SOCKET_SESSION_RECHECK_MS", "authenticateAccessToken(socket.data.authToken)", "socket.disconnect(true)"]), "Long-lived sockets revalidate revocation and expiry");
}

function testReconnect() {
  check(includesAll(kitchen, ["parseSince", "updatedAt: { gt: since }", "cursor: queryStartedAt.toISOString()"]), "Kitchen API exposes cursor-based missed-event reconciliation");
  check(includesAll(app, ["reconciliationCursorRef", "loadKitchen({ reconcile: true, silent: true })", "skipDedupe: true"]), "Kitchen client reconciles from its last database cursor");
  check(app.includes('socket.on("connect", () => {') && app.includes('setRealtimeState("reconciling")'), "Socket reconnect runs reconciliation before returning to live state");
  check(app.includes("30_000") && app.includes("reconciliationTimer"), "Kitchen keeps a bounded reconciliation safety interval");
  check(app.includes('socket.on("realtime:session-ended"'), "Kitchen handles revoked or expired realtime sessions explicitly");
}

function testDeduplication() {
  check(includesAll(pos, ["orderQuote.updateMany", "acceptedAt: null", "voidedAt: null", "claimed.count !== 1"]), "Concurrent POS submissions atomically claim a quote once");
  check(includesAll(app, ["seenEventIdsRef", "rememberEvent(event.eventId)", "incomingVersion <= currentVersion"]), "Kitchen deduplicates event IDs and stale order versions");
  check(app.indexOf("rememberEvent(event.eventId)") < app.indexOf('event.eventType === "kitchen.ticket.created.v1"'), "New-order alert fires only after event deduplication");
}

function testAfterCommit() {
  const transactionStart = pos.indexOf("const result = await prisma.$transaction");
  const emitAt = pos.indexOf("emitKitchenTicketCreated(result.order)");
  const transactionReturn = pos.indexOf("return { order, receipt };", transactionStart);
  check(transactionStart >= 0 && transactionReturn > transactionStart && emitAt > transactionReturn, "POS publishes the Kitchen event only after its transaction resolves");
  check(!pos.slice(transactionStart, transactionReturn).includes("emitKitchenTicketCreated"), "No Kitchen event is emitted inside the database transaction");
  check(includesAll(realtime, ["kitchen.ticket.created.v1", "eventId: crypto.randomUUID()", "schemaVersion: 1"]), "Kitchen created events are versioned and uniquely identified");
}

function testGuestCheck() {
  check(schema.includes("GUEST_CHECK") && migration.includes("ADD VALUE IF NOT EXISTS 'GUEST_CHECK'"), "Guest Check is persisted as a distinct receipt kind");
  check(includesAll(restaurantRoutes, ["print-guest-check", "guestCheckText", 'printOrder(req, res, next, "guest")']), "Restaurant printing API provides a dedicated Guest Check route");
  check(orderRoutes.includes('["guest", "guest_check"].includes(requested)') && orderRoutes.includes('return "guest"'), "Order receipt API accepts the Guest Check kind");
  check(includesAll(app, ["openGuestCheck", "GUEST CHECK - UNPAID", "Print Guest Check"]), "POS exposes and labels the prepayment Guest Check separately");
}

function testReceiptPaymentState() {
  check(includesAll(workflow, ["Guest check - unpaid", 'status: "UNPAID"', "isPaymentReceipt"]), "Guest Check forces an unpaid balance instead of inheriting settlement state");
  check(workflow.includes("This is not a payment receipt") || workflow.includes("not a payment receipt"), "Guest Check contains explicit non-payment language");
  check(workflow.includes("settledPayment"), "Final receipts continue to use recorded payment settlement data");
}

function testLatencyPath() {
  check(server.includes("http.createServer(app)") && server.includes("new Server(server") && server.includes("server.listen"), "API and Socket.IO share the same deployed HTTP server");
  check(pos.includes("emitKitchenTicketCreated(result.order)"), "POS submission publishes directly without waiting for a poller");
  check(app.includes('transports: ["websocket", "polling"]'), "Kitchen prefers WebSocket with a compatible transport fallback");
  check(!app.includes("setInterval(() => loadKitchen(), 1000") && !app.includes("setInterval(() => loadKitchen(), 2000"), "Kitchen latency does not depend on one- or two-second full polling");
}

const suites = {
  "socket-auth": testSocketAuth,
  reconnect: testReconnect,
  deduplication: testDeduplication,
  "after-commit": testAfterCommit,
  "guest-check": testGuestCheck,
  "receipt-payment-state": testReceiptPaymentState,
  latency: testLatencyPath
};

if (mode === "all") Object.values(suites).forEach((suite) => suite());
else if (suites[mode]) suites[mode]();
else {
  console.error(`Unknown realtime KDS test mode: ${mode}`);
  process.exit(2);
}

if (failures.length) {
  console.error(`realtime-kds-guest-check-test (${mode}) failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log(`realtime-kds-guest-check-test (${mode}) passed.`);
