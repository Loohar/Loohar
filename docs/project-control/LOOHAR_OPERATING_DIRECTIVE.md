# Loohar Operating Directive

The owner's standing instructions for how Loohar is built and what it is. Recorded 2026-09-20 so
that a session with no conversation history still operates correctly. Where this and a conversation
disagree, the owner's latest instruction wins; where this and the code disagree, the code describes
what exists and this describes intent.

## 1. What Loohar is

A multi-tenant SaaS restaurant operating platform. **The restaurant is the paying customer**, not
the diner. It must stay usable both as a cloud SaaS platform and as a practical restaurant POS
operating ecosystem.

**Loohar must not become a consumer marketplace unless the owner explicitly approves it.** Any
feature that would place Loohar between diners and restaurants as the brand of record needs that
approval first.

The integrated ecosystem covers restaurant management, POS, KDS, online ordering, restaurant
websites and SEO, payments, receipts, refunds, voids, tips, employees and clock-in/out, customers,
reporting, tax, delivery, drivers, inventory, discounts, loyalty, multi-location, hardware and
device management, native applications, Super Admin operations, and AI assistance only where safe.

Restaurant financial data and tenant data remain isolated. Full model:
`docs/business/LOOHAR_BUSINESS_CONSTITUTION.md`.

## 2. Required products

1. Loohar SaaS Web Platform
2. Loohar Restaurant App
3. Loohar POS App
4. Loohar Driver App
5. Loohar KDS
6. Loohar dedicated POS-device platform
7. Loohar Super Admin / platform operations

Native applications must become genuinely installable applications, not responsive web pages. They
reuse the one authoritative Loohar backend; **no competing backend implementations.**

## 3. The money principles

Money is server-authoritative: menu pricing, modifiers, discounts, coupons, tax, tips, split
payments, cash, online card, card-present, refunds and partial refunds, voids, reconciliation,
reporting, offline cash and reconnect. Concurrency and idempotency are tested, not assumed.

**The 0% Loohar transaction fee principle.** Loohar's commercial direction is to charge no
percentage markup of its own on a restaurant's customer transactions. Two rules follow:

- **Unavoidable card-network and processor fees are never represented as zero**, anywhere: product
  copy, documentation, reporting or a sales claim.
- Loohar SaaS subscription revenue stays separate from restaurant customer payment processing. Diner
  payments settle as Stripe Connect direct charges on the restaurant's own account.

Negotiated and interchange-plus processor pricing must remain supportable. **Live commercial pricing
is never changed without owner approval.**

## 4. Performance

The POS must feel immediate. No unnecessary network calls, loading screens or blocking operations in
common cashier interactions. Cached or local UI state with authoritative server reconciliation is
preferred wherever financial and security correctness allows — money stays server-authoritative
regardless.

## 5. Priority order

1. Financial correctness
2. Tenant and security isolation
3. Authentication and authorization
4. Operational reliability
5. POS and KDS correctness
6. Payment correctness
7. Offline and reconciliation
8. Customer ordering
9. Delivery and driver correctness
10. Reporting and management
11. Native applications
12. Device platform
13. Monitoring and backups
14. Documentation completeness
15. Optional enhancements

Correctness is never traded for feature count. Cosmetic work waits while any actionable critical
issue remains.

## 6. How work proceeds

Discover → prioritise → implement → test → security and adversarial test → regression test → build →
certify → commit → secret scan → push → integrate into `release/loohar-pilot-rc-v01` → deploy
staging → verify the exact SHA → update documentation → select the next highest-priority work →
continue. No validated work is left only on the owner's computer. An owner blocker is recorded and
other independent work continues immediately.

## 7. Release engineering

`main` is the stable validated integration branch; **production deployment is a separate,
owner-controlled, exact-SHA operation.** Merging to main must never implicitly deploy production.

**Current blocker:** `loohar.com` is served by a Vercel project the available account cannot
enumerate, and Vercel deploys production from the production branch by default, so a merge to main
could publish the web to production while the API stayed behind. Until that is verified or
separated, nothing is merged to main. See `OWNER_ACTIONS.md` item 1. This is a release-engineering
blocker, never a reason to pause development.

## 8. Records that must stay current

`LOOHAR_CURRENT_STATUS.md` · `OWNER_ACTIONS.md` · `../releases/LOOHAR_BUILD_AND_INSTALL_STATUS.md` ·
`LOOHAR_PROJECT_CONTINUITY.md` · `.pilot/state.json` · the Development Book and its PDF workflow ·
the Restaurant Owner, Platform Admin, Employee/POS, Driver and POS Device manuals · the operations
runbook.

Every meaningful milestone records: date, feature or defect, why it matters, branch, exact SHA,
implementation, security impact, tests, staging evidence, limitations, rollback, next step.
**Evidence is never fabricated.**
