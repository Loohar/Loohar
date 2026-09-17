# Loohar — Claude Code Operating Instructions

Loohar is a multi-tenant restaurant SaaS + POS + restaurant operating platform
(npm workspaces: `apps/api` Express/Prisma/Postgres on Render, `apps/web`
Vite/React SPA on Vercel). Read these before doing anything:

1. `docs/pilot-launch/CONTROL_CENTER.md` — current program state, P0/P1, blockers, next task
2. `.pilot/state.json` — machine-readable state (SHAs, statuses, approvals)
3. `docs/business/LOOHAR_BUSINESS_CONSTITUTION.md` — business intent and non-negotiables
4. `docs/pilot-launch/SECURITY_MODEL.md` — security rules every change must respect

Repository and runtime evidence is implementation truth. The constitution is intent,
not proof that a feature exists.

## Autonomy boundaries

Allowed without asking: read/inspect anything; fetch; create isolated worktrees and
`fix/*`, `feat/*`, `chore/*` branches; implement, test, lint, build; commit locally;
push dedicated non-main branches when staging needs them; deploy to STAGING only;
narrow, reversible, staging-only configuration changes the architecture already supports;
Stripe TEST mode only; update docs and the control center.

Requires explicit owner approval — never do these autonomously:

- merge or push to `main`, force push, rewrite published history
- deploy production or change production Render/Vercel/Supabase/DNS/CORS/env vars
- production migrations or any production data mutation
- Stripe LIVE mode, real payments/refunds, merchant bank or live onboarding changes
- rotating secrets, purchases, pricing or contractual decisions
- merging the frozen national-tax work (`feature/loohar-national-tax-provider-v01`)

Production stays at the SHA recorded in `.pilot/state.json` until the owner approves a
release. When a production candidate is ready, stop and present a PRODUCTION RELEASE
CANDIDATE report (see `docs/pilot-launch/RELEASE_STATE.md`).

## Worktree rules

- The primary checkout `/Users/rudrabishwokarma/Documents/SaaS_Platform` holds the frozen
  national-tax branch. Never edit it.
- One worktree per change: `/Users/rudrabishwokarma/Documents/SaaS_Platform-<slug>`.
  Base new pilot work on the current candidate SHA in `.pilot/state.json`.
- Worktrees have no `node_modules`; clone an existing one with `cp -Rc <other>/node_modules .`
  (APFS clone) instead of `npm install`, so lockfiles and shared Prisma clients are untouched.

## Engineering rules

- The server determines monetary truth. Never let client prices/totals reach a payment amount.
- Every tenant-scoped read/write checks `restaurantId` against the authenticated context.
- Payment-creating endpoints must be idempotent; webhooks must verify signatures, fail
  closed, and deduplicate events.
- Migrations are additive and backward compatible with the previously deployed code.
- Match surrounding code style: ES modules, no TypeScript, test scripts in `scripts/*.mjs`
  registered in root `package.json` (add pilot-critical suites to the `test` aggregate).
- Prefer behavioural tests. DB-backed suites run only against a disposable local Postgres
  (`LOOHAR_TEST_DATABASE_URL` on 127.0.0.1); they refuse other hosts.
- Never run bare `prisma migrate`/`db push` or the `prisma:*` npm scripts: they read `apps/api/.env`,
  which may point at a shared database. For disposable databases set `DATABASE_URL` and
  `DIRECT_URL` inline to a `127.0.0.1` URL.

## Verification before commit

```
npm test                      # aggregate release suite
npm run lint
VITE_API_URL=https://loohar-api-staging.onrender.com/api \
VITE_REALTIME_URL=https://loohar-api-staging.onrender.com npm run build
npm run security:scan
npm audit --audit-level=high  # zero high/critical unless an exception is documented
(cd apps/api && npx prisma validate)
```

Relevant DB suites: `test:checkout-idempotency-db`, `test:stripe-webhook-hardening-db`.

## Deployment identity

- API: `GET /version`, `GET /health` (commitSha, environment, schema compatibility)
- Web: `GET /version.json`
- Production: `https://loohar-api.onrender.com`, `https://loohar.com`
- Staging API: `https://loohar-api-staging.onrender.com`
- Never claim an environment runs a SHA without reading these endpoints.

## Secrets

Never print or commit secrets, tokens, cookies, connection strings or env values.
Refer to env vars by name only. No customer PII in docs, logs, screenshots or tests.

## Documentation duties

After each meaningful milestone update: `docs/pilot-launch/CONTROL_CENTER.md`,
`.pilot/state.json`, `docs/pilot-launch/RELEASE_STATE.md`, and the Development Book at
`/Users/rudrabishwokarma/Documents/Loohar/Development_Book/LOOHAR_DEVELOPMENT_BOOK.md`
(regenerate its PDF with
`node /Users/rudrabishwokarma/Documents/Loohar/Development_Book/render-development-book.mjs`).

## Blocker policy

If work needs a human (Vercel/Render login, Stripe onboarding, hardware, legal, pricing,
missing credential), record it in the control center as BLOCKED with reason, evidence and
the exact human action, then continue with the next independent P0/P1.
