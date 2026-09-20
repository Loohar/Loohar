# Loohar — Build and Install Status

What actually exists and what you can install today. Updated 2026-09-20 against RC `ba06e22`.

**Status ladder:** NOT STARTED → SOURCE READY → BUILD READY → SIMULATOR CERTIFIED →
PHYSICAL DEVICE CERTIFIED → INTERNAL DISTRIBUTION READY → STORE SUBMITTED → STORE APPROVED.

| App | Status today |
| --- | --- |
| Loohar Web Platform | **Live.** Production `0526862`; candidate `9a2cc88` on staging |
| Loohar POS | **SIMULATOR CERTIFIED** (iOS). Android SOURCE READY |
| Loohar Driver | **SIMULATOR CERTIFIED** (iOS). Android SOURCE READY |
| Loohar Restaurant | **SIMULATOR CERTIFIED** (iOS). Android SOURCE READY |
| Loohar POS Device platform | **NOT STARTED** |

> Nothing is published to the App Store or Google Play, and nothing has been submitted.
> No signed build exists yet, because that needs Apple and Google developer accounts.

---

## LOOHAR POS — `com.loohar.pos`

- **Version** 0.1.0 · **SHA** `ba06e22` · connects to **STAGING** (`loohar-api-staging.onrender.com`)
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

- **Version** 0.1.0 · **SHA** `ba06e22` · connects to **STAGING**
- **iOS: SIMULATOR CERTIFIED.** Builds, installs, launches, routes to `/driver`, reports
  **"Live API Connected"**. Evidence:
  `~/Documents/Loohar/Evidence/native-apps/ios-driver-01-api-connected-09e91ab.png`
- **Android: SOURCE READY**, no APK — same licence blocker.
- **Physical device / TestFlight / stores: NOT STARTED** — signing blockers.

Same install commands with `--app driver` and `com.loohar.driver`.

---

## LOOHAR RESTAURANT — `com.loohar.restaurant`

- **Version** 0.1.0 · **SHA** `ba06e22` · connects to **STAGING**
- **iOS: SIMULATOR CERTIFIED.** Builds, installs, launches, opens `/restaurant` (redirecting a
  signed-out user to the restaurant login exactly as the web does) and reports **"Live API
  Connected"**. Evidence:
  `~/Documents/Loohar/Evidence/native-apps/ios-restaurant-01-api-connected-7072a3b.png`
- **Android: SOURCE READY**, no APK — Android SDK licence blocker.
- **Physical device / TestFlight / stores: NOT STARTED** — signing blockers.

Same install commands with `--app restaurant` and `com.loohar.restaurant`.

## LOOHAR POS DEVICE platform — not started

No device image, provisioning package or supported-hardware list exists yet. Nothing about dedicated
POS hardware has been built or tested.

---

## Android — one owner action away

Everything is prepared. `npm run build:android -- --app pos --env staging` finds the JDK and the
Android SDK and stops with the exact commands, because **the Android SDK licence must be accepted by
a person** and Loohar will not accept a licence agreement on the owner's behalf. It exits 2 today.

After you run the two commands it prints, the same command produces a debug **APK** you can install
on an emulator or a device. A release **AAB** additionally needs an upload keystore and is refused
until one is configured, so an unsigned artifact can never be mistaken for a releasable one.

**No APK or AAB file exists yet.** SOURCE READY is not downloadable.

## What is certified, and what is not

| | Certified | Not certified |
| --- | --- | --- |
| Launch and reach the API | **Yes** — all three apps, iOS Simulator, screenshots | |
| The workflow over the app's own origin | **Yes** — 20/20 on staging from `capacitor://localhost` and `https://localhost` | |
| Tapping through the app's UI | | **No.** There is no XCUITest target and neither idb nor Appium is installed |
| A physical iPhone or iPad | | **No.** Needs Apple signing |
| Android emulator or device | | **No.** Needs the SDK licence |

The workflow certification drives the real staging API with the exact origin and absolute URLs the
packaged apps use, which is the layer that differs in native and the one that was actually broken
before the CORS fix. It does not prove the on-screen flow, and is not presented as doing so.

## What this connects to

Every native build so far points at **staging**, fixed at build time; a staging build can never talk
to production. A production build additionally needs `ALLOW_NATIVE_APP_ORIGINS=true` on the
production API, which is a production change and therefore an owner decision at release.

No secrets are embedded in any build. Tokens live in the iOS Keychain / Android Keystore and never
in WebView storage.
