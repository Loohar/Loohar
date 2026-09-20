## 27. Change records — 2026-09-20 (afternoon): native surfaces and the main-merge gate

Release candidate `9a2cc88 → 3dd26e5`. Staging runs `3dd26e5`; production untouched at `0526862`.

### 27.1 The main merge is blocked, and not by a test

`main` is byte-identical to what is live in production, and the candidate is 60 commits ahead.
Before merging, the production deployment path had to be proven owner-controlled:

- **Render production API: safe.** `autoDeploy: no`, read from the Render API. A push to main does
  not deploy it.
- **`render.yaml`: was a hazard, now fixed** (`7072a3b`). The file declared `autoDeploy: true`,
  contradicting the live setting, so a Blueprint re-sync would silently have re-enabled automatic
  production deploys from main.
- **`loohar.com`: unknown, and this is the blocker.** It is served by Vercel from a project the
  available Vercel account cannot enumerate. Vercel deploys production from the production branch by
  default, so merging could publish 60 commits of web to production while the API stayed at
  `0526862` — the web ahead of the API it talks to.

No merge to main was attempted. Owner action 1 records exactly what would unblock it.

### 27.2 A provider refusal no longer reads as a credential failure (`7072a3b`, L-60)

Found while certifying on staging: the Colorado provider answers 401/403 for an uncovered
product/service category, and intermittently for a category that worked minutes earlier. All of it
was reported as "TTR authentication failed", which points a restaurant and its support at Loohar's
credentials instead of the category. The code is unchanged so existing handling still works; the
message now names the likely causes and the details carry the provider status and whether a category
was supplied.

### 27.3 Loohar Restaurant native app (`3dd26e5`)

The third required surface. A Capacitor shell around the same web build, opening at `/restaurant`,
so the owner and manager screens are the ones already built and tested, on the same authentication,
RBAC, tenant isolation and server-computed money. Tokens use the same Keychain and Keystore path.

Verified on an iPhone 17 Pro simulator (iOS 26.2): builds unsigned, installs, launches, redirects a
signed-out user to the restaurant login exactly as the web does, and reports "Live API Connected"
against staging. Evidence: `Evidence/native-apps/ios-restaurant-01-api-connected-7072a3b.png`.

Android project generated, **no APK built** — the SDK licence is an owner action. Nothing signed,
submitted or published.

### 27.4 Pilot certification re-run at the new candidate

`npm run certify:pilot:staging` at `3dd26e5`: **19 of 19 steps**, ending with subtotal 2900, tax 265
at 9.15%, total 3465, settled at the server total, kitchen holding the ticket, day reporting
collected 3465. Same figures as `9ad8708` and `3b2af70`.

---

## Changelog index

| Chapter | Updated | Subject | Branch | SHA | Certification |
| --- | --- | --- | --- | --- | --- |
| 1–24 | 2026-09-17 | Platform at edition 0.2 | various | `c5347da` | Superseded; not re-verified |
| 25 | 2026-09-19 | Recovery, backup, L-11 operations, CI, dependency advisories, native apps | several | `402c4a7` | Staging verified |
| 26 | 2026-09-20 | API linting, drawer race, coupon limit, refund reconciliation | several | `3b2af70` | 22 suites / 160 tests; staging |
| 27 | 2026-09-20 | Main-merge gate, tax error mapping, Restaurant app | several | `3dd26e5` | 19/19 staging certification |

**Current state:** RC `3dd26e5` · staging API `3dd26e5` · main `0526862` · production `0526862`.
Native apps: POS, Driver and Restaurant all iOS simulator certified against staging; Android source
ready, unbuilt; nothing signed or published.
