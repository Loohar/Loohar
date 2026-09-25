# Loohar POS on Android — building and installing

The Android apps install directly from a file. **No Google Play account and no licence are needed
for this**, because Android installs any correctly signed APK once the device is told to allow it.
Play is only required to distribute *through the Play Store*.

## What exists

| App | Package | Artifact |
| --- | --- | --- |
| Loohar POS | `com.loohar.pos` | `apps/mobile/pos/android/app/build/outputs/apk/release/app-release.apk` |
| Loohar Driver | `com.loohar.driver` | `apps/mobile/driver/android/…/app-release.apk` |
| Loohar Restaurant | `com.loohar.restaurant` | `apps/mobile/restaurant/…/app-release.apk` |

About 4.9 MB each, signed with the Loohar release key.

## Building

Once, to create the signing key:

```
node scripts/android-keystore.mjs
```

It generates the keystore and a random password, writes both to `~/.loohar/android/` with mode 600,
and prints neither. **Back that directory up.** Android refuses to update an installed app with a
build signed by a different key, so losing the keystore means every restaurant must uninstall and
reinstall, losing local state.

Then, for each build:

```
export LOOHAR_ANDROID_KEYSTORE_PROPERTIES=$HOME/.loohar/android/keystore.properties
npm run build:android -- --app all --env staging --release
```

`--env production` builds against the production API instead. `--bundle` produces an AAB, which is
only useful for Play.

The build verifies its own output with `apksigner` and refuses to report an artifact as built if it
is not correctly signed, because an unsigned APK looks like a real one and cannot be installed.

## Installing on a restaurant's device

1. Copy the `.apk` to the device, or download it there.
2. Open it. Android will say the source is not allowed; choose **Settings** and enable installs from
   whatever app is opening it (usually Files or Chrome).
3. Install, then open **Loohar POS**.
4. Sign in. The register asks to be registered as a terminal the first time, then unlocks with the
   cashier PIN.

The "unknown source" warning is normal for software installed outside Play and is not a sign of a
problem with the app.

## Which API a build talks to

Fixed at build time and cannot be changed afterwards, so a staging build can never reach production.
`--env production` requires `ALLOW_NATIVE_APP_ORIGINS=true` on the production API, because the app
loads from `https://localhost` and production CORS refuses that origin by default. That is a
production configuration change and an owner decision.

## WebView debugging, and what it does not protect

`capacitor.config.json` sets `android.webContentsDebuggingEnabled: false` for all three apps, so a
release build does not offer its WebView to `adb` for inspection.

**This could not be verified on the emulator**, and the reason matters. The Loohar certification
emulator is a `userdebug` Android build with `ro.debuggable=1`, and Android force-enables WebView
debugging on such a device regardless of what an app asks for. The release APK is a proper release
build — it carries no `android:debuggable` flag — and on a normal `user`-build device the default
would already be off; the explicit setting is belt and braces.

The consequence is worth understanding before choosing POS hardware: **cheap Android POS terminals
often ship `userdebug` images**, and on those the WebView is inspectable over USB whatever the app
configures. Anyone with physical access and a cable could read the signed-in session. On that class
of device the mitigation is device policy — disabling USB debugging, locking the bootloader — not
application configuration.

## Distribution: direct install, by decision

The owner declined both the Apple Developer Program and a Google Play account on 2026-09-25. Direct
install is not a stopgap while store accounts are arranged — it **is** the distribution model, and it
is the reason none is needed.

Two consequences, accepted deliberately:

- **No App Store or Play Store listing.** Restaurants receive the APK from Loohar.
- **iOS cannot be installed on physical hardware.** An Apple membership is required for that, and for
  TestFlight, so the iOS apps remain simulator-only. Android is the mobile platform for Loohar.

## Still not done

- The release APKs have been installed, launched and confirmed running with no crash on an emulator.
  They have never run on physical hardware.
- Updates are delivered by sending a new APK; there is no in-app update check yet.
