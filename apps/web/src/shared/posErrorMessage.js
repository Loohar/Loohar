// What the register tells a person when the API refuses something.
//
// This lives outside App.jsx so it can be executed by a test rather than only read. It is money
// adjacent: it decides whether a restaurant is told to pay more, and being wrong here pushes an
// upgrade nobody needs.
//
// The distinction that matters is between a feature the plan does not include and a limit the plan
// does include but which is used up. They arrive as different errors and must not share a message.
import { nextPlanRaisingLimit } from "../../../shared/planEntitlements.js";

const POS_OWNER_ROLES = new Set(["TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_MANAGER"]);

function normalizeRole(role) {
  return String(role || "").trim().toUpperCase();
}

export function posCanManageSubscription(user) {
  return POS_OWNER_ROLES.has(normalizeRole(user?.role));
}

function titleCasePlan(plan) {
  const text = String(plan || "");
  return text ? `${text.charAt(0)}${text.slice(1).toLowerCase()}` : text;
}

export function normalizedPosError(error, user) {
  if (!error) return null;
  const message = typeof error === "string" ? error : error.message || "";
  const payload = typeof error === "object" && error ? error.payload || {} : {};
  const code = String(payload.code || "");
  const status = Number(error?.status || payload.status || 0);
  const ownerOperator = posCanManageSubscription(user);

  if (status === 429 || code === "RATE_LIMITED" || message.includes("429")) {
    return {
      tone: "warn",
      title: "POS is receiving too many requests.",
      detail: "Please wait a moment and try again. The register will not retry automatically.",
      action: "Retry POS"
    };
  }

  // A usage limit is not a missing feature. The POS register IS included on Starter, so a restaurant
  // that has used its one register and tries to add a second was being told the feature "is not
  // included in the current plan" and pushed at Professional. Both halves were false, and the remedy
  // may be to retire a register they no longer use rather than to pay more. A usage-limit refusal
  // carries limitCode/limitLabel/used/maxAllowed and no requiredPlan, so it is answered on its own
  // terms.
  if (code === "USAGE_LIMIT_REACHED" || payload.limitCode) {
    const limitLabel = payload.limitLabel || "Usage";
    if (!ownerOperator) {
      return {
        tone: "warn",
        title: `${limitLabel} limit reached for this restaurant.`,
        detail: "Contact your manager before adding another."
      };
    }
    const upgradePlan = nextPlanRaisingLimit(payload.currentPlan, payload.limitCode);
    const included = typeof payload.maxAllowed === "number" ? `This plan includes ${payload.maxAllowed}.` : "";
    const inUse = typeof payload.used === "number" ? `${payload.used} in use.` : "";
    // Only offer an upgrade when a higher plan would actually lift this limit.
    const remedy = upgradePlan
      ? `Remove one, or upgrade to ${titleCasePlan(upgradePlan)} to add more.`
      : "Remove one before adding another.";
    return {
      tone: "upgrade",
      title: `${limitLabel} limit reached on the ${payload.currentPlan || "current"} plan.`,
      detail: [included, inUse, remedy].filter(Boolean).join(" "),
      action: upgradePlan ? "Review subscription" : null
    };
  }

  if (payload.upgradeRequired || code.startsWith("FEATURE_") || code === "PLAN_NOT_INCLUDED" || message.toLowerCase().includes("feature not included")) {
    return ownerOperator
      ? {
          tone: "upgrade",
          title: `${payload.featureLabel || "This feature"} is not included in the current plan.`,
          // Never name a plan the server did not name: this used to default to "Professional"
          // whatever the truth was.
          detail: `Current plan: ${payload.currentPlan || "Unknown"}.${payload.requiredPlan ? ` Required plan: ${payload.requiredPlan}.` : ""}`,
          action: "Review subscription"
        }
      : {
          tone: "warn",
          title: "POS is not enabled for this restaurant.",
          detail: "Contact your manager before using this register."
        };
  }

  if (status === 403) {
    return {
      tone: "warn",
      title: "POS action is not allowed.",
      detail: message || "Your account does not have permission for this register action."
    };
  }

  return {
    tone: "bad",
    title: message || "POS could not complete the request.",
    detail: payload.detail || "Try again, or refresh the register if the issue continues."
  };
}
