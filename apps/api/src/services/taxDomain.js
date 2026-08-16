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

const COLORADO_PROVIDER_ID = "COLORADO_CDOR_SUTS";
const COLORADO_SOURCE = "COLORADO_DEPARTMENT_OF_REVENUE_SUTS_GIS";

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
  const taxComponents = normalizedComponents(response.taxComponents, taxRateBps);
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
  const nextVerificationAt = requiredDate(
    response.nextVerificationAt,
    "TAX_PROVIDER_RESPONSE_INVALID",
    "Colorado next verification date"
  );
  const categoryStatus = coloradoCategoryStatus(response.category?.status || response.categoryStatus);
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
    categoryCode: upper(response.category?.code, 120),
    effectiveAt: iso(effectiveAt),
    expiresAt: iso(expiresAt)
  };
  const responseFingerprint = fingerprint({ providerReference, lookupTimestamp: iso(verifiedAt), ...material });
  const materialFingerprint = fingerprint(material);
  const sourceMetadata = {
    officialSource: "Colorado Department of Revenue SUTS/GIS",
    sourceReference: providerReference,
    providerResponseFingerprint: responseFingerprint,
    materialFingerprint,
    lookupTimestamp: iso(verifiedAt),
    addressMatchStatus: matchStatus,
    categoryStatus,
    categoryCode: upper(response.category?.code, 120) || null
  };
  const jurisdictionMetadata = {
    country: "US",
    state,
    county,
    municipality,
    specialDistricts,
    submittedAddress: submitted.address,
    verifiedAddress: verifiedAddress.address,
    categoryStatus
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

export class ColoradoTaxProvider extends TaxProvider {
  constructor({ enabled = false, apiKey = "", lookup = null, timeoutMs = 3000, maxRetries = 1 } = {}) {
    super({ id: COLORADO_PROVIDER_ID, label: "Colorado Department of Revenue SUTS/GIS" });
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
      throw new TaxServiceError("Colorado SUTS/GIS provider credentials and authenticated API contract are not configured.", {
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
              code: "TAX_PROVIDER_UNAVAILABLE"
            }));
          }, this.timeoutMs);
        });
        const response = await Promise.race([
          this.lookup({
            apiKey: this.apiKey,
            address: input.address,
            effectiveAt: input.effectiveAt,
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
        if (classified.code !== "TAX_PROVIDER_UNAVAILABLE" || attempt >= this.maxRetries) throw classified;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new TaxServiceError("The Colorado tax provider is temporarily unavailable.", {
      status: 503,
      code: "TAX_PROVIDER_UNAVAILABLE"
    });
  }

  async resolveJurisdiction({ restaurantId, locationId, address, effectiveAt = new Date() }) {
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
    const result = await this.#boundedLookup({ address: validation.address, effectiveAt });
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

export function taxProviderFor(providerId, env = process.env, options = {}) {
  const id = upper(providerId, 80);
  if (id === "MANUAL_VERIFIED" || id === "LOOHAR_MANUAL_VERIFIED") return new ManualVerifiedTaxProvider();
  if (id === "COLORADO" || id === COLORADO_PROVIDER_ID) {
    return new ColoradoTaxProvider({
      enabled: env.COLORADO_SUTS_API_ENABLED === "true" || env.COLORADO_TAX_PROVIDER_ENABLED === "true",
      apiKey: env.COLORADO_SUTS_API_KEY,
      lookup: options.coloradoLookup,
      timeoutMs: env.COLORADO_SUTS_REQUEST_TIMEOUT_MS,
      maxRetries: env.COLORADO_SUTS_MAX_RETRIES
    });
  }
  throw new TaxServiceError("Tax jurisdiction is not supported.", {
    status: 422,
    code: "TAX_UNSUPPORTED_JURISDICTION"
  });
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
  if (profile?.provider !== COLORADO_PROVIDER_ID) return null;
  const categoryStatus = profile.sourceMetadataJson?.categoryStatus
    || profile.sourceMetadata?.categoryStatus
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
  if (profile.acknowledgementVersion !== profile.configurationVersion) {
    return { ready: false, status: TAX_PROFILE_STATUS.REVIEW_REQUIRED, code: "TAX_PROFILE_ACKNOWLEDGEMENT_REQUIRED" };
  }
  if (!isActiveTaxProfile(profile, asOf)) {
    return { ready: false, status: profile.status || TAX_PROFILE_STATUS.REVIEW_REQUIRED, code: "TAX_PROFILE_NOT_ACTIVE" };
  }
  return { ready: true, status: TAX_PROFILE_STATUS.ACTIVE, code: "TAX_PROFILE_ACTIVE" };
}
