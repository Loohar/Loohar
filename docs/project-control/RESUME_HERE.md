# Resume Loohar in a new session

You do not need to explain the project again. Everything needed to continue is in this repository.

## Say this

> Continue the Loohar project. Read `docs/project-control/RESUME_HERE.md`.

That is enough. If you want to be explicit, add what you want done, for example
"start the card payment phase" or "what is waiting on me?".

## What the session should read, in order

1. **`docs/project-control/LOOHAR_PROJECT_CONTINUITY.md`** — what Loohar is, architecture,
   environments, live SHAs, procedures, rollback. Written so a session with no memory can rebuild
   the picture from nothing.
2. **`.pilot/state.json`** — machine-readable and authoritative for item status. `nextAutonomousTask`
   says what to pick up. `incidents` records what has gone wrong and why.
3. **`docs/project-control/LOOHAR_CURRENT_STATUS.md`** — the one-page view.
4. **`docs/project-control/OWNER_ACTIONS.md`** — what is blocked on the owner, and nothing else.
5. **`docs/project-control/LOOHAR_OPERATING_DIRECTIVE.md`** — the standing rules: the 0% Loohar
   transaction fee principle, the priority order, what must never be presented as done.

The Development Book in `docs/project-record/` holds the narrative, one chapter per working day,
including the mistakes. Read it when you need to know *why* something is the way it is.

## Where things stood on 2026-09-24

**Loohar is live.** `main`, the production API, `loohar.com` and staging all run
`94f16708dfdf0a0e3669afed1cf80f612ad2f773`. Two-step verification works end to end; the owner is
enrolled. Cash payments are certified. Card payments are deliberately out of scope and fail closed.

**Waiting on the owner:** Stripe TEST Connect onboarding (blocks all card certification), Vercel
access to the `loohar` scope, Supabase re-authentication, Apple and Google developer accounts.

**Next autonomous work** is whatever `nextAutonomousTask` says in `.pilot/state.json`.

## Rules that survive between sessions

- Verify against the live systems before trusting any document here, including this one. Where they
  disagree, the running system and `git log` win.
- A claim needs executable evidence. "PASS" from reading source is not evidence for behaviour that
  runs.
- Production releases: the owner approves the exact SHA; deploy the API before fast-forwarding
  `main`, because Vercel publishes the web automatically from `main`.
- Never print, commit or transmit a secret. Credentials for the staging demo tenant live outside the
  repository at `~/.loohar/`.
