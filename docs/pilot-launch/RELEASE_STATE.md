# Release State

## Environments (verified 2026-09-19 07:34 UTC)

| Environment | Component | SHA | Source |
| --- | --- | --- | --- |
| Production | API | `0526862bceb2dc3a483de96561755052076df060` | `/version` |
| Production | Web | `0526862bceb2dc3a483de96561755052076df060` | `/version.json`, build 2026-09-02 |
| Staging | API | `4f690151a7d21a049bf9b025f360a3d52bb7ee89` | `/version`; `/health` ok, schema 0 issues |
| Staging | Web | `4f690151a7d21a049bf9b025f360a3d52bb7ee89` | Vercel deployment `dpl_G2h93En9zjS4X1MeGst8RNs1BZvM`, project `loohar-kds-staging`, branch `release/loohar-pilot-rc-v01`, READY |

Staging web caveat: this is Vercel's authoritative build record, not a runtime fetch. The
deployment enables `ssoProtection` (all except custom domains), so `/version.json` answers 302 and
minting a protection-bypass link is refused in the available OAuth scope.

## Candidate

| Field | Value |
| --- | --- |
| Branch | `release/loohar-pilot-rc-v01` (pushed) |
| SHA | `4f690151a7d21a049bf9b025f360a3d52bb7ee89` |
| Base | production `0526862` (fast-forward), 42 commits ahead, 103 files, +10,839/−987 |
| Staged | Yes — staging API and web both at this SHA |
| Staging certified | Partially — 15 items certified with SHA-tied runtime evidence; see `.pilot/state.json` |

### Migrations since production
- `20260916090000_checkout_idempotency` — additive (nullable columns + unique index).
- `20260918090000_pos_terminal_readers` — additive (Stripe Terminal reader table).
- `20260917090000_privileged_mfa` — additive (MFA columns, recovery-code table, session flag);
  clears unencrypted or secret-less MFA rows so those users re-enroll.
Both applied to a fresh database; MFA migration upgraded over a populated database with data retained.
Rollback: redeploy `0526862`; the added columns/tables are ignored by the old code.

### Deployment prerequisites
See `CONTROL_CENTER.md` §7.

## Production release candidate report (template)

Fill in only when every pilot gate is met; then stop and await owner approval.

```
PRODUCTION RELEASE CANDIDATE
candidate SHA:
included fixes:
migration status:
security status:
payment status:
tenant-isolation status:
POS status:
KDS status:
delivery status:
backup status:
rollback plan: previous production SHA 0526862; migration reversibility notes
known risks:
approval requested from owner: YES
```

## Release history

| Date | Environment | SHA | Notes |
| --- | --- | --- | --- |
| ≤ 2026-09-02 | Production | `0526862` | Browserslist security update; current production baseline |
| ≤ 2026-09-17 | Staging API | `4c48815` | L-01 + L-02 chain |
| 2026-09-17 | Staging API | `eaeff30` | Real Stripe TEST card payment with tip, order 688130 reconciled at 4982 |
| 2026-09-17 | Staging API | `9ad8708` | Signup-to-first-sale, MFA, tax, POS, KDS, reporting certified |
| 2026-09-18 | Staging API + Web | `4f69015` | Consolidated release candidate; Super Admin hardening; web and API aligned |
