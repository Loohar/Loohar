## 29. Change records — 2026-09-20: operating directive, and cash that arrives late

Release candidate `ba06e22 → 0f93841`. Staging runs `0f93841`; production untouched at `0526862`.

### 29.1 The owner's operating directive is now in the repository

`docs/project-control/LOOHAR_OPERATING_DIRECTIVE.md` records what Loohar is and must not become, the
**0% Loohar transaction fee** principle with the standing rule that unavoidable card-network and
processor fees are **never** represented as zero, the POS responsiveness requirement, the fifteen-step
priority order, and the position that `main` is an integration branch while production stays a
separate owner-controlled exact-SHA operation. It is in the repository so a session with no
conversation history still operates correctly, and the continuity document points at it first.

### 29.2 Offline cash arriving after a shift closed rewrote the counted drawer (`0f93841`, L-65)

**Why it matters.** A cash drawer's balance becomes the *counted* cash when its shift closes. Cash
settlement incremented that balance unconditionally. An offline sale can arrive after its shift has
closed — the sale happened during the shift, so those notes were physically in the drawer when the
cashier counted it. Incrementing afterwards pushed the system above the physical count and silently
contradicted the close, while the shift's variance had already been computed without the sale.

Measured on a real database: a drawer counted at **10000 became 12000** after a late reconciliation.

**Implementation.** The sale is still recorded in full — order, payment, cash ledger entry against
its own shift, and receipt — because the money is real and losing it would be worse than the
variance. Only the counted balance is left alone, and the reconciliation records
`pos.offline_cash.settled_after_shift_close` with `requiresReview`, the amount, the shift and the
drawer, so a person sees that the closed shift's numbers no longer tell the whole story.

**Security and money impact.** No money is created or destroyed; a counted figure is no longer
overwritten, and a discrepancy that used to be silent is now visible and attributable.

**Tests.** `scripts/pos-closed-shift-cash-db-test.mjs`: the open-shift case still credits the drawer,
the closed-shift case leaves the counted balance untouched while recording sale, ledger and receipt,
and the sale stays inside its own tenant. The closed-shift case fails on the previous commit at 12000
instead of 10000. `settleCashOrderTransaction` is exported so the rule can be exercised directly,
because the closed-shift case is only reachable through offline reconciliation.

**Staging.** Deployed at `0f93841`; the native-origin pilot certification re-run 20/20.

**Limitations.** The remaining L-28 findings are untouched: SVG upload blocklist, checkout customer
record by email, and logout needing an unexpired access token.

**Rollback.** Nothing released; production untouched. Staging rolls back with
`node scripts/deploy-staging.mjs <previous-sha>`.

**Next.** The remaining L-28 items, then an XCUITest target so the apps can be driven through their
real UI.


## Changelog index
