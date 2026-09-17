# Loohar Pilot Control Center

Last updated: 2026-09-17 10:00 UTC · Machine-readable twin: `.pilot/state.json`

Status vocabulary: NOT STARTED · IN PROGRESS · IMPLEMENTED (local) · PUSHED · STAGED ·
STAGING CERTIFIED · PRODUCTION · BLOCKED. No readiness percentages are used.

## 1. Identity (verified from live endpoints and git)

| Item | Value | Evidence |
| --- | --- | --- |
| Production API | `0526862` | `https://loohar-api.onrender.com/version` → production |
| Production web | `0526862` | `https://loohar.com/version.json` → production |
| origin/main | `0526862` | `git fetch origin` |
| Staging API | `4c48815` | `https://loohar-api-staging.onrender.com/version` → staging |
| Staging web | UNKNOWN | Vercel Deployment Protection; no authorised tooling |
| Pilot candidate | `48c27e9` on `fix/launch-pilot-review-fixes-v01` (pushed) | worktree `SaaS_Platform-review2-fixes-v01` |
| Frozen | `feature/loohar-national-tax-provider-v01` @ `1e0562b` | do not modify/merge |

Candidate chain on top of production `0526862`:
`2d85007` L-01 → `b291ddd` L-01 → `cfec6a4` L-01 → `a3262dc` L-01 → `4c48815` L-02 →
`0e69db3` L-05 → `7e0833a` L-03 → `47fa9cc` L-04 → `1d30522` L-03/L-04 review fixes →
`6d61d61` L-15 → `7304418` L-07 → `ca55a25` L-06 → `a8fdeff` L-09 → `48c27e9` second review fixes.

## 2. Current P0

| ID | Item | Status | Certification | Notes |
| --- | --- | --- | --- | --- |
| L-05 | Online checkout order creation fails Prisma validation | PUSHED (`0e69db3`) | not staged | **Every online card checkout fails before creating an order at 4c48815, and the same code is on production.** Reproduced on a disposable DB. Production impact not exercised (would mutate). |
| L-01 | Public order/payment access security | STAGED (API @ 4c48815) | BLOCKED | L-01C browser certification blocked: staging web SHA unverifiable, CORS denied; must be re-run on candidate 1d30522 because of L-05. |
| L-02 | Server-authoritative modifier validation | STAGED (API @ 4c48815) | pending L-01C | |
| L-03 | Checkout idempotency | PUSHED (`7e0833a`, `1d30522`) | not staged | Adds migration `20260916090000_checkout_idempotency` (additive). Web must deploy with or before API. |
| L-04 | Stripe webhook hardening | PUSHED (`47fa9cc`, `1d30522`) | not staged | Prerequisite: `STRIPE_WEBHOOK_SECRET` set wherever the legacy endpoint is registered. |
| L-11 | Monitoring, alerting, backup/restore proof, incident runbooks | BLOCKED | — | Needs owner access to Render/Supabase/alerting; no evidence in repo. |
| L-15 | Cash drawers could only be created by the development setup script; drawer ids not tenant-checked | PUSHED (`6d61d61`) | not staged | Main terminals now get a location drawer; drawer/register/location ids verified per restaurant; shared-drawer guard. |

## 3. Current P1

| ID | Item | Status | Evidence / notes |
| --- | --- | --- | --- |
| L-06 | Driver delivery claim race | PUSHED (`ca55a25`) | Also fixed driver-set base pay, re-claim reset of delivered orders, cross-tenant driver assignment. |
| L-07 | Refund idempotency | PUSHED (`7304418`) | Also fixed: refunds lacked `Stripe-Account` and could never succeed on direct charges; amounts ignored prior refunds. |
| L-08 | Delivery zone enforcement at quote | BLOCKED | Zones are radius-based and need geocoding (no provider in code). Minimum-order enforcement for fee rules is possible without it. |
| L-09 | Platform billing webhook event ledger | PUSHED (`a8fdeff`) | |
| L-10 | Prisma schema vs migration drift | NOT STARTED | Refund `idempotencyKey` now modelled; `PaymentQuote`, `PaymentReconciliationRecord`, other columns/indexes still unmodelled. |
| L-16 | Refunds have no restaurant UI | NOT STARTED | Verified; API now idempotent (L-07). |
| L-17 | POS cashier workflow gaps | NEEDS RUNTIME VERIFICATION | PIN API allows self-setup; UI flows (PIN, cashier receipt print, pay after send-to-kitchen) need staging POS acceptance. |
| L-18 | Driver app shows sample deliveries while offline | NOT STARTED (reported) | |
| L-20 | Stale PENDING refund sweep; dashboard-created refunds not mirrored | NOT STARTED (P2) | From review 2 |
| L-21 | Drawer creation race; platform checkout events after lease expiry | NOT STARTED (P2) | From review 2 (plausible) |

P2 / decisions: L-13 checkout replay may return a cancelled/expired PaymentIntent client secret;
L-14 client-supplied service fee/tips accepted (non-negative) — owner to confirm intent;
Starter plan has 0 employee seats (`config/entitlements.js`) — pricing decision.

P2: L-12 API CORS allowlist always merges production origins, so staging API accepts `https://loohar.com`.
L-19 `test:pos-enterprise` and `test:enterprise-pos-blockers` fail on production baseline too (not in `npm test`).

Earlier audit (`docs/LOOHAR_IMPLEMENTATION_READINESS_AUDIT.md`, 2026-07-29) items since
addressed in code: P0-01 socket auth (`authorizeSocket`), P0-02 tokenless status (L-01),
P0-08 webhook signature (L-04). Still open from that audit and relevant to pilot scope:
P0-03 live payment certification, P0-06 safe smoke suite, P0-07 DB-level tenant policy,
P0-09 operations, P1-01 printers, P1-06 manager approvals, P1-11 CI.

## 4. Blockers requiring a human

| Blocker | Evidence | Human action |
| --- | --- | --- |
| Staging deploy of candidate | No Render CLI/API key on this machine; Vercel CLI login is account `ssunuwar`, preview lives in team `subashsunar-8870s-projects` | Deploy `fix/launch-pilot-review-fixes-v01` @ `48c27e9` (or the latest candidate in state) to staging API and staging web, **or** provide a staging-scoped Render API key and Vercel team access for automation |
| Staging web identity | Preview returns 302 to Vercel SSO | Open `<preview>/version.json` while signed in and record `commitSha` in state |
| Staging CORS | `GET /health` with preview Origin → `403 CORS_ORIGIN_DENIED` | On `loohar-api-staging` only, append the exact preview origin of the deployed branch to `CORS_ORIGINS` (not first entry), restart. The Vercel branch alias changes with the branch name. |
| Legacy webhook secret | L-04 fails closed without it | Confirm `STRIPE_WEBHOOK_SECRET` exists on staging/production or that `/api/payments/webhook` is not registered in Stripe |
| Operations proof (L-11) | No monitoring/backup evidence in repo | Provide access or confirm Supabase PITR/backup plan, alert routing, on-call contact |
| Delivery zones (L-08) | No geocoding provider | Choose a maps/geocoding provider or constrain pilot delivery (pickup-only or manual radius check) |
| Starter plan employee seats | `USAGE_LIMIT.STAFF_MEMBERS` is 0 for Starter | Decide the pilot restaurant's plan / seat policy |
| `.claude/settings.json` refinement | Auto-mode classifier blocked edits to Claude settings | Owner may edit: replace deny `Read(./apps/api/.env.*)` with explicit files so `.env.example` stays readable |

## 5. Test status (candidate `48c27e9`, 2026-09-17)

`npm test` PASS · lint PASS · web build PASS · security scan PASS · `npm audit` 0 high/critical
(5 moderate) · `prisma validate` PASS · migrations apply to fresh Postgres 16.
DB suites (disposable Postgres): checkout-idempotency 9/9 · stripe-webhook-hardening 11/11 ·
pos-cash-drawer-setup 6/6 · refund-idempotency 10/10 · driver-claim-race 5/5 ·
platform-billing-webhook-ledger 3/3. Each suite was shown to fail on the commit before its fix.
Additional POS, payment, driver, tenant-isolation, KDS, billing and subscription suites pass.

Security reviews:
- `4c48815..47fa9cc`: no cross-customer access or client monetary authority; 2 medium + 3 low
  fixed in `1d30522`.
- `1d30522..a8fdeff`: 1 high (refund timeout could double refund), several medium (shared
  drawer clock-in regression, stale clock-out, revoke blocked, capped-refund replay, refund
  status never reconciled, concurrent platform events) and low items — all CONFIRMED items
  fixed in `48c27e9`. Remaining low/plausible: L-20, L-21.

## 6. Staging status

Staging API runs `4c48815` (healthy, schema ok). The candidate is **not** staged. No staging
checkout has succeeded; L-01C created 0 orders/PaymentIntents/refunds.

## 7. Restaurant #1 readiness (Loohar Restaurant, `loohar-restaurant`)

NOT READY. Required: candidate staged and identity-verified; one controlled Stripe TEST
checkout certified end to end (quote → order → PaymentIntent → payment → webhook → status →
receipt → KDS); refund certification; operations proof (L-11); owner/staff onboarding using
the manuals.

## 8. Approvals

| Decision | Status |
| --- | --- |
| Production release | NOT REQUESTED |
| Merge to main | NOT REQUESTED |
| Staging deploy of `1d30522` | Autonomously authorised, blocked on access |

## 9. Next autonomous task

L-10 schema drift reconciliation, then delivery minimum-order enforcement (L-08 partial).
Resume L-01C immediately when the candidate is staged and CORS allows the preview origin.
