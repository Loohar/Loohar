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

const orderService = readFileSync("apps/api/src/modules/orderPayments/orderPaymentService.js", "utf8");
const createStart = orderService.indexOf("tx.order.create({");
const createEnd = orderService.indexOf("include: orderInclude()", createStart);
const orderCreate = createStart >= 0 && createEnd > createStart ? orderService.slice(createStart, createEnd) : "";

// Prisma rejects mixing scalar foreign keys with nested relation writes in one create
// ("Argument `restaurant` is missing"), which made every online checkout fail before L-05.
assertCheck(Boolean(orderCreate), "Online checkout order creation block is present");
assertCheck(orderCreate.includes("customer: {") && orderCreate.includes("connectOrCreate"), "Online checkout creates or connects the customer through a nested relation");
assertCheck(orderCreate.includes("restaurant: { connect: { id: quote.restaurant.id } }"), "Online checkout connects the restaurant relation instead of writing restaurantId");
assertCheck(orderCreate.includes("location: { connect: { id: quote.locationId } }"), "Online checkout connects the location relation instead of writing locationId");
assertCheck(!/\n\s*restaurantId: quote\.restaurant\.id,/.test(orderCreate) && !/\n\s*locationId: quote\.locationId,/.test(orderCreate.split("items: {")[0]), "Online checkout order data does not mix scalar tenant/location foreign keys with relation writes");

if (failures.length) {
  console.error(`\n${failures.length} online checkout order creation check(s) failed.`);
  process.exit(1);
}
console.log("\nOnline checkout order creation checks passed.");
