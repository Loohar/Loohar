## 36. Change records — 2026-09-24: scanning instead of typing

Production moves `03ba606 → 94f1670`. Web only: no API change, no migration.

### 36.1 Why

Two-step verification enrolment displayed a 32-character base32 key and asked the person to type it
into their authenticator app. That is where people give up, and a single mistyped character is
unforgiving in a way nothing on screen explains: the app accepts the key, generates codes, and those
codes are simply never valid.

The owner asked for a QR while in the middle of exactly that, and they were right.

### 36.2 What shipped

The panel now leads with a scannable QR. The typed key moved behind a **"Can't scan? Enter the key
by hand"** disclosure rather than being removed, because a QR is useless when the authenticator app
is on the same device as the screen, or when no camera is available. The existing "Open in an
authenticator app on this device" link stays for that case too.

The image is drawn in the browser from the `otpauth://` URL the server already returns, so the secret
is not sent anywhere new in order to make a picture of it. `qrcode` was already an `apps/web`
dependency. A failure to draw returns an empty string rather than throwing, so a broken QR can never
block enrolment while the typed key still works.

### 36.3 Testing a picture

A QR that renders but encodes the wrong thing is worse than no QR at all: the authenticator silently
adds an account whose codes are never accepted, and the person has no way to tell. Asserting that an
`<img>` appeared would not catch that.

So `scripts/mfa-enrolment-qr-test.mjs` decodes the generated image with `jsqr` and asserts it comes
back **character for character** as the URL the server builds — secret, issuer, digits and period —
including for an email address that needs escaping.

**Gates:** lint · 4 new tests · `npm test` · 8 of 8 web surfaces rendered in a real browser ·
staging clean at the same SHA.

### 36.4 A gate earning its place

The first run of the browser surface gate failed 7 of 8. The cause was not the change: the bundle had
been built pointing at the staging API, so the test pages hit a real CORS boundary. Rebuilt the way
the harness expects, 8 of 8 passed.

Worth recording because the instinct on seeing seven red lines is to distrust the gate. The gate was
right to fail — the artefact under test genuinely was wrong.

### 36.5 Verified live

`main`, the production API, `loohar.com` and staging all report `94f1670`. The shipped JavaScript was
fetched from `loohar.com` and confirmed to contain the QR markup, the login page rendered with no
runtime exception, and the sign-in card reported "Live API Connected".

Then the real proof: the owner scanned the new QR and enrolled. `POST /api/auth/mfa/enroll/confirm`
returned **200**, closing INC-2026-09-23.

### 36.6 Recorded, not hidden

The web published before the API for the second release running. It was harmless both times — the
commits changed no API code — but the ordering rule exists precisely so that cannot bite, and it was
broken by merging `main` before the Render deploy had finished. Vercel auto-publishes from `main` and
that project is still outside this account's reach, so the durable fix is access to it rather than
care at the keyboard.


## Changelog index
