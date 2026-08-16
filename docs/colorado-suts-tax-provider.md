# Colorado SUTS/GIS Tax Provider

Loohar's Colorado adapter is server-side and implements the existing universal `TaxProvider` contract. It resolves a complete physical location address into a review-required, versioned location tax profile. The POS and Offline v1 consume only acknowledged active profiles and never call Colorado SUTS/GIS during checkout.

## Official Source

The authoritative source is the Colorado Department of Revenue Sales & Use Tax System Geographic Information System (SUTS/GIS). Colorado requires a SUTS account and an API key. The current API method documentation is provided inside the authenticated SUTS account where the key is generated. Loohar does not infer an endpoint, request method, or payload from the public lookup website.

Official public references:

- https://tax.colorado.gov/GIS-API
- https://tax.colorado.gov/SUTS-info
- https://tax.colorado.gov/how-to-look-up-sales-use-tax-rates

## Environment Names

- `COLORADO_SUTS_API_ENABLED`
- `COLORADO_SUTS_API_KEY`
- `COLORADO_SUTS_REQUEST_TIMEOUT_MS`
- `COLORADO_SUTS_MAX_RETRIES`

Do not expose these values to the web application, health response, logs, or audit metadata.

## Integration Boundary

The adapter accepts an authenticated server-side lookup transport. That transport must be implemented from the API method documentation supplied in the authorized SUTS account. Until that contract and key are available, provider status is `NOT_CONFIGURED` and resolution fails closed with `TAX_PROVIDER_NOT_CONFIGURED`.

The transport must normalize the official response into the strict Colorado lookup contract consumed by `mapColoradoSutsLookupResult`. Contract fixtures test address matching, jurisdiction components, category safety, rates, effective dates, fingerprints, failures, and tenant/location binding without claiming a live Colorado response.

## Activation Safety

Provider lookup creates a candidate only. Owners and authorized administrators must review and acknowledge the exact configuration version before activation. Results marked `CATEGORY_RULE_REQUIRED`, `UNSUPPORTED_SPECIAL_RATE`, or `MANUAL_REVIEW_REQUIRED` cannot activate. Manual verified profiles remain a separate, explicit fallback and are never selected automatically after a provider failure.
