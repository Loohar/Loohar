## 30. Change records — 2026-09-21: two ways in, both closed

Release candidate `0f93841 → 16d34a6`. Staging runs `16d34a6`; production untouched at `0526862`.
Working the owner's priority order, both items this session were security.

### 30.1 SVG uploads were screened by a blocklist (`8edac79`, L-66)

**Why it matters.** SVG is accepted for restaurant logos, and a browser runs script inside an SVG
opened as a document. Uploads were screened by rejecting `<script`, an `on…=` attribute, or the
literal `javascript:`. Blocklists lose. Each of these passed and still ran script or pulled in
outside content from the restaurant's own storage domain:

| Payload | Why the blocklist missed it |
| --- | --- |
| `<set attributeName="onload" to="alert(1)"/>` | SMIL, so no `on…=` token appears |
| `<foreignObject><body onload=…>` | HTML smuggled inside the SVG |
| `<use xlink:href="data:image/svg+xml;base64,…"/>` | the payload arrives by reference |
| `<a href="java&#115;cript:alert(1)">` | entity encoding hides the scheme |
| `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///…">]>` | entity expansion, never considered |

**Implementation.** `services/svgSafety.js` is an allowlist: every element and attribute must be one
a logo legitimately needs. Scanning happens after numeric entities are decoded, so encoding cannot
hide a payload; DOCTYPEs, entities and CDATA are refused outright; any attribute value carrying a
script or data URL, or a style that loads outside content, is refused. SVG was kept rather than
removed, because the product offers it specifically for logos.

**Tests.** `scripts/svg-upload-safety-test.mjs` drives the real upload path: a genuine
gradient-and-path logo is still accepted, all nine payloads are refused with a reason, and the suite
asserts that the previous blocklist accepted at least six of them, so the gap is recorded rather
than merely described.

### 30.2 Signing out did nothing once the token expired (`16d34a6`, L-67)

**Why it matters.** An access token lives 15 minutes. Logout required an unexpired one, so a cashier
who stepped away and came back to press "log out" got a 401 and the session was never revoked. The
refresh session stayed alive and the refresh token in browser storage kept working. On a shared
restaurant device, the sign-out the person believed in had not happened.

**Implementation.** Logout accepts an expired access token, because revoking a session is not
granting access: the signature still proves Loohar issued it, and only the session it names is
revoked. The allowance is deliberately narrow — `verifyAccessTokenForRevocation` exists solely for
logout, and everything that grants access still refuses an expired token. Forged, malformed and
missing tokens are still refused and revoke nothing.

**Tests.** `scripts/logout-expired-token-db-test.mjs` boots the real auth routes over HTTP against a
database and covers all of the above. The expired-token cases fail on the previous commit.

**Limitation, unchanged.** Refresh tokens still live in browser storage (L-26, deferred with the
cookie redesign). This reduces the consequence by making the sign-out that clears them actually
revoke the session.

### 30.3 Gates and staging

lint · security scan · `npm test` with all 8 surfaces · **24 database suites, 167 tests, zero
skips**. Deployed to staging at `16d34a6` and the native-origin pilot certification re-run 20/20.

**Rollback.** Nothing released; production untouched at `0526862`.

**Next.** The last remaining L-28 item, checkout creating or matching a customer record by email,
then an XCUITest target so the apps can be driven through their real UI.


## Changelog index
