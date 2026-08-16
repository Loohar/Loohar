import { prisma } from "../config/prisma.js";
import { recordAudit } from "./auditService.js";
import {
  TAX_CATEGORY_STATUS,
  TAX_PROFILE_STATUS,
  TAX_VERIFICATION_STATUS,
  TaxServiceError,
  isActiveTaxProfile,
  normalizeBusinessAddress,
  taxCategoryActivationError,
  taxProfileReadiness,
  taxProviderFor,
  taxProviderOperationalStatus,
  validateBusinessAddress
} from "./taxDomain.js";

function errorStatus(code) {
  if (["TAX_ADDRESS_REQUIRED", "TAX_ADDRESS_INVALID", "TAX_ADDRESS_NOT_FOUND"].includes(code)) return TAX_PROFILE_STATUS.ADDRESS_REQUIRED;
  if (code === "TAX_UNSUPPORTED_JURISDICTION") return TAX_PROFILE_STATUS.UNSUPPORTED_JURISDICTION;
  if (["TAX_PROVIDER_NOT_CONFIGURED", "TAX_PROVIDER_UNAVAILABLE", "TAX_PROVIDER_AUTH_FAILED"].includes(code)) return TAX_PROFILE_STATUS.PROVIDER_ERROR;
  if (["TAX_CATEGORY_RULE_REQUIRED", "TAX_UNSUPPORTED_SPECIAL_RATE", "TAX_MANUAL_REVIEW_REQUIRED", "TAX_RATE_NOT_EFFECTIVE"].includes(code)) return TAX_PROFILE_STATUS.REVIEW_REQUIRED;
  return TAX_PROFILE_STATUS.PROVIDER_ERROR;
}

function providerEvent(event, metadata = {}) {
  console.info(JSON.stringify({ event, ...metadata }));
}

function date(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function profileShape(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    restaurantId: profile.restaurantId,
    locationId: profile.locationId,
    status: profile.status,
    verificationStatus: profile.verificationStatus,
    provider: profile.provider,
    source: profile.source,
    taxRateBps: profile.taxRateBps,
    taxInclusive: profile.taxInclusive,
    enabled: profile.enabled,
    countryCode: profile.countryCode,
    stateCode: profile.stateCode,
    county: profile.county,
    municipality: profile.municipality,
    jurisdictionCode: profile.jurisdictionCode,
    jurisdictionMetadata: profile.jurisdictionJson,
    specialDistricts: profile.specialDistrictsJson || [],
    taxComponents: profile.taxComponentsJson || [],
    exemption: profile.exemptionJson || null,
    sourceMetadata: profile.sourceMetadataJson,
    categoryStatus: profile.sourceMetadataJson?.categoryStatus || null,
    materialFingerprint: profile.sourceMetadataJson?.materialFingerprint || null,
    effectiveAt: profile.effectiveAt,
    expiresAt: profile.expiresAt,
    verifiedAt: profile.verifiedAt,
    lastVerifiedAt: profile.lastVerifiedAt,
    nextVerificationAt: profile.nextVerificationAt,
    configurationVersion: profile.configurationVersion,
    acknowledgementVersion: profile.acknowledgementVersion,
    acknowledgedByUserId: profile.acknowledgedByUserId,
    acknowledgedAt: profile.acknowledgedAt,
    activatedAt: profile.activatedAt,
    supersededAt: profile.supersededAt,
    disabledAt: profile.disabledAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}

function taxSnapshot(profile) {
  const shaped = profileShape(profile);
  return shaped ? {
    id: shaped.id,
    locationId: shaped.locationId,
    provider: shaped.provider,
    source: shaped.source,
    taxRateBps: shaped.taxRateBps,
    taxInclusive: shaped.taxInclusive,
    enabled: shaped.enabled,
    countryCode: shaped.countryCode,
    stateCode: shaped.stateCode,
    county: shaped.county,
    municipality: shaped.municipality,
    jurisdictionCode: shaped.jurisdictionCode,
    jurisdictionMetadata: shaped.jurisdictionMetadata,
    specialDistricts: shaped.specialDistricts,
    taxComponents: shaped.taxComponents,
    exemption: shaped.exemption,
    sourceMetadata: shaped.sourceMetadata,
    effectiveAt: shaped.effectiveAt.toISOString(),
    expiresAt: shaped.expiresAt?.toISOString() || null,
    verifiedAt: shaped.verifiedAt.toISOString(),
    lastVerifiedAt: shaped.lastVerifiedAt?.toISOString() || shaped.verifiedAt.toISOString(),
    nextVerificationAt: shaped.nextVerificationAt?.toISOString() || null,
    configurationVersion: shaped.configurationVersion,
    acknowledgementVersion: shaped.acknowledgementVersion,
    acknowledgedAt: shaped.acknowledgedAt?.toISOString() || null,
    updatedAt: shaped.updatedAt.toISOString()
  } : null;
}

async function locationForTenant({ restaurantId, locationId }) {
  const location = await prisma.restaurantLocation.findFirst({
    where: { id: locationId, restaurantId },
    include: { restaurant: { select: { id: true, slug: true, name: true, businessName: true } } }
  });
  if (!location) {
    throw new TaxServiceError("Location not found for this restaurant.", { status: 404, code: "TAX_LOCATION_NOT_FOUND" });
  }
  return location;
}

async function updateLocationTaxState({ location, status, code, message, normalizedAddress, addressValidationStatus }) {
  return prisma.restaurantLocation.update({
    where: { id: location.id },
    data: {
      taxStatus: status,
      taxStatusCode: code || null,
      taxStatusMessage: message || null,
      taxLastAttemptAt: new Date(),
      ...(normalizedAddress ? { normalizedAddressJson: normalizedAddress } : {}),
      ...(addressValidationStatus ? {
        addressValidationStatus,
        addressVerifiedAt: addressValidationStatus === "VALID" ? new Date() : null
      } : {})
    }
  });
}

async function audit({ actorUserId, restaurantId, action, entityId, metadata = {} }) {
  return recordAudit({
    actorUserId,
    restaurantId,
    action,
    entityType: "LocationTaxProfile",
    entityId,
    metadata
  });
}

function autoProviderId(address) {
  if (address.country === "US" && address.stateProvince === "CO") return "COLORADO";
  throw new TaxServiceError("No tax provider supports this jurisdiction yet.", {
    status: 422,
    code: "TAX_UNSUPPORTED_JURISDICTION"
  });
}

async function createCandidateProfile({ restaurantId, locationId, configuration, actorUserId }) {
  const materialFingerprint = configuration.materialFingerprint || configuration.sourceMetadata?.materialFingerprint;
  if (materialFingerprint) {
    const recent = await prisma.locationTaxProfile.findMany({
      where: {
        restaurantId,
        locationId,
        provider: configuration.provider,
        status: { in: [TAX_PROFILE_STATUS.ACTIVE, TAX_PROFILE_STATUS.REVIEW_REQUIRED] }
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 10
    });
    const sameMaterial = recent.find((profile) => profile.sourceMetadataJson?.materialFingerprint === materialFingerprint);
    if (sameMaterial) {
      const profile = await prisma.locationTaxProfile.update({
        where: { id: sameMaterial.id },
        data: {
          lastVerifiedAt: configuration.verifiedAt,
          nextVerificationAt: configuration.nextVerificationAt
        }
      });
      await audit({
        actorUserId,
        restaurantId,
        action: "tax.profile.verification_refreshed",
        entityId: profile.id,
        metadata: {
          locationId,
          provider: profile.provider,
          configurationVersion: profile.configurationVersion,
          materialFingerprint,
          providerResponseFingerprint: configuration.sourceMetadata?.providerResponseFingerprint || null,
          sourceReference: configuration.sourceMetadata?.sourceReference || null,
          verifiedAt: configuration.verifiedAt?.toISOString?.() || null
        }
      });
      return { profile, created: false, verificationRefreshed: true };
    }
  }
  const existing = await prisma.locationTaxProfile.findUnique({
    where: {
      restaurantId_locationId_configurationVersion: {
        restaurantId,
        locationId,
        configurationVersion: configuration.configurationVersion
      }
    }
  });
  if (existing) return { profile: existing, created: false };
  let profile;
  try {
    profile = await prisma.locationTaxProfile.create({
      data: {
        restaurantId,
        locationId,
        status: TAX_PROFILE_STATUS.REVIEW_REQUIRED,
        verificationStatus: TAX_VERIFICATION_STATUS.VERIFIED,
        provider: configuration.provider,
        source: configuration.source,
        taxRateBps: configuration.taxRateBps,
        taxInclusive: configuration.taxInclusive,
        enabled: false,
        countryCode: configuration.countryCode,
        stateCode: configuration.stateCode,
        county: configuration.county,
        municipality: configuration.municipality,
        jurisdictionCode: configuration.jurisdictionCode,
        jurisdictionJson: configuration.jurisdictionMetadata,
        specialDistrictsJson: configuration.specialDistricts || [],
        taxComponentsJson: configuration.taxComponents || [],
        exemptionJson: configuration.exemption || null,
        sourceMetadataJson: configuration.sourceMetadata,
        effectiveAt: configuration.effectiveAt,
        expiresAt: configuration.expiresAt,
        verifiedAt: configuration.verifiedAt,
        lastVerifiedAt: configuration.verifiedAt,
        nextVerificationAt: configuration.nextVerificationAt,
        configurationVersion: configuration.configurationVersion
      }
    });
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    profile = await prisma.locationTaxProfile.findUnique({
      where: {
        restaurantId_locationId_configurationVersion: {
          restaurantId,
          locationId,
          configurationVersion: configuration.configurationVersion
        }
      }
    });
    if (!profile) throw error;
    return { profile, created: false };
  }
  await audit({
    actorUserId,
    restaurantId,
    action: "tax.profile.created",
    entityId: profile.id,
    metadata: {
      locationId,
      status: profile.status,
      provider: profile.provider,
      source: profile.source,
      configurationVersion: profile.configurationVersion
    }
  });
  return { profile, created: true };
}

async function setCandidateLocationState({ location, profile, normalizedAddress }) {
  if (isActiveTaxProfile(profile)) {
    await updateLocationTaxState({
      location,
      status: TAX_PROFILE_STATUS.ACTIVE,
      code: "TAX_PROFILE_ACTIVE",
      message: null,
      normalizedAddress,
      addressValidationStatus: normalizedAddress ? "VALID" : undefined
    });
    return;
  }
  if (profile.status !== TAX_PROFILE_STATUS.REVIEW_REQUIRED) {
    throw new TaxServiceError("This exact tax profile version is finalized. Submit a newly verified source record.", {
      status: 409,
      code: "TAX_PROFILE_VERSION_FINALIZED"
    });
  }
  await updateLocationTaxState({
    location,
    status: TAX_PROFILE_STATUS.REVIEW_REQUIRED,
    code: "TAX_PROFILE_REVIEW_REQUIRED",
    message: "Review and acknowledge the verified tax profile before activation.",
    normalizedAddress,
    addressValidationStatus: normalizedAddress ? "VALID" : undefined
  });
}

export async function resolveLocationTaxProfile({ restaurantId, locationId, actorUserId, providerId }) {
  const location = await locationForTenant({ restaurantId, locationId });
  const address = normalizeBusinessAddress(location);
  const validation = validateBusinessAddress(address);
  if (!validation.valid) {
    await updateLocationTaxState({
      location,
      status: TAX_PROFILE_STATUS.ADDRESS_REQUIRED,
      code: "TAX_ADDRESS_REQUIRED",
      message: `Complete: ${validation.missing.join(", ")}.`,
      normalizedAddress: validation.address,
      addressValidationStatus: "INVALID"
    });
    throw new TaxServiceError("A complete physical business address is required.", {
      code: "TAX_ADDRESS_REQUIRED",
      details: { missing: validation.missing }
    });
  }
  await updateLocationTaxState({
    location,
    status: TAX_PROFILE_STATUS.VERIFYING,
    code: null,
    message: null,
    normalizedAddress: validation.address
  });
  try {
    const resolvedProviderId = providerId || autoProviderId(validation.address);
    const provider = taxProviderFor(resolvedProviderId);
    const jurisdiction = await provider.resolveJurisdiction({
      restaurantId,
      locationId,
      address: validation.address,
      effectiveAt: new Date()
    });
    const configuration = await provider.getTaxConfiguration({
      restaurantId,
      locationId,
      address: validation.address,
      jurisdiction,
      effectiveAt: new Date()
    });
    const { profile } = await createCandidateProfile({ restaurantId, locationId, configuration, actorUserId });
    const verifiedAddress = configuration.jurisdictionMetadata?.verifiedAddress || validation.address;
    await setCandidateLocationState({ location, profile, normalizedAddress: verifiedAddress });
    await audit({
      actorUserId,
      restaurantId,
      action: "tax.profile.resolved",
      entityId: profile.id,
      metadata: { locationId, provider: profile.provider, configurationVersion: profile.configurationVersion }
    });
    providerEvent("tax.provider.success", {
      restaurantId,
      locationId,
      provider: profile.provider,
      configurationVersion: profile.configurationVersion
    });
    return profileShape(profile);
  } catch (error) {
    const code = error.code || "TAX_PROVIDER_ERROR";
    const status = errorStatus(code);
    const addressValidationStatus = ["TAX_ADDRESS_INVALID", "TAX_ADDRESS_NOT_FOUND"].includes(code)
      ? "INVALID"
      : ["TAX_PROVIDER_NOT_CONFIGURED", "TAX_PROVIDER_UNAVAILABLE", "TAX_PROVIDER_AUTH_FAILED"].includes(code)
        ? "PROVIDER_UNAVAILABLE"
        : undefined;
    await updateLocationTaxState({ location, status, code, message: error.message, addressValidationStatus });
    await audit({
      actorUserId,
      restaurantId,
      action: "tax.profile.resolution_failed",
      entityId: location.id,
      metadata: { locationId, providerId: providerId || "AUTO", status, code }
    }).catch(() => {});
    providerEvent("tax.provider.failure", {
      restaurantId,
      locationId,
      provider: providerId || "AUTO",
      code
    });
    throw error;
  }
}

export async function createManualVerifiedTaxProfile({ restaurantId, locationId, actorUserId, configuration }) {
  const location = await locationForTenant({ restaurantId, locationId });
  const address = normalizeBusinessAddress(location);
  const provider = taxProviderFor("MANUAL_VERIFIED");
  const verified = await provider.verifyTaxConfiguration({
    restaurantId,
    locationId,
    address,
    effectiveAt: configuration.effectiveAt,
    manualConfiguration: configuration
  });
  const { profile } = await createCandidateProfile({ restaurantId, locationId, configuration: verified, actorUserId });
  const profileActive = isActiveTaxProfile(profile);
  if (!profileActive && profile.status !== TAX_PROFILE_STATUS.REVIEW_REQUIRED) {
    throw new TaxServiceError("This exact tax profile version is finalized. Submit a newly verified source record.", {
      status: 409,
      code: "TAX_PROFILE_VERSION_FINALIZED"
    });
  }
  await updateLocationTaxState({
    location,
    status: profileActive ? TAX_PROFILE_STATUS.ACTIVE : TAX_PROFILE_STATUS.REVIEW_REQUIRED,
    code: profileActive ? "TAX_PROFILE_ACTIVE" : "TAX_PROFILE_REVIEW_REQUIRED",
    message: profileActive ? null : "Review and acknowledge the manually verified tax profile before activation.",
    normalizedAddress: validateBusinessAddress(address).address,
    addressValidationStatus: "VALID"
  });
  await audit({
    actorUserId,
    restaurantId,
    action: "tax.profile.manual_verified",
    entityId: profile.id,
    metadata: {
      locationId,
      source: profile.source,
      provider: profile.provider,
      configurationVersion: profile.configurationVersion,
      sourceReference: profile.sourceMetadataJson?.sourceReference || null
    }
  });
  return profileShape(profile);
}

function activationValidation(profile, now = new Date()) {
  if (!profile) throw new TaxServiceError("Tax profile not found.", { status: 404, code: "TAX_PROFILE_NOT_FOUND" });
  if (profile.status !== TAX_PROFILE_STATUS.REVIEW_REQUIRED) {
    throw new TaxServiceError("Only a reviewed candidate profile can be activated.", { status: 409, code: "TAX_PROFILE_NOT_REVIEWABLE" });
  }
  if (profile.verificationStatus !== TAX_VERIFICATION_STATUS.VERIFIED) {
    throw new TaxServiceError("Tax profile verification is incomplete.", { status: 409, code: "TAX_PROFILE_NOT_VERIFIED" });
  }
  if (
    !Number.isSafeInteger(profile.taxRateBps)
    || profile.taxRateBps < 0
    || profile.taxRateBps > 100_000
    || !String(profile.provider || "").trim()
    || !String(profile.source || "").trim()
    || !String(profile.countryCode || "").trim()
    || !String(profile.jurisdictionCode || "").trim()
    || !String(profile.configurationVersion || "").trim()
    || !profile.jurisdictionJson
    || !profile.sourceMetadataJson
  ) {
    throw new TaxServiceError("Tax profile verification metadata is incomplete.", { status: 409, code: "TAX_PROFILE_INVALID" });
  }
  if (profile.effectiveAt > now) {
    throw new TaxServiceError("Tax profile is not effective yet.", { status: 409, code: "TAX_RATE_NOT_EFFECTIVE" });
  }
  if (profile.verifiedAt > now) {
    throw new TaxServiceError("Tax profile verification is not valid yet.", { status: 409, code: "TAX_PROFILE_NOT_VERIFIED" });
  }
  if (profile.expiresAt && profile.expiresAt <= now) {
    throw new TaxServiceError("Tax profile has expired.", { status: 409, code: "TAX_PROFILE_EXPIRED" });
  }
  if (profile.nextVerificationAt && profile.nextVerificationAt <= now) {
    throw new TaxServiceError("Tax profile verification must be refreshed.", { status: 409, code: "TAX_PROFILE_REFRESH_REQUIRED" });
  }
  const categoryError = taxCategoryActivationError(profile);
  if (categoryError) {
    throw new TaxServiceError("This Colorado result requires category-specific tax review before activation.", {
      status: 409,
      code: categoryError,
      details: { categoryStatus: profile.sourceMetadataJson?.categoryStatus || TAX_CATEGORY_STATUS.MANUAL_REVIEW_REQUIRED }
    });
  }
}

function validatedLocationAddress(location) {
  const validation = validateBusinessAddress(normalizeBusinessAddress(location));
  const stored = location.normalizedAddressJson && typeof location.normalizedAddressJson === "object"
    ? location.normalizedAddressJson
    : {};
  const fields = ["addressLine1", "addressLine2", "city", "stateProvince", "postalCode", "country"];
  const matchesStoredAddress = fields.every((field) => String(stored[field] || "") === String(validation.address[field] || ""));
  if (!validation.valid || location.addressValidationStatus !== "VALID" || !matchesStoredAddress) {
    throw new TaxServiceError("Verify the location's current physical address before activating tax.", {
      status: 409,
      code: "TAX_ADDRESS_VERIFICATION_REQUIRED"
    });
  }
}

export async function acknowledgeAndActivateTaxProfile({ restaurantId, locationId, profileId, actorUserId, confirmed, configurationVersion }) {
  if (confirmed !== true) {
    throw new TaxServiceError("Confirm the verified business location and tax profile before activation.", {
      code: "TAX_PROFILE_ACKNOWLEDGEMENT_REQUIRED"
    });
  }
  const location = await locationForTenant({ restaurantId, locationId });
  validatedLocationAddress(location);
  const candidate = await prisma.locationTaxProfile.findFirst({ where: { id: profileId, restaurantId, locationId } });
  activationValidation(candidate);
  if (configurationVersion !== candidate.configurationVersion) {
    throw new TaxServiceError("The tax profile changed. Review the current version before activation.", {
      status: 409,
      code: "TAX_PROFILE_VERSION_MISMATCH"
    });
  }
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const superseded = await tx.locationTaxProfile.findMany({
      where: { restaurantId, locationId, status: TAX_PROFILE_STATUS.ACTIVE, enabled: true, NOT: { id: candidate.id } },
      select: { id: true, configurationVersion: true, provider: true, source: true }
    });
    await tx.locationTaxProfile.updateMany({
      where: { restaurantId, locationId, status: TAX_PROFILE_STATUS.ACTIVE, enabled: true, NOT: { id: candidate.id } },
      data: { status: TAX_PROFILE_STATUS.SUPERSEDED, enabled: false, supersededAt: now }
    });
    const activated = await tx.locationTaxProfile.updateMany({
      where: {
        id: candidate.id,
        restaurantId,
        locationId,
        status: TAX_PROFILE_STATUS.REVIEW_REQUIRED,
        verificationStatus: TAX_VERIFICATION_STATUS.VERIFIED,
        configurationVersion: candidate.configurationVersion
      },
      data: {
        status: TAX_PROFILE_STATUS.ACTIVE,
        enabled: true,
        acknowledgementVersion: candidate.configurationVersion,
        acknowledgedByUserId: actorUserId,
        acknowledgedAt: now,
        activatedAt: now,
        disabledAt: null
      }
    });
    if (activated.count !== 1) {
      throw new TaxServiceError("Tax profile activation conflicted with another update.", {
        status: 409,
        code: "TAX_PROFILE_ACTIVATION_CONFLICT"
      });
    }
    const profile = await tx.locationTaxProfile.findUnique({ where: { id: candidate.id } });
    await tx.restaurantLocation.update({
      where: { id: locationId },
      data: {
        taxStatus: TAX_PROFILE_STATUS.ACTIVE,
        taxStatusCode: "TAX_PROFILE_ACTIVE",
        taxStatusMessage: null,
        taxLastAttemptAt: now
      }
    });
    return { profile, superseded };
  });
  for (const previous of result.superseded) {
    await audit({
      actorUserId,
      restaurantId,
      action: "tax.profile.superseded",
      entityId: previous.id,
      metadata: {
        locationId,
        oldVersion: previous.configurationVersion,
        newVersion: result.profile.configurationVersion,
        provider: previous.provider,
        source: previous.source,
        reason: "new_profile_activated"
      }
    });
  }
  await audit({
    actorUserId,
    restaurantId,
    action: "tax.profile.acknowledged",
    entityId: result.profile.id,
    metadata: { locationId, configurationVersion: result.profile.configurationVersion }
  });
  await audit({
    actorUserId,
    restaurantId,
    action: "tax.profile.activated",
    entityId: result.profile.id,
    metadata: {
      locationId,
      provider: result.profile.provider,
      source: result.profile.source,
      configurationVersion: result.profile.configurationVersion
    }
  });
  return profileShape(result.profile);
}

export async function refreshLocationTaxProfile({ restaurantId, locationId, actorUserId }) {
  const location = await locationForTenant({ restaurantId, locationId });
  const current = await prisma.locationTaxProfile.findFirst({
    where: { restaurantId, locationId, status: TAX_PROFILE_STATUS.ACTIVE, enabled: true },
    orderBy: [{ effectiveAt: "desc" }, { updatedAt: "desc" }]
  });
  if (!current) return resolveLocationTaxProfile({ restaurantId, locationId, actorUserId });
  if (current.provider === "LOOHAR_MANUAL_VERIFIED") {
    await updateLocationTaxState({
      location,
      status: TAX_PROFILE_STATUS.REFRESH_REQUIRED,
      code: "TAX_MANUAL_REVERIFICATION_REQUIRED",
      message: "A privileged administrator must provide a newly verified source record."
    });
    await audit({
      actorUserId,
      restaurantId,
      action: "tax.profile.refresh_requested",
      entityId: current.id,
      metadata: { locationId, configurationVersion: current.configurationVersion, provider: current.provider }
    });
    throw new TaxServiceError("Manual tax profiles require a new verified source record.", {
      status: 409,
      code: "TAX_MANUAL_REVERIFICATION_REQUIRED"
    });
  }
  const refreshed = await resolveLocationTaxProfile({ restaurantId, locationId, actorUserId, providerId: current.provider });
  await audit({
    actorUserId,
    restaurantId,
    action: "tax.profile.refreshed",
    entityId: refreshed.id,
    metadata: {
      locationId,
      oldVersion: current.configurationVersion,
      newVersion: refreshed.configurationVersion,
      provider: refreshed.provider,
      source: refreshed.source,
      reason: "administrator_refresh"
    }
  });
  return refreshed;
}

export async function findValidLocationTaxConfiguration({ restaurantId, locationId, asOf = new Date() }) {
  if (!locationId) return null;
  const profile = await prisma.locationTaxProfile.findFirst({
    where: {
      restaurantId,
      locationId,
      status: TAX_PROFILE_STATUS.ACTIVE,
      verificationStatus: TAX_VERIFICATION_STATUS.VERIFIED,
      enabled: true,
      acknowledgedByUserId: { not: null },
      acknowledgedAt: { lte: asOf },
      effectiveAt: { lte: asOf },
      verifiedAt: { lte: asOf },
      OR: [{ expiresAt: null }, { expiresAt: { gt: asOf } }],
      AND: [{ OR: [{ nextVerificationAt: null }, { nextVerificationAt: { gt: asOf } }] }]
    },
    orderBy: [{ effectiveAt: "desc" }, { verifiedAt: "desc" }, { updatedAt: "desc" }]
  });
  if (!isActiveTaxProfile(profile, asOf)) return null;
  return taxSnapshot(profile);
}

export async function taxProfileHistory({ restaurantId, locationId }) {
  await locationForTenant({ restaurantId, locationId });
  const profiles = await prisma.locationTaxProfile.findMany({
    where: { restaurantId, locationId },
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }]
  });
  return profiles.map(profileShape);
}

export async function getTaxWorkspace({ restaurantId }) {
  const locations = await prisma.restaurantLocation.findMany({
    where: { restaurantId },
    include: {
      taxProfiles: { orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }] }
    },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }]
  });
  const workspaceLocations = locations.map((location) => {
    const address = normalizeBusinessAddress(location);
    const profiles = location.taxProfiles.map(profileShape);
    const activeProfile = profiles.find((profile) => isActiveTaxProfile(profile)) || null;
    const latestActiveRecord = profiles.find((profile) => profile.status === TAX_PROFILE_STATUS.ACTIVE) || null;
    const reviewProfile = profiles.find((profile) => profile.status === TAX_PROFILE_STATUS.REVIEW_REQUIRED) || null;
    const evaluatedProfile = latestActiveRecord || reviewProfile;
    const readiness = taxProfileReadiness(evaluatedProfile);
    const status = readiness.ready
      ? TAX_PROFILE_STATUS.ACTIVE
      : evaluatedProfile ? readiness.status : location.taxStatus;
    return {
      id: location.id,
      restaurantId: location.restaurantId,
      name: location.name,
      active: location.active,
      address,
      addressValidationStatus: location.addressValidationStatus,
      status,
      statusCode: evaluatedProfile ? readiness.code : location.taxStatusCode,
      statusMessage: location.taxStatusMessage,
      lastAttemptAt: location.taxLastAttemptAt,
      activeProfile,
      reviewProfile,
      history: profiles
    };
  });
  const activeLocations = workspaceLocations.filter((location) => location.active);
  return {
    ready: activeLocations.length > 0 && activeLocations.every((location) => location.status === TAX_PROFILE_STATUS.ACTIVE),
    counts: {
      activeLocations: activeLocations.length,
      readyLocations: activeLocations.filter((location) => location.status === TAX_PROFILE_STATUS.ACTIVE).length
    },
    providers: [taxProviderOperationalStatus("COLORADO")],
    locations: workspaceLocations
  };
}

export function locationTaxProfileSnapshot(profile) {
  return taxSnapshot(profile);
}
