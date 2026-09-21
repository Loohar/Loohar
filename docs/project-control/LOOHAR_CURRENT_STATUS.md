# Loohar — Current Status

Updated **2026-09-20**. Statuses are PASS / PARTIAL / BLOCKED / FAIL / NOT STARTED. Failures and
blockers are not hidden. Anything marked PASS has executable evidence tied to a SHA.

## Where everything is

| | SHA | Note |
| --- | --- | --- |
| **Release candidate** | `1361cc6b84fafe3834eba66d985225a38150e558` | `release/loohar-pilot-rc-v01`, 68 commits ahead of main |
| **Main** | `0526862bceb2dc3a483de96561755052076df060` | Unchanged; identical to production |
| **Staging API** | `1361cc6` | Healthy, schema 0 issues |
| **Staging web** | `402c4a7` | Vercel skips builds for commits that touch no web code |
| **Production API** | `0526862` | Untouched throughout |
| **Production web** | `0526862` | Untouched throughout |

## Can I merge to main? **BLOCKED — needs you**

Not a test failure. Every engineering gate below passes. The block is that **merging to main may
deploy production automatically**, and that cannot be verified from here.

- Render production API: **safe** (`autoDeploy: no`, verified via the Render API).
- `render.yaml` in the repo says `autoDeploy: true`, contradicting the live setting — a re-sync
  hazard.
- **`loohar.com` is on Vercel in a project this account cannot see.** Vercel deploys production from
  the production branch by default. Merging could publish 57 commits of web while the API stays at
  `0526862` — web ahead of the API it talks to.

See `OWNER_ACTIONS.md` item 1. Nothing will be merged to main until that is resolved.

## What is complete (PASS, with evidence)

| Area | Status | Evidence |
| --- | --- | --- |
| Pilot workflow on staging | **PASS** | 19/19 steps at `3b2af70`: signup → MFA → tax 9.15% → menu → terminal → PIN → shift → sale 2900+265=3465 → kitchen → day reconciles. Reusable: `npm run certify:pilot:staging` |
| Server-authoritative pricing | **PASS** | Client sent `totalCents: 1`; server charged 4982 (order 688130) |
| Checkout idempotency | **PASS** | 11 database tests |
| Checkout replay (L-13) | **PASS** | Dead PaymentIntent replaced, never reissued after success; 4/6 cases fail on the previous commit |
| Coupon usage limit (L-28) | **PASS** | 25 concurrent redemptions on a limit of 10: was 25, now capped at 10 |
| Cash drawer race (L-21) | **PASS** | Was 3 drawers for 3 concurrent registrations, now 1; 15 clean runs; confirmed on staging |
| Refund mirroring + sweep (L-20) | **PASS** | Dashboard refunds mirrored; stale PENDING resolved against Stripe |
| Dependency advisories | **PASS** | `qs` DoS and `morgan` log forging fixed; `npm audit` 0 |
| API static analysis (L-59) | **PASS** | ESLint over 71 files; found a stale duplicate of customer segmentation |
| MFA | **PASS** | Enrolment and sign-in, wrong code and wrong password refused, on staging |
| Tenant isolation | **PASS** | Adversarial suites; cross-tenant refund refused |
| Webhook verification | **PASS** | Signature, replay and ±300 s window; ledger deduplication |
| Browser render gate | **PASS** | 8 authenticated surfaces, no runtime exceptions; a skip now fails CI |
| CI | **PASS** | Every push: lint, scan, build, tests, 22 database suites |
| Uptime alerting | **PARTIAL** | Written and probe-tested; **activates only once on `main`** |

Database suites: **22 suites, 160 tests, zero skips.**

## What is PARTIAL or BLOCKED

| Item | Status | Why |
| --- | --- | --- |
| L-11 operations | **PARTIAL** | Render evidence done. Backup/PITR and a restore drill need Supabase re-auth (owner) |
| Online card / Terminal / refunds on staging | **BLOCKED** | Needs Stripe Connect onboarding for a test tenant (owner) |
| Physical card-present | **BLOCKED** | Needs a Terminal reader (owner) |
| Android apps | **BLOCKED** | Android SDK licence not accepted (owner) |
| Signed iOS builds / TestFlight | **BLOCKED** | Apple Developer account (owner) |
| Restaurant mobile app | **PASS (simulator)** | `com.loohar.restaurant` builds, launches, reaches staging |
| POS device platform | **NOT STARTED** | Needs hardware decisions |
| Delivery zones | **BLOCKED** | Needs a geocoding provider decision (owner) |
| Tax error mapping (L-60) | **PASS** | Fixed in `7072a3b` |

## What can I install today?

Only on an iOS Simulator: **Loohar POS** and **Loohar Driver**, both pointing at staging, both
verified to launch and reach the API. No Android APK exists yet, and nothing is signed or published.
Full detail and commands: `docs/releases/LOOHAR_BUILD_AND_INSTALL_STATUS.md`.

## What changed today (2026-09-20)

`e9cae3a` API linting · `43bfb40` drawer race · `a765a83` coupon limit · `3b2af70` refund
reconciliation · `796e830` staging web CORS · `9a2cc88` reusable staging pilot certification.
All deployed to staging and verified by exact SHA, with production untouched.

## What is next

1. Unblock the main merge (owner action 1).
2. Fix L-60 tax error mapping.
3. Build the Restaurant mobile app on the proven Capacitor pattern.
4. Certify a sale inside the native POS app against staging.
5. Android builds and the POS device platform once their blockers clear.
