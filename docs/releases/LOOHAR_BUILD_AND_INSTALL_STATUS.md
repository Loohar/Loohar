# Loohar — Build and Install Status

What actually exists and what you can install today. Updated 2026-09-21 against RC `3001f9e`.

**Status ladder:** NOT STARTED → SOURCE READY → BUILD READY → SIMULATOR CERTIFIED →
PHYSICAL DEVICE CERTIFIED → INTERNAL DISTRIBUTION READY → STORE SUBMITTED → STORE APPROVED.

| App | Status today |
| --- | --- |
| Loohar Web Platform | **Live.** Production `0526862`; candidate `3001f9e` on staging |
| Loohar POS | **SIMULATOR + UI CERTIFIED** on iOS **and Android** |
| Loohar Driver | **SIMULATOR + UI CERTIFIED** on iOS **and Android** |
| Loohar Restaurant | **SIMULATOR + UI CERTIFIED** on iOS **and Android** |
| Loohar POS Device platform | **NOT STARTED** |

> Nothing is published to the App Store or Google Play, and nothing has been submitted.
> No signed build exists yet, because that needs Apple and Google developer accounts.

---

## LOOHAR POS — `com.loohar.pos`

- **Version** 0.1.0 · **SHA** `8ec80c1` · connects to **STAGING** (`loohar-api-staging.onrender.com`)
- **iOS: SIMULATOR CERTIFIED.** Built with `xcodebuild` (Debug, unsigned), installed and launched on
  an iPhone 17 Pro simulator running iOS 26.2. It renders its sign-in screen and reports
  **"Live API Connected"** against staging. Evidence:
  `~/Documents/Loohar/Evidence/native-apps/ios-pos-03-api-connected-09e91ab.png`
- **iOS physical device: BLOCKED** — needs an Apple Developer signing identity (owner action 4).
- **TestFlight: NOT STARTED** — same blocker.
- **Android: EMULATOR + UI CERTIFIED.** A 5.9MB debug **APK exists** at
  `apps/mobile/pos/android/app/build/outputs/apk/debug/app-debug.apk`. Installed on a Pixel 7 /
  Android 16 (arm64) emulator, launched, routes to `/restaurant/login`, reports **"Live API
  Connected"** against staging, and accepts typing into a masked password field. 6/6 checks.
- **AAB: BLOCKED** — needs a Google Play upload keystore (owner action 4).

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

- **Version** 0.1.0 · **SHA** `8ec80c1` · connects to **STAGING**
- **iOS: SIMULATOR CERTIFIED.** Builds, installs, launches, routes to `/driver`, reports
  **"Live API Connected"**. Evidence:
  `~/Documents/Loohar/Evidence/native-apps/ios-driver-01-api-connected-09e91ab.png`
- **Android: EMULATOR + UI CERTIFIED.** Debug APK built and driven on the emulator, 6/6 checks.
- **Physical device / TestFlight / stores: NOT STARTED** — signing blockers.

Same install commands with `--app driver` and `com.loohar.driver`.

---

## LOOHAR RESTAURANT — `com.loohar.restaurant`

- **Version** 0.1.0 · **SHA** `8ec80c1` · connects to **STAGING**
- **iOS: SIMULATOR CERTIFIED.** Builds, installs, launches, opens `/restaurant` (redirecting a
  signed-out user to the restaurant login exactly as the web does) and reports **"Live API
  Connected"**. Evidence:
  `~/Documents/Loohar/Evidence/native-apps/ios-restaurant-01-api-connected-7072a3b.png`
- **Android: EMULATOR + UI CERTIFIED.** Debug APK built and driven on the emulator, 6/6 checks.
- **Physical device / TestFlight / stores: NOT STARTED** — signing blockers.

Same install commands with `--app restaurant` and `com.loohar.restaurant`.

## LOOHAR POS DEVICE platform — not started

No device image, provisioning package or supported-hardware list exists yet. Nothing about dedicated
POS hardware has been built or tested.

---

## Android — unblocked 2026-09-21

The owner accepted all 7 Android SDK licences, and `platform-tools`, `platforms;android-36` and
`build-tools;36.0.0` are installed. Three debug APKs now exist, 5.9MB each:

```
npm run build:android -- --app all --env staging
```

| App | Package | APK |
| --- | --- | --- |
| Loohar POS | `com.loohar.pos` | `apps/mobile/pos/android/app/build/outputs/apk/debug/app-debug.apk` |
| Loohar Driver | `com.loohar.driver` | `apps/mobile/driver/android/app/build/outputs/apk/debug/app-debug.apk` |
| Loohar Restaurant | `com.loohar.restaurant` | `apps/mobile/restaurant/android/app/build/outputs/apk/debug/app-debug.apk` |

They were verified as three genuinely different builds — distinct SHA-256, package id and label —
because the first build took 16m34s and the next two took 7 seconds each, which is fast enough to be
worth checking rather than trusting. The difference is the one-time Gradle download. Each bundle
carries `commitSha 8ec80c14e168`, `environment: staging`, the staging API origin and **no**
production origin, so an APK cannot silently point at production and any installed build traces back
to its commit.

Install one on an emulator or a device with USB debugging:

```
adb install -r apps/mobile/pos/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -W -n com.loohar.pos/com.loohar.pos.MainActivity
```

A release **AAB** still needs a Google Play upload keystore and is refused until one is configured,
so an unsigned artifact can never be mistaken for a releasable one.

## Driving the apps yourself

```
npm run test:native-ui  -- --app all --env staging   # iOS, XCUITest on a Simulator
npm run test:android-ui -- --app all --env staging   # Android, CDP on an emulator
```

Each builds the apps, installs them and drives them through their real interface: the sign-in screen,
the app's own live-API indicator, and typing into the form. iOS needs Xcode and
`brew install xcodegen`; Android needs an arm64 emulator image and an AVD (see
`docs/mobile/NATIVE_APPS.md` §10).

## What is certified, and what is not

| | Certified | Not certified |
| --- | --- | --- |
| Launch and reach the API | **Yes** — all three apps, iOS Simulator, screenshots | |
| The workflow over the app's own origin | **Yes** — 20/20 on staging from `capacitor://localhost` and `https://localhost` | |
| Tapping through the app's UI (iOS) | **Yes** — 9 of 9 XCUITest cases across all three apps: sign-in screen, live-API indicator, typing into the form | |
| Tapping through the app's UI (Android) | **Yes** — 18 of 18 checks across all three apps on a Pixel 7 / Android 16 emulator | |
| An installable Android artifact | **Yes** — three debug APKs, 5.9MB each | |
| A physical iPhone or iPad | | **No.** Needs Apple signing |
| A physical Android device | | **No.** Never run on real hardware |
| Signing in and working inside the app | | **No.** Needs a certification tenant |
| Google Play / App Store release | | **No.** Needs developer accounts and an upload keystore |

The workflow certification drives the real staging API with the exact origin and absolute URLs the
packaged apps use, which is the layer that differs in native and the one that was actually broken
before the CORS fix. It does not prove the on-screen flow; the two UI suites do, up to the sign-in
screen and no further.

The Android suite was **negative-controlled**: putting the emulator into airplane mode failed the
live-API check, as it should. A suite that cannot fail is not evidence.

## What this connects to

Every native build so far points at **staging**, fixed at build time; a staging build can never talk
to production. A production build additionally needs `ALLOW_NATIVE_APP_ORIGINS=true` on the
production API, which is a production change and therefore an owner decision at release.

No secrets are embedded in any build. Tokens live in the iOS Keychain / Android Keystore and never
in WebView storage.
