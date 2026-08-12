export const POS_PIN_MIN_LENGTH = 4;
export const POS_PIN_MAX_LENGTH = 8;

export function normalizePosPin(value = "", maxLength = POS_PIN_MAX_LENGTH) {
  return String(value || "").replace(/\D/g, "").slice(0, maxLength);
}

export function applyPosPinKey(value = "", key, maxLength = POS_PIN_MAX_LENGTH) {
  const current = normalizePosPin(value, maxLength);
  if (key === "clear") return "";
  if (key === "backspace") return current.slice(0, -1);
  if (!/^\d$/.test(String(key || ""))) return current;
  return normalizePosPin(`${current}${key}`, maxLength);
}

export function isPosPinSubmittable(value = "", minLength = POS_PIN_MIN_LENGTH, maxLength = POS_PIN_MAX_LENGTH) {
  const pin = normalizePosPin(value, maxLength);
  return pin.length >= minLength && pin.length <= maxLength;
}
