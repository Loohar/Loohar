export const MENU_ITEM_CUSTOMIZATION_MODES = Object.freeze(["AUTO", "REQUIRED", "OPTIONAL", "NONE"]);

const VALID_CUSTOMIZATION_MODES = new Set(MENU_ITEM_CUSTOMIZATION_MODES);

export function normalizeMenuItemCustomizationMode(value) {
  const normalized = String(value || "AUTO").trim().toUpperCase();
  return VALID_CUSTOMIZATION_MODES.has(normalized) ? normalized : "AUTO";
}

export function menuItemCustomizationModes(settingsJson = {}) {
  const source = settingsJson && typeof settingsJson === "object" && !Array.isArray(settingsJson)
    ? settingsJson.posItemCustomizationModes
    : null;
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  return Object.fromEntries(Object.entries(source).map(([itemId, mode]) => [
    String(itemId),
    normalizeMenuItemCustomizationMode(mode)
  ]));
}

export function menuItemCustomizationMode(settingsJson, itemId) {
  return menuItemCustomizationModes(settingsJson)[String(itemId)] || "AUTO";
}

export function withMenuItemCustomizationMode(item = {}, settingsJson = {}) {
  return {
    ...item,
    customizationMode: menuItemCustomizationMode(settingsJson, item.id)
  };
}

export function withMenuCustomizationModes(categories = [], settingsJson = {}) {
  return categories.map((category) => ({
    ...category,
    items: (category.items || []).map((item) => withMenuItemCustomizationMode(item, settingsJson))
  }));
}

export function updateMenuItemCustomizationSettings(settingsJson = {}, itemId, value) {
  const base = settingsJson && typeof settingsJson === "object" && !Array.isArray(settingsJson)
    ? settingsJson
    : {};
  const modes = menuItemCustomizationModes(base);
  const key = String(itemId || "").trim();
  if (!key) return base;
  const mode = normalizeMenuItemCustomizationMode(value);
  if (mode === "AUTO" && !Object.prototype.hasOwnProperty.call(modes, key)) return base;
  if (mode === "AUTO") delete modes[key];
  else modes[key] = mode;
  return { ...base, posItemCustomizationModes: modes };
}

export function removeMenuItemCustomizationSetting(settingsJson = {}, itemId) {
  return updateMenuItemCustomizationSettings(settingsJson, itemId, "AUTO");
}
