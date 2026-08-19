# Avalara AvaTax Provider

`AvalaraTaxProvider` is a sandbox-only nationwide adapter behind Loohar's existing `TaxProvider` and `TaxProviderRouter` boundary. Select it on the API server with `NATIONAL_TAX_PROVIDER=AVALARA`. POS, menu, cart, online pickup quotes, and Offline v1 consume only normalized, versioned Loohar tax profiles; they do not import Avalara models or credentials and do not call Avalara during item or cart interaction.

## Official Sandbox Contract

The adapter follows the official AvaTax REST v2 contract:

- Base URL: `https://sandbox-rest.avatax.com`
- Authentication: HTTP Basic using Base64-encoded `accountId:licenseKey`
- Client fingerprint: `X-Avalara-Client`
- Address validation: `POST /api/v2/addresses/resolve`
- Tax calculation: `POST /api/v2/transactions/create`
- Transaction type: `SalesOrder`, which is a temporary estimate
- Physical restaurant sourcing: document-level `singleLocation`
- Probe line: one $100 general-taxability line with no explicit tax code; AvaTax documents the omitted tax-code default as taxable tangible personal property `P0000000`
- Commit: `false`

Only `Intersection`, `Interpolated`, and `Rooftop` address resolutions are accepted. Centroid, `External`, and `NotCoded` results fail closed because they do not establish the requested street-level location.

## Backend Configuration

Required only on the isolated API backend:

- `AVALARA_SANDBOX_ACCOUNT_ID`
- `AVALARA_SANDBOX_LICENSE_KEY`
- `AVALARA_SANDBOX_COMPANY_CODE`

Optional transport controls:

- `AVALARA_REQUEST_TIMEOUT_MS`
- `AVALARA_MAX_RETRIES`

The account ID and license key are used only to construct the outbound Authorization header. No credential or raw company code is stored in profiles, audits, API responses, frontend code, or browser storage. Profiles retain only a one-way company-configuration fingerprint. This phase rejects any AvaTax base URL other than the official sandbox URL.

## Normalization And Precision

AvaTax transaction `summary` rows normalize into provider-independent state, county, municipality, and special-district components. Provider fractional rates become integer micro-rates, where `1,000,000` represents `100%`; `taxRateBps` remains a rounded compatibility projection. The component total and AvaTax monetary result are reconciled against Loohar's deterministic integer-cent calculation. Missing jurisdiction data, malformed components, unexpected taxability, or a monetary mismatch produces review-required or fail-closed status rather than a guessed rate.

The resulting immutable profile records provider identity, normalized address, jurisdiction codes, component rates, effective tax date, verification timestamp, configuration version, address resolution quality, provider latency, and a sanitized response fingerprint. Historical orders and Offline v1 snapshots retain the exact profile version and precise rate used at sale time.

## Provider Routing And Limitations

The provider router supports Avalara, TaxJar, Colorado TTR validation, and Manual Verified fallback. TaxJar remains the compatibility default when `NATIONAL_TAX_PROVIDER` is absent; Avalara is selected explicitly for staging evaluation. Colorado TTR remains an optional comparison for Colorado onboarding and never runs in the POS hot path. A material comparison disagreement blocks activation with `PROVIDER_DISAGREEMENT_REVIEW_REQUIRED`.

The current profile lookup validates a general location-default taxable treatment for physical pickup/POS use. It does not claim that every restaurant product has identical taxability. `EXEMPT` and verified `CUSTOM_RULE` overrides remain available. Destination-sensitive delivery, remote-sale nexus, exemptions, and complex product classification require a future transaction-level provider path and must not be inferred from the cached location profile.
