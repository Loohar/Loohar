# Loohar — Owner Action Queue

Only genuine owner or external actions live here. Everything else is being worked autonomously.
Updated 2026-09-20.

## 1. BLOCKING the main merge — production deploy path must be made safe

**This is the one blocker that stops otherwise-ready work from reaching `main`.**

`main` is currently exactly what is live in production (`0526862`, API and web). The release
candidate is 57 commits ahead. Before merging, the production deployment path has to be provably
owner-controlled:

| Path | Status |
| --- | --- |
| Render production API (`loohar-api`) | **Safe.** `autoDeploy: no`, verified through the Render API. Pushing main does not deploy it. |
| Render blueprint `render.yaml` | **Hazard.** The file in the repo declares `autoDeploy: true`, contradicting the live setting. A Blueprint re-sync would turn production auto-deploy on. |
| Vercel production web (`loohar.com`) | **UNKNOWN — this is the blocker.** It is served by Vercel from a project in the `loohar` team, which the Vercel account `subash.sunar@loohar.com` cannot see. Vercel deploys production automatically from the production branch by default. |

If Vercel auto-deploys from `main`, merging would put 57 commits of web on `loohar.com` while the
API stayed at `0526862`: an unapproved production release, with the web ahead of the API it talks to.

**What I need from you — one of:**
1. Give `subash.sunar@loohar.com` access to the Vercel project serving `loohar.com` so I can verify
   and, if needed, disable production auto-deploy; **or**
2. Turn off automatic production deployment for that project yourself and confirm it; **or**
3. Tell me to merge anyway, understanding it may publish the web to production immediately.

## 2. Supabase re-authentication (blocks a P0)

`/mcp` → supabase → Authenticate. Backup, PITR and restore-drill evidence for L-11 cannot be
produced without it. L-11 is the only P0 that cannot be started at all.

## 3. Android SDK licence (blocks all Android builds)

I will not accept a licence agreement on your behalf. One command:

```
yes | /opt/homebrew/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager --licenses
```

Then Android APKs can be built and certified on an emulator.

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
