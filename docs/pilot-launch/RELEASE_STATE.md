# Release State

## Environments (verified 2026-09-17 06:31 UTC)

| Environment | Component | SHA | Source |
| --- | --- | --- | --- |
| Production | API | `0526862bceb2dc3a483de96561755052076df060` | `/version` |
| Production | Web | `0526862bceb2dc3a483de96561755052076df060` | `/version.json` |
| Staging | API | `4c48815283adce470b9130f4bf49aa50f57119a7` | `/version` |
| Staging | Web | UNKNOWN | protected preview |

## Candidate

| Field | Value |
| --- | --- |
| Branch | `fix/launch-review3-fixes-v01` (pushed) |
| SHA | `c5347da30944a94dd42fd9fcd1d21231df5b4150` |
| Base | production `0526862` (fast-forward) |
| Staged | No |
| Staging certified | No |

### Migrations since production
- `20260916090000_checkout_idempotency` — additive (nullable columns + unique index).
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
