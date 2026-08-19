import {
  AVALARA_PROVIDER_ID,
  TAX_CATEGORY_STATUS,
  compareTaxProviderResults,
  taxProviderFor
} from "../apps/api/src/services/taxDomain.js";

const requiredVariables = [
  "AVALARA_SANDBOX_ACCOUNT_ID",
  "AVALARA_SANDBOX_LICENSE_KEY",
  "AVALARA_SANDBOX_COMPANY_CODE"
];
const addresses = [
  { label: "Colorado State Capitol", addressLine1: "200 E Colfax Ave", city: "Denver", stateProvince: "CO", postalCode: "80203", country: "US" },
  { label: "Queens Borough Hall", addressLine1: "120-55 Queens Blvd", city: "Kew Gardens", stateProvince: "NY", postalCode: "11424", country: "US" },
  { label: "Los Angeles City Hall", addressLine1: "200 N Spring St", city: "Los Angeles", stateProvince: "CA", postalCode: "90012", country: "US" },
  { label: "Utah State Capitol", addressLine1: "350 N State St", city: "Salt Lake City", stateProvince: "UT", postalCode: "84103", country: "US" },
  { label: "North Dakota State Capitol", addressLine1: "600 E Boulevard Ave", city: "Bismarck", stateProvince: "ND", postalCode: "58505", country: "US" },
  { label: "South Dakota State Capitol", addressLine1: "500 E Capitol Ave", city: "Pierre", stateProvince: "SD", postalCode: "57501", country: "US" }
];

function percentage(rateMicros) {
  return `${(Number(rateMicros) / 10_000).toFixed(4).replace(/\.?0+$/, "")}%`;
}

function sanitizedConfiguration(configuration) {
  return {
    provider: configuration.provider,
    normalizedAddress: configuration.normalizedAddress?.normalizedAddress || null,
    state: configuration.stateCode,
    county: configuration.county,
    municipality: configuration.municipality,
    districts: (configuration.specialDistricts || []).map((district) => district.name),
    components: (configuration.taxComponents || []).map((component) => ({
      type: component.type,
      name: component.name,
      jurisdictionCode: component.jurisdictionCode,
      rateMicros: component.rateMicros,
      rateBps: component.rateBps,
      rate: percentage(component.rateMicros)
    })),
    combinedRateMicros: configuration.taxRateMicros,
    combinedRateBps: configuration.taxRateBps,
    combinedRate: percentage(configuration.taxRateMicros),
    componentReconciliation: configuration.sourceMetadata?.componentReconciliationStatus,
    taxableAmountCents: configuration.sourceMetadata?.taxableAmountCents,
    exemptAmountCents: configuration.sourceMetadata?.exemptAmountCents,
    categoryStatus: configuration.categoryStatus,
    providerLatencyMs: configuration.sourceMetadata?.providerLatencyMs ?? null
  };
}

const missingVariables = requiredVariables.filter((name) => !String(process.env[name] || "").trim());
if (missingVariables.length) {
  console.log(JSON.stringify({
    status: "BLOCKED",
    avalaraSandboxConfigured: false,
    missingVariables,
    code: "TAX_PROVIDER_NOT_CONFIGURED"
  }, null, 2));
  process.exitCode = 1;
} else {
  const env = { ...process.env, NATIONAL_TAX_PROVIDER: "AVALARA" };
  const national = taxProviderFor("AVALARA", env);
  if (national.id !== AVALARA_PROVIDER_ID) throw new Error("Avalara provider routing failed closed.");
  const results = [];
  const configurations = new Map();
  for (const [index, fixture] of addresses.entries()) {
    const startedAt = Date.now();
    try {
      const configuration = await national.resolveJurisdiction({
        restaurantId: "staging-avalara-certification",
        locationId: `public-${fixture.stateProvince.toLowerCase()}-${index + 1}`,
        address: fixture
      });
      configurations.set(fixture.stateProvince, configuration);
      results.push({
        label: fixture.label,
        status: configuration.categoryStatus === TAX_CATEGORY_STATUS.GENERAL_RATE_SUPPORTED ? "PASS" : "REVIEW_REQUIRED",
        ...sanitizedConfiguration(configuration),
        certificationLatencyMs: Math.max(0, Date.now() - startedAt)
      });
    } catch (error) {
      results.push({
        label: fixture.label,
        state: fixture.stateProvince,
        status: "FAIL",
        code: error?.code || "TAX_PROVIDER_ERROR",
        certificationLatencyMs: Math.max(0, Date.now() - startedAt)
      });
    }
  }

  let coloradoComparison = { status: "NOT_RUN", code: "COLORADO_TTR_NOT_CONFIGURED" };
  const coloradoAvalara = results.find((result) => result.state === "CO" && result.status !== "FAIL");
  if (coloradoAvalara && String(process.env.COLORADO_TTR_API_KEY || "").trim()) {
    try {
      const coloradoProvider = taxProviderFor("COLORADO_TTR", env);
      const coloradoResult = await coloradoProvider.resolveJurisdiction({
        restaurantId: "staging-avalara-certification",
        locationId: "public-co-comparison",
        address: addresses[0]
      });
      const comparison = compareTaxProviderResults(configurations.get("CO"), coloradoResult);
      coloradoComparison = {
        status: comparison.status === "MATCHED" ? "PASS" : "REVIEW_REQUIRED",
        checks: comparison.checks,
        avalaraRateMicros: comparison.primaryRateMicros,
        avalaraRate: percentage(comparison.primaryRateMicros),
        ttrRateMicros: comparison.validationRateMicros,
        ttrRate: percentage(comparison.validationRateMicros)
      };
    } catch (error) {
      coloradoComparison = { status: "FAIL", code: error?.code || "COLORADO_COMPARISON_ERROR" };
    }
  }

  const matrixPassed = results.length === addresses.length && results.every((result) => result.status === "PASS");
  const comparisonPassed = coloradoComparison.status === "PASS";
  console.log(JSON.stringify({
    status: matrixPassed && comparisonPassed ? "PASS" : "FAIL",
    avalaraSandboxConfigured: true,
    providerEnvironment: "SANDBOX",
    results,
    coloradoComparison
  }, null, 2));
  if (!matrixPassed || !comparisonPassed) process.exitCode = 1;
}
