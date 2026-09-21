## 31. Change records — 2026-09-21: the last L-28 finding, and what it was not

Release candidate `16d34a6 → 1361cc6`. Staging runs `1361cc6`; production untouched at `0526862`.
**L-28 is now closed**: coupon usage-limit race (`a765a83`), offline cash into a closed shift
(`0f93841`), SVG upload blocklist (`8edac79`), logout needing an unexpired token (`16d34a6`), and
checkout's customer record (`1361cc6`).

### 31.1 Checkout binds an order to a customer record by email (`1361cc6`, L-68)

**Why it matters.** Checkout attaches an order to the restaurant's customer record for that email,
which is how a returning guest keeps one history and their loyalty. Anyone can type someone else's
address, so the question was what a stranger reaches by doing it.

**What the boundaries turned out to be.** Tested rather than assumed, and they hold:

- `connectOrCreate` only writes fields when it *creates*, so an existing customer's name, phone and
  address are never rewritten by whoever typed the email.
- The checkout response carries the restaurant's details, not the customer's, so nothing about the
  existing person is read back — the L-01 tracking hardening covers this path too.
- Records are keyed by restaurant and email, so the same address in two restaurants is two separate
  records and neither restaurant sees the other's.

**What was actually missing.** Visibility. When the matched record belongs to a registered customer
account, a stranger's order joined a real person's profile silently. That is now recorded as
`order.anonymous_checkout_joined_customer_account` with `requiresReview`. An ordinary returning guest
with no account is not flagged, so the audit log keeps its meaning.

**Tests.** `scripts/checkout-customer-binding-db-test.mjs`, five cases against a real database. The
audit case fails on the previous commit; the other four write down boundaries that already held,
which is the point — an untested boundary is only an assumption.

**Residual, recorded not hidden.** An anonymous order still attaches to an existing profile, so a
stranger can add an order to someone's history. Separating guest orders from account-held records
needs a schema change to the restaurant-and-email uniqueness, which is not a change to make days
before a pilot.

**Gates.** lint · security scan · `npm test` with all 8 surfaces · **25 database suites, 172 tests,
zero skips** · staging at `1361cc6` with the native-origin certification re-run 20/20.

**Rollback.** Nothing released; production untouched at `0526862`.

**Next.** An XCUITest target so the native apps can be driven through their real UI, which is also
what will later drive a physical device.


## Changelog index
