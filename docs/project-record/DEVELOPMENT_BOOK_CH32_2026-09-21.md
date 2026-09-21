## 32. Change records — 2026-09-21: driving the apps for real

Release candidate `1361cc6 → 8ec80c1`. Staging runs `8ec80c1`; production untouched at `0526862`.

### 32.1 The gap that had been left open (`8ec80c1`)

The native apps had been certified two ways: launched and screenshotted, and separately proven at
the network layer by replaying the whole pilot workflow with the app's own origin. Neither touched
the interface a person actually uses. That was recorded as not done rather than dressed up, and this
closes it.

**Architecture.** `apps/mobile/uitests` is a standalone XCUITest project, deliberately outside the
Capacitor projects: `npx cap add ios` regenerates those from a template and would silently discard a
target added there. XCUITest attaches to any installed app by bundle identifier, so one suite drives
all three apps, selected with `LOOHAR_APP_BUNDLE_ID`. The Xcode project is generated from
`project.yml` by XcodeGen, so it is a build artifact and not committed source.

**What the tests assert.** They read the live view hierarchy, not a picture of it:

| Test | What it proves |
| --- | --- |
| Sign-in screen renders | The app routes to its own surface and draws the email and password labels |
| Live API indicator reads "Connected" | The app made a real request to the environment it was built for. A refused origin or a wrong URL fails here |
| Typing into the form | The interface is genuinely interactive, and the password field is a secure field |

**Result at `1361cc6`: 9 of 9** across Loohar POS, Driver and Restaurant, with screenshots attached
to the results. Reproducible with `npm run test:native-ui -- --app all`.

**Limitations.** Physical-device certification is still not claimed: the same suite will drive a
device once Apple signing exists, which is an owner action. Android cannot be built at all until the
SDK licence is accepted. The suite covers the signed-out surface; a signed-in workflow needs a
certification tenant and is the next step.

**Rollback.** Test-only addition; nothing in the product changed. Production untouched.


## Changelog index
