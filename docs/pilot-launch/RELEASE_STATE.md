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
| Branch | `fix/launch-pilot-review-fixes-v01` (pushed) |
| SHA | `48c27e933d9c29d8809cc370b1e0c3c4c4246a5c` |
| Base | production `0526862` (fast-forward; 0 commits behind `origin/main`) |
| Included | L-01 (`2d85007`, `b291ddd`, `cfec6a4`, `a3262dc`), L-02 (`4c48815`), L-05 (`0e69db3`), L-03 (`7e0833a`), L-04 (`47fa9cc`), review 1 fixes (`1d30522`), L-15 (`6d61d61`), L-07 (`7304418`), L-06 (`ca55a25`), L-09 (`a8fdeff`), review 2 fixes (`48c27e9`) |
| Staged | No |
| Staging certified | No |

### Migrations since production
`git diff --name-only 0526862..48c27e9 -- apps/api/prisma/migrations` lists exactly one
migration:
- `20260916090000_checkout_idempotency` — adds nullable `checkoutIdempotencyKeyHash`,
  `checkoutRequestHash` and a unique index on `RestaurantOrderPayment`. Additive; old code
  ignores the columns. The index build briefly locks writes on that table (small in pilot).
  Rollback: code rollback is safe with the columns present; the columns can remain.

### Deployment prerequisites
1. `STRIPE_WEBHOOK_SECRET` configured wherever `/api/payments/webhook` is registered with
   Stripe (L-04 now rejects all events without it).
2. Deploy web together with or before the API: the API requires `Idempotency-Key` on checkout,
   and browsers still holding an old bundle get a 400 until they reload.
3. Staging web preview origin appended to staging `CORS_ORIGINS` for certification.
4. Refund API now requires `Idempotency-Key` (no web caller today; external/admin clients must send it).
5. POS: each main terminal now owns a drawer created on registration/update; existing terminals
   without a drawer get one on their next device update or registration.

### Evidence
- Tests: see `docs/pilot-launch/CONTROL_CENTER.md` §5.
- Adversarial security reviews 2026-09-17: review 1 findings fixed in `1d30522`; review 2 findings fixed in `48c27e9`.

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
