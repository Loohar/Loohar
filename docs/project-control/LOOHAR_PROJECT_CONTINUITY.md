# Loohar Project Continuity

**Purpose.** This file lets a completely fresh session reconstruct Loohar with no conversation
memory. It contains no secrets. Where it disagrees with the code, the code is authoritative and
this file is stale — check `git log` and `.pilot/state.json` first.

**Last verified:** 2026-09-19 19:06 UTC (production, staging API and staging web identity re-read live; Render state read through the Render API).

---

## 1. What Loohar is

A multi-tenant restaurant SaaS, point-of-sale and restaurant operating platform. One deployment
serves many independent restaurants. Each restaurant gets online ordering, an in-store POS, a
kitchen display, delivery coordination with its own drivers, customer relationships, reporting
and a public website under its own brand.

Business intent is defined in `docs/business/LOOHAR_BUSINESS_CONSTITUTION.md`. Live program status
is `.pilot/state.json`. Neither may be used to claim implementation status that evidence does not
support.

---

## 2. Repositories, worktrees and branches

Single Git repository, `git@github.com:Loohar/Loohar.git` (private), checked out as **35 worktrees** (the primary checkout plus 34 linked) under
`/Users/rudrabishwokarma/Documents/` as of 2026-09-19.

| Path | Purpose |
| --- | --- |
| `SaaS_Platform` | Primary checkout. **Currently on the frozen national-tax branch — do not edit here.** |
| `SaaS_Platform-pilot-rc` | **Release-candidate worktree** (`release/loohar-pilot-rc-v01`, tracking origin). Created 2026-09-19. |
| `SaaS_Platform-reporting-v01` | On `feat/launch-basic-reporting-v01`. Earlier records called this the RC worktree; it never was, and the RC was only updated by refspec push. Do not integrate here. |
| `SaaS_Platform-pilot-control-v01` | Control/documentation worktree (`chore/loohar-pilot-control-v01`) |
| `SaaS_Platform-<feature>` | One worktree per fix/feature branch |

### Protected and frozen branches

- `main` — production line. **Never merge or push to it without explicit owner approval of an exact SHA.**
- `feature/loohar-national-tax-provider-v01` (`1e0562b`) — **frozen.** Contains the Avalara adapter
  and national provider work. Must not be casually merged, and the primary worktree checked out to
  it must not be edited. Any national provider requires independent sandbox certification before it
  replaces the working Colorado path.

### Current lines

| Branch | SHA | Meaning |
| --- | --- | --- |
| `main` | `0526862` | Production baseline |
| `release/loohar-pilot-rc-v01` | `3b2af70` | Release candidate. 2026-09-19 chain: log-noise fix, CI, uptime+runbooks, dependency advisories, native apps. Previous: `9256ce6`, `4f69015` |
| `chore/loohar-pilot-control-v01` | control docs | `.pilot/state.json`, `docs/pilot-launch/`, `docs/project-control/` |

Recovery tags: `recovery/2026-09-19-production-baseline`, `recovery/2026-09-19-staging-candidate`,
`recovery/2026-09-19-control-state`.

---

## 3. Environment topology and current identity

```
Browser (loohar.com, tenant sites, staff PWA, driver PWA)
   ├─► Vercel (apps/web)  ── rewrites /api/*, /health ─► Render API
   └─► Render loohar-api (apps/api) ── Prisma ─► Supabase Postgres
            ├─ Socket.IO (authenticated realtime, KDS)
            ├─ Stripe (platform account for SaaS billing; Connect accounts per restaurant)
            ├─ Supabase Storage (uploads)
            └─ Email provider (console or Resend)
```

| Environment | Component | SHA | Verified |
| --- | --- | --- | --- |
| Production | API `https://loohar-api.onrender.com` | `0526862bceb2dc3a483de96561755052076df060` | 2026-09-19 live |
| Production | Web `https://loohar.com` | `0526862bceb2dc3a483de96561755052076df060` (build 2026-09-02) | 2026-09-19 live |
| Staging | API `https://loohar-api-staging.onrender.com` | `3b2af70e272f1a36a2229a6413083522096fb134` | 2026-09-20 live, `/health` ok, schema 0 issues, `ALLOW_NATIVE_APP_ORIGINS=true`, `EXTRA_CORS_ORIGINS` set |
| Staging | Web (Vercel) | `9256ce67c73ae71245faee3ad9921e6ac98978f5` | 2026-09-19, Vercel `dpl_BeT8oDeUuJG7ACof8kHgqbMoRj6t` READY |

**Staging web project:** Vercel project `loohar-kds-staging`
(`prj_v8vjmqvV81R0O3pF6Tt3pFG9VtSQ`), scope `subashsunar-8870s-projects`
(`team_rWuRxAnjPlpBAk3uSjvgDNpX`), Vite, `live: false`, every deployment `target: null` (preview
only). `ssoProtection` is enabled for all except custom domains, so `/version.json` answers 302 to
an unauthenticated fetch. Deployment record for the current candidate `9256ce6` is
`dpl_BeT8oDeUuJG7ACof8kHgqbMoRj6t` (previous candidate `4f69015`: `dpl_G2h93En9zjS4X1MeGst8RNs1BZvM`).

**Account identities.** The owner's Vercel account is `subash.sunar@loohar.com`; it belongs to **no
Vercel team**. `subashsunar00@gmail.com` is the owner's Claude login and is not a Vercel identity.
Do not confuse them — an earlier blocker was misdiagnosed that way.

**Render.** Identity `subashsunar00@gmail.com` (unlike Vercel, the gmail address *is* the Render account), connected by OAuth through the official Render Claude Code plugin. Services are in **"My Workspace" `tea-d9813qurnols73an40fg`**; the workspace named "Loohar" is empty. Production `loohar-api` `srv-d9839fuq1p3s73fn8v8g`, staging `loohar-api-staging` `srv-d9n15gh42hec73emor9g`, both Oregon, starter, one instance, auto-deploy off. Staging tracks `release/loohar-pilot-rc-v01` (since 2026-09-20) with auto-deploy off; deploy it by exact SHA with `scripts/deploy-staging.mjs`.

**Supabase.** Organization "Loohar". Project `mgqeamdtcqhhcqqnyinb` ("Loohar", us-east-2) is inferred production; `ilazzxrscfoccvholchi` ("loohar-enterprise-pos-staging", us-west-2) is inferred staging. The mapping is **not yet confirmed** against each service's `DATABASE_URL` host. The Supabase MCP is configured `read_only=true`.

**Native apps.** Loohar POS (`com.loohar.pos`) and Loohar Driver (`com.loohar.driver`) are Capacitor shells in `apps/mobile/*` around the same web build. See `docs/mobile/NATIVE_APPS.md`. iOS simulator builds verified against staging. Android and signed store builds are owner-gated.

**Render env changes redeploy the service branch HEAD.** Since 2026-09-20 `loohar-api-staging` tracks `release/loohar-pilot-rc-v01`, so that redeploy builds the validated RC head. Auto-deploy stays off, so pushing the branch alone does not deploy. Before changing a staging env var, confirm the RC head is the SHA you want live. (On 2026-09-19, while the service still tracked the frozen national-tax branch, an env change deployed that branch to staging for three minutes; no migrations ran and no data changed.)

**CI.** `.github/workflows/ci.yml` runs every gate on every push with a disposable Postgres; a skipped gate fails. `.github/workflows/uptime.yml` probes both APIs every 10 minutes and opens an `incident` issue, active once on `main`. Runbooks: `docs/operations/RUNBOOKS.md`.

**Staging deploy credential** lives outside Git at `~/.loohar/staging.env`. Never print, echo, log,
commit, document or transmit it. `scripts/deploy-staging.mjs` reads it, refuses any target that is
not `loohar-api-staging`, waits for the exact SHA and checks production is unchanged.
`node scripts/deploy-staging.mjs --check` reports whether a usable credential is stored without
revealing it.

---

## 4. Codebase shape

| Area | Size |
| --- | --- |
| `apps/api/src` | 71 files, 22,282 lines — 17 routes, 26 services, 5 modules, 5 middleware (Express 4 + Socket.IO + Prisma 5) |
| `apps/web/src` | 35 files, 20,019 lines (Vite + React). **`App.jsx` alone is 15,934 lines** |
| `apps/shared` | Offline POS pricing, reserved slugs |
| Prisma | 68 models, 34 migrations |
| `scripts/` | ~140 files; 220+ `npm run test:*` entries |

The `App.jsx` monolith is a known review risk: a use-before-definition binding there white-screened
the whole restaurant dashboard and source-text tests did not catch it. That is why browser-level
render gates exist.

---

## 5. Money, Stripe, tax, tenancy, security

**Two separate money flows.** Loohar SaaS billing runs on the platform Stripe account. Diner
payments are Stripe Connect **direct charges on the restaurant's own connected account** — Loohar
does not take custody of restaurant revenue.

**Server-authoritative money.** Prices, modifiers, discounts, tax, tips, fees and totals are
computed server-side. A client-supplied price, modifier price, tax, total, refund balance or payment
state is never trusted. PaymentIntent amounts come from the persisted payment row. Checkout creation
and refunds require an `Idempotency-Key`; refunds are reserved under a payment row lock and capped
at the remaining balance. Stripe live keys are refused outside production.

Deleted item, void/cancel and refund are **distinct auditable concepts**. Offline cash is supported
under signed pricing proofs; offline card behaviour must not be invented.

**Tax.** United States scope, provider/adaptor based, currently the Colorado TTR path. Never
hardcode a rate. Never hardcode or guess a product/service category. Unresolved required tax
configuration **fails closed** — a fictional address is refused rather than defaulted. Completed
orders keep an immutable `OrderTaxSnapshot`.

**Tenancy.** `Restaurant` is the tenant boundary; routes compare the authenticated `restaurantId`
against the target record. Known gap: isolation is application-level, with **no database RLS**.

**Security.** JWT access tokens (15 min) with `AuthSession` refresh and session-version revocation.
TOTP MFA is mandatory for SUPER_ADMIN, TENANT_OWNER, RESTAURANT_OWNER, RESTAURANT_ADMIN and
RESTAURANT_MANAGER and cannot be disabled in production; secrets are AES-256-GCM under
`MFA_ENCRYPTION_KEY` and recovery codes are stored as HMACs. Webhooks verify HMAC signatures, fail
closed at 503 when a secret is missing, reject timestamps outside ±300 s, and settle through an
event ledger with conditional transactional claims. CORS uses an explicit allowlist; **never
wildcard, never arbitrary `*.vercel.app`, and never add an origin as the first entry.**

---

## 6. Capability status

**Certified on staging with runtime evidence (SHA-tied):** online card checkout with a tip
(order 688130 — client sent `totalCents: 1`, server charged 4982, Stripe 4982 = payment 4982 =
order 4982, webhook settled in ~4 s), checkout idempotency, the Prisma checkout defect, POS cashier
workflow, offline POS reconciliation including tampered-price refusal, privileged MFA
(enrollment, challenge, wrong code, out-of-window code, one-time recovery codes), storefront
checkout and modifiers, reporting and daily reconciliation, receipts, register tips, customer
payment state, and both Colorado tax onboarding fixes.

**Code on staging, certification not yet captured:** refund UI, itemized receipt email, KDS polling
fallback, Starter entitlements, subscription billing periods, Super Admin hardening, adversarial
tenant isolation.

**Not certified:** physical Stripe Terminal acceptance (simulated only), platform SaaS billing
webhooks (no staging secret), delivery zone enforcement (needs a geocoding provider), monitoring /
alerting / backup / PITR / runbooks.

Full per-item detail with proof SHAs is `.pilot/state.json` (51 items).

---

## 7. Blockers requiring the owner

| Blocker | Minimum owner action |
| --- | --- |
| **L-11 monitoring, alerting, backup/PITR, runbooks** — P0, cannot start | Render/Supabase read access |
| Stripe Connect onboarding | Complete the hosted TEST-mode flow once (~2 min) |
| Physical Terminal acceptance | Buy a reader; run `docs/pos/STRIPE_TERMINAL_PHYSICAL_ACCEPTANCE.md` |
| Staging web runtime evidence | Decide: protection-bypass secret, or briefly toggle SSO on the staging project |
| Delivery zones | Choose a geocoding provider (pilot is pickup-only until then) |
| Colorado category guidance | Decide what restaurants are told |
| Production release | Approve an exact SHA |

---

## 8. Procedures

**Test gates.** `npm test`, `npm run lint`, `npm run build`, `npm run security:scan`,
`npx prisma validate`, the `test:*-db` database suites, and `npm run test:web-surface-smoke` for
browser-level render checks. A new suite must be shown to fail against the pre-fix commit.
Source-text assertions alone never certify runtime behaviour.

**Staging deploy.** Confirm the exact full SHA and branch, review the diff and migration list, run
the secret scan and applicable tests, confirm the target is staging, then
`node scripts/deploy-staging.mjs`. Afterwards verify `/version`, `/health`, schema and migrations,
the exact SHA, the staging web SHA where applicable, and that production did not change; then
certify the affected workflows.

**Production release.** Never deploy production, promote a Vercel production deployment, mutate the
production database, run production migrations, change production environment variables or Stripe
configuration, create live financial objects, change DNS, or merge in a way that triggers a
production deploy — without the owner's explicit approval of the exact final SHA. When all gates
pass, stop and emit the report headed `LOOHAR PRODUCTION RELEASE CANDIDATE READY`, ending with
exactly: `Approve merge and production release of <EXACT FULL SHA>?`

**Production prerequisites for this candidate.** `MFA_ENCRYPTION_KEY` (production refuses MFA
without it; rotating it forces MFA resets), `STRIPE_WEBHOOK_SECRET`,
`STRIPE_CONNECT_WEBHOOK_SECRET`. Web deployed with or before the API (checkout `Idempotency-Key`).
Additive migrations `20260916090000_checkout_idempotency`, `20260917090000_privileged_mfa`,
`20260918090000_pos_terminal_readers`. Privileged users enroll MFA at next sign-in; the support path
is a Super Admin MFA reset.

**Rollback.** Redeploy `0526862`. The added columns and tables are ignored by the old code.

---

## 9. Where the record lives

| Location | Contents | In Git? |
| --- | --- | --- |
| `.pilot/state.json` | 51 tracked items with status, priority, certification and proof SHA | Yes |
| `docs/pilot-launch/` | Control centre, feature matrix, critical path, release state, architecture, security model | Yes |
| `docs/project-control/` | This file and `EVIDENCE_MANIFEST.md` | Yes |
| `docs/business/` | Business Constitution | Yes |
| `~/Documents/Loohar/` | Development Book (23 chapters), four manuals, Evidence archive, brand renderer — **45 files** | **No** |

The external archive is described, with checksums, in `docs/project-control/EVIDENCE_MANIFEST.md`.
Copying it into the repository was attempted on 2026-09-19 and blocked by the local permission
classifier, so it remains outside Git and outside any verified backup.

---

## 10. Launch target and next work

**Target:** pilot launch, Restaurant #1, end of September 2026.

Engineering is substantially complete and the money path is certified. The remaining critical path
is owner-side access and evidence, not code. **L-11 is the only P0 that cannot be started at all**,
and it is therefore the schedule.

**Next highest-priority engineering work, in order:** refresh the stale control documents against
`4f69015`; capture certification for the items already deployed to staging but uncertified;
recover or rerun the `c5347da` authorization/KDS evidence lost to the duplicate-file anomaly; then
work the P2 register (CORS allowlist merging production origins on staging, dead-PaymentIntent
replay, coupon usage-limit race, drawer creation race, stale PENDING refund sweep).
