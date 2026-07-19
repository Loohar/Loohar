export const PLAN_CODES = ["STARTER", "PROFESSIONAL", "ENTERPRISE"];

export const PLAN_RANK = {
  STARTER: 1,
  PROFESSIONAL: 2,
  ENTERPRISE: 3
};

export const FEATURE = {
  BASIC_DASHBOARD: "BASIC_DASHBOARD",
  RESTAURANT_ORDERING: "RESTAURANT_ORDERING",
  PICKUP: "PICKUP",
  DELIVERY: "DELIVERY",
  ORDER_PAYMENTS: "ORDER_PAYMENTS",
  ORDER_TRACKING: "ORDER_TRACKING",
  FOOD_CATALOG: "FOOD_CATALOG",
  MENU_MANAGEMENT: "MENU_MANAGEMENT",
  BASIC_WEBSITE: "BASIC_WEBSITE",
  BRANDING: "BRANDING",
  BASIC_SETTINGS: "BASIC_SETTINGS",
  ONBOARDING: "ONBOARDING",
  DRIVER_MANAGEMENT: "DRIVER_MANAGEMENT",
  DISPATCH_CENTER: "DISPATCH_CENTER",
  DELIVERY_ZONES: "DELIVERY_ZONES",
  CUSTOMER_CRM: "CUSTOMER_CRM",
  LOYALTY: "LOYALTY",
  COUPONS: "COUPONS",
  EMPLOYEE_MANAGEMENT: "EMPLOYEE_MANAGEMENT",
  KITCHEN_DISPLAY: "KITCHEN_DISPLAY",
  PRINTING: "PRINTING",
  NOTIFICATIONS: "NOTIFICATIONS",
  INVENTORY: "INVENTORY",
  STRIPE_CONNECT: "STRIPE_CONNECT",
  REPORTS: "REPORTS",
  ANALYTICS: "ANALYTICS",
  MENU_INSIGHTS: "MENU_INSIGHTS",
  MULTI_LOCATION: "MULTI_LOCATION",
  WHITE_LABEL: "WHITE_LABEL",
  CUSTOM_DOMAIN: "CUSTOM_DOMAIN",
  ADVANCED_CRM: "ADVANCED_CRM",
  POS: "POS"
};

export const FEATURE_LABELS = {
  [FEATURE.BASIC_DASHBOARD]: "Restaurant dashboard",
  [FEATURE.RESTAURANT_ORDERING]: "Direct online ordering",
  [FEATURE.PICKUP]: "Pickup ordering",
  [FEATURE.DELIVERY]: "Delivery ordering",
  [FEATURE.ORDER_PAYMENTS]: "Order payments",
  [FEATURE.ORDER_TRACKING]: "Order tracking",
  [FEATURE.FOOD_CATALOG]: "Food catalog",
  [FEATURE.MENU_MANAGEMENT]: "Menu management",
  [FEATURE.BASIC_WEBSITE]: "Restaurant website",
  [FEATURE.BRANDING]: "Restaurant branding",
  [FEATURE.BASIC_SETTINGS]: "Restaurant settings",
  [FEATURE.ONBOARDING]: "Restaurant onboarding",
  [FEATURE.DRIVER_MANAGEMENT]: "Driver management",
  [FEATURE.DISPATCH_CENTER]: "Dispatch center",
  [FEATURE.DELIVERY_ZONES]: "Delivery zones",
  [FEATURE.CUSTOMER_CRM]: "Customer CRM",
  [FEATURE.LOYALTY]: "Loyalty program",
  [FEATURE.COUPONS]: "Coupons and promotions",
  [FEATURE.EMPLOYEE_MANAGEMENT]: "Employee management",
  [FEATURE.KITCHEN_DISPLAY]: "Kitchen display system",
  [FEATURE.PRINTING]: "Receipt and ticket printing",
  [FEATURE.NOTIFICATIONS]: "SMS and email notifications",
  [FEATURE.INVENTORY]: "Inventory foundation",
  [FEATURE.STRIPE_CONNECT]: "Restaurant payment onboarding",
  [FEATURE.REPORTS]: "Advanced reports",
  [FEATURE.ANALYTICS]: "Analytics dashboard",
  [FEATURE.MENU_INSIGHTS]: "Menu insights",
  [FEATURE.MULTI_LOCATION]: "Multi-location",
  [FEATURE.WHITE_LABEL]: "White label",
  [FEATURE.CUSTOM_DOMAIN]: "Custom domains",
  [FEATURE.ADVANCED_CRM]: "Advanced CRM",
  [FEATURE.POS]: "POS integrations"
};

export const FEATURE_REQUIRED_PLAN = {
  [FEATURE.BASIC_DASHBOARD]: "STARTER",
  [FEATURE.RESTAURANT_ORDERING]: "STARTER",
  [FEATURE.PICKUP]: "STARTER",
  [FEATURE.ORDER_PAYMENTS]: "STARTER",
  [FEATURE.ORDER_TRACKING]: "STARTER",
  [FEATURE.FOOD_CATALOG]: "STARTER",
  [FEATURE.MENU_MANAGEMENT]: "STARTER",
  [FEATURE.BASIC_WEBSITE]: "STARTER",
  [FEATURE.BRANDING]: "STARTER",
  [FEATURE.BASIC_SETTINGS]: "STARTER",
  [FEATURE.ONBOARDING]: "STARTER",
  [FEATURE.DELIVERY]: "PROFESSIONAL",
  [FEATURE.DRIVER_MANAGEMENT]: "PROFESSIONAL",
  [FEATURE.DISPATCH_CENTER]: "PROFESSIONAL",
  [FEATURE.DELIVERY_ZONES]: "PROFESSIONAL",
  [FEATURE.CUSTOMER_CRM]: "PROFESSIONAL",
  [FEATURE.LOYALTY]: "PROFESSIONAL",
  [FEATURE.COUPONS]: "PROFESSIONAL",
  [FEATURE.EMPLOYEE_MANAGEMENT]: "PROFESSIONAL",
  [FEATURE.KITCHEN_DISPLAY]: "PROFESSIONAL",
  [FEATURE.PRINTING]: "PROFESSIONAL",
  [FEATURE.NOTIFICATIONS]: "PROFESSIONAL",
  [FEATURE.INVENTORY]: "PROFESSIONAL",
  [FEATURE.STRIPE_CONNECT]: "PROFESSIONAL",
  [FEATURE.REPORTS]: "ENTERPRISE",
  [FEATURE.ANALYTICS]: "ENTERPRISE",
  [FEATURE.MENU_INSIGHTS]: "ENTERPRISE",
  [FEATURE.MULTI_LOCATION]: "ENTERPRISE",
  [FEATURE.WHITE_LABEL]: "ENTERPRISE",
  [FEATURE.CUSTOM_DOMAIN]: "ENTERPRISE",
  [FEATURE.ADVANCED_CRM]: "ENTERPRISE",
  [FEATURE.POS]: "ENTERPRISE"
};

export const BUSINESS_MODULE_FEATURES = {
  [FEATURE.RESTAURANT_ORDERING]: "RESTAURANT_ORDERING",
  [FEATURE.PICKUP]: "PICKUP",
  [FEATURE.DELIVERY]: "DELIVERY",
  [FEATURE.ORDER_PAYMENTS]: "RESTAURANT_ORDERING",
  [FEATURE.FOOD_CATALOG]: "FOOD_CATALOG",
  [FEATURE.MENU_MANAGEMENT]: "FOOD_CATALOG",
  [FEATURE.DRIVER_MANAGEMENT]: "DRIVER_MANAGEMENT",
  [FEATURE.DISPATCH_CENTER]: "DRIVER_MANAGEMENT",
  [FEATURE.DELIVERY_ZONES]: "DELIVERY_ZONES",
  [FEATURE.LOYALTY]: "LOYALTY",
  [FEATURE.COUPONS]: "COUPONS"
};

export const FEATURE_ORDER = [
  FEATURE.RESTAURANT_ORDERING,
  FEATURE.PICKUP,
  FEATURE.DELIVERY,
  FEATURE.DRIVER_MANAGEMENT,
  FEATURE.DISPATCH_CENTER,
  FEATURE.DELIVERY_ZONES,
  FEATURE.FOOD_CATALOG,
  FEATURE.MENU_MANAGEMENT,
  FEATURE.ORDER_PAYMENTS,
  FEATURE.ORDER_TRACKING,
  FEATURE.BASIC_WEBSITE,
  FEATURE.BRANDING,
  FEATURE.CUSTOM_DOMAIN,
  FEATURE.WHITE_LABEL,
  FEATURE.CUSTOMER_CRM,
  FEATURE.ADVANCED_CRM,
  FEATURE.LOYALTY,
  FEATURE.COUPONS,
  FEATURE.EMPLOYEE_MANAGEMENT,
  FEATURE.KITCHEN_DISPLAY,
  FEATURE.PRINTING,
  FEATURE.NOTIFICATIONS,
  FEATURE.INVENTORY,
  FEATURE.ANALYTICS,
  FEATURE.REPORTS,
  FEATURE.MENU_INSIGHTS,
  FEATURE.MULTI_LOCATION,
  FEATURE.POS
];

export const USAGE_LIMIT = {
  MENU_ITEMS: "MENU_ITEMS",
  STAFF_MEMBERS: "STAFF_MEMBERS",
  DELIVERY_ZONES: "DELIVERY_ZONES",
  GALLERY_IMAGES: "GALLERY_IMAGES",
  LOCATIONS: "LOCATIONS"
};

export const USAGE_LIMIT_LABELS = {
  [USAGE_LIMIT.MENU_ITEMS]: "Menu items",
  [USAGE_LIMIT.STAFF_MEMBERS]: "Employee seats",
  [USAGE_LIMIT.DELIVERY_ZONES]: "Delivery zones",
  [USAGE_LIMIT.GALLERY_IMAGES]: "Gallery images",
  [USAGE_LIMIT.LOCATIONS]: "Restaurant locations"
};

export const PLAN_USAGE_LIMITS = {
  STARTER: {
    [USAGE_LIMIT.MENU_ITEMS]: 50,
    [USAGE_LIMIT.STAFF_MEMBERS]: 0,
    [USAGE_LIMIT.DELIVERY_ZONES]: 0,
    [USAGE_LIMIT.GALLERY_IMAGES]: 10,
    [USAGE_LIMIT.LOCATIONS]: 1
  },
  PROFESSIONAL: {
    [USAGE_LIMIT.MENU_ITEMS]: 250,
    [USAGE_LIMIT.STAFF_MEMBERS]: 25,
    [USAGE_LIMIT.DELIVERY_ZONES]: 10,
    [USAGE_LIMIT.GALLERY_IMAGES]: 50,
    [USAGE_LIMIT.LOCATIONS]: 1
  },
  ENTERPRISE: {
    [USAGE_LIMIT.MENU_ITEMS]: null,
    [USAGE_LIMIT.STAFF_MEMBERS]: null,
    [USAGE_LIMIT.DELIVERY_ZONES]: null,
    [USAGE_LIMIT.GALLERY_IMAGES]: null,
    [USAGE_LIMIT.LOCATIONS]: null
  }
};

export function normalizePlanCode(value) {
  const code = String(value || "STARTER").trim().toUpperCase();
  return PLAN_CODES.includes(code) ? code : "STARTER";
}

export function normalizeUsageLimitCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return USAGE_LIMIT[code] || (Object.values(USAGE_LIMIT).includes(code) ? code : "");
}

export function normalizeSubscriptionStatus(value) {
  const status = String(value || "ACTIVE").trim().toUpperCase();
  if (status === "CANCELED") return "CANCELLED";
  return status;
}

export function planAllowsFeature(planCode, feature) {
  const requiredPlan = FEATURE_REQUIRED_PLAN[feature] || "ENTERPRISE";
  return PLAN_RANK[normalizePlanCode(planCode)] >= PLAN_RANK[requiredPlan];
}

export function requiredPlanForFeature(feature) {
  return FEATURE_REQUIRED_PLAN[feature] || "ENTERPRISE";
}

export function moduleAllowsFeature(enabledModules = [], feature) {
  const requiredModule = BUSINESS_MODULE_FEATURES[feature];
  if (!requiredModule) return true;
  return (enabledModules || []).map(String).includes(requiredModule);
}

export function isMutatingMethod(method = "GET") {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method).toUpperCase());
}

export function entitlementLimitForPlan(planCode, limitCode) {
  const normalizedPlan = normalizePlanCode(planCode);
  const normalizedLimit = normalizeUsageLimitCode(limitCode);
  if (!normalizedLimit) return null;
  return PLAN_USAGE_LIMITS[normalizedPlan]?.[normalizedLimit] ?? null;
}

export function subscriptionAccessForStatus(status) {
  const normalized = normalizeSubscriptionStatus(status);
  if (["ACTIVE", "TRIALING"].includes(normalized)) {
    return { mode: "FULL", warning: null };
  }
  if (normalized === "PAST_DUE") {
    return { mode: "FULL", warning: "Payment is past due. Access remains enabled while billing is resolved." };
  }
  if (["UNPAID", "CANCELLED", "INCOMPLETE"].includes(normalized)) {
    return { mode: "READ_ONLY", warning: "Subscription is read-only until billing is active." };
  }
  if (["SUSPENDED", "DELETED", "PENDING"].includes(normalized)) {
    return { mode: "NONE", warning: "Tenant access is suspended." };
  }
  return { mode: "READ_ONLY", warning: "Subscription status requires review before changes are allowed." };
}

export function entitlementDecision(entitlement, feature, method = "GET") {
  const access = subscriptionAccessForStatus(entitlement?.subscriptionStatus);
  const currentPlan = normalizePlanCode(entitlement?.planCode);
  const requiredPlan = requiredPlanForFeature(feature);
  const label = FEATURE_LABELS[feature] || feature;

  if (access.mode === "NONE") {
    return {
      allowed: false,
      status: 403,
      code: "SUBSCRIPTION_SUSPENDED",
      error: "Tenant subscription is suspended.",
      feature,
      featureLabel: label,
      currentPlan,
      requiredPlan,
      subscriptionStatus: normalizeSubscriptionStatus(entitlement?.subscriptionStatus)
    };
  }

  if (access.mode === "READ_ONLY" && isMutatingMethod(method)) {
    return {
      allowed: false,
      status: 403,
      code: "SUBSCRIPTION_READ_ONLY",
      error: "Subscription is read-only for this tenant.",
      feature,
      featureLabel: label,
      currentPlan,
      requiredPlan,
      subscriptionStatus: normalizeSubscriptionStatus(entitlement?.subscriptionStatus)
    };
  }

  if (!planAllowsFeature(currentPlan, feature)) {
    return {
      allowed: false,
      status: 403,
      code: "FEATURE_NOT_INCLUDED",
      error: "Feature not included in current plan.",
      feature,
      featureLabel: label,
      currentPlan,
      requiredPlan,
      subscriptionStatus: normalizeSubscriptionStatus(entitlement?.subscriptionStatus)
    };
  }

  if (!moduleAllowsFeature(entitlement?.enabledModules, feature)) {
    return {
      allowed: false,
      status: 403,
      code: "FEATURE_DISABLED",
      error: "Feature disabled for this tenant.",
      feature,
      featureLabel: label,
      currentPlan,
      requiredPlan,
      subscriptionStatus: normalizeSubscriptionStatus(entitlement?.subscriptionStatus)
    };
  }

  return {
    allowed: true,
    warning: access.warning,
    feature,
    featureLabel: label,
    currentPlan,
    requiredPlan,
    subscriptionStatus: normalizeSubscriptionStatus(entitlement?.subscriptionStatus)
  };
}

export function usageLimitDecision({ entitlement, limitCode, used = 0, requestedIncrement = 1 }) {
  const currentPlan = normalizePlanCode(entitlement?.planCode);
  const normalizedLimit = normalizeUsageLimitCode(limitCode);
  const label = USAGE_LIMIT_LABELS[normalizedLimit] || normalizedLimit || "Usage";
  const maxAllowed = entitlementLimitForPlan(currentPlan, normalizedLimit);
  const currentUsage = Math.max(0, Number(used || 0));
  const increment = Math.max(0, Number(requestedIncrement || 0));

  if (!normalizedLimit || maxAllowed === null) {
    return {
      allowed: true,
      code: "LIMIT_UNMETERED",
      limitCode: normalizedLimit,
      limitLabel: label,
      currentPlan,
      used: currentUsage,
      requestedIncrement: increment,
      maxAllowed
    };
  }

  if (currentUsage + increment > maxAllowed) {
    return {
      allowed: false,
      status: 403,
      code: "USAGE_LIMIT_REACHED",
      error: `${label} limit reached for current plan.`,
      limitCode: normalizedLimit,
      limitLabel: label,
      currentPlan,
      used: currentUsage,
      requestedIncrement: increment,
      maxAllowed,
      upgradeRequired: currentPlan !== "ENTERPRISE"
    };
  }

  return {
    allowed: true,
    code: "LIMIT_AVAILABLE",
    limitCode: normalizedLimit,
    limitLabel: label,
    currentPlan,
    used: currentUsage,
    requestedIncrement: increment,
    maxAllowed
  };
}

export function planMatrixRows() {
  return FEATURE_ORDER.map((feature) => ({
    feature,
    label: FEATURE_LABELS[feature] || feature,
    starter: planAllowsFeature("STARTER", feature),
    professional: planAllowsFeature("PROFESSIONAL", feature),
    enterprise: planAllowsFeature("ENTERPRISE", feature),
    requiredPlan: requiredPlanForFeature(feature)
  }));
}

export function usageLimitRows() {
  return Object.values(USAGE_LIMIT).map((limitCode) => ({
    limitCode,
    label: USAGE_LIMIT_LABELS[limitCode] || limitCode,
    starter: entitlementLimitForPlan("STARTER", limitCode),
    professional: entitlementLimitForPlan("PROFESSIONAL", limitCode),
    enterprise: entitlementLimitForPlan("ENTERPRISE", limitCode)
  }));
}
