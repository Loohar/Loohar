## 34. Change records — 2026-09-23: the first production release since the freeze

Production moves `0526862 → 15a1f14`. API, `loohar.com` and `main` all run the same SHA.

### 34.1 What went out

`0526862` had been frozen since 2026-09-02. The release carries 70 commits: the money-correctness
work (stale pending refunds, the drawer-creation race, the coupon usage-limit race, closed-shift
cash, checkout replay intents, anonymous-checkout customer binding), privileged-role MFA, the SVG
upload allowlist, logout with an expired token, native-app CORS, the API ESLint gate that did not
previously exist, CI, and two fixes made on release day.

**Card payments are deliberately not part of this release.** They fail closed and cannot be reached
by accident: the POS requires `cardPaymentsEnabled` on the device, which defaults to false, and
online checkout calls `readyMerchantFor()`, which refuses before any money path unless the
restaurant's Stripe Connect account is fully onboarded. Cash is certified end to end. Card,
Terminal and refunds are the next phase.

### 34.2 Two fixes made before shipping

**A used-up plan limit was being reported as a missing feature (L-70).** A Starter restaurant using
its one POS register and adding a second was told *"POS register is not included in the current
plan. Required plan: Professional."* Both halves were false: `FEATURE_REQUIRED_PLAN[POS_REGISTER]`
is `STARTER`, so the feature is included and they were using it, and the remedy might be to retire
a register rather than pay more. `normalizedPosError` keyed only on `upgradeRequired`, which both a
feature gate and a usage limit set, then filled the missing fields with "POS register" and a
hardcoded "Professional" — so *every* usage limit in the register, including staff seats and menu
items, was misreported as a missing feature. This is money-adjacent: it pushes an upgrade on a false
premise.

The logic moved to `apps/web/src/shared/posErrorMessage.js` so a test can execute it rather than
read it, and `nextPlanRaisingLimit()` now only offers an upgrade when a higher plan would genuinely
lift that limit — hitting the register limit on Professional suggests nothing, because Professional
is already unlimited.

**The UI test suite never selected the app under test (L-71).** `TEST_RUNNER_LOOHAR_APP_BUNDLE_ID`
never reached the runner; dumping the runner's environment showed nothing with that prefix. Because
the tests fell back to a default bundle id, a run asking for `com.loohar.definitely.not.installed`
**passed**. Every previous run had driven `com.loohar.pos`, so the recorded "9 of 9 across POS,
Driver and Restaurant" was three tests run three times against one app. The count was real; the
coverage was not. Values now pass through the scheme, and the negative control that exposed it fails
as it must.

### 34.3 How it was sequenced, and why

`loohar.com` is served by Vercel from a scope this account cannot reach, and Vercel publishes the
production branch automatically. Merging first would therefore have risked putting 70 commits of web
in front of an API still on `0526862` — new web calling endpoints the old API does not have.

So the API went first, `main` was fast-forwarded after, and Vercel then published the web by itself.
At no point was the web ahead of the API.

The three pending migrations were read line by line first. All additive: new nullable or defaulted
columns, two new tables, new indexes, no drops and no type narrowing. One carried a data change —
clearing MFA configuration whose secret is not in the encrypted `v1.` form — which was checked
rather than assumed: production code at `0526862` referenced `mfaSecret` only in `sanitize.js`, to
strip it from responses, and its two `mfaEnabled` hits were Prisma `select` clauses. Production had
no MFA write path, so that UPDATE matched no rows.

### 34.4 Verified live, not assumed

`main`, the API and `loohar.com` all report `15a1f14`. `/health` reports the schema ok with no
issues. All four public routes return 200 and every one of them was loaded in a real browser with no
runtime exception. The sign-in card on `loohar.com` reports **"Live API Connected"**, which the page
only writes after a real request to the API. On the live API, CORS allows `https://loohar.com` and
`https://www.loohar.com` and refuses `evil.example.com`, the look-alike `loohar.com.evil.com` and
`capacitor://localhost` with 403.

**Gates:** lint · `npm test` · 8 of 8 web surfaces rendered in a real browser · Prisma schema valid ·
staging pilot workflow 19/19 at this exact SHA · 25 database suites / 172 tests with no runtime code
changed since they last ran in full.

**Rollback.** Redeploy `0526862` on Render. The migrations are additive, so the previous code runs
unchanged against the new schema.

### 34.5 Recorded, not hidden

Claude's production deploy was refused by the permission classifier, so the owner ran it. It is an
MCP tool, and the denial text's suggestion of a "Bash permission rule" does not cover one; allowing
`mcp__plugin_render_render__trigger_deploy` is what would let Claude perform it.

Because Vercel published the web on its own, **any future push to `main` publishes the web without
review**. That is worth bringing under control before the next release.

`loohar.com` sends no `X-Frame-Options` or CSP `frame-ancestors` — a Vercel default. The API sends
both. Minor hardening, not a blocker, and now on the list.


## Changelog index
