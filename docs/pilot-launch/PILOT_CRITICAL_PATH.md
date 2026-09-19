# Pilot Critical Path

The ordered path from today's state to Restaurant #1 taking real orders. Each step names its
exit evidence. Steps are sequential unless marked parallel.

| # | Step | Owner | Depends on | Exit evidence | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Fix blocking checkout defects (L-05, L-03, L-04) | Engineering | — | Commits `0e69db3`, `7e0833a`, `47fa9cc`, `1d30522`; tests green | DONE (in RC `4f69015`) |
| 2 | Deploy candidate `1d30522` to staging API and staging web | Owner (access) | 1 | `/version` and `/version.json` show the candidate; `/health` schema ok | **DONE** — staging API and web both at `4f69015` (2026-09-19) |
| 3 | Staging configuration: exact preview origin in staging `CORS_ORIGINS`; `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` present (TEST mode) | Owner or automation with staging-scoped access | 2 | Preview origin → staging API allowed; unexpected origin denied | **DONE** — exact preview origin 200 + ACAO; unexpected origin 403 |
| 4 | L-01C staging checkout certification (one controlled Stripe TEST order for `loohar-restaurant`) | Engineering | 2, 3 | Evidence pack: merchant readiness, quote, order, PaymentIntent amount = server total, webhook → PAID, status/receipt token gating, KDS propagation, no secret leakage, retry returns same order (L-03) | **PASS** — order 688130 at `eaeff30`; client `totalCents: 1` refused, server charged 4982, Stripe = payment = order |
| 5 | Refund certification (one TEST refund) and L-07 refund idempotency | Engineering | 4 | Refund reconciled; double submit creates one refund | Code in RC and on staging; runtime certification pending a merchant with completed Connect onboarding |
| 6 (parallel) | L-06 driver claim race, L-08 delivery zone enforcement, L-09 platform billing ledger | Engineering | 1 | Tests incl. concurrency | DONE for L-06/L-09 (`test:driver-claim-race-db` 5/5, `test:platform-billing-webhook-ledger-db` 4/4); L-08 BLOCKED on a geocoding provider |
| 7 (parallel) | POS acceptance on pilot devices (register, cash, modifiers, receipts, KDS); requires L-15 restaurant cash drawer setup and L-17 cashier gaps resolved | Engineering + owner device access | 2, L-15 | Scripted acceptance run on staging with evidence | **PASS** at `9ad8708` — device registration, cashier PIN, wrong PIN refused, shift and drawer, tipped sale, KDS ticket, reporting |
| 8 | Operations: monitoring/alerts, backup/restore drill, incident runbooks, support contact (L-11) | Owner + engineering | — | Alert fired in test, restore drill record, runbooks in `docs/pilot-launch/` | **BLOCKED (P0)** — needs owner Render/Supabase access; cannot be started |
| 9 | Restaurant #1 onboarding checklist (menu, tax profile, Stripe Connect live onboarding by restaurant, staff, devices, printers) | Owner + restaurant | 4, 7 | Checklist signed off | NOT STARTED |
| 10 | Production release candidate report | Engineering | 4–9 | `RELEASE_STATE.md` candidate section complete | NOT STARTED |
| 11 | Owner approval and production release | Owner | 10 | Production `/version` = approved SHA; smoke checks | NOT STARTED |

> Refreshed 2026-09-19 against release candidate `4f69015`. The previous edition of this file
> still showed steps 2 and 3 as BLOCKED and step 4 as NOT STARTED, all of which had since been
> completed; it understated readiness.

Pilot constraints until proven otherwise: restaurant-managed delivery, browser printing,
no card-present terminals, Stripe Connect card-not-present online payments only after step 4.
