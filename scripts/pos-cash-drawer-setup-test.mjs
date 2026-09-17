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

const service = readFileSync("apps/api/src/services/posService.js", "utf8");
const app = readFileSync("apps/web/src/App.jsx", "utf8");
const section = (start, end) => service.slice(service.indexOf(start), service.indexOf(end, service.indexOf(start)));
const openShiftSection = section("export async function openShift(", "export async function closeShift(");
const registerSection = section("export async function registerPosDevice(", "export async function updatePosDevice(");
const updateSection = section("export async function updatePosDevice(", "export async function setKioskMode(");

assertCheck(service.includes("async function ensureLocationCashDrawer(") && registerSection.includes("ensureLocationCashDrawer(prisma, { restaurantId, locationId })"), "Registering a main terminal provisions the location cash drawer");
assertCheck(updateSection.includes("ensureLocationCashDrawer(prisma, { restaurantId, locationId })"), "Updating a device to a main terminal provisions a drawer when none is assigned");
assertCheck(service.includes("where: { id: cashDrawerId, restaurantId, active: true }"), "Cash drawer references are scoped to the restaurant");
assertCheck(registerSection.includes("assertRestaurantLocation(prisma, restaurantId") && updateSection.includes("assertRestaurantLocation(prisma, restaurantId"), "Device location references are scoped to the restaurant");
assertCheck(openShiftSection.includes("resolveRestaurantCashDrawer(tx,") && openShiftSection.includes("assertRestaurantRegister(prisma, restaurantId") && openShiftSection.includes("assertRestaurantLocation(prisma, restaurantId"), "Shift clock-in validates drawer, register, and location ownership");
assertCheck(openShiftSection.includes("POS_CASH_DRAWER_IN_USE"), "A drawer already open on another shift cannot be reopened");
assertCheck(!openShiftSection.includes("where: { id: body.cashDrawerId }"), "Clock-in no longer updates a drawer by a client-supplied id alone");
assertCheck(!app.includes('cashDrawerId: deviceForm.deviceType === "MAIN_TERMINAL" ? firstCashDrawer?.id || null : null'), "POS device registration lets the server choose the location drawer");

if (failures.length) {
  console.error(`\n${failures.length} POS cash drawer setup check(s) failed.`);
  process.exit(1);
}
console.log("\nPOS cash drawer setup checks passed.");
