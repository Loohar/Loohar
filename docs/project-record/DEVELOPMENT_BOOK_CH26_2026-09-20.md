## 26. Change records — 2026-09-20: money correctness and static analysis

Release candidate `fd31866 → 3b2af70`. Staging runs `3b2af70`; production is unchanged at
`0526862` and nothing here has been released. No database migration was added.

### 26.1 The API had no real linting (`e9cae3a`, L-59)

`apps/api`'s lint script was `node --check src/server.js`: a syntax check of one file out of 71. It
cannot see an undefined identifier, which is how a missing import passed lint the day before and
would only have thrown once a customer reached the checkout replay path. Demonstrated again:
`node --check` passes a file calling a function that was never imported; eslint reports it.

eslint now runs over the whole API with `no-undef` and `no-unused-vars`. `ignoreRestSiblings` keeps
the deliberate "destructure to drop" idiom that strips passwords, hashes and tenant internals out of
responses. Its first clean run found four pieces of dead code, including a **stale duplicate of
`segmentForCustomer`** in a route file while the live implementation lives in
`restaurantMetricsService.js` — a second copy of customer segmentation that could only drift.

### 26.2 Concurrent registration created two cash drawers (`43bfb40`, L-21)

`PosDevice` is unique per restaurant and fingerprint, so the device row never duplicated, but the
drawer was created *before* that constraint was reached. Reproduced: three concurrent registrations
produced three drawers, promoting a kiosk concurrently produced three, two tenants racing produced
two each — cash accountability rows no device pointed at.

The device row is now the serialization point. A drawer is created only after it exists and attached
under an optimistic condition; the loser deletes the empty drawer it just made. **The first version
of this fix still failed about one run in four and the test caught it**: a second caller that re-read
the device took the update path and wrote `cashDrawerId: null`, clobbering a drawer just attached.
The column is no longer written when this caller resolved no drawer. Verified 15 consecutive runs.

### 26.3 A coupon could be redeemed past its limit (`a765a83`, L-28 usage-limit half)

The limit was checked when the quote was priced; the counter was incremented, unconditionally, only
at settlement. Measured on a coupon limited to 10 with 25 concurrent redemptions:

| | redeemedCount |
| --- | --- |
| previous behaviour | **25** |
| fixed behaviour | **10** |

The increment is now one conditional statement, so the database caps it. Settlement is never failed
by this: the customer has already paid with the discount applied, so the payment stands and an
exhausted coupon is audited as `coupon.redeemed_beyond_limit` with `requiresReview`.

**Known limitation:** the gap between pricing a quote and settling is not a reservation, so more
orders can be *placed* with a coupon than the limit allows. A true reservation is the proper fix and
was not attempted. The remaining L-28 low findings (SVG upload blocklist, offline cash into closed
shifts, checkout customer by email, logout needing an unexpired token) are untouched.

### 26.4 Refunds could disagree with Stripe (`3b2af70`, L-20)

Two drifts, both fixed.

A refund raised in the Stripe dashboard was dropped by the webhook as `refund_not_found`. The money
had left the merchant account while Loohar still counted it as refundable and reported it as
collected. It is now mirrored from the provider's own object — amount, status and refund id, never a
caller-supplied figure — idempotently through the unique provider refund id, and audited as
`refund.mirrored_from_provider` with `requiresReview`.

A refund stuck PENDING stayed so for ever, and because the refundable balance reserves pending as
well as succeeded amounts, that money could never be refunded to the customer again.
`npm run refunds:sweep` asks the provider what happened and advances only rows still PENDING, so a
webhook arriving at the same time always wins. It is read-only against Stripe, moves no money and
creates no refunds. A refund with **no provider refund id is never guessed** — Stripe may or may not
have received the original request — so the balance stays reserved and a person decides, with the
runbook warning not to re-issue before checking Stripe. Runbook section 6a.

### 26.5 Gates at `3b2af70`

lint (both workspaces, API now genuinely linted) · security scan · `npm test` including the browser
render gate on all 8 authenticated surfaces · **22 database suites, 160 tests, zero skips** ·
`prisma validate`. Each fix has a regression test proven to fail on the previous commit.

**Rollback.** Nothing released; production is untouched at `0526862`. Staging rolls back with
`node scripts/deploy-staging.mjs <previous-sha>`.
