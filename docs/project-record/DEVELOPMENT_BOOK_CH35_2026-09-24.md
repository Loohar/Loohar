## 35. Change records — 2026-09-24: the release broke a sign-in path, and how that was possible

Production moves `15a1f14 → 03ba606`.

### 35.1 What broke

The release added a hard production requirement for `MFA_ENCRYPTION_KEY`, a key deliberately kept
separate from `JWT_SECRET` so that rotating the latter can never make stored authenticator secrets
unreadable. Production did not have it. Every `POST /api/auth/mfa/enroll/start` threw, returned 500,
and showed the owner "Internal server error" when they clicked **Start setup**.

No customer-facing function was affected. Ordering, the POS, the public site and sign-in itself all
worked; what failed was two-step verification enrolment, which privileged roles must complete.

### 35.2 Three failures, not one

**The pre-release check was wrong.** New required variables were identified by hand with a grep for
the literal `process.env.NAME`. The code reads `env.MFA_ENCRYPTION_KEY` through a function
parameter, so the name never appears next to `process.env`, and the check reported "no new required
env vars". It was the right check, asked the right question, and answered it incorrectly.

**Nothing validated configuration at boot.** The API started happily and `/health` reported `ok`
while a sign-in path was entirely broken. Health meant "the process is running", not "this build can
do its job".

**The failures were logged nowhere.** `errorHandler`'s final branch returned "Internal server error"
and logged nothing at all. Seven consecutive production 500s produced no log entry, so no alert was
possible and the cause had to be reasoned out from source rather than read.

### 35.3 Why the fix took several attempts

Setting the variable did not change the symptom, because **a running Node process cannot see
variables added after it started**, and the service has auto-deploy off — deliberately, so a push
cannot release production — which means saving a variable restarts nothing. The unchanged instance
id in the logs was what finally proved the old environment was still in force; a deploy entry alone
would not have.

Then a deploy requested for `03ba606` shipped `15a1f14` instead. **Render deploys the service's
tracked branch and silently ignores a commit id that is not on it.** The deploy succeeded and looked
correct. `main` had to be fast-forwarded first.

And when the guard finally ran in production, it refused: the key was still not on `loohar-api`. That
is how we learned it had never been there, which also explained why the earlier restart changed
nothing.

### 35.4 The guard proved itself by failing

The first production deploy of `03ba606` was **refused**:

```
Error: Refusing to start: required production configuration is missing.
  MFA_ENCRYPTION_KEY is not set: authenticator secrets and recovery codes cannot be encrypted,
  so no privileged user can enrol in or pass two-step verification
```

Render rolled back, production kept serving `15a1f14`, and there was no downtime. That is the
behaviour the guard exists for, demonstrated on the real system rather than argued for. Once the key
was set, the same commit booted.

### 35.5 What now prevents a repeat

`apps/api/src/config/requiredEnv.js` checks required production configuration before the server
listens, so a missing variable fails the deploy instead of shipping a half-working release. The
message names the variable, what breaks without it, and the fact that a running process cannot see
variables added later.

`errorHandler` logs every unhandled 5xx with the route pattern — never the URL, which carries
tracking and receipt tokens — plus the message, the stack and a request id, and returns that id to
the caller so a person can quote it. The body still never includes the message, which can carry a
connection string.

`scripts/env-var-diff.mjs` replaces the hand-rolled grep. It matches `process.env.NAME`, `env.NAME`
and `env['NAME']`, and flags any name read inside a throw. Run against the incident it reports
`MFA_ENCRYPTION_KEY` as REQUIRED and exits non-zero, so it would have blocked the release.

`STRIPE_CONNECT_SECRET_KEY` is a warning rather than a boot failure, because card payments are
deliberately excluded from this deployment and a release without them must still start.

### 35.6 Still not claimed

Two-step verification enrolment has **not** been confirmed working by a real attempt. The guard
proves the key is loaded, because the API would not have started otherwise, but that is not the same
as watching an enrolment succeed. Until one does, this is fixed in principle and unverified in fact.


## Changelog index
