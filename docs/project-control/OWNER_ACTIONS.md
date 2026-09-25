# Loohar — Owner Action Queue

Only genuine owner or external actions live here. Everything else is being worked autonomously.
Updated 2026-09-23.

## ~~1. BLOCKING the main merge~~ — RELEASED 2026-09-23

`main` and production both run `15a1f14`. The API was deployed first and `main` fast-forwarded
after, so the web could never run ahead of the API; Vercel then published the web automatically.

Two things remain from this item:

- **Vercel access.** `loohar.com` is served from the `loohar` scope
  (`team_3UarI1385VOerIeOPW8kWaLe`), which `subash.sunar@loohar.com` cannot reach — the API answers
  "You must re-authenticate to this scope". The web deployed itself this time, which also means
  **any future push to `main` publishes the web automatically**, without review. Worth putting under
  control before the next release.
- **The Render deploy permission.** Claude's `trigger_deploy` was refused by the permission
  classifier. It is an MCP tool, so a Bash rule does not cover it; allow
  `mcp__plugin_render_render__trigger_deploy` so Claude can run the deploy itself next time.

## 2. Supabase re-authentication (blocks a P0)

`/mcp` → supabase → Authenticate. Backup, PITR and restore-drill evidence for L-11 cannot be
produced without it. L-11 is the only P0 that cannot be started at all.

## ~~3. Android SDK licence~~ — DONE 2026-09-21

You accepted all 7 licences. `platform-tools`, `platforms;android-36` and `build-tools;36.0.0` are
installed, three debug APKs are built, and all three apps now pass UI certification on an emulator
(18/18). Nothing further is needed here. What remains for Android is the Play Store path in item 4.

## 4. Apple Developer Program and Google Play Console

Needed for signed device builds, TestFlight, internal distribution and store release. Enrolment
takes days, so starting early matters. iOS simulator builds already work without it.

## 5. Stripe TEST Connect onboarding (~2 minutes)

Blocks online card, Stripe Terminal and refund certification on staging for a test tenant.

## 6. Physical hardware

- A Stripe Terminal reader for card-present acceptance.
- An Android POS terminal, if the dedicated POS device platform is to be certified on real hardware.
- An iPhone or iPad for physical-device app certification.

## 7. Business decisions

- A geocoding provider for delivery-zone enforcement (the pilot is pickup-only until then).
- The Colorado product/service category guidance shown to restaurants.
