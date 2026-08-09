function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  return explicitCustomizationRequired(item) || normalizePosModifierGroups(item).length > 0;
}
