# Loohar Operations Runbooks

Facts here were verified against Render, Vercel, Supabase and the live endpoints on 2026-09-19.
Anything not yet verified is marked **UNVERIFIED**. Contains no secrets.

**Production is owner-gated.** Every production action below (deploy, rollback, restart, env
change, migration, database restore) requires the owner's explicit approval of an exact SHA or
action. Staging actions are within the engineering program's standing authority.

---

## 0. Inventory

| Thing | Production | Staging |
| --- | --- | --- |
| API URL | `https://loohar-api.onrender.com` | `https://loohar-api-staging.onrender.com` |
| Render service | `loohar-api` · `srv-d9839fuq1p3s73fn8v8g` | `loohar-api-staging` · `srv-d9n15gh42hec73emor9g` |
| Render workspace | "My Workspace" `tea-d9813qurnols73an40fg` (the workspace named "Loohar" is empty) | same |
| Region / plan / instances | Oregon · starter · 1 | Oregon · starter · 1 |
| Render auto-deploy | off (branch `main`) | off (see §7 hazard) |
| Migrations run | `preDeployCommand: npm run prisma:deploy:safe` | inside `buildCommand`, gated by `staging:db:identity` |
| Health check | `/health` | `/health` |
| Database (Supabase, org "Loohar") | project `Loohar` · `mgqeamdtcqhhcqqnyinb` · us-east-2 **(inferred, see note)** | project `loohar-enterprise-pos-staging` · `ilazzxrscfoccvholchi` · us-west-2 **(inferred, see note)** |
| Web | `https://loohar.com` (Vercel) | Vercel project `loohar-kds-staging`, preview-only, SSO-protected |

Note on databases: the staging/production mapping is inferred from project names, creation dates
and the staging-tooling timeline. It has not yet been confirmed against the `DATABASE_URL` host of
each Render service. Confirm it before any restore.

## 1. What healthy looks like

- `GET /health` → **200** with `ok: true` and `schema.ok: true`. It answers **503** when the schema
  check fails. That check is a live database query refreshed at most every 15 s, so a lost database
  shows up as 503 within about one refresh.
- `GET /version` → `commitSha` equals the expected SHA (production `0526862…` until the next approved release).
- Production baseline 2026-09-18/19: memory ≈ 110 MB of a 512 MB limit, CPU ≈ 0, zero
  error-level log lines in 31 h.

A `prisma:unique-constraint target=…` line at **info** is normal: it is a deduplicated webhook or
idempotent insert. A `prisma:error` line is a real database fault. An
`Unhandled unique constraint violation.` warning is a bug (a race nobody handled).

## 2. Alerting

| Signal | Mechanism | Status |
| --- | --- | --- |
| Instance fails its health check | Render health check on `/health`; Render replaces the instance | Active |
| Deploy fails | Render `notifyOnFail: default` (workspace notification setting) | Active; recipients not verified |
| API or database down, seen from outside | `.github/workflows/uptime.yml`, every 10 min, opens an `incident` issue and closes it on recovery | **Activates when merged to `main`** (GitHub runs schedules only from the default branch) |
| Every commit's gates | `.github/workflows/ci.yml` on every push | Active on push |
| Database backups / PITR | Supabase | **UNVERIFIED**, see §5 |

## 3. Triage an alert

1. `curl -s https://loohar-api.onrender.com/health | jq` and `…/version`.
2. 503 with `schema.ok: false` → database or schema problem, go to §5. No response at all → the
   service is down, go to step 3.
3. Render dashboard → `loohar-api` → **Events** (restarts, deploys, failures) and **Logs** filtered to
   level `error`.
4. Was there a deploy just before the alert? If yes, go to §4 (rollback).
5. Check `https://status.render.com`, `https://status.supabase.com` and `https://status.stripe.com`.

## 4. Roll back a bad deploy

Code rollback does **not** undo migrations. Every migration since `0526862` is additive (new nullable
columns or tables), so the previous code runs against the newer schema.

**Production (owner action):** Render → `loohar-api` → Deploys → choose the last good deploy →
**Rollback**. Known-good targets as of 2026-09-19:

| Deploy | SHA | Note |
| --- | --- | --- |
| `dep-dac5o9710e5c73bc0dd0` | `0526862` | current live baseline |
| `dep-da97it2jnfac73cunhe0` | `dc37c7b` | previous |
| `dep-da8fgr8ae00c73cpr53g` | `5505616` | trust-proxy fix |

After rollback, verify `/version` shows the target SHA and `/health` is 200.

**Staging (engineering):** `node scripts/deploy-staging.mjs <full-sha>` redeploys an exact SHA and
verifies it. The credential lives in `~/.loohar/staging.env` and is never printed.

## 5. Database outage or data loss

1. Confirm it is the database: `/health` 503 with `schema.ok: false`, and `prisma:error` lines
   mentioning `Can't reach database server` in the Render logs.
2. Check Supabase status and the project's health in the dashboard.
3. Connection exhaustion: the staging deploy guard requires the Supabase **session pooler**.
   Confirm production's `DATABASE_URL` uses the pooler before assuming a Supabase outage.
4. **Restore — UNVERIFIED.** Backup schedule, retention and point-in-time-recovery availability depend
   on the Supabase plan, and have not yet been read from the project. Until they are verified, no
   restore procedure here should be relied on. A restore drill on the staging project is required
   before the pilot.

## 6. Stripe webhooks failing

- Symptoms: payments stay `PENDING` after the customer paid; Stripe dashboard shows failed deliveries.
- A missing webhook secret fails closed with **503** (by design). Check `STRIPE_CONNECT_WEBHOOK_SECRET`
  and `STRIPE_WEBHOOK_SECRET` exist on the service. Never paste their values anywhere.
- Signature or timestamp problems return 400. The clock skew tolerance is ±300 s.
- Redeliveries are safe: the event ledger records each `providerEventId` once, and a duplicate of a
  processed event is acknowledged without reapplying effects. Resend failed events from the Stripe
  dashboard once the cause is fixed.
- Staging's platform-billing webhook has no secret configured, so it answers 503 by design (L-36).

## 7. Known configuration hazards

- **`loohar-api-staging` tracks branch `feature/loohar-national-tax-provider-v01`** (the frozen
  national-tax branch). Deploys are made by exact SHA, so staging correctly serves the release
  candidate. But clicking "Deploy latest commit" in the dashboard would ship unreviewed national-tax
  code to staging. Use `scripts/deploy-staging.mjs` only. The branch should be repointed to
  `release/loohar-pilot-rc-v01` (a Render service-settings change).
- Production runs one starter instance, so there is no redundancy. A crash means downtime until Render
  replaces the instance.

## 8. Suspected secret exposure

1. Rotate at the provider first (Stripe, Supabase, Render deploy hook, JWT or MFA keys). Rotating
   `MFA_ENCRYPTION_KEY` forces every privileged user to re-enroll MFA.
2. Update the Render environment variable. For production this is an owner action.
3. Redeploy so the process picks up the new value, then verify `/health`.
4. Record what was exposed, where, and when it was rotated.
