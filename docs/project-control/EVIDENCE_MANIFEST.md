# Loohar External Archive Manifest

`LOCAL-SENSITIVE / NOT-IN-GIT` — this manifest describes project-record files that live
**outside** the Git repository, at `/Users/rudrabishwokarma/Documents/Loohar/`.

That directory is **not under version control and has no remote**. As of 2026-09-19,
`tmutil latestbackup` reported that the Time Machine destination could not be mounted, so this
archive existed on a single machine with no verified backup. This manifest exists so that a
fresh session can tell what the archive should contain, prove whether a copy is intact, and know
what each artifact proves and which source revision it belongs to.

Checksums are the first 16 hex characters of SHA-256. A full checksum can be recomputed with
`shasum -a 256 <path>`.

## Classification

| Class | Meaning |
| --- | --- |
| SAFE-SOURCE | Non-secret authored source; belongs in Git. Copy into the repository was attempted on 2026-09-19 and **blocked by the local permission classifier** (Sensitive-Source Provenance). Still outside Git. |
| DERIVED-BINARY | Rendered PDF output; reproducible from its Markdown source. Manifest only. |
| LOCAL-SENSITIVE | Screenshots of authentication screens. Redacted by the capture process, but not committed. Manifest only. |

## Verified contents (2026-09-19)

| Class | SHA-256 (16) | Path | What it is / proves |
| --- | --- | --- | --- |
| SAFE-SOURCE | `eb16600c44c3948b` | `_brand/assets/loohar-mark.svg` | Project record |
| SAFE-SOURCE | `33a30ba631da4e05` | `_brand/README.md` | Project record |
| SAFE-SOURCE | `d719a709c249657f` | `_brand/render-all.mjs` | Document rendering tool |
| SAFE-SOURCE | `2007cb73f5d480ec` | `_brand/render-loohar-document.mjs` | Document rendering tool |
| SAFE-SOURCE | `1cc88154c9f1ac08` | `Architecture/ARCHITECTURE_CURRENT.md` | Project record |
| SAFE-SOURCE | `cba17ac0e2797d3c` | `Development_Book/archive/INDEX.md` | Project record |
| DERIVED-BINARY | `3abf852d40d6ffbf` | `Development_Book/archive/LOOHAR_DEVELOPMENT_BOOK-2026-09-17-candidate-1d30522.pdf` | Rendered document; regenerate from the matching .md |
| DERIVED-BINARY | `5b8b81a691a37a55` | `Development_Book/archive/LOOHAR_DEVELOPMENT_BOOK-2026-09-17-candidate-48c27e9.pdf` | Rendered document; regenerate from the matching .md |
| DERIVED-BINARY | `255946cbb82db21f` | `Development_Book/archive/LOOHAR_DEVELOPMENT_BOOK-2026-09-17-candidate-c5347da.pdf` | Rendered document; regenerate from the matching .md |
| SAFE-SOURCE | `4a61b4c4c63a5928` | `Development_Book/LOOHAR_DEVELOPMENT_BOOK.md` | Development Book source (23 chapters) |
| DERIVED-BINARY | `255946cbb82db21f` | `Development_Book/LOOHAR_DEVELOPMENT_BOOK.pdf` | Rendered document; regenerate from the matching .md |
| SAFE-SOURCE | `eb7d27597e203937` | `Development_Book/render-development-book.mjs` | Document rendering tool |
| SAFE-SOURCE | `c2f70a6caa65440e` | `Driver_Manual/LOOHAR_DRIVER_MANUAL.md` | Customer-facing manual source |
| DERIVED-BINARY | `01820267ca88b2b9` | `Driver_Manual/LOOHAR_DRIVER_MANUAL.pdf` | Rendered document; regenerate from the matching .md |
| SAFE-SOURCE | `c4c29cf9a5dcfa18` | `Employee_POS_Manual/LOOHAR_EMPLOYEE_POS_MANUAL.md` | Customer-facing manual source |
| DERIVED-BINARY | `fb639d648b1dcd21` | `Employee_POS_Manual/LOOHAR_EMPLOYEE_POS_MANUAL.pdf` | Rendered document; regenerate from the matching .md |
| SAFE-SOURCE | `8db815f0fb8d257e` | `Evidence/checkout/checkout-idempotency-c5347da.md` | SHA-tied certification evidence |
| SAFE-SOURCE | `7c1a90d168539ef1` | `Evidence/kds/kds-and-lifecycle-c5347da.md` | SHA-tied certification evidence |
| SAFE-SOURCE | `b7ad05f5d8b75b77` | `Evidence/mfa/mfa-tests-c5347da.md` | SHA-tied certification evidence |
| SAFE-SOURCE | `10b1ac6a2c4be916` | `Evidence/onboarding/STAGING_TENANT_CERTIFICATION-9ad8708.md` | SHA-tied certification evidence |
| SAFE-SOURCE | `4fe63b8260c1b58d` | `Evidence/payments/payment-tests-c5347da.md` | SHA-tied certification evidence |
| SAFE-SOURCE | `19ed48b898ece36e` | `Evidence/payments/STAGING_CERTIFICATION-eaeff30.md` | SHA-tied certification evidence |
| SAFE-SOURCE | `942f263a4259b948` | `Evidence/payments/STAGING_ONLINE_CARD_CERTIFICATION-bf7430a.md` | SHA-tied certification evidence |
| SAFE-SOURCE | `068205cc3d1041e4` | `Evidence/payments/staging-certification-eaeff30.json` | Raw staging certification evidence; client secrets and tracking tokens redacted |
| SAFE-SOURCE | `6be51f359b0ad2d8` | `Evidence/payments/staging-online-card-certification-bf7430a.json` | Raw staging certification evidence; client secrets and tracking tokens redacted |
| SAFE-SOURCE | `7ffd0db000e32947` | `Evidence/pos/pos-tests-c5347da.md` | SHA-tied certification evidence |
| SAFE-SOURCE | `5268ce1813fe5363` | `Evidence/README.md` | SHA-tied certification evidence |
| SAFE-SOURCE | `ee55ee5e22d9e5ba` | `Evidence/releases/schema-drift-c5347da.md` | SHA-tied certification evidence |
| SAFE-SOURCE | `29133fb8a4c26870` | `Evidence/screenshots/INDEX.md` | SHA-tied certification evidence |
| LOCAL-SENSITIVE | `d92b81cc367a8d2d` | `Evidence/screenshots/mfa-01-enrollment-required.png` | MFA flow screenshot (redacted at capture) |
| LOCAL-SENSITIVE | `c9d13e29e1cab2b8` | `Evidence/screenshots/mfa-02-setup-key-redacted.png` | MFA flow screenshot (redacted at capture) |
| LOCAL-SENSITIVE | `420155d5c86690cc` | `Evidence/screenshots/mfa-03-wrong-code-rejected.png` | MFA flow screenshot (redacted at capture) |
| LOCAL-SENSITIVE | `77c5855c504d1160` | `Evidence/screenshots/mfa-04-recovery-codes-redacted.png` | MFA flow screenshot (redacted at capture) |
| LOCAL-SENSITIVE | `7b2805d3ce0dff33` | `Evidence/screenshots/mfa-05-signed-in-after-enrollment.png` | MFA flow screenshot (redacted at capture) |
| LOCAL-SENSITIVE | `5826d37b014e0264` | `Evidence/screenshots/mfa-06-sign-in-challenge.png` | MFA flow screenshot (redacted at capture) |
| LOCAL-SENSITIVE | `72315f26ca6ba320` | `Evidence/screenshots/mfa-07-challenge-wrong-code.png` | MFA flow screenshot (redacted at capture) |
| LOCAL-SENSITIVE | `e2f6ef7250d4b1ed` | `Evidence/screenshots/mfa-08-signed-in-after-challenge.png` | MFA flow screenshot (redacted at capture) |
| SAFE-SOURCE | `7c1a90d168539ef1` | `Evidence/security/authz-tests-c5347da.md` | SHA-tied certification evidence |
| SAFE-SOURCE | `26f181645bc3431f` | `Evidence/staging/identity-2026-09-17T0817Z.md` | SHA-tied certification evidence |
| SAFE-SOURCE | `c828e86c457e7e94` | `Platform_Admin_Manual/LOOHAR_PLATFORM_ADMIN_MANUAL.md` | Customer-facing manual source |
| DERIVED-BINARY | `bfe937239ecf2584` | `Platform_Admin_Manual/LOOHAR_PLATFORM_ADMIN_MANUAL.pdf` | Rendered document; regenerate from the matching .md |
| SAFE-SOURCE | `98bc238ddaea0768` | `Release_History/RELEASE_STATE_2026-09-17.md` | Project record |
| SAFE-SOURCE | `7681c54bb3b9be2c` | `Restaurant_Owner_Manual/LOOHAR_RESTAURANT_OWNER_MANUAL.md` | Customer-facing manual source |
| DERIVED-BINARY | `011d2e10e6c82946` | `Restaurant_Owner_Manual/LOOHAR_RESTAURANT_OWNER_MANUAL.pdf` | Rendered document; regenerate from the matching .md |
| SAFE-SOURCE | `aa0859d33b77fbfb` | `Security/SECURITY_MODEL.md` | Project record |

## Anomalies found during the 2026-09-19 recovery

1. `Evidence/security/authz-tests-c5347da.md` and `Evidence/kds/kds-and-lifecycle-c5347da.md`
   are **byte-identical** (`7c1a90d168539ef1`). One of them is a mis-copied file, so either the
   authorization evidence or the KDS evidence for `c5347da` is missing from the archive. Treat the
   affected certification as unproven until the correct document is recovered or the test is rerun.
2. `Development_Book/LOOHAR_DEVELOPMENT_BOOK.pdf` is byte-identical to
   `Development_Book/archive/LOOHAR_DEVELOPMENT_BOOK-2026-09-17-candidate-c5347da.pdf`
   (`255946cbb82db21f`). The "current" Development Book PDF is the `c5347da` edition and is stale
   against the release candidate `4f69015`.
3. `Evidence/README.md` states "No UI evidence captured yet (2026-09-17)" although eight MFA
   screenshots are present in the same archive.
