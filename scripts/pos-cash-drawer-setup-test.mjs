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

assertCheck(service.includes("async function usableDeviceCashDrawer(") && registerSection.includes("usableDeviceCashDrawer(prisma, {") && registerSection.includes("attachDeviceCashDrawer(prisma, {"), "Registering a main terminal keeps or provisions its own cash drawer");
assertCheck(updateSection.includes("usableDeviceCashDrawer(prisma, {") && updateSection.includes("attachDeviceCashDrawer(prisma, {") && updateSection.includes('body?.status !== "REVOKED"'), "Device updates provision drawers only when needed and never block revocation");
assertCheck(service.includes("cashDrawerId: device.cashDrawerId ?? null") && service.includes("claimed.count === 1"), "A drawer is attached under an optimistic condition so concurrent registrations cannot each leave one behind (L-21)");
assertCheck(service.includes("where: { id: cashDrawerId, restaurantId, active: true }"), "Cash drawer references are scoped to the restaurant");
assertCheck(registerSection.includes("assertRestaurantLocation(prisma, restaurantId") && updateSection.includes("assertRestaurantLocation(prisma, restaurantId"), "Device location references are scoped to the restaurant");
assertCheck(openShiftSection.includes("resolveRestaurantCashDrawer(tx,") && openShiftSection.includes("assertRestaurantRegister(prisma, restaurantId") && openShiftSection.includes("assertRestaurantLocation(prisma, restaurantId"), "Shift clock-in validates drawer, register, and location ownership");
assertCheck(openShiftSection.includes('SELECT id FROM "CashDrawer" WHERE id = ${drawer.id} FOR UPDATE') && openShiftSection.includes("joinsOpenDrawer"), "Clock-ins lock the drawer and join an open drawer without resetting its balance");
assertCheck(!openShiftSection.includes("where: { id: body.cashDrawerId }"), "Clock-in no longer updates a drawer by a client-supplied id alone");
assertCheck(!app.includes('cashDrawerId: deviceForm.deviceType === "MAIN_TERMINAL" ? firstCashDrawer?.id || null : null') && !app.includes("activeDevice.cashDrawerId || firstCashDrawer?.id"), "POS UI never sends another terminal's drawer");
const closeShiftSection = section("export async function closeShift(", "export async function ");
assertCheck(service.includes('POS_SHIFT_ALREADY_CLOSED') && service.includes('where: { id: shift.id, status: "OPEN" }'), "Only open shifts can be closed");

if (failures.length) {
  console.error(`\n${failures.length} POS cash drawer setup check(s) failed.`);
  process.exit(1);
}
console.log("\nPOS cash drawer setup checks passed.");
