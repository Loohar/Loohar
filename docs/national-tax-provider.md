# National Tax Provider

Loohar Tax Service uses TaxJar as the primary nationwide U.S. address-level provider. Location onboarding validates the complete physical address with `POST /v2/addresses/validate`, then resolves the location's fully taxable general rate with `POST /v2/taxes`. The request supplies the same verified restaurant address as origin, destination, and physical nexus. It intentionally omits a provider product code for the `LOCATION_DEFAULT` treatment.

The integration defaults to `https://api.sandbox.taxjar.com/v2`. `TAXJAR_SANDBOX_API_KEY` is backend-only and is sent only in the `Authorization: Bearer` header. It is never returned to the browser, logged, committed, or stored in a profile or audit record. Missing credentials fail closed with `TAX_PROVIDER_NOT_CONFIGURED`.

Provider responses normalize into the existing versioned location tax profile: verified address, state, county, municipality, aggregate special-district component, combined rate, physical-location sourcing and nexus metadata, effective and verification dates, and a configuration version. TaxJar does not provide formal jurisdiction identifiers in this response, so V1 records a clearly labeled Loohar normalized location key and preserves that limitation in source metadata.

`COLORADO_TTR_VALIDATION_ENABLED=true` optionally compares a Colorado onboarding result with TTR. It is not a fallback and is never used in the POS hot path. A material rate or jurisdiction disagreement blocks activation with `PROVIDER_DISAGREEMENT_REVIEW_REQUIRED`. Manual verified profiles remain the explicit fallback when automatic onboarding cannot be completed.

POS, online ordering, and Offline v1 consume only an acknowledged active profile and its menu tax-treatment snapshot. Delivery currently uses the restaurant location profile; destination sourcing and remote-sales nexus are a future phase.
