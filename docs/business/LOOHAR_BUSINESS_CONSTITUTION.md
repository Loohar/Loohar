# Loohar Business Constitution

Version 1.0 · 2026-09-17 · Owner-approved intent, maintained by the Loohar engineering program

> This document states **business intent**. It does not certify that any capability is
> implemented. Implementation truth lives in the repository, tests, and runtime evidence;
> current status is tracked in `docs/pilot-launch/FEATURE_MATRIX.md` and
> `docs/pilot-launch/CONTROL_CENTER.md`. Where this document and the code disagree, the code
> describes what exists and this document describes where Loohar is going.

## 1. What Loohar is

Loohar is a multi-tenant restaurant SaaS, point-of-sale, and restaurant operating platform.
One platform serves many independent restaurants. Each restaurant gets online ordering,
in-store POS, kitchen display, delivery coordination, customer relationships, reporting,
and a public website — under the restaurant's own brand and control.

## 2. Founding principles

1. **Restaurants are the customer.** Loohar sells subscriptions to restaurants. Every
   product decision is judged by whether it helps a restaurant operate and grow.
2. **Restaurants own their customer relationships.** Customer data belongs to the
   restaurant it was collected for. Loohar does not market to a restaurant's customers or
   share them across restaurants.
3. **Two separate money flows.** Loohar SaaS billing (the restaurant paying Loohar) is fully
   separate from restaurant customer payments (diners paying the restaurant). Customer sales
   settle through the restaurant's own merchant/payment account; Loohar does not hold
   restaurant revenue.
4. **The server determines monetary truth.** Prices, modifiers, discounts, tax, tips, fees
   and totals are computed and validated server-side. A client-supplied amount never becomes
   a charge.
5. **Pilot safety before roadmap.** While a restaurant depends on Loohar in live service,
   stability, correct money handling and data protection outrank new features.
6. **Tax fails safe.** When tax cannot be determined confidently, Loohar blocks or flags the
   sale rather than silently applying a guessed or default rate.
7. **Security is a product feature.** Authentication, authorization, tenant isolation and
   audit apply to everyone, including platform staff.
8. **Evidence over claims.** Nothing is called ready without tests and runtime proof tied
   to an exact source revision.

## 3. Tenancy and people

### Tenants, restaurants and locations
- A restaurant is the tenant boundary. Every record that belongs to a restaurant is scoped
  to it and must never be readable or writable from another restaurant's context.
- An owner may operate multiple restaurants and multiple locations, as allowed by the
  restaurant's subscription entitlements.

### Platform Owner / Super Admin
- Has broad operational visibility across tenants to support restaurants and run the
  platform.
- Remains subject to authentication, role authorization, and audit logging. Platform access
  is a responsibility, not an exemption.

### Restaurant owners and administrators
- Configure the business: locations, menus, staff, payments onboarding, tax profiles,
  ordering, delivery, website, subscription.

### Employees
- Use role-based access control (for example manager, cashier, kitchen staff). Each role sees
  and does only what the job requires; sensitive actions (voids, refunds, discounts, cash
  adjustments) require appropriate permission and leave an audit trail.

### Customers
- Order from a specific restaurant. Ordering, accounts, history and loyalty are
  restaurant-specific experiences.

### Drivers
- During the pilot, delivery is restaurant-managed: the restaurant's own drivers.
- Drivers see only the delivery information assigned to them, only for as long as they need
  it.

## 4. Product domains (intent)

| Domain | Intent |
| --- | --- |
| Super Admin | Tenant lifecycle, plans and entitlements, support visibility, platform health, audit review. |
| Restaurant Owner/Admin | Complete self-service configuration and oversight of one or more restaurants. |
| Employees | Role-based access, PIN/device sign-in for POS, shift and cash accountability. |
| POS | Extremely responsive in-store ordering and payment; works under poor connectivity; never loses or duplicates an order. |
| KDS | Part of fulfillment: every paid or fired order reaches the right kitchen screen promptly, with clear status. |
| Customers | Restaurant-branded ordering, order tracking, receipts, reorder, loyalty where enabled. |
| Online Ordering | Pickup and delivery ordering with server-validated menus, modifiers, pricing and tax. |
| Payments | Restaurant-owned merchant accounts; idempotent payment creation; verified, deduplicated webhooks; reconciliation to provider records. |
| Cash | Tender and change calculation, drawer sessions, ledger and variance accountability. |
| Cards | Card-not-present online payments first; card-present terminals through certified processor integrations. |
| Tips | Transparent restaurant and driver tip handling, recorded separately and paid correctly. |
| Split Payments | Multiple tenders on one check. |
| Split Checks | Dividing one order across multiple checks. |
| Deleted Items | Removal before send is simple; removal after send is controlled and recorded. |
| Voids | Permission-controlled, reason-coded, audited. |
| Refunds | Permission-controlled, idempotent, reconciled with the provider, reflected in reports. |
| Receipts | Accurate printed/digital receipts consistent with the stored order and payment. |
| Tax | Location-based tax profiles, stored per-order tax snapshots, safe failure. |
| Reports | Trustworthy sales, payment, tax, tip, labor and operational reporting from the same order truth. |
| Inventory | Stock awareness growing toward recipe-level depletion and purchasing. |
| Delivery | Zones, fees and dispatch the restaurant controls. |
| Drivers | Assignment, claim, status, earnings — race-safe and privacy-preserving. |
| Multi-location | Location-scoped menus, staff, tax, devices and reports under one owner. |
| Subscriptions | Clear plans and entitlements enforced server-side, billed separately from restaurant revenue. |
| Restaurant Website/SEO | Every restaurant gets a fast, indexable, universally SEO-friendly website. |
| Mobile/PWA | Staff, driver and customer experiences that work well on phones. |
| AI | An operational intelligence layer: insights, forecasting, anomaly detection and assistance built on trustworthy data — never a source of monetary truth. |
| Support | Fast, documented help for restaurants, especially during live service. |
| Security | Tenant isolation, least privilege, secret hygiene, verified integrations. |
| Audit | Who did what, when, to which record — for money, permissions and platform access. |
| Observability | Health, version identity, alerting and incident response for every environment. |
| Hardware | Flexible: browser-first, with certified integrations for printers, drawers and terminals as needed. |

## 5. Order truth

Online ordering, POS and KDS converge on one order record per order. Status transitions,
payments, tax snapshots and kitchen tickets refer to that record. No surface keeps a private
copy of order totals that can diverge from the server.

## 6. Release discipline

- Every environment exposes the exact source revision it runs.
- Production changes only with explicit owner approval, from a certified candidate revision,
  with a rollback plan.
- Staging certification uses test/sandbox payment systems only.

## 7. How this document changes

The owner approves changes to principles and domain intent. Engineering may clarify wording
and add cross-references, and must never use this document to claim implementation status.
