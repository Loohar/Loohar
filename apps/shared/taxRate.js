export const TAX_RATE_MICROS_SCALE = 1_000_000;
export const TAX_RATE_MICROS_PER_BASIS_POINT = 100;
export const MAX_TAX_RATE_MICROS = 10_000_000;

function integerRate(value, maximum, label) {
  const rate = Number(value);
  if (!Number.isSafeInteger(rate) || rate < 0 || rate > maximum) {
    throw new TypeError(`${label} must be a non-negative fixed-precision integer.`);
  }
  return rate;
}

export function taxRateMicrosFromBps(value) {
  return integerRate(value, MAX_TAX_RATE_MICROS / TAX_RATE_MICROS_PER_BASIS_POINT, "taxRateBps")
    * TAX_RATE_MICROS_PER_BASIS_POINT;
}

export function taxRateBpsFromMicros(value) {
  const micros = integerRate(value, MAX_TAX_RATE_MICROS, "taxRateMicros");
  return Math.round(micros / TAX_RATE_MICROS_PER_BASIS_POINT);
}

export function resolveTaxRateMicros({ taxRateMicros, taxRateBps } = {}) {
  if (taxRateMicros !== null && taxRateMicros !== undefined && taxRateMicros !== "") {
    return integerRate(taxRateMicros, MAX_TAX_RATE_MICROS, "taxRateMicros");
  }
  return taxRateMicrosFromBps(taxRateBps);
}

export function fractionalTaxRateToMicros(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new TypeError("Fractional tax rate is invalid.");
  const [whole, fraction = ""] = raw.split(".");
  if (fraction.slice(6).replace(/0/g, "")) throw new TypeError("Fractional tax rate exceeds micro-rate precision.");
  const micros = Number(BigInt(whole) * BigInt(TAX_RATE_MICROS_SCALE)
    + BigInt((fraction.slice(0, 6) + "000000").slice(0, 6)));
  if (!Number.isSafeInteger(micros) || micros < 0 || micros > TAX_RATE_MICROS_SCALE) {
    throw new TypeError("Fractional tax rate is outside the supported range.");
  }
  return micros;
}

function roundedRatio(numerator, denominator) {
  const top = BigInt(numerator);
  const bottom = BigInt(denominator);
  return Number((top + (bottom / 2n)) / bottom);
}

export function calculateTaxCents({ taxableAmountCents, taxRateMicros, taxInclusive = false }) {
  const amount = Number(taxableAmountCents);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new TypeError("taxableAmountCents must be a non-negative integer.");
  const rate = integerRate(taxRateMicros, MAX_TAX_RATE_MICROS, "taxRateMicros");
  if (rate === 0 || amount === 0) return 0;
  const denominator = taxInclusive ? TAX_RATE_MICROS_SCALE + rate : TAX_RATE_MICROS_SCALE;
  return roundedRatio(BigInt(amount) * BigInt(rate), denominator);
}
