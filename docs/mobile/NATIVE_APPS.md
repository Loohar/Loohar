# Loohar Native Apps — POS and Driver

Status as of 2026-09-19: both apps **build, install and run on the iOS Simulator against staging**
(evidence: `~/Documents/Loohar/Evidence/native-apps/`). Android projects are generated but not yet
built. **Nothing has been published** to the App Store or Google Play. Store release needs Apple and
Google developer accounts and signing, which are owner steps (see §9).

## 1. Architecture

Both apps are [Capacitor](https://capacitorjs.com) 8.5.2 shells around the **same web build** as
loohar.com. They reuse every screen, API call, permission check, tenant boundary and server-computed
amount. There is no second POS or driver implementation, no client-side money logic and no separate
backend.

| App | Bundle ID | Opens at | Project |
| --- | --- | --- | --- |
| Loohar POS | `com.loohar.pos` | `/restaurant/pos` | `apps/mobile/pos` |
| Loohar Driver | `com.loohar.driver` | `/driver` | `apps/mobile/driver` |

The web bundle is **packaged inside the app** rather than loaded from a server, so the POS can start
with no network. That is required for offline cash sales. Native-only behaviour lives in
`apps/web/src/shared/nativeApp.js` and `apps/web/src/main.jsx` and is active only when
`VITE_NATIVE_APP` is set **and** the Capacitor runtime is present. The website is unaffected.

## 2. Supported platforms

| Platform | Minimum | Status |
| --- | --- | --- |
| iOS / iPadOS | per Capacitor 8 template | Simulator build verified; device and store builds need signing |
| Android | API 24 (Android 7.0), target/compile 36 | Project generated; build blocked on the Android SDK licence (owner) |

## 3. Build

```
npm run build:native -- --app pos|driver|all --env staging|production
```

This builds the web bundle for the chosen app and environment into `apps/mobile/<app>/www`, then
runs `cap sync` to copy it into the iOS and Android projects. Every API, health and realtime URL is
absolute, because inside the app a relative `/health` would resolve to the app itself.

iOS simulator build (unsigned):

```
cd apps/mobile/pos/ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -packageAuthorizationProvider netrc -skipPackagePluginValidation -skipMacroValidation \
  CODE_SIGNING_ALLOWED=NO build
```

`-packageAuthorizationProvider netrc` matters. Without it, a non-interactive `xcodebuild` asks the
macOS Keychain for github.com credentials before downloading Capacitor's binary frameworks, and it
**hangs silently** waiting for an approval dialog nobody sees (seen 2026-09-19).

Android (after the SDK licence is accepted): `cd apps/mobile/pos/android && ./gradlew assembleDebug`
with `JAVA_HOME` pointing at JDK 21 (`/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`)
and `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`.

## 4. Environments

| `--env` | API | Requirement on that API |
| --- | --- | --- |
| `staging` (default) | `https://loohar-api-staging.onrender.com` | `ALLOW_NATIVE_APP_ORIGINS=true`. **Set on staging 2026-09-19.** |
| `production` | `https://loohar-api.onrender.com` | `ALLOW_NATIVE_APP_ORIGINS=true`. **Not set. It is a production env change and needs owner approval at release.** |

The environment is fixed at build time. A staging build can never talk to production.

## 5. CORS

The apps' page origin is `capacitor://localhost` (iOS) or `https://localhost` (Android). The API
allows exactly these two origins, and only when `ALLOW_NATIVE_APP_ORIGINS=true`
(`apps/api/src/config/corsPolicy.js`). No port and no other scheme is allowed. This grants a browser
page nothing: no browser can present `capacitor://`, and the API reads credentials only from the
bearer header and sets no cookies. Covered by `npm run test:native-app-cors`, which includes a boot
of the real API in production mode.

## 6. Credentials on the device

Access and refresh tokens are stored in the **iOS Keychain / Android Keystore**
(`@aparajita/capacitor-secure-storage` 8.0.0, key prefix `loohar_`), never in WebView storage. They
are loaded before the first render so the synchronous `authStorage` API still works. Tokens left in
WebView storage by an earlier build are moved into the keystore once and then deleted. If the
keystore cannot be opened, the app **fails closed**: tokens stay in memory and the user signs in again
next launch. The POS session token (register/employee) is memory-only, as on the web.

## 7. Offline and updates

- The bundled web app launches without network. Offline cash uses the existing signed-price proofs
  and reconciliation (`apps/web/src/apps/pos/offline*.js`). The server re-derives every price, and
  a tampered price is refused. **Card payments are never offline.**
- There is no service worker in the apps, because the bundle is already local.
- **Updates ship as new app builds.** A web deploy to loohar.com does not update an installed app.
  Every release that changes the POS or Driver UI needs a new store build.

## 8. Permissions

No native permissions are requested yet (no camera, location, Bluetooth or notifications). Driver
navigation hands off to the platform maps app by link. A native plugin that needs a permission must
add its usage description (iOS `Info.plist`) or manifest entry (Android) and be recorded here.

## 9. Owner steps before store release

1. **Android:** accept the Android SDK licence once:
   `yes | /opt/homebrew/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager --licenses`,
   then install `platforms;android-36`, `build-tools;36.0.0` and `platform-tools`.
2. **Apple Developer Program** membership, an App Store Connect record per app, and a signing team
   selected in Xcode (for device builds and TestFlight).
3. **Google Play Console** account, an app record per app, and an upload keystore. The keystore must
   **never** be committed.
4. Store listings (privacy details, screenshots from real builds, support URL) and review.
5. At production release: `ALLOW_NATIVE_APP_ORIGINS=true` on the production API.

## 10. Known limitations

- Printing: the POS uses browser printing, which a native WebView does not provide in the same way.
  Printer integration in the apps is **not verified**.
- Stripe Terminal: internet readers are driven server-side and should work unchanged. Tap to Pay on
  iPhone would need the native Terminal SDK and is **not implemented**.
- Signed-out `/driver` shows the generic "Platform Login" (same as the web), not a driver-branded
  screen.
- Android is not yet built or run.
