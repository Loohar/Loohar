const CASH_INPUT_PATTERN = /^\d{0,7}(?:\.\d{0,2})?$/;

export function normalizeCashTenderInput(value = "") {
  const normalized = String(value).replace(/[^\d.]/g, "");
  if (!CASH_INPUT_PATTERN.test(normalized)) return null;
  return normalized;
}

export function cashTenderInputToCents(value = "") {
  const normalized = normalizeCashTenderInput(value);
  if (normalized === null || !normalized || normalized === ".") return null;
  const [dollars = "0", fraction = ""] = normalized.split(".");
  const cents = (Number.parseInt(dollars || "0", 10) * 100) + Number.parseInt(fraction.padEnd(2, "0") || "0", 10);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function cashTenderCentsToInput(cents = 0) {
  const safeCents = Math.max(0, Number.isSafeInteger(Number(cents)) ? Number(cents) : 0);
  return `${Math.floor(safeCents / 100)}.${String(safeCents % 100).padStart(2, "0")}`;
}

export function applyCashKey(current = "", key = "") {
  if (key === "clear") return "";
  if (key === "backspace") return String(current).slice(0, -1);
  const next = `${current}${key}`;
  return normalizeCashTenderInput(next) ?? String(current);
}

export function cashTenderSummary(amountDueCents = 0, tenderedCents = 0) {
  const amountDue = Math.max(0, Number(amountDueCents) || 0);
  const tendered = Math.max(0, Number(tenderedCents) || 0);
  return {
    amountDueCents: amountDue,
    tenderedCents: tendered,
    appliedCents: Math.min(amountDue, tendered),
    remainingDueCents: Math.max(0, amountDue - tendered),
    changeDueCents: Math.max(0, tendered - amountDue),
    covered: tendered >= amountDue
  };
}

export function quickCashTenderAmounts(amountDueCents = 0) {
  const due = Math.max(0, Number(amountDueCents) || 0);
  const roundUp = (increment) => Math.ceil(due / increment) * increment;
  return [...new Set([roundUp(500), roundUp(1000), roundUp(2000), roundUp(5000)])]
    .filter((amount) => amount > due)
    .slice(0, 3);
}
