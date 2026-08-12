import { posMenuInteractionMetadata } from "./customization.js";

export function preparePosMenuItems(categories = []) {
  return categories.flatMap((category) => (category.items || []).map((item) => {
    const interaction = posMenuInteractionMetadata(item);
    return {
      ...item,
      categoryName: category.name,
      categoryId: category.id,
      posConfigurationError: interaction.configurationError,
      posModifierGroups: interaction.modifierGroups,
      posDefaultModifierSelections: interaction.defaultSelections,
      posDirectAddConfigurationError: interaction.directAddConfigurationError,
      posCanModify: interaction.canModify,
      posOpensCustomization: interaction.opensCustomization,
      posSearchText: [item.name, category.name, item.sku, item.searchAliases]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
    };
  }));
}

export function filterPosMenuItems(items = [], categoryId = "all", searchQuery = "") {
  const normalizedSearch = String(searchQuery || "").trim().toLowerCase();
  return items.filter((item) => {
    if (categoryId !== "all" && String(item.categoryId || item.category?.id || "") !== String(categoryId)) return false;
    return !normalizedSearch || String(item.posSearchText || "").includes(normalizedSearch);
  });
}
