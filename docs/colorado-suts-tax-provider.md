# Colorado SUTS/TTR Tax Provider

Loohar's Colorado adapter is server-side and implements the existing universal `TaxProvider` contract. It resolves a complete physical location address through the authenticated TTR Rate Automation API into a review-required, versioned location tax profile. The POS and Offline v1 consume only acknowledged active profiles and never call TTR during checkout.

## Official Source

The authoritative integration contract uses `POST https://api.ttr.services/v1/automation.rates.list` with a backend-only bearer token. The body always contains the complete normalized `address`. `productServiceId` is optional and is omitted until Loohar has independently verified the intended restaurant or prepared-food classification. In particular, Loohar does not default to product service `626`, which the supplied documentation associates with occasional charitable sales.

Official public references:

- https://tax.colorado.gov/GIS-API
- https://tax.colorado.gov/SUTS-info
- https://tax.colorado.gov/how-to-look-up-sales-use-tax-rates

## Environment Names

- `COLORADO_TTR_API_KEY`
- `COLORADO_TTR_REQUEST_TIMEOUT_MS`
- `COLORADO_TTR_MAX_RETRIES`

Do not expose these values to the web application, health response, logs, or audit metadata.

## Integration Boundary

The adapter sends the credential only in the server-side `Authorization: Bearer` header. The key is never returned in status, API responses, audit metadata, logs, frontend code, or stored profiles. Without the backend key, provider status is `NOT_CONFIGURED` and resolution fails closed with `TAX_PROVIDER_NOT_CONFIGURED`.

The transport validates the returned address, jurisdiction code, `totalSalesTax`, and every `salesTax` component before normalizing them into the existing Tax Service model. Decimal rates are converted exactly to basis points. Taxable components contribute to the applicable total; exempt components retain their provider value but contribute zero. An empty address-only classification answer is retained as `UNSPECIFIED`, contributes only to the general-rate candidate, and keeps that candidate category-blocked. Unreconciled or category-ambiguous results never become checkout tax silently.

## Activation Safety

Provider lookup creates a candidate only. Owners and authorized administrators must review and acknowledge the exact configuration version before activation. Results marked `CATEGORY_RULE_REQUIRED`, `UNSUPPORTED_SPECIAL_RATE`, or `MANUAL_REVIEW_REQUIRED` cannot activate. Manual verified profiles remain a separate, explicit fallback and are never selected automatically after a provider failure.
