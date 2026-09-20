# Staging pilot certification — candidate `3b2af70`

Run 2026-09-20 with `npm run certify:pilot:staging` (script committed at `9a2cc88`) against
`https://loohar-api-staging.onrender.com`. Production stayed at `0526862` and was never touched.
The tenant was created through public signup, so no owner credential was used. Stripe was not
involved: this certifies the **cash** path. Every figure below is from the server's own response.

**Result: 19 of 19 steps passed.**

| Step | Result |
| --- | --- |
| Public signup | Accepted, Starter tenant provisioned on the introductory trial |
| Owner sign-in before MFA | Limited to account setup |
| MFA enrolment | Wrong authenticator code refused; wrong password refused; enrolled with 10 recovery codes |
| MFA sign-in | Password alone challenged, no token issued; wrong code refused; correct code signs in |
| Tax without a category | Stays `REVIEW_REQUIRED` and cannot be activated — Loohar never guesses a category |
| Tax with the category | Live Colorado TTR: **9.15%**, Denver, City and County, `VERIFIED`, provider `COLORADO_TTR` |
| Tax acknowledgement | Profile active at 9.15% |
| Menu | One category, one item at 1450 |
| Main terminal | Registered with its own cash drawer |
| Drawer count | **Exactly one drawer for one terminal** — the L-21 fix confirmed on staging |
| Cashier PIN | Set; a wrong PIN refused; register unlocked |
| Shift | Opened with a 100.00 float |
| Server-priced sale | Subtotal **2900**, tax **265** at the activated 9.15%, total **3465** |
| Order | Sent to the kitchen |
| Cash settlement | Tendered 3965; payment recorded at the **server total 3465**, status PAID |
| Kitchen | Holds the ticket |
| Day reconciliation | Collected **3465**, refunded 0 |

The subtotal, tax and total match the `9ad8708` certification exactly, so the money math is
reproducible across the whole candidate chain.

## Limitations of this run

- **Cash only.** Online card and Stripe Terminal need a tenant with completed Stripe Connect
  onboarding, which is an owner step.
- No refund was exercised here; refund behaviour is covered by the database suites.
- The Colorado product/service category used is a value this staging TTR account accepts. It is not
  a recommendation: a real restaurant must use the category from its own Colorado state account.
- The live TTR provider intermittently answers 401/403, which Loohar reports as
  `TAX_PROVIDER_AUTH_FAILED`. The script retries. See the open finding on that error mapping.
