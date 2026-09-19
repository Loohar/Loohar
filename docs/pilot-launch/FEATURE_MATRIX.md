# Feature Matrix — Pilot View

Evidence date 2026-09-19. Source: release candidate `4f69015` and `.pilot/state.json`.
"Code status" reflects what the code contains; "Certified" requires staging runtime evidence.

**Correction (2026-09-19):** the previous edition stated "Nothing in this table is STAGING
CERTIFIED yet." That is no longer true and understated readiness. Fifteen items now carry
SHA-tied staging runtime evidence — online card checkout with a tip, checkout idempotency, the
Prisma checkout defect, POS cashier workflow, offline POS reconciliation, privileged MFA,
storefront checkout and modifiers, reporting and daily reconciliation, receipts, register tips,
customer payment state and both Colorado tax onboarding fixes. Per-item certification state with
proof SHAs is authoritative in `.pilot/state.json`, not in this table.

Legend: Available · Partial · Planned · Blocked. Verified = confirmed by direct code check in
the control program; Reported = from the manual-drafting code review, not yet independently
re-verified.

| Domain | Capability | Code status | Pilot relevance | Notes / evidence |
| --- | --- | --- | --- | --- |
| Accounts | Registration & onboarding wizard | Partial / Available | Required | 12-step onboarding available; registration partial (Reported) |
| Accounts | Login, sessions, refresh | Available | Required | `test:auth-refresh`, auth session service |
| Tenancy | Tenant isolation | Available (app-level) | Required | Isolation suites pass; no DB-level RLS |
| Super Admin | Tenant list/edit/suspend, users, capabilities | Available | Required | Reported |
| Super Admin | Impersonation audit (reason/expiry/end) | Partial | Recommended | Reported |
| Super Admin | Platform-wide audit, registrations view | Planned (API only) | Recommended | Reported |
| Menu | Categories, items, modifiers | Available | Required | Server-authoritative modifier validation (L-02) |
| Tax | Location tax profile (Colorado TTR) | Partial | Required | Colorado only on main; national provider frozen |
| Online ordering | Quote, pickup | Available | Required | |
| Online ordering | Card checkout (Stripe Connect) | Partial | Required | L-05 fixed order creation; L-03 idempotency; not certified |
| Online ordering | Order tracking & receipt | Available | Required | Token-gated (L-01) |
| Payments | Stripe Connect onboarding (Accounts v2) | Available | Required | `test:stripe-connect-accounts-v2` |
| Payments | Webhooks | Available | Required | L-04 hardening, ledgers and settlement guards in candidate (`48c27e9`) |
| Payments | Refunds | Partial (API only, no UI) | Required | API idempotent, balance-capped, connected-account correct (L-07, `48c27e9`); no UI (L-16) |
| Payments | Platform (SaaS) billing | Partial | Recommended | In-app plan change not available (Reported); webhook event ledger in candidate (L-09) |
| Tips | Online tips | Partial | Required | POS tips not available (Reported) |
| POS | Register sign-in, cart, modifiers, hold/recall | Available | Required | POS suites pass |
| POS | Cash tender | Available in code | Required | Drawers now provisioned per main terminal with shared-drawer shifts (L-15, `48c27e9`); needs staging POS acceptance |
| POS | Card payments at register | Planned in UI | Out of pilot scope | API exists; no card tender UI (Reported) |
| POS | Staff PIN self-setup | Partial | Required | Reported: cashier cannot set own PIN in register (L-17) |
| POS | Receipt print by cashier | Partial | Required | Reported: preview limited to owner/admin/manager (L-17) |
| POS | Pay after send-to-kitchen | Partial | Required | Reported: sent order cannot be paid later at register (L-17) |
| POS | Voids, discounts, POS refunds | Planned | Recommended | Reported |
| POS | Offline mode | Partial (cash only) | Recommended | Reconciliation foundation, `test:pos-offline` |
| POS | Kiosk mode | Partial | Optional | Kiosk screen not linked for cashiers (Reported) |
| Printers | Auto-print | Planned | Recommended | Switches save but print nothing (Reported); browser print only |
| KDS | Kitchen display & status updates | Available | Required | Authenticated realtime rooms; `test:realtime-kds` |
| Delivery | Zones & fees | Partial | Required if delivery | Zones not enforced at quote (L-08, BLOCKED on geocoding provider) |
| Drivers | Driver app: today, accept, status, history | Available | Required if delivery | |
| Drivers | Claim safety | Available in candidate | Required if delivery | Race-safe claims and transitions (L-06, `48c27e9`) |
| Drivers | Claim QR on delivery slip, GPS, proof, payouts | Planned | Optional | Reported |
| Drivers | Offline app shows sample deliveries | Defect | Required if delivery | Reported (L-18) |
| Employees | Add/disable staff | Partial | Required | Starter plan has 0 employee seats (Verified: `entitlements.js`) — pricing decision |
| Reports | Sales/operations/analytics | Partial | Recommended | No export (Reported) |
| Multi-location | Location-scoped operations | Partial | Optional for pilot | |
| Notifications | Email | Available (provider-dependent) | Recommended | |
| Notifications | SMS | Planned | Optional | Logged only (Reported) |
| Website/SEO | Public restaurant site, sitemap/robots | Available | Recommended | |
| Operations | Health/version identity | Available | Required | `/health`, `/version`, `/version.json` |
| Operations | Monitoring, alerting, backups, runbooks | Blocked | Required | L-11 |
| AI | Operational intelligence | Planned | Out of pilot scope | |

Customer-facing manuals with per-section status live in
`/Users/rudrabishwokarma/Documents/Loohar/*_Manual/`.
