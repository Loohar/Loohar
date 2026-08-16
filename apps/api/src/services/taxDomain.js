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

function normalizedComponents(components, taxRateBps) {
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
    if (!normalizedComponent.type || !normalizedComponent.name || !normalizedComponent.jurisdictionCode) {
      throw new TaxServiceError(`Tax component ${index + 1} is missing jurisdiction metadata.`, { code: "TAX_COMPONENT_INVALID" });
    }
    return normalizedComponent;
  });
  const componentTotal = result.reduce((sum, component) => sum + component.rateBps, 0);
  if (componentTotal !== taxRateBps) {
    throw new TaxServiceError("Tax component rates must equal the authoritative combined rate.", { code: "TAX_COMPONENT_TOTAL_MISMATCH" });
  }
  return result;
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

export class ColoradoTaxProvider extends TaxProvider {
  constructor({ configured = false } = {}) {
    super({ id: "COLORADO", label: "Colorado jurisdiction adapter" });
    this.configured = configured;
  }

  async resolveJurisdiction({ address }) {
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
    if (!this.configured) {
      throw new TaxServiceError("Colorado tax provider credentials are not configured.", {
        status: 503,
        code: "TAX_PROVIDER_NOT_CONFIGURED"
      });
    }
    throw new TaxServiceError("Colorado authoritative rate resolution is not connected.", {
      status: 503,
      code: "TAX_PROVIDER_NOT_CONFIGURED"
    });
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

export function taxProviderFor(providerId, env = process.env) {
  const id = upper(providerId, 80);
  if (id === "MANUAL_VERIFIED" || id === "LOOHAR_MANUAL_VERIFIED") return new ManualVerifiedTaxProvider();
  if (id === "COLORADO") return new ColoradoTaxProvider({ configured: env.COLORADO_TAX_PROVIDER_ENABLED === "true" });
  throw new TaxServiceError("Tax jurisdiction is not supported.", {
    status: 422,
    code: "TAX_UNSUPPORTED_JURISDICTION"
  });
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
  if (profile.acknowledgementVersion !== profile.configurationVersion) {
    return { ready: false, status: TAX_PROFILE_STATUS.REVIEW_REQUIRED, code: "TAX_PROFILE_ACKNOWLEDGEMENT_REQUIRED" };
  }
  if (!isActiveTaxProfile(profile, asOf)) {
    return { ready: false, status: profile.status || TAX_PROFILE_STATUS.REVIEW_REQUIRED, code: "TAX_PROFILE_NOT_ACTIVE" };
  }
  return { ready: true, status: TAX_PROFILE_STATUS.ACTIVE, code: "TAX_PROFILE_ACTIVE" };
}
