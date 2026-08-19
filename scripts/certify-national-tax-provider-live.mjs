import {
  TAX_CATEGORY_STATUS,
  compareTaxProviderResults,
  taxProviderFor
} from "../apps/api/src/services/taxDomain.js";

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
    normalizedAddress: configuration.normalizedAddress?.normalizedAddress || null,
    state: configuration.stateCode,
    county: configuration.county,
    municipality: configuration.municipality,
    districts: (configuration.specialDistricts || []).map((district) => district.name),
    components: (configuration.taxComponents || []).map((component) => ({
      type: component.type,
      name: component.name,
      rateMicros: component.rateMicros,
      rateBps: component.rateBps,
      rate: percentage(component.rateMicros)
    })),
    combinedRateMicros: configuration.taxRateMicros,
    combinedRateBps: configuration.taxRateBps,
    combinedRate: percentage(configuration.taxRateMicros),
    providerPrecision: "INTEGER_MICRO_RATE",
    componentReconciliation: configuration.sourceMetadata?.componentReconciliationStatus,
    categoryStatus: configuration.categoryStatus,
    providerLatencyMs: configuration.sourceMetadata?.providerLatencyMs ?? null
  };
}

const sandboxConfigured = Boolean(String(process.env.TAXJAR_SANDBOX_API_KEY || "").trim());
if (!sandboxConfigured) {
  console.log(JSON.stringify({ status: "BLOCKED", taxJarSandboxConfigured: false, code: "TAX_PROVIDER_NOT_CONFIGURED" }, null, 2));
  process.exitCode = 1;
} else {
  const env = { ...process.env, TAXJAR_API_ENVIRONMENT: "SANDBOX" };
  const national = taxProviderFor("NATIONAL", env);
  const results = [];
  const configurations = new Map();
  for (const [index, fixture] of addresses.entries()) {
    const startedAt = Date.now();
    try {
      const configuration = await national.resolveJurisdiction({
        restaurantId: "staging-national-certification",
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
  const coloradoNational = results.find((result) => result.state === "CO" && result.status !== "FAIL");
  if (coloradoNational && String(process.env.COLORADO_TTR_API_KEY || "").trim()) {
    try {
      const coloradoProvider = taxProviderFor("COLORADO_TTR", env);
      const coloradoResult = await coloradoProvider.resolveJurisdiction({
        restaurantId: "staging-national-certification",
        locationId: "public-co-comparison",
        address: addresses[0]
      });
      const nationalResult = configurations.get("CO");
      const comparison = compareTaxProviderResults(nationalResult, coloradoResult);
      coloradoComparison = {
        status: comparison.status === "MATCHED" ? "PASS" : "REVIEW_REQUIRED",
        checks: comparison.checks,
        taxJarRateMicros: comparison.primaryRateMicros,
        taxJarRate: percentage(comparison.primaryRateMicros),
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
    taxJarSandboxConfigured: true,
    providerEnvironment: "SANDBOX",
    results,
    coloradoComparison
  }, null, 2));
  if (!matrixPassed || !comparisonPassed) process.exitCode = 1;
}
