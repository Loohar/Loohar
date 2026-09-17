# Loohar Pilot Control Center

Last updated: 2026-09-17 22:30 UTC · Machine-readable twin: `.pilot/state.json`

Status vocabulary: NOT STARTED · IN PROGRESS · IMPLEMENTED (local) · PUSHED · TESTED (local) ·
STAGED · STAGING CERTIFIED · PRODUCTION · BLOCKED · DEFERRED. No readiness percentages are used.

## 1. Identity (verified from live endpoints and git)

| Item | Value | Evidence |
| --- | --- | --- |
| Production API / web | `0526862` | `/version`, `/version.json` → production |
| origin/main | `0526862` | `git fetch origin` |
| Staging API | `bf7430a` (schema ok, separate DB from production) | `/version`, `/health` |
| Staging web | UNKNOWN — `loohar-git-fix-launch-review3-fixes-v01-loohar.vercel.app` behind Vercel SSO | `/version.json` 302 |
| Staging preview → staging API CORS | ALLOWED for exact origin; other origins 403 | live probe |
| Pilot candidate | `cebe5e3` on `fix/launch-review3-fixes-v01` (pushed, NOT yet on staging — Render does not auto-deploy) | worktree `SaaS_Platform-reporting-v01` |
| Frozen | `feature/loohar-national-tax-provider-v01` @ `1e0562b` | do not modify/merge |

Candidate chain on production `0526862`: L-01 (`2d85007`,`b291ddd`,`cfec6a4`,`a3262dc`) →
L-02 `4c48815` → L-05 `0e69db3` → L-03 `7e0833a` → L-04 `47fa9cc` → review 1 `1d30522` →
L-15 `6d61d61` → L-07 `7304418` → L-06 `ca55a25` → L-09 `a8fdeff` → review 2 `48c27e9` →
MFA/auth `b383655` → authz/money `94f04b7` → L-10 `2f0f73c` → review 3 `c5347da` → L-29/L-30/L-31
`8d427c5` → review `f8614e7` → Starter entitlements `aba7638` → fulfilment `849ab08` → review `97d4d02`
→ Stripe Terminal `d6a3fc3` → basic reporting `2410e0e` → Terminal review fixes `bf7430a`.

### Staging certification findings (2026-09-17)

- Server pricing holds on staging: a quote with client prices set to 1¢ returned subtotal 4140, tax 342
  (825 bps from the verified staging tax profile, not a hardcoded rate), tip 300, total 4782.
- One staging checkout order was created (order `cmu5tqkr60001105q8iqvmfv2`, total 4782, PaymentIntent
  created, `pk_test_` key) — L-05 confirmed fixed on staging.
- **L-29 (P0) found on staging:** the browser could never confirm that PaymentIntent (Stripe returns 404
  without the connected account). Fixed in `8d427c5`; awaiting staging redeploy.
- **Legacy webhook / dahlia:** subscription period dates are item-level on this API version; the code read
  top-level fields, so periods never updated (L-31). Fixed in `8d427c5` with tests on both webhook routes.

## 2. P0 status

| ID | Item | Status |
| --- | --- | --- |
| L-05 | Online checkout order creation broken | TESTED (local) |
| L-03 | Checkout idempotency | TESTED (local) |
| L-04 | Stripe webhook hardening | TESTED (local) |
| L-15 | Restaurant cash drawer setup and drawer scoping | TESTED (local) |
| L-22 | Privileged-role MFA | TESTED (local, incl. browser flow) |
| L-23 | Public registration → owner on any tenant (critical) | TESTED (local) |
| L-24 | Profile mass assignment and /staff escalation (critical) | TESTED (local) |
| L-25 | Order/payment lifecycle, webhook matching, POS card/cash/discount guards | TESTED (local) |
| L-01 / L-02 | Public order access / modifier authority | STAGED (API @ 4c48815), certification BLOCKED |
| L-01C | Real Stripe TEST staging checkout certification | **PASS** — real test payment on staging at `bf7430a`, 4782 reconciled end to end |
| L-29 | Web checkout Stripe.js connected account | **PASS** (staging: 404 without the account, 200 with it) |
| L-35 | Customer order status omitted payment state | TESTED (local), PUSHED |
| L-30 | Storefront modifiers + public payload allowlists | TESTED (local), PUSHED |
| L-33 | Starter plan: 5 seats, 1 register, 1 KDS (shared config) | TESTED (local), PUSHED — KDS browser sessions not device-bound |
| L-27 | POS card checkout (card-present, Stripe Terminal) | TESTED (local), PUSHED — physical acceptance is an owner step |
| L-34 | Basic reporting and daily reconciliation | TESTED (local), PUSHED |
| L-11 | Monitoring, alerting, backup/restore proof, runbooks | BLOCKED (owner access) |

## 3. P1 / P2

| ID | Item | Status |
| --- | --- | --- |
| L-06 | Driver claim race | TESTED (local) |
| L-07 | Refund idempotency and connected-account refunds | TESTED (local) |
| L-09 | Platform billing webhook ledger | TESTED (local) |
| L-10 | Schema vs migration drift | TESTED (local) |
| L-08 | Delivery safety | PARTIAL — fulfilment switches + address enforced; zones need geocoding provider; Starter pilot is pickup-only |
| L-31 | Subscription periods on Stripe basil/dahlia | TESTED (local), PUSHED |
| L-32 | Storefront defaults (pickup, no demo customer) | TESTED (local), PUSHED |
| L-16 | Refund UI | NOT STARTED |
| L-17 | POS cashier workflow gaps | NEEDS RUNTIME VERIFICATION (staging POS acceptance) |
| L-18 | Driver app offline sample data | NOT STARTED |
| L-26 | Refresh tokens in localStorage | DEFERRED — cookie session redesign; no XSS sink found in audits |
| L-12 | CORS allowlist merges production origins on staging | NOT STARTED (P2) |
| L-13 | Checkout replay may return a dead PaymentIntent | OPEN (P2) |
| L-14 | Client-supplied service fee | FIXED (server ignores it) |
| L-19 | Two POS suites outside `npm test` fail on production baseline too | OPEN (P2) |
| L-20 / L-21 | Stale PENDING refund sweep / drawer creation race | OPEN (P2) |
| L-28 | Coupon limit race, SVG blocklist, offline cash into closed shift, checkout customer by email, logout needs live access token | OPEN (P2) |

## 4. Security work completed this cycle

Adversarial audits: authentication/sessions, authorization/tenancy/realtime, money/input.
Change reviews: 3. Confirmed critical findings fixed: 3 (public registration escalation, profile
mass assignment, /staff escalation). Confirmed high/medium findings fixed: all except L-26
(deferred with justification). Full table: Development Book §18.

## 5. Test status (candidate `bf7430a`)

`npm test` PASS · lint PASS · build PASS · security scan PASS · `prisma validate` PASS. DB suites:
checkout-idempotency 10/10, stripe-webhook 12/12, refund 10/10, driver-claim 5/5, platform-billing-ledger 4/4,
mfa-auth 12/12, authz-money 7/7, schema drift PASS, online-fulfillment 4/4, starter-entitlements 6/6,
storefront-checkout 10/10, basic-reporting 5/5, pos-terminal 19/19, pos-cash-drawer 6/6. Every new suite was
run against the pre-fix code and failed. Adversarial reviews of `8d427c5`, `aba7638` and `d6a3fc3` completed;
all findings fixed except the recorded KDS limitation. The Terminal review found two critical money defects
(a stale PaymentIntent after a total change, and cash settling an order with a live card payment); both are
fixed in `bf7430a` with tests that fail on the previous commit.

## 6. Blockers requiring the owner

| Blocker | Minimum owner action |
| --- | --- |
| Staging redeploy | Redeploy `loohar-api-staging` from `fix/launch-review3-fixes-v01` at `bf7430a` (no new env vars; the pre-deploy step applies the additive migration `20260918090000_pos_terminal_readers`); confirm the Vercel preview for that branch rebuilt |
| Staging web identity | Signed in to Vercel, open the preview `/version.json` and confirm `97d4d02` + staging API target, or grant the loohar team read access |
| Staging evidence accounts | Create staging-only privileged accounts yourself (never share passwords in chat) for MFA/refund/KDS/POS evidence |
| POS card-present | Buy a Stripe Terminal reader and run the on-site acceptance in `docs/pos/STRIPE_TERMINAL_PHYSICAL_ACCEPTANCE.md` (the simulated workstream is done) |
| Delivery zones | Choose a geocoding provider; until then Starter pilot is pickup-only |
| Operations | Monitoring/backup access or confirmation of backup/PITR and alert routing |

## 7. Deployment prerequisites for any release of this candidate

1. `MFA_ENCRYPTION_KEY` set (production refuses MFA without it) — generate once; rotating it forces MFA resets.
2. `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` set.
3. Web deployed with or before the API (checkout `Idempotency-Key`).
4. Migrations `20260916090000_checkout_idempotency`, `20260917090000_privileged_mfa` (additive).
5. Privileged users enroll MFA at next sign-in; support path is Super Admin MFA reset.

## 8. Restaurant #1 readiness

NOT READY — online card checkout is now certified on staging with a real Stripe TEST payment, but
privileged staging evidence (MFA, KDS, POS, refunds) is still to be captured, POS card-present is
certified only with simulated readers, and operations (monitoring, backups, runbooks) are unproven.

## 9. Next autonomous task

After the staging redeploy: pay the existing staging order with a Stripe TEST card, verify webhook settlement,
tracking, reconciliation (4782 everywhere) and legacy subscription periods, then rehearse a simulated
Terminal sale on staging. Remaining local work: tips/voids/refund UI, KDS device binding, offline POS and
performance evidence, Super Admin, backups and monitoring.
