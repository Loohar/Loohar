function httpError(message, status = 400, details = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, details);
  return error;
}

function invalidModifierSelection(details = {}) {
  return httpError("Menu item modifier selection is malformed.", 400, {
    code: "POS_MODIFIER_INVALID",
    ...details
  });
}

function normalizedModifierSelection(modifierGroupId, modifierOptionId, details = {}) {
  const groupId = modifierGroupId == null ? null : String(modifierGroupId || "").trim();
  const optionId = String(modifierOptionId || "").trim();
  if (!optionId || (modifierGroupId != null && !groupId)) throw invalidModifierSelection(details);
  return { modifierGroupId: groupId, modifierOptionId: optionId };
}

function resolveLineModifierSelections(line = {}) {
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(line, key);

  // Aliases are alternatives. Prefer the canonical representation when supplied.
  if (hasOwn("modifierSelections")) {
    const source = line.modifierSelections;
    if (Array.isArray(source)) {
      return source.flatMap((selection, selectionIndex) => {
        if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
          throw invalidModifierSelection({ selectionIndex });
        }
        const groupId = selection.modifierGroupId ?? selection.groupId ?? null;
        if (Array.isArray(selection.optionIds)) {
          return selection.optionIds.map((optionId) => normalizedModifierSelection(groupId, optionId, { selectionIndex }));
        }
        const optionId = selection.modifierOptionId ?? selection.optionId;
        if (optionId == null) throw invalidModifierSelection({ selectionIndex });
        return [normalizedModifierSelection(groupId, optionId, { selectionIndex })];
      });
    }
    if (source && typeof source === "object") {
      return Object.entries(source).flatMap(([groupId, value]) => {
        const optionIds = Array.isArray(value) ? value : [value];
        return optionIds.map((optionId) => normalizedModifierSelection(groupId, optionId, { groupId }));
      });
    }
    throw invalidModifierSelection();
  }

  const legacyKey = hasOwn("modifierOptionIds") ? "modifierOptionIds" : hasOwn("optionIds") ? "optionIds" : null;
  if (!legacyKey) return [];
  if (!Array.isArray(line[legacyKey])) throw invalidModifierSelection({ field: legacyKey });
  return line[legacyKey].map((optionId, selectionIndex) => (
    normalizedModifierSelection(null, optionId, { field: legacyKey, selectionIndex })
  ));
}

function rawLineOptionIds(line = {}) {
  return resolveLineModifierSelections(line).map((selection) => selection.modifierOptionId);
}

function normalizeLineOptionIds(line = {}) {
  return [...new Set(rawLineOptionIds(line))];
}

export function normalizeMenuItemModifierGroups(menuItem = {}) {
  const groups = (menuItem.optionGroups || [])
    .map((group) => ({
      ...group,
      options: [...(group.options || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const groupedOptionIds = new Set(groups.flatMap((group) => (group.options || []).map((option) => option.id)));
  const ungroupedOptions = (menuItem.options || [])
    .filter((option) => !groupedOptionIds.has(option.id))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  if (ungroupedOptions.length) {
    groups.push({
      id: `__ungrouped:${menuItem.id}`,
      menuItemId: menuItem.id,
      name: "Options",
      required: false,
      minSelect: 0,
      maxSelect: ungroupedOptions.length,
      sortOrder: groups.length + 1,
      options: ungroupedOptions
    });
  }

  return groups;
}

export function validateSelectedModifiers(menuItem, line = {}) {
  const selections = resolveLineModifierSelections(line);
  const rawOptionIds = selections.map((selection) => selection.modifierOptionId);
  const optionIds = normalizeLineOptionIds(line);
  if (rawOptionIds.length !== optionIds.length) {
    throw httpError("Duplicate menu item modifier selected.", 400, { code: "POS_MODIFIER_DUPLICATE" });
  }

  const groups = normalizeMenuItemModifierGroups(menuItem);
  const optionToGroup = new Map();
  for (const group of groups) {
    for (const option of group.options || []) {
      optionToGroup.set(option.id, { group, option });
    }
  }

  const selectedByGroup = new Map(groups.map((group) => [group.id, []]));
  for (const selection of selections) {
    const optionId = selection.modifierOptionId;
    const match = optionToGroup.get(optionId);
    if (!match) throw httpError("Menu item modifier is invalid for this item.", 400, { code: "POS_MODIFIER_INVALID", optionId });
    if (selection.modifierGroupId && selection.modifierGroupId !== match.group.id) {
      throw httpError("Menu item modifier group does not match this option.", 400, {
        code: "POS_MODIFIER_INVALID",
        groupId: selection.modifierGroupId,
        optionId
      });
    }
    selectedByGroup.get(match.group.id).push(match.option);
  }

  for (const group of groups) {
    const selected = selectedByGroup.get(group.id) || [];
    const minSelect = Math.max(0, Number(group.minSelect ?? 0));
    const maxSelect = Math.max(1, Number(group.maxSelect ?? group.options?.length ?? 1));
    if ((group.required || minSelect > 0) && selected.length < Math.max(1, minSelect)) {
      throw httpError(`${group.name} requires a selection.`, 400, { code: "POS_MODIFIER_REQUIRED", groupId: group.id });
    }
    if (selected.length > maxSelect) {
      throw httpError(`${group.name} allows up to ${maxSelect} selection${maxSelect === 1 ? "" : "s"}.`, 400, { code: "POS_MODIFIER_MAXIMUM", groupId: group.id, maxSelect });
    }
  }

  const modifiers = optionIds.map((optionId) => {
    const { group, option } = optionToGroup.get(optionId);
    return {
      id: option.id,
      optionId: option.id,
      name: option.name,
      optionName: option.name,
      priceCents: option.priceCents,
      groupId: group.id,
      groupName: group.name
    };
  });

  return { optionIds, modifiers };
}
