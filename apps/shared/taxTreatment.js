export const TAX_TREATMENT = Object.freeze({
  LOCATION_DEFAULT: "LOCATION_DEFAULT",
  EXEMPT: "EXEMPT",
  CUSTOM_RULE: "CUSTOM_RULE"
});

const VALID_TREATMENTS = new Set(Object.values(TAX_TREATMENT));

export class TaxTreatmentError extends Error {
  constructor(message, code = "TAX_TREATMENT_INVALID") {
    super(message);
    this.name = "TaxTreatmentError";
    this.code = code;
    this.status = 400;
  }
}

export function normalizeTaxTreatment(value) {
  const treatment = String(value || TAX_TREATMENT.LOCATION_DEFAULT).trim().toUpperCase();
  if (!VALID_TREATMENTS.has(treatment)) {
    throw new TaxTreatmentError("Select a valid tax treatment.");
  }
  return treatment;
}

export function verifiedCustomTaxRule(rule = {}) {
  const rateBps = Number(rule?.taxRateBps);
  const sourceReference = String(rule?.sourceReference || "").trim().slice(0, 240);
  const verifiedAt = rule?.verifiedAt ? new Date(rule.verifiedAt) : null;
  if (
    !Number.isSafeInteger(rateBps)
    || rateBps < 0
    || rateBps > 10_000
    || !sourceReference
    || !verifiedAt
    || Number.isNaN(verifiedAt.getTime())
  ) {
    throw new TaxTreatmentError(
      "Custom tax treatment requires a verified rate, source, and verification time.",
      "TAX_CUSTOM_RULE_REQUIRED"
    );
  }
  return { taxRateBps: rateBps, sourceReference, verifiedAt: verifiedAt.toISOString() };
}

export function normalizeTaxRuleForStorage(treatment, rule) {
  const normalizedTreatment = normalizeTaxTreatment(treatment);
  return normalizedTreatment === TAX_TREATMENT.CUSTOM_RULE ? verifiedCustomTaxRule(rule) : null;
}

export function resolveMenuItemTaxTreatment({ item = {}, category = {}, locationTaxRateBps }) {
  const itemTreatment = normalizeTaxTreatment(item.taxTreatment);
  const categoryTreatment = normalizeTaxTreatment(category.taxTreatment);
  const treatment = itemTreatment !== TAX_TREATMENT.LOCATION_DEFAULT
    ? itemTreatment
    : categoryTreatment;

  if (treatment === TAX_TREATMENT.EXEMPT) {
    return { treatment, taxRateBps: 0, source: itemTreatment === treatment ? "ITEM" : "CATEGORY", customRule: null };
  }
  if (treatment === TAX_TREATMENT.CUSTOM_RULE) {
    const customRule = verifiedCustomTaxRule(itemTreatment === treatment ? item.taxRuleJson : category.taxRuleJson);
    return {
      treatment,
      taxRateBps: customRule.taxRateBps,
      source: itemTreatment === treatment ? "ITEM" : "CATEGORY",
      customRule
    };
  }
  const rateBps = Number(locationTaxRateBps);
  if (!Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > 100_000) {
    throw new TaxTreatmentError("An active location tax profile is required.", "TAX_LOCATION_DEFAULT_REQUIRED");
  }
  return { treatment: TAX_TREATMENT.LOCATION_DEFAULT, taxRateBps: rateBps, source: "LOCATION", customRule: null };
}
