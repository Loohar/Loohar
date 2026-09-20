// Resolves refunds left PENDING because their terminal webhook never arrived (L-20).
//
//   node scripts/refunds-sweep.mjs [--older-than-minutes 15] [--limit 100]
//
// Read-only against Stripe: it asks for each refund's current status and writes only that refund
// row's own status, and only while the row is still PENDING, so a webhook that arrives meanwhile
// always wins. It moves no money and creates no refunds. Safe to run repeatedly.
//
// Refunds with no provider refund id are never guessed: the create call may or may not have reached
// Stripe, so they are reported for a person to settle. Run it against the database the API uses.
import { sweepStalePendingRefunds } from "../apps/api/src/modules/orderPayments/refundSweep.js";
import { disconnectPrisma } from "../apps/api/src/config/prisma.js";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const olderThanMinutes = argument("older-than-minutes", 15);
const limit = argument("limit", 100);

const result = await sweepStalePendingRefunds({ olderThanMs: olderThanMinutes * 60 * 1000, limit });

console.log(`Refund sweep: pending older than ${olderThanMinutes} minutes`);
console.log(`  checked:       ${result.checked}`);
console.log(`  resolved:      ${result.resolved}`);
console.log(`  still pending: ${result.stillPending}`);
console.log(`  provider errors: ${result.errors}`);
if (result.needsReview.length) {
  console.log(`  NEEDS REVIEW:  ${result.needsReview.length} (balance stays reserved until a person decides)`);
  for (const item of result.needsReview) {
    console.log(`    refund ${item.refundId} restaurant ${item.restaurantId} ${item.amountCents} cents: ${item.reason}`);
  }
}
await disconnectPrisma();
process.exit(result.needsReview.length ? 2 : 0);
