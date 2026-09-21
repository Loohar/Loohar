## 33. Change records — 2026-09-21: Android stops being a promise

Release candidate `8ec80c1 → 3001f9e`. Staging runs `3001f9e`; production untouched at `0526862`.

### 33.1 The licence (owner action, 2026-09-21)

Android had been the one deliverable still honestly labelled **SOURCE READY** — a Gradle project
that had never once been built, because Google's SDK manager refuses to download a single package
until a person accepts the licence agreement. Loohar would not accept a legal agreement on the
owner's behalf, so `scripts/build-android-apps.mjs` exited 2 and printed the exact commands instead
of failing deep inside Gradle.

The owner accepted all 7 licences. Two things were then true that had not been before: the SDK could
fetch `platform-tools`, `platforms;android-36` and `build-tools;36.0.0`, and the apps could be built.

Worth recording for the next person: the `!`-prefixed shell in the session captures output but gives
the command no live keyboard, so the first attempt reached `Review licenses (y/N)?`, hit end-of-input
and defaulted to **N**. Nothing was accepted and no licence files were written. An interactive
acceptance needs a real terminal, or `yes |` for a non-interactive one.

### 33.2 Three APKs, and why they were checked (`8ec80c1`)

`npm run build:android -- --app all --env staging` produced three 5.9MB debug APKs: `com.loohar.pos`,
`com.loohar.driver`, `com.loohar.restaurant`.

The first build took **16m34s** and the next two took **7 seconds each**. That is fast enough to be
suspicious rather than pleasing, so it was checked instead of reported. The explanation is benign —
the first build was almost entirely the one-time Gradle 8.14.3 download and dependency resolution,
cached in `~/.gradle` afterwards — and the evidence is three distinct SHA-256 hashes, three distinct
package ids and labels, and build timestamps 19 and 9 seconds apart.

Each APK was unzipped. Every bundle carries `commitSha 8ec80c14e168`, `environment: staging`, the
staging API origin, and **no production origin anywhere**, so an APK cannot silently point at
production and any installed build traces back to its commit.

One unrelated failure on the way: the release-candidate worktree's `node_modules` predated
`@aparajita/capacitor-secure-storage`, so the web bundle would not build. `npm install` in that
worktree fixed it with no lockfile change.

### 33.3 Driving them through the real interface (`3001f9e`)

An APK that installs proves only that it parses. `scripts/test-android-ui.mjs` is the Android
counterpart of the iOS suite from chapter 32: it installs each debug APK on an emulator, launches it,
and asserts against the live DOM.

| Check | What it proves |
| --- | --- |
| The app launches | An explicit `am start -W` returns ok and the process has a live pid |
| It routes to its own sign-in screen | The app reaches `/restaurant/login`, its own surface |
| Email and masked password fields | The form a person actually types into exists |
| Its live-API indicator reads "Connected" | The app made a **real request** to the environment it was built for. A refused CORS origin or a wrong API URL fails here |
| Typing is accepted, password masked | The interface is genuinely interactive |
| Nothing crashed | The crash buffer is clean for that package |

Three Android-specific things had to be worked out rather than assumed:

- **`uiautomator dump` is useless here.** It returns the `android.webkit.WebView` node and *no text
  at all*, because Chromium populates the accessibility tree only when an accessibility service is
  attached. The DOM is read over the **Chrome DevTools Protocol** instead, forwarded from the app's
  `webview_devtools_remote_<pid>` socket. Debug builds enable that socket, which is why certification
  runs against the debug APK.
- **`adb shell monkey` reports success without starting a Capacitor activity.** The first launch
  attempt returned cleanly and left no running process. The suite uses an explicit
  `am start -W -n <pkg>/<pkg>.MainActivity` and then checks `pidof`.
- **The emulator image must be `arm64-v8a`** on Apple Silicon.

**Result at `3001f9e`: 18 of 18** across POS, Driver and Restaurant on a Pixel 7 / Android 16
emulator. Reproducible with `npm run test:android-ui -- --app all`.

### 33.4 The negative control

A suite that cannot fail is not evidence. The emulator was put into airplane mode and the POS suite
re-run: the live-API check **failed**, as it must, and so did the routing check — offline, the app
stays on `/restaurant/pos` instead of redirecting to login. Network restored, 6 of 6 again.

That is the difference between asserting the indicator exists and asserting it says something true.

### 33.5 What is still not claimed

Neither platform has run on **physical hardware**. Neither suite covers a **signed-in workflow**;
both stop at the sign-in screen, because that needs a certification tenant, and that is the next
task. A release **AAB** is still refused without a Google Play upload keystore, so an unsigned
artifact cannot be mistaken for a releasable one. Nothing is signed, submitted or published.

**Gates.** lint · Prisma schema valid · staging verified live at `3001f9e` · production confirmed
unchanged at `0526862`.

**Rollback.** Test-only: one new script, its npm entry and documentation. No runtime code changed.

**Next.** A signed-in workflow in both UI suites using a certification tenant, and staging
certification extended to online ordering and offline POS reconnect.


## Changelog index
