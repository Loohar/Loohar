## 25. Change records — 2026-09-19 to 2026-09-20

> Chapters 1–24 describe the platform at candidate `c5347da` (Edition 0.2) and have not been
> re-verified since. This chapter is current. Where they disagree, this chapter and
> `.pilot/state.json` are authoritative.

Release candidate moved `4f69015 → fd31866` (branch `release/loohar-pilot-rc-v01`). Production
stayed at `0526862` throughout and was never deployed, migrated or reconfigured.

### 25.1 Project recovery and permanent backup (2026-09-19)

**Problem.** The project record lived in four disconnected places and only Git was backed up. The
pilot-control branch had never been pushed (20 commits), and `~/Documents/Loohar/` (Development
Book, four manuals, all certification evidence) was not under version control, with Time Machine
unable to mount its destination.

**What was done.** All 24 landmark SHAs were resolved and confirmed reachable from origin; all
worktrees were clean. Twenty-two commits existed only on this machine and were pushed, so no
local-only commit remains. Three recovery tags were created. `docs/project-control/
LOOHAR_PROJECT_CONTINUITY.md` now lets a session with no memory reconstruct the platform, and
`docs/project-control/EVIDENCE_MANIFEST.md` describes the external archive with SHA-256 checksums.

**Limitations.** Copying the external archive into Git was blocked by a local permission
classifier, so it is described rather than backed up. The checksums exposed two real defects: the
`c5347da` authorization and KDS evidence files are byte-identical, so one of those certifications
has no surviving evidence; and the "current" Development Book PDF is byte-identical to the stale
`c5347da` edition.

### 25.2 Operations and alerting — L-11 (`470f2e8`, `c3159af`, `9256ce6`)

**Problem.** Staging logged `prisma:error` for every Stripe webhook redelivery the event ledger had
correctly deduplicated, because Prisma logs a failed query before the caller catches it. Loohar uses
unique-constraint violations for race-safe idempotency at eight call sites, so normal traffic looked
like database failure and log-based alerting would be either noisy or blind. Separately the
repository had no CI, and the browser render gate skipped silently when Playwright was absent.

**What was done.** Handled unique violations now log at info with only the constraint field names;
every other Prisma error still logs as an error, and an *unhandled* violation reaching the error
handler logs a warning with the route pattern (never the URL, which can carry tracking tokens).
`.github/workflows/ci.yml` runs lint, security scan, build, `npm test` and all `test:*-db` suites on
every push against a disposable Postgres, and a skipped gate fails the job.
`.github/workflows/uptime.yml` probes both APIs every ten minutes and opens an `incident` issue.
`docs/operations/RUNBOOKS.md` records inventory, triage, rollback targets, database outage, webhook
failures and secret exposure.

**Evidence.** Runtime test on a real database; fails on the previous commit. Render read evidence:
production 24 h at ~110 MB of 512 MB, CPU ~0, zero error logs in 31 h; deploy history with four
rollback targets. Uptime probe run against live services with a negative control.

**Limitation.** GitHub runs scheduled workflows only from the default branch, so the uptime monitor
becomes active when the release reaches `main`. Supabase backup/PITR evidence is still outstanding.

### 25.3 Dependency advisories (`d0dbbb7`)

`qs` 6.15.3, which Express uses to parse **every** request, carried an attacker-controlled denial of
service (GHSA-4mjr-xmp4-gh2g) and an array-limit bypass (GHSA-x5fp-wj9c-mxmx); `morgan` 1.11.0
carried log forging (GHSA-jxfw-x594-9x9m). Lockfile-only update to `qs` 6.16.0, `express` 4.22.3,
`body-parser` 1.20.8, `morgan` 1.12.1. `npm audit` went from five moderate advisories to zero. All
route-level suites were rerun. Verified on staging afterwards: array-style queries parse normally
and a prototype-pollution-shaped query is refused with 403.

### 25.4 Native POS and Driver apps (`5eb6093`, `402c4a7`)

**Architecture.** Capacitor 8.5.2 shells around the same web build: `com.loohar.pos` opens at
`/restaurant/pos`, `com.loohar.driver` at `/driver`. No second POS implementation, no new backend,
no client-side money. The bundle is packaged in the app so the POS starts without network.
Full detail: `docs/mobile/NATIVE_APPS.md`.

**Two defects found by building it.** The API discarded every non-http(s) origin, so the iOS app's
`capacitor://localhost` could never be allowed and *every* request from the app was refused with
403. And every main header is `position: sticky; top: 0`, so on iPhone the wordmark sat under the
clock and Dynamic Island. Both fixed: an exact two-origin allowance behind
`ALLOW_NATIVE_APP_ORIGINS`, and a safe-area rule scoped to native builds only.

**Credentials.** Tokens live in the iOS Keychain / Android Keystore, never WebView storage, loaded
before first render so the synchronous storage API still works; tokens from an earlier build migrate
once and are deleted. If the keystore cannot be opened the app fails closed to memory-only.

**Evidence.** Both apps build, install and launch on an iPhone 17 Pro simulator (iOS 26.2) and reach
staging: "Live API Connected". Real screenshots, no fabrication:
`~/Documents/Loohar/Evidence/native-apps/`. Extracting the CORS policy also left three startup log
lines referring to deleted variables, which would have thrown at listen time; the test now boots the
real API in production mode so that class of error cannot pass silently.

**Limitations.** Android is generated but not built (SDK licence is an owner step). Device and store
builds need Apple and Google signing. Printing inside the apps is unverified. Nothing is published.

### 25.5 Staging branch incident (2026-09-19, LOW)

Setting a staging environment variable through the Render tool triggered an automatic redeploy of
the service's **branch HEAD**, which was still the frozen national-tax branch, so staging served
that code for about three minutes. The build log shows `No pending migrations to apply` — its two
migrations had been applied to staging back in August — so no schema or data changed, and
production was never involved. Staging was restored by exact SHA. The hazard had been recorded an
hour earlier; the tool's side effect was not checked before use. The owner repointed the service to
`release/loohar-pilot-rc-v01` on 2026-09-20, which resolves it; confirmed in practice when the next
env change built the validated RC.

### 25.6 Staging web CORS (`796e830`)

The RC's own staging web preview was refused by the staging API (403 on preflight), which would have
blocked browser acceptance testing. `CORS_ORIGINS` cannot be read back through the deployment
tooling, so rewriting it risked dropping a live origin; `EXTRA_CORS_ORIGINS` was added as an
additive source subject to the same normalisation, exact matching and production wildcard refusal.
Verified on staging: the preview origin returns 204, a suffix-extended lookalike and unknown origins
still 403.

### 25.7 Checkout replay could hand back a dead PaymentIntent — L-13 (`fd31866`)

**Problem.** A replay returned the stored client secret without asking Stripe about it. Against a
cancelled intent the customer could only fail with an opaque Stripe error; after a successful
payment whose webhook had not yet settled, the replay invited a second confirmation.

**What was done.** A replay now reads the intent first, and only while the payment row still awaits
payment. Cancelled, or live for a mismatched amount: the stale intent is cancelled at Stripe so a
held secret cannot pay the wrong total, and a replacement is created under a key derived from the
intent it replaces, so concurrent replays produce one replacement. Processing, succeeded or awaiting
capture: kept, with no client secret returned. Healthy: unchanged. Stripe unreachable: the stored
secret is returned exactly as before. Amounts still come only from the persisted payment row.
Replacements are audited as `order_payment.intent.replaced`.

**Evidence.** `scripts/checkout-replay-intent-db-test.mjs`, six paths against a real database with a
Stripe fake supporting create, retrieve and cancel. Four fail on the previous commit; the healthy
and outage cases pass on both.

### 25.8 Gates at `fd31866`

lint · security scan · `npm test` including the browser render gate on all 8 authenticated surfaces
· 19 database suites, 144 tests, zero skips · `prisma validate`. No database migration was added by
any change in this chapter.

**Rollback.** Production is untouched at `0526862`; nothing here has been released. Staging rolls
back with `node scripts/deploy-staging.mjs <previous-sha>`.

**Next.** Supabase backup/PITR evidence (owner re-auth), the remaining financial P2 items (stale
pending refunds, drawer creation race, coupon usage-limit race), Android and signed app builds,
and an in-app sale certified on staging.
