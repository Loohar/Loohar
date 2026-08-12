function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const POS_CUSTOMIZATION_MODE = Object.freeze({
  AUTO: "AUTO",
  REQUIRED: "REQUIRED",
  OPTIONAL: "OPTIONAL",
  NONE: "NONE"
});

export const POS_CUSTOMIZATION_MODE_OPTIONS = Object.freeze([
  { value: POS_CUSTOMIZATION_MODE.AUTO, label: "Automatic", detail: "Loohar prompts when this item has choices." },
  { value: POS_CUSTOMIZATION_MODE.REQUIRED, label: "Always prompt", detail: "Staff customize this item before adding it." },
  { value: POS_CUSTOMIZATION_MODE.OPTIONAL, label: "Optional prompt", detail: "Staff see customization and may keep optional choices empty." },
  { value: POS_CUSTOMIZATION_MODE.NONE, label: "No customization", detail: "This item goes directly into the order." }
]);

export function posCustomizationMode(item = {}) {
  const normalized = String(item.customizationMode || "").trim().toUpperCase();
  if (Object.values(POS_CUSTOMIZATION_MODE).includes(normalized)) return normalized;
  return explicitCustomizationRequired(item) ? POS_CUSTOMIZATION_MODE.REQUIRED : POS_CUSTOMIZATION_MODE.AUTO;
}

function itemScoped(record = {}, item = {}) {
  const itemId = item.id || item.menuItemId;
  const ownerId = record.menuItemId ?? record.itemId ?? record.menuItem?.id;
  return !itemId || ownerId == null || String(ownerId) === String(itemId);
}

function selectableOption(option = {}, item = {}) {
  return Boolean(
    option &&
    option.available !== false &&
    option.active !== false &&
    option.disabled !== true &&
    (option.id || option.optionId) &&
    (option.name || option.optionName) &&
    itemScoped(option, item)
  );
}

function rawModifierGroups(item = {}) {
  const groups = [
    ...(Array.isArray(item.optionGroups) ? item.optionGroups : []),
    ...(Array.isArray(item.modifierGroups) ? item.modifierGroups : [])
  ];
  const seen = new Set();
  return groups.filter((group, index) => {
    if (!group || group.available === false || group.active === false || !itemScoped(group, item)) return false;
    const key = String(group.id || group.groupId || `${group.name || "group"}:${index}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupOptions(group = {}, item = {}) {
  return [...(group.options || group.modifierOptions || [])]
    .filter((option) => selectableOption(option, item))
    .map((option) => ({
      ...option,
      id: option.id || option.optionId,
      name: option.name || option.optionName,
      priceCents: numeric(option.priceCents, 0)
    }))
    .sort((left, right) => numeric(left.sortOrder, 0) - numeric(right.sortOrder, 0) || String(left.name || "").localeCompare(String(right.name || "")));
}

function explicitCustomizationRequired(item = {}) {
  const flags = [
    item.requiresCustomization,
    item.requireCustomization,
    item.customizationRequired,
    item.requiresModifierSelection,
    item.forceCustomization,
    item.optionsJson?.requiresCustomization,
    item.optionsJson?.customizationRequired
  ];
  return flags.some((flag) => flag === true || String(flag).toUpperCase() === "REQUIRED");
}

export function normalizePosModifierGroups(item = {}) {
  const groups = rawModifierGroups(item)
    .map((group) => ({
      ...group,
      id: group.id || group.groupId || `group-${group.name}`,
      minSelect: numeric(group.minSelect, 0),
      maxSelect: Math.max(1, numeric(group.maxSelect, 1)),
      required: Boolean(group.required),
      options: groupOptions(group, item)
    }))
    .filter((group) => group.options.length > 0)
    .sort((left, right) => numeric(left.sortOrder, 0) - numeric(right.sortOrder, 0) || String(left.name || "").localeCompare(String(right.name || "")));

  const groupedOptionIds = new Set(groups.flatMap((group) => group.options.map((option) => option.id)));
  const looseOptions = (item.options || [])
    .filter((option) => selectableOption(option, item) && !groupedOptionIds.has(option.id || option.optionId))
    .map((option) => ({
      ...option,
      id: option.id || option.optionId,
      name: option.name || option.optionName,
      priceCents: numeric(option.priceCents, 0)
    }))
    .sort((left, right) => numeric(left.sortOrder, 0) - numeric(right.sortOrder, 0) || String(left.name || "").localeCompare(String(right.name || "")));

  if (looseOptions.length) {
    groups.push({
      id: `__ungrouped:${item.id}`,
      name: "Options",
      required: false,
      minSelect: 0,
      maxSelect: looseOptions.length,
      options: looseOptions
    });
  }

  return groups;
}

export function posModifierConfigurationError(item = {}) {
  const invalidGroup = rawModifierGroups(item).find((group) => {
    const minimum = group.required ? Math.max(1, numeric(group.minSelect, 0)) : numeric(group.minSelect, 0);
    return minimum > 0 && groupOptions(group, item).length === 0;
  });
  if (!invalidGroup) return "";
  return `${item.name || "This item"} is not available because ${invalidGroup.name || "a required modifier group"} has no selectable options.`;
}

export function shouldOpenCustomization(item = {}) {
  if (posModifierConfigurationError(item)) return false;
  const mode = posCustomizationMode(item);
  if (mode === POS_CUSTOMIZATION_MODE.NONE) return false;
  if ([POS_CUSTOMIZATION_MODE.REQUIRED, POS_CUSTOMIZATION_MODE.OPTIONAL].includes(mode)) return true;
  return normalizePosModifierGroups(item).length > 0;
}

export function canModifyPosItem(item = {}) {
  if (!item || posModifierConfigurationError(item)) return false;
  const mode = posCustomizationMode(item);
  return normalizePosModifierGroups(item).length > 0
    || [POS_CUSTOMIZATION_MODE.REQUIRED, POS_CUSTOMIZATION_MODE.OPTIONAL].includes(mode);
}

export function posMenuInteractionMetadata(item = {}) {
  const configurationError = posModifierConfigurationError(item);
  const mode = posCustomizationMode(item);
  const modifierGroups = configurationError ? [] : normalizePosModifierGroups(item);
  const opensCustomization = !configurationError && mode !== POS_CUSTOMIZATION_MODE.NONE && (
    modifierGroups.length > 0 || [POS_CUSTOMIZATION_MODE.REQUIRED, POS_CUSTOMIZATION_MODE.OPTIONAL].includes(mode)
  );
  const defaultSelections = posDefaultModifierSelections(item, modifierGroups);
  const directAddErrors = opensCustomization ? [] : posModifierGroupValidationErrors(modifierGroups, defaultSelections);
  return {
    configurationError,
    modifierGroups,
    defaultSelections,
    directAddConfigurationError: directAddErrors.length
      ? `${item.name || "This item"} needs a default modifier selection before No customization can be used.`
      : "",
    canModify: !configurationError && (modifierGroups.length > 0 || [POS_CUSTOMIZATION_MODE.REQUIRED, POS_CUSTOMIZATION_MODE.OPTIONAL].includes(mode)),
    opensCustomization
  };
}

export function posDefaultModifierSelections(item = {}, preparedGroups = null) {
  const groups = preparedGroups ?? normalizePosModifierGroups(item);
  return Object.fromEntries(groups.map((group) => [
    group.id,
    group.options
      .filter((option) => option.isDefault)
      .slice(0, Math.max(1, numeric(group.maxSelect, 1)))
      .map((option) => option.id)
  ]));
}

export function posDirectAddConfigurationError(item = {}) {
  return posMenuInteractionMetadata(item).directAddConfigurationError;
}

export function posSelectionsFromOptionIds(item = {}, optionIds = [], preparedGroups = null) {
  const selected = new Set(optionIds || []);
  const groups = preparedGroups ?? normalizePosModifierGroups(item);
  return Object.fromEntries(groups.map((group) => [
    group.id,
    group.options.filter((option) => selected.has(option.id)).map((option) => option.id)
  ]));
}

export function posModifierValidationErrors(item = {}, selections = {}) {
  return posModifierGroupValidationErrors(normalizePosModifierGroups(item), selections);
}

export function posModifierGroupValidationErrors(groups = [], selections = {}) {
  return groups.flatMap((group) => {
    const count = (selections[group.id] || []).length;
    const minimum = group.required ? Math.max(1, numeric(group.minSelect, 0)) : numeric(group.minSelect, 0);
    const maximum = Math.max(1, numeric(group.maxSelect, 1));
    if (count < minimum) return [`Choose at least ${minimum} ${minimum === 1 ? "option" : "options"} for ${group.name}.`];
    if (count > maximum) return [`Choose no more than ${maximum} ${maximum === 1 ? "option" : "options"} for ${group.name}.`];
    return [];
  });
}

export function togglePosModifierSelection(selections = {}, group = {}, optionId) {
  const currentIds = selections[group.id] || [];
  const selected = currentIds.includes(optionId);
  const maximum = Math.max(1, numeric(group.maxSelect, 1));
  if (maximum === 1) {
    return { ...selections, [group.id]: selected ? [] : [optionId] };
  }
  const nextIds = selected ? currentIds.filter((id) => id !== optionId) : [...currentIds, optionId].slice(0, maximum);
  return { ...selections, [group.id]: nextIds };
}
