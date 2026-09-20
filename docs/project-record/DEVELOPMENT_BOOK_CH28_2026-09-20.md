## 28. Change records — 2026-09-20 (evening): native certification, Android readiness, POS device

Release candidate `3dd26e5 → ba06e22`. Staging runs `ba06e22`; production untouched at `0526862`.
Main remains `0526862` and was not merged: the production deploy path is still unverified.

### 28.1 The native apps are certified where it counts, and only there

"The app launches" is not certification. The whole pilot workflow now runs **as the packaged apps
do**: `certify-pilot-staging.mjs --as-native-app <origin>` sends every request with the origin the
apps actually use, and refuses to continue if the API rejects it. Result at `4d2374d`: **20 of 20
steps from `capacitor://localhost` (iOS) and 20 of 20 from `https://localhost` (Android)**, ending
in a cash sale of 2900 + 265 tax = 3465 reconciled for the day.

That certifies the layer that genuinely differs in native, and the one that was actually broken
before the CORS fix, when the API refused the app's origin outright.

**Not certified, and not claimed:** tapping through the app's own UI. There is no XCUITest target in
the Capacitor projects, and neither idb nor Appium is installed, so no UI-level automation exists.
Adding an XCUITest target is the next native step; it is also what will later drive a physical
device.

### 28.2 An installed app can now say which commit built it (`4d2374d`)

Nothing in a local native build set the CI variables the version writer looks for, so every bundle
recorded `commitSha: "unknown"`. An artifact on a device could not be tied back to a commit, which
makes an install centre meaningless. The build now reads the git SHA and passes an explicit build
environment: pos, driver and restaurant bundles all report their SHA and `staging`.

### 28.3 Android is one owner action from real artifacts (`4d2374d`)

`scripts/build-android-apps.mjs` finds the JDK and the Android SDK, builds a debug **APK**, and
builds a release **AAB** only when an upload keystore is configured, so an unsigned artifact cannot
be mistaken for a releasable one. When the Android SDK licence has not been accepted it stops with
the exact `sdkmanager` commands instead of failing deep inside Gradle. Loohar does not accept a
licence agreement on the owner's behalf. Verified: it exits 2 with that message today.

### 28.4 POS device platform designed (`ba06e22`)

`docs/pos/LOOHAR_POS_DEVICE_DEPLOYMENT_MANUAL.md`. Loohar does not build an operating system:
dedicated Android POS terminals already run Android, so the work is managing one properly — Device
Owner provisioning, lock-task kiosk, single-use enrolment codes, restaurant/location/register
binding, printer and reader pairing, staged updates with rollback, and health reporting.

The manual leads with the boundary that usually causes disappointment. A **boot logo, firmware
branding, printer and reader SDKs, a customer display and OTA support come from the manufacturer**,
not from Loohar, and a boot logo in particular must be ordered up front with a minimum quantity. It
ends with a questionnaire to send verbatim to a hardware vendor. Status: **NOT STARTED** — no device
image, no provisioning package, no hardware tested.

### 28.5 Gates

lint, security scan, `npm test` with all 8 surfaces, 22 database suites (160 tests), and the staging
certification re-run at each candidate.


## Changelog index
