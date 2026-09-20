// L-28: a coupon's usage limit must hold under concurrent redemption.
//
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db \
//   node --test scripts/coupon-usage-limit-db-test.mjs
//
// The limit was checked when the quote was priced and the counter incremented, unconditionally, only
// when the payment settled. Concurrent settlements each incremented, so a coupon limited to N could
// end above N, and a `redeemedCount` past the limit made every later quote and the redemption report
// wrong. Settlement never fails here: by then the customer has already paid with the discount.
import assert from "node:assert/strict";
import { after, test } from "node:test";

const databaseUrl = process.env.LOOHAR_TEST_DATABASE_URL || "";
const host = (() => {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
})();
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.log("SKIP coupon usage limit DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, NODE_ENV: "test", JWT_SECRET: "local-coupon-race-secret" });

const { prisma } = await import("../apps/api/src/config/prisma.js");
const { redeemCouponOnce } = await import("../apps/api/src/services/couponRedemption.js");

const runId = `l28${Date.now().toString(36)}`;
let shopCount = 0;
async function seedShop(code, usageLimit) {
  shopCount += 1;
  const restaurant = await prisma.restaurant.create({
    data: { name: `L28 ${shopCount}`, slug: `${runId}-${shopCount}`, status: "ACTIVE" }
  });
  const coupon = await prisma.coupon.create({
    data: { restaurantId: restaurant.id, code, type: "FIXED_DISCOUNT", amountOffCents: 500, usageLimit, active: true }
  });
  return { restaurant, coupon };
}
const readCoupon = (id) => prisma.coupon.findUnique({ where: { id } });

after(async () => {
  await prisma.$disconnect();
});

test("concurrent redemptions never push a coupon past its usage limit", async () => {
  const { restaurant, coupon } = await seedShop("RACE10", 10);
  const attempts = 25;
  const results = await Promise.all(
    Array.from({ length: attempts }, () => redeemCouponOnce(prisma, { restaurantId: restaurant.id, code: "RACE10" }))
  );

  const redeemed = results.filter((result) => result.redeemed).length;
  const refused = results.filter((result) => result.reason === "usage_limit_reached").length;
  const stored = await readCoupon(coupon.id);

  assert.equal(stored.redeemedCount, 10, `the counter must stop at the limit, saw ${stored.redeemedCount}`);
  assert.equal(redeemed, 10, `exactly the limit may be redeemed, saw ${redeemed}`);
  assert.equal(refused, attempts - 10, "every other attempt reports the limit, so the caller can flag it for review");
});

test("a coupon with no usage limit stays unlimited", async () => {
  const { restaurant, coupon } = await seedShop("UNLIMITED", null);
  const results = await Promise.all(
    Array.from({ length: 12 }, () => redeemCouponOnce(prisma, { restaurantId: restaurant.id, code: "UNLIMITED" }))
  );
  assert.equal(results.every((result) => result.redeemed), true);
  assert.equal((await readCoupon(coupon.id)).redeemedCount, 12);
});

test("redemption is scoped to its own tenant", async () => {
  const mine = await seedShop("SHARED", 1);
  const theirs = await seedShop("SHARED", 1);

  const result = await redeemCouponOnce(prisma, { restaurantId: mine.restaurant.id, code: "SHARED" });
  assert.equal(result.redeemed, true);
  assert.equal((await readCoupon(mine.coupon.id)).redeemedCount, 1);
  assert.equal((await readCoupon(theirs.coupon.id)).redeemedCount, 0, "another restaurant's coupon with the same code is untouched");

  const second = await redeemCouponOnce(prisma, { restaurantId: mine.restaurant.id, code: "SHARED" });
  assert.equal(second.redeemed, false);
  assert.equal(second.reason, "usage_limit_reached");
  assert.equal(second.usageLimit, 1);
});

test("a missing coupon is reported rather than silently ignored", async () => {
  const { restaurant } = await seedShop("PRESENT", 1);
  const result = await redeemCouponOnce(prisma, { restaurantId: restaurant.id, code: "NOT-A-COUPON" });
  assert.equal(result.redeemed, false);
  assert.equal(result.reason, "coupon_missing");
});

test("an already exhausted coupon is refused without moving the counter", async () => {
  const { restaurant, coupon } = await seedShop("EXHAUSTED", 2);
  await prisma.coupon.update({ where: { id: coupon.id }, data: { redeemedCount: 2 } });
  const result = await redeemCouponOnce(prisma, { restaurantId: restaurant.id, code: "EXHAUSTED" });
  assert.equal(result.redeemed, false);
  assert.equal(result.reason, "usage_limit_reached");
  assert.equal((await readCoupon(coupon.id)).redeemedCount, 2, "a refused redemption never changes the count");
});

test("a counter already past its limit is never pushed further", async () => {
  // Historical data can already be over the limit, from before the conditional increment existed.
  const { restaurant, coupon } = await seedShop("OVER", 3);
  await prisma.coupon.update({ where: { id: coupon.id }, data: { redeemedCount: 7 } });
  const result = await redeemCouponOnce(prisma, { restaurantId: restaurant.id, code: "OVER" });
  assert.equal(result.redeemed, false);
  assert.equal((await readCoupon(coupon.id)).redeemedCount, 7);
});
