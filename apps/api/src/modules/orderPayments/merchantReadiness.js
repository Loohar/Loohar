function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function requirementList(source, key) {
  const snake = source?.[key];
  if (Array.isArray(snake)) return snake;
  const camel = source?.[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())];
  return Array.isArray(camel) ? camel : [];
}

export function merchantRequirementsBlocking(requirementsJson, disabledReason = "") {
  const requirements = asObject(requirementsJson);
  const nestedRequirements = asObject(requirements.requirements);
  const currentlyDue = [
    ...requirementList(requirements, "currently_due"),
    ...requirementList(nestedRequirements, "currently_due")
  ];
  const pastDue = [
    ...requirementList(requirements, "past_due"),
    ...requirementList(nestedRequirements, "past_due")
  ];
  const nestedDisabledReason = requirements.disabled_reason || requirements.disabledReason || nestedRequirements.disabled_reason || nestedRequirements.disabledReason || "";
  return Boolean(disabledReason || nestedDisabledReason || currentlyDue.length || pastDue.length);
}

export function isMerchantAccountPaymentReady(merchantAccount) {
  return Boolean(
    merchantAccount?.provider === "STRIPE_CONNECT"
      && merchantAccount.status === "ENABLED"
      && merchantAccount.stripeAccountId
      && merchantAccount.stripeChargesEnabled
  );
}

export function normalizeMerchantPaymentReadiness(merchantAccount) {
  const ready = isMerchantAccountPaymentReady(merchantAccount);
  return {
    ready,
    provider: merchantAccount?.provider || "STRIPE_CONNECT",
    merchantStatus: merchantAccount?.status || "NOT_STARTED",
    accountPresent: Boolean(merchantAccount?.stripeAccountId),
    chargesEnabled: Boolean(merchantAccount?.stripeChargesEnabled),
    payoutsEnabled: Boolean(merchantAccount?.stripePayoutsEnabled),
    detailsSubmitted: Boolean(merchantAccount?.stripeDetailsSubmitted),
    requirementsBlocking: merchantRequirementsBlocking(merchantAccount?.requirementsJson, merchantAccount?.disabledReason),
    disabledReason: merchantAccount?.disabledReason || null
  };
}
