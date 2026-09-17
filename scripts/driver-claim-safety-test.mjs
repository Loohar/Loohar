import { readFileSync } from "node:fs";

const failures = [];
function assertCheck(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    failures.push(message);
    console.error(`FAIL ${message}`);
  }
}

const driverRoutes = readFileSync("apps/api/src/routes/driver.js", "utf8");
const restaurantRoutes = readFileSync("apps/api/src/routes/restaurant.js", "utf8");
const claimRoute = driverRoutes.slice(driverRoutes.indexOf('router.post("/orders/:orderId/claim"'), driverRoutes.indexOf('router.patch("/orders/:orderId/status"'));
const assignRoute = restaurantRoutes.slice(restaurantRoutes.indexOf('"/:restaurantId/orders/:orderId/assign-driver"'), restaurantRoutes.indexOf("notifyDriverAssignment", restaurantRoutes.indexOf('"/:restaurantId/orders/:orderId/assign-driver"')));

assertCheck(driverRoutes.includes("where: { orderId: order.id, driverId: null, status: { notIn: FINISHED_DELIVERY_STATUSES } }"), "Driver claims use a conditional write so only one driver can win");
assertCheck(!claimRoute.includes("prisma.delivery.upsert"), "Driver claim no longer overwrites an existing delivery with upsert");
assertCheck(!driverRoutes.includes("req.body.baseEarningsCents"), "Claiming drivers cannot set their own base delivery pay");
assertCheck(claimRoute.includes("UNCLAIMABLE_ORDER_STATUSES.has(order.status)"), "Finished, rejected or cancelled orders cannot be claimed");
assertCheck(driverRoutes.includes("where: { id: delivery.id, driverId: delivery.driverId, status: delivery.status }") && driverRoutes.includes("DELIVERY_STATUS_CONFLICT"), "Delivery status transitions apply only from the state they were validated against");
assertCheck(assignRoute.includes("prisma.driver.findFirst({ where: { id: String(req.body.driverId || \"\"), restaurantId }") && assignRoute.includes("driverId: assignedDriver.id"), "Restaurants can only assign their own drivers");

if (failures.length) {
  console.error(`\n${failures.length} driver claim safety check(s) failed.`);
  process.exit(1);
}
console.log("\nDriver claim safety checks passed.");
