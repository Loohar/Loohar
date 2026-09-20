// A coupon's usage limit was checked when the quote was priced but incremented, unconditionally,
// only when the payment settled. Two settlements racing each other both incremented, so a coupon
// limited to N could finish above N, and once `redeemedCount` passed the limit the counter itself
// was wrong for every later quote and for redemption reporting.
//
// The increment is now a single conditional statement, so the database decides the winner:
// `redeemedCount` rises only while it is below the limit, and never past it. A coupon with no limit
// is unlimited as before.
//
// This is deliberately not allowed to fail a payment. By the time settlement runs the customer has
// already paid, with the discount applied, so the money is authoritative. When the limit is already
// exhausted the payment still settles and the caller records the over-redemption for review, rather
// than silently discarding it.
export async function redeemCouponOnce(client, { restaurantId, code }) {
  if (!restaurantId || !code) return { redeemed: false, reason: "missing_coupon" };
  const updated = await client.$executeRaw`
    UPDATE "Coupon"
       SET "redeemedCount" = "redeemedCount" + 1,
           "updatedAt" = NOW()
     WHERE "restaurantId" = ${restaurantId}
       AND "code" = ${code}
       AND ("usageLimit" IS NULL OR "redeemedCount" < "usageLimit")
  `;
  if (updated > 0) return { redeemed: true };

  // Either the coupon is gone, or its limit is already used up. Tell them apart so the audit is
  // accurate; both leave the payment settled.
  const coupon = await client.coupon.findFirst({
    where: { restaurantId, code },
    select: { id: true, usageLimit: true, redeemedCount: true }
  });
  if (!coupon) return { redeemed: false, reason: "coupon_missing" };
  return { redeemed: false, reason: "usage_limit_reached", couponId: coupon.id, usageLimit: coupon.usageLimit, redeemedCount: coupon.redeemedCount };
}
