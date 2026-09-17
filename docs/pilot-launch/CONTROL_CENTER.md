# Loohar Pilot Control Center

Last updated: 2026-09-17 12:00 UTC · Machine-readable twin: `.pilot/state.json`

Status vocabulary: NOT STARTED · IN PROGRESS · IMPLEMENTED (local) · PUSHED · TESTED (local) ·
STAGED · STAGING CERTIFIED · PRODUCTION · BLOCKED · DEFERRED. No readiness percentages are used.

## 1. Identity (verified from live endpoints and git)

| Item | Value | Evidence |
| --- | --- | --- |
| Production API / web | `0526862` | `/version`, `/version.json` → production |
| origin/main | `0526862` | `git fetch origin` |
| Staging API | `4c48815` | `https://loohar-api-staging.onrender.com/version` |
| Staging web | UNKNOWN | Vercel Deployment Protection |
| Staging preview → staging API CORS | 403 `CORS_ORIGIN_DENIED` | live probe |
| Pilot candidate | `c5347da` on `fix/launch-review3-fixes-v01` (pushed) | worktree `SaaS_Platform-review3-fixes-v01` |
| Frozen | `feature/loohar-national-tax-provider-v01` @ `1e0562b` | do not modify/merge |

Candidate chain on production `0526862`: L-01 (`2d85007`,`b291ddd`,`cfec6a4`,`a3262dc`) →
L-02 `4c48815` → L-05 `0e69db3` → L-03 `7e0833a` → L-04 `47fa9cc` → review 1 `1d30522` →
L-15 `6d61d61` → L-07 `7304418` → L-06 `ca55a25` → L-09 `a8fdeff` → review 2 `48c27e9` →
MFA/auth `b383655` → authz/money `94f04b7` → L-10 `2f0f73c` → review 3 `c5347da`.

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
| L-01C | Real Stripe TEST staging checkout certification | BLOCKED (staging deploy access) |
| L-27 | POS card checkout (card-present) | BLOCKED (not implemented; owner scope/hardware decision) |
| L-11 | Monitoring, alerting, backup/restore proof, runbooks | BLOCKED (owner access) |

## 3. P1 / P2

| ID | Item | Status |
| --- | --- | --- |
| L-06 | Driver claim race | TESTED (local) |
| L-07 | Refund idempotency and connected-account refunds | TESTED (local) |
| L-09 | Platform billing webhook ledger | TESTED (local) |
| L-10 | Schema vs migration drift | TESTED (local) |
| L-08 | Delivery zone enforcement | BLOCKED (geocoding provider decision) |
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

## 5. Test status (candidate `c5347da`)

`npm test` PASS · lint PASS · build PASS · security scan PASS · `npm audit` 0 high/critical ·
`prisma validate` PASS. DB suites: mfa-auth 12/12, authz-money 7/7, checkout-idempotency 9/9,
stripe-webhook 11/11, refund 10/10, pos-cash-drawer 6/6, driver-claim 5/5,
platform-billing-ledger 3/3, schema drift PASS. Evidence:
`/Users/rudrabishwokarma/Documents/Loohar/Evidence/`.

## 6. Blockers requiring the owner

| Blocker | Minimum owner action |
| --- | --- |
| Staging deploy | Deploy `fix/launch-review3-fixes-v01` @ `c5347da` to staging API + web, or grant staging-only Render API access and Vercel team access |
| Staging configuration | On `loohar-api-staging` only: append exact preview origin to `CORS_ORIGINS`; add a new random `MFA_ENCRYPTION_KEY`; confirm Stripe TEST webhook secrets |
| POS card checkout | Decide: integrate a card-present terminal, or exclude POS card checkout from the pilot |
| Delivery zones | Choose a geocoding provider or restrict pilot delivery |
| Operations | Provide monitoring/backup access or confirm backup/PITR and alert routing |
| Plan seats | Decide Starter plan employee seats (currently 0) |

## 7. Deployment prerequisites for any release of this candidate

1. `MFA_ENCRYPTION_KEY` set (production refuses MFA without it) — generate once; rotating it forces MFA resets.
2. `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` set.
3. Web deployed with or before the API (checkout `Idempotency-Key`).
4. Migrations `20260916090000_checkout_idempotency`, `20260917090000_privileged_mfa` (additive).
5. Privileged users enroll MFA at next sign-in; support path is Super Admin MFA reset.

## 8. Restaurant #1 readiness

NOT READY — no staging certification, POS card scope undecided, operations unproven.

## 9. Next autonomous task

Resume L-01C (real Stripe TEST checkout on staging) as soon as staging access exists; meanwhile
P2 items L-28, L-20, L-21 in isolated worktrees on `c5347da`.
