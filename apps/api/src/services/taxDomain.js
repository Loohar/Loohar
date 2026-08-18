import crypto from "crypto";

export const TAX_PROFILE_STATUS = Object.freeze({
  UNCONFIGURED: "UNCONFIGURED",
  ADDRESS_REQUIRED: "ADDRESS_REQUIRED",
  VERIFYING: "VERIFYING",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  REFRESH_REQUIRED: "REFRESH_REQUIRED",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  UNSUPPORTED_JURISDICTION: "UNSUPPORTED_JURISDICTION",
  DISABLED: "DISABLED",
  SUPERSEDED: "SUPERSEDED"
});

export const TAX_VERIFICATION_STATUS = Object.freeze({
  UNVERIFIED: "UNVERIFIED",
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
  REFRESH_REQUIRED: "REFRESH_REQUIRED"
});

export const TAX_PROVIDER_STATUS = Object.freeze({
  CONFIGURED: "CONFIGURED",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  UNAVAILABLE: "UNAVAILABLE",
  AUTH_FAILED: "AUTH_FAILED"
});

export const TAX_CATEGORY_STATUS = Object.freeze({
  GENERAL_RATE_SUPPORTED: "GENERAL_RATE_SUPPORTED",
  CATEGORY_RULE_REQUIRED: "CATEGORY_RULE_REQUIRED",
  UNSUPPORTED_SPECIAL_RATE: "UNSUPPORTED_SPECIAL_RATE",
  MANUAL_REVIEW_REQUIRED: "MANUAL_REVIEW_REQUIRED"
});

const COLORADO_PROVIDER_ID = "COLORADO_TTR";
const LEGACY_COLORADO_PROVIDER_ID = "COLORADO_CDOR_SUTS";
const COLORADO_SOURCE = "Colorado SUTS / TTR Rate Automation API";
export const COLORADO_TTR_ENDPOINT = "https://api.ttr.services/v1/automation.rates.list";
export const NATIONAL_PROVIDER_ID = "NATIONAL_TAXJAR";
const NATIONAL_SOURCE = "TaxJar Sales Tax API";
export const TAXJAR_SANDBOX_BASE_URL = "https://api.sandbox.taxjar.com/v2";
export const TAXJAR_PRODUCTION_BASE_URL = "https://api.taxjar.com/v2";

export class TaxServiceError extends Error {
  constructor(message, { status = 400, code = "TAX_SERVICE_ERROR", details = null } = {}) {
    super(message);
    this.name = "TaxServiceError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, max = 300) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function upper(value, max = 32) {
  return text(value, max).toUpperCase();
}

function finiteCoordinate(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function normalizeBusinessAddress(location = {}) {
  const settings = object(location.settingsJson);
  const addressLine1 = text(location.address ?? settings.addressLine1, 300);
  const addressLine2 = text(settings.address2 ?? settings.addressLine2, 300);
  const city = text(settings.city, 120);
  const stateProvince = upper(settings.stateProvince ?? settings.state, 80);
  const postalCode = upper(settings.postalCode ?? settings.zip, 24);
  const country = upper(settings.country, 8);
  const latitude = finiteCoordinate(settings.latitude ?? location.latitude, -90, 90);
  const longitude = finiteCoordinate(settings.longitude ?? location.longitude, -180, 180);
  const normalizedAddress = [
    addressLine1,
    addressLine2,
    [city, stateProvince, postalCode].filter(Boolean).join(", "),
    country
  ].filter(Boolean).join(" | ");
  return {
    addressLine1,
    addressLine2,
    city,
    stateProvince,
    postalCode,
    country,
    latitude,
    longitude,
    normalizedAddress,
    validationStatus: "UNVERIFIED"
  };
}

export function validateBusinessAddress(address = {}) {
  const normalized = normalizeBusinessAddress({
    address: address.addressLine1,
    settingsJson: {
      address2: address.addressLine2,
      city: address.city,
      state: address.stateProvince,
      zip: address.postalCode,
      country: address.country,
      latitude: address.latitude,
      longitude: address.longitude
    }
  });
  const required = ["addressLine1", "city", "stateProvince", "postalCode", "country"];
  const missing = required.filter((field) => !normalized[field]);
  const countryValid = /^[A-Z]{2}$/.test(normalized.country);
  const valid = missing.length === 0 && countryValid;
  return {
    valid,
    missing,
    address: { ...normalized, validationStatus: valid ? "VALID" : "INVALID" },
    code: valid ? "TAX_ADDRESS_VALID" : missing.length ? "TAX_ADDRESS_REQUIRED" : "TAX_ADDRESS_INVALID"
  };
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value ?? null;
}

function iso(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

export function taxConfigurationVersion(configuration = {}) {
  const identity = JSON.stringify(canonicalValue({
    restaurantId: text(configuration.restaurantId),
    locationId: text(configuration.locationId),
    normalizedAddress: text(configuration.normalizedAddress, 800),
    provider: upper(configuration.provider, 80),
    source: upper(configuration.source, 120),
    countryCode: upper(configuration.countryCode, 8),
    stateCode: upper(configuration.stateCode, 80),
    county: text(configuration.county, 120),
    municipality: text(configuration.municipality, 120),
    jurisdictionCode: upper(configuration.jurisdictionCode, 160),
    jurisdictionMetadata: object(configuration.jurisdictionMetadata),
    specialDistricts: Array.isArray(configuration.specialDistricts) ? configuration.specialDistricts : [],
    taxComponents: Array.isArray(configuration.taxComponents) ? configuration.taxComponents : [],
    exemption: object(configuration.exemption),
    sourceMetadata: object(configuration.sourceMetadata),
    effectiveAt: iso(configuration.effectiveAt),
    expiresAt: iso(configuration.expiresAt),
    verifiedAt: iso(configuration.verifiedAt),
    nextVerificationAt: iso(configuration.nextVerificationAt),
    taxInclusive: Boolean(configuration.taxInclusive),
    taxRateBps: Number(configuration.taxRateBps)
  }));
  return `tax-v1-${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

function validRate(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 100_000;
}

function normalizedComponents(components, taxRateBps, { allowMismatch = false } = {}) {
  if (!Array.isArray(components) || components.length === 0) return [];
  const result = components.map((component, index) => {
    const rateBps = Number(component?.rateBps);
    if (!validRate(rateBps)) {
      throw new TaxServiceError(`Tax component ${index + 1} has an invalid rate.`, { code: "TAX_COMPONENT_INVALID" });
    }
    const normalizedComponent = {
      type: upper(component?.type, 40),
      name: text(component?.name, 120),
      jurisdictionCode: upper(component?.jurisdictionCode, 160),
      rateBps
    };
    const answer = upper(component?.answer, 40);
    const providerType = text(component?.providerType, 80);
    const providerValue = text(component?.providerValue, 80);
    const providerRateBps = Number(component?.providerRateBps);
    if (answer) normalizedComponent.answer = answer;
    if (providerType) normalizedComponent.providerType = providerType;
    if (providerValue) normalizedComponent.providerValue = providerValue;
    if (validRate(providerRateBps)) normalizedComponent.providerRateBps = providerRateBps;
    if (!normalizedComponent.type || !normalizedComponent.name || !normalizedComponent.jurisdictionCode) {
      throw new TaxServiceError(`Tax component ${index + 1} is missing jurisdiction metadata.`, { code: "TAX_COMPONENT_INVALID" });
    }
    return normalizedComponent;
  });
  const componentTotal = result.reduce((sum, component) => sum + component.rateBps, 0);
  if (componentTotal !== taxRateBps && !allowMismatch) {
    throw new TaxServiceError("Tax component rates must equal the authoritative combined rate.", { code: "TAX_COMPONENT_TOTAL_MISMATCH" });
  }
  return result;
}

export function decimalTaxRateToBps(value) {
  const raw = typeof value === "number" ? String(value) : text(value, 80);
  if (!/^\d+(?:\.\d+)?$/.test(raw)) {
    throw new TaxServiceError("The TTR tax rate is invalid.", { code: "TAX_PROVIDER_INVALID_RESPONSE" });
  }
  const [whole, fraction = ""] = raw.split(".");
  if (fraction.slice(4).replace(/0/g, "")) {
    throw new TaxServiceError("The TTR tax rate exceeds basis-point precision.", { code: "TAX_PROVIDER_INVALID_RESPONSE" });
  }
  const rateBps = Number(BigInt(whole) * 10_000n + BigInt((fraction.slice(0, 4) + "0000").slice(0, 4)));
  if (!validRate(rateBps)) {
    throw new TaxServiceError("The TTR tax rate is outside the supported range.", { code: "TAX_PROVIDER_INVALID_RESPONSE" });
  }
  return rateBps;
}

function fractionalTaxRateToBps(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new TaxServiceError("The national provider tax rate is invalid.", {
      status: 502,
      code: "TAX_PROVIDER_INVALID_RESPONSE"
    });
  }
  return Math.round(rate * 10_000);
}

function taxJarAddressBody(address) {
  return {
    country: address.country,
    state: address.stateProvince,
    zip: address.postalCode,
    city: address.city,
    street: [address.addressLine1, address.addressLine2].filter(Boolean).join(", ")
  };
}

function taxJarAddressMatches(submitted, candidate) {
  const returnedStreet = comparableAddress(candidate.street);
  const streetNumber = comparableAddress(submitted.addressLine1).split(" ")[0];
  return Boolean(
    returnedStreet
    && streetNumber
    && returnedStreet.split(" ").includes(streetNumber)
    && upper(candidate.state, 80) === submitted.stateProvince
    && upper(candidate.zip, 24).slice(0, 5) === submitted.postalCode.slice(0, 5)
  );
}

function taxJarError(status, operation) {
  if (status === 401 || status === 403) {
    return new TaxServiceError("National tax provider authentication failed.", {
      status: 502,
      code: "TAX_PROVIDER_AUTH_FAILED"
    });
  }
  if (status === 429) {
    return new TaxServiceError("National tax provider rate limit reached.", {
      status: 503,
      code: "TAX_PROVIDER_RATE_LIMITED"
    });
  }
  if ([400, 404, 422].includes(status) && operation === "address") {
    return new TaxServiceError("The national tax provider could not validate this address.", {
      status: 422,
      code: "TAX_ADDRESS_INVALID"
    });
  }
  return new TaxServiceError("The national tax provider is temporarily unavailable.", {
    status: 503,
    code: "TAX_PROVIDER_UNAVAILABLE"
  });
}

async function taxJarRequest({ fetchImpl, baseUrl, apiKey, path, body, signal, operation }) {
  let providerResponse;
  try {
    providerResponse = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (error?.name === "AbortError" || signal?.aborted) {
      throw new TaxServiceError("The national tax provider request timed out.", {
        status: 503,
        code: "TAX_PROVIDER_TIMEOUT"
      });
    }
    throw new TaxServiceError("The national tax provider is temporarily unavailable.", {
      status: 503,
      code: "TAX_PROVIDER_UNAVAILABLE"
    });
  }
  if (!providerResponse.ok) throw taxJarError(providerResponse.status, operation);
  try {
    return await providerResponse.json();
  } catch {
    throw new TaxServiceError("The national tax provider returned invalid JSON.", {
      status: 502,
      code: "TAX_PROVIDER_INVALID_RESPONSE"
    });
  }
}

export function createTaxJarLookup({ fetchImpl = globalThis.fetch, baseUrl = TAXJAR_SANDBOX_BASE_URL } = {}) {
  if (typeof fetchImpl !== "function") return null;
  return async ({ apiKey, address, signal }) => {
    const startedAt = Date.now();
    const validation = validateBusinessAddress(address);
    if (!validation.valid || validation.address.country !== "US") {
      throw new TaxServiceError("A complete U.S. physical business address is required.", {
        status: 422,
        code: validation.valid ? "TAX_UNSUPPORTED_JURISDICTION" : "TAX_ADDRESS_REQUIRED",
        details: { missing: validation.missing }
      });
    }
    const submitted = validation.address;
    const addressBody = taxJarAddressBody(submitted);
    const addressResponse = await taxJarRequest({
      fetchImpl,
      baseUrl,
      apiKey,
      path: "/addresses/validate",
      body: addressBody,
      signal,
      operation: "address"
    });
    const candidates = Array.isArray(addressResponse?.addresses) ? addressResponse.addresses : [];
    const matching = candidates.filter((candidate) => taxJarAddressMatches(submitted, candidate));
    if (matching.length !== 1) {
      throw new TaxServiceError(
        matching.length ? "The national tax provider returned an ambiguous address." : "The national tax provider could not validate this address.",
        { status: 422, code: matching.length ? "TAX_ADDRESS_AMBIGUOUS" : "TAX_ADDRESS_NOT_FOUND" }
      );
    }
    const candidate = matching[0];
    const verifiedAddress = validateBusinessAddress({
      addressLine1: text(candidate.street, 300),
      city: text(candidate.city, 120),
      stateProvince: upper(candidate.state, 80),
      postalCode: upper(candidate.zip, 24),
      country: upper(candidate.country || submitted.country, 8)
    });
    if (!verifiedAddress.valid) {
      throw new TaxServiceError("The national tax provider returned an incomplete address.", {
        status: 502,
        code: "TAX_PROVIDER_INVALID_RESPONSE"
      });
    }
    const location = taxJarAddressBody(verifiedAddress.address);
    const taxesBody = {
      from_country: location.country,
      from_zip: location.zip,
      from_state: location.state,
      from_city: location.city,
      from_street: location.street,
      to_country: location.country,
      to_zip: location.zip,
      to_state: location.state,
      to_city: location.city,
      to_street: location.street,
      amount: 1,
      shipping: 0,
      nexus_addresses: [{ id: "restaurant-location", ...location }],
      line_items: [{ id: "location-default", quantity: 1, unit_price: 1, discount: 0 }]
    };
    const taxesResponse = await taxJarRequest({
      fetchImpl,
      baseUrl,
      apiKey,
      path: "/taxes",
      body: taxesBody,
      signal,
      operation: "tax"
    });
    return {
      verifiedAddress: verifiedAddress.address,
      tax: taxesResponse?.tax,
      providerLatencyMs: Math.max(0, Date.now() - startedAt)
    };
  };
}

function normalizedTaxJarComponent({ type, name, locationKey, rate }) {
  return {
    type,
    name,
    jurisdictionCode: locationKey,
    rateBps: fractionalTaxRateToBps(rate),
    providerRate: Number(rate)
  };
}

export function normalizeTaxJarResponse({ restaurantId, locationId, address, response, environment = "SANDBOX", now = new Date() }) {
  const submitted = validateBusinessAddress(address);
  if (!submitted.valid || submitted.address.country !== "US") {
    throw new TaxServiceError("A complete U.S. physical business address is required.", {
      status: 422,
      code: submitted.valid ? "TAX_UNSUPPORTED_JURISDICTION" : "TAX_ADDRESS_REQUIRED",
      details: { missing: submitted.missing }
    });
  }
  const result = object(response);
  const verified = validateBusinessAddress(result.verifiedAddress || {});
  const tax = object(result.tax);
  const jurisdictions = object(tax.jurisdictions);
  const breakdown = object(tax.breakdown);
  if (!verified.valid || verified.address.country !== "US" || tax.has_nexus !== true || !text(tax.tax_source, 80)) {
    throw new TaxServiceError("The national tax provider returned an incomplete jurisdiction result.", {
      status: 502,
      code: "TAX_PROVIDER_INVALID_RESPONSE"
    });
  }
  const stateCode = upper(jurisdictions.state || verified.address.stateProvince, 80);
  const county = text(jurisdictions.county, 120);
  const municipality = text(jurisdictions.city, 120) || null;
  if (!stateCode || !county) {
    throw new TaxServiceError("The national tax provider did not return required state and county jurisdiction data.", {
      status: 502,
      code: "TAX_JURISDICTION_INCOMPLETE"
    });
  }
  const locationKey = upper(
    `TAXJAR:${stateCode}:${verified.address.postalCode}:${county}:${municipality || "UNINCORPORATED"}`.replace(/[^A-Z0-9:]+/g, "_"),
    160
  );
  const specialRate = breakdown.special_tax_rate ?? breakdown.special_district_tax_rate;
  const componentSpecs = [
    ["STATE", jurisdictions.state || stateCode, breakdown.state_tax_rate],
    ["COUNTY", county, breakdown.county_tax_rate],
    ["MUNICIPALITY", municipality || "No municipality returned", breakdown.city_tax_rate],
    ["SPECIAL_DISTRICT", "Combined special districts", specialRate]
  ];
  const taxComponents = componentSpecs
    .filter(([, , rate]) => Number.isFinite(Number(rate)))
    .map(([type, name, rate]) => normalizedTaxJarComponent({ type, name, locationKey, rate }));
  const taxRateBps = fractionalTaxRateToBps(tax.rate);
  if (!taxComponents.length) {
    throw new TaxServiceError("The national tax provider did not return rate components.", {
      status: 502,
      code: "TAX_COMPONENT_INVALID"
    });
  }
  const componentTotal = taxComponents.reduce((sum, component) => sum + component.rateBps, 0);
  const componentReconciliationStatus = Math.abs(componentTotal - taxRateBps) <= 1 ? "RECONCILED" : "REVIEW_REQUIRED";
  const verifiedAt = requiredDate(now, "TAX_PROVIDER_INVALID_RESPONSE", "National provider lookup timestamp");
  const nextVerificationAt = new Date(verifiedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const specialDistricts = Number(specialRate || 0) > 0
    ? [{ name: "Combined special districts", jurisdictionCode: locationKey, locationCode: null }]
    : [];
  const categoryStatus = componentReconciliationStatus === "RECONCILED"
    ? TAX_CATEGORY_STATUS.GENERAL_RATE_SUPPORTED
    : TAX_CATEGORY_STATUS.MANUAL_REVIEW_REQUIRED;
  const material = {
    provider: NATIONAL_PROVIDER_ID,
    source: NATIONAL_SOURCE,
    verifiedAddress: verified.address,
    stateCode,
    county,
    municipality,
    jurisdictionCode: locationKey,
    taxComponents,
    specialDistricts,
    combinedRateBps: taxRateBps,
    categoryStatus,
    componentReconciliationStatus,
    taxSource: upper(tax.tax_source, 80)
  };
  const materialFingerprint = fingerprint(material);
  const sourceMetadata = {
    officialSource: NATIONAL_SOURCE,
    sourceReference: locationKey,
    providerResponseFingerprint: fingerprint({ ...material, verifiedAt: iso(verifiedAt) }),
    materialFingerprint,
    lookupTimestamp: iso(verifiedAt),
    addressMatchStatus: "VALIDATED",
    categoryStatus,
    categoryCode: "FULLY_TAXABLE_DEFAULT",
    componentReconciliationStatus,
    environment: upper(environment, 20),
    taxSource: upper(tax.tax_source, 80),
    hasNexus: true,
    freightTaxable: Boolean(tax.freight_taxable),
    defaultProductTreatment: "FULLY_TAXABLE_NO_PRODUCT_CODE",
    jurisdictionCodeType: "LOOHAR_NORMALIZED_LOCATION_KEY",
    providerJurisdictionCode: null,
    providerRate: Number(tax.rate),
    providerLatencyMs: Number.isFinite(Number(result.providerLatencyMs)) ? Math.max(0, Number(result.providerLatencyMs)) : null,
    effectiveDateBasis: "LOOKUP_VERIFICATION_TIME"
  };
  const jurisdictionMetadata = {
    country: "US",
    state: { type: "STATE", name: stateCode, code: stateCode, locationCode: locationKey },
    county: { type: "COUNTY", name: county, code: locationKey, locationCode: locationKey },
    municipality: municipality
      ? { type: "MUNICIPALITY", name: municipality, code: locationKey, locationCode: locationKey }
      : null,
    specialDistricts,
    submittedAddress: submitted.address,
    verifiedAddress: verified.address,
    sourcing: { taxSource: upper(tax.tax_source, 80), mode: "PHYSICAL_LOCATION" },
    categoryStatus,
    componentReconciliationStatus
  };
  const configuration = {
    provider: NATIONAL_PROVIDER_ID,
    source: NATIONAL_SOURCE,
    taxRateBps,
    taxInclusive: false,
    countryCode: "US",
    stateCode,
    county,
    municipality,
    jurisdictionCode: locationKey,
    jurisdictionMetadata,
    specialDistricts,
    taxComponents,
    exemption: {},
    sourceMetadata,
    effectiveAt: verifiedAt,
    expiresAt: null,
    verifiedAt,
    nextVerificationAt,
    categoryStatus,
    materialFingerprint
  };
  return {
    restaurantId: text(restaurantId),
    locationId: text(locationId),
    normalizedAddress: verified.address,
    ...configuration,
    configurationVersion: taxConfigurationVersion({
      restaurantId,
      locationId,
      normalizedAddress: verified.address.normalizedAddress,
      ...configuration
    })
  };
}

function coloradoTtrAddress(address) {
  return [
    address.addressLine1,
    address.addressLine2,
    [address.city, address.stateProvince, address.postalCode].filter(Boolean).join(", "),
    address.country
  ].filter(Boolean).join(", ");
}

function comparableAddress(value) {
  return text(value, 800).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function ttrAddressMatches(submitted, returnedAddress) {
  const returned = comparableAddress(returnedAddress);
  const streetNumber = comparableAddress(submitted.addressLine1).split(" ")[0];
  return Boolean(
    returned
    && streetNumber
    && returned.split(" ").includes(streetNumber)
    && returned.includes(comparableAddress(submitted.city))
    && returned.includes(comparableAddress(submitted.postalCode))
  );
}

function ttrComponentType(value) {
  const type = upper(value, 80).replace(/[\s-]+/g, "_");
  if (type === "STATE") return "STATE";
  if (type === "COUNTY") return "COUNTY";
  if (type === "CITY" || type === "MUNICIPALITY" || type === "MUNICIPAL") return "MUNICIPALITY";
  if (type === "DISTRICT" || type === "SPECIAL_DISTRICT") return "SPECIAL_DISTRICT";
  return "OTHER";
}

export function normalizeColoradoTtrResponse({ address, response, productServiceId, now = new Date() }) {
  const submitted = validateBusinessAddress(address);
  if (!submitted.valid) {
    throw new TaxServiceError("A complete physical business address is required.", {
      code: "TAX_ADDRESS_REQUIRED",
      details: { missing: submitted.missing }
    });
  }
  if (submitted.address.country !== "US" || submitted.address.stateProvince !== "CO") {
    throw new TaxServiceError("This jurisdiction is not supported by the Colorado adapter.", {
      status: 422,
      code: "TAX_UNSUPPORTED_JURISDICTION"
    });
  }
  const result = object(response);
  const returnedAddress = text(result.address, 800);
  const jurisdictionCode = upper(result.jurisdictionCode, 160);
  if (!ttrAddressMatches(submitted.address, returnedAddress)) {
    throw new TaxServiceError("TTR did not return a confidently matching Colorado address.", {
      status: 422,
      code: "TAX_ADDRESS_INVALID"
    });
  }
  if (!jurisdictionCode || !Array.isArray(result.salesTax) || result.salesTax.length === 0) {
    throw new TaxServiceError("TTR returned an incomplete rate response.", {
      status: 502,
      code: "TAX_PROVIDER_INVALID_RESPONSE"
    });
  }

  const combinedRateBps = decimalTaxRateToBps(result.totalSalesTax);
  let hasUnknownComponent = false;
  const components = result.salesTax.map((item, index) => {
    const component = object(item);
    const name = text(component.jurisdiction, 120);
    const providerType = text(component.type, 80);
    const type = ttrComponentType(providerType);
    const answer = upper(component.answer, 40) || "UNSPECIFIED";
    if (!name || !providerType || !new Set(["TAXABLE", "EXEMPT", "UNSPECIFIED"]).has(answer)) {
      throw new TaxServiceError(`TTR tax component ${index + 1} is malformed.`, {
        status: 502,
        code: "TAX_PROVIDER_INVALID_RESPONSE"
      });
    }
    if (type === "OTHER") hasUnknownComponent = true;
    const providerRateBps = decimalTaxRateToBps(component.value);
    return {
      type,
      name,
      jurisdictionCode,
      rateBps: answer === "EXEMPT" ? 0 : providerRateBps,
      answer,
      providerType,
      providerValue: text(component.value, 80),
      providerRateBps
    };
  });
  const applicableComponentBps = components.reduce((sum, component) => sum + component.rateBps, 0);
  const componentReconciliationStatus = applicableComponentBps === combinedRateBps ? "RECONCILED" : "REVIEW_REQUIRED";
  const explicitProductServiceId = productServiceId === undefined || productServiceId === null
    ? null
    : Number(productServiceId);
  if (explicitProductServiceId !== null && (!Number.isSafeInteger(explicitProductServiceId) || explicitProductServiceId <= 0)) {
    throw new TaxServiceError("TTR productServiceId must be a positive integer when supplied.", {
      code: "TAX_PRODUCT_SERVICE_INVALID"
    });
  }
  const categoryStatus = explicitProductServiceId === null
    ? TAX_CATEGORY_STATUS.CATEGORY_RULE_REQUIRED
    : componentReconciliationStatus === "RECONCILED" && !hasUnknownComponent
      ? TAX_CATEGORY_STATUS.GENERAL_RATE_SUPPORTED
      : TAX_CATEGORY_STATUS.MANUAL_REVIEW_REQUIRED;
  const stateComponent = components.find((component) => component.type === "STATE");
  const municipalityComponent = components.find((component) => component.type === "MUNICIPALITY");
  const countyComponent = components.find((component) => component.type === "COUNTY")
    || (municipalityComponent?.name.toUpperCase().includes("CITY AND COUNTY") ? municipalityComponent : null);
  if (!stateComponent || !countyComponent) {
    throw new TaxServiceError("TTR did not return required state and county jurisdiction components.", {
      status: 502,
      code: "TAX_PROVIDER_INVALID_RESPONSE"
    });
  }
  const verifiedAt = requiredDate(now, "TAX_PROVIDER_INVALID_RESPONSE", "TTR lookup timestamp");
  return {
    addressMatch: { status: "VALIDATED" },
    verifiedAddress: submitted.address,
    providerReference: jurisdictionCode,
    lookupTimestamp: verifiedAt,
    effectiveAt: result.effectiveAt || verifiedAt,
    expiresAt: result.expiresAt || null,
    nextVerificationAt: result.nextVerificationAt || null,
    jurisdictionCode,
    jurisdictions: {
      state: { name: stateComponent.name, code: "CO", locationCode: jurisdictionCode },
      county: { name: countyComponent.name, code: jurisdictionCode, locationCode: jurisdictionCode },
      municipality: municipalityComponent
        ? { name: municipalityComponent.name, code: jurisdictionCode, locationCode: jurisdictionCode }
        : null,
      specialDistricts: components
        .filter((component) => component.type === "SPECIAL_DISTRICT")
        .map((component) => ({ name: component.name, code: jurisdictionCode, locationCode: jurisdictionCode }))
    },
    taxComponents: components,
    combinedRateBps,
    componentReconciliationStatus,
    category: {
      status: categoryStatus,
      code: explicitProductServiceId === null ? "ADDRESS_ONLY" : `PRODUCT_SERVICE_${explicitProductServiceId}`
    },
    ttrMetadata: {
      returnedAddress,
      productService: canonicalValue(result.productService),
      productServiceId: explicitProductServiceId,
      applicableComponentBps,
      componentReconciliationStatus
    }
  };
}

export function createColoradoTtrLookup({ fetchImpl = globalThis.fetch, endpoint = COLORADO_TTR_ENDPOINT } = {}) {
  if (typeof fetchImpl !== "function") return null;
  return async ({ apiKey, address, productServiceId, signal }) => {
    const body = { address: coloradoTtrAddress(address) };
    if (productServiceId !== undefined && productServiceId !== null) {
      const normalizedProductServiceId = Number(productServiceId);
      if (!Number.isSafeInteger(normalizedProductServiceId) || normalizedProductServiceId <= 0) {
        throw new TaxServiceError("TTR productServiceId must be a positive integer when supplied.", {
          code: "TAX_PRODUCT_SERVICE_INVALID"
        });
      }
      body.productServiceId = normalizedProductServiceId;
    }
    let providerResponse;
    try {
      providerResponse = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal
      });
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) {
        throw new TaxServiceError("The TTR tax provider request timed out.", {
          status: 503,
          code: "TAX_PROVIDER_TIMEOUT"
        });
      }
      throw new TaxServiceError("The TTR tax provider is unavailable.", {
        status: 503,
        code: "TAX_PROVIDER_UNAVAILABLE"
      });
    }
    if (providerResponse.status === 401 || providerResponse.status === 403) {
      throw new TaxServiceError("TTR authentication failed.", { status: 502, code: "TAX_PROVIDER_AUTH_FAILED" });
    }
    if (providerResponse.status === 429) {
      throw new TaxServiceError("TTR rate limit reached.", { status: 503, code: "TAX_PROVIDER_RATE_LIMITED" });
    }
    if (providerResponse.status === 400 || providerResponse.status === 404 || providerResponse.status === 422) {
      throw new TaxServiceError("TTR could not validate this address.", { status: 422, code: "TAX_ADDRESS_INVALID" });
    }
    if (!providerResponse.ok) {
      throw new TaxServiceError("The TTR tax provider is unavailable.", { status: 503, code: "TAX_PROVIDER_UNAVAILABLE" });
    }
    let response;
    try {
      response = await providerResponse.json();
    } catch {
      throw new TaxServiceError("TTR returned invalid JSON.", { status: 502, code: "TAX_PROVIDER_INVALID_RESPONSE" });
    }
    return normalizeColoradoTtrResponse({ address, response, productServiceId });
  };
}

function requiredDate(value, code, label) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    throw new TaxServiceError(`${label} must be supplied by the authoritative provider.`, { code });
  }
  return parsed;
}

function coloradoCategoryStatus(value) {
  const status = upper(value, 80) || TAX_CATEGORY_STATUS.MANUAL_REVIEW_REQUIRED;
  if (!Object.values(TAX_CATEGORY_STATUS).includes(status)) {
    throw new TaxServiceError("Colorado tax category support is not recognized.", {
      status: 422,
      code: "TAX_CATEGORY_RULE_REQUIRED"
    });
  }
  return status;
}

function coloradoLookupError(error) {
  if (error instanceof TaxServiceError) return error;
  const status = Number(error?.status || error?.statusCode || error?.response?.status);
  const code = upper(error?.code, 80);
  if (error?.name === "AbortError" || code === "ABORT_ERR") {
    return new TaxServiceError("The Colorado tax provider request timed out.", {
      status: 503,
      code: "TAX_PROVIDER_TIMEOUT"
    });
  }
  if (status === 401 || status === 403 || code === "AUTH_FAILED" || code === "UNAUTHORIZED") {
    return new TaxServiceError("Colorado tax provider authentication failed.", {
      status: 502,
      code: "TAX_PROVIDER_AUTH_FAILED"
    });
  }
  if (status === 404 || code === "ADDRESS_NOT_FOUND") {
    return new TaxServiceError("The Colorado tax provider could not validate this address.", {
      status: 422,
      code: "TAX_ADDRESS_NOT_FOUND"
    });
  }
  if (code === "ADDRESS_INVALID") {
    return new TaxServiceError("The Colorado tax provider rejected this address.", {
      status: 422,
      code: "TAX_ADDRESS_INVALID"
    });
  }
  if (code === "JURISDICTION_UNSUPPORTED") {
    return new TaxServiceError("The Colorado tax provider does not support this jurisdiction.", {
      status: 422,
      code: "TAX_UNSUPPORTED_JURISDICTION"
    });
  }
  return new TaxServiceError("The Colorado tax provider is temporarily unavailable.", {
    status: 503,
    code: "TAX_PROVIDER_UNAVAILABLE"
  });
}

function coloradoJurisdictionPart(value, fallbackType) {
  const part = object(value);
  return {
    type: upper(part.type || fallbackType, 40),
    name: text(part.name, 120),
    code: upper(part.code || part.jurisdictionCode || part.locationCode, 160),
    locationCode: upper(part.locationCode, 160)
  };
}

export function mapColoradoSutsLookupResult({ restaurantId, locationId, address, result, now = new Date() }) {
  const submitted = validateBusinessAddress(address);
  if (!submitted.valid) {
    throw new TaxServiceError("A complete physical business address is required.", {
      code: "TAX_ADDRESS_REQUIRED",
      details: { missing: submitted.missing }
    });
  }
  if (submitted.address.country !== "US" || submitted.address.stateProvince !== "CO") {
    throw new TaxServiceError("This jurisdiction is not supported by the Colorado adapter.", {
      status: 422,
      code: "TAX_UNSUPPORTED_JURISDICTION"
    });
  }

  const response = object(result);
  const matchStatus = upper(response.addressMatch?.status || response.addressMatchStatus, 80);
  if (matchStatus === "NOT_FOUND") {
    throw new TaxServiceError("The Colorado tax provider could not validate this address.", {
      status: 422,
      code: "TAX_ADDRESS_NOT_FOUND"
    });
  }
  if (!new Set(["EXACT", "VALIDATED"]).has(matchStatus)) {
    throw new TaxServiceError("Colorado tax resolution requires an exact, confidently validated address.", {
      status: 422,
      code: "TAX_ADDRESS_INVALID"
    });
  }

  const verifiedAddress = validateBusinessAddress(response.verifiedAddress || {});
  if (!verifiedAddress.valid || verifiedAddress.address.country !== "US" || verifiedAddress.address.stateProvince !== "CO") {
    throw new TaxServiceError("The authoritative provider did not return a complete Colorado address.", {
      status: 422,
      code: "TAX_ADDRESS_INVALID"
    });
  }

  const jurisdictions = object(response.jurisdictions);
  const state = coloradoJurisdictionPart(jurisdictions.state, "STATE");
  const county = coloradoJurisdictionPart(jurisdictions.county, "COUNTY");
  const municipality = coloradoJurisdictionPart(jurisdictions.municipality, "MUNICIPALITY");
  const specialDistricts = Array.isArray(jurisdictions.specialDistricts)
    ? jurisdictions.specialDistricts.map((district, index) => {
      const normalized = coloradoJurisdictionPart(district, "SPECIAL_DISTRICT");
      if (!normalized.name || !normalized.code) {
        throw new TaxServiceError(`Colorado special district ${index + 1} is incomplete.`, {
          code: "TAX_SPECIAL_DISTRICT_INVALID"
        });
      }
      return { name: normalized.name, jurisdictionCode: normalized.code, locationCode: normalized.locationCode || null };
    })
    : [];
  if (state.code !== "CO" && state.code !== "US-CO") {
    throw new TaxServiceError("The authoritative response does not identify Colorado.", {
      status: 422,
      code: "TAX_UNSUPPORTED_JURISDICTION"
    });
  }
  if (!county.name || !county.code || (municipality.name && !municipality.code) || (!municipality.name && municipality.code)) {
    throw new TaxServiceError("The authoritative response contains incomplete county or municipality jurisdiction data.", {
      status: 422,
      code: "TAX_JURISDICTION_INCOMPLETE"
    });
  }

  const taxRateBps = Number(response.combinedRateBps);
  if (!validRate(taxRateBps)) {
    throw new TaxServiceError("The authoritative combined Colorado tax rate is invalid.", { code: "TAX_RATE_INVALID" });
  }
  const componentReconciliationStatus = upper(response.componentReconciliationStatus || "RECONCILED", 80);
  if (!new Set(["RECONCILED", "REVIEW_REQUIRED"]).has(componentReconciliationStatus)) {
    throw new TaxServiceError("The authoritative component reconciliation status is invalid.", {
      code: "TAX_PROVIDER_INVALID_RESPONSE"
    });
  }
  const taxComponents = normalizedComponents(response.taxComponents, taxRateBps, {
    allowMismatch: componentReconciliationStatus === "REVIEW_REQUIRED"
  });
  if (taxComponents.length === 0 && taxRateBps !== 0) {
    throw new TaxServiceError("Colorado tax components are required for a non-zero combined rate.", {
      code: "TAX_COMPONENT_INVALID"
    });
  }

  const providerReference = text(response.providerReference, 240);
  if (!providerReference) {
    throw new TaxServiceError("The authoritative response is missing a safe provider reference.", {
      code: "TAX_PROVIDER_REFERENCE_REQUIRED"
    });
  }
  const effectiveAt = requiredDate(response.effectiveAt, "TAX_RATE_NOT_EFFECTIVE", "Colorado rate effective date");
  const verifiedAt = requiredDate(response.lookupTimestamp || now, "TAX_PROVIDER_RESPONSE_INVALID", "Colorado lookup timestamp");
  const expiresAt = response.expiresAt ? requiredDate(response.expiresAt, "TAX_PROVIDER_RESPONSE_INVALID", "Colorado rate expiry") : null;
  const nextVerificationAt = response.nextVerificationAt
    ? requiredDate(response.nextVerificationAt, "TAX_PROVIDER_INVALID_RESPONSE", "Colorado next verification date")
    : null;
  let categoryStatus = coloradoCategoryStatus(response.category?.status || response.categoryStatus);
  if (componentReconciliationStatus === "REVIEW_REQUIRED") {
    categoryStatus = TAX_CATEGORY_STATUS.MANUAL_REVIEW_REQUIRED;
  }
  const jurisdictionCode = upper(response.jurisdictionCode || municipality.code || county.code, 160);
  if (!jurisdictionCode) {
    throw new TaxServiceError("The authoritative response is missing a jurisdiction code.", {
      code: "TAX_JURISDICTION_INCOMPLETE"
    });
  }

  const material = {
    provider: COLORADO_PROVIDER_ID,
    source: COLORADO_SOURCE,
    verifiedAddress: verifiedAddress.address,
    jurisdictions: { state, county, municipality, specialDistricts },
    jurisdictionCode,
    taxComponents,
    combinedRateBps: taxRateBps,
    categoryStatus,
    componentReconciliationStatus,
    categoryCode: upper(response.category?.code, 120),
    effectiveAt: iso(effectiveAt),
    expiresAt: iso(expiresAt)
  };
  const responseFingerprint = fingerprint({
    providerReference,
    lookupTimestamp: iso(verifiedAt),
    ttrMetadata: object(response.ttrMetadata),
    ...material
  });
  const materialFingerprint = fingerprint(material);
  const sourceMetadata = {
    officialSource: "Colorado SUTS / TTR Rate Automation API",
    sourceReference: providerReference,
    providerResponseFingerprint: responseFingerprint,
    materialFingerprint,
    lookupTimestamp: iso(verifiedAt),
    addressMatchStatus: matchStatus,
    categoryStatus,
    categoryCode: upper(response.category?.code, 120) || null,
    componentReconciliationStatus,
    ttr: object(response.ttrMetadata)
  };
  const jurisdictionMetadata = {
    country: "US",
    state,
    county,
    municipality,
    specialDistricts,
    submittedAddress: submitted.address,
    verifiedAddress: verifiedAddress.address,
    categoryStatus,
    componentReconciliationStatus
  };
  const configuration = {
    provider: COLORADO_PROVIDER_ID,
    source: COLORADO_SOURCE,
    taxRateBps,
    taxInclusive: false,
    countryCode: "US",
    stateCode: "CO",
    county: county.name,
    municipality: municipality.name || null,
    jurisdictionCode,
    jurisdictionMetadata,
    specialDistricts,
    taxComponents,
    exemption: {},
    sourceMetadata,
    effectiveAt,
    expiresAt,
    verifiedAt,
    nextVerificationAt,
    categoryStatus,
    materialFingerprint
  };
  return {
    restaurantId: text(restaurantId),
    locationId: text(locationId),
    normalizedAddress: verifiedAddress.address,
    ...configuration,
    configurationVersion: taxConfigurationVersion({
      restaurantId,
      locationId,
      normalizedAddress: verifiedAddress.address.normalizedAddress,
      ...configuration
    })
  };
}

export class TaxProvider {
  constructor({ id, label }) {
    this.id = id;
    this.label = label;
  }

  async validateAddress({ address }) {
    return validateBusinessAddress(address);
  }

  async resolveJurisdiction() {
    throw new TaxServiceError("Tax jurisdiction provider is not configured.", {
      status: 503,
      code: "TAX_PROVIDER_NOT_CONFIGURED"
    });
  }

  async getTaxConfiguration() {
    throw new TaxServiceError("Tax configuration provider is not configured.", {
      status: 503,
      code: "TAX_PROVIDER_NOT_CONFIGURED"
    });
  }

  async verifyTaxConfiguration(input) {
    return this.getTaxConfiguration(input);
  }

  async refreshTaxConfiguration(input) {
    return this.getTaxConfiguration(input);
  }
}

export class NationalTaxProvider extends TaxProvider {
  constructor({ enabled = false, apiKey = "", lookup = null, environment = "SANDBOX", timeoutMs = 4000, maxRetries = 1 } = {}) {
    super({ id: NATIONAL_PROVIDER_ID, label: "Nationwide U.S. tax provider" });
    this.enabled = enabled === true;
    this.apiKey = text(apiKey, 4000);
    this.lookup = typeof lookup === "function" ? lookup : null;
    this.environment = upper(environment, 20) === "PRODUCTION" ? "PRODUCTION" : "SANDBOX";
    this.timeoutMs = Math.min(10_000, Math.max(500, Number(timeoutMs) || 4000));
    this.maxRetries = Math.min(1, Math.max(0, Number(maxRetries) || 0));
    this.runtimeStatus = this.enabled && this.apiKey && this.lookup
      ? TAX_PROVIDER_STATUS.CONFIGURED
      : TAX_PROVIDER_STATUS.NOT_CONFIGURED;
  }

  operationalStatus() {
    return {
      id: this.id,
      label: this.label,
      status: this.runtimeStatus,
      credentialsConfigured: Boolean(this.enabled && this.apiKey),
      liveLookupAvailable: Boolean(this.enabled && this.apiKey && this.lookup),
      source: NATIONAL_SOURCE,
      environment: this.environment
    };
  }

  async #boundedLookup(input) {
    if (!this.enabled || !this.apiKey || !this.lookup) {
      this.runtimeStatus = TAX_PROVIDER_STATUS.NOT_CONFIGURED;
      throw new TaxServiceError("The national tax provider sandbox credential is not configured.", {
        status: 503,
        code: "TAX_PROVIDER_NOT_CONFIGURED"
      });
    }
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      let timeout;
      try {
        const timeoutPromise = new Promise((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new TaxServiceError("The national tax provider request timed out.", {
              status: 503,
              code: "TAX_PROVIDER_TIMEOUT"
            }));
          }, this.timeoutMs);
        });
        const response = await Promise.race([
          this.lookup({ apiKey: this.apiKey, address: input.address, signal: controller.signal }),
          timeoutPromise
        ]);
        this.runtimeStatus = TAX_PROVIDER_STATUS.CONFIGURED;
        return response;
      } catch (error) {
        const classified = error instanceof TaxServiceError
          ? error
          : new TaxServiceError("The national tax provider is temporarily unavailable.", {
              status: 503,
              code: "TAX_PROVIDER_UNAVAILABLE"
            });
        this.runtimeStatus = classified.code === "TAX_PROVIDER_AUTH_FAILED"
          ? TAX_PROVIDER_STATUS.AUTH_FAILED
          : TAX_PROVIDER_STATUS.UNAVAILABLE;
        if (!new Set(["TAX_PROVIDER_UNAVAILABLE", "TAX_PROVIDER_TIMEOUT"]).has(classified.code) || attempt >= this.maxRetries) {
          throw classified;
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new TaxServiceError("The national tax provider is temporarily unavailable.", {
      status: 503,
      code: "TAX_PROVIDER_UNAVAILABLE"
    });
  }

  async resolveJurisdiction({ restaurantId, locationId, address }) {
    const validation = validateBusinessAddress(address);
    if (!validation.valid) {
      throw new TaxServiceError("A complete physical business address is required.", {
        code: "TAX_ADDRESS_REQUIRED",
        details: { missing: validation.missing }
      });
    }
    if (validation.address.country !== "US") {
      throw new TaxServiceError("The national provider supports U.S. locations only.", {
        status: 422,
        code: "TAX_UNSUPPORTED_JURISDICTION"
      });
    }
    const result = await this.#boundedLookup({ address: validation.address });
    return normalizeTaxJarResponse({
      restaurantId,
      locationId,
      address: validation.address,
      response: result,
      environment: this.environment
    });
  }

  async getTaxConfiguration({ restaurantId, locationId, jurisdiction }) {
    if (!jurisdiction || jurisdiction.restaurantId !== text(restaurantId) || jurisdiction.locationId !== text(locationId)) {
      throw new TaxServiceError("National provider results are bound to one tenant location.", {
        status: 409,
        code: "TAX_PROVIDER_SCOPE_MISMATCH"
      });
    }
    const { restaurantId: ignoredRestaurantId, locationId: ignoredLocationId, normalizedAddress, ...configuration } = jurisdiction;
    void ignoredRestaurantId;
    void ignoredLocationId;
    void normalizedAddress;
    return configuration;
  }
}

export class ColoradoTaxProvider extends TaxProvider {
  constructor({ enabled = false, apiKey = "", lookup = null, timeoutMs = 3000, maxRetries = 1 } = {}) {
    super({ id: COLORADO_PROVIDER_ID, label: "Colorado SUTS / TTR Rate Automation API" });
    this.enabled = enabled === true;
    this.apiKey = text(apiKey, 4000);
    this.lookup = typeof lookup === "function" ? lookup : null;
    this.timeoutMs = Math.min(10_000, Math.max(500, Number(timeoutMs) || 3000));
    this.maxRetries = Math.min(1, Math.max(0, Number(maxRetries) || 0));
    this.runtimeStatus = this.enabled && this.apiKey && this.lookup
      ? TAX_PROVIDER_STATUS.CONFIGURED
      : TAX_PROVIDER_STATUS.NOT_CONFIGURED;
  }

  operationalStatus() {
    return {
      id: this.id,
      label: this.label,
      status: this.runtimeStatus,
      credentialsConfigured: Boolean(this.enabled && this.apiKey),
      liveLookupAvailable: Boolean(this.enabled && this.apiKey && this.lookup),
      source: COLORADO_SOURCE
    };
  }

  async #boundedLookup(input) {
    if (!this.enabled || !this.apiKey || !this.lookup) {
      this.runtimeStatus = TAX_PROVIDER_STATUS.NOT_CONFIGURED;
      throw new TaxServiceError("The Colorado TTR provider credential is not configured.", {
        status: 503,
        code: "TAX_PROVIDER_NOT_CONFIGURED"
      });
    }
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      let timeout;
      try {
        const timeoutPromise = new Promise((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new TaxServiceError("Colorado tax provider request timed out.", {
              status: 503,
              code: "TAX_PROVIDER_TIMEOUT"
            }));
          }, this.timeoutMs);
        });
        const response = await Promise.race([
          this.lookup({
            apiKey: this.apiKey,
            address: input.address,
            effectiveAt: input.effectiveAt,
            productServiceId: input.productServiceId,
            signal: controller.signal
          }),
          timeoutPromise
        ]);
        this.runtimeStatus = TAX_PROVIDER_STATUS.CONFIGURED;
        return response;
      } catch (error) {
        const classified = coloradoLookupError(error);
        this.runtimeStatus = classified.code === "TAX_PROVIDER_AUTH_FAILED"
          ? TAX_PROVIDER_STATUS.AUTH_FAILED
          : TAX_PROVIDER_STATUS.UNAVAILABLE;
        if (!["TAX_PROVIDER_UNAVAILABLE", "TAX_PROVIDER_TIMEOUT"].includes(classified.code) || attempt >= this.maxRetries) throw classified;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new TaxServiceError("The Colorado tax provider is temporarily unavailable.", {
      status: 503,
      code: "TAX_PROVIDER_UNAVAILABLE"
    });
  }

  async resolveJurisdiction({ restaurantId, locationId, address, effectiveAt = new Date(), productServiceId }) {
    const validation = validateBusinessAddress(address);
    if (!validation.valid) {
      throw new TaxServiceError("A complete physical business address is required.", {
        code: "TAX_ADDRESS_REQUIRED",
        details: { missing: validation.missing }
      });
    }
    if (validation.address.country !== "US" || validation.address.stateProvince !== "CO") {
      throw new TaxServiceError("This jurisdiction is not supported by the Colorado adapter.", {
        status: 422,
        code: "TAX_UNSUPPORTED_JURISDICTION"
      });
    }
    const result = await this.#boundedLookup({ address: validation.address, effectiveAt, productServiceId });
    return mapColoradoSutsLookupResult({
      restaurantId,
      locationId,
      address: validation.address,
      result
    });
  }

  async getTaxConfiguration({ restaurantId, locationId, jurisdiction }) {
    if (!jurisdiction || jurisdiction.restaurantId !== text(restaurantId) || jurisdiction.locationId !== text(locationId)) {
      throw new TaxServiceError("Colorado provider results are bound to one tenant location.", {
        status: 409,
        code: "TAX_PROVIDER_SCOPE_MISMATCH"
      });
    }
    return {
      provider: jurisdiction.provider,
      source: jurisdiction.source,
      taxRateBps: jurisdiction.taxRateBps,
      taxInclusive: jurisdiction.taxInclusive,
      countryCode: jurisdiction.countryCode,
      stateCode: jurisdiction.stateCode,
      county: jurisdiction.county,
      municipality: jurisdiction.municipality,
      jurisdictionCode: jurisdiction.jurisdictionCode,
      jurisdictionMetadata: jurisdiction.jurisdictionMetadata,
      specialDistricts: jurisdiction.specialDistricts,
      taxComponents: jurisdiction.taxComponents,
      exemption: jurisdiction.exemption,
      sourceMetadata: jurisdiction.sourceMetadata,
      effectiveAt: jurisdiction.effectiveAt,
      expiresAt: jurisdiction.expiresAt,
      verifiedAt: jurisdiction.verifiedAt,
      nextVerificationAt: jurisdiction.nextVerificationAt,
      categoryStatus: jurisdiction.categoryStatus,
      materialFingerprint: jurisdiction.materialFingerprint,
      configurationVersion: jurisdiction.configurationVersion
    };
  }
}

export class ManualVerifiedTaxProvider extends TaxProvider {
  constructor() {
    super({ id: "MANUAL_VERIFIED", label: "Manual verified configuration" });
  }

  async getTaxConfiguration({ restaurantId, locationId, address, effectiveAt = new Date(), manualConfiguration = {} }) {
    const validation = validateBusinessAddress(address);
    if (!validation.valid) {
      throw new TaxServiceError("A complete physical business address is required.", {
        code: "TAX_ADDRESS_REQUIRED",
        details: { missing: validation.missing }
      });
    }
    const taxRateBps = Number(manualConfiguration.taxRateBps);
    if (!validRate(taxRateBps)) {
      throw new TaxServiceError("A verified tax rate in basis points is required.", { code: "TAX_RATE_INVALID" });
    }
    const jurisdictionCode = upper(manualConfiguration.jurisdictionCode, 160);
    const sourceReference = text(manualConfiguration.sourceReference, 240);
    const county = text(manualConfiguration.county, 120);
    const municipality = text(manualConfiguration.municipality, 120);
    const verifiedBy = text(manualConfiguration.verifiedBy, 160);
    if (!jurisdictionCode || !sourceReference || !municipality || !verifiedBy) {
      throw new TaxServiceError("Verified jurisdiction and source metadata are required.", { code: "TAX_VERIFICATION_METADATA_REQUIRED" });
    }
    const verifiedAt = new Date(manualConfiguration.verifiedAt || Date.now());
    const effectiveDate = new Date(effectiveAt);
    if (Number.isNaN(verifiedAt.getTime()) || Number.isNaN(effectiveDate.getTime())) {
      throw new TaxServiceError("Verified and effective dates must be valid.", { code: "TAX_DATE_INVALID" });
    }
    const expiresAt = manualConfiguration.expiresAt ? new Date(manualConfiguration.expiresAt) : null;
    const nextVerificationAt = manualConfiguration.nextVerificationAt ? new Date(manualConfiguration.nextVerificationAt) : null;
    if ((expiresAt && Number.isNaN(expiresAt.getTime())) || (nextVerificationAt && Number.isNaN(nextVerificationAt.getTime()))) {
      throw new TaxServiceError("Expiry and next-verification dates must be valid.", { code: "TAX_DATE_INVALID" });
    }
    if (expiresAt && expiresAt <= effectiveDate) {
      throw new TaxServiceError("Tax profile expiry must follow its effective date.", { code: "TAX_EXPIRY_INVALID" });
    }
    const taxComponents = normalizedComponents(manualConfiguration.taxComponents, taxRateBps);
    const specialDistricts = Array.isArray(manualConfiguration.specialDistricts)
      ? manualConfiguration.specialDistricts.map((district, index) => {
        const normalizedDistrict = {
          name: text(district?.name, 120),
          jurisdictionCode: upper(district?.jurisdictionCode, 160)
        };
        if (!normalizedDistrict.name || !normalizedDistrict.jurisdictionCode) {
          throw new TaxServiceError(`Special district ${index + 1} is missing jurisdiction metadata.`, { code: "TAX_SPECIAL_DISTRICT_INVALID" });
        }
        return normalizedDistrict;
      })
      : [];
    const provider = "LOOHAR_MANUAL_VERIFIED";
    const source = "MANUAL_VERIFIED_CONFIGURATION";
    const configuration = {
      provider,
      source,
      taxRateBps,
      taxInclusive: Boolean(manualConfiguration.taxInclusive),
      countryCode: validation.address.country,
      stateCode: validation.address.stateProvince,
      county,
      municipality,
      jurisdictionCode,
      jurisdictionMetadata: {
        country: validation.address.country,
        state: validation.address.stateProvince,
        county,
        municipality,
        specialDistricts
      },
      specialDistricts,
      taxComponents,
      exemption: object(manualConfiguration.exemption),
      sourceMetadata: {
        sourceReference,
        verificationMethod: text(manualConfiguration.verificationMethod || "manual-review", 120),
        verifiedBy
      },
      effectiveAt: effectiveDate,
      expiresAt,
      verifiedAt,
      nextVerificationAt
    };
    return {
      ...configuration,
      configurationVersion: taxConfigurationVersion({
        restaurantId,
        locationId,
        normalizedAddress: validation.address.normalizedAddress,
        ...configuration
      })
    };
  }
}

function enabledEnvironmentValue(value) {
  return new Set(["1", "TRUE", "YES", "ON"]).has(upper(value, 12));
}

function providerComparisonValue(value) {
  return comparableAddress(value)
    .replace(/\bCITY AND COUNTY\b/g, "")
    .replace(/\bCOUNTY\b/g, "")
    .replace(/\bPARISH\b/g, "")
    .replace(/\bBOROUGH\b/g, "")
    .replace(/^CITY OF\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function providerComponentRate(configuration, types) {
  const accepted = new Set(types);
  const components = Array.isArray(configuration?.taxComponents) ? configuration.taxComponents : [];
  if (!components.length) return null;
  return components
    .filter((component) => accepted.has(upper(component?.type, 40)))
    .reduce((sum, component) => sum + Number(component?.rateBps || 0), 0);
}

function providerRatesMatch(primary, validator, types) {
  const primaryRate = providerComponentRate(primary, types);
  const validatorRate = providerComponentRate(validator, types);
  return primaryRate !== null && validatorRate !== null && Math.abs(primaryRate - validatorRate) <= 1;
}

export function compareTaxProviderResults(primary, validator) {
  const checks = {
    state: providerComparisonValue(primary?.stateCode) === providerComparisonValue(validator?.stateCode),
    county: providerComparisonValue(primary?.county) === providerComparisonValue(validator?.county),
    municipality: providerComparisonValue(primary?.municipality) === providerComparisonValue(validator?.municipality),
    stateRate: providerRatesMatch(primary, validator, ["STATE"]),
    countyRate: providerRatesMatch(primary, validator, ["COUNTY"]),
    municipalityRate: providerRatesMatch(primary, validator, ["CITY", "MUNICIPALITY", "MUNICIPAL"]),
    districtRate: providerRatesMatch(primary, validator, ["DISTRICT", "SPECIAL_DISTRICT"]),
    combinedRate: Math.abs(Number(primary?.taxRateBps) - Number(validator?.taxRateBps)) <= 1
  };
  const matched = Object.values(checks).every(Boolean);
  return {
    status: matched ? "MATCHED" : "DISAGREEMENT",
    primaryProvider: primary?.provider || null,
    validationProvider: validator?.provider || null,
    checks,
    primaryRateBps: Number(primary?.taxRateBps),
    validationRateBps: Number(validator?.taxRateBps),
    comparedAt: new Date().toISOString()
  };
}

function withProviderComparison(configuration, comparison) {
  const categoryStatus = comparison.status === "DISAGREEMENT"
    ? TAX_CATEGORY_STATUS.MANUAL_REVIEW_REQUIRED
    : configuration.categoryStatus;
  const sourceMetadata = {
    ...object(configuration.sourceMetadata),
    categoryStatus,
    providerComparison: comparison
  };
  const materialComparison = {
    status: comparison.status,
    primaryProvider: comparison.primaryProvider,
    validationProvider: comparison.validationProvider,
    checks: comparison.checks || null,
    primaryRateBps: comparison.primaryRateBps ?? null,
    validationRateBps: comparison.validationRateBps ?? null,
    errorCode: comparison.errorCode || null
  };
  const materialFingerprint = comparison.status === "DISAGREEMENT"
    ? fingerprint({ previousMaterialFingerprint: configuration.materialFingerprint, comparison: materialComparison })
    : configuration.materialFingerprint;
  const next = { ...configuration, categoryStatus, sourceMetadata, materialFingerprint };
  return {
    ...next,
    configurationVersion: taxConfigurationVersion({
      restaurantId: configuration.restaurantId,
      locationId: configuration.locationId,
      normalizedAddress: configuration.normalizedAddress?.normalizedAddress,
      ...next
    })
  };
}

export function taxProviderFor(providerId, env = process.env, options = {}) {
  const id = upper(providerId, 80);
  if (id === "MANUAL_VERIFIED" || id === "LOOHAR_MANUAL_VERIFIED") return new ManualVerifiedTaxProvider();
  if (id === "NATIONAL" || id === NATIONAL_PROVIDER_ID || id === "TAXJAR") {
    const environment = upper(env.TAXJAR_API_ENVIRONMENT, 20) === "PRODUCTION" ? "PRODUCTION" : "SANDBOX";
    const apiKey = environment === "PRODUCTION"
      ? env.TAXJAR_API_KEY
      : env.TAXJAR_SANDBOX_API_KEY;
    const baseUrl = environment === "PRODUCTION" ? TAXJAR_PRODUCTION_BASE_URL : TAXJAR_SANDBOX_BASE_URL;
    return new NationalTaxProvider({
      enabled: Boolean(apiKey),
      apiKey,
      environment,
      lookup: options.nationalLookup || createTaxJarLookup({ fetchImpl: options.fetchImpl, baseUrl }),
      timeoutMs: env.TAXJAR_REQUEST_TIMEOUT_MS,
      maxRetries: env.TAXJAR_MAX_RETRIES
    });
  }
  if (id === "COLORADO" || id === COLORADO_PROVIDER_ID || id === LEGACY_COLORADO_PROVIDER_ID) {
    const apiKey = env.COLORADO_TTR_API_KEY;
    return new ColoradoTaxProvider({
      enabled: Boolean(apiKey),
      apiKey,
      lookup: options.coloradoLookup || createColoradoTtrLookup({ fetchImpl: options.fetchImpl }),
      timeoutMs: env.COLORADO_TTR_REQUEST_TIMEOUT_MS,
      maxRetries: env.COLORADO_TTR_MAX_RETRIES
    });
  }
  throw new TaxServiceError("Tax jurisdiction is not supported.", {
    status: 422,
    code: "TAX_UNSUPPORTED_JURISDICTION"
  });
}

export class TaxProviderRouter {
  constructor({ env = process.env, options = {} } = {}) {
    this.env = env;
    this.options = options;
  }

  primaryProviderId(address) {
    const validation = validateBusinessAddress(address);
    if (!validation.valid) {
      throw new TaxServiceError("A complete physical business address is required.", {
        code: "TAX_ADDRESS_REQUIRED",
        details: { missing: validation.missing }
      });
    }
    if (validation.address.country === "US") return NATIONAL_PROVIDER_ID;
    throw new TaxServiceError("No tax provider supports this jurisdiction yet.", {
      status: 422,
      code: "TAX_UNSUPPORTED_JURISDICTION"
    });
  }

  providerFor(providerId) {
    return taxProviderFor(providerId, this.env, this.options);
  }

  async resolveJurisdiction({ providerId, restaurantId, locationId, address, effectiveAt, productServiceId }) {
    const selectedId = providerId || this.primaryProviderId(address);
    const provider = this.providerFor(selectedId);
    let jurisdiction = await provider.resolveJurisdiction({
      restaurantId,
      locationId,
      address,
      effectiveAt,
      productServiceId
    });
    const validated = validateBusinessAddress(address);
    const validationEnabled = enabledEnvironmentValue(this.env.COLORADO_TTR_VALIDATION_ENABLED);
    if (
      provider.id === NATIONAL_PROVIDER_ID
      && validated.address.stateProvince === "CO"
      && validationEnabled
    ) {
      const validator = this.providerFor(COLORADO_PROVIDER_ID);
      if (validator.operationalStatus().liveLookupAvailable) {
        try {
          const validationResult = await validator.resolveJurisdiction({
            restaurantId,
            locationId,
            address,
            effectiveAt,
            productServiceId
          });
          jurisdiction = withProviderComparison(jurisdiction, compareTaxProviderResults(jurisdiction, validationResult));
        } catch (error) {
          jurisdiction = withProviderComparison(jurisdiction, {
            status: "VALIDATOR_UNAVAILABLE",
            primaryProvider: jurisdiction.provider,
            validationProvider: COLORADO_PROVIDER_ID,
            errorCode: error?.code || "TAX_PROVIDER_UNAVAILABLE",
            comparedAt: new Date().toISOString()
          });
        }
      } else {
        jurisdiction = withProviderComparison(jurisdiction, {
          status: "VALIDATOR_NOT_CONFIGURED",
          primaryProvider: jurisdiction.provider,
          validationProvider: COLORADO_PROVIDER_ID,
          comparedAt: new Date().toISOString()
        });
      }
    }
    return { provider, jurisdiction };
  }
}

export function taxProviderOperationalStatus(providerId, env = process.env, options = {}) {
  const provider = taxProviderFor(providerId, env, options);
  return typeof provider.operationalStatus === "function"
    ? provider.operationalStatus()
    : {
      id: provider.id,
      label: provider.label,
      status: TAX_PROVIDER_STATUS.CONFIGURED,
      credentialsConfigured: true,
      liveLookupAvailable: true
    };
}

export function taxCategoryActivationError(profile) {
  const sourceMetadata = profile?.sourceMetadataJson || profile?.sourceMetadata || {};
  if (sourceMetadata?.providerComparison?.status === "DISAGREEMENT") {
    return "PROVIDER_DISAGREEMENT_REVIEW_REQUIRED";
  }
  if (![NATIONAL_PROVIDER_ID, COLORADO_PROVIDER_ID, LEGACY_COLORADO_PROVIDER_ID].includes(profile?.provider)) return null;
  const categoryStatus = sourceMetadata.categoryStatus
    || TAX_CATEGORY_STATUS.MANUAL_REVIEW_REQUIRED;
  if (categoryStatus === TAX_CATEGORY_STATUS.GENERAL_RATE_SUPPORTED) return null;
  if (categoryStatus === TAX_CATEGORY_STATUS.CATEGORY_RULE_REQUIRED) return "TAX_CATEGORY_RULE_REQUIRED";
  if (categoryStatus === TAX_CATEGORY_STATUS.UNSUPPORTED_SPECIAL_RATE) return "TAX_UNSUPPORTED_SPECIAL_RATE";
  return "TAX_MANUAL_REVIEW_REQUIRED";
}

export function isActiveTaxProfile(profile, asOf = new Date()) {
  if (!profile || profile.status !== TAX_PROFILE_STATUS.ACTIVE || profile.enabled !== true) return false;
  const now = new Date(asOf);
  if (profile.effectiveAt > now || profile.verifiedAt > now) return false;
  if (profile.expiresAt && profile.expiresAt <= now) return false;
  if (profile.nextVerificationAt && profile.nextVerificationAt <= now) return false;
  if (profile.verificationStatus !== TAX_VERIFICATION_STATUS.VERIFIED) return false;
  if (!profile.acknowledgedByUserId || !profile.acknowledgedAt || !profile.acknowledgementVersion) return false;
  if (profile.acknowledgementVersion !== profile.configurationVersion) return false;
  return validRate(profile.taxRateBps)
    && Boolean(text(profile.provider))
    && Boolean(text(profile.source))
    && Boolean(text(profile.countryCode))
    && Boolean(text(profile.jurisdictionCode))
    && Boolean(text(profile.configurationVersion));
}

export function taxProfileReadiness(profile, asOf = new Date()) {
  if (!profile) return { ready: false, status: TAX_PROFILE_STATUS.UNCONFIGURED, code: "TAX_PROFILE_UNCONFIGURED" };
  if (profile.expiresAt && profile.expiresAt <= new Date(asOf)) {
    return { ready: false, status: TAX_PROFILE_STATUS.EXPIRED, code: "TAX_PROFILE_EXPIRED" };
  }
  if (profile.nextVerificationAt && profile.nextVerificationAt <= new Date(asOf)) {
    return { ready: false, status: TAX_PROFILE_STATUS.REFRESH_REQUIRED, code: "TAX_PROFILE_REFRESH_REQUIRED" };
  }
  const categoryError = taxCategoryActivationError(profile);
  if (categoryError) {
    return { ready: false, status: TAX_PROFILE_STATUS.REVIEW_REQUIRED, code: categoryError };
  }
  if (profile.acknowledgementVersion !== profile.configurationVersion) {
    return { ready: false, status: TAX_PROFILE_STATUS.REVIEW_REQUIRED, code: "TAX_PROFILE_ACKNOWLEDGEMENT_REQUIRED" };
  }
  if (!isActiveTaxProfile(profile, asOf)) {
    return { ready: false, status: profile.status || TAX_PROFILE_STATUS.REVIEW_REQUIRED, code: "TAX_PROFILE_NOT_ACTIVE" };
  }
  return { ready: true, status: TAX_PROFILE_STATUS.ACTIVE, code: "TAX_PROFILE_ACTIVE" };
}
