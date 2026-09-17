// Single source of truth for per-plan usage limits and what counts against them. The API enforces
// these limits (apps/api/src/config/entitlements.js) and the web app only displays them.
// null means unmetered.

export const USAGE_LIMIT = {
  MENU_ITEMS: "MENU_ITEMS",
  STAFF_MEMBERS: "STAFF_MEMBERS",
  DELIVERY_ZONES: "DELIVERY_ZONES",
  GALLERY_IMAGES: "GALLERY_IMAGES",
  LOCATIONS: "LOCATIONS",
  POS_REGISTERS: "POS_REGISTERS",
  KITCHEN_DISPLAYS: "KITCHEN_DISPLAYS"
};

export const USAGE_LIMIT_LABELS = {
  [USAGE_LIMIT.MENU_ITEMS]: "Menu items",
  [USAGE_LIMIT.STAFF_MEMBERS]: "Employee seats",
  [USAGE_LIMIT.DELIVERY_ZONES]: "Delivery zones",
  [USAGE_LIMIT.GALLERY_IMAGES]: "Gallery images",
  [USAGE_LIMIT.LOCATIONS]: "Restaurant locations",
  [USAGE_LIMIT.POS_REGISTERS]: "POS registers",
  [USAGE_LIMIT.KITCHEN_DISPLAYS]: "Kitchen displays"
};

export const PLAN_USAGE_LIMITS = {
  STARTER: {
    [USAGE_LIMIT.MENU_ITEMS]: 50,
    [USAGE_LIMIT.STAFF_MEMBERS]: 5,
    [USAGE_LIMIT.DELIVERY_ZONES]: 0,
    [USAGE_LIMIT.GALLERY_IMAGES]: 10,
    [USAGE_LIMIT.LOCATIONS]: 1,
    [USAGE_LIMIT.POS_REGISTERS]: 1,
    [USAGE_LIMIT.KITCHEN_DISPLAYS]: 1
  },
  PROFESSIONAL: {
    [USAGE_LIMIT.MENU_ITEMS]: 250,
    [USAGE_LIMIT.STAFF_MEMBERS]: 25,
    [USAGE_LIMIT.DELIVERY_ZONES]: 10,
    [USAGE_LIMIT.GALLERY_IMAGES]: 50,
    [USAGE_LIMIT.LOCATIONS]: 1,
    [USAGE_LIMIT.POS_REGISTERS]: null,
    [USAGE_LIMIT.KITCHEN_DISPLAYS]: null
  },
  ENTERPRISE: {
    [USAGE_LIMIT.MENU_ITEMS]: null,
    [USAGE_LIMIT.STAFF_MEMBERS]: null,
    [USAGE_LIMIT.DELIVERY_ZONES]: null,
    [USAGE_LIMIT.GALLERY_IMAGES]: null,
    [USAGE_LIMIT.LOCATIONS]: null,
    [USAGE_LIMIT.POS_REGISTERS]: null,
    [USAGE_LIMIT.KITCHEN_DISPLAYS]: null
  }
};

// Owner and admin access is included with every plan (restaurants cannot create owner/admin accounts
// themselves). Every employee login, including drivers, occupies a seat until it is deleted;
// suspended accounts keep their seat.
export const EMPLOYEE_SEAT_ROLES = ["RESTAURANT_MANAGER", "CASHIER", "KITCHEN_STAFF", "DRIVER"];

// Every active device that can open a POS session counts as a register (manager devices can take
// orders and payments too); kitchen screens count separately and cannot open POS sessions.
export const DEVICE_TYPE_USAGE_LIMIT = {
  MAIN_TERMINAL: USAGE_LIMIT.POS_REGISTERS,
  POS_KIOSK: USAGE_LIMIT.POS_REGISTERS,
  APPROVED_MOBILE: USAGE_LIMIT.POS_REGISTERS,
  MANAGER_DEVICE: USAGE_LIMIT.POS_REGISTERS,
  KITCHEN_DISPLAY: USAGE_LIMIT.KITCHEN_DISPLAYS
};

export function deviceTypesForUsageLimit(limitCode) {
  return Object.entries(DEVICE_TYPE_USAGE_LIMIT).filter(([, code]) => code === limitCode).map(([type]) => type);
}

export const POS_SESSION_DEVICE_TYPES = deviceTypesForUsageLimit(USAGE_LIMIT.POS_REGISTERS);

export function planLimitSummary(planCode) {
  const limits = PLAN_USAGE_LIMITS[planCode] || PLAN_USAGE_LIMITS.STARTER;
  return {
    locationLimit: limits[USAGE_LIMIT.LOCATIONS],
    staffLimit: limits[USAGE_LIMIT.STAFF_MEMBERS],
    registerLimit: limits[USAGE_LIMIT.POS_REGISTERS],
    kitchenDisplayLimit: limits[USAGE_LIMIT.KITCHEN_DISPLAYS]
  };
}
