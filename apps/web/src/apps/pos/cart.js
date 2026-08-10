export function adjustPosCartLineQuantity(lines = [], cartLineId, delta) {
  return lines.map((line) => line.cartLineId === cartLineId
    ? { ...line, quantity: Math.max(1, Number(line.quantity || 1) + Number(delta || 0)) }
    : line);
}

export function repeatPosCartLine(lines = [], cartLineId) {
  return adjustPosCartLineQuantity(lines, cartLineId, 1);
}

export function removePosCartLine(lines = [], cartLineId) {
  return lines.filter((line) => line.cartLineId !== cartLineId);
}

export function nextPosCartLineSelectionAfterRemoval(lines = [], cartLineId, selectedCartLineId) {
  if (selectedCartLineId !== cartLineId) {
    return lines.some((line) => line.cartLineId === selectedCartLineId) ? selectedCartLineId : "";
  }
  const removedIndex = lines.findIndex((line) => line.cartLineId === cartLineId);
  if (removedIndex < 0) return "";
  return lines[removedIndex + 1]?.cartLineId || lines[removedIndex - 1]?.cartLineId || "";
}

export function replacePosCartLineConfiguration(lines = [], cartLineId, configuration = {}) {
  const target = lines.find((line) => line.cartLineId === cartLineId);
  if (!target) return lines;

  const updatedTarget = {
    ...target,
    priceCents: Number(configuration.priceCents ?? target.priceCents ?? 0),
    modifierSelections: Array.isArray(configuration.modifierSelections) ? configuration.modifierSelections : target.modifierSelections,
    modifiers: Array.isArray(configuration.modifiers) ? configuration.modifiers : target.modifiers,
    modifierSignature: String(configuration.modifierSignature ?? target.modifierSignature ?? ""),
    specialInstructions: String(configuration.specialInstructions ?? target.specialInstructions ?? "")
  };
  return lines.map((line) => line.cartLineId === cartLineId ? updatedTarget : line);
}
