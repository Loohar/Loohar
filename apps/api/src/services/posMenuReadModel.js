export function assemblePosMenuCategories({ categories = [], items = [], groups = [], options = [] } = {}) {
  const optionsByItem = new Map();
  const optionsByGroup = new Map();
  for (const option of options) {
    if (!optionsByItem.has(option.menuItemId)) optionsByItem.set(option.menuItemId, []);
    optionsByItem.get(option.menuItemId).push(option);
    if (option.optionGroupId) {
      if (!optionsByGroup.has(option.optionGroupId)) optionsByGroup.set(option.optionGroupId, []);
      optionsByGroup.get(option.optionGroupId).push(option);
    }
  }

  const groupsByItem = new Map();
  for (const group of groups) {
    if (!groupsByItem.has(group.menuItemId)) groupsByItem.set(group.menuItemId, []);
    groupsByItem.get(group.menuItemId).push({
      ...group,
      options: optionsByGroup.get(group.id) || []
    });
  }

  const itemsByCategory = new Map();
  for (const item of items) {
    if (!itemsByCategory.has(item.categoryId)) itemsByCategory.set(item.categoryId, []);
    itemsByCategory.get(item.categoryId).push({
      ...item,
      options: optionsByItem.get(item.id) || [],
      optionGroups: groupsByItem.get(item.id) || []
    });
  }

  return categories.map((category) => ({
    ...category,
    items: itemsByCategory.get(category.id) || []
  }));
}
