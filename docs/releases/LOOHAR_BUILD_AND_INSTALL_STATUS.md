# Loohar — Build and Install Status

What actually exists and what you can install today. Updated 2026-09-20 against RC `9a2cc88`.

**Status ladder:** NOT STARTED → SOURCE READY → BUILD READY → SIMULATOR CERTIFIED →
PHYSICAL DEVICE CERTIFIED → INTERNAL DISTRIBUTION READY → STORE SUBMITTED → STORE APPROVED.

| App | Status today |
| --- | --- |
| Loohar Web Platform | **Live.** Production `0526862`; candidate `9a2cc88` on staging |
| Loohar POS | **SIMULATOR CERTIFIED** (iOS). Android SOURCE READY |
| Loohar Driver | **SIMULATOR CERTIFIED** (iOS). Android SOURCE READY |
| Loohar Restaurant | **NOT STARTED** |
| Loohar POS Device platform | **NOT STARTED** |

> Nothing is published to the App Store or Google Play, and nothing has been submitted.
> No signed build exists yet, because that needs Apple and Google developer accounts.

---

## LOOHAR POS — `com.loohar.pos`

- **Version** 0.1.0 · **SHA** `9a2cc88` · connects to **STAGING** (`loohar-api-staging.onrender.com`)
- **iOS: SIMULATOR CERTIFIED.** Built with `xcodebuild` (Debug, unsigned), installed and launched on
  an iPhone 17 Pro simulator running iOS 26.2. It renders its sign-in screen and reports
  **"Live API Connected"** against staging. Evidence:
  `~/Documents/Loohar/Evidence/native-apps/ios-pos-03-api-connected-09e91ab.png`
- **iOS physical device: BLOCKED** — needs an Apple Developer signing identity (owner action 4).
- **TestFlight: NOT STARTED** — same blocker.
- **Android: SOURCE READY.** The Gradle project exists and the plugin is wired, but **no APK has been
  built**, because the Android SDK licence has not been accepted (owner action 3).
- **AAB: NOT STARTED.**

**Install it today (iOS Simulator only):**
```
npm run build:native -- --app pos --env staging
cd apps/mobile/pos/ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -packageAuthorizationProvider netrc -skipPackagePluginValidation -skipMacroValidation \
  CODE_SIGNING_ALLOWED=NO build
xcrun simctl install booted <DerivedData>/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted com.loohar.pos
```
`-packageAuthorizationProvider netrc` is required: without it `xcodebuild` hangs silently waiting on
a Keychain prompt.

---

## LOOHAR DRIVER — `com.loohar.driver`

- **Version** 0.1.0 · **SHA** `9a2cc88` · connects to **STAGING**
- **iOS: SIMULATOR CERTIFIED.** Builds, installs, launches, routes to `/driver`, reports
  **"Live API Connected"**. Evidence:
  `~/Documents/Loohar/Evidence/native-apps/ios-driver-01-api-connected-09e91ab.png`
- **Android: SOURCE READY**, no APK — same licence blocker.
- **Physical device / TestFlight / stores: NOT STARTED** — signing blockers.

Same install commands with `--app driver` and `com.loohar.driver`.

---

## LOOHAR RESTAURANT — not started

The owner/manager app (dashboard, orders, menu, employees, payments, refunds, reports, tax,
delivery, settings) has **no native project yet**. It will follow the same Capacitor pattern so it
reuses the existing authentication, RBAC, tenant isolation and server-authoritative money.

## LOOHAR POS DEVICE platform — not started

No device image, provisioning package or supported-hardware list exists yet. Nothing about dedicated
POS hardware has been built or tested.

---

## What this connects to

Every native build so far points at **staging**, fixed at build time; a staging build can never talk
to production. A production build additionally needs `ALLOW_NATIVE_APP_ORIGINS=true` on the
production API, which is a production change and therefore an owner decision at release.

No secrets are embedded in any build. Tokens live in the iOS Keychain / Android Keystore and never
in WebView storage.
