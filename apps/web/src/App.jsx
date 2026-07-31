import {
  Activity,
  ArrowRight,
  Bike,
  ChevronDown,
  CheckCircle2,
  ChefHat,
  Clock,
  CreditCard,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Menu as MenuIcon,
  Minus,
  PackageCheck,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Shield,
  Store,
  TicketPercent,
  Trash2,
  Truck,
  UserCog,
  Users,
  X
} from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import QRCode from "qrcode";
import DriverPwaApp from "./apps/driver/DriverApp.jsx";
import { api, API_ORIGIN, checkApiHealth } from "./lib/api.js";
import { AUTH_EXPIRED_EVENT, AUTH_SESSION_UPDATED_EVENT, clearSession, getStoredSession, storeSession } from "./shared/auth.js";
import { demoCustomerSummary, demoCustomers, demoDrivers, demoGallery, demoGrowth, demoOrders, demoRestaurant, demoRestaurants, demoSocialLinks, demoWebsiteBundle, demoWebsiteSettings, demoDomain } from "./data/demo.js";
import { RESERVED_PLATFORM_SLUGS, validatePublicSlug } from "../../shared/reservedSlugs.js";

const platformNavItems = [
  { id: "admin", label: "Master Admin", icon: Shield },
  { id: "restaurant", label: "Restaurant", icon: ChefHat },
  { id: "customer", label: "Customer", icon: Store },
  { id: "driver", label: "Driver", icon: Bike }
];

const appName = import.meta.env.VITE_APP_NAME || "Loohar";
const tenantRootDomain = import.meta.env.VITE_TENANT_ROOT_DOMAIN || import.meta.env.VITE_PLATFORM_DOMAIN || "loohar.com";
const appDomain = import.meta.env.VITE_APP_DOMAIN || tenantRootDomain;
const vercelProjectDomain = import.meta.env.VITE_VERCEL_PROJECT_DOMAIN || "loohar.vercel.app";
const reservedHostLabels = RESERVED_PLATFORM_SLUGS.filter((slug) => !slug.includes("."));
const localDevReservedHosts = import.meta.env.DEV ? ["localhost", ["127", "0", "0", "1"].join("."), "::1"] : [];
const reservedTenantHosts = new Set([tenantRootDomain, appDomain, vercelProjectDomain, ...localDevReservedHosts, ...reservedHostLabels.map((label) => `${label}.${tenantRootDomain}`)]);
const adminRoles = ["SUPER_ADMIN"];
const restaurantRoles = ["TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER"];
const restaurantStaffRoles = [...restaurantRoles, "CASHIER", "KITCHEN_STAFF"];
const kitchenRoles = restaurantStaffRoles;
const customerRoles = ["CUSTOMER"];
const strongPasswordChecks = [
  { label: "At least 12 characters", test: (value) => value.length >= 12 },
  { label: "Uppercase letter", test: (value) => /[A-Z]/.test(value) },
  { label: "Lowercase letter", test: (value) => /[a-z]/.test(value) },
  { label: "Number", test: (value) => /[0-9]/.test(value) },
  { label: "Special character", test: (value) => /[^A-Za-z0-9]/.test(value) }
];

const businessTypes = ["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK", "CONVENIENCE_STORE", "GAS_STATION_FOOD_SHOP", "LIQUOR_STORE", "OTHER_FOOD_RETAIL"];
const businessModules = ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG", "POS_REGISTER", "POS_KIOSK_MODE"];
const planCodes = ["STARTER", "PROFESSIONAL", "ENTERPRISE"];
const featureLabels = {
  CUSTOMER_CRM: "Customer CRM",
  LOYALTY: "Loyalty program",
  COUPONS: "Coupons and promotions",
  ANALYTICS: "Analytics dashboard",
  MENU_INSIGHTS: "Menu insights",
  CUSTOM_DOMAIN: "Custom domains",
  EMPLOYEE_MANAGEMENT: "Employee management",
  DRIVER_MANAGEMENT: "Driver management",
  KITCHEN_DISPLAY: "Kitchen Display System",
  DELIVERY_ZONES: "Delivery zones",
  INVENTORY: "Inventory foundation",
  PRINTING: "Receipt and ticket printing",
  POS_REGISTER: "POS register",
  POS_KIOSK_MODE: "POS kiosk mode",
  POS_DEVICE_MANAGEMENT: "POS device management",
  POS_CASH_PAYMENTS: "POS cash payments",
  POS_CARD_PAYMENTS: "POS card payments",
  POS_SHIFTS: "POS shifts",
  POS_RECEIPTS: "POS receipts",
  NOTIFICATIONS: "SMS and email notifications",
  REPORTS: "Advanced reports",
  MULTI_LOCATION: "Multi-location"
};
const featureRequiredPlans = {
  CUSTOMER_CRM: "PROFESSIONAL",
  LOYALTY: "PROFESSIONAL",
  COUPONS: "PROFESSIONAL",
  EMPLOYEE_MANAGEMENT: "PROFESSIONAL",
  DRIVER_MANAGEMENT: "PROFESSIONAL",
  KITCHEN_DISPLAY: "PROFESSIONAL",
  DELIVERY_ZONES: "PROFESSIONAL",
  INVENTORY: "PROFESSIONAL",
  PRINTING: "PROFESSIONAL",
  POS_REGISTER: "STARTER",
  POS_KIOSK_MODE: "STARTER",
  POS_DEVICE_MANAGEMENT: "STARTER",
  POS_CASH_PAYMENTS: "STARTER",
  POS_CARD_PAYMENTS: "STARTER",
  POS_SHIFTS: "STARTER",
  POS_RECEIPTS: "STARTER",
  NOTIFICATIONS: "PROFESSIONAL",
  ANALYTICS: "ENTERPRISE",
  MENU_INSIGHTS: "ENTERPRISE",
  CUSTOM_DOMAIN: "ENTERPRISE",
  REPORTS: "ENTERPRISE",
  MULTI_LOCATION: "ENTERPRISE"
};
const introProgramActiveMessage = "Your Loohar introductory program is active. No subscription payment is required today.";
const platformBillingConfigPatterns = [
  /Loohar subscription billing is not configured/i,
  new RegExp(["STRIPE", "PLATFORM", "SECRET", "KEY"].join("_"), "i"),
  /Stripe platform price IDs/i
];

function isPlatformBillingConfigurationMessage(message) {
  const text = String(message || "");
  return platformBillingConfigPatterns.some((pattern) => pattern.test(text));
}
const photoImageAccept = "image/png,image/jpeg,image/jpg,image/webp";
const logoImageAccept = `${photoImageAccept},image/svg+xml`;
const imageAccept = logoImageAccept;
const maxImageBytes = 5 * 1024 * 1024;
const imageMimeByExtension = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml"
};
const websiteSectionDefaults = { hero: true, featuredMenu: true, story: true, gallery: true, loyalty: true, catering: true, contact: true };
const businessHourDays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
];
const businessHourNoteMaxLength = 500;
const galleryTitleMaxLength = 120;
const galleryCategoryMaxLength = 60;
const galleryAltTextMaxLength = 200;
const galleryCaptionMaxLength = 500;
const brandColorModes = [
  { id: "SOLID", label: "Solid" },
  { id: "LINEAR_GRADIENT", label: "Linear gradient" },
  { id: "RADIAL_GRADIENT", label: "Radial gradient" },
  { id: "IMAGE_OVERLAY", label: "Image overlay" },
  { id: "TRANSPARENT", label: "Transparent" }
];
const brandPreviewModes = [
  { id: "desktop-public-site", label: "Desktop public site" },
  { id: "mobile-ordering", label: "Mobile ordering" },
  { id: "email-receipt", label: "Email and receipt" },
  { id: "kiosk-screen", label: "Kiosk screen" }
];
const heroMediaModes = [
  { id: "IMAGE", label: "Single image" },
  { id: "CAROUSEL", label: "Carousel" },
  { id: "SLIDESHOW", label: "Slideshow" },
  { id: "VIDEO", label: "Video hero" }
];
const approvedBrandFonts = [
  { id: "inter", label: "Inter", stack: "Inter, ui-sans-serif, system-ui, sans-serif" },
  { id: "dm-sans", label: "DM Sans", stack: "\"DM Sans\", Inter, ui-sans-serif, system-ui, sans-serif" },
  { id: "poppins", label: "Poppins", stack: "Poppins, Inter, ui-sans-serif, system-ui, sans-serif" },
  { id: "montserrat", label: "Montserrat", stack: "Montserrat, Inter, ui-sans-serif, system-ui, sans-serif" },
  { id: "playfair", label: "Playfair Display", stack: "\"Playfair Display\", Georgia, serif" },
  { id: "libre", label: "Libre Baskerville", stack: "\"Libre Baskerville\", Georgia, serif" },
  { id: "merriweather", label: "Merriweather", stack: "Merriweather, Georgia, serif" },
  { id: "lora", label: "Lora", stack: "Lora, Georgia, serif" },
  { id: "nunito", label: "Nunito Sans", stack: "\"Nunito Sans\", Inter, ui-sans-serif, system-ui, sans-serif" }
];
const brandPresets = [
  { id: "modern-bistro", label: "Modern bistro", brandColor: "#0f766e", accentColor: "#f59e0b", buttonColor: "#2563eb", headingFont: approvedBrandFonts[0].stack, bodyFont: approvedBrandFonts[0].stack, mode: "LINEAR_GRADIENT" },
  { id: "fine-dining", label: "Fine dining", brandColor: "#111827", accentColor: "#d4af37", buttonColor: "#0f766e", headingFont: approvedBrandFonts[4].stack, bodyFont: approvedBrandFonts[1].stack, mode: "SOLID" },
  { id: "fast-casual", label: "Fast casual", brandColor: "#dc2626", accentColor: "#f59e0b", buttonColor: "#16a34a", headingFont: approvedBrandFonts[2].stack, bodyFont: approvedBrandFonts[0].stack, mode: "LINEAR_GRADIENT" },
  { id: "cafe", label: "Cafe", brandColor: "#365314", accentColor: "#a16207", buttonColor: "#0d9488", headingFont: approvedBrandFonts[7].stack, bodyFont: approvedBrandFonts[8].stack, mode: "RADIAL_GRADIENT" },
  { id: "bakery", label: "Bakery", brandColor: "#9f1239", accentColor: "#f97316", buttonColor: "#be123c", headingFont: approvedBrandFonts[5].stack, bodyFont: approvedBrandFonts[8].stack, mode: "SOLID" },
  { id: "minimal", label: "Minimal", brandColor: "#111827", accentColor: "#64748b", buttonColor: "#111827", headingFont: approvedBrandFonts[0].stack, bodyFont: approvedBrandFonts[0].stack, mode: "TRANSPARENT" }
];
const brandPaletteColors = Array.from(new Set(brandPresets.flatMap((preset) => [preset.brandColor, preset.accentColor, preset.buttonColor])));
const defaultBrandTheme = {
  mode: "SOLID",
  brandColor: "#1f9d80",
  accentColor: "#f4b740",
  buttonColor: "#1f9d80",
  headingFont: approvedBrandFonts[0].stack,
  bodyFont: approvedBrandFonts[0].stack,
  opacity: 1,
  overlayOpacity: 0.52,
  gradientAngle: 135,
  gradientStops: [
    { color: "#1f9d80", position: 0, opacity: 1 },
    { color: "#2563eb", position: 100, opacity: 1 }
  ]
};
const defaultHeroMedia = {
  mode: "IMAGE",
  imageBehavior: "cover",
  transition: "fade",
  intervalSeconds: 6,
  reducedMotionFallback: true,
  slides: [],
  video: { url: "", posterUrl: "", captionsUrl: "", muted: true, loop: true, controls: false }
};
const defaultBusinessHours = {
  sunday: { closed: true, windows: [], note: "" },
  monday: { closed: false, windows: [{ open: "11:00", close: "21:00", overnight: false }], note: "" },
  tuesday: { closed: false, windows: [{ open: "11:00", close: "21:00", overnight: false }], note: "" },
  wednesday: { closed: false, windows: [{ open: "11:00", close: "21:00", overnight: false }], note: "" },
  thursday: { closed: false, windows: [{ open: "11:00", close: "21:00", overnight: false }], note: "" },
  friday: { closed: false, windows: [{ open: "11:00", close: "22:00", overnight: false }], note: "" },
  saturday: { closed: false, windows: [{ open: "11:00", close: "22:00", overnight: false }], note: "" }
};
const onboardingSteps = [
  { id: "business", label: "Business" },
  { id: "owner", label: "Owner" },
  { id: "branding", label: "Branding" },
  { id: "content", label: "Content" },
  { id: "hours", label: "Hours" },
  { id: "fulfillment", label: "Pickup & Delivery" },
  { id: "menu", label: "Menu" },
  { id: "gallery", label: "Gallery & Social" },
  { id: "domain", label: "Domain & SEO" },
  { id: "payments", label: "Payments" },
  { id: "review", label: "Review" }
];
const restaurantSettingsLinks = [
  { id: "account", label: "Account", detail: "Owner identity, session, password recovery, and account access.", status: "READ_ONLY" },
  { id: "restaurant-profile", label: "Restaurant Profile", detail: "Business name, public contact details, address, timezone, and public identity.", status: "IMPLEMENTED" },
  { id: "locations", label: "Locations", detail: "Primary location details, address, contact information, timezone, and multi-location foundation.", status: "IMPLEMENTED" },
  { id: "business-hours", label: "Business Hours", detail: "Store hours used by the public website and ordering surfaces.", status: "IMPLEMENTED" },
  { id: "ordering", label: "Ordering", detail: "Pickup, delivery, order readiness, and kitchen workflow configuration.", status: "READ_ONLY" },
  { id: "menu-catalog", label: "Menu/Catalog", detail: "Menu categories, food items, photos, modifiers, availability, and food catalog controls.", status: "IMPLEMENTED", feature: "MENU_MANAGEMENT" },
  { id: "payments", label: "Payments", detail: "Customer checkout, Stripe Connect, and payout readiness.", status: "READ_ONLY", feature: "ORDER_PAYMENTS" },
  { id: "receipts-printing", label: "Receipts & Printing", detail: "Kitchen tickets, customer receipts, printer targets, and future thermal printer integrations.", status: "IMPLEMENTED", feature: "PRINTING" },
  { id: "inventory", label: "Inventory", detail: "Ingredients, stock levels, units, cost tracking, and future automatic depletion.", status: "IMPLEMENTED", feature: "INVENTORY" },
  { id: "website-branding", label: "Website & Branding", detail: "Logo, hero image, brand colors, homepage content, and section visibility.", status: "IMPLEMENTED" },
  { id: "gallery-social", label: "Gallery & Social", detail: "Public gallery photos, captions, visibility, and restaurant social links.", status: "IMPLEMENTED" },
  { id: "domains-seo", label: "Domains & SEO", detail: "Loohar subdomain, custom domain, SSL state, canonical URL, and search metadata.", status: "IMPLEMENTED", feature: "CUSTOM_DOMAIN" },
  { id: "staff-roles", label: "Staff & Roles", detail: "Owner, manager, cashier, kitchen, and driver account foundation.", status: "IMPLEMENTED", feature: "EMPLOYEE_MANAGEMENT" },
  { id: "notifications", label: "Notifications", detail: "SMS and email event settings for orders, receipts, password resets, and welcome emails.", status: "IMPLEMENTED", feature: "NOTIFICATIONS" },
  { id: "loyalty", label: "Loyalty", detail: "Points, rewards, top loyalty customers, issued points, and redeemed points.", status: "IMPLEMENTED", feature: "LOYALTY" },
  { id: "coupons", label: "Coupons", detail: "Active promotions, redemption statistics, and campaign performance.", status: "READ_ONLY", feature: "COUPONS" },
  { id: "delivery-zones", label: "Delivery Zones", detail: "Delivery radius, fees, minimum order amounts, and future map boundaries.", status: "IMPLEMENTED", feature: "DELIVERY_ZONES" },
  { id: "pos-kiosk", label: "POS & Kiosk", detail: "Register configuration, devices, shifts, cash controls, card payments, and kiosk mode.", status: "READ_ONLY", feature: "POS_REGISTER" },
  { id: "security-audit", label: "Security & Audit Logs", detail: "Recent restaurant audit history, account events, and security trail.", status: "READ_ONLY" },
  { id: "billing-subscription", label: "Billing & Subscription", detail: "Current plan, subscription status, Stripe ids, and entitlement source.", status: "READ_ONLY" },
  { id: "integrations", label: "Integrations", detail: "Future partner integrations for delivery, accounting, marketing, and POS ecosystems.", status: "COMING_SOON" },
  { id: "developer-api", label: "Developer/API", detail: "Future API keys, webhook delivery logs, and developer docs.", status: "COMING_SOON" }
];
const restaurantSettingsGroups = [
  { id: "organization", label: "Organization", items: ["account", "restaurant-profile", "locations", "business-hours", "billing-subscription"] },
  { id: "operations", label: "Operations", items: ["menu-catalog", "ordering", "payments", "pos-kiosk", "receipts-printing", "inventory", "delivery-zones"] },
  { id: "people", label: "People", items: ["staff-roles", "customers"] },
  { id: "growth", label: "Growth", items: ["loyalty", "coupons", "notifications", "website-branding", "gallery-social", "domains-seo"] },
  { id: "governance", label: "Governance", items: ["reports", "security-audit", "integrations", "developer-api"] }
];

function groupRestaurantSettingsLinks(links = restaurantSettingsLinks) {
  const normalized = links.map((item) => ({ ...item, id: normalizeRestaurantSettingsSectionId(item.id) }));
  const used = new Set();
  const groups = restaurantSettingsGroups
    .map((group) => ({
      ...group,
      items: group.items
        .map(normalizeRestaurantSettingsSectionId)
        .map((id) => {
          const match = normalized.find((item) => item.id === id);
          if (match) used.add(match.id);
          return match;
        })
        .filter(Boolean)
    }))
    .filter((group) => group.items.length);
  const ungrouped = normalized.filter((item) => !used.has(item.id));
  return ungrouped.length ? [...groups, { id: "other", label: "Other", items: ungrouped }] : groups;
}
const socialPlatformLabels = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  yelp: "Yelp",
  google: "Google Business",
  google_business: "Google Business"
};
const socialPlatformMarks = {
  facebook: "Fb",
  instagram: "Ig",
  tiktok: "Tk",
  x: "X",
  youtube: "Yt",
  linkedin: "In",
  yelp: "Yp",
  google: "G",
  google_business: "G"
};
const defaultLooharImage = "/marketing/loohar-restaurant-hero.png";
const demoEmployees = [
  { id: "emp-manager", name: "Rina Manager", email: "manager@demobistro.local", phone: "555-0188", role: "RESTAURANT_MANAGER", status: "ACTIVE", active: true, permissions: ["orders", "kitchen", "employees"] },
  { id: "emp-kitchen", name: "Kai Kitchen", email: "kitchen@demobistro.local", phone: "555-0199", role: "KITCHEN_STAFF", status: "ACTIVE", active: true, permissions: ["kitchen", "orders"] },
  { id: "emp-cashier", name: "Casey Cashier", email: "cashier@demobistro.local", phone: "555-0122", role: "CASHIER", status: "ACTIVE", active: true, permissions: ["orders", "receipts"] }
];
const demoDispatch = {
  availableDrivers: demoDrivers.filter((driver) => driver.available),
  busyDrivers: [],
  offlineDrivers: demoDrivers.filter((driver) => !driver.available),
  deliveries: [
    { id: "demo-delivery-1", status: "ASSIGNED", tipCents: 600, baseEarningsCents: 650, order: { orderNumber: "894120", customer: { name: "Maya Chen" } }, driver: demoDrivers[0] }
  ]
};
const demoDeliveryZones = [
  { id: "zone-a", name: "Zone A", radiusMiles: 3, deliveryFeeCents: 399, minimumOrderCents: 1500, active: true },
  { id: "zone-b", name: "Zone B", radiusMiles: 6, deliveryFeeCents: 599, minimumOrderCents: 2500, active: true }
];
const demoInventoryItems = [
  { id: "inv-chicken", name: "Chicken", quantity: 42, unit: "lb", costCents: 2600, lowStockAt: 10 },
  { id: "inv-rice", name: "Rice", quantity: 80, unit: "lb", costCents: 1200, lowStockAt: 20 },
  { id: "inv-tomatoes", name: "Tomatoes", quantity: 18, unit: "case", costCents: 1800, lowStockAt: 5 }
];
const demoPrinterSettings = { kitchenPrinterName: "Kitchen Printer", kitchenPrinterEnabled: true, frontCounterPrinterName: "Front Counter", frontCounterPrinterEnabled: true, autoPrintKitchenTickets: false, autoPrintCustomerReceipts: false, provider: "browser_print" };
const demoNotificationSettings = { smsEnabled: false, emailEnabled: true, orderConfirmedSms: false, orderReadySms: false, outForDeliverySms: false, deliveredSms: false, orderConfirmationEmail: true, receiptEmail: true, passwordResetEmail: true, welcomeEmail: true };
const demoOperationsReport = {
  sales: { dailySalesCents: 9621, weeklySalesCents: 42880, monthlySalesCents: 184500 },
  items: {
    topSellingItems: [{ id: "bistro-burger", name: "Bistro Burger", quantity: 38, revenueCents: 64410 }, { id: "grilled-salmon", name: "Grilled Salmon", quantity: 22, revenueCents: 54890 }],
    leastSellingItems: [{ id: "sparkling-water", name: "Sparkling Water", quantity: 4, revenueCents: 1400 }]
  },
  customers: { newCustomers: 18, returningCustomers: 92, vipCustomers: 14 },
  drivers: [{ driverId: "drv-1", name: "Alex Driver", deliveries: 18, tipsCents: 4100, earningsCents: 10300 }]
};
const emptyRestaurantStats = () => ({
  ordersToday: 0,
  pendingOrders: 0,
  activeDrivers: 0,
  sales: { amountCents: 0, driverTipCents: 0, restaurantNetCents: 0 }
});
const emptyCustomerSummary = () => ({
  totalCustomers: 0,
  newCustomersThisMonth: 0,
  newCustomersInRange: 0,
  returningCustomers: 0,
  repeatCustomerPercentage: 0,
  vipCustomerCount: 0,
  activeCustomers: 0,
  atRiskCustomers: 0,
  inactiveCustomers: 0,
  lifetimeSpendCents: 0,
  averageOrderValueCents: 0,
  contactableCustomers: 0,
  guestCustomers: 0
});
const emptyLoyaltyAnalytics = () => ({ analytics: {}, rewards: [], topCustomers: [] });
const emptyPromotionsAnalytics = () => ({ activePromotions: [], redemptions: [], performance: {} });
const emptyGrowthAnalytics = () => ({ metrics: {}, salesTrend: [], ordersTrend: [], customerGrowth: [], loyaltyGrowth: [] });
const emptyMenuInsights = () => ({ bestSellingItems: [], worstSellingItems: [], categoryPerformance: [] });
const emptyWebsiteSettings = () => ({
  websiteEnabled: true,
  sectionSettingsJson: { ...websiteSectionDefaults },
  storeHoursJson: {}
});
const emptyDomainSettings = (slug = "") => ({
  defaultSubdomain: slug,
  primaryDomain: slug ? `${slug}.${tenantRootDomain}` : "",
  canonicalDomain: slug ? `${slug}.${tenantRootDomain}` : "",
  customDomain: "",
  domainStatus: "NOT_CONFIGURED",
  sslStatus: "NOT_CONFIGURED"
});
const emptyDispatchCenter = () => ({
  drivers: [],
  availableDrivers: [],
  busyDrivers: [],
  offlineDrivers: [],
  deliveries: [],
  summary: {
    totalDrivers: 0,
    availableDrivers: 0,
    busyDrivers: 0,
    offlineDrivers: 0,
    activeDeliveries: 0,
    completedDeliveries: 0,
    deliveryPayoutCents: 0,
    driverTipsCents: 0,
    averageDeliveryMinutes: null,
    onTimeStatus: "Not Tracked",
    mileageStatus: "Not Tracked",
    schedulingStatus: "Setup Required"
  }
});
const emptyOperationsReport = () => ({
  range: {},
  sales: {
    grossSalesCents: 0,
    netSalesCents: 0,
    totalCollectedCents: 0,
    dailySalesCents: 0,
    weeklySalesCents: 0,
    monthlySalesCents: 0,
    totalOrders: 0,
    completedOrders: 0,
    openOrders: 0,
    cancelledOrders: 0,
    refundedOrders: 0,
    averageOrderValueCents: 0,
    discountsCents: 0,
    taxesCents: 0,
    tipsCents: 0,
    restaurantTipsCents: 0,
    driverTipsCents: 0,
    deliveryFeesCents: 0,
    serviceFeesCents: 0,
    refundsCents: 0,
    deliveryOrders: 0,
    pickupOrders: 0,
    dineInOrders: 0,
    walkInOrders: 0,
    completionRate: 0,
    cancellationRate: 0,
    refundRate: 0,
    laborCostStatus: "Setup Required",
    estimatedProfitStatus: "Setup Required"
  },
  items: { topSellingItems: [], leastSellingItems: [], revenuePerItem: [], mostProfitableCategories: [] },
  customers: emptyCustomerSummary(),
  drivers: [],
  driverSummary: emptyDispatchCenter().summary,
  charts: {
    salesTrend: [],
    ordersTrend: [],
    customerGrowth: [],
    loyaltyGrowth: [],
    orderTypeBreakdown: [],
    refundsTrend: [],
    tipsTrend: [],
    driverPerformance: []
  },
  drilldowns: { recentOrders: [], refunds: [], ordersByStatus: [] },
  definitions: {}
});
const withDefaultDispatch = (payload = {}) => ({ ...emptyDispatchCenter(), ...(payload || {}), summary: { ...emptyDispatchCenter().summary, ...(payload?.summary || {}) } });
const withDefaultOperationsReport = (payload = {}) => ({
  ...emptyOperationsReport(),
  ...(payload || {}),
  sales: { ...emptyOperationsReport().sales, ...(payload?.sales || {}) },
  items: { ...emptyOperationsReport().items, ...(payload?.items || {}) },
  customers: { ...emptyOperationsReport().customers, ...(payload?.customers || {}) },
  driverSummary: { ...emptyOperationsReport().driverSummary, ...(payload?.driverSummary || {}) },
  charts: { ...emptyOperationsReport().charts, ...(payload?.charts || {}) },
  drilldowns: { ...emptyOperationsReport().drilldowns, ...(payload?.drilldowns || {}) },
  definitions: { ...emptyOperationsReport().definitions, ...(payload?.definitions || {}) }
});
const emptyPrinterSettings = () => ({});
const emptyNotificationSettings = () => ({});

function slugify(value = "") {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function moduleDefaultsFor(businessType = "RESTAURANT") {
  if (["CONVENIENCE_STORE", "GAS_STATION_FOOD_SHOP", "LIQUOR_STORE", "OTHER_FOOD_RETAIL"].includes(businessType)) {
    return ["PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "COUPONS", "FOOD_CATALOG"];
  }
  return businessModules;
}

function createAdminForm() {
  return {
    businessName: "",
    publicBusinessName: "",
    slug: "",
    businessType: "RESTAURANT",
    enabledModules: moduleDefaultsFor("RESTAURANT"),
    ownerEmail: "",
    plan: "STARTER",
    billingMode: "INTRO_TRIAL",
    businessEmail: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    timezone: "America/Denver",
    deliveryEnabled: true,
    pickupEnabled: true,
    websiteEnabled: true,
    categoryLabel: "Restaurant"
  };
}

function tenantEditState(restaurant) {
  if (!restaurant) return null;
  const website = restaurant.websiteSettings || {};
  return {
    id: restaurant.id,
    name: restaurant.name || "",
    businessName: restaurant.businessName || restaurant.name || "",
    ownerEmail: restaurant.users?.find((user) => ["TENANT_OWNER", "RESTAURANT_OWNER"].includes(user.role))?.email || restaurant.users?.[0]?.email || "",
    slug: restaurant.slug || "",
    businessType: restaurant.businessType || "RESTAURANT",
    enabledModules: restaurant.enabledModules || moduleDefaultsFor(restaurant.businessType),
    status: restaurant.status || "ACTIVE",
    email: restaurant.email || "",
    phone: restaurant.phone || "",
    address: restaurant.address || "",
    city: restaurant.city || "",
    state: restaurant.state || "",
    zip: restaurant.zip || "",
    timezone: restaurant.timezone || "America/Denver",
    deliveryEnabled: restaurant.deliveryEnabled !== false,
    pickupEnabled: restaurant.pickupEnabled !== false,
    websiteEnabled: website.websiteEnabled !== false,
    cuisineType: website.cuisineType || "",
    logoUrl: website.logoUrl || "",
    heroImageUrl: website.heroImageUrl || "",
    brandColor: website.brandColor || "#1f9d80",
    accentColor: website.accentColor || "#f4b740",
    headingFont: website.headingFont || "",
    bodyFont: website.bodyFont || "",
    sectionSettingsJson: website.sectionSettingsJson || websiteSectionDefaults,
    storeHoursJson: website.storeHoursJson || restaurant.storeHoursJson || {},
    tagline: website.tagline || "",
    heroTitle: website.heroTitle || "",
    heroSubtitle: website.heroSubtitle || "",
    aboutStory: website.aboutStory || "",
    specialOfferText: website.specialOfferText || "",
    seoTitle: website.seoTitle || "",
    seoDescription: website.seoDescription || "",
    customDomain: restaurant.domains?.[0]?.customDomain || "",
    defaultSubdomain: restaurant.domains?.[0]?.defaultSubdomain || restaurant.slug || "",
    primaryDomain: restaurant.domains?.[0]?.primaryDomain || `${restaurant.slug || "restaurant"}.${tenantRootDomain}`,
    canonicalDomain: restaurant.domains?.[0]?.canonicalDomain || `${restaurant.slug || "restaurant"}.${tenantRootDomain}`,
    domainStatus: restaurant.domains?.[0]?.domainStatus || "PENDING_VERIFICATION",
    dnsTarget: restaurant.domains?.[0]?.dnsTarget || "cname.vercel-dns.com",
    sslStatus: restaurant.domains?.[0]?.sslStatus || "NOT_CONFIGURED",
    planCode: restaurant.subscriptions?.find((subscription) => subscription.active !== false)?.plan?.code || restaurant.subscriptions?.[0]?.plan?.code || "STARTER"
  };
}

function websiteSettingsPayload(source) {
  return {
    websiteEnabled: source.websiteEnabled,
    cuisineType: source.cuisineType,
    logoUrl: source.logoUrl,
    heroImageUrl: source.heroImageUrl,
    brandColor: source.brandColor,
    accentColor: source.accentColor,
    headingFont: source.headingFont,
    bodyFont: source.bodyFont,
    sectionSettingsJson: source.sectionSettingsJson,
    storeHoursJson: source.storeHoursJson,
    tagline: source.tagline,
    heroTitle: source.heroTitle,
    heroSubtitle: source.heroSubtitle,
    aboutStory: source.aboutStory,
    specialOfferText: source.specialOfferText,
    seoTitle: source.seoTitle,
    seoDescription: source.seoDescription
  };
}

function scalarTenantPayload(tenant) {
  return {
    name: tenant.name,
    businessName: tenant.businessName || tenant.name,
    slug: tenant.slug,
    businessType: tenant.businessType,
    enabledModules: tenant.enabledModules,
    status: tenant.status,
    email: tenant.email,
    phone: tenant.phone,
    address: tenant.address,
    city: tenant.city,
    state: tenant.state,
    zip: tenant.zip,
    timezone: tenant.timezone,
    ownerEmail: tenant.ownerEmail,
    deliveryEnabled: tenant.deliveryEnabled,
    pickupEnabled: tenant.pickupEnabled
  };
}

function domainSettingsPayload(source) {
  return {
    defaultSubdomain: source.defaultSubdomain,
    primaryDomain: source.primaryDomain,
    customDomain: source.customDomain,
    canonicalDomain: source.canonicalDomain,
    domainStatus: source.domainStatus,
    dnsTarget: source.dnsTarget,
    sslStatus: source.sslStatus
  };
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tenantRequiredFields = [
  ["businessName", "Business Name"],
  ["publicBusinessName", "Public Business Name"],
  ["slug", "Slug"],
  ["businessType", "Business Type"],
  ["categoryLabel", "Category Label"],
  ["plan", "Plan"],
  ["billingMode", "Billing Mode"],
  ["ownerEmail", "Owner Email"],
  ["businessEmail", "Business Email"],
  ["phone", "Phone"],
  ["address", "Address"],
  ["city", "City"],
  ["state", "State"],
  ["zip", "ZIP"],
  ["timezone", "Timezone"],
  ["websiteEnabled", "Website setting"],
  ["pickupEnabled", "Pickup setting"],
  ["deliveryEnabled", "Delivery setting"],
  ["enabledModules", "Enabled Modules"]
];

function validateTenantForm(form) {
  const errors = {};
  tenantRequiredFields.forEach(([field, label]) => {
    const value = form[field];
    if (Array.isArray(value) && value.length === 0) errors[field] = `${label} is required.`;
    else if (typeof value === "boolean") return;
    else if (!String(value ?? "").trim()) errors[field] = `${label} is required.`;
  });
  if (form.slug) {
    const slugValidation = validatePublicSlug(form.slug);
    if (!slugValidation.ok) errors.slug = slugValidation.error;
  }
  if (form.ownerEmail && !emailPattern.test(form.ownerEmail)) errors.ownerEmail = "Enter a valid owner email.";
  if (form.businessEmail && !emailPattern.test(form.businessEmail)) errors.businessEmail = "Enter a valid business email.";
  return errors;
}

function tenantCreatePayload(form) {
  return {
    businessName: form.businessName,
    publicBusinessName: form.publicBusinessName,
    slug: form.slug,
    businessType: form.businessType,
    categoryLabel: form.categoryLabel,
    plan: form.plan,
    billingMode: form.billingMode,
    ownerEmail: form.ownerEmail,
    businessEmail: form.businessEmail,
    phone: form.phone,
    address: form.address,
    city: form.city,
    state: form.state,
    zip: form.zip,
    timezone: form.timezone,
    websiteEnabled: form.websiteEnabled,
    pickupEnabled: form.pickupEnabled,
    deliveryEnabled: form.deliveryEnabled,
    enabledModules: form.enabledModules
  };
}

function FieldError({ message, id }) {
  return message ? <p className="field-error" id={id}>{message}</p> : null;
}

function money(cents = 0) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
}

function paymentFeeDisclosureText(source = {}) {
  if (!source) return "";
  if (source.paymentFeeDisclosure) return source.paymentFeeDisclosure;
  const looharPlatformFeeCents = Number(source.looharPlatformFeeCents ?? source.platformFeeCents ?? 0);
  if (source.zeroLooharPlatformFee || looharPlatformFeeCents === 0) {
    return "No Loohar transaction fee is added to this order; processor fees may still apply.";
  }
  return "";
}

async function qrImageData(url) {
  if (!url) return "";
  return QRCode.toDataURL(url, { width: 192, margin: 3, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
}

function normalizePublicRestaurant(payload, fallback = demoRestaurant) {
  if (!payload) return fallback;
  return payload.restaurant || payload;
}

function emptyPublicRestaurant(slug = "") {
  return {
    slug,
    name: "Restaurant",
    businessName: "Restaurant",
    categories: [],
    pickupEnabled: false,
    deliveryEnabled: false,
    deliveryFeeCents: 0
  };
}

function readable(value = "") {
  return value.toLowerCase().replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeHexColor(value, fallback) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.slice(1).split("").map((part) => part + part).join("")}`.toLowerCase();
  }
  return fallback;
}

function normalizeFontStack(value, fallback = approvedBrandFonts[0].stack) {
  const raw = String(value || "").trim();
  const match = approvedBrandFonts.find((font) => font.id === raw || font.label === raw || font.stack === raw);
  return match?.stack || raw || fallback;
}

function hexToRgb(value) {
  const hex = normalizeHexColor(value, "#000000").slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
}

function rgbColorString(value) {
  const { r, g, b } = hexToRgb(value);
  return `rgb(${r}, ${g}, ${b})`;
}

function hslColorString(value) {
  const { r, g, b } = hexToRgb(value);
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  let saturation = 0;
  if (delta) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    if (max === green) hue = 60 * ((blue - red) / delta + 2);
    if (max === blue) hue = 60 * ((red - green) / delta + 4);
  }
  return `hsl(${Math.round((hue + 360) % 360)}, ${Math.round(saturation * 100)}%, ${Math.round(lightness * 100)}%)`;
}

function relativeLuminance(hexColor) {
  const { r, g, b } = hexToRgb(hexColor);
  const channels = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatioForColors(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const light = Math.max(foregroundLuminance, backgroundLuminance);
  const dark = Math.min(foregroundLuminance, backgroundLuminance);
  return Number(((light + 0.05) / (dark + 0.05)).toFixed(2));
}

function alphaColor(hexColor, opacity = 1) {
  const { r, g, b } = hexToRgb(hexColor);
  return `rgba(${r}, ${g}, ${b}, ${clampNumber(opacity, 0, 1, 1)})`;
}

function normalizeGradientStops(stops, fallbackTheme = defaultBrandTheme) {
  const source = Array.isArray(stops) && stops.length ? stops : defaultBrandTheme.gradientStops;
  return source
    .slice(0, 5)
    .map((stop, index) => ({
      color: normalizeHexColor(stop?.color, index === 0 ? fallbackTheme.brandColor : fallbackTheme.buttonColor),
      position: clampNumber(stop?.position, 0, 100, index === 0 ? 0 : 100),
      opacity: clampNumber(stop?.opacity, 0, 1, 1)
    }))
    .sort((first, second) => first.position - second.position);
}

function normalizeBrandTheme(rawTheme = {}, website = {}) {
  const fallbackTheme = {
    ...defaultBrandTheme,
    brandColor: normalizeHexColor(website.brandColor, defaultBrandTheme.brandColor),
    accentColor: normalizeHexColor(website.accentColor, defaultBrandTheme.accentColor),
    buttonColor: normalizeHexColor(website.buttonColor || website.brandColor, defaultBrandTheme.buttonColor),
    headingFont: normalizeFontStack(website.headingFont, defaultBrandTheme.headingFont),
    bodyFont: normalizeFontStack(website.bodyFont, defaultBrandTheme.bodyFont)
  };
  const mode = brandColorModes.some((item) => item.id === rawTheme.mode) ? rawTheme.mode : fallbackTheme.mode;
  const theme = {
    mode,
    brandColor: normalizeHexColor(rawTheme.brandColor, fallbackTheme.brandColor),
    accentColor: normalizeHexColor(rawTheme.accentColor, fallbackTheme.accentColor),
    buttonColor: normalizeHexColor(rawTheme.buttonColor, fallbackTheme.buttonColor),
    headingFont: normalizeFontStack(rawTheme.headingFont, fallbackTheme.headingFont),
    bodyFont: normalizeFontStack(rawTheme.bodyFont, fallbackTheme.bodyFont),
    opacity: clampNumber(rawTheme.opacity, 0, 1, fallbackTheme.opacity),
    overlayOpacity: clampNumber(rawTheme.overlayOpacity, 0, 0.9, fallbackTheme.overlayOpacity),
    gradientAngle: clampNumber(rawTheme.gradientAngle, 0, 360, fallbackTheme.gradientAngle)
  };
  return { ...theme, gradientStops: normalizeGradientStops(rawTheme.gradientStops, theme) };
}

function gradientStopCss(stop) {
  return `${alphaColor(stop.color, stop.opacity)} ${stop.position}%`;
}

function brandThemeBackground(theme) {
  const normalized = normalizeBrandTheme(theme);
  if (normalized.mode === "TRANSPARENT") return "transparent";
  if (normalized.mode === "RADIAL_GRADIENT") return `radial-gradient(circle at top left, ${normalized.gradientStops.map(gradientStopCss).join(", ")})`;
  if (normalized.mode === "LINEAR_GRADIENT" || normalized.mode === "IMAGE_OVERLAY") return `linear-gradient(${normalized.gradientAngle}deg, ${normalized.gradientStops.map(gradientStopCss).join(", ")})`;
  return alphaColor(normalized.brandColor, normalized.opacity);
}

function normalizeHeroSlide(rawSlide = {}, fallback = {}) {
  return {
    id: String(rawSlide.id || fallback.id || `slide-${fallback.index || 0}`),
    imageUrl: String(rawSlide.imageUrl || fallback.imageUrl || "").trim(),
    mobileImageUrl: String(rawSlide.mobileImageUrl || fallback.mobileImageUrl || "").trim(),
    title: String(rawSlide.title || fallback.title || "").trim(),
    subtitle: String(rawSlide.subtitle || fallback.subtitle || "").trim(),
    altText: String(rawSlide.altText || fallback.altText || "").trim(),
    focalPoint: String(rawSlide.focalPoint || fallback.focalPoint || "center").trim(),
    published: rawSlide.published !== false
  };
}

function normalizeHeroMedia(rawMedia = {}, website = {}, gallery = []) {
  const mode = heroMediaModes.some((item) => item.id === rawMedia.mode) ? rawMedia.mode : defaultHeroMedia.mode;
  const primarySlide = normalizeHeroSlide(rawMedia.slides?.[0], {
    id: "primary-hero",
    imageUrl: website.heroImageUrl || "",
    mobileImageUrl: website.mobileHeroImageUrl || "",
    title: website.heroTitle || "",
    subtitle: website.heroSubtitle || "",
    altText: `${website.heroTitle || "Restaurant"} hero image`,
    index: 0
  });
  const gallerySlides = gallery
    .filter((image) => isValidImageUrl(image.imageUrl))
    .slice(0, 6)
    .map((image, index) => normalizeHeroSlide(image, {
      id: `gallery-${image.id || index}`,
      imageUrl: image.imageUrl,
      title: image.title,
      subtitle: image.caption,
      altText: image.altText || image.title || "Restaurant gallery image",
      index: index + 1
    }));
  const rawSlides = Array.isArray(rawMedia.slides) && rawMedia.slides.length ? rawMedia.slides : [primarySlide, ...gallerySlides];
  const slides = rawSlides.slice(0, 8).map((slide, index) => normalizeHeroSlide(slide, { ...primarySlide, index }));
  return {
    mode,
    imageBehavior: ["cover", "contain", "center"].includes(rawMedia.imageBehavior) ? rawMedia.imageBehavior : defaultHeroMedia.imageBehavior,
    transition: ["fade", "slide", "none"].includes(rawMedia.transition) ? rawMedia.transition : defaultHeroMedia.transition,
    intervalSeconds: clampNumber(rawMedia.intervalSeconds, 3, 15, defaultHeroMedia.intervalSeconds),
    reducedMotionFallback: rawMedia.reducedMotionFallback !== false,
    slides,
    video: {
      url: String(rawMedia.video?.url || "").trim(),
      posterUrl: String(rawMedia.video?.posterUrl || website.heroImageUrl || "").trim(),
      captionsUrl: String(rawMedia.video?.captionsUrl || "").trim(),
      muted: rawMedia.video?.muted !== false,
      loop: rawMedia.video?.loop !== false,
      controls: rawMedia.video?.controls === true
    }
  };
}

function cloneBusinessHours(hours = defaultBusinessHours) {
  return Object.fromEntries(businessHourDays.map((day) => {
    const value = hours[day] || defaultBusinessHours[day];
    return [day, {
      closed: value.closed === true,
      windows: Array.isArray(value.windows) ? value.windows.map((window) => ({ ...window })) : [],
      note: value.note || ""
    }];
  }));
}

function timeTo24Hour(value = "") {
  const raw = String(value || "").trim();
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = match[2] || "00";
  const period = match[3].toUpperCase();
  if (period === "PM" && hour < 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function legacyHoursToDayConfig(value) {
  const label = String(value || "").trim();
  if (!label || label.toLowerCase() === "closed") return { closed: true, windows: [], note: "" };
  const range = label.split(/\s+-\s+/);
  const open = timeTo24Hour(range[0]);
  const close = timeTo24Hour(range[1]);
  if (!open || !close) return { closed: false, windows: [{ open: "11:00", close: "21:00", overnight: false }], note: label };
  return { closed: false, windows: [{ open, close, overnight: close <= open }], note: "" };
}

function normalizeBusinessHoursForDraft(rawHours) {
  const source = rawHours && typeof rawHours === "object" && !Array.isArray(rawHours) ? rawHours : {};
  const hasAnyHours = businessHourDays.some((day) => source[day] !== undefined && source[day] !== null && source[day] !== "");
  if (!hasAnyHours) return cloneBusinessHours();
  return Object.fromEntries(businessHourDays.map((day) => {
    const current = source[day];
    if (typeof current === "string") return [day, legacyHoursToDayConfig(current)];
    if (current && typeof current === "object" && !Array.isArray(current)) {
      const windows = Array.isArray(current.windows) ? current.windows : [current];
      const normalizedWindows = windows
        .map((window) => ({
          open: timeTo24Hour(window.open || window.start || window.from),
          close: timeTo24Hour(window.close || window.end || window.to),
          overnight: Boolean(window.overnight)
        }))
        .filter((window) => window.open && window.close);
      return [day, {
        closed: current.closed === true || (!normalizedWindows.length && String(current.label || "").toLowerCase() === "closed"),
        windows: normalizedWindows.length ? normalizedWindows : cloneBusinessHours()[day].windows,
        note: current.note || current.label || ""
      }];
    }
    return [day, cloneBusinessHours()[day]];
  }));
}

function minutesFromBusinessTime(value = "") {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function validateBusinessHours(hours = {}, timezone = "") {
  const errors = [];
  const normalized = normalizeBusinessHoursForDraft(hours);
  if (!timezone || !/^[A-Za-z_]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?$/.test(timezone)) {
    errors.push("Enter a valid timezone, for example America/Denver.");
  }
  businessHourDays.forEach((day) => {
    const config = normalized[day];
    if (String(config.note || "").length > businessHourNoteMaxLength) {
      errors.push(`${readable(day)} note must be ${businessHourNoteMaxLength} characters or less.`);
    }
    if (config.closed) return;
    const ranges = [];
    config.windows.forEach((window, index) => {
      const open = minutesFromBusinessTime(window.open);
      const close = minutesFromBusinessTime(window.close);
      if (open === null || close === null) {
        errors.push(`${readable(day)} window ${index + 1} needs valid opening and closing times.`);
        return;
      }
      if (open >= close && !window.overnight) {
        errors.push(`${readable(day)} closing time must be after opening time unless overnight is enabled.`);
      }
      ranges.push({ open, close: close <= open && window.overnight ? close + 1440 : close });
    });
    ranges.sort((a, b) => a.open - b.open);
    for (let index = 1; index < ranges.length; index += 1) {
      if (ranges[index].open < ranges[index - 1].close) {
        errors.push(`${readable(day)} service windows cannot overlap.`);
      }
    }
  });
  return errors;
}

function integer(value = 0) {
  return Number(value || 0).toLocaleString();
}

function percentText(value = 0) {
  const numeric = Number(value || 0);
  return `${Number.isInteger(numeric) ? numeric : numeric.toFixed(1)}%`;
}

function dateText(value) {
  if (!value) return "No data";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No data" : date.toLocaleDateString();
}

function minutesText(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "Not Tracked";
  return `${Math.round(Number(value))} min`;
}

function safeCustomerContact(customer = {}) {
  return customer.safeEmail || customer.email || customer.safePhone || customer.phone || customer.contactLabel || "Customer contact unavailable";
}

function metricMax(rows = [], key = "value") {
  return Math.max(1, ...rows.map((row) => Number(row?.[key] || 0)));
}

function chartValuePercent(value, max) {
  return `${Math.max(3, Math.min(100, Math.round((Number(value || 0) / Math.max(1, Number(max || 1))) * 100)))}%`;
}

function locationDraftFrom(location = {}, profile = {}) {
  return {
    name: location.name || profile.businessName || profile.name || "Primary location",
    address: location.address || profile.address || "",
    address2: location.address2 || "",
    city: location.city || profile.city || "",
    state: location.state || profile.state || "",
    zip: location.zip || profile.zip || "",
    country: location.country || "US",
    phone: location.phone || profile.phone || "",
    timezone: location.timezone || profile.timezone || "America/Denver",
    active: location.active !== false,
    primary: location.primary !== false
  };
}

function planFor(restaurant = {}) {
  return restaurant.subscriptions?.find((subscription) => subscription.active !== false)?.plan?.code || restaurant.subscriptions?.[0]?.plan?.code || "STARTER";
}

function navHref(tabId) {
  const hrefs = {
    admin: "/admin",
    restaurant: "/restaurant",
    customer: "/customer",
    driver: "/driver"
  };
  return hrefs[tabId] || "/";
}

function platformNavigation(path, showAddBusiness) {
  const items = platformNavItems.map((item) => ({
    ...item,
    href: navHref(item.id),
    active: item.id === "admin" ? path === "/admin" || path.includes("/audit") : path.startsWith(navHref(item.id))
  }));
  if (showAddBusiness) {
    items.push({ id: "add-business", label: "Add Business", icon: Plus, href: "/admin/business/new", active: path === "/admin/business/new" });
  }
  return items;
}

const restaurantPageDefinitions = {
  dashboard: {
    label: "Dashboard",
    icon: LayoutDashboard,
    title: "Restaurant dashboard",
    description: "Track the most important operational signals and jump into focused workflows."
  },
  pos: {
    label: "POS",
    icon: CreditCard,
    title: "POS register",
    description: "Create in-store orders, manage register devices, shifts, cash controls, and kiosk mode."
  },
  kiosk: {
    label: "Kiosk",
    icon: Shield,
    title: "POS kiosk",
    description: "Run a secure full-screen register for cashier and counter staff."
  },
  orders: {
    label: "Orders",
    icon: ReceiptText,
    title: "Orders",
    description: "Manage live and historical restaurant orders."
  },
  kitchen: {
    label: "Kitchen",
    icon: ChefHat,
    title: "Kitchen",
    description: "Track preparation and move orders through the kitchen workflow."
  },
  customers: {
    label: "Customers",
    icon: Users,
    title: "Customers",
    description: "View customer relationships, order history, and loyalty activity."
  },
  drivers: {
    label: "Drivers",
    icon: Truck,
    title: "Drivers",
    description: "Manage the restaurant delivery team and active assignments."
  },
  reports: {
    label: "Reports",
    icon: Activity,
    title: "Reports",
    description: "Review restaurant performance, orders, customers, and payouts."
  },
  settings: {
    label: "Settings",
    icon: UserCog,
    title: "Settings",
    description: "Configure restaurant profile, website, ordering, payments, and access."
  }
};

const restaurantPageOrder = ["dashboard", "pos", "orders", "kitchen", "customers", "drivers", "reports", "settings"];
const restaurantSettingsChildRoutes = new Set([
  "account",
  "restaurant-profile",
  "profile",
  "restaurants",
  "ownership",
  "restaurants-ownership",
  "chains-locations",
  "locations",
  "business-hours",
  "subscription",
  "website",
  "website-branding",
  "branding",
  "menu",
  "menu-catalog",
  "catalog",
  "gallery",
  "gallery-social",
  "social",
  "ordering",
  "delivery",
  "delivery-zones",
  "domains",
  "domains-seo",
  "payments",
  "staff",
  "staff-access",
  "staff-roles",
  "notifications",
  "billing",
  "billing-subscription",
  "loyalty",
  "coupons",
  "receipts-printing",
  "pos-kiosk",
  "security",
  "security-audit",
  "advanced",
  "integrations",
  "developer-api"
]);

const restaurantSettingsAliases = {
  profile: "restaurant-profile",
  restaurants: "restaurant-profile",
  ownership: "restaurant-profile",
  "restaurants-ownership": "restaurant-profile",
  "chains-locations": "locations",
  subscription: "billing-subscription",
  website: "website-branding",
  branding: "website-branding",
  menu: "menu-catalog",
  catalog: "menu-catalog",
  gallery: "gallery-social",
  social: "gallery-social",
  delivery: "delivery-zones",
  domains: "domains-seo",
  staff: "staff-roles",
  "staff-access": "staff-roles",
  billing: "billing-subscription",
  security: "security-audit",
  advanced: "developer-api"
};

function restaurantPageFromPath(path = "") {
  if (path === "/kitchen" || path.startsWith("/kitchen/")) return "kitchen";
  const parts = pathParts(path);
  if (parts[0] !== "restaurant") return "dashboard";
  const maybePage = parts[2] || (isRestaurantPageSegment(parts[1]) ? parts[1] : "dashboard");
  if (maybePage === "onboarding") return "settings";
  if (restaurantSettingsChildRoutes.has(maybePage)) return "settings";
  if (maybePage === "dashboard" && typeof window !== "undefined") {
    const legacyHashPages = {
      "#orders": "orders",
      "#pos": "pos",
      "#customers": "customers",
      "#drivers": "drivers",
      "#reports": "reports",
      "#kitchen": "kitchen",
      "#settings": "settings",
      "#settings-menu-catalog": "settings",
      "#settings-website-branding": "settings",
      "#settings-domains-seo": "settings"
    };
    if (legacyHashPages[window.location.hash]) return legacyHashPages[window.location.hash];
  }
  return restaurantPageDefinitions[maybePage] ? maybePage : "dashboard";
}

function restaurantPagePath(slug = "", page = "dashboard") {
  const base = slug ? `/restaurant/${slug}` : "/restaurant";
  if (page === "dashboard") return `${base}/dashboard`;
  return `${base}/${page}`;
}

function normalizeRestaurantSettingsSectionId(section = "") {
  const id = String(section || "").replace(/^#?settings-?/, "").trim();
  return restaurantSettingsAliases[id] || id || "account";
}

function restaurantSettingsSectionFromPath(path = "", hash = "") {
  const parts = pathParts(path);
  if (parts[0] === "restaurant" && parts[2] === "settings" && parts[3]) return normalizeRestaurantSettingsSectionId(parts[3]);
  if (parts[0] === "restaurant" && restaurantSettingsChildRoutes.has(parts[2])) return normalizeRestaurantSettingsSectionId(parts[2]);
  if (hash) return normalizeRestaurantSettingsSectionId(hash);
  return "";
}

function restaurantSettingPath(basePath = "/restaurant", sectionId = "account") {
  return `${basePath.replace(/\/+$/, "")}/settings/${normalizeRestaurantSettingsSectionId(sectionId)}`;
}

function settingsStatusLabel(status = "READ_ONLY") {
  return readable(status);
}

function settingsStatusTone(status = "READ_ONLY") {
  const tones = {
    IMPLEMENTED: "good",
    READ_ONLY: "neutral",
    COMING_SOON: "warn",
    PLAN_RESTRICTED: "warn",
    PERMISSION_RESTRICTED: "bad"
  };
  return tones[status] || "neutral";
}

function restaurantProfilePlaceholder(user, fallbackSlug = "") {
  const slug = user?.restaurantSlug || fallbackSlug || "";
  const name = user?.restaurantName || user?.tenantName || (slug ? readable(slug) : "Restaurant");
  return {
    id: user?.restaurantId || "",
    slug,
    name,
    businessName: name,
    publicBusinessName: name,
    businessType: "RESTAURANT",
    status: "ACTIVE",
    enabledModules: user?.enabledModules || [],
    logoUrl: "",
    heroImageUrl: "",
    phone: user?.phone || "",
    email: user?.email || "",
    address: "",
    city: "",
    state: "",
    zip: "",
    timezone: "America/Denver",
    categories: []
  };
}

function pathParts(path = "") {
  return path.split("/").filter(Boolean);
}

function isRestaurantPageSegment(segment = "") {
  return Boolean(restaurantPageDefinitions[segment]);
}

function restaurantMembershipSlugs(user) {
  const slugs = [
    user?.restaurantSlug,
    ...(Array.isArray(user?.memberships) ? user.memberships.map((membership) => membership?.tenantSlug) : [])
  ].filter(Boolean);
  return [...new Set(slugs)];
}

function primaryRestaurantSlugFor(user) {
  return restaurantMembershipSlugs(user)[0] || "";
}

function legacyRestaurantRedirectPath(path = "", user) {
  const parts = pathParts(path);
  if (parts[0] !== "restaurant" || !isRestaurantPageSegment(parts[1])) return "";
  const slug = primaryRestaurantSlugFor(user);
  if (!slug) return "";
  const page = isRestaurantPageSegment(parts[2]) ? parts[2] : parts[1];
  return restaurantPagePath(slug, page);
}

function restaurantOperationsNavigation(user, restaurantSlug, path) {
  const slug = restaurantSlug || primaryRestaurantSlugFor(user);
  const currentPage = restaurantPageFromPath(path);
  const canUseKitchen = kitchenRoles.includes(normalizeRole(user?.role));
  const showSetup = restaurantRoles.includes(user?.role) && (!restaurantOnboardingComplete(user) || path.includes("/onboarding"));
  const items = restaurantPageOrder
    .filter((page) => page !== "kitchen" || canUseKitchen)
    .map((page) => ({
      ...restaurantPageDefinitions[page],
      href: restaurantPagePath(slug, page),
      active: currentPage === page
    }));
  if (showSetup) {
    items.unshift({ label: "Setup", icon: PackageCheck, href: `${slug ? `/restaurant/${slug}` : "/restaurant"}/onboarding`, active: path.includes("/onboarding") });
  }
  return items.filter(Boolean);
}

function dashboardPathFor(user) {
  const slug = primaryRestaurantSlugFor(user);
  const restaurantPath = slug ? `/restaurant/${slug}/dashboard` : "/restaurant/dashboard";
  const onboardingPath = slug ? `/restaurant/${slug}/onboarding` : "/restaurant/onboarding";
  const kitchenPath = slug ? `/kitchen/${slug}` : "/kitchen";
  const needsOnboarding = restaurantRoles.includes(normalizeRole(user?.role)) && !restaurantOnboardingComplete(user);
  const destinations = {
    SUPER_ADMIN: "/admin",
    TENANT_OWNER: needsOnboarding ? onboardingPath : restaurantPath,
    RESTAURANT_ADMIN: needsOnboarding ? onboardingPath : restaurantPath,
    RESTAURANT_OWNER: needsOnboarding ? onboardingPath : restaurantPath,
    RESTAURANT_MANAGER: needsOnboarding ? onboardingPath : restaurantPath,
    CASHIER: kitchenPath,
    KITCHEN_STAFF: kitchenPath,
    DRIVER: "/driver",
    CUSTOMER: "/customer"
  };
  return destinations[user?.role] || "/login";
}

function restaurantOnboardingComplete(user) {
  const status = user?.onboardingStatus || user?.restaurant?.onboardingStatus || user?.membership?.onboardingStatus;
  return !status || status === "COMPLETED";
}

function restaurantOnboardingPathFor(user, fallbackSlug = "") {
  const slug = primaryRestaurantSlugFor(user) || fallbackSlug || "";
  return slug ? `/restaurant/${slug}/onboarding` : "/restaurant/onboarding";
}

function isRestaurantOnboardingPath(path = "") {
  return path === "/restaurant/onboarding" || /^\/restaurant\/[^/]+\/onboarding\/?$/.test(path);
}

function isAuthPagePath(path = "") {
  return ["/login", "/admin/login", "/restaurant/login", "/forgot-password"].includes(path) || path.startsWith("/reset-password/");
}

function routeSlug(path, prefix) {
  const parts = pathParts(path);
  if (prefix === "restaurant" && isRestaurantPageSegment(parts[1])) return "";
  return parts[0] === prefix && parts[1] ? parts[1] : "";
}

function canAccessTenantRoute(user, path, prefix) {
  if (!user) return false;
  if (normalizeRole(user.role) === "SUPER_ADMIN") return false;
  const slug = routeSlug(path, prefix);
  if (prefix === "restaurant" && slug === "onboarding") return restaurantRoles.includes(normalizeRole(user.role));
  if (!slug) return true;
  const allowedSlugs = restaurantMembershipSlugs(user);
  return allowedSlugs.length ? allowedSlugs.includes(slug) : slug === user.restaurantSlug;
}

function normalizeRole(role) {
  return String(role || "").trim().toUpperCase();
}

function activeMembership(memberships = []) {
  return memberships.find((membership) => membership?.status === "ACTIVE") || memberships[0] || null;
}

function normalizeSessionUser(user, memberships = []) {
  if (!user) return null;
  const membership = activeMembership(memberships);
  return {
    ...user,
    role: normalizeRole(user.role),
    restaurantId: user.restaurantId || user.tenantId || membership?.tenantId || null,
    restaurantSlug: user.restaurantSlug || user.tenantSlug || user.restaurant?.slug || membership?.tenantSlug || null,
    restaurantName: user.restaurantName || user.tenantName || user.restaurant?.businessName || user.restaurant?.name || membership?.tenantName || null,
    onboardingStatus: user.onboardingStatus || user.restaurant?.onboardingStatus || membership?.onboardingStatus || null,
    onboardingCurrentStep: user.onboardingCurrentStep || user.restaurant?.onboardingCurrentStep || membership?.onboardingCurrentStep || "business",
    websitePublishedAt: user.websitePublishedAt || user.restaurant?.websitePublishedAt || membership?.websitePublishedAt || null,
    memberships
  };
}

function safeReturnTo(defaultPath = "/") {
  const requested = new globalThis.URLSearchParams(window.location.search).get("returnTo") || "";
  if (!requested.startsWith("/") || requested.startsWith("//")) return defaultPath;
  if (/^(javascript:|data:)/i.test(requested)) return defaultPath;
  if (isAuthPagePath(requested)) return defaultPath;
  return requested;
}

function returnToForUser(user) {
  const fallback = dashboardPathFor(user);
  const requested = safeReturnTo(fallback);
  if (user?.role === "SUPER_ADMIN" && requested.startsWith("/admin")) return requested;
  if (restaurantStaffRoles.includes(user?.role) && (requested.startsWith("/restaurant") || requested.startsWith("/kitchen"))) return legacyRestaurantRedirectPath(requested, user) || requested;
  if (user?.role === "DRIVER" && requested.startsWith("/driver")) return requested;
  if (user?.role === "CUSTOMER" && (requested.startsWith("/customer") || requested.startsWith("/app/order"))) return requested;
  return fallback;
}

function loginHrefWithReturnTo(loginPath, returnTo = window.location.pathname) {
  const safePath = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return `${loginPath}?returnTo=${encodeURIComponent(safePath)}`;
}

function navigateInApp(to, { replace = false } = {}) {
  const nextUrl = new globalThis.URL(to, window.location.origin);
  if (nextUrl.origin !== window.location.origin) {
    window.location.assign(nextUrl.href);
    return;
  }
  const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextPath !== currentPath) {
    window.history[replace ? "replaceState" : "pushState"]({}, "", nextPath);
  }
  window.dispatchEvent(new globalThis.CustomEvent("loohar:navigate", { detail: { path: nextUrl.pathname } }));
}

function requiresPasswordChange(user) {
  return Boolean(user?.forcePasswordChange || user?.temporaryPassword);
}

function passwordIssues(value) {
  return strongPasswordChecks.filter((check) => !check.test(value)).map((check) => check.label);
}

function validateImageFile(file, { accept = imageAccept, label = "image" } = {}) {
  if (!file) return "Select an image file.";
  if (!accept.split(",").includes(mimeTypeForFile(file))) {
    return label === "logo" ? "Use PNG, JPG, JPEG, WEBP, or SVG." : "Use PNG, JPG, JPEG, or WEBP.";
  }
  if (file.size > maxImageBytes) return "Image must be 5MB or smaller.";
  return "";
}

function mimeTypeForFile(file) {
  if (file?.type && imageAccept.split(",").includes(file.type)) return file.type === "image/jpg" ? "image/jpeg" : file.type;
  const extension = String(file?.name || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return imageMimeByExtension[extension] || "";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read selected image file."));
    reader.readAsDataURL(file);
  });
}

function base64FromDataUrl(dataUrl = "") {
  const commaIndex = dataUrl.indexOf(",");
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
}

function isOrderingBusiness(businessType) {
  return ["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK"].includes(businessType || "RESTAURANT");
}

function kdsStatusFor(status) {
  if (status === "PENDING") return "NEW";
  if (["ACCEPTED", "PREPARING", "READY"].includes(status)) return status;
  if (["PICKED_UP", "ON_THE_WAY", "DELIVERED"].includes(status)) return "COMPLETED";
  return status || "NEW";
}

function elapsedLabel(seconds = 0) {
  const mins = Math.floor((seconds || 0) / 60);
  const secs = Math.floor((seconds || 0) % 60);
  return mins > 0 ? `${mins}m ${secs.toString().padStart(2, "0")}s` : `${secs}s`;
}

function StatusPill({ children, tone = "neutral" }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-700",
    good: "bg-emerald-100 text-emerald-700",
    warn: "bg-amber-100 text-amber-800",
    bad: "bg-rose-100 text-rose-700"
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

function Stat({ icon: Icon, label, value, detail }) {
  return (
    <div className="panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-ink">{value}</p>
          {detail ? <p className="mt-1 text-sm text-slate-500">{detail}</p> : null}
        </div>
        <div className="grid h-11 w-11 place-items-center rounded-md bg-mint/10 text-mint">
          <Icon size={22} />
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ eyebrow, title, action, icon: Icon = LayoutDashboard }) {
  return (
    <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-end">
      <div>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-mint"><Icon size={15} />{eyebrow}</p>
        <h2 className="mt-1 text-2xl font-bold text-ink">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="empty-state">
      <p className="font-bold text-ink">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
    </div>
  );
}

function MetricBarList({ title, description, rows = [], valueKey = "value", labelKey = "label", valueFormatter = (value) => integer(value), emptyTitle = "No data yet" }) {
  const max = metricMax(rows, valueKey);
  return (
    <div className="metric-bar-card">
      <div className="metric-bar-card-head">
        <h4>{title}</h4>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="metric-bar-list">
        {rows.length === 0 ? (
          <EmptyState title={emptyTitle} detail="Live records will appear here once activity is available." />
        ) : rows.map((row, index) => {
          const label = row[labelKey] || row.label || row.name || row.date || `Row ${index + 1}`;
          const value = Number(row[valueKey] ?? row.value ?? 0);
          return (
            <div className="metric-bar-row" key={`${label}-${index}`}>
              <div className="metric-bar-row-head">
                <span>{label}</span>
                <strong>{valueFormatter(value, row)}</strong>
              </div>
              <div className="metric-bar-track" aria-hidden="true">
                <span style={{ width: chartValuePercent(value, max) }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InlineError({ message }) {
  return message ? <div className="error-box">{message}</div> : null;
}

function UpgradeRequired({ feature, lock = {} }) {
  const label = lock.featureLabel || featureLabels[feature] || readable(feature);
  const requiredPlan = lock.requiredPlan || featureRequiredPlans[feature] || "PROFESSIONAL";
  const currentPlan = lock.currentPlan || "STARTER";
  const status = lock.subscriptionStatus;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-bold text-amber-950">Upgrade Required</p>
          <p className="mt-1">{label} is included in {readable(requiredPlan)} and above.</p>
          <p className="mt-1 text-xs font-semibold text-amber-800">Current plan: {readable(currentPlan)}{status ? ` - ${readable(status)}` : ""}</p>
        </div>
        <a className="button-muted justify-center bg-white" href="/restaurant/onboarding#billing">View plans</a>
      </div>
    </div>
  );
}

function dietaryBadges(item = {}) {
  return [
    item.isGlutenFree ? "Gluten Free" : null,
    item.isVegetarian ? "Vegetarian" : null,
    item.isVegan ? "Vegan" : null,
    item.isSpicy ? "Spicy" : null,
    item.isDairyFree ? "Dairy Free" : null,
    item.isNutFree ? "Nut Free" : null
  ].filter(Boolean);
}

function websitePathParts() {
  const hostRoute = tenantHostRouteInfo();
  if (hostRoute.isTenantHost) {
    const [, page = "home"] = window.location.pathname.split("/");
    return { slug: hostRoute.slug || "", page: page || "home", byHost: true, host: hostRoute.host, legacy: false };
  }
  const [, root, maybeSlug, maybePage = "home"] = window.location.pathname.split("/");
  if (root === "sites") return { slug: maybeSlug || "", page: maybePage, byHost: false, host: "", legacy: true };
  const slugValidation = validatePublicSlug(root || "");
  if (!slugValidation.ok) return null;
  return { slug: slugValidation.slug, page: maybeSlug || "home", byHost: false, host: "", legacy: false };
}

function normalizeBrowserHost(value = window.location.hostname) {
  return String(value || "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

function tenantHostRouteInfo() {
  const host = normalizeBrowserHost();
  if (host.endsWith(".vercel.app")) return { isTenantHost: false, host, slug: "" };
  if (!host || reservedTenantHosts.has(host) || host.endsWith(".local") || host === "0.0.0.0") return { isTenantHost: false, host, slug: "" };
  if (host.endsWith(`.${tenantRootDomain}`)) {
    const slug = host.slice(0, -(tenantRootDomain.length + 1)).split(".").pop();
    return { isTenantHost: Boolean(slug), host, slug };
  }
  if (import.meta.env.DEV && host.endsWith(".localhost")) {
    return { isTenantHost: true, host, slug: host.replace(/\.localhost$/, "") };
  }
  return { isTenantHost: true, host, slug: "" };
}

function routeBaseForPublicSite(route, slug) {
  if (route?.byHost) return "";
  return `/${slug}`;
}

function publicSiteHref(route, slug, target = "home") {
  const base = routeBaseForPublicSite(route, slug);
  if (target === "home") return base || "/";
  return `${base}/${target}`;
}

function defaultTenantUrlFor(profile = {}, domain = {}) {
  if (domain.defaultUrl) return domain.defaultUrl;
  return `https://${appDomain}/${profile.slug || domain.defaultSubdomain || "restaurant"}`;
}

function canonicalTenantUrlFor(profile = {}, domain = {}) {
  if (domain.canonicalUrl) return domain.canonicalUrl;
  if (domain.customDomain && ["VERIFIED", "SSL_PENDING", "ACTIVE"].includes(domain.domainStatus)) return `https://${domain.customDomain}`;
  return defaultTenantUrlFor(profile, domain);
}

function publicPathForSlug(slug, target = "home") {
  const safeSlug = slug || "restaurant";
  return target === "home" ? `/${safeSlug}` : `/${safeSlug}/${target}`;
}

function isPathBasedPublicRestaurantPath(path = window.location.pathname) {
  const [first] = path.split("/").filter(Boolean);
  return Boolean(validatePublicSlug(first || "").ok);
}

function isValidImageUrl(value) {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  return Boolean(trimmed) && (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("data:image/") || trimmed.startsWith("blob:"));
}

function resolveImage(liveImage, fallbackImage, defaultImage = defaultLooharImage) {
  if (isValidImageUrl(liveImage)) return liveImage.trim();
  if (isValidImageUrl(fallbackImage)) return fallbackImage.trim();
  return defaultImage;
}

function publicSocialLinks(links = []) {
  return links.filter((link) => link?.url && link.enabled !== false && /^https:\/\//i.test(link.url) && socialPlatformLabels[link.platform]);
}

function PublicSocialLinks({ links = [] }) {
  const visibleLinks = publicSocialLinks(links);
  if (visibleLinks.length === 0) return null;
  return (
    <div className="site-social-links" aria-label="Restaurant social links">
      {visibleLinks.map((link) => (
        <a className="site-social-link" href={link.url} target="_blank" rel="noreferrer" aria-label={socialPlatformLabels[link.platform]} key={link.id || link.platform}>
          <span aria-hidden="true">{socialPlatformMarks[link.platform]}</span>
        </a>
      ))}
    </div>
  );
}

function findFallbackByIdentity(items = [], source = {}, index = 0) {
  return items.find((item) => item.id === source.id || item.name === source.name) || items[index] || {};
}

function publicRestaurantName(profile = {}) {
  return profile.businessName || profile.publicBusinessName || profile.name || "Restaurant";
}

function defaultPublicWebsiteFields(restaurant = {}) {
  const name = publicRestaurantName(restaurant);
  const cuisineType = restaurant.businessType ? readable(restaurant.businessType) : "Restaurant";
  return {
    websiteEnabled: true,
    heroTitle: name,
    heroSubtitle: restaurant.description || `Order directly from ${name}.`,
    tagline: cuisineType,
    cuisineType,
    heroImageUrl: resolveImage(restaurant.brandingJson?.bannerImageUrl, restaurant.logoUrl, defaultLooharImage),
    logoUrl: resolveImage(restaurant.logoUrl, restaurant.brandingJson?.bannerImageUrl, defaultLooharImage),
    brandColor: restaurant.brandingJson?.primaryColor || "#111827",
    accentColor: restaurant.brandingJson?.accentColor || "#f59e0b",
    headingFont: "inherit",
    bodyFont: "inherit",
    sectionSettingsJson: websiteSectionDefaults,
    aboutTitle: `About ${name}`,
    aboutStory: restaurant.description || `${name} is preparing its restaurant story. Please check back soon.`,
    missionStatement: "Serve guests directly with simple pickup, delivery, loyalty, and restaurant-owned ordering.",
    ownerStory: "This restaurant is setting up its direct ordering website.",
    specialOfferText: "Order direct for restaurant-owned rewards.",
    ctaText: "Start an order",
    contactMessage: "Call or email the restaurant for questions, private events, and order help.",
    cateringMessage: "Tell us your event date, guest count, and menu preferences.",
    publicEmail: restaurant.email || "",
    buttonColor: restaurant.brandingJson?.buttonColor || restaurant.brandingJson?.primaryColor || "#111827",
    mobileHeroImageUrl: resolveImage(restaurant.brandingJson?.mobileBannerImageUrl, restaurant.brandingJson?.bannerImageUrl, defaultLooharImage),
    faviconUrl: resolveImage(restaurant.logoUrl, restaurant.brandingJson?.bannerImageUrl, defaultLooharImage),
    ogImageUrl: resolveImage(restaurant.brandingJson?.bannerImageUrl, restaurant.logoUrl, defaultLooharImage),
    seoTitle: `${name} | Direct Online Ordering`,
    seoDescription: restaurant.description || `Order pickup or delivery directly from ${name}.`
  };
}

function withSafePublicImages(liveBundle, fallbackBundle = null) {
  const live = liveBundle || {};
  const usingDemoFallback = Boolean(fallbackBundle);
  const fallback = fallbackBundle || {};
  const liveRestaurant = live.restaurant || live.tenant || {};
  const fallbackRestaurant = usingDemoFallback ? fallback.restaurant || demoRestaurant : {};
  const baseRestaurant = usingDemoFallback ? { ...fallbackRestaurant, ...liveRestaurant } : { ...liveRestaurant };
  const liveWebsite = live.website || live.websiteSettings || {};
  const fallbackWebsite = usingDemoFallback ? fallback.website || demoWebsiteSettings : {};
  const defaultWebsite = defaultPublicWebsiteFields(baseRestaurant);
  const liveGallery = Array.isArray(live.gallery) ? live.gallery : [];
  const fallbackGallery = usingDemoFallback && Array.isArray(fallback.gallery) && fallback.gallery.length ? fallback.gallery : [];
  const heroImageUrl = resolveImage(liveWebsite.heroImageUrl, fallbackWebsite.heroImageUrl, defaultWebsite.heroImageUrl);
  const mobileHeroImageUrl = resolveImage(liveWebsite.mobileHeroImageUrl, fallbackWebsite.mobileHeroImageUrl, heroImageUrl);
  const logoUrl = resolveImage(liveWebsite.logoUrl || liveRestaurant.logoUrl, fallbackWebsite.logoUrl || fallbackRestaurant.logoUrl, heroImageUrl);
  const faviconUrl = resolveImage(liveWebsite.faviconUrl, fallbackWebsite.faviconUrl, logoUrl);
  const ogImageUrl = resolveImage(liveWebsite.ogImageUrl, fallbackWebsite.ogImageUrl, heroImageUrl);
  const website = {
    ...defaultWebsite,
    ...(usingDemoFallback ? fallbackWebsite : {}),
    ...liveWebsite,
    heroImageUrl,
    mobileHeroImageUrl,
    logoUrl,
    faviconUrl,
    ogImageUrl,
    brandColor: liveWebsite.brandColor || fallbackWebsite.brandColor || defaultWebsite.brandColor,
    accentColor: liveWebsite.accentColor || fallbackWebsite.accentColor || defaultWebsite.accentColor,
    buttonColor: liveWebsite.buttonColor || fallbackWebsite.buttonColor || liveWebsite.brandColor || fallbackWebsite.brandColor || defaultWebsite.buttonColor,
    ctaText: liveWebsite.ctaText || fallbackWebsite.ctaText || defaultWebsite.ctaText,
    contactMessage: liveWebsite.contactMessage || fallbackWebsite.contactMessage || defaultWebsite.contactMessage,
    cateringMessage: liveWebsite.cateringMessage || fallbackWebsite.cateringMessage || defaultWebsite.cateringMessage,
    publicEmail: liveWebsite.publicEmail || fallbackWebsite.publicEmail || baseRestaurant.email || defaultWebsite.publicEmail,
    sectionSettingsJson: { ...websiteSectionDefaults, ...(fallbackWebsite.sectionSettingsJson || {}), ...(liveWebsite.sectionSettingsJson || {}) }
  };
  const sourceGallery = (liveGallery.length ? liveGallery : usingDemoFallback ? fallbackGallery : []).filter((image) => image?.published !== false);
  const gallery = sourceGallery.map((image, index) => {
    const fallbackImage = usingDemoFallback ? fallbackGallery[index] || fallbackGallery[0] || {} : {};
    return {
      ...(usingDemoFallback ? fallbackImage : {}),
      ...image,
      id: image.id || fallbackImage.id || `gallery-${index}`,
      altText: image.altText || fallbackImage.altText || `${publicRestaurantName(baseRestaurant)} photo`,
      imageUrl: resolveImage(image.imageUrl, fallbackImage.imageUrl, defaultLooharImage)
    };
  });
  const fallbackCategories = usingDemoFallback && Array.isArray(fallbackRestaurant.categories) ? fallbackRestaurant.categories : [];
  const liveCategories = Array.isArray(liveRestaurant.categories) ? liveRestaurant.categories : [];
  const sourceCategories = liveCategories.length ? liveCategories : usingDemoFallback ? fallbackCategories : [];
  const categories = sourceCategories.map((category, categoryIndex) => {
    const fallbackCategory = usingDemoFallback ? findFallbackByIdentity(fallbackCategories, category, categoryIndex) : {};
    const sourceItems = Array.isArray(category.items) ? category.items : [];
    const fallbackItems = Array.isArray(fallbackCategory.items) ? fallbackCategory.items : [];
    const items = sourceItems.map((item, itemIndex) => {
      const fallbackItem = usingDemoFallback ? findFallbackByIdentity(fallbackItems, item, itemIndex) : {};
      return {
        ...(usingDemoFallback ? fallbackItem : {}),
        ...item,
        imageUrl: resolveImage(item.imageUrl, fallbackItem.imageUrl, defaultLooharImage)
      };
    });
    return { ...(usingDemoFallback ? fallbackCategory : {}), ...category, items };
  });
  const restaurant = {
    ...(usingDemoFallback ? fallbackRestaurant : {}),
    ...liveRestaurant,
    name: liveRestaurant.name || liveRestaurant.businessName || fallbackRestaurant.name || "Restaurant",
    businessName: liveRestaurant.businessName || liveRestaurant.publicBusinessName || liveRestaurant.name || fallbackRestaurant.businessName || fallbackRestaurant.name || "Restaurant",
    logoUrl,
    categories
  };
  return {
    ...(usingDemoFallback ? fallback : {}),
    ...live,
    restaurant,
    tenant: { ...(live.tenant || restaurant), categories },
    website,
    websiteSettings: website,
    gallery,
    socialLinks: publicSocialLinks(Array.isArray(live.socialLinks) ? live.socialLinks : usingDemoFallback && Array.isArray(fallback.socialLinks) ? fallback.socialLinks : []),
    featuredItems: Array.isArray(live.featuredItems) ? live.featuredItems : categories.flatMap((category) => category.items || []).filter((item) => item.featured || item.recommended).slice(0, 8),
    seo: {
      ...(usingDemoFallback ? fallback.seo || {} : {}),
      ...(live.seo || {}),
      openGraphImage: resolveImage(live.seo?.openGraphImage, fallback.seo?.openGraphImage, heroImageUrl)
    }
  };
}

function logPublicSiteDebug(slug, bundle) {
  if (!import.meta.env.DEV) return;
  const featuredItems = (bundle.restaurant?.categories || [])
    .flatMap((category) => category.items || [])
    .filter((item) => item.featured || item.recommended);
  globalThis.console?.info("[Loohar public site]", {
    slug,
    loadedWebsiteData: bundle.website,
    heroImageUrl: bundle.website?.heroImageUrl,
    logoUrl: bundle.website?.logoUrl,
    galleryImageCount: (bundle.gallery || []).filter((image) => isValidImageUrl(image.imageUrl)).length,
    featuredItemImageCount: featuredItems.filter((item) => isValidImageUrl(item.imageUrl)).length
  });
}

function handleSafeImageError(event) {
  if (event.currentTarget.src !== defaultLooharImage) {
    event.currentTarget.src = defaultLooharImage;
  }
}

function fullRestaurantAddress(restaurant = {}) {
  return [restaurant.address, restaurant.city, restaurant.state, restaurant.zip].filter(Boolean).join(", ");
}

function googleMapEmbedUrl(address = "") {
  return address ? `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed` : "";
}

function googleDirectionsUrl(address = "") {
  return address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : "";
}

function setMetaTag(selector, attributes) {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement("meta");
    Object.entries(attributes.identity || {}).forEach(([key, value]) => element.setAttribute(key, value));
    document.head.appendChild(element);
  }
  Object.entries(attributes.values || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  });
}

function setLinkTag(rel, href) {
  if (!href) return;
  let element = document.head.querySelector(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", rel);
    document.head.appendChild(element);
  }
  element.setAttribute("href", href);
}

function setRobots(indexable) {
  setMetaTag('meta[name="robots"]', {
    identity: { name: "robots" },
    values: { content: indexable ? "index,follow" : "noindex,nofollow" }
  });
}

function applyHomepageSeo() {
  const title = "Loohar | Restaurant Websites, Direct Ordering and Delivery SaaS";
  const description = "Loohar helps restaurants launch branded websites, accept direct online orders, manage pickup and delivery, run loyalty programs, and reduce marketplace dependency.";
  const canonicalUrl = "https://loohar.com/";
  const image = `${canonicalUrl}marketing/loohar-restaurant-hero.png`;
  document.title = title;
  setMetaTag('meta[name="description"]', { identity: { name: "description" }, values: { content: description } });
  setMetaTag('meta[property="og:title"]', { identity: { property: "og:title" }, values: { content: title } });
  setMetaTag('meta[property="og:description"]', { identity: { property: "og:description" }, values: { content: description } });
  setMetaTag('meta[property="og:image"]', { identity: { property: "og:image" }, values: { content: image } });
  setMetaTag('meta[property="og:url"]', { identity: { property: "og:url" }, values: { content: canonicalUrl } });
  setMetaTag('meta[property="og:type"]', { identity: { property: "og:type" }, values: { content: "website" } });
  setMetaTag('meta[name="twitter:card"]', { identity: { name: "twitter:card" }, values: { content: "summary_large_image" } });
  setMetaTag('meta[name="twitter:title"]', { identity: { name: "twitter:title" }, values: { content: title } });
  setMetaTag('meta[name="twitter:description"]', { identity: { name: "twitter:description" }, values: { content: description } });
  setMetaTag('meta[name="twitter:image"]', { identity: { name: "twitter:image" }, values: { content: image } });
  setLinkTag("canonical", canonicalUrl);
  setRobots(true);

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://loohar.com/#organization",
        name: "Loohar",
        url: "https://loohar.com/",
        logo: "https://loohar.com/marketing/loohar-mark.svg",
        contactPoint: {
          "@type": "ContactPoint",
          email: "support@loohar.com",
          contactType: "customer support"
        }
      },
      {
        "@type": "SoftwareApplication",
        "@id": "https://loohar.com/#software",
        name: "Loohar",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description
      },
      {
        "@type": "WebSite",
        "@id": "https://loohar.com/#website",
        name: "Loohar",
        url: "https://loohar.com/",
        publisher: { "@id": "https://loohar.com/#organization" }
      }
    ]
  };
  let script = document.head.querySelector("#loohar-homepage-jsonld");
  if (!script) {
    script = document.createElement("script");
    script.id = "loohar-homepage-jsonld";
    script.type = "application/ld+json";
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(schema);
}

function applyMarketingSeo({ title, description, path = "/" }) {
  const canonicalUrl = `https://loohar.com${path}`;
  const image = "https://loohar.com/marketing/loohar-restaurant-hero.png";
  document.title = title;
  setMetaTag('meta[name="description"]', { identity: { name: "description" }, values: { content: description } });
  setMetaTag('meta[property="og:title"]', { identity: { property: "og:title" }, values: { content: title } });
  setMetaTag('meta[property="og:description"]', { identity: { property: "og:description" }, values: { content: description } });
  setMetaTag('meta[property="og:image"]', { identity: { property: "og:image" }, values: { content: image } });
  setMetaTag('meta[property="og:url"]', { identity: { property: "og:url" }, values: { content: canonicalUrl } });
  setMetaTag('meta[property="og:type"]', { identity: { property: "og:type" }, values: { content: "website" } });
  setMetaTag('meta[name="twitter:card"]', { identity: { name: "twitter:card" }, values: { content: "summary_large_image" } });
  setMetaTag('meta[name="twitter:title"]', { identity: { name: "twitter:title" }, values: { content: title } });
  setMetaTag('meta[name="twitter:description"]', { identity: { name: "twitter:description" }, values: { content: description } });
  setMetaTag('meta[name="twitter:image"]', { identity: { name: "twitter:image" }, values: { content: image } });
  setLinkTag("canonical", canonicalUrl);
  setRobots(true);
}

function applyFeatureSchema(feature) {
  if (!feature) return;
  const canonicalUrl = `https://loohar.com${feature.href}`;
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${canonicalUrl}#webpage`,
        name: `${feature.title} | Loohar`,
        url: canonicalUrl,
        description: feature.description,
        isPartOf: { "@id": "https://loohar.com/#website" }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: "https://loohar.com/"
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Features",
            item: "https://loohar.com/features"
          },
          {
            "@type": "ListItem",
            position: 3,
            name: feature.title,
            item: canonicalUrl
          }
        ]
      },
      {
        "@type": "Service",
        name: `Loohar ${feature.title}`,
        serviceType: "Restaurant SaaS",
        provider: {
          "@type": "Organization",
          name: "Loohar",
          url: "https://loohar.com/"
        },
        description: feature.description
      }
    ]
  };
  let script = document.head.querySelector("#loohar-feature-jsonld");
  if (!script) {
    script = document.createElement("script");
    script.id = "loohar-feature-jsonld";
    script.type = "application/ld+json";
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(schema);
}

function applyPublicSeo(bundle, page = "home") {
  if (!bundle) return;
  const restaurant = bundle.restaurant || {};
  const website = bundle.website || {};
  const name = restaurant.businessName || restaurant.name || "Restaurant";
  const canonicalUrl = bundle.seo?.canonicalUrl || `${window.location.origin}${publicPathForSlug(restaurant.slug || "", page)}`;
  const title = bundle.seo?.title || website.seoTitle || `${name} | Direct Online Ordering`;
  const description = bundle.seo?.description || website.seoDescription || website.heroSubtitle || restaurant.description || `Order pickup or delivery directly from ${name}.`;
  const image = resolveImage(bundle.seo?.openGraphImage || bundle.seo?.twitterImage, website.heroImageUrl || restaurant.logoUrl);
  document.title = page === "home" ? title : `${readable(page)} | ${title}`;
  setMetaTag('meta[name="description"]', { identity: { name: "description" }, values: { content: description } });
  setMetaTag('meta[property="og:title"]', { identity: { property: "og:title" }, values: { content: bundle.seo?.openGraphTitle || title } });
  setMetaTag('meta[property="og:description"]', { identity: { property: "og:description" }, values: { content: bundle.seo?.openGraphDescription || description } });
  setMetaTag('meta[property="og:image"]', { identity: { property: "og:image" }, values: { content: image } });
  setMetaTag('meta[property="og:url"]', { identity: { property: "og:url" }, values: { content: canonicalUrl } });
  setMetaTag('meta[property="og:type"]', { identity: { property: "og:type" }, values: { content: "restaurant" } });
  setMetaTag('meta[name="twitter:card"]', { identity: { name: "twitter:card" }, values: { content: bundle.seo?.twitterCard || "summary_large_image" } });
  setMetaTag('meta[name="twitter:title"]', { identity: { name: "twitter:title" }, values: { content: bundle.seo?.twitterTitle || title } });
  setMetaTag('meta[name="twitter:description"]', { identity: { name: "twitter:description" }, values: { content: bundle.seo?.twitterDescription || description } });
  setMetaTag('meta[name="twitter:image"]', { identity: { name: "twitter:image" }, values: { content: image } });
  setLinkTag("canonical", canonicalUrl);
  setRobots(website.indexingEnabled !== false);
  const jsonLd = bundle.jsonLd || bundle.seo?.schemaPlaceholder;
  if (jsonLd) {
    let script = document.head.querySelector("#loohar-public-jsonld");
    if (!script) {
      script = document.createElement("script");
      script.id = "loohar-public-jsonld";
      script.type = "application/ld+json";
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(jsonLd);
  }
}

function PublicSiteSkeleton({ premium = false }) {
  return (
    <div className={`site-shell ${premium ? "premium" : ""}`}>
      <header className={`site-header ${premium ? "premium" : ""}`}>
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 animate-pulse rounded-md bg-slate-200" />
          <div>
            <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
            <div className="mt-2 h-3 w-28 animate-pulse rounded bg-slate-200" />
          </div>
        </div>
        <div className="hidden gap-2 md:flex">
          {[0, 1, 2, 3].map((item) => <div className="h-10 w-24 animate-pulse rounded-md bg-slate-200" key={item} />)}
        </div>
      </header>
      <section className={premium ? "lux-hero" : "site-hero"}>
        <div className="max-w-xl">
          <div className="h-4 w-32 animate-pulse rounded bg-white/35" />
          <div className="mt-5 h-12 w-full animate-pulse rounded bg-white/35" />
          <div className="mt-3 h-12 w-3/4 animate-pulse rounded bg-white/30" />
          <div className="mt-6 h-5 w-5/6 animate-pulse rounded bg-white/25" />
          <div className="mt-3 h-5 w-2/3 animate-pulse rounded bg-white/25" />
        </div>
      </section>
      <section className="lux-card-grid mt-6">
        {[0, 1, 2, 3].map((item) => <div className="h-72 animate-pulse rounded-md bg-white shadow-soft" key={item} />)}
      </section>
    </div>
  );
}

function PublicRestaurantSite({ apiOnline }) {
  const route = websitePathParts();
  const slug = route?.slug || "";
  const page = route?.page || "home";
  const [bundle, setBundle] = useState(() => !apiOnline && slug ? withSafePublicImages(demoWebsiteBundle(slug), demoWebsiteBundle(slug)) : null);
  const [loading, setLoading] = useState(apiOnline);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!route || (!route.byHost && !slug)) {
      setBundle(null);
      setLoading(false);
      setError("Restaurant website not found.");
      return;
    }
    if (!apiOnline) {
      const fallbackBundle = demoWebsiteBundle(slug || "demo-bistro");
      setLoading(false);
      setBundle(withSafePublicImages(fallbackBundle, fallbackBundle));
      return;
    }
    setLoading(true);
    setError("");
    setBundle(null);
    const endpoint = route?.byHost ? `/api/public/site-by-host?host=${encodeURIComponent(route.host)}` : `/api/public/restaurants/${slug}`;
    api(endpoint)
      .then((payload) => {
        const safeBundle = withSafePublicImages(payload);
        setBundle(safeBundle);
        logPublicSiteDebug(slug, safeBundle);
      })
      .catch((loadError) => {
        setBundle(null);
        setError(loadError.message);
      })
      .finally(() => setLoading(false));
  }, [apiOnline, slug, route?.byHost, route?.host]);

  useEffect(() => {
    if (!bundle) return;
    applyPublicSeo(bundle, page);
  }, [bundle, page]);

  if (loading && !bundle) return <PublicSiteSkeleton />;
  if (!bundle) return <div className="site-shell"><InlineError message={error || "This restaurant website could not be loaded."} /></div>;

  const restaurant = bundle.restaurant || {};
  const website = bundle.website || defaultPublicWebsiteFields(restaurant);
  const gallery = Array.isArray(bundle.gallery) ? bundle.gallery : [];
  const socialLinks = Array.isArray(bundle.socialLinks) ? bundle.socialLinks : [];
  const categories = (restaurant.categories || []).filter((category) => (category.items || []).length > 0);
  const featuredItems = categories.flatMap((category) => category.items || []).filter((item) => item.featured || item.recommended).slice(0, 4);
  const currentSlug = restaurant.slug || slug;
  const routeBase = routeBaseForPublicSite(route, currentSlug);
  const heroImage = resolveImage(website.heroImageUrl, website.mobileHeroImageUrl, defaultLooharImage);
  const logoImage = resolveImage(website.logoUrl, heroImage, heroImage);
  const sectionSettings = { ...websiteSectionDefaults, ...(website.sectionSettingsJson || {}) };
  const siteStyle = { "--brand": website.brandColor, "--accent": website.accentColor, "--heading-font": website.headingFont || "inherit", "--body-font": website.bodyFont || "inherit" };

  function navLink(target, label) {
    return <a className={page === target ? "site-nav active" : "site-nav"} href={publicSiteHref(route, currentSlug, target)}>{label}</a>;
  }

  function sectionIsVisible(section) {
    return sectionSettings[section] !== false;
  }

  return (
    <div className="site-shell" style={siteStyle}>
      <InlineError message={error} />
      <header className="site-header">
        <div>
          <img className="site-logo-img" src={logoImage} alt={`${restaurant.businessName || restaurant.name} logo`} onError={handleSafeImageError} />
          <h1>{restaurant.businessName || restaurant.name}</h1>
          <p>{website.heroSubtitle || restaurant.description}</p>
        </div>
        <nav className="site-navs">
          {navLink("home", "Home")}
          {navLink("menu", "Menu")}
          {navLink("order", "Order Online")}
          {navLink("about", "About")}
          {sectionIsVisible("gallery") ? navLink("gallery", "Gallery") : null}
          {sectionIsVisible("loyalty") ? navLink("loyalty", "Loyalty") : null}
          {sectionIsVisible("catering") ? navLink("catering", "Catering") : null}
          {sectionIsVisible("contact") ? navLink("contact", "Contact") : null}
        </nav>
      </header>

      {page === "home" ? (
        <>
          {sectionSettings.hero ? <section className="site-hero">
            <div>
              <StatusPill tone="good">{restaurant.pickupEnabled ? "Pickup" : "Pickup off"}</StatusPill>
              <StatusPill tone={restaurant.deliveryEnabled ? "good" : "neutral"}>{restaurant.deliveryEnabled ? "Delivery" : "Delivery off"}</StatusPill>
              <h2>{website.heroTitle || restaurant.name}</h2>
              <p>{website.heroSubtitle || restaurant.description}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <a className="button-primary" href={`${routeBase}/order`}><CreditCard size={18} />Order Online</a>
                <a className="button-muted" href={`tel:${restaurant.phone || ""}`}>Call {restaurant.phone || "Restaurant"}</a>
              </div>
            </div>
            <div className="site-image"><img src={heroImage} alt={`${restaurant.businessName || restaurant.name} hero`} onError={handleSafeImageError} /></div>
          </section> : null}
          <section className="site-grid">
            {sectionSettings.featuredMenu ? <div className="site-card"><h3>Featured menu</h3>{featuredItems.length === 0 ? <p>Menu items are being added. Please check back soon.</p> : featuredItems.map((item) => <div className="summary-line" key={item.id}><span>{item.name}</span><strong>{money(item.priceCents)}</strong></div>)}</div> : null}
            <div className="site-card"><h3>Special offer</h3><p>{website.specialOfferText || "Order direct for loyalty rewards."}</p></div>
            {sectionSettings.contact ? <div className="site-card"><h3>Visit us</h3><p>{restaurant.address}</p><p>{restaurant.phone}</p><p>{Object.entries(restaurant.storeHoursJson || {}).slice(0, 3).map(([day, hours]) => `${readable(day)} ${hours}`).join(" / ") || "Call for current hours"}</p></div> : null}
          </section>
        </>
      ) : null}

      {page === "menu" ? (
        <section className="site-card">
          <h2>Menu</h2>
          {categories.length === 0 ? <EmptyState title="Menu coming soon" detail="Menu items are being added. Please check back soon." /> : categories.map((category) => (
            <div className="mt-5" key={category.id}>
              <h3>{category.name}</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {(category.items || []).map((item) => <div className="food-card" key={item.id}>{item.imageUrl ? <img className="order-card-img" src={resolveImage(item.imageUrl, "", defaultLooharImage)} alt={item.name} loading="lazy" onError={handleSafeImageError} /> : null}<div><p className="font-bold text-ink">{item.name}</p><p className="text-sm text-slate-500">{item.description}</p><p className="mt-2 text-sm">{item.available === false ? "Unavailable" : "Available"} {item.featured ? "- Featured" : ""} {item.recommended ? "- Recommended" : ""}</p><p className="mt-2 text-xs font-bold uppercase text-slate-400">{item.preparationTimeMins || 15} min</p></div><a className="button-primary h-fit" href={`${routeBase}/order`}>{money(item.priceCents)}</a></div>)}
              </div>
            </div>
          ))}
        </section>
      ) : null}
      {page === "order" ? <section className="lux-section"><div className="lux-section-head"><p>Order Online</p><h2>Pickup and delivery from {restaurant.businessName || restaurant.name}</h2><a href={`${routeBase}/menu`}>View menu</a></div><CustomerApp apiOnline={apiOnline} initialSlug={currentSlug} embedded /></section> : null}

      {page === "about" ? <section className="site-card"><h2>{website.aboutTitle}</h2><p>{website.aboutStory}</p><h3>Mission</h3><p>{website.missionStatement}</p><h3>Owner / chef story</h3><p>{website.ownerStory}</p><div className="site-image mt-4"><img src={resolveImage(heroImage, "", defaultLooharImage)} alt={`${restaurant.businessName || restaurant.name} story`} onError={handleSafeImageError} /></div></section> : null}
      {page === "contact" && sectionIsVisible("contact") ? <section className="site-grid"><div className="site-card"><h2>Contact</h2><p>{fullRestaurantAddress(restaurant) || restaurant.address}</p><p>{restaurant.phone}</p><p>{restaurant.email}</p><p>{Object.entries(restaurant.storeHoursJson || {}).map(([day, hours]) => `${readable(day)}: ${hours}`).join(" / ") || "Call for current hours"}</p><PublicSocialLinks links={socialLinks} /></div><div className="site-card"><h3>Location</h3>{googleMapEmbedUrl(fullRestaurantAddress(restaurant)) ? <iframe className="map-frame" title={`${restaurant.name} map`} src={googleMapEmbedUrl(fullRestaurantAddress(restaurant))} loading="lazy" /> : <div className="map-card">{restaurant.address || "Address coming soon"}</div>}<div className="mt-4 flex flex-wrap gap-2"><a className="button-primary" href={googleDirectionsUrl(fullRestaurantAddress(restaurant))} target="_blank" rel="noreferrer"><MapPin size={16} />Directions</a><a className="button-muted" href={`tel:${restaurant.phone || ""}`}>Call</a><a className="button-muted" href={`mailto:${restaurant.email || ""}`}>Email</a></div><h3 className="mt-4">Questions</h3><p>Call or email the restaurant for event requests, order help, or catering details.</p></div></section> : null}
      {page === "gallery" && sectionIsVisible("gallery") ? <section className="site-card"><h2>Gallery</h2>{gallery.length === 0 ? <EmptyState title="Gallery coming soon" detail="This restaurant has not added gallery images yet." /> : <div className="mt-4 grid gap-3 md:grid-cols-3">{gallery.map((image) => <figure className="site-image" key={image.id}><img src={resolveImage(image.imageUrl, "", defaultLooharImage)} alt={image.altText || image.title || "Restaurant photo"} onError={handleSafeImageError} />{image.title || image.caption ? <figcaption>{image.title || image.altText}{image.caption ? ` / ${image.caption}` : ""}</figcaption> : null}</figure>)}</div>}</section> : null}
      {page === "loyalty" && sectionIsVisible("loyalty") ? <section className="site-card"><h2>Loyalty</h2><p>Earn {restaurant.loyaltySettingsJson?.pointsPerDollar || 1} point per dollar when ordering direct.</p><div className="mt-4 grid gap-3 md:grid-cols-2">{(restaurant.loyaltyRewards || bundle.restaurant?.loyaltyRewards || []).map((reward) => <div className="summary-line rounded-md bg-slate-50 px-3" key={reward.id}><span>{reward.name}</span><strong>{reward.pointsRequired} pts</strong></div>)}</div><a className="button-primary mt-4" href={`${routeBase}/order`}>Join at checkout</a></section> : null}
      {page === "catering" && sectionIsVisible("catering") ? <section className="site-card"><h2>Catering</h2><p>Bring restaurant favorites to your next event.</p><a className="button-primary mt-4" href={`mailto:${restaurant.email || ""}`}>Request catering</a><p className="mt-3 text-sm text-slate-500">Include event date, guest count, and menu preferences.</p></section> : null}
      {page === "careers" ? <section className="site-card"><h2>Careers</h2><p>We are always interested in great restaurant people.</p><a className="button-primary mt-4" href={`mailto:${restaurant.email || ""}`}>Contact hiring manager</a></section> : null}

      <footer className="site-footer">
        <span>{restaurant.businessName || restaurant.name}</span>
        <span>{restaurant.address}</span>
        <PublicSocialLinks links={socialLinks} />
        <span>Direct ordering powered by Loohar</span>
      </footer>
    </div>
  );
}

function PremiumRestaurantSite({ apiOnline }) {
  const route = websitePathParts();
  const slug = route?.slug || "";
  const page = route?.page || "home";
  const [bundle, setBundle] = useState(() => !apiOnline && slug ? withSafePublicImages(demoWebsiteBundle(slug), demoWebsiteBundle(slug)) : null);
  const [loading, setLoading] = useState(apiOnline);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!route || (!route.byHost && !slug)) {
      setBundle(null);
      setLoading(false);
      setError("Restaurant website not found.");
      return;
    }
    if (!apiOnline) {
      const fallbackBundle = demoWebsiteBundle(slug || "demo-bistro");
      setLoading(false);
      setBundle(withSafePublicImages(fallbackBundle, fallbackBundle));
      return;
    }
    setLoading(true);
    setError("");
    setBundle(null);
    const endpoint = route?.byHost ? `/api/public/site-by-host?host=${encodeURIComponent(route.host)}` : `/api/public/restaurants/${slug}`;
    api(endpoint)
      .then((payload) => {
        const safeBundle = withSafePublicImages(payload);
        setBundle(safeBundle);
        logPublicSiteDebug(slug, safeBundle);
      })
      .catch((loadError) => {
        setBundle(null);
        setError(loadError.message);
      })
      .finally(() => setLoading(false));
  }, [apiOnline, slug, route?.byHost, route?.host]);

  useEffect(() => {
    if (!bundle) return;
    applyPublicSeo(bundle, page);
  }, [bundle, page]);

  if (loading && !bundle) return <PublicSiteSkeleton premium />;
  if (!bundle) return <div className="site-shell premium"><InlineError message={error || "This restaurant website could not be loaded."} /></div>;

  const restaurant = bundle.restaurant || {};
  const website = bundle.website || defaultPublicWebsiteFields(restaurant);
  const gallery = Array.isArray(bundle.gallery) ? bundle.gallery : [];
  const socialLinks = Array.isArray(bundle.socialLinks) ? bundle.socialLinks : [];
  const categories = (restaurant.categories || []).filter((category) => (category.items || []).length > 0);
  const allItems = categories.flatMap((category) => category.items || []);
  const featuredItems = allItems.filter((itemRow) => itemRow.featured || itemRow.recommended).slice(0, 4);
  const rewards = restaurant.loyaltyRewards || bundle.restaurant?.loyaltyRewards || [];
  const currentSlug = restaurant.slug || slug;
  const routeBase = routeBaseForPublicSite(route, currentSlug);
  const hours = Object.entries(restaurant.storeHoursJson || {});
  const hoursPreview = hours.slice(0, 3).map(([day, value]) => `${readable(day)} ${value}`).join(" / ");
  const isLiquor = restaurant.businessType === "LIQUOR_STORE";
  const heroImage = resolveImage(website.heroImageUrl, website.mobileHeroImageUrl, defaultLooharImage);
  const logoImage = resolveImage(website.logoUrl, heroImage, heroImage);
  const publicEmail = website.publicEmail || restaurant.email || "";
  const address = bundle.contactInfo?.address || fullRestaurantAddress(restaurant);
  const mapSrc = bundle.location?.mapEmbedUrl || googleMapEmbedUrl(address);
  const directionsHref = bundle.location?.directionsUrl || googleDirectionsUrl(address);
  const sectionSettings = { ...websiteSectionDefaults, ...(website.sectionSettingsJson || {}) };
  const siteStyle = { "--brand": website.brandColor, "--accent": website.accentColor, "--button": website.buttonColor || website.brandColor, "--heading-font": website.headingFont || "inherit", "--body-font": website.bodyFont || "inherit" };

  function navLink(target, label) {
    return <a className={page === target ? "site-nav active" : "site-nav"} href={publicSiteHref(route, currentSlug, target)}>{label}</a>;
  }

  function sectionIsVisible(section) {
    return sectionSettings[section] !== false;
  }

  function MenuCard({ item: menuItem }) {
    const itemImage = resolveImage(menuItem.imageUrl, "", defaultLooharImage);
    return (
      <article className="lux-menu-card">
        <img src={itemImage} alt={menuItem.name} loading="lazy" onError={handleSafeImageError} />
        <div>
          <div className="flex flex-wrap gap-2">
            {menuItem.featured ? <span className="lux-badge">Featured</span> : null}
            {menuItem.recommended ? <span className="lux-badge muted">Recommended</span> : null}
            <span className={`lux-badge ${menuItem.available === false ? "unavailable" : "available"}`}>{menuItem.available === false ? "Unavailable" : "Available"}</span>
          </div>
          <h3>{menuItem.name}</h3>
          <p>{menuItem.description}</p>
          <div className="mt-3 flex flex-wrap gap-2">{dietaryBadges(menuItem).map((badge) => <span className="diet-badge" key={badge}>{badge}</span>)}</div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="font-black text-ink">{money(menuItem.priceCents)}</span>
            <span className="text-xs font-bold uppercase text-slate-400">{menuItem.preparationTimeMins || 15} min</span>
            <a className="button-primary" href={`${routeBase}/order`}>Add to order</a>
          </div>
        </div>
      </article>
    );
  }

  return (
    <div className="site-shell premium" style={siteStyle}>
      <InlineError message={error} />
      <header className="site-header premium">
        <a className="site-brand" href={publicSiteHref(route, currentSlug, "home")}>
          <img src={logoImage} alt={`${restaurant.name} logo`} onError={handleSafeImageError} />
          <div>
            <strong>{restaurant.businessName || restaurant.name}</strong>
            <span>{website.tagline || website.cuisineType || "Restaurant-owned ordering"}</span>
          </div>
        </a>
        <button className="site-menu-toggle" type="button" aria-label="Toggle restaurant navigation" aria-expanded={menuOpen} aria-controls="tenant-site-navigation" onClick={() => setMenuOpen((open) => !open)}>
          <MenuIcon size={18} aria-hidden="true" />
        </button>
        <nav id="tenant-site-navigation" className={`site-navs ${menuOpen ? "open" : ""}`}>
          {navLink("home", "Home")}
          {navLink("menu", "Menu")}
          {navLink("order", "Order Online")}
          {navLink("about", "About")}
          {sectionIsVisible("gallery") ? navLink("gallery", "Gallery") : null}
          {sectionIsVisible("loyalty") ? navLink("loyalty", "Loyalty") : null}
          {sectionIsVisible("catering") ? navLink("catering", "Catering") : null}
          {sectionIsVisible("contact") ? navLink("contact", "Contact") : null}
        </nav>
      </header>

      {page === "home" ? (
        <>
          {sectionSettings.hero ? <section className="lux-hero" style={heroImage ? { backgroundImage: `linear-gradient(90deg, rgba(8,18,16,.9), rgba(8,18,16,.48)), url(${heroImage})` } : undefined}>
            <div className="lux-hero-content">
              <p className="lux-kicker">{website.cuisineType || "Restaurant"} / {website.tagline || "Direct ordering"}</p>
              <h2>{website.heroTitle || restaurant.name}</h2>
              <p>{website.heroSubtitle || restaurant.description}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <a className="button-primary" href={`${routeBase}/order`}><CreditCard size={18} />{website.ctaText || "Order Online"}</a>
                <a className="button-muted" href={`${routeBase}/menu`}>View Menu</a>
                <a className="button-muted" href={`tel:${restaurant.phone || ""}`}>Call {restaurant.phone || "Restaurant"}</a>
              </div>
              <div className="lux-hero-meta">
                <span>{restaurant.deliveryEnabled ? "Delivery available" : "Pickup focused"}</span>
                <span>{restaurant.pickupEnabled ? "Pickup ready" : "Pickup unavailable"}</span>
                <span>{hoursPreview || "Open daily"}</span>
                {isLiquor ? <span>Age verification required</span> : null}
              </div>
            </div>
          </section> : null}
          {sectionSettings.featuredMenu ? <section className="lux-section">
            <div className="lux-section-head"><p>Featured dishes</p><h2>Kitchen favorites</h2><a href={`${routeBase}/menu`}>Explore full menu</a></div>
            {featuredItems.length === 0 ? <EmptyState title="Menu coming soon" detail="Menu items are being added. Please check back soon." /> : <div className="lux-card-grid">{featuredItems.map((menuItem) => <MenuCard item={menuItem} key={menuItem.id} />)}</div>}
          </section> : null}
          {sectionSettings.story ? <section className="lux-split">
            <img src={heroImage} alt={`${restaurant.name} story`} onError={handleSafeImageError} />
            <div>
              <p className="lux-kicker">About the restaurant</p>
              <h2>{website.aboutTitle}</h2>
              <p>{website.aboutStory}</p>
              <a className="button-primary mt-5" href={`${routeBase}/about`}>Read our story</a>
            </div>
          </section> : null}
          <section className="site-grid">
            <div className="site-card"><h3>Special offer</h3><p>{website.specialOfferText}</p><a className="button-primary mt-4" href={`${routeBase}/order`}>{website.ctaText || "Redeem online"}</a></div>
            <div className="site-card"><h3>Direct ordering</h3><p>Order from this restaurant-owned site for pickup, delivery, loyalty, and direct customer support.</p></div>
            {sectionSettings.contact ? <div className="site-card"><h3>Location & hours</h3><p>{restaurant.address}</p><p>{restaurant.phone}</p><p>{hoursPreview || "Hours available soon"}</p></div> : null}
          </section>
          {isLiquor ? <section className="site-card"><h3>Age verification and compliance</h3><p>{bundle.complianceNote || "Age verification and local delivery compliance are required for regulated items."}</p></section> : null}
          {sectionSettings.gallery && gallery.length ? <section className="lux-gallery-strip">{gallery.slice(0, 4).map((image) => <img src={resolveImage(image.imageUrl, "", defaultLooharImage)} alt={image.altText} key={image.id} loading="lazy" onError={handleSafeImageError} />)}</section> : null}
          <section className="lux-cta"><h2>Order direct from {restaurant.businessName || restaurant.name}</h2><p>Keep more value with the restaurant while earning loyalty rewards.</p><a className="button-primary" href={`${routeBase}/order`}>{website.ctaText || "Start an order"}</a></section>
        </>
      ) : null}

      {page === "menu" ? <section className="lux-section"><div className="lux-section-head"><p>Full menu</p><h2>{isLiquor ? "Bottle shop catalog" : "Prepared for pickup and delivery"}</h2><a href={`${routeBase}/order`}>Order now</a></div>{isLiquor ? <div className="site-card mb-4"><h3>Regulated items</h3><p>{bundle.complianceNote || "Age verification and local delivery rules apply."}</p></div> : null}{categories.length === 0 ? <EmptyState title="Menu coming soon" detail="This restaurant has not published public menu items yet." /> : categories.map((category) => <div className="lux-category" key={category.id}><h3>{category.name}</h3><div className="lux-card-grid">{(category.items || []).map((menuItem) => <MenuCard item={menuItem} key={menuItem.id} />)}</div></div>)}</section> : null}
      {page === "order" ? <section className="lux-section public-order-page"><div className="lux-section-head"><p>Order Online</p><h2>{restaurant.pickupEnabled && restaurant.deliveryEnabled ? "Pickup and delivery" : restaurant.deliveryEnabled ? "Delivery" : "Pickup"} from {restaurant.businessName || restaurant.name}</h2><a href={`${routeBase}/menu`}>View menu</a></div><div className="public-order-hero"><img src={heroImage} alt={`${restaurant.businessName || restaurant.name} food`} loading="lazy" onError={handleSafeImageError} /><div><p className="lux-kicker">{website.cuisineType || readable(restaurant.businessType)}</p><h3>{website.heroTitle || restaurant.businessName || restaurant.name}</h3><p>{website.heroSubtitle || restaurant.description}</p><div className="mt-4 flex flex-wrap gap-2"><StatusPill tone={restaurant.pickupEnabled ? "good" : "neutral"}>{restaurant.pickupEnabled ? "Pickup available" : "Pickup unavailable"}</StatusPill><StatusPill tone={restaurant.deliveryEnabled ? "good" : "neutral"}>{restaurant.deliveryEnabled ? "Delivery available" : "Delivery unavailable"}</StatusPill><StatusPill>{hoursPreview || "Hours vary"}</StatusPill></div></div></div><CustomerApp apiOnline={apiOnline} initialSlug={currentSlug} embedded /></section> : null}
      {page === "about" ? <section className="lux-split page"><img src={resolveImage(heroImage, "", defaultLooharImage)} alt={`${restaurant.businessName || restaurant.name} story`} onError={handleSafeImageError} /><div><p className="lux-kicker">Our story</p><h2>{website.aboutTitle}</h2><p>{website.aboutStory}</p><h3>Mission</h3><p>{website.missionStatement}</p><h3>Fresh ingredients</h3><p>Seasonal produce, thoughtful sourcing, and a menu designed for dining room quality at home.</p><h3>Community</h3><p>Ordering direct helps keep customer relationships and revenue with the local restaurant team.</p></div></section> : null}
      {page === "contact" && sectionIsVisible("contact") ? <section className="site-grid contact"><div className="site-card"><h2>Contact</h2><p>{address || restaurant.address}</p><p>{restaurant.phone}</p><p>{publicEmail}</p><p>Delivery availability depends on restaurant settings.</p><div className="mt-4 flex flex-wrap gap-2"><a className="button-primary" href={directionsHref} target="_blank" rel="noreferrer"><MapPin size={16} />Directions</a><a className="button-muted" href={`tel:${restaurant.phone || ""}`}>Call</a><a className="button-muted" href={`mailto:${publicEmail}`}>Email</a></div><PublicSocialLinks links={socialLinks} /></div><div className="site-card"><h3>Opening hours</h3>{hours.length ? hours.map(([day, value]) => <div className="summary-line" key={day}><span>{readable(day)}</span><strong>{value}</strong></div>) : <p className="mt-2 text-sm text-slate-500">Call for current hours.</p>}</div><div className="site-card"><h3>Location & message</h3>{mapSrc ? <iframe className="map-frame" title={`${restaurant.businessName || restaurant.name} map`} src={mapSrc} loading="lazy" /> : <div className="map-card">{address || "Address coming soon"}</div>}<p className="mt-4">{website.contactMessage || "Call or email the restaurant for private events, questions, and order help."}</p></div></section> : null}
      {page === "gallery" && sectionIsVisible("gallery") ? <section className="lux-section"><div className="lux-section-head"><p>Gallery</p><h2>Food, room, team, and events</h2><a href={`${routeBase}/order`}>Order from the menu</a></div>{gallery.length === 0 ? <EmptyState title="Gallery coming soon" detail="This restaurant has not added gallery images yet." /> : <div className="lux-gallery-grid">{gallery.map((image) => <figure key={image.id}><img src={resolveImage(image.imageUrl, "", defaultLooharImage)} alt={image.altText || image.title || "Restaurant photo"} loading="lazy" onError={handleSafeImageError} /><figcaption>{image.title || image.altText || readable(image.category || "food")}{image.caption ? ` / ${image.caption}` : ""}</figcaption></figure>)}</div>}</section> : null}
      {page === "loyalty" && sectionIsVisible("loyalty") ? <section className="lux-section"><div className="lux-section-head"><p>Loyalty</p><h2>Rewards for ordering direct</h2><a href={`${routeBase}/order`}>Join at checkout</a></div><div className="site-grid"><div className="site-card"><h3>How it works</h3><p>Earn {restaurant.loyaltySettingsJson?.pointsPerDollar || 1} point per dollar on eligible direct orders. Redeem points for restaurant-owned rewards.</p><a className="button-primary mt-4" href={`${routeBase}/order`}>Join at checkout</a></div>{rewards.map((reward) => <div className="site-card" key={reward.id}><h3>{reward.name}</h3><p>{reward.pointsRequired} points required.</p></div>)}</div></section> : null}
      {page === "catering" && sectionIsVisible("catering") ? <section className="lux-section"><div className="lux-section-head"><p>Catering</p><h2>Events, party trays, and corporate lunches</h2><a href={`tel:${restaurant.phone || ""}`}>Call restaurant</a></div><div className="site-grid"><div className="site-card"><h3>Party trays</h3><p>Shareable appetizers, salads, and entrees sized for groups.</p></div><div className="site-card"><h3>Corporate lunch</h3><p>Pickup and delivery-friendly lunch packages for teams.</p></div><div className="site-card"><h3>Family meals</h3><p>Comfortable dinner packages built around restaurant favorites.</p></div></div><div className="site-card"><h3>Request quote</h3><p>{website.cateringMessage || "Send event date, guest count, and menu preferences to the restaurant team."}</p><a className="button-primary mt-4" href={`mailto:${publicEmail}`}>Request quote</a></div></section> : null}
      {page === "careers" ? <section className="lux-section"><div className="lux-section-head"><p>Careers</p><h2>Join the restaurant team</h2><a href={`mailto:${restaurant.email || ""}`}>Contact hiring manager</a></div><div className="site-grid"><div className="site-card"><h3>Why work here</h3><p>Focused service, direct customer relationships, and a team built around hospitality.</p></div><div className="site-card"><h3>Open roles</h3><p>Contact the restaurant for current kitchen, service, and driver opportunities.</p></div><div className="site-card"><h3>Apply</h3><p>Email the hiring manager with your experience and availability.</p><a className="button-primary mt-4" href={`mailto:${restaurant.email || ""}`}>Apply by email</a></div></div></section> : null}

      <footer className="site-footer premium">
        <span>{restaurant.businessName || restaurant.name}</span>
        <span>{restaurant.address}</span>
        <PublicSocialLinks links={socialLinks} />
        <span>Direct ordering powered by Loohar</span>
      </footer>
    </div>
  );
}

const publicProductLinks = [
  { label: "Restaurant websites", detail: "Branded direct-ordering storefronts.", href: "/features/restaurant-website" },
  { label: "Direct ordering", detail: "Pickup and online ordering without marketplace dependency.", href: "/features/direct-online-ordering" },
  { label: "Delivery workflow", detail: "Driver assignments, tips, status updates, and earnings.", href: "/features/delivery-management" },
  { label: "Operations tools", detail: "Menu, orders, loyalty, coupons, reports, and settings.", href: "/features/operations-tools" }
];

const publicResourceLinks = [
  { label: "Security", detail: "Role-based access and tenant isolation.", href: "/security" },
  { label: "Restaurant onboarding", detail: "Start self-service setup.", href: "/register" },
  { label: "Support", detail: "Get help from Loohar.", href: "/support" },
  { label: "Terms and privacy", detail: "Review platform policies.", href: "/terms" }
];

const looharPlatformBrandDimensions = {
  compact: { width: 25, height: 30 },
  default: { width: 28, height: 34 },
  large: { width: 34, height: 41 }
};

const looharPlatformBrandSizeClasses = {
  compact: "loohar-platform-brand--compact",
  default: "loohar-platform-brand--default",
  large: "loohar-platform-brand--large"
};

const looharPlatformBrandVariantClasses = {
  full: "loohar-platform-brand--full",
  "mark-only": "loohar-platform-brand--mark-only"
};

const looharPlatformBrandThemeClasses = {
  light: "loohar-platform-brand--light",
  dark: "loohar-platform-brand--dark"
};

function LooharPlatformBrand({ size = "default", variant = "full", theme = "light", href = "/", className = "" }) {
  const safeSize = looharPlatformBrandDimensions[size] ? size : "default";
  const dimensions = looharPlatformBrandDimensions[safeSize];
  const safeVariant = looharPlatformBrandVariantClasses[variant] ? variant : "full";
  const safeTheme = looharPlatformBrandThemeClasses[theme] ? theme : "light";
  const showWordmark = safeVariant !== "mark-only";
  const Component = href ? "a" : "span";
  return (
    <Component className={`loohar-platform-brand ${looharPlatformBrandSizeClasses[safeSize]} ${looharPlatformBrandVariantClasses[safeVariant]} ${looharPlatformBrandThemeClasses[safeTheme]} ${className}`.trim()} href={href || undefined} aria-label={href ? "Loohar home" : "Loohar"}>
      <img src="/marketing/loohar-mark.svg" alt="" width={dimensions.width} height={dimensions.height} />
      {showWordmark ? <span>{appName}</span> : null}
    </Component>
  );
}

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function focusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(focusableSelector)).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

function trapFocus(event, container, fallback) {
  if (event.key !== "Tab") return;
  const items = focusableElements(container);
  if (!items.length) {
    event.preventDefault();
    fallback?.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function internalNavigationTarget(href = "") {
  if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) return null;
  try {
    return new globalThis.URL(href, window.location.origin);
  } catch {
    return null;
  }
}

function PublicLink({ href, children, className = "", onNavigate, role, "aria-current": ariaCurrent }) {
  function handleClick(event) {
    const nextUrl = internalNavigationTarget(href);
    onNavigate?.();
    if (!nextUrl || nextUrl.origin !== window.location.origin || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (nextUrl.pathname === window.location.pathname && nextUrl.hash) return;
    event.preventDefault();
    navigateInApp(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    if (nextUrl.hash) {
      window.setTimeout(() => {
        document.querySelector(nextUrl.hash)?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "start"
        });
      }, 0);
    } else {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }

  return (
    <a className={className} href={href} role={role} aria-current={ariaCurrent} onClick={handleClick}>
      {children}
    </a>
  );
}

function LearnMoreLink({ href, children = "Learn more", className = "" }) {
  return (
    <PublicLink href={href} className={`learn-more-link ${className}`}>
      <span>{children}</span>
      <ArrowRight size={15} aria-hidden="true" />
    </PublicLink>
  );
}

function MarketingCard({ children, className = "", as: Component = "article" }) {
  return <Component className={`marketing-card ${className}`}>{children}</Component>;
}

function PublicDropdown({ id, label, links, openDropdown, setOpenDropdown, onNavigate, active }) {
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const isOpen = openDropdown === id;

  function setOpen(nextOpen) {
    setOpenDropdown(nextOpen ? id : "");
  }

  function focusPanelItem(index = 0) {
    window.setTimeout(() => {
      const items = Array.from(panelRef.current?.querySelectorAll("a") || []);
      items[index]?.focus();
    }, 0);
  }

  function handleTriggerKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      focusPanelItem(0);
    }
    if (event.key === "Escape") {
      setOpen(false);
    }
  }

  function handlePanelKeyDown(event) {
    const items = Array.from(panelRef.current?.querySelectorAll("a") || []);
    const currentIndex = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
    if (event.key === "ArrowDown" && items.length) {
      event.preventDefault();
      items[(currentIndex + 1 + items.length) % items.length]?.focus();
    }
    if (event.key === "ArrowUp" && items.length) {
      event.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    }
  }

  return (
    <div className={`public-dropdown ${isOpen ? "open" : ""} ${active ? "active" : ""}`}>
      <button
        ref={triggerRef}
        aria-controls={`public-dropdown-${id}`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="public-nav-button"
        type="button"
        onClick={() => setOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{label}</span>
        <ChevronDown className="public-chevron" size={15} aria-hidden="true" />
      </button>
      <div
        ref={panelRef}
        className="public-dropdown-panel"
        id={`public-dropdown-${id}`}
        role="menu"
        aria-label={`${label} menu`}
        onKeyDown={handlePanelKeyDown}
      >
        {links.map((link) => (
          <PublicLink className="public-dropdown-item" href={link.href} key={link.href} role="menuitem" onNavigate={onNavigate}>
            <span>{link.label}</span>
            <small>{link.detail}</small>
          </PublicLink>
        ))}
      </div>
    </div>
  );
}

function PublicNavbar({ compact = false, user, onLogout }) {
  const [openDropdown, setOpenDropdown] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileGroup, setMobileGroup] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const navRef = useRef(null);
  const mobileTriggerRef = useRef(null);
  const mobileDrawerRef = useRef(null);
  const mobileCloseRef = useRef(null);
  const previousMobileFocusRef = useRef(null);
  const currentPath = window.location.pathname;
  const pricingActive = currentPath.startsWith("/pricing");
  const aboutActive = currentPath.startsWith("/about");
  const productActive = currentPath === "/" || currentPath.startsWith("/features");
  const resourceActive = currentPath.startsWith("/resources") || currentPath.startsWith("/security") || currentPath.startsWith("/support") || currentPath.startsWith("/privacy") || currentPath.startsWith("/terms");
  const isLoginPath = isAuthPagePath(currentPath);

  function closeNavigation() {
    setOpenDropdown("");
    setMobileOpen(false);
    setMobileGroup("");
  }

  function openMobileNavigation() {
    previousMobileFocusRef.current = document.activeElement;
    setOpenDropdown("");
    setMobileOpen(true);
  }

  function handleMobileDrawerKeyDown(event) {
    trapFocus(event, mobileDrawerRef.current, mobileCloseRef.current);
  }

  useEffect(() => {
    function handleOutsideClick(event) {
      if (navRef.current && !navRef.current.contains(event.target)) setOpenDropdown("");
    }
    function handleEscape(event) {
      if (event.key === "Escape") {
        closeNavigation();
      }
    }
    function handleScroll() {
      setScrolled(window.scrollY > 8);
    }
    document.addEventListener("pointerdown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("loohar:navigate", closeNavigation);
    handleScroll();
    return () => {
      document.removeEventListener("pointerdown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("loohar:navigate", closeNavigation);
    };
  }, []);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => mobileCloseRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      const restoreTarget = previousMobileFocusRef.current?.isConnected ? previousMobileFocusRef.current : mobileTriggerRef.current;
      window.setTimeout(() => restoreTarget?.focus(), 0);
    };
  }, [mobileOpen]);

  return (
    <header className={`public-navbar ${compact ? "compact" : ""} ${scrolled ? "scrolled" : ""}`}>
      <div className="public-container public-navbar-grid" ref={navRef}>
        <LooharPlatformBrand size="default" />
        {!compact ? (
          <nav className="public-nav-center" aria-label="Primary public navigation">
            <PublicDropdown id="product" label="Product" links={publicProductLinks} openDropdown={openDropdown} setOpenDropdown={setOpenDropdown} onNavigate={closeNavigation} active={productActive} />
            <PublicLink className="public-nav-link" href="/#features" onNavigate={closeNavigation}>Features</PublicLink>
            <PublicLink className={`public-nav-link ${pricingActive ? "active" : ""}`} href="/pricing" aria-current={pricingActive ? "page" : undefined} onNavigate={closeNavigation}>Pricing</PublicLink>
            <PublicDropdown id="resources" label="Resources" links={publicResourceLinks} openDropdown={openDropdown} setOpenDropdown={setOpenDropdown} onNavigate={closeNavigation} active={resourceActive} />
            <PublicLink className={`public-nav-link ${aboutActive ? "active" : ""}`} href="/about" aria-current={aboutActive ? "page" : undefined} onNavigate={closeNavigation}>About Us</PublicLink>
          </nav>
        ) : <div className="public-nav-center-spacer" aria-hidden="true" />}
        <div className="public-nav-actions">
          {!compact ? <PublicLink className="public-button secondary" href="/pricing" onNavigate={closeNavigation}>View Pricing</PublicLink> : null}
          {!compact ? <PublicLink className="public-button primary" href="/register" onNavigate={closeNavigation}>Register Your Restaurant</PublicLink> : null}
          {user && !compact ? <PublicLink className="public-button secondary" href={dashboardPathFor(user)} onNavigate={closeNavigation}>Dashboard</PublicLink> : <PublicLink className="public-button ghost" href={compact ? "/" : "/login"} onNavigate={closeNavigation}>{compact ? "Back to Loohar" : "Sign In"}</PublicLink>}
          {user && !compact ? <button className="public-button ghost" type="button" onClick={onLogout}>Logout</button> : null}
        </div>
        <button ref={mobileTriggerRef} className="public-mobile-trigger" type="button" aria-label="Open navigation menu" aria-expanded={mobileOpen} aria-controls="public-mobile-menu" onClick={openMobileNavigation}>
          <MenuIcon size={22} aria-hidden="true" />
        </button>
      </div>
      <div className={`public-mobile-layer ${mobileOpen ? "open" : ""}`} aria-hidden={!mobileOpen}>
        <button className="public-mobile-backdrop" type="button" tabIndex={mobileOpen ? 0 : -1} aria-label="Close menu" onClick={closeNavigation} />
        <div ref={mobileDrawerRef} className="public-mobile-drawer" id="public-mobile-menu" role="dialog" aria-modal="true" aria-label="Mobile public navigation" onKeyDown={handleMobileDrawerKeyDown}>
          <div className="public-mobile-head">
            <LooharPlatformBrand size="compact" />
            <button ref={mobileCloseRef} className="public-mobile-close" type="button" onClick={closeNavigation} aria-label="Close menu"><X size={20} /></button>
          </div>
          <nav className="public-mobile-nav-list" aria-label="Mobile public navigation links">
            <PublicLink href="/" onNavigate={closeNavigation}>Home</PublicLink>
            {[
              ["product", "Product", publicProductLinks],
              ["resources", "Resources", publicResourceLinks]
            ].map(([groupId, groupLabel, links]) => (
              <div className={`public-mobile-group ${mobileGroup === groupId ? "open" : ""}`} key={groupId}>
                <button type="button" onClick={() => setMobileGroup((open) => open === groupId ? "" : groupId)} aria-expanded={mobileGroup === groupId}>
                  <span>{groupLabel}</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
                <div>
                  {links.map((link) => <PublicLink href={link.href} key={link.href} onNavigate={closeNavigation}>{link.label}</PublicLink>)}
                </div>
              </div>
            ))}
            <PublicLink href="/#features" onNavigate={closeNavigation}>Features</PublicLink>
            <PublicLink href="/pricing" onNavigate={closeNavigation}>Pricing</PublicLink>
            <PublicLink href="/about" onNavigate={closeNavigation}>About Us</PublicLink>
          </nav>
          <div className="public-mobile-actions">
            <PublicLink className="public-button secondary" href="/pricing" onNavigate={closeNavigation}>View Pricing</PublicLink>
            <PublicLink className="public-button primary" href="/register" onNavigate={closeNavigation}>Register Your Restaurant</PublicLink>
            {user ? <PublicLink className="public-button ghost" href={dashboardPathFor(user)} onNavigate={closeNavigation}>Dashboard</PublicLink> : !isLoginPath ? <PublicLink className="public-button ghost" href="/login" onNavigate={closeNavigation}>Sign In</PublicLink> : null}
            {user ? <button className="public-button ghost" type="button" onClick={() => { closeNavigation(); onLogout?.(); }}>Logout</button> : null}
          </div>
        </div>
      </div>
    </header>
  );
}

function PublicFooter({ compact = false }) {
  if (compact) {
    return (
      <footer className="public-footer compact">
        <div className="public-container">
          <p>Need help? <a href="mailto:support@loohar.com">support@loohar.com</a></p>
        </div>
      </footer>
    );
  }
  return (
    <footer className="public-footer">
      <div className="public-container public-footer-grid">
        <div className="public-footer-brand">
          <LooharPlatformBrand size="compact" />
          <p>Restaurant websites, direct ordering, pickup, delivery, loyalty, and operations in one restaurant-owned SaaS platform.</p>
        </div>
        <nav aria-label="Footer product links">
          <h2>Product</h2>
          <a href="/features">Features</a>
          <a href="/features/direct-online-ordering">Direct ordering</a>
          <a href="/features/delivery-management">Delivery</a>
          <a href="/pricing">Pricing</a>
          <a href="/register">Register</a>
        </nav>
        <nav aria-label="Footer company links">
          <h2>Company</h2>
          <a href="/about">About</a>
          <a href="/security">Security</a>
          <a href="/support">Support</a>
        </nav>
        <nav aria-label="Footer legal links">
          <h2>Legal</h2>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="mailto:support@loohar.com">Contact</a>
        </nav>
        <p className="public-footer-copy">Copyright {new Date().getFullYear()} Loohar. All rights reserved.</p>
      </div>
    </footer>
  );
}

function PublicLayout({ children, compactNav = false, user, onLogout, className = "" }) {
  return (
    <div className={`public-page ${className}`}>
      <PublicNavbar compact={compactNav} user={user} onLogout={onLogout} />
      <main className={`public-main public-page-transition ${compactNav ? "compact" : ""}`}>
        {children}
      </main>
      <PublicFooter compact={compactNav} />
    </div>
  );
}

function AppHeader({ navItems = [] }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef(null);
  const menuCloseRef = useRef(null);
  const menuDrawerRef = useRef(null);
  const previousMenuFocusRef = useRef(null);

  function openMenu() {
    previousMenuFocusRef.current = document.activeElement;
    setMenuOpen(true);
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  function handleMenuDrawerKeyDown(event) {
    trapFocus(event, menuDrawerRef.current, menuCloseRef.current);
  }

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape") closeMenu();
    }
    window.addEventListener("loohar:navigate", closeMenu);
    document.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("loohar:navigate", closeMenu);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => menuCloseRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      const restoreTarget = previousMenuFocusRef.current?.isConnected ? previousMenuFocusRef.current : menuTriggerRef.current;
      window.setTimeout(() => restoreTarget?.focus(), 0);
    };
  }, [menuOpen]);

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-brand">
          <LooharPlatformBrand size="default" />
        </div>
        <button ref={menuTriggerRef} className="app-menu-toggle" type="button" aria-label="Open dashboard navigation" aria-expanded={menuOpen} aria-controls="app-mobile-menu" onClick={openMenu}>
          <MenuIcon size={21} aria-hidden="true" />
        </button>
        <nav className="app-nav" aria-label="Dashboard navigation">
          {navItems.map(({ href, label, icon: Icon, active, target, rel }) => (
            <a className={`nav-tab ${active ? "active" : ""}`} href={href} target={target} rel={rel} key={`${label}-${href}`}>
              {Icon ? <Icon size={17} /> : null}{label}
            </a>
          ))}
        </nav>
      </div>
      <div className={`app-mobile-layer ${menuOpen ? "open" : ""}`} aria-hidden={!menuOpen}>
        <button className="app-mobile-backdrop" type="button" tabIndex={menuOpen ? 0 : -1} aria-label="Close dashboard navigation" onClick={closeMenu} />
        <div ref={menuDrawerRef} className="app-mobile-drawer" id="app-mobile-menu" role="dialog" aria-modal="true" aria-label="Dashboard navigation" onKeyDown={handleMenuDrawerKeyDown}>
          <div className="app-mobile-head">
            <div className="app-brand">
              <LooharPlatformBrand size="compact" />
            </div>
            <button ref={menuCloseRef} className="app-mobile-close" type="button" aria-label="Close dashboard navigation" onClick={closeMenu}><X size={20} /></button>
          </div>
          <nav className="app-mobile-nav" aria-label="Authorized dashboard links">
            {navItems.map(({ href, label, icon: Icon, active, target, rel }) => (
              <a className={`nav-tab ${active ? "active" : ""}`} href={href} target={target} rel={rel} key={`mobile-${label}-${href}`} onClick={closeMenu}>
                {Icon ? <Icon size={17} /> : null}{label}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}

function RestaurantAppShell({ children, user, restaurantSlug = "", activePage = "dashboard", apiOnline, apiMode, authChecking, onLogout }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerTriggerRef = useRef(null);
  const drawerCloseRef = useRef(null);
  const drawerRef = useRef(null);
  const previousFocusRef = useRef(null);
  const safePage = restaurantPageDefinitions[activePage] ? activePage : "dashboard";
  const navPath = typeof window !== "undefined" ? window.location.pathname : restaurantPagePath(restaurantSlug, safePage);
  const navItems = restaurantOperationsNavigation(user, restaurantSlug, navPath);
  const tenantName = user?.restaurantName || readable(restaurantSlug || "Restaurant");
  const roleLabel = readable(user?.role || "Restaurant user");
  const pageInfo = restaurantPageDefinitions[safePage];
  const publicWebsitePath = restaurantSlug ? publicPathForSlug(restaurantSlug) : "";
  const navHash = typeof window !== "undefined" ? window.location.hash : "";
  const restaurantBasePathForShell = restaurantSlug ? `/restaurant/${restaurantSlug}` : "/restaurant";
  const selectedSettingsSectionForShell = safePage === "settings" ? restaurantSettingsSectionFromPath(navPath, navHash) : "";
  const shellSettingsLinks = restaurantSettingsLinks.map((item) => {
    const normalizedId = normalizeRestaurantSettingsSectionId(item.id);
    return {
      ...item,
      id: normalizedId,
      href: item.id === "payments" ? `${restaurantBasePathForShell}/onboarding#payments` : restaurantSettingPath(restaurantBasePathForShell, normalizedId),
      selected: selectedSettingsSectionForShell === normalizedId
    };
  });
  const shellSettingsGroups = groupRestaurantSettingsLinks(shellSettingsLinks);

  function openDrawer() {
    previousFocusRef.current = document.activeElement;
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
  }

  function handleDrawerKeyDown(event) {
    trapFocus(event, drawerRef.current, drawerCloseRef.current);
  }

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape") closeDrawer();
    }
    window.addEventListener("loohar:navigate", closeDrawer);
    document.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("loohar:navigate", closeDrawer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => drawerCloseRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      const restoreTarget = previousFocusRef.current?.isConnected ? previousFocusRef.current : drawerTriggerRef.current;
      window.setTimeout(() => restoreTarget?.focus(), 0);
    };
  }, [drawerOpen]);

  function renderSidebarNav(onNavigate) {
    return (
      <nav className="restaurant-shell-nav" aria-label="Restaurant operations navigation">
        {navItems.map(({ href, label, icon: Icon, active }) => {
          const isSettingsItem = label === "Settings";
          return (
            <div className="restaurant-shell-nav-block" key={`${label}-${href}`}>
              <a className={`restaurant-shell-nav-item ${active ? "active" : ""}`} href={href} aria-current={active ? "page" : undefined} onClick={onNavigate}>
                {Icon ? <Icon size={18} aria-hidden="true" /> : null}
                <span>{label}</span>
              </a>
              {isSettingsItem && active ? (
                <div className="restaurant-settings-subnav" aria-label="Restaurant settings sections">
                  {shellSettingsGroups.map((group) => (
                    <div className="restaurant-settings-subnav-group" key={group.id}>
                      <span>{group.label}</span>
                      {group.items.map((item) => (
                        <a className={`restaurant-settings-subnav-link ${item.selected ? "active" : ""}`} href={item.href} key={item.id} onClick={onNavigate}>
                          {item.label}
                          <b>{item.status === "COMING_SOON" ? "Soon" : item.status === "READ_ONLY" ? "View" : ""}</b>
                        </a>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    );
  }

  return (
    <div className="restaurant-shell">
      <aside className="restaurant-shell-sidebar">
        <div className="restaurant-shell-sidebar-head">
          <LooharPlatformBrand size="compact" href="/" />
        </div>
        <div className="restaurant-shell-tenant">
          <span className="restaurant-shell-tenant-eyebrow">Restaurant operations</span>
          <strong>{tenantName}</strong>
          <span>{roleLabel}</span>
        </div>
        {renderSidebarNav()}
        <div className="restaurant-shell-sidebar-footer">
          {publicWebsitePath ? <a className="restaurant-shell-secondary-link" href={publicWebsitePath} target="_blank" rel="noreferrer"><Store size={16} />Public site</a> : null}
          <a className="restaurant-shell-secondary-link" href="mailto:support@loohar.com"><Shield size={16} />Support</a>
          <button className="restaurant-shell-secondary-link" type="button" onClick={onLogout}><LogOut size={16} />Logout</button>
        </div>
      </aside>
      <div className="restaurant-shell-body">
        <header className="restaurant-shell-topbar">
          <button ref={drawerTriggerRef} className="restaurant-shell-drawer-trigger" type="button" aria-label="Open restaurant navigation" aria-expanded={drawerOpen} aria-controls="restaurant-mobile-drawer" onClick={openDrawer}>
            <MenuIcon size={22} aria-hidden="true" />
          </button>
          <div className="restaurant-shell-title">
            <span>{tenantName}</span>
            <strong>{pageInfo.title}</strong>
          </div>
          <div className="restaurant-shell-topbar-actions">
            <StatusPill tone={apiOnline ? "good" : apiMode === "CHECKING" ? "neutral" : "warn"}>{apiOnline ? "Live API" : apiMode === "CHECKING" ? "Checking API" : "Offline"}</StatusPill>
            {authChecking ? <StatusPill tone="neutral">Session check</StatusPill> : null}
            {publicWebsitePath ? <a className="restaurant-shell-icon-link" href={publicWebsitePath} target="_blank" rel="noreferrer" aria-label="Open public restaurant website"><Store size={18} /></a> : null}
            <button className="restaurant-shell-icon-link" type="button" onClick={onLogout} aria-label="Log out"><LogOut size={18} /></button>
          </div>
        </header>
        <main className="restaurant-shell-content">
          <div className="restaurant-shell-page-head">
            <div>
              <p className="restaurant-shell-breadcrumb">Loohar / {tenantName}</p>
              <h1>{pageInfo.title}</h1>
              <p>{pageInfo.description}</p>
            </div>
          </div>
          {children}
        </main>
      </div>
      <div className={`restaurant-shell-mobile-layer ${drawerOpen ? "open" : ""}`} aria-hidden={!drawerOpen}>
        <button className="restaurant-shell-mobile-backdrop" type="button" tabIndex={drawerOpen ? 0 : -1} aria-label="Close restaurant navigation" onClick={closeDrawer} />
        <div ref={drawerRef} className="restaurant-shell-mobile-drawer" id="restaurant-mobile-drawer" role="dialog" aria-modal="true" aria-label="Restaurant navigation" onKeyDown={handleDrawerKeyDown}>
          <div className="restaurant-shell-mobile-head">
            <LooharPlatformBrand size="compact" href="/" />
            <button ref={drawerCloseRef} className="restaurant-shell-mobile-close" type="button" aria-label="Close restaurant navigation" onClick={closeDrawer}><X size={20} /></button>
          </div>
          <div className="restaurant-shell-tenant mobile">
            <span className="restaurant-shell-tenant-eyebrow">Restaurant operations</span>
            <strong>{tenantName}</strong>
            <span>{roleLabel}</span>
          </div>
          {renderSidebarNav(closeDrawer)}
          <div className="restaurant-shell-sidebar-footer mobile">
            {publicWebsitePath ? <a className="restaurant-shell-secondary-link" href={publicWebsitePath} target="_blank" rel="noreferrer" onClick={closeDrawer}><Store size={16} />Public site</a> : null}
            <button className="restaurant-shell-secondary-link" type="button" onClick={onLogout}><LogOut size={16} />Logout</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginStrip({ user, onLogout }) {
  if (!user) {
    return (
      <div className="panel flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-sm font-semibold text-slate-600">Sign in to access this Loohar dashboard.</p>
        <div className="flex flex-wrap gap-2">
          <a className="button-muted" href="/admin/login"><Shield size={16} />Admin Login</a>
          <a className="button-muted" href="/restaurant/login"><ChefHat size={16} />Restaurant Login</a>
        </div>
      </div>
    );
  }
  return (
    <div className="panel flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-sm font-bold text-ink">{user.name}</p>
        <p className="text-sm text-slate-500">{user.role.replaceAll("_", " ")}{user.restaurantName ? ` - ${user.restaurantName}` : ""}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <a className="button-muted" href={dashboardPathFor(user)}><LayoutDashboard size={16} />Dashboard</a>
        <button className="button-muted" type="button" onClick={onLogout}><LogOut size={18} />Logout</button>
      </div>
    </div>
  );
}

function AccessDenied({ title = "Access denied.", detail = "This area requires a different Loohar account role.", loginHref = "/login" }) {
  return (
    <div className="panel mx-auto max-w-2xl text-center">
      <Shield className="mx-auto text-rose-500" size={36} />
      <h2 className="mt-3 text-2xl font-black text-ink">{title}</h2>
      <p className="mt-2 text-slate-500">{detail}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <a className="button-primary" href={loginHref}><LogIn size={16} />Go to login</a>
        <a className="button-muted" href="/">Back to Loohar</a>
      </div>
    </div>
  );
}

function AppLoadingState({ title = "Loading Loohar", detail = "Checking live API and session state." }) {
  return (
    <div className="panel mx-auto max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 animate-pulse rounded-md bg-slate-200" />
        <div className="flex-1">
          <div className="h-4 w-44 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 h-3 w-72 max-w-full animate-pulse rounded bg-slate-100" />
        </div>
      </div>
      <h2 className="mt-5 text-xl font-black text-ink">{title}</h2>
      <p className="mt-2 text-sm text-slate-500">{detail}</p>
    </div>
  );
}

function Redirecting({ to }) {
  useEffect(() => {
    navigateInApp(to, { replace: true });
  }, [to]);
  return (
    <div className="min-h-screen bg-[#f7f8fb] px-4 py-10 text-slate-700">
      <AppLoadingState title="Opening Loohar" detail="Taking you to the right dashboard." />
    </div>
  );
}

const fallbackIntroTrialDays = 90;

const fallbackRegistrationPlans = [
  {
    code: "STARTER",
    displayName: "Starter",
    description: "Launch a branded ordering website with pickup.",
    monthlyPriceCents: 9900,
    annualPriceCents: 99000,
    features: ["Direct ordering website", "Pickup ordering", "Basic menu/catalog", "Restaurant onboarding"],
    trialDays: fallbackIntroTrialDays,
    introductoryProgramAvailable: true,
    introductoryProgramName: "90-Day Introductory Program",
    paymentMethodRequiredAtSignup: false,
    autoChargeWithoutExplicitAuthorization: false,
    locationLimit: 1,
    staffLimit: 5,
    active: true,
    checkoutAvailable: false
  },
  {
    code: "PROFESSIONAL",
    displayName: "Professional",
    description: "Add delivery, driver workflows, loyalty, and coupons.",
    monthlyPriceCents: 19900,
    annualPriceCents: 199000,
    features: ["Everything in Starter", "Delivery workflows", "Driver management", "Loyalty", "Coupons", "Delivery zones"],
    trialDays: fallbackIntroTrialDays,
    introductoryProgramAvailable: true,
    introductoryProgramName: "90-Day Introductory Program",
    paymentMethodRequiredAtSignup: false,
    autoChargeWithoutExplicitAuthorization: false,
    locationLimit: 1,
    staffLimit: 25,
    active: true,
    checkoutAvailable: false
  },
  {
    code: "ENTERPRISE",
    displayName: "Enterprise",
    description: "Advanced operations for growing restaurant groups.",
    monthlyPriceCents: 39900,
    annualPriceCents: 399000,
    features: ["Everything in Professional", "Advanced analytics", "Multi-location foundation", "Priority support"],
    trialDays: fallbackIntroTrialDays,
    introductoryProgramAvailable: true,
    introductoryProgramName: "90-Day Introductory Program",
    paymentMethodRequiredAtSignup: false,
    autoChargeWithoutExplicitAuthorization: false,
    locationLimit: null,
    staffLimit: null,
    active: true,
    checkoutAvailable: false
  }
];

const registrationInitialForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
  termsAccepted: false,
  privacyAccepted: false,
  businessName: "",
  publicBusinessName: "",
  businessType: "RESTAURANT",
  cuisine: "",
  businessEmail: "",
  businessPhone: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  country: "US",
  timezone: "America/Denver",
  preferredSlug: "",
  planCode: "STARTER",
  billingInterval: "MONTHLY"
};

const registrationSteps = [
  { id: "account", label: "Owner account" },
  { id: "business", label: "Restaurant" },
  { id: "plan", label: "Plan" },
  { id: "checkout", label: "Checkout" }
];

const registrationStepFields = {
  account: ["firstName", "lastName", "email", "phone", "password", "confirmPassword", "termsAccepted", "privacyAccepted"],
  business: ["businessName", "publicBusinessName", "businessType", "cuisine", "businessEmail", "businessPhone", "address", "city", "state", "zip", "country", "timezone", "preferredSlug"],
  plan: ["planCode", "billingInterval"],
  checkout: []
};

function slugFromName(value = "") {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
}

function slugInputValue(value = "") {
  return String(value || "").toLowerCase().trimStart().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 63);
}

const registrationFieldSettings = {
  firstName: { autoComplete: "given-name", inputMode: "text" },
  lastName: { autoComplete: "family-name", inputMode: "text" },
  email: { type: "email", autoComplete: "email", inputMode: "email", autoCapitalize: "none", spellCheck: false },
  phone: { type: "tel", autoComplete: "tel", inputMode: "tel" },
  password: { type: "password", autoComplete: "new-password", autoCapitalize: "none", spellCheck: false },
  confirmPassword: { type: "password", autoComplete: "new-password", autoCapitalize: "none", spellCheck: false },
  businessName: { autoComplete: "organization", inputMode: "text" },
  publicBusinessName: { autoComplete: "organization", inputMode: "text" },
  cuisine: { inputMode: "text" },
  businessEmail: { type: "email", autoComplete: "email", inputMode: "email", autoCapitalize: "none", spellCheck: false },
  businessPhone: { type: "tel", autoComplete: "tel", inputMode: "tel" },
  address: { autoComplete: "street-address", inputMode: "text" },
  city: { autoComplete: "address-level2", inputMode: "text" },
  state: { autoComplete: "address-level1", inputMode: "text" },
  zip: { type: "text", autoComplete: "postal-code", inputMode: "text" },
  country: { autoComplete: "country-name", inputMode: "text" },
  timezone: { inputMode: "text" },
  preferredSlug: { type: "text", autoComplete: "off", inputMode: "url", autoCapitalize: "none", spellCheck: false }
};

function normalizePlanLabel(code = "") {
  return readable(String(code || "").toLowerCase().replace("professional", "professional"));
}

function planPrice(plan, interval = "MONTHLY") {
  return interval === "ANNUAL" ? plan?.annualPriceCents || plan?.monthlyPriceCents || 0 : plan?.monthlyPriceCents || 0;
}

function planCheckoutAvailable(plan, interval = "MONTHLY") {
  if (!plan) return false;
  if (interval === "ANNUAL") return Boolean(plan.annualCheckoutAvailable ?? plan.checkoutAvailable);
  return Boolean(plan.monthlyCheckoutAvailable ?? plan.checkoutAvailable);
}

function planIntroAvailable(plan) {
  return Boolean(plan?.introductoryProgramAvailable) && plan?.paymentMethodRequiredAtSignup !== true;
}

function planStartAvailable(plan, interval = "MONTHLY") {
  return planIntroAvailable(plan) || planCheckoutAvailable(plan, interval);
}

function planStartMode(plan, interval = "MONTHLY") {
  if (planIntroAvailable(plan)) return "INTRO_TRIAL";
  if (planCheckoutAvailable(plan, interval)) return "STRIPE_CHECKOUT";
  return "UNAVAILABLE";
}

const PLAN_CONFIG_STATUS = {
  IDLE: "IDLE",
  LOADING: "LOADING",
  READY: "READY",
  ERROR: "ERROR"
};

function planConfigPending(status) {
  return status === PLAN_CONFIG_STATUS.IDLE || status === PLAN_CONFIG_STATUS.LOADING;
}

function checkoutStatusForPlan(plan, interval, planConfigStatus) {
  if (planConfigPending(planConfigStatus)) return { tone: "neutral", label: "Checking setup" };
  if (planConfigStatus === PLAN_CONFIG_STATUS.ERROR) return { tone: "warn", label: "Setup not confirmed" };
  if (planIntroAvailable(plan)) return { tone: "good", label: `${plan.trialDays || fallbackIntroTrialDays}-day intro` };
  return planCheckoutAvailable(plan, interval)
    ? { tone: "good", label: "Checkout ready" }
    : { tone: "warn", label: "Setup temporarily unavailable" };
}

function PlanCardSkeletons({ count = 3 }) {
  return Array.from({ length: count }, (_, index) => (
    <div aria-hidden="true" className="panel min-h-[22rem]" key={`plan-skeleton-${index}`}>
      <div className="h-6 w-32 animate-pulse rounded-full bg-slate-100" />
      <div className="mt-5 h-8 w-40 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 h-4 w-full animate-pulse rounded bg-slate-100" />
      <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-slate-100" />
      <div className="mt-7 h-10 w-44 animate-pulse rounded bg-slate-200" />
      <div className="mt-6 space-y-3">
        <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
        <div className="h-4 w-11/12 animate-pulse rounded bg-slate-100" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="mt-8 h-11 w-full animate-pulse rounded-md bg-slate-100" />
    </div>
  ));
}

function validateRegistrationStep(form, stepId) {
  const errors = {};
  if (stepId === "account") {
    [["firstName", "First name"], ["lastName", "Last name"], ["email", "Email"], ["phone", "Phone"], ["password", "Password"], ["confirmPassword", "Confirm password"]].forEach(([field, label]) => {
      if (!String(form[field] || "").trim()) errors[field] = `${label} is required.`;
    });
    if (form.email && !emailPattern.test(form.email)) errors.email = "Enter a valid email.";
    const issues = passwordIssues(form.password || "");
    if (issues.length) errors.password = `Password needs: ${issues.join(", ")}.`;
    if (form.password !== form.confirmPassword) errors.confirmPassword = "Passwords must match.";
    if (!form.termsAccepted) errors.termsAccepted = "Accept the Terms of Service.";
    if (!form.privacyAccepted) errors.privacyAccepted = "Accept the Privacy Policy.";
  }
  if (stepId === "business") {
    [["businessName", "Legal business name"], ["publicBusinessName", "Public restaurant name"], ["cuisine", "Cuisine"], ["businessEmail", "Business email"], ["businessPhone", "Business phone"], ["address", "Address"], ["city", "City"], ["state", "State"], ["zip", "ZIP"], ["country", "Country"], ["timezone", "Time zone"], ["preferredSlug", "Preferred slug"]].forEach(([field, label]) => {
      if (!String(form[field] || "").trim()) errors[field] = `${label} is required.`;
    });
    if (form.businessEmail && !emailPattern.test(form.businessEmail)) errors.businessEmail = "Enter a valid business email.";
    const slugValidation = validatePublicSlug(form.preferredSlug || "");
    if (!slugValidation.ok) errors.preferredSlug = slugValidation.error;
  }
  if (stepId === "plan") {
    if (!planCodes.includes(form.planCode)) errors.planCode = "Choose a Loohar plan.";
    if (!["MONTHLY", "ANNUAL"].includes(form.billingInterval)) errors.billingInterval = "Choose monthly or annual billing.";
  }
  return errors;
}

function registrationVisibleErrors(errors, stepId) {
  const fields = registrationStepFields[stepId] || [];
  return fields.map((field) => errors[field]).filter(Boolean);
}

function RegistrationInput({ form, errors, field, label, type, autoComplete, inputMode, autoCapitalize, spellCheck, onBlur, onFieldChange, onCompositionStart, onCompositionEnd }) {
  const inputId = `registration-${field}`;
  const errorId = `${inputId}-error`;
  const error = errors[field];
  const settings = registrationFieldSettings[field] || {};
  const resolvedType = type || settings.type || "text";
  const resolvedAutoComplete = autoComplete ?? settings.autoComplete ?? "";
  const resolvedInputMode = inputMode || settings.inputMode;
  const resolvedAutoCapitalize = autoCapitalize || settings.autoCapitalize;
  const resolvedSpellCheck = spellCheck ?? settings.spellCheck;
  return (
    <label className="text-sm font-semibold text-slate-600" htmlFor={inputId}>
      {label}
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        autoCapitalize={resolvedAutoCapitalize}
        autoComplete={resolvedAutoComplete}
        className="input mt-1"
        id={inputId}
        inputMode={resolvedInputMode}
        name={field}
        onBlur={onBlur}
        onChange={(event) => onFieldChange(field, event.target.value, { isComposing: Boolean(event.nativeEvent?.isComposing) })}
        onCompositionEnd={(event) => onCompositionEnd?.(field, event.target.value)}
        onCompositionStart={() => onCompositionStart?.(field)}
        spellCheck={resolvedSpellCheck}
        type={resolvedType}
        value={form[field] ?? ""}
      />
      <FieldError id={errorId} message={error} />
    </label>
  );
}

function RegistrationShell({ children }) {
  return (
    <PublicLayout className="registration-shell">
      <div className="public-container registration-shell-main public-form-page">{children}</div>
    </PublicLayout>
  );
}

const publicFeatureCards = [
  {
    icon: Store,
    title: "Restaurant Website",
    slug: "restaurant-website",
    href: "/features/restaurant-website",
    plan: "Starter+",
    mockup: "website",
    eyebrow: "Restaurant website",
    description: "Launch a branded restaurant-owned website that keeps ordering, menu content, customer trust, and launch control under your name.",
    hero: "A polished website for direct ordering, pickup, delivery, menus, hours, photos, loyalty, and restaurant updates.",
    benefits: [
      "Own the first impression before guests choose a marketplace.",
      "Publish restaurant branding, menu content, photos, hours, and calls to order.",
      "Send customers to a direct ordering site built around your restaurant."
    ],
    useCases: [
      "New restaurants launching a direct ordering channel",
      "Existing restaurants replacing a basic brochure site",
      "Operators who want a branded website connected to ordering"
    ],
    capabilities: [
      "Homepage and public navigation",
      "Restaurant profile, hours, contact, and gallery",
      "Menu and order-online calls to action",
      "Restaurant URL and future custom domain foundation"
    ],
    workflow: [
      "Create the restaurant profile.",
      "Add branding, menu, photos, hours, and ordering settings.",
      "Share the Loohar restaurant URL or connect a custom domain later."
    ],
    availability: {
      Starter: "Included",
      Professional: "Included",
      Enterprise: "Included"
    }
  },
  {
    icon: ReceiptText,
    title: "Direct Online Ordering",
    slug: "direct-online-ordering",
    href: "/features/direct-online-ordering",
    plan: "Starter+",
    mockup: "ordering",
    eyebrow: "Direct ordering",
    description: "Accept pickup and direct restaurant orders without sending guests through a marketplace checkout experience.",
    hero: "Give customers a fast way to order directly from your restaurant while keeping the relationship with your team.",
    benefits: [
      "Reduce dependency on third-party marketplace ordering.",
      "Keep order flow, customer communication, and restaurant branding connected.",
      "Support pickup-first restaurants and teams preparing for delivery."
    ],
    useCases: [
      "Pickup ordering",
      "Restaurant-owned checkout links",
      "Repeat customers who prefer ordering directly"
    ],
    capabilities: [
      "Menu categories and menu item publishing",
      "Pickup and delivery order types",
      "Customer order tracking foundation",
      "Tips and loyalty-ready order records"
    ],
    workflow: [
      "Publish menu categories and items.",
      "Enable pickup, delivery, or both.",
      "Receive orders inside the restaurant dashboard."
    ],
    availability: {
      Starter: "Included",
      Professional: "Included",
      Enterprise: "Included"
    }
  },
  {
    icon: Truck,
    title: "Delivery Management",
    slug: "delivery-management",
    href: "/features/delivery-management",
    plan: "Professional+",
    mockup: "delivery",
    eyebrow: "Delivery management",
    description: "Assign deliveries to in-house drivers, track delivery status, and keep tips and earnings visible.",
    hero: "Run restaurant-owned delivery workflows without making drivers or customers use a broad marketplace system.",
    benefits: [
      "Coordinate assigned deliveries from the restaurant dashboard.",
      "Give drivers a lightweight mobile-first delivery app.",
      "Track status, tips, delivery fees, and completed delivery history."
    ],
    useCases: [
      "Restaurants with in-house drivers",
      "Delivery zones with restaurant-controlled fees",
      "Teams that need a simple dispatch workflow"
    ],
    capabilities: [
      "Driver assignment",
      "Delivery status updates",
      "Driver PWA workflow",
      "Tips and earnings tracking"
    ],
    workflow: [
      "Enable delivery and driver management.",
      "Assign an order to an available driver.",
      "Track delivery progress through pickup, on-the-way, and delivered states."
    ],
    availability: {
      Starter: "Upgrade required",
      Professional: "Included",
      Enterprise: "Included"
    }
  },
  {
    icon: TicketPercent,
    title: "Loyalty and Marketing",
    slug: "loyalty-marketing",
    href: "/features/loyalty-marketing",
    plan: "Professional+",
    mockup: "loyalty",
    eyebrow: "Loyalty and marketing",
    description: "Build repeat visits with points, rewards, coupons, customer notes, and restaurant-owned promotions.",
    hero: "Turn direct ordering into repeat customer growth with loyalty, offers, and customer relationship tools.",
    benefits: [
      "Reward customers for ordering directly.",
      "Create promotions without handing the relationship to a marketplace.",
      "Use customer history and loyalty signals to guide retention."
    ],
    useCases: [
      "Points and rewards programs",
      "Free delivery or discount promotions",
      "Restaurant-owned customer retention"
    ],
    capabilities: [
      "Points and reward configuration",
      "Coupons and promotion foundation",
      "Customer profile and notes foundation",
      "Repeat customer visibility"
    ],
    workflow: [
      "Configure loyalty rewards and coupon rules.",
      "Promote offers through the restaurant site.",
      "Track points, redemptions, and repeat customer behavior."
    ],
    availability: {
      Starter: "Upgrade required",
      Professional: "Included",
      Enterprise: "Included"
    }
  },
  {
    icon: Activity,
    title: "Analytics and Reports",
    slug: "analytics-reports",
    href: "/features/analytics-reports",
    plan: "Enterprise",
    mockup: "analytics",
    eyebrow: "Analytics and reports",
    description: "Review sales trends, order volume, customer growth, menu performance, driver tips, and operating patterns.",
    hero: "Make decisions from restaurant-owned order, customer, delivery, loyalty, and menu performance data.",
    benefits: [
      "Understand daily, weekly, and monthly restaurant performance.",
      "Find best-selling and underperforming menu items.",
      "Connect customer growth, loyalty, order mix, and delivery results."
    ],
    useCases: [
      "Owner performance reviews",
      "Menu optimization",
      "Growth and retention planning"
    ],
    capabilities: [
      "Sales and order trends",
      "Customer growth analytics",
      "Menu insights",
      "Driver tip and delivery reporting"
    ],
    workflow: [
      "Collect orders and customer activity through Loohar.",
      "Review sales, menu, delivery, and customer metrics.",
      "Use insights to improve operations and retention."
    ],
    availability: {
      Starter: "Core order totals",
      Professional: "Operational reports",
      Enterprise: "Advanced analytics"
    }
  },
  {
    icon: LayoutDashboard,
    title: "Operations Tools",
    slug: "operations-tools",
    href: "/features/operations-tools",
    plan: "Starter to Professional",
    mockup: "operations",
    eyebrow: "Operations tools",
    description: "Manage menus, orders, kitchen flow, staff, drivers, website content, settings, and restaurant workflows.",
    hero: "Give restaurant teams one focused workspace for the day-to-day systems behind direct ordering and delivery.",
    benefits: [
      "Keep restaurant workflows in one focused SaaS dashboard.",
      "Separate owner, manager, kitchen, driver, and customer experiences.",
      "Add operational tools as the restaurant grows."
    ],
    useCases: [
      "Menu and order management",
      "Kitchen and driver coordination",
      "Website, settings, and staff workflows"
    ],
    capabilities: [
      "Menu management",
      "Order workflow",
      "Kitchen display foundation",
      "Employee and driver operations"
    ],
    workflow: [
      "Set up restaurant access and roles.",
      "Manage menu, orders, website, settings, and operational modules.",
      "Use plan entitlements to unlock advanced operations."
    ],
    availability: {
      Starter: "Core menu and orders",
      Professional: "Delivery and team workflows",
      Enterprise: "Advanced operations"
    }
  }
];

const publicFeatureBySlug = Object.fromEntries(publicFeatureCards.map((feature) => [feature.slug, feature]));
const featurePlanColumns = ["Starter", "Professional", "Enterprise"];
const featureSeoBySlug = {
  "restaurant-website": {
    title: "Restaurant Website Builder for Direct Ordering | Loohar",
    description: "Build a branded restaurant website with menu, photos, pickup, delivery, contact details, SEO content, and direct ordering calls to action."
  },
  "direct-online-ordering": {
    title: "Direct Online Ordering for Restaurants | Loohar",
    description: "Use Loohar for restaurant-owned pickup and delivery ordering, menu modifiers, order tracking, tips, and checkout-ready direct ordering workflows."
  },
  "delivery-management": {
    title: "Restaurant Delivery Management Software | Loohar",
    description: "Manage restaurant-owned delivery, driver assignments, delivery zones, driver status updates, tips, earnings, and customer tracking from Loohar."
  },
  "loyalty-marketing": {
    title: "Restaurant Loyalty and Marketing Tools | Loohar",
    description: "Grow repeat customers with restaurant-owned loyalty points, rewards, coupons, promotions, and customer retention tools in Loohar."
  },
  "analytics-reports": {
    title: "Restaurant Analytics and Reports | Loohar",
    description: "Review Loohar restaurant sales, order volume, customer growth, loyalty, menu performance, delivery, tips, and operations reporting."
  },
  "operations-tools": {
    title: "Restaurant Operations Management Tools | Loohar",
    description: "Run restaurant menu, orders, kitchen workflow, staff, driver dispatch, website, media, and settings operations from one Loohar workspace."
  }
};

function featureSlugFromPath(path = "") {
  const normalizedPath = String(path || "").replace(/\/+$/, "") || "/";
  const match = normalizedPath.match(/^\/features\/([^/?#]+)$/);
  return match?.[1] || "";
}

function MarketingFeatureMockup({ type }) {
  if (type === "website") {
    return (
      <div className="marketing-mockup website" aria-hidden="true">
        <div className="mock-toolbar"><span /><span /><span /></div>
        <div className="mock-hero"><strong>Direct ordering</strong><small>Pickup and delivery</small></div>
        <div className="mock-card-row"><span /><span /><span /></div>
      </div>
    );
  }
  if (type === "ordering") {
    return (
      <div className="marketing-phone" aria-hidden="true">
        <div className="phone-notch" />
        <div className="order-line"><span>Garlic noodles</span><strong>$14</strong></div>
        <div className="order-line"><span>Fresh salad</span><strong>$11</strong></div>
        <div className="order-total"><span>Total</span><strong>$25</strong></div>
        <div className="phone-cta">Checkout</div>
      </div>
    );
  }
  if (type === "delivery") {
    return (
      <div className="marketing-route" aria-hidden="true">
        <MapPin size={18} />
        <div className="route-line" />
        <Truck size={20} />
        <div className="route-chip">Assigned</div>
        <div className="route-earnings">$7.50 tip</div>
      </div>
    );
  }
  if (type === "loyalty") {
    return (
      <div className="marketing-loyalty" aria-hidden="true">
        <CheckCircle2 size={22} />
        <strong>Reward ready</strong>
        <span>Free delivery</span>
        <div className="loyalty-progress"><span /></div>
      </div>
    );
  }
  if (type === "analytics") {
    return (
      <div className="marketing-chart" aria-hidden="true">
        <div className="chart-total">Sales trend</div>
        <div className="chart-bars"><span /><span /><span /><span /><span /></div>
      </div>
    );
  }
  return (
    <div className="marketing-menu-card" aria-hidden="true">
      <div><span />Menu item</div>
      <div><span />Kitchen queue</div>
      <div><span />Driver dispatch</div>
    </div>
  );
}

function PublicHome({ user, onLogout }) {
  const trustItems = [
    { icon: Store, label: "Restaurant-owned ordering" },
    { icon: Users, label: "Direct customer relationships" },
    { icon: CreditCard, label: "Secure payment architecture" },
    { icon: Shield, label: "Multi-tenant operations" },
    { icon: PackageCheck, label: "Mobile-ready experiences" }
  ];
  const securityItems = [
    "Secure authentication and role-based access",
    "Tenant-isolated restaurant data",
    "Stripe-hosted subscription checkout",
    "Stripe Connect merchant onboarding",
    "Separate SaaS and order accounting foundations",
    "Secure image storage through backend upload controls",
    "Audit logging for sensitive platform actions",
    "Mobile-ready registration and restaurant onboarding"
  ];
  const planCards = [
    { name: "Starter", detail: "Website, menu, direct ordering, and pickup for restaurants getting online fast." },
    { name: "Professional", detail: "Delivery, drivers, loyalty, coupons, CRM, and operational tools for growing teams." },
    { name: "Enterprise", detail: "Advanced analytics, custom domain support, and multi-location foundations." }
  ];

  useEffect(() => {
    applyHomepageSeo();
  }, []);

  return (
    <PublicLayout user={user} onLogout={onLogout} className="marketing-page">
        <section className="marketing-hero" aria-labelledby="homepage-hero-title">
          <img className="marketing-hero-image" src="/marketing/loohar-restaurant-hero.png" alt="Premium restaurant interior with dining room and order counter" width="1792" height="1024" fetchpriority="high" />
          <div className="marketing-hero-overlay" />
          <div className="public-container marketing-hero-content">
            <div className="marketing-hero-copy">
              <p className="marketing-eyebrow">Restaurant direct ordering platform</p>
              <h1 id="homepage-hero-title">Loohar</h1>
              <p>Restaurant websites, direct ordering, pickup, delivery, loyalty, and operations in one restaurant-owned SaaS platform.</p>
              <div className="marketing-hero-actions">
                <PublicLink className="public-button primary large" href="/register"><LogIn size={18} />Get Started</PublicLink>
                <PublicLink className="public-button inverse large" href="/pricing"><CreditCard size={18} />View Pricing</PublicLink>
              </div>
              <div className="marketing-hero-badges" aria-label="Loohar launch benefits">
                <span><Shield size={16} />No setup fees</span>
                <span><Clock size={16} />Launch in minutes</span>
                <span><Users size={16} />Restaurant-owned customer relationships</span>
              </div>
            </div>
          </div>
        </section>

        <section className="marketing-feature-grid" id="features" aria-label="Loohar features">
          {publicFeatureCards.map(({ icon: Icon, title, plan, description, mockup, href }) => (
            <PublicLink className="marketing-card marketing-feature-card marketing-feature-link-card" href={href} key={title} aria-label={`Learn more about ${title}`}>
              <div className="marketing-feature-copy">
                <span className="marketing-feature-icon"><Icon size={24} /></span>
                <p className="marketing-plan-chip">{plan}</p>
                <h2>{title}</h2>
                <p>{description}</p>
                <span className="learn-more-link marketing-card-learn-more"><span>Learn more</span><ArrowRight size={15} aria-hidden="true" /></span>
              </div>
              <MarketingFeatureMockup type={mockup} />
            </PublicLink>
          ))}
        </section>

        <section className="marketing-trust-strip" aria-label="Platform trust signals">
          {trustItems.map(({ icon: Icon, label }) => (
            <div key={label}>
              <Icon size={28} />
              <span>{label}</span>
            </div>
          ))}
        </section>

        <section className="marketing-split" id="product">
          <div>
            <p className="marketing-eyebrow dark">Product</p>
            <h2>Own your restaurant&apos;s digital experience.</h2>
          </div>
          <div>
            <p>
              Loohar gives local restaurants a restaurant-owned ordering channel with branded websites, pickup, delivery, driver workflow,
              loyalty, coupons, and daily operations in one focused SaaS platform.
            </p>
            <div className="marketing-inline-actions">
              <PublicLink className="public-button primary" href="/register">Start registration</PublicLink>
              <PublicLink className="public-button secondary" href="/pricing">Compare plans</PublicLink>
            </div>
          </div>
        </section>

        <section className="marketing-process" id="how-it-works">
          <div className="marketing-section-heading">
            <p className="marketing-eyebrow dark">How it works</p>
            <h2>From restaurant signup to direct orders.</h2>
          </div>
          <div className="marketing-process-grid">
            <MarketingCard>
              <span>01</span>
              <h3>Register the restaurant</h3>
              <p>Select a plan, create the restaurant profile, and start the onboarding flow.</p>
            </MarketingCard>
            <MarketingCard>
              <span>02</span>
              <h3>Set up the storefront</h3>
              <p>Add branding, menu content, pickup, delivery, hours, photos, and restaurant settings.</p>
            </MarketingCard>
            <MarketingCard>
              <span>03</span>
              <h3>Operate direct orders</h3>
              <p>Manage orders, drivers, loyalty, coupons, reporting, and customer relationships from Loohar.</p>
            </MarketingCard>
          </div>
        </section>

        <section className="marketing-pricing-cta" id="pricing-overview">
          <div>
            <p className="marketing-eyebrow dark">Pricing</p>
            <h2>Choose the right plan for your restaurant.</h2>
            <p>Start with direct ordering and pickup, then add delivery, loyalty, CRM, and advanced operations as the restaurant grows.</p>
          </div>
          <div className="marketing-plan-grid">
            {planCards.map((plan) => (
              <MarketingCard key={plan.name}>
                <h3>{plan.name}</h3>
                <p>{plan.detail}</p>
              </MarketingCard>
            ))}
          </div>
          <PublicLink className="public-button primary" href="/pricing">View Pricing</PublicLink>
        </section>

        <section className="marketing-security" id="security">
          <div className="marketing-section-heading">
            <p className="marketing-eyebrow dark">Security and trust</p>
            <h2>Built for restaurant operations, subscriptions, and direct payments.</h2>
            <p>Loohar keeps public storefronts, admin dashboards, delivery workflows, and subscription controls separated by role and tenant.</p>
          </div>
          <div className="marketing-security-grid">
            {securityItems.map((item) => (
              <div key={item}><CheckCircle2 size={18} />{item}</div>
            ))}
          </div>
        </section>

        <section className="marketing-about" id="about">
          <div>
            <p className="marketing-eyebrow dark">About Loohar</p>
            <h2>A focused restaurant growth platform.</h2>
          </div>
          <p>
            Loohar is designed around one clear promise: help restaurants reduce marketplace dependency by owning their ordering,
            delivery, customer, loyalty, and operations experience.
          </p>
        </section>

        <section className="marketing-final-cta" id="resources">
          <p className="marketing-eyebrow">Ready for direct ordering?</p>
          <h2>Launch a restaurant-owned ordering channel with Loohar.</h2>
          <div className="marketing-hero-actions">
            <PublicLink className="public-button primary large" href="/register">Register Your Restaurant</PublicLink>
            <PublicLink className="public-button inverse large" href="/pricing">View Pricing</PublicLink>
          </div>
        </section>
    </PublicLayout>
  );
}

function FeatureHero({ feature }) {
  const Icon = feature.icon;
  return (
    <section className="feature-detail-hero">
      <div className="public-container feature-detail-grid">
        <div className="feature-detail-copy">
          <nav className="feature-breadcrumbs" aria-label="Breadcrumb">
            <PublicLink href="/">Home</PublicLink>
            <span>/</span>
            <PublicLink href="/features">Features</PublicLink>
            <span>/</span>
            <span>{feature.title}</span>
          </nav>
          <p className="marketing-eyebrow dark">{feature.eyebrow}</p>
          <h1 className="public-page-title">{feature.title}</h1>
          <p className="public-page-lede">{feature.hero}</p>
          <div className="feature-detail-actions">
            <PublicLink className="public-button primary large" href={`/pricing?feature=${feature.slug}`}>View plan availability</PublicLink>
            <PublicLink className="public-button secondary large" href="/register">Register Your Restaurant</PublicLink>
          </div>
        </div>
        <div className="feature-detail-visual" aria-label={`${feature.title} interface preview`}>
          <span className="feature-detail-icon"><Icon size={28} /></span>
          <MarketingFeatureMockup type={feature.mockup} />
        </div>
      </div>
    </section>
  );
}

function FeatureBenefits({ feature }) {
  return (
    <section className="public-container feature-detail-section">
      <div className="feature-detail-section-head">
        <p className="marketing-eyebrow dark">Benefits</p>
        <h2>What this helps restaurants do</h2>
      </div>
      <div className="feature-benefit-grid">
        {feature.benefits.map((benefit) => (
          <MarketingCard key={benefit}>
            <CheckCircle2 size={20} />
            <p>{benefit}</p>
          </MarketingCard>
        ))}
      </div>
    </section>
  );
}

function FeatureUseCases({ feature }) {
  return (
    <section className="public-container feature-detail-section">
      <div className="feature-detail-section-head">
        <p className="marketing-eyebrow dark">Use cases</p>
        <h2>Where it fits in daily restaurant work</h2>
      </div>
      <div className="feature-capability-grid">
        {feature.useCases.map((useCase) => (
          <MarketingCard key={useCase}>
            <h3>{useCase}</h3>
            <p>Built for restaurant teams that need a focused, direct, and easy-to-explain workflow.</p>
          </MarketingCard>
        ))}
      </div>
    </section>
  );
}

function FeatureCapabilities({ feature }) {
  return (
    <section className="public-container feature-detail-section">
      <div className="feature-detail-section-head">
        <p className="marketing-eyebrow dark">Capabilities</p>
        <h2>Included workflow areas</h2>
      </div>
      <div className="feature-capability-grid">
        {feature.capabilities.map((capability) => (
          <div className="feature-capability-item" key={capability}>
            <span />
            <strong>{capability}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeatureWorkflow({ feature }) {
  return (
    <section className="public-container feature-detail-section">
      <div className="feature-detail-section-head">
        <p className="marketing-eyebrow dark">Workflow</p>
        <h2>How teams use it</h2>
      </div>
      <div className="feature-workflow-grid">
        {feature.workflow.map((step, index) => (
          <MarketingCard key={step}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <p>{step}</p>
          </MarketingCard>
        ))}
      </div>
    </section>
  );
}

function FeaturePlanAvailability({ feature }) {
  return (
    <section className="public-container feature-detail-section">
      <div className="feature-detail-section-head">
        <p className="marketing-eyebrow dark">Plan availability</p>
        <h2>Know what is included before signup</h2>
      </div>
      <div className="feature-plan-grid" aria-label={`${feature.title} plan availability`}>
        {featurePlanColumns.map((planName) => (
          <MarketingCard className="feature-plan-card" key={planName}>
            <h3>{planName}</h3>
            <p>{feature.availability[planName]}</p>
          </MarketingCard>
        ))}
      </div>
    </section>
  );
}

function FeatureCTA({ feature }) {
  return (
    <section className="feature-cta">
      <div className="public-container">
        <p className="marketing-eyebrow">Ready to use {feature.title.toLowerCase()}?</p>
        <h2>Launch a restaurant-owned ordering channel with Loohar.</h2>
        <div className="feature-detail-actions">
          <PublicLink className="public-button primary large" href="/register">Register Your Restaurant</PublicLink>
          <PublicLink className="public-button inverse large" href="/pricing">View Pricing</PublicLink>
        </div>
      </div>
    </section>
  );
}

function RelatedFeatures({ features }) {
  return (
    <section className="public-container feature-detail-section">
      <div className="feature-detail-section-head">
        <p className="marketing-eyebrow dark">Related features</p>
        <h2>Explore more Loohar workflows</h2>
      </div>
      <div className="feature-related-grid">
        {features.map(({ icon: RelatedIcon, title, description, href }) => (
          <PublicLink className="marketing-card feature-related-card" href={href} key={href}>
            <span className="marketing-feature-icon"><RelatedIcon size={22} /></span>
            <h3>{title}</h3>
            <p>{description}</p>
            <span className="learn-more-link marketing-card-learn-more"><span>Explore feature</span><ArrowRight size={15} aria-hidden="true" /></span>
          </PublicLink>
        ))}
      </div>
    </section>
  );
}

function FeatureDetailPage({ path, user, onLogout }) {
  const slug = featureSlugFromPath(path);
  const feature = publicFeatureBySlug[slug];
  const relatedFeatures = (feature ? publicFeatureCards.filter((item) => item.slug !== feature.slug) : publicFeatureCards).slice(0, 3);
  const featureSeo = feature ? featureSeoBySlug[feature.slug] : null;
  const seoTitle = featureSeo?.title || "Loohar | Restaurant SaaS Features";
  const seoDescription = featureSeo?.description || "Explore Loohar restaurant website, direct ordering, delivery, loyalty, analytics, and operations features.";
  const canonicalPath = feature ? feature.href : "/features";

  useEffect(() => {
    applyMarketingSeo({
      title: seoTitle,
      description: seoDescription,
      path: canonicalPath
    });
    if (feature) applyFeatureSchema(feature);
    else document.getElementById("loohar-feature-jsonld")?.remove();
  }, [canonicalPath, feature, seoDescription, seoTitle]);

  if (!feature) {
    return (
      <PublicLayout user={user} onLogout={onLogout} className="feature-detail-page">
        <section className="public-container feature-overview-hero">
          <p className="marketing-eyebrow dark">Features</p>
          <h1 className="public-page-title">Restaurant growth tools built around direct ordering.</h1>
          <p className="public-page-lede">
            Loohar brings restaurant websites, ordering, delivery, loyalty, analytics, and operations into one restaurant-owned platform.
          </p>
          <div className="public-info-actions">
            <PublicLink className="public-button primary" href="/register">Register Your Restaurant</PublicLink>
            <PublicLink className="public-button secondary" href="/pricing">View Pricing</PublicLink>
          </div>
        </section>
        <section className="public-container feature-related-grid" aria-label="Loohar feature pages">
          {publicFeatureCards.map(({ icon: Icon, title, description, href, plan }) => (
            <PublicLink className="marketing-card feature-related-card" href={href} key={href}>
              <span className="marketing-feature-icon"><Icon size={22} /></span>
              <p className="marketing-plan-chip">{plan}</p>
              <h2>{title}</h2>
              <p>{description}</p>
              <span className="learn-more-link marketing-card-learn-more"><span>Explore feature</span><ArrowRight size={15} aria-hidden="true" /></span>
            </PublicLink>
          ))}
        </section>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout user={user} onLogout={onLogout} className="feature-detail-page">
      <FeatureHero feature={feature} />
      <FeatureBenefits feature={feature} />
      <FeatureUseCases feature={feature} />
      <FeatureCapabilities feature={feature} />
      <FeatureWorkflow feature={feature} />
      <FeaturePlanAvailability feature={feature} />
      <FeatureCTA feature={feature} />
      <RelatedFeatures features={relatedFeatures} />
    </PublicLayout>
  );
}

const publicPageContent = {
  "/about": {
    eyebrow: "About Loohar",
    title: "A focused restaurant growth platform.",
    description: "Loohar helps local food businesses own their digital ordering, delivery, customer relationships, loyalty, and daily operations without becoming dependent on third-party marketplaces.",
    cards: [
      ["Restaurant-owned channels", "Branded storefronts, direct ordering, and customer relationships stay connected to the restaurant."],
      ["Operational clarity", "Menus, orders, delivery, kitchen workflow, staff, loyalty, coupons, and reporting are managed from one system."],
      ["Food-commerce focus", "Loohar stays centered on restaurants, coffee shops, bakeries, food trucks, and local food retail."]
    ]
  },
  "/security": {
    eyebrow: "Security",
    title: "Trustworthy by design for restaurants and customers.",
    description: "The Loohar platform separates tenants, roles, subscriptions, restaurant operations, public storefronts, and payment responsibilities across the system.",
    cards: [
      ["Role-based access", "Platform owners, restaurant operators, kitchen staff, drivers, and customers receive separate access paths."],
      ["Tenant isolation", "Restaurant-owned records are scoped to the assigned tenant across API workflows."],
      ["Payment separation", "SaaS subscriptions and restaurant order payment foundations remain distinct."]
    ]
  },
  "/support": {
    eyebrow: "Support",
    title: "Help for restaurant teams using Loohar.",
    description: "For onboarding, account, billing, domain, or restaurant operations help, contact the Loohar team.",
    cards: [
      ["Email support", "Reach Loohar at support@loohar.com for account and product questions."],
      ["Restaurant setup", "Get help with menus, branding, restaurant URLs, delivery settings, and launch readiness."],
      ["Account recovery", "Use the password reset flow when a restaurant owner or platform user needs secure account recovery."]
    ]
  },
  "/privacy": {
    eyebrow: "Privacy",
    title: "Restaurant and customer privacy matters.",
    description: "Loohar is built to help restaurants manage customer relationships responsibly. Production privacy policy language should be reviewed before broad public launch.",
    cards: [
      ["Customer data", "Customer profiles, orders, loyalty, and delivery data belong inside the restaurant tenant experience."],
      ["Limited access", "Roles and permissions limit who can view operational and customer records."],
      ["Policy readiness", "Legal review should confirm final privacy language before large-scale commercialization."]
    ]
  },
  "/terms": {
    eyebrow: "Terms",
    title: "Loohar platform terms.",
    description: "Loohar provides restaurant-owned websites, ordering, delivery, loyalty, and operations software. Final legal terms should be reviewed before public launch.",
    cards: [
      ["Restaurant SaaS", "Plans provide access to restaurant ordering and operations features based on subscription entitlements."],
      ["Merchant responsibility", "Restaurants are responsible for menu accuracy, fulfillment, customer service, and applicable local requirements."],
      ["Launch readiness", "Terms and billing language should be finalized with counsel before full production rollout."]
    ]
  }
};

function PublicInfoPage({ path, user, onLogout }) {
  const normalizedPath = path.startsWith("/resources") ? "/resources" : path;
  const content = normalizedPath === "/resources"
    ? {
      eyebrow: "Resources",
      title: "Guides for restaurant-owned digital growth.",
      description: "Explore Loohar resources for direct ordering, restaurant onboarding, delivery operations, loyalty, and platform security.",
      cards: [
        ["Direct ordering", "Why restaurants build their own ordering channel alongside or instead of marketplace dependency."],
        ["Delivery operations", "How driver assignment, delivery status, tips, and earnings fit into the restaurant workflow."],
        ["Launch checklist", "Branding, menu setup, pickup, delivery, payment readiness, domains, and customer communication."]
      ]
    }
    : publicPageContent[normalizedPath] || publicPageContent["/about"];

  useEffect(() => {
    applyMarketingSeo({
      title: `Loohar | ${content.title.replace(/\.$/, "")}`,
      description: content.description,
      path: normalizedPath
    });
  }, [content.description, content.title, normalizedPath]);

  return (
    <PublicLayout user={user} onLogout={onLogout} className="public-info-page">
      <section className="public-container public-info-hero">
        <p className="marketing-eyebrow dark">{content.eyebrow}</p>
        <h1>{content.title}</h1>
        <p>{content.description}</p>
        <div className="public-info-actions">
          <PublicLink className="public-button primary" href="/register">Register Your Restaurant</PublicLink>
          <PublicLink className="public-button secondary" href="/pricing">View Pricing</PublicLink>
        </div>
      </section>
      <section className="public-container public-info-grid" aria-label={`${content.eyebrow} details`}>
        {content.cards.map(([title, detail]) => (
          <MarketingCard key={title}>
            <h2>{title}</h2>
            <p>{detail}</p>
            <LearnMoreLink href={title === "Email support" ? "mailto:support@loohar.com" : "/register"}>{title === "Email support" ? "Contact support" : "Learn more"}</LearnMoreLink>
          </MarketingCard>
        ))}
      </section>
    </PublicLayout>
  );
}

function PricingPage({ apiOnline, apiMode = apiOnline ? "LIVE" : "DEMO" }) {
  const [plans, setPlans] = useState(fallbackRegistrationPlans);
  const [billingInterval, setBillingInterval] = useState("MONTHLY");
  const [planConfigStatus, setPlanConfigStatus] = useState(PLAN_CONFIG_STATUS.IDLE);
  const [planRequestKey, setPlanRequestKey] = useState(0);
  const [error, setError] = useState("");
  const planConfigIsPending = planConfigPending(planConfigStatus);

  useEffect(() => {
    if (apiMode === "CHECKING") {
      setPlanConfigStatus(PLAN_CONFIG_STATUS.IDLE);
      setError("");
      return;
    }
    if (!apiOnline) {
      setPlans(fallbackRegistrationPlans);
      setPlanConfigStatus(PLAN_CONFIG_STATUS.ERROR);
      setError("Setup availability could not be confirmed because the live API is offline.");
      return;
    }
    setPlanConfigStatus(PLAN_CONFIG_STATUS.LOADING);
    setError("");
    api("/api/registration/plans", { skipAuth: true })
      .then((payload) => {
        setPlans(payload.plans?.length ? payload.plans : fallbackRegistrationPlans);
        setPlanConfigStatus(PLAN_CONFIG_STATUS.READY);
      })
      .catch((planError) => {
        setPlans(fallbackRegistrationPlans);
        setError(planError.message || "Setup availability could not be confirmed. Please try again.");
        setPlanConfigStatus(PLAN_CONFIG_STATUS.ERROR);
      });
  }, [apiMode, apiOnline, planRequestKey]);

  return (
    <RegistrationShell>
      <section className="panel">
        <p className="text-xs font-bold uppercase tracking-wide text-mint">Loohar pricing</p>
        <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="public-page-title">Restaurant-owned ordering starts here.</h1>
            <p className="mt-3 max-w-2xl text-slate-500">Choose a SaaS plan for your restaurant website, pickup, delivery, loyalty, and operations. Checkout uses Loohar’s Stripe Billing account and stays separate from customer order payments.</p>
          </div>
          <div className="flex rounded-md border border-line bg-white p-1">
            {["MONTHLY", "ANNUAL"].map((interval) => <button className={`seg ${billingInterval === interval ? "active" : ""}`} key={interval} type="button" onClick={() => setBillingInterval(interval)}>{readable(interval)}</button>)}
          </div>
        </div>
        {planConfigIsPending ? (
          <div className="mt-4 min-h-14 rounded-md border border-line bg-slate-50 p-3 text-sm font-semibold text-slate-600" aria-live="polite">
            Checking secure checkout availability...
          </div>
        ) : null}
        {planConfigStatus === PLAN_CONFIG_STATUS.ERROR ? (
          <div className="mt-4 flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 md:flex-row md:items-center md:justify-between" role="status">
            <span className="font-semibold">{error || "Setup availability could not be confirmed. Please try again."}</span>
            <button className="button-muted justify-center" type="button" onClick={() => setPlanRequestKey((key) => key + 1)}>Retry</button>
          </div>
        ) : null}
      </section>
      <section className="mt-5 grid gap-4 md:grid-cols-3">
        {planConfigIsPending ? <PlanCardSkeletons count={3} /> : plans.map((plan) => {
          const checkoutStatus = checkoutStatusForPlan(plan, billingInterval, planConfigStatus);
          const startMode = planStartMode(plan, billingInterval);
          const available = planConfigStatus === PLAN_CONFIG_STATUS.READY && planStartAvailable(plan, billingInterval);
          return (
            <div className="panel flex flex-col" key={plan.code}>
              <StatusPill tone={checkoutStatus.tone}>{checkoutStatus.label}</StatusPill>
              <h2 className="public-plan-title">{plan.displayName || normalizePlanLabel(plan.code)}</h2>
              <p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">{plan.description}</p>
              <p className="public-plan-price">{money(planPrice(plan, billingInterval))}<span>/{billingInterval === "ANNUAL" ? "year" : "month"}</span></p>
              {planIntroAvailable(plan) ? <p className="mt-2 text-sm font-bold text-mint">{plan.trialDays || fallbackIntroTrialDays}-day introductory program</p> : plan.trialDays ? <p className="mt-2 text-sm font-bold text-mint">{plan.trialDays}-day trial configured</p> : null}
              <div className="mt-5 space-y-3">
                {(plan.features || []).map((feature) => <p className="flex items-start gap-2 text-sm text-slate-600" key={feature}><CheckCircle2 className="mt-0.5 text-mint" size={16} />{feature}</p>)}
              </div>
              <a className={`mt-6 justify-center ${available ? "button-primary" : "button-muted"}`} href={`/register?plan=${encodeURIComponent(plan.code)}&billingInterval=${billingInterval}`}>
                {available && startMode === "INTRO_TRIAL" ? "Start intro program" : available ? "Select plan" : "Start setup"}
              </a>
            </div>
          );
        })}
      </section>
    </RegistrationShell>
  );
}

function RegistrationPage({ apiOnline, apiMode = apiOnline ? "LIVE" : "DEMO" }) {
  const query = new window.URLSearchParams(window.location.search);
  const initialPlan = planCodes.includes(query.get("plan")) ? query.get("plan") : "STARTER";
  const initialInterval = query.get("billingInterval") === "ANNUAL" ? "ANNUAL" : "MONTHLY";
  const [plans, setPlans] = useState(fallbackRegistrationPlans);
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState({ ...registrationInitialForm, planCode: initialPlan, billingInterval: initialInterval });
  const [errors, setErrors] = useState({});
  const [slugStatus, setSlugStatus] = useState(null);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [composingFields, setComposingFields] = useState({});
  const [registration, setRegistration] = useState(null);
  const [planConfigStatus, setPlanConfigStatus] = useState(PLAN_CONFIG_STATUS.IDLE);
  const [planRequestKey, setPlanRequestKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(query.get("billing") === "cancelled" ? "Checkout was cancelled. You can review details and try again before the reservation expires." : "");
  const [error, setError] = useState("");
  const [planError, setPlanError] = useState("");
  const slugRequestRef = useRef({ controller: null, sequence: 0 });
  const submittingRef = useRef(false);
  const currentStep = registrationSteps[stepIndex]?.id || "account";
  const selectedPlan = plans.find((plan) => plan.code === form.planCode) || plans[0] || fallbackRegistrationPlans[0];
  const selectedStartMode = planStartMode(selectedPlan, form.billingInterval);
  const visibleErrors = registrationVisibleErrors(errors, currentStep);
  const planConfigIsPending = planConfigPending(planConfigStatus);
  const planCheckoutAvailable = planStartAvailable(selectedPlan, form.billingInterval);
  const checkoutReady = apiOnline && planConfigStatus === PLAN_CONFIG_STATUS.READY && planCheckoutAvailable;

  useEffect(() => {
    if (apiMode === "CHECKING") {
      setPlanConfigStatus(PLAN_CONFIG_STATUS.IDLE);
      setPlanError("");
      return;
    }
    if (!apiOnline) {
      setPlans(fallbackRegistrationPlans);
      setPlanConfigStatus(PLAN_CONFIG_STATUS.ERROR);
      setPlanError("Setup availability could not be confirmed because the live API is offline.");
      return;
    }
    setPlanConfigStatus(PLAN_CONFIG_STATUS.LOADING);
    setPlanError("");
    api("/api/registration/plans", { skipAuth: true })
      .then((payload) => {
        setPlans(payload.plans?.length ? payload.plans : fallbackRegistrationPlans);
        setPlanConfigStatus(PLAN_CONFIG_STATUS.READY);
      })
      .catch((planLoadError) => {
        setPlans(fallbackRegistrationPlans);
        setPlanError(planLoadError.message || "Setup availability could not be confirmed. Please try again.");
        setPlanConfigStatus(PLAN_CONFIG_STATUS.ERROR);
      });
  }, [apiMode, apiOnline, planRequestKey]);

  useEffect(() => () => slugRequestRef.current.controller?.abort(), []);

  function registrationIsComposing(event) {
    return Boolean(event?.nativeEvent?.isComposing || Object.values(composingFields).some(Boolean));
  }

  function updateField(field, value, options = {}) {
    const composing = Boolean(options.isComposing ?? composingFields[field]);
    setErrors((existing) => ({ ...existing, [field]: "" }));
    if (field === "preferredSlug" || field === "publicBusinessName") setSlugStatus(null);
    if (field === "preferredSlug") setSlugManuallyEdited(true);
    setForm((existing) => {
      const next = { ...existing, [field]: value };
      if (field === "publicBusinessName" && !slugManuallyEdited && !composing) next.preferredSlug = slugFromName(value);
      if (field === "preferredSlug") next.preferredSlug = composing ? value : slugInputValue(value);
      return next;
    });
  }

  function handleCompositionStart(field) {
    setComposingFields((current) => ({ ...current, [field]: true }));
  }

  function handleCompositionEnd(field, value) {
    setComposingFields((current) => ({ ...current, [field]: false }));
    updateField(field, value, { isComposing: false });
  }

  async function checkSlug() {
    const normalizedSlug = slugFromName(form.preferredSlug || "");
    if (normalizedSlug !== form.preferredSlug) {
      setForm((existing) => ({ ...existing, preferredSlug: normalizedSlug }));
    }
    const slugValidation = validatePublicSlug(normalizedSlug);
    if (!slugValidation.ok) {
      setSlugStatus({ available: false, reason: slugValidation.error });
      return;
    }
    if (!apiOnline) {
      setSlugStatus({ available: false, reason: "Live API is required to reserve a restaurant URL." });
      return;
    }
    slugRequestRef.current.controller?.abort();
    const controller = new window.AbortController();
    const sequence = slugRequestRef.current.sequence + 1;
    slugRequestRef.current = { controller, sequence };
    setSlugStatus({ checking: true, reason: "Checking availability...", slug: normalizedSlug });
    try {
      const payload = await api(`/api/registration/slug/${encodeURIComponent(normalizedSlug)}?email=${encodeURIComponent(form.email || "")}`, { skipAuth: true, signal: controller.signal });
      if (slugRequestRef.current.sequence === sequence) setSlugStatus({ ...payload, slug: normalizedSlug });
    } catch (slugError) {
      if (slugError.name === "AbortError") return;
      if (slugRequestRef.current.sequence === sequence) setSlugStatus({ available: false, reason: slugError.message, slug: normalizedSlug });
    }
  }

  function continueStep(event) {
    event?.preventDefault();
    if (registrationIsComposing(event)) return;
    const nextErrors = validateRegistrationStep(form, currentStep);
    const nextStepErrors = { ...nextErrors };
    if (currentStep === "business" && slugStatus?.available === false) {
      nextStepErrors.preferredSlug = slugStatus.reason || "Choose an available restaurant URL.";
    }
    setErrors(nextStepErrors);
    if (Object.keys(nextStepErrors).length) return;
    setStepIndex((index) => Math.min(index + 1, registrationSteps.length - 1));
  }

  async function submitRegistration(event) {
    event?.preventDefault();
    if (registrationIsComposing(event) || submittingRef.current) return;
    const combinedErrors = registrationSteps.reduce((acc, step) => ({ ...acc, ...validateRegistrationStep(form, step.id) }), {});
    setErrors(combinedErrors);
    setError("");
    if (Object.keys(combinedErrors).length) {
      const firstInvalidStepIndex = registrationSteps.findIndex((step) => registrationVisibleErrors(combinedErrors, step.id).length);
      if (firstInvalidStepIndex >= 0) setStepIndex(firstInvalidStepIndex);
      return;
    }
    if (!checkoutReady) {
      if (planConfigIsPending) setError("Plan details are still loading. Please wait a moment.");
      else if (planConfigStatus === PLAN_CONFIG_STATUS.ERROR) setError(planError || "Checkout availability could not be confirmed. Please retry plan details.");
      else setError(apiOnline ? "Plan setup is temporarily unavailable. Please contact Loohar support to finish setup." : "Live API is required to start setup.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const started = registration?.id ? { registration } : await api("/api/registration/start", { method: "POST", skipAuth: true, body: form });
      const activeRegistration = started.registration;
      setRegistration(activeRegistration);
      if (selectedStartMode === "INTRO_TRIAL") {
        const intro = await api("/api/registration/intro-trial", {
          method: "POST",
          skipAuth: true,
          body: { registrationId: activeRegistration.id, planCode: form.planCode, billingInterval: form.billingInterval }
        });
        const registrationIdForStatus = intro.registration?.id || activeRegistration.id;
        navigateInApp(`/register/status?registrationId=${encodeURIComponent(registrationIdForStatus)}`, { replace: true });
        return;
      }
      const checkout = await api("/api/registration/checkout", {
        method: "POST",
        skipAuth: true,
        body: { registrationId: activeRegistration.id, planCode: form.planCode, billingInterval: form.billingInterval }
      });
      window.location.assign(checkout.checkoutUrl);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const registrationInputProps = { form, errors, onFieldChange: updateField, onCompositionStart: handleCompositionStart, onCompositionEnd: handleCompositionEnd };

  return (
    <RegistrationShell>
      <section className="panel">
        <p className="text-xs font-bold uppercase tracking-wide text-mint">Self-service setup</p>
        <h1 className="public-page-title">Register your restaurant on Loohar.</h1>
        <p className="mt-3 max-w-3xl text-slate-500">Create the owner account, reserve your restaurant URL, choose a SaaS plan, and start the Loohar introductory program. Paid checkout remains available when Loohar enables payment collection.</p>
        <div className="mt-5 grid gap-2 md:grid-cols-4">
          {registrationSteps.map((step, index) => (
            <button
              aria-current={index === stepIndex ? "step" : undefined}
              className={`seg justify-center ${index === stepIndex ? "active" : ""}`}
              disabled={index > stepIndex}
              key={step.id}
              type="button"
              onClick={() => {
                if (index <= stepIndex) setStepIndex(index);
              }}
            >
              {index + 1}. {step.label}
            </button>
          ))}
        </div>
        {message ? <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">{message}</div> : null}
        <InlineError message={error} />
      </section>

      <form className="panel mt-5" noValidate onSubmit={currentStep === "checkout" ? submitRegistration : continueStep}>
        {currentStep === "account" ? (
          <div>
            <SectionHeader eyebrow="Step 1" title="Owner account" icon={UserCog} />
            <div className="grid gap-3 md:grid-cols-2">
              <RegistrationInput {...registrationInputProps} field="firstName" label="First name" autoComplete="given-name" />
              <RegistrationInput {...registrationInputProps} field="lastName" label="Last name" autoComplete="family-name" />
              <RegistrationInput {...registrationInputProps} field="email" label="Email" type="email" autoComplete="email" />
              <RegistrationInput {...registrationInputProps} field="phone" label="Phone" type="tel" autoComplete="tel" />
              <RegistrationInput {...registrationInputProps} field="password" label="Password" type="password" autoComplete="new-password" />
              <RegistrationInput {...registrationInputProps} field="confirmPassword" label="Confirm password" type="password" autoComplete="new-password" />
            </div>
            <div className="mt-4 grid gap-2">
              <label className="flex min-h-11 items-center gap-3 text-sm text-slate-600" htmlFor="registration-termsAccepted"><input aria-describedby={errors.termsAccepted ? "registration-termsAccepted-error" : undefined} aria-invalid={Boolean(errors.termsAccepted)} checked={form.termsAccepted} className="h-5 w-5" id="registration-termsAccepted" name="termsAccepted" onChange={(event) => updateField("termsAccepted", event.target.checked)} type="checkbox" />I accept the Loohar Terms of Service.</label>
              <FieldError id="registration-termsAccepted-error" message={errors.termsAccepted} />
              <label className="flex min-h-11 items-center gap-3 text-sm text-slate-600" htmlFor="registration-privacyAccepted"><input aria-describedby={errors.privacyAccepted ? "registration-privacyAccepted-error" : undefined} aria-invalid={Boolean(errors.privacyAccepted)} checked={form.privacyAccepted} className="h-5 w-5" id="registration-privacyAccepted" name="privacyAccepted" onChange={(event) => updateField("privacyAccepted", event.target.checked)} type="checkbox" />I accept the Loohar Privacy Policy.</label>
              <FieldError id="registration-privacyAccepted-error" message={errors.privacyAccepted} />
            </div>
          </div>
        ) : null}

        {currentStep === "business" ? (
          <div>
            <SectionHeader eyebrow="Step 2" title="Restaurant information" icon={Store} />
            <div className="grid gap-3 md:grid-cols-2">
              <RegistrationInput {...registrationInputProps} field="businessName" label="Legal business name" autoComplete="organization" />
              <RegistrationInput {...registrationInputProps} field="publicBusinessName" label="Public restaurant name" autoComplete="organization" />
              <label className="text-sm font-semibold text-slate-600" htmlFor="registration-businessType">Business type<select className="input mt-1" id="registration-businessType" name="businessType" value={form.businessType} onChange={(event) => updateField("businessType", event.target.value)}>{businessTypes.map((type) => <option key={type} value={type}>{readable(type)}</option>)}</select></label>
              <RegistrationInput {...registrationInputProps} field="cuisine" label="Cuisine" />
              <RegistrationInput {...registrationInputProps} field="businessEmail" label="Business email" type="email" autoComplete="email" />
              <RegistrationInput {...registrationInputProps} field="businessPhone" label="Business phone" type="tel" autoComplete="tel" />
              <RegistrationInput {...registrationInputProps} field="address" label="Address" autoComplete="street-address" />
              <RegistrationInput {...registrationInputProps} field="city" label="City" autoComplete="address-level2" />
              <RegistrationInput {...registrationInputProps} field="state" label="State" autoComplete="address-level1" />
              <RegistrationInput {...registrationInputProps} field="zip" label="ZIP" autoComplete="postal-code" />
              <RegistrationInput {...registrationInputProps} field="country" label="Country" autoComplete="country-name" />
              <RegistrationInput {...registrationInputProps} field="timezone" label="Time zone" />
              <label className="text-sm font-semibold text-slate-600 md:col-span-2" htmlFor="registration-preferredSlug">
                Preferred restaurant URL
                <div className="mt-1 grid gap-2 md:grid-cols-[1fr_auto]">
                  <input
                    aria-describedby={errors.preferredSlug ? "registration-preferredSlug-error" : undefined}
                    aria-invalid={Boolean(errors.preferredSlug)}
                    autoCapitalize="none"
                    autoComplete="off"
                    className="input"
                    id="registration-preferredSlug"
                    inputMode="url"
                    name="preferredSlug"
                    onBlur={checkSlug}
                    onChange={(event) => updateField("preferredSlug", event.target.value, { isComposing: Boolean(event.nativeEvent?.isComposing) })}
                    onCompositionEnd={(event) => handleCompositionEnd("preferredSlug", event.target.value)}
                    onCompositionStart={() => handleCompositionStart("preferredSlug")}
                    spellCheck={false}
                    type="text"
                    value={form.preferredSlug}
                  />
                  <button className="button-muted justify-center" disabled={slugStatus?.checking} type="button" onClick={checkSlug}>{slugStatus?.checking ? "Checking..." : "Check URL"}</button>
                </div>
                <p className="mt-1 text-xs text-slate-500">Your public URL will be https://{tenantRootDomain}/{form.preferredSlug || "your-restaurant"}</p>
                <FieldError id="registration-preferredSlug-error" message={errors.preferredSlug} />
                {slugStatus ? <p className={`mt-1 text-sm font-semibold ${slugStatus.available ? "text-emerald-700" : "text-rose-700"}`}>{slugStatus.checking ? slugStatus.reason : slugStatus.available ? "This restaurant URL is available." : slugStatus.reason}</p> : null}
              </label>
            </div>
          </div>
        ) : null}

        {currentStep === "plan" ? (
          <div>
            <SectionHeader eyebrow="Step 3" title="Choose plan" icon={CreditCard} />
            <div className="mb-4 flex w-fit rounded-md border border-line bg-white p-1">
              {["MONTHLY", "ANNUAL"].map((interval) => <button className={`seg ${form.billingInterval === interval ? "active" : ""}`} key={interval} type="button" onClick={() => updateField("billingInterval", interval)}>{readable(interval)}</button>)}
            </div>
            {planConfigIsPending ? (
              <div className="mb-4 min-h-14 rounded-md border border-line bg-slate-50 p-3 text-sm font-semibold text-slate-600" aria-live="polite">
                Checking setup availability...
              </div>
            ) : null}
            {planConfigStatus === PLAN_CONFIG_STATUS.ERROR ? (
              <div className="mb-4 flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 md:flex-row md:items-center md:justify-between" role="status">
                <span className="font-semibold">{planError || "Setup availability could not be confirmed. Please try again."}</span>
                <button className="button-muted justify-center" type="button" onClick={() => setPlanRequestKey((key) => key + 1)}>Retry</button>
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-3">
              {planConfigIsPending ? <PlanCardSkeletons count={3} /> : plans.map((plan) => {
                const selected = form.planCode === plan.code;
                const checkoutStatus = checkoutStatusForPlan(plan, form.billingInterval, planConfigStatus);
                return (
                  <button className={`panel text-left ${selected ? "ring-2 ring-mint" : ""}`} key={plan.code} type="button" onClick={() => updateField("planCode", plan.code)}>
                    <StatusPill tone={checkoutStatus.tone}>{checkoutStatus.label}</StatusPill>
                    <h3 className="public-plan-title compact">{plan.displayName || normalizePlanLabel(plan.code)}</h3>
                    <p className="mt-2 text-sm text-slate-500">{plan.description}</p>
                    <p className="public-plan-price compact">{money(planPrice(plan, form.billingInterval))}<span>/{form.billingInterval === "ANNUAL" ? "year" : "month"}</span></p>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {currentStep === "checkout" ? (
          <div>
            <SectionHeader eyebrow="Step 4" title={selectedStartMode === "INTRO_TRIAL" ? "Introductory program" : "Secure checkout"} icon={Shield} />
            <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
              <div>
                <p className="text-sm leading-6 text-slate-500">
                  {selectedStartMode === "INTRO_TRIAL"
                    ? "Review your registration and start the Loohar introductory program. No payment method is required today, and Loohar will not charge automatically without explicit authorization."
                    : "Review your registration and continue to Stripe-hosted subscription checkout. Loohar provisions your restaurant tenant only after the payment webhook is verified by the API."}
                </p>
                <div className="mt-4 grid gap-2 text-sm">
                  <div className="summary-line"><span>Restaurant</span><strong>{form.publicBusinessName || form.businessName || "Restaurant"}</strong></div>
                  <div className="summary-line"><span>Owner</span><strong>{form.firstName} {form.lastName}</strong></div>
                  <div className="summary-line"><span>Public URL</span><strong>/{form.preferredSlug || "restaurant"}</strong></div>
                  <div className="summary-line"><span>Plan</span><strong>{selectedPlan?.displayName || form.planCode} - {readable(form.billingInterval)}</strong></div>
                </div>
              </div>
              <div className="rounded-md border border-line bg-slate-50 p-4">
                <p className="text-sm font-bold uppercase text-slate-500">Due now</p>
                <p className="public-plan-price compact">{money(selectedStartMode === "INTRO_TRIAL" ? 0 : planPrice(selectedPlan, form.billingInterval))}</p>
                <p className="mt-2 text-sm text-slate-500">{selectedStartMode === "INTRO_TRIAL" ? "No automatic charge. Loohar will request explicit authorization before any paid subscription starts." : "Plan price is resolved by the backend. The browser never submits an amount or Stripe Price ID."}</p>
                {planConfigIsPending ? <p className="mt-3 text-sm font-semibold text-slate-600" aria-live="polite">Checking setup availability...</p> : null}
                {planConfigStatus === PLAN_CONFIG_STATUS.ERROR ? (
                  <div className="mt-3 space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <p className="font-semibold">{planError || "Setup availability could not be confirmed."}</p>
                    <button className="button-muted justify-center" type="button" onClick={() => setPlanRequestKey((key) => key + 1)}>Retry</button>
                  </div>
                ) : null}
                {planConfigStatus === PLAN_CONFIG_STATUS.READY && !checkoutReady ? <p className="mt-3 text-sm font-semibold text-amber-800">Plan setup is temporarily unavailable. Please contact Loohar support to finish setup.</p> : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-between gap-2 border-t border-line pt-4">
          <button className="button-muted" type="button" disabled={stepIndex === 0} onClick={() => setStepIndex((index) => Math.max(index - 1, 0))}>Back</button>
          {currentStep === "checkout"
            ? <button className="button-primary" type="submit" disabled={submitting || !checkoutReady}>{selectedStartMode === "INTRO_TRIAL" ? submitting ? "Starting program..." : "Start introductory program" : submitting ? "Opening checkout..." : "Start secure checkout"}</button>
            : <button className="button-primary" type="submit">Continue</button>}
        </div>
        {visibleErrors.length ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            <p className="font-bold">Please review the highlighted fields.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {visibleErrors.map((validationMessage) => <li key={validationMessage}>{validationMessage}</li>)}
            </ul>
          </div>
        ) : null}
      </form>
    </RegistrationShell>
  );
}

function RegistrationStatusPage({ apiOnline }) {
  const query = new window.URLSearchParams(window.location.search);
  const registrationId = query.get("registrationId") || "";
  const sessionId = query.get("session_id") || "";
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const registration = payload?.registration;
  const complete = Boolean(registration?.steps?.complete);
  const failed = ["FAILED", "EXPIRED", "CANCELED", "CANCELLED"].includes(registration?.status);

  useEffect(() => {
    if (!apiOnline) {
      setError("Live API is required to check registration status.");
      return undefined;
    }
    let cancelled = false;
    let attempts = 0;
    async function loadStatus() {
      attempts += 1;
      const params = new window.URLSearchParams();
      if (registrationId) params.set("registrationId", registrationId);
      if (sessionId) params.set("session_id", sessionId);
      const endpoint = registrationId ? `/api/registration/${encodeURIComponent(registrationId)}/status?${params.toString()}` : `/api/registration/status?${params.toString()}`;
      try {
        const nextPayload = await api(endpoint, { skipAuth: true, cache: "no-store" });
        if (!cancelled) {
          setPayload(nextPayload);
          setError("");
          const nextStatus = nextPayload.registration?.status;
          if (nextPayload.registration?.steps?.complete || ["FAILED", "EXPIRED", "CANCELED", "CANCELLED"].includes(nextStatus)) {
            window.clearInterval(timer);
          }
        }
      } catch (statusError) {
        if (!cancelled) setError(statusError.message);
      }
    }
    const timer = window.setInterval(() => {
      if (attempts >= 30) {
        window.clearInterval(timer);
        return;
      }
      loadStatus();
    }, 4000);
    loadStatus();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [apiOnline, registrationId, sessionId]);

  const steps = [
    registration?.paymentNotRequired ? ["paymentNotRequired", "No payment required today"] : ["paymentConfirmed", "Payment confirmed"],
    ["creatingAccount", "Creating account"],
    ["creatingRestaurant", "Creating restaurant"],
    ["assigningOwner", "Assigning owner"],
    ["onboardingReady", "Preparing onboarding"]
  ];

  return (
    <RegistrationShell>
      <section className="panel mx-auto max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-wide text-mint">Registration status</p>
        <h1 className="public-page-title compact">{complete ? "Your restaurant workspace is ready." : failed ? "Registration needs attention." : "We are preparing your Loohar workspace."}</h1>
        <p className="mt-3 text-slate-500">
          {registration?.paymentNotRequired
            ? "Your introductory program is provisioning without payment collection. Loohar will not charge automatically without explicit authorization."
            : "This page checks backend provisioning. Access is created only after the verified Stripe webhook completes tenant setup."}
        </p>
        <InlineError message={error} />
        {!registration && !error ? <AppLoadingState title="Checking registration" detail="Waiting for provisioning status." /> : null}
        {registration ? (
          <div className="mt-5 space-y-3">
            <div className="summary-line"><span>Restaurant</span><strong>{registration.restaurantName}</strong></div>
            <div className="summary-line"><span>Status</span><strong>{registration.status}</strong></div>
            <div className="summary-line"><span>Plan</span><strong>{registration.planCode} - {readable(registration.billingInterval)}</strong></div>
            {steps.map(([key, label]) => <div className="flex items-center gap-3 rounded-md border border-line bg-white p-3" key={key}><CheckCircle2 className={registration.steps?.[key] ? "text-mint" : "text-slate-300"} size={20} /><span className="font-semibold text-slate-700">{label}</span></div>)}
            {complete ? (
              <div className="mt-5 flex flex-wrap gap-2">
                <a className="button-primary" href="/restaurant/login">Sign in to continue setup</a>
                <a className="button-muted" href={registration.onboardingUrl || "/restaurant/login"}>Open onboarding</a>
                <a className="button-muted" href={registration.publicUrl}>View public URL</a>
              </div>
            ) : null}
            {failed ? <a className="button-primary mt-4" href="/register">Restart registration</a> : null}
          </div>
        ) : null}
      </section>
    </RegistrationShell>
  );
}

function RegistrationResultPage({ type }) {
  const details = {
    success: ["Registration received", "We are waiting for verified payment confirmation and tenant provisioning. Use the status page from your checkout redirect to track setup."],
    cancelled: ["Checkout cancelled", "No tenant access was activated. You can restart registration or choose a different plan before your reservation expires."],
    failed: ["Checkout failed", "No tenant access was activated. Try checkout again or contact support if payment was taken."]
  };
  const [title, detail] = details[type] || details.failed;
  return (
    <RegistrationShell>
      <section className="panel mx-auto max-w-2xl text-center">
        <Shield className="mx-auto text-mint" size={36} />
        <h1 className="public-page-title compact">{title}</h1>
        <p className="mt-3 text-slate-500">{detail}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <a className="button-primary" href="/register">Continue registration</a>
          <a className="button-muted" href="/pricing">View pricing</a>
        </div>
      </section>
    </RegistrationShell>
  );
}

const OnboardingFieldContext = createContext(null);

function useOnboardingFieldContext() {
  const context = useContext(OnboardingFieldContext);
  if (!context) throw new Error("Onboarding field context is required.");
  return context;
}

function Field({ label, children }) {
  return <label className="grid gap-1 text-sm font-semibold text-slate-600"><span>{label}</span>{children}</label>;
}

function TextInput({ field, type = "text", placeholder = "", rows = 0 }) {
  const { draft, updateDraft } = useOnboardingFieldContext();
  const handleChange = (event) => {
    const nextValue = type === "number" && !rows ? event.target.valueAsNumber || 0 : event.target.value;
    updateDraft(field, nextValue);
  };
  if (rows) {
    return (
      <textarea
        className="input min-h-28"
        data-onboarding-field={field}
        value={draft[field] || ""}
        placeholder={placeholder}
        onChange={handleChange}
      />
    );
  }
  return (
    <input
      className="input"
      data-onboarding-field={field}
      type={type}
      value={draft[field] ?? ""}
      placeholder={placeholder}
      onChange={handleChange}
    />
  );
}

function Toggle({ field, label }) {
  const { draft, updateDraft } = useOnboardingFieldContext();
  return (
    <button type="button" className={`nav-tab ${draft[field] ? "active" : ""}`} onClick={() => updateDraft(field, !draft[field])}>
      {draft[field] ? <CheckCircle2 size={16} /> : null}{label}
    </button>
  );
}

function StepStatus({ step, index, done, active, onSelect }) {
  return (
    <button className={`nav-tab justify-start ${active ? "active" : ""}`} type="button" onClick={() => onSelect(step.id)}>
      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-black ${done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{done ? "✓" : index + 1}</span>
      {step.label}
    </button>
  );
}

function RestaurantOnboardingWizard({ apiOnline, token, user, initialSlug = "" }) {
  const [routeRestaurantId, setRouteRestaurantId] = useState("");
  const restaurantKey = initialSlug || user?.restaurantSlug || routeRestaurantId || user?.restaurantId || "";
  const apiBase = restaurantKey ? `/api/restaurants/${restaurantKey}` : "/api/restaurant";
  const [payload, setPayload] = useState(null);
  const [activeStep, setActiveStep] = useState(user?.onboardingCurrentStep || "business");
  const [draft, setDraft] = useState({});
  const [menuDraft, setMenuDraft] = useState({ categoryName: "", itemName: "", itemDescription: "", itemPriceCents: 1295 });
  const [socialDraft, setSocialDraft] = useState({ platform: "instagram", url: "" });
  const [galleryDrafts, setGalleryDrafts] = useState({});
  const [draftDirty, setDraftDirty] = useState(false);
  const [menuDraftDirty, setMenuDraftDirty] = useState(false);
  const [socialDraftDirty, setSocialDraftDirty] = useState(false);
  const [galleryDirtyMap, setGalleryDirtyMap] = useState({});
  const [gallerySaveState, setGallerySaveState] = useState({});
  const [stepSaveState, setStepSaveState] = useState({});
  const [menuReviewState, setMenuReviewState] = useState("IDLE");
  const [menuReviewMessage, setMenuReviewMessage] = useState("");
  const [serverRefreshPending, setServerRefreshPending] = useState(false);
  const draftDirtyRef = useRef(false);
  const galleryDirtyRef = useRef({});
  const [saving, setSaving] = useState("");
  const [uploading, setUploading] = useState("");
  const [error, setError] = useState("");
  const [messageState, setMessageState] = useState(null);
  const [merchantAccount, setMerchantAccount] = useState(null);
  const [platformSubscription, setPlatformSubscription] = useState(null);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState("");

  const restaurant = payload?.restaurant || {};
  const website = payload?.website || {};
  const readiness = payload?.readiness || { sections: {}, blockers: [], warnings: [], completionPercentage: 0, counts: {} };
  const domain = payload?.domain || {};
  const categories = payload?.categories || [];
  const gallery = payload?.gallery || [];
  const socialLinks = payload?.socialLinks || [];
  const deliveryZones = payload?.deliveryZones || [];
  const restaurantSlug = restaurant.slug || user?.restaurantSlug || initialSlug || "";
  const dashboardHref = restaurantSlug ? `/restaurant/${restaurantSlug}` : "/restaurant";
  const publicHref = restaurantSlug ? `https://${restaurantSlug}.${tenantRootDomain}` : "/";
  const currentStepIndex = Math.max(0, onboardingSteps.findIndex((step) => step.id === activeStep));
  const optionalOnboardingSteps = new Set(["menu", "gallery", "payments"]);
  const platformSubscriptionStatus = String(platformSubscription?.status || "").toUpperCase();
  const businessHourErrors = activeStep === "hours" ? validateBusinessHours(draft.storeHoursJson, draft.timezone) : [];
  const message = messageState && (!messageState.step || messageState.step === activeStep) ? messageState.text : "";
  const liveAnnouncement = [message, error, menuReviewMessage, serverRefreshPending ? "Fresh server data is available after you save your current edits." : ""].filter(Boolean).join(" ");
  draftDirtyRef.current = draftDirty;
  galleryDirtyRef.current = galleryDirtyMap;

  function clearMessage() {
    setMessageState(null);
  }

  function showGlobalMessage(text) {
    setMessageState(text ? { text, step: "" } : null);
  }

  function showStepMessage(step, text) {
    setMessageState(text ? { text, step } : null);
  }

  function selectStep(stepId) {
    clearMessage();
    setActiveStep(stepId);
  }

  function stepEndpoint(step = activeStep) {
    return `${apiBase}/onboarding/${step}`;
  }

  function draftFromPayload(nextPayload) {
    const nextRestaurant = nextPayload.restaurant || {};
    const nextWebsite = nextPayload.website || {};
    const nextDomain = nextPayload.domain || {};
    const nextOwner = nextPayload.owner || {};
    const nextDeliveryZones = nextPayload.deliveryZones || [];
    const nextGallery = nextPayload.gallery || [];
    const nextHours = normalizeBusinessHoursForDraft(nextWebsite.storeHoursJson || nextRestaurant.storeHoursJson);
    const nextSections = { ...websiteSectionDefaults, ...(nextWebsite.sectionSettingsJson || {}) };
    const nextBrandTheme = normalizeBrandTheme(nextSections.brandTheme, nextWebsite);
    const nextHeroMedia = normalizeHeroMedia(nextSections.heroMedia, nextWebsite, nextGallery);
    return {
      businessName: nextRestaurant.businessName || nextRestaurant.name || "",
      publicBusinessName: nextRestaurant.name || nextRestaurant.businessName || "",
      businessType: nextRestaurant.businessType || "RESTAURANT",
      categoryLabel: nextRestaurant.settingsJson?.categoryLabel || nextWebsite.cuisineType || "Restaurant",
      description: nextRestaurant.description || "",
      businessEmail: nextRestaurant.email || "",
      phone: nextRestaurant.phone || "",
      address: nextRestaurant.address || "",
      city: nextRestaurant.city || "",
      state: nextRestaurant.state || "",
      zip: nextRestaurant.zip || "",
      timezone: nextRestaurant.timezone || "America/Denver",
      ownerName: nextOwner.name || user?.name || "",
      ownerEmail: nextOwner.email || user?.email || "",
      ownerPhone: nextOwner.phone || "",
      logoUrl: nextWebsite.logoUrl || nextRestaurant.logoUrl || "",
      heroImageUrl: nextWebsite.heroImageUrl || "",
      mobileHeroImageUrl: nextWebsite.mobileHeroImageUrl || "",
      faviconUrl: nextWebsite.faviconUrl || "",
      brandColor: nextBrandTheme.brandColor,
      accentColor: nextBrandTheme.accentColor,
      buttonColor: nextBrandTheme.buttonColor,
      headingFont: nextBrandTheme.headingFont,
      bodyFont: nextBrandTheme.bodyFont,
      heroTitle: nextWebsite.heroTitle || nextRestaurant.name || "",
      heroSubtitle: nextWebsite.heroSubtitle || nextRestaurant.description || "",
      tagline: nextWebsite.tagline || "",
      cuisineType: nextWebsite.cuisineType || "",
      aboutTitle: nextWebsite.aboutTitle || `About ${nextRestaurant.name || "our restaurant"}`,
      aboutStory: nextWebsite.aboutStory || "",
      missionStatement: nextWebsite.missionStatement || "",
      ownerStory: nextWebsite.ownerStory || "",
      specialOfferText: nextWebsite.specialOfferText || "",
      ctaText: nextWebsite.ctaText || "Start an order",
      contactMessage: nextWebsite.contactMessage || "",
      cateringMessage: nextWebsite.cateringMessage || "",
      publicEmail: nextWebsite.publicEmail || nextRestaurant.email || "",
      seoTitle: nextWebsite.seoTitle || "",
      seoDescription: nextWebsite.seoDescription || "",
      seoKeywords: nextWebsite.seoKeywords || "",
      canonicalUrl: nextWebsite.canonicalUrl || nextDomain.canonicalUrl || "",
      ogImageUrl: nextWebsite.ogImageUrl || nextWebsite.heroImageUrl || "",
      indexingEnabled: nextWebsite.indexingEnabled !== false,
      sectionSettingsJson: nextSections,
      brandTheme: nextBrandTheme,
      heroMedia: nextHeroMedia,
      brandPreviewMode: nextSections.brandPreviewMode || "desktop-public-site",
      brandPublishState: nextSections.brandPublishState || "draft",
      storeHoursJson: nextHours,
      pickupEnabled: nextRestaurant.pickupEnabled !== false,
      deliveryEnabled: nextRestaurant.deliveryEnabled !== false,
      deliveryFeeCents: nextRestaurant.deliveryFeeCents ?? 399,
      minimumOrderCents: nextRestaurant.settingsJson?.minimumOrderCents ?? nextDeliveryZones[0]?.minimumOrderCents ?? 1500,
      deliveryRadiusMiles: nextRestaurant.deliveryRadiusMiles ?? nextDeliveryZones[0]?.radiusMiles ?? 3,
      averagePrepMinutes: nextRestaurant.settingsJson?.averagePrepMinutes ?? 20,
      tipsEnabled: nextRestaurant.settingsJson?.tipsEnabled !== false,
      deliveryZoneName: nextDeliveryZones[0]?.name || "Local Delivery",
      customDomain: nextDomain.customDomain || "",
      defaultSubdomain: nextDomain.defaultSubdomain || nextRestaurant.slug || "",
      paymentStatus: nextPayload.readiness?.paymentStatus || "NOT_CONNECTED",
      paymentProvider: nextRestaurant.settingsJson?.paymentSetup?.provider || "stripe_connect"
    };
  }

  function galleryDraftsFromPayload(nextGallery = []) {
    return Object.fromEntries(nextGallery.map((image) => [image.id, {
      title: image.title || "",
      altText: image.altText || "",
      caption: image.caption || "",
      category: image.category || "food",
      sortOrder: image.sortOrder ?? 0,
      published: image.published !== false
    }]));
  }

  function hasDirtyGalleryDrafts(dirtyMap = galleryDirtyRef.current) {
    return Object.values(dirtyMap || {}).some(Boolean);
  }

  function normalizePayload(nextPayload, { preserveStep = false, stepOverride = "", forceDraft = false, forceGallery = false } = {}) {
    setPayload(nextPayload);
    const nextDraft = draftFromPayload(nextPayload);
    if (forceDraft || !draftDirtyRef.current) {
      setDraft(nextDraft);
      draftDirtyRef.current = false;
      setDraftDirty(false);
      setServerRefreshPending(false);
    } else {
      setServerRefreshPending(true);
    }

    const nextGalleryDrafts = galleryDraftsFromPayload(nextPayload.gallery || []);
    if (forceGallery || !hasDirtyGalleryDrafts()) {
      setGalleryDrafts(nextGalleryDrafts);
      galleryDirtyRef.current = {};
      setGalleryDirtyMap({});
    } else {
      setGalleryDrafts((current) => {
        const merged = { ...nextGalleryDrafts };
        Object.entries(current).forEach(([imageId, imageDraft]) => {
          if (galleryDirtyRef.current?.[imageId]) merged[imageId] = imageDraft;
        });
        return merged;
      });
      setServerRefreshPending(true);
    }
    if (stepOverride) {
      setActiveStep(stepOverride);
    } else if (!preserveStep) {
      setActiveStep(nextPayload.progress?.currentStep || user?.onboardingCurrentStep || "business");
    }
  }

  async function resolveRouteRestaurant() {
    if (!apiOnline || !token || user?.restaurantId || !initialSlug || user?.role !== "SUPER_ADMIN") return;
    const tenants = await api("/api/admin/tenants", { token });
    const tenant = (tenants.businesses || tenants.restaurants || []).find((item) => item.slug === initialSlug || item.id === initialSlug);
    if (tenant?.id) setRouteRestaurantId(tenant.id);
  }

  async function loadOnboarding(options = {}) {
    if (!apiOnline || !token || !restaurantKey) return;
    setError("");
    try {
      const nextPayload = await api(`${apiBase}/onboarding`, { token });
      normalizePayload(nextPayload, options);
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  async function loadPaymentSetup() {
    if (!apiOnline || !token || activeStep !== "payments") return;
    setPaymentsLoading(true);
    setError("");
    setPaymentNotice("");
    try {
      const [subscriptionPayload, merchantPayload] = await Promise.all([
        api("/api/platform-billing/subscription", { token }).catch((subscriptionError) => ({ error: subscriptionError.message })),
        api("/api/order-payments/merchant-account", { token }).catch((merchantError) => ({ error: merchantError.message }))
      ]);
      const visibleErrors = [];
      if (!subscriptionPayload.error) {
        setPlatformSubscription(subscriptionPayload.subscription || null);
      } else if (isPlatformBillingConfigurationMessage(subscriptionPayload.error)) {
        setPaymentNotice(introProgramActiveMessage);
      } else {
        visibleErrors.push(subscriptionPayload.error);
      }
      if (!merchantPayload.error) {
        setMerchantAccount(merchantPayload.merchantAccount || null);
      } else {
        visibleErrors.push(merchantPayload.error);
      }
      if (visibleErrors.length) {
        setError(visibleErrors.join(" "));
      }
    } finally {
      setPaymentsLoading(false);
    }
  }

  async function openPlatformBillingPortal() {
    setSaving("billing-portal");
    setError("");
    try {
      const payload = await api("/api/platform-billing/portal", { method: "POST", token });
      if (payload.portalUrl) window.location.href = payload.portalUrl;
    } catch (portalError) {
      if (isPlatformBillingConfigurationMessage(portalError.message)) {
        setPaymentNotice(introProgramActiveMessage);
      } else {
        setError(portalError.message);
      }
    } finally {
      setSaving("");
    }
  }

  async function startMerchantOnboarding() {
    setSaving("merchant-onboarding");
    setError("");
    try {
      const payload = await api("/api/order-payments/merchant-account/onboarding-link", { method: "POST", token });
      if (payload.merchantAccount) setMerchantAccount(payload.merchantAccount);
      if (payload.onboardingUrl) window.location.href = payload.onboardingUrl;
    } catch (connectError) {
      setError(connectError.message);
    } finally {
      setSaving("");
    }
  }

  useEffect(() => {
    resolveRouteRestaurant().catch((resolveError) => setError(resolveError.message));
  }, [apiOnline, token, user?.restaurantId, user?.role, initialSlug]);

  useEffect(() => {
    loadOnboarding();
  }, [apiOnline, token, restaurantKey]);

  useEffect(() => {
    loadPaymentSetup();
  }, [apiOnline, token, activeStep]);

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const handleRefetch = () => {
      loadOnboarding({ preserveStep: true });
    };
    window.addEventListener("loohar:onboarding-refetch", handleRefetch);
    return () => window.removeEventListener("loohar:onboarding-refetch", handleRefetch);
  }, [apiOnline, token, restaurantKey]);

  function markDraftDirty() {
    draftDirtyRef.current = true;
    setDraftDirty(true);
    setServerRefreshPending(false);
  }

  function mergeSavedDraftValues(values) {
    setDraft((current) => {
      const merged = { ...current, ...values };
      return {
        ...merged,
        brandTheme: normalizeBrandTheme(merged.brandTheme, merged),
        heroMedia: normalizeHeroMedia(merged.heroMedia, merged, gallery)
      };
    });
  }

  function updateMenuDraft(field, value) {
    setMenuDraft((current) => ({ ...current, [field]: value }));
    setMenuDraftDirty(true);
    if (menuReviewState === "SAVED") {
      setMenuReviewState("DIRTY");
      setMenuReviewMessage("Menu changes have not been reviewed yet.");
    }
  }

  function updateSocialDraft(field, value) {
    setSocialDraft((current) => ({ ...current, [field]: value }));
    setSocialDraftDirty(true);
  }

  function setGalleryStatus(imageId, status, messageText = "") {
    setGallerySaveState((current) => ({ ...current, [imageId]: { status, message: messageText } }));
  }

  function updateDraft(field, value) {
    markDraftDirty();
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateSection(section, value) {
    markDraftDirty();
    setDraft((current) => ({ ...current, sectionSettingsJson: { ...(current.sectionSettingsJson || {}), [section]: value } }));
  }

  function updateBrandTheme(patch) {
    markDraftDirty();
    setDraft((current) => {
      const nextTheme = normalizeBrandTheme({ ...(current.brandTheme || {}), ...patch }, current);
      return {
        ...current,
        brandColor: nextTheme.brandColor,
        accentColor: nextTheme.accentColor,
        buttonColor: nextTheme.buttonColor,
        headingFont: nextTheme.headingFont,
        bodyFont: nextTheme.bodyFont,
        brandTheme: nextTheme
      };
    });
  }

  function updateBrandColorText(field, value) {
    markDraftDirty();
    setDraft((current) => ({
      ...current,
      [field]: value,
      brandTheme: {
        ...(current.brandTheme || {}),
        [field]: value
      }
    }));
  }

  function updateBrandGradientStop(index, patch) {
    markDraftDirty();
    setDraft((current) => {
      const theme = normalizeBrandTheme(current.brandTheme, current);
      const stops = [...theme.gradientStops];
      stops[index] = { ...(stops[index] || defaultBrandTheme.gradientStops[index] || defaultBrandTheme.gradientStops[0]), ...patch };
      const nextTheme = normalizeBrandTheme({ ...theme, gradientStops: stops }, current);
      return { ...current, brandTheme: nextTheme };
    });
  }

  function addBrandGradientStop() {
    const theme = normalizeBrandTheme(draft.brandTheme, draft);
    updateBrandTheme({ gradientStops: [...theme.gradientStops, { color: theme.accentColor, position: 100, opacity: 1 }] });
  }

  function removeBrandGradientStop(index) {
    const theme = normalizeBrandTheme(draft.brandTheme, draft);
    const stops = theme.gradientStops.filter((_, stopIndex) => stopIndex !== index);
    updateBrandTheme({ gradientStops: stops.length ? stops : defaultBrandTheme.gradientStops });
  }

  function applyBrandPreset(preset) {
    updateBrandTheme({
      mode: preset.mode,
      brandColor: preset.brandColor,
      accentColor: preset.accentColor,
      buttonColor: preset.buttonColor,
      headingFont: preset.headingFont,
      bodyFont: preset.bodyFont,
      gradientStops: [
        { color: preset.brandColor, position: 0, opacity: 1 },
        { color: preset.buttonColor, position: 100, opacity: 1 }
      ]
    });
  }

  function updateHeroMedia(patch) {
    markDraftDirty();
    setDraft((current) => ({
      ...current,
      heroMedia: normalizeHeroMedia({ ...(current.heroMedia || {}), ...patch }, current, gallery)
    }));
  }

  function updateHeroSlide(index, patch) {
    markDraftDirty();
    setDraft((current) => {
      const heroMedia = normalizeHeroMedia(current.heroMedia, current, gallery);
      const slides = [...heroMedia.slides];
      slides[index] = normalizeHeroSlide({ ...(slides[index] || {}), ...patch }, { index });
      return { ...current, heroMedia: { ...heroMedia, slides } };
    });
  }

  function addBlankHeroSlide() {
    const heroMedia = normalizeHeroMedia(draft.heroMedia, draft, gallery);
    updateHeroMedia({ slides: [...heroMedia.slides, normalizeHeroSlide({}, { id: `slide-${Date.now()}`, index: heroMedia.slides.length })] });
  }

  function addHeroSlideFromGallery(image) {
    const heroMedia = normalizeHeroMedia(draft.heroMedia, draft, gallery);
    updateHeroMedia({
      slides: [
        ...heroMedia.slides,
        normalizeHeroSlide({
          id: `gallery-${image.id || Date.now()}`,
          imageUrl: image.imageUrl,
          title: image.title,
          subtitle: image.caption,
          altText: image.altText,
          published: true
        }, { index: heroMedia.slides.length })
      ]
    });
  }

  function removeHeroSlide(index) {
    const heroMedia = normalizeHeroMedia(draft.heroMedia, draft, gallery);
    updateHeroMedia({ slides: heroMedia.slides.filter((_, slideIndex) => slideIndex !== index) });
  }

  function moveHeroSlide(index, direction) {
    const heroMedia = normalizeHeroMedia(draft.heroMedia, draft, gallery);
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= heroMedia.slides.length) return;
    const slides = [...heroMedia.slides];
    const [slide] = slides.splice(index, 1);
    slides.splice(nextIndex, 0, slide);
    updateHeroMedia({ slides: slides.map((item, slideIndex) => normalizeHeroSlide(item, { index: slideIndex })) });
  }

  function resetBrandingDraft() {
    if (!payload) return;
    const resetDraft = draftFromPayload(payload);
    setDraft(resetDraft);
    draftDirtyRef.current = false;
    setDraftDirty(false);
    setServerRefreshPending(false);
    showStepMessage("branding", "Branding changes reset to the latest saved values.");
  }

  async function saveBrandingPublishState(nextState) {
    const nextDraft = { ...draft, brandPublishState: nextState };
    markDraftDirty();
    setDraft(nextDraft);
    await saveStep("branding", nextDraft);
  }

  function updateHour(day, value) {
    markDraftDirty();
    setDraft((current) => ({ ...current, storeHoursJson: { ...(current.storeHoursJson || {}), [day]: value } }));
  }

  function updateHourDay(day, patch) {
    markDraftDirty();
    setDraft((current) => {
      const hours = normalizeBusinessHoursForDraft(current.storeHoursJson);
      const nextDay = { ...hours[day], ...patch };
      if (patch.closed === true) nextDay.windows = [];
      if (patch.closed === false && !nextDay.windows.length) nextDay.windows = [{ open: "11:00", close: "21:00", overnight: false }];
      return { ...current, storeHoursJson: { ...hours, [day]: nextDay } };
    });
  }

  function updateHourWindow(day, index, patch) {
    markDraftDirty();
    setDraft((current) => {
      const hours = normalizeBusinessHoursForDraft(current.storeHoursJson);
      const windows = [...(hours[day]?.windows || [])];
      windows[index] = { ...(windows[index] || { open: "11:00", close: "21:00", overnight: false }), ...patch };
      return { ...current, storeHoursJson: { ...hours, [day]: { ...hours[day], closed: false, windows } } };
    });
  }

  function addHourWindow(day) {
    markDraftDirty();
    setDraft((current) => {
      const hours = normalizeBusinessHoursForDraft(current.storeHoursJson);
      return { ...current, storeHoursJson: { ...hours, [day]: { ...hours[day], closed: false, windows: [...(hours[day]?.windows || []), { open: "17:00", close: "21:00", overnight: false }] } } };
    });
  }

  function removeHourWindow(day, index) {
    markDraftDirty();
    setDraft((current) => {
      const hours = normalizeBusinessHoursForDraft(current.storeHoursJson);
      const windows = (hours[day]?.windows || []).filter((_, windowIndex) => windowIndex !== index);
      return { ...current, storeHoursJson: { ...hours, [day]: { ...hours[day], closed: !windows.length, windows } } };
    });
  }

  function copyHourToAll(sourceDay) {
    markDraftDirty();
    setDraft((current) => {
      const hours = normalizeBusinessHoursForDraft(current.storeHoursJson);
      const source = hours[sourceDay] || defaultBusinessHours[sourceDay];
      return { ...current, storeHoursJson: Object.fromEntries(businessHourDays.map((day) => [day, { ...source, windows: source.windows.map((window) => ({ ...window })) }])) };
    });
  }

  function copyMondayToWeekdays() {
    markDraftDirty();
    setDraft((current) => {
      const hours = normalizeBusinessHoursForDraft(current.storeHoursJson);
      const monday = hours.monday || defaultBusinessHours.monday;
      const nextHours = { ...hours };
      ["tuesday", "wednesday", "thursday", "friday"].forEach((day) => {
        nextHours[day] = { ...monday, windows: monday.windows.map((window) => ({ ...window })) };
      });
      return { ...current, storeHoursJson: nextHours };
    });
  }

  function updateGalleryDraft(imageId, field, value) {
    galleryDirtyRef.current = { ...galleryDirtyRef.current, [imageId]: true };
    setGalleryDirtyMap((current) => ({ ...current, [imageId]: true }));
    setGalleryStatus(imageId, "DIRTY", "Unsaved image metadata changes.");
    setGalleryDrafts((current) => ({ ...current, [imageId]: { ...(current[imageId] || {}), [field]: value } }));
  }

  function bodyForStep(step, draftOverride = null) {
    const source = draftOverride || draft;
    if (step === "business") {
      return {
        businessName: source.businessName,
        publicBusinessName: source.publicBusinessName,
        businessType: source.businessType,
        categoryLabel: source.categoryLabel,
        description: source.description,
        businessEmail: source.businessEmail,
        phone: source.phone,
        address: source.address,
        city: source.city,
        state: source.state,
        zip: source.zip,
        timezone: source.timezone,
        pickupEnabled: source.pickupEnabled,
        deliveryEnabled: source.deliveryEnabled,
        enabledModules: businessModules
      };
    }
    if (step === "owner") return { ownerName: source.ownerName, ownerEmail: source.ownerEmail, ownerPhone: source.ownerPhone };
    if (step === "branding") {
      const brandTheme = normalizeBrandTheme(source.brandTheme, source);
      const heroMedia = normalizeHeroMedia(source.heroMedia, source, gallery);
      return {
        logoUrl: source.logoUrl,
        heroImageUrl: source.heroImageUrl,
        mobileHeroImageUrl: source.mobileHeroImageUrl,
        faviconUrl: source.faviconUrl,
        brandColor: brandTheme.brandColor,
        accentColor: brandTheme.accentColor,
        buttonColor: brandTheme.buttonColor,
        headingFont: brandTheme.headingFont,
        bodyFont: brandTheme.bodyFont,
        sectionSettingsJson: {
          ...(source.sectionSettingsJson || {}),
          brandTheme,
          heroMedia,
          brandPreviewMode: source.brandPreviewMode || "desktop-public-site",
          brandPublishState: source.brandPublishState || "draft"
        }
      };
    }
    if (step === "content") {
      return {
        heroTitle: source.heroTitle,
        heroSubtitle: source.heroSubtitle,
        tagline: source.tagline,
        cuisineType: source.cuisineType,
        aboutTitle: source.aboutTitle,
        aboutStory: source.aboutStory,
        missionStatement: source.missionStatement,
        ownerStory: source.ownerStory,
        specialOfferText: source.specialOfferText,
        ctaText: source.ctaText,
        contactMessage: source.contactMessage,
        cateringMessage: source.cateringMessage,
        publicEmail: source.publicEmail,
        sectionSettingsJson: source.sectionSettingsJson
      };
    }
    if (step === "hours") return { storeHoursJson: source.storeHoursJson };
    if (step === "fulfillment") {
      return {
        pickupEnabled: source.pickupEnabled,
        deliveryEnabled: source.deliveryEnabled,
        deliveryFeeCents: Number(source.deliveryFeeCents || 0),
        deliveryRadiusMiles: Number(source.deliveryRadiusMiles || 0),
        minimumOrderCents: Number(source.minimumOrderCents || 0),
        averagePrepMinutes: Number(source.averagePrepMinutes || 20),
        tipsEnabled: source.tipsEnabled !== false,
        deliveryZone: source.deliveryEnabled ? {
          name: source.deliveryZoneName || "Local Delivery",
          radiusMiles: Number(source.deliveryRadiusMiles || 0),
          deliveryFeeCents: Number(source.deliveryFeeCents || 0),
          minimumOrderCents: Number(source.minimumOrderCents || 0),
          active: true
        } : null
      };
    }
    if (step === "domain") {
      return {
        defaultSubdomain: source.defaultSubdomain,
        customDomain: source.customDomain,
        seoTitle: source.seoTitle,
        seoDescription: source.seoDescription,
        seoKeywords: source.seoKeywords,
        canonicalUrl: source.canonicalUrl,
        ogImageUrl: source.ogImageUrl,
        indexingEnabled: source.indexingEnabled !== false
      };
    }
    if (step === "payments") return { paymentSetup: { provider: source.paymentProvider, status: source.paymentStatus } };
    return {};
  }

  async function saveStep(step = activeStep, draftOverride = null) {
    if (!apiOnline || !token) {
      setError("Live API connection and restaurant login are required for onboarding.");
      return;
    }
    if (step === "hours") {
      const hourErrors = validateBusinessHours(draft.storeHoursJson, draft.timezone);
      if (hourErrors.length) {
        setError(hourErrors.join(" "));
        return;
      }
    }
    setStepSaveState((current) => ({ ...current, [step]: { status: "SAVING", message: "Saving changes..." } }));
    if (step === "menu") {
      setMenuReviewState("SAVING");
      setMenuReviewMessage("Saving menu review...");
    }
    setSaving(step);
    setError("");
    clearMessage();
    try {
      const nextPayload = await api(stepEndpoint(step), { method: "PATCH", token, body: bodyForStep(step, draftOverride) });
      normalizePayload(nextPayload, { stepOverride: step, forceDraft: step !== "menu", forceGallery: step === "gallery" });
      setStepSaveState((current) => ({ ...current, [step]: { status: "SAVED", message: "Saved." } }));
      if (step === "menu") {
        setMenuDraftDirty(false);
        setMenuReviewState("SAVED");
        setMenuReviewMessage("Menu reviewed and saved.");
      }
      showStepMessage(step, `${onboardingSteps.find((item) => item.id === step)?.label || "Step"} saved.`);
    } catch (saveError) {
      setStepSaveState((current) => ({ ...current, [step]: { status: "ERROR", message: saveError.message } }));
      if (step === "menu") {
        setMenuReviewState("ERROR");
        setMenuReviewMessage("Menu review could not be saved. Fix the error and try again.");
      }
      setError(saveError.message);
    } finally {
      setSaving("");
    }
  }

  async function skipStep(step = activeStep) {
    if (!optionalOnboardingSteps.has(step)) return;
    if (!apiOnline || !token) {
      setError("Live API connection and restaurant login are required for onboarding.");
      return;
    }
    setSaving(`skip:${step}`);
    setError("");
    clearMessage();
    try {
      const nextPayload = await api(`${apiBase}/onboarding/${step}/skip`, { method: "POST", token });
      normalizePayload(nextPayload, { stepOverride: step, forceDraft: true, forceGallery: step === "gallery" });
      showStepMessage(step, `${onboardingSteps.find((item) => item.id === step)?.label || "Step"} skipped for now.`);
      nextStep();
    } catch (skipError) {
      setError(skipError.message);
    } finally {
      setSaving("");
    }
  }

  async function uploadOnboardingImage(kind, event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    const validationError = validateImageFile(file, { accept: kind === "restaurant-logo" || kind === "restaurant-favicon" ? logoImageAccept : photoImageAccept, label: kind.includes("logo") || kind.includes("favicon") ? "logo" : "photo" });
    if (validationError) return setError(validationError);
    setUploading(kind);
    setError("");
    try {
      const dataUrl = await fileToDataUrl(file);
      const uploaded = await api(`/api/uploads/${kind}`, {
        method: "POST",
        token,
        body: {
          restaurantId: restaurant.id,
          fileName: file.name,
          mimeType: mimeTypeForFile(file),
          base64: base64FromDataUrl(dataUrl)
        }
      });
      const nextWebsite = uploaded.website || website;
      setPayload((current) => current ? { ...current, website: nextWebsite, restaurant: uploaded.restaurant || current.restaurant, gallery: uploaded.image ? [...(current.gallery || []), uploaded.image] : current.gallery } : current);
      if (uploaded.website) {
        const savedValues = {};
        ["logoUrl", "heroImageUrl", "mobileHeroImageUrl", "faviconUrl"].forEach((field) => {
          if (uploaded.website[field]) savedValues[field] = uploaded.website[field];
        });
        mergeSavedDraftValues(savedValues);
      }
      if (uploaded.restaurant?.logoUrl) mergeSavedDraftValues({ logoUrl: uploaded.restaurant.logoUrl });
      showStepMessage(activeStep, "Image uploaded and saved.");
      await loadOnboarding({ preserveStep: true });
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading("");
    }
  }

  async function uploadGallery(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const validationError = validateImageFile(file, { accept: photoImageAccept, label: "photo" });
    if (validationError) return setError(validationError);
    setUploading("gallery");
    setError("");
    try {
      const dataUrl = await fileToDataUrl(file);
      await api("/api/uploads/gallery", {
        method: "POST",
        token,
        body: {
          restaurantId: restaurant.id,
          fileName: file.name,
          mimeType: mimeTypeForFile(file),
          base64: base64FromDataUrl(dataUrl),
          altText: `${restaurant.name || "Restaurant"} gallery photo`,
          category: "food"
        }
      });
      showStepMessage("gallery", "Gallery photo uploaded.");
      await loadOnboarding({ preserveStep: true, forceGallery: true });
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading("");
    }
  }

  function validateGalleryDraft(imageId, draftImage) {
    const errors = [];
    if (String(draftImage.title || "").length > galleryTitleMaxLength) errors.push(`Gallery title must be ${galleryTitleMaxLength} characters or less.`);
    if (String(draftImage.category || "").length > galleryCategoryMaxLength) errors.push(`Gallery category must be ${galleryCategoryMaxLength} characters or less.`);
    if (String(draftImage.altText || "").length > galleryAltTextMaxLength) errors.push(`Gallery alt text must be ${galleryAltTextMaxLength} characters or less.`);
    if (String(draftImage.caption || "").length > galleryCaptionMaxLength) errors.push(`Gallery caption must be ${galleryCaptionMaxLength} characters or less.`);
    if (!Number.isInteger(Number(draftImage.sortOrder ?? 0)) || Number(draftImage.sortOrder ?? 0) < 0) errors.push("Gallery sort order must be a whole number of 0 or higher.");
    if (errors.length) setGalleryStatus(imageId, "ERROR", errors.join(" "));
    return errors;
  }

  async function saveGalleryImage(imageId) {
    const draftImage = galleryDrafts[imageId] || {};
    const validationErrors = validateGalleryDraft(imageId, draftImage);
    if (validationErrors.length) {
      setError(validationErrors.join(" "));
      return;
    }
    setGalleryStatus(imageId, "SAVING", "Saving image metadata...");
    setSaving(`gallery:${imageId}`);
    setError("");
    try {
      await api(`/api/uploads/gallery/${imageId}`, {
        method: "PATCH",
        token,
        body: {
          restaurantId: restaurant.id,
          title: draftImage.title,
          altText: draftImage.altText,
          caption: draftImage.caption,
          category: draftImage.category,
          sortOrder: Number(draftImage.sortOrder || 0),
          published: draftImage.published !== false
        }
      });
      galleryDirtyRef.current = { ...galleryDirtyRef.current, [imageId]: false };
      setGalleryDirtyMap((current) => ({ ...current, [imageId]: false }));
      setGalleryStatus(imageId, "SAVED", "Image metadata saved.");
      showStepMessage("gallery", "Gallery image updated.");
      await loadOnboarding({ preserveStep: true, forceGallery: true });
    } catch (galleryError) {
      setGalleryStatus(imageId, "ERROR", galleryError.message);
      setError(galleryError.message);
    } finally {
      setSaving("");
    }
  }

  async function replaceGalleryImage(imageId, event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const validationError = validateImageFile(file, { accept: photoImageAccept, label: "replacement photo" });
    if (validationError) return setError(validationError);
    setUploading(`gallery:${imageId}`);
    setError("");
    try {
      const dataUrl = await fileToDataUrl(file);
      await api(`/api/uploads/gallery/${imageId}/replace`, {
        method: "POST",
        token,
        body: {
          restaurantId: restaurant.id,
          fileName: file.name,
          mimeType: mimeTypeForFile(file),
          base64: base64FromDataUrl(dataUrl)
        }
      });
      showStepMessage("gallery", "Gallery image replaced.");
      setGalleryStatus(imageId, "SAVED", "Image replaced.");
      await loadOnboarding({ preserveStep: true, forceGallery: true });
    } catch (galleryError) {
      setError(galleryError.message);
    } finally {
      setUploading("");
    }
  }

  async function deleteGalleryImage(imageId) {
    if (!window.confirm("Delete this gallery image?")) return;
    setSaving(`gallery-delete:${imageId}`);
    setError("");
    try {
      await api(`/api/uploads/gallery/${imageId}`, { method: "DELETE", token, body: { restaurantId: restaurant.id } });
      setPayload((current) => current ? { ...current, gallery: (current.gallery || []).filter((image) => image.id !== imageId) } : current);
      setGalleryDrafts((current) => {
        const next = { ...current };
        delete next[imageId];
        return next;
      });
      galleryDirtyRef.current = { ...galleryDirtyRef.current, [imageId]: false };
      setGalleryDirtyMap((current) => {
        const next = { ...current };
        delete next[imageId];
        return next;
      });
      setGallerySaveState((current) => {
        const next = { ...current };
        delete next[imageId];
        return next;
      });
      showStepMessage("gallery", "Gallery image deleted.");
      await loadOnboarding({ preserveStep: true, forceGallery: true });
    } catch (galleryError) {
      setError(galleryError.message);
    } finally {
      setSaving("");
    }
  }

  async function uploadMenuItemImage(menuItemId, event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const validationError = validateImageFile(file, { accept: photoImageAccept, label: "menu item photo" });
    if (validationError) return setError(validationError);
    setUploading(`menu-item:${menuItemId}`);
    setError("");
    try {
      const dataUrl = await fileToDataUrl(file);
      await api("/api/uploads/menu-item", {
        method: "POST",
        token,
        body: {
          restaurantId: restaurant.id,
          menuItemId,
          fileName: file.name,
          mimeType: mimeTypeForFile(file),
          base64: base64FromDataUrl(dataUrl)
        }
      });
      showStepMessage("menu", "Menu item image uploaded.");
      await loadOnboarding({ preserveStep: true, forceDraft: false });
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading("");
    }
  }

  async function createQuickCategory(event) {
    event.preventDefault();
    if (!menuDraft.categoryName.trim()) return setError("Enter a category name.");
    setSaving("menu-category");
    setError("");
    try {
      await api(`${apiBase}/menu/categories`, { method: "POST", token, body: { name: menuDraft.categoryName.trim(), sortOrder: categories.length + 1, active: true } });
      setMenuDraft((current) => ({ ...current, categoryName: "" }));
      setMenuDraftDirty(true);
      setMenuReviewState("DIRTY");
      setMenuReviewMessage("Menu category added. Mark the menu reviewed when finished.");
      await loadOnboarding({ preserveStep: true });
      showStepMessage("menu", "Menu category added.");
    } catch (categoryError) {
      setError(categoryError.message);
    } finally {
      setSaving("");
    }
  }

  async function createQuickItem(event) {
    event.preventDefault();
    const categoryId = categories[0]?.id;
    if (!categoryId) return setError("Add a category before adding a menu item.");
    if (!menuDraft.itemName.trim()) return setError("Enter an item name.");
    setSaving("menu-item");
    setError("");
    try {
      await api(`${apiBase}/menu/items`, {
        method: "POST",
        token,
        body: {
          categoryId,
          name: menuDraft.itemName.trim(),
          description: menuDraft.itemDescription.trim(),
          priceCents: Number(menuDraft.itemPriceCents || 0),
          preparationTimeMins: Number(draft.averagePrepMinutes || 20),
          available: true,
          featured: true,
          options: []
        }
      });
      setMenuDraft((current) => ({ ...current, itemName: "", itemDescription: "", itemPriceCents: 1295 }));
      setMenuDraftDirty(true);
      setMenuReviewState("DIRTY");
      setMenuReviewMessage("Menu item added. Mark the menu reviewed when finished.");
      await loadOnboarding({ preserveStep: true });
      showStepMessage("menu", "Menu item added.");
    } catch (itemError) {
      setError(itemError.message);
    } finally {
      setSaving("");
    }
  }

  async function addSocial(event) {
    event.preventDefault();
    if (!socialDraft.url.trim()) return setError("Enter a social URL.");
    setSaving("social");
    setError("");
    try {
      await api(`${apiBase}/social-links`, { method: "POST", token, body: socialDraft });
      setSocialDraft({ platform: "instagram", url: "" });
      setSocialDraftDirty(false);
      await loadOnboarding({ preserveStep: true });
      showStepMessage("gallery", "Social link saved.");
    } catch (socialError) {
      setError(socialError.message);
    } finally {
      setSaving("");
    }
  }

  async function publish() {
    setSaving("publish");
    setError("");
    try {
      const nextPayload = await api(`${apiBase}/onboarding/publish`, { method: "POST", token });
      normalizePayload(nextPayload, { forceDraft: true, forceGallery: true });
      showGlobalMessage(nextPayload.readiness?.orderingReady ? "Website and ordering are live." : "Website is live. Payments are still required before paid ordering.");
      window.setTimeout(() => navigateInApp(dashboardHref, { replace: true }), 900);
    } catch (publishError) {
      setError(publishError.message);
      if (publishError.payload?.readiness) setPayload((current) => ({ ...(current || {}), readiness: publishError.payload.readiness }));
    } finally {
      setSaving("");
    }
  }

  function nextStep() {
    const next = onboardingSteps[Math.min(onboardingSteps.length - 1, currentStepIndex + 1)];
    selectStep(next.id);
  }

  function previousStep() {
    const previous = onboardingSteps[Math.max(0, currentStepIndex - 1)];
    selectStep(previous.id);
  }

  if (!apiOnline) return <AccessDenied title="Live API required" detail="Restaurant onboarding saves directly to PostgreSQL and requires the live API." loginHref="/restaurant/login" />;
  if (!payload) return <AppLoadingState title="Loading onboarding" detail="Preparing the restaurant setup checklist." />;

  const activeStepSave = stepSaveState[activeStep];
  const menuReviewButtonLabel = menuReviewState === "SAVING" || saving === "menu"
    ? "Saving review..."
    : menuReviewState === "SAVED"
      ? "Menu reviewed"
      : menuReviewState === "ERROR"
        ? "Retry menu review"
        : "Mark menu reviewed";
  const currentBrandTheme = normalizeBrandTheme(draft.brandTheme, draft);
  const currentHeroMedia = normalizeHeroMedia(draft.heroMedia, draft, gallery);
  const brandButtonContrast = contrastRatioForColors(currentBrandTheme.buttonColor, "#ffffff");
  const brandContrastStatus = brandButtonContrast >= 4.5 ? "AA ready" : "Needs review";
  const heroSlideCount = currentHeroMedia.slides.filter((slide) => isValidImageUrl(slide.imageUrl)).length;
  const brandingPreviewStyle = {
    "--brand": currentBrandTheme.brandColor,
    "--accent": currentBrandTheme.accentColor,
    "--button": currentBrandTheme.buttonColor,
    fontFamily: currentBrandTheme.bodyFont
  };
  const visibleBrandPalette = Array.from(new Set([
    currentBrandTheme.brandColor,
    currentBrandTheme.accentColor,
    currentBrandTheme.buttonColor,
    ...brandPaletteColors
  ])).slice(0, 12);
  const onboardingFieldContext = { draft, updateDraft };

  return (
    <OnboardingFieldContext.Provider value={onboardingFieldContext}>
    <div className="grid gap-5">
      <div className="panel flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase text-mint">Restaurant onboarding</p>
          <h1 className="mt-1 text-3xl font-black text-ink">{restaurant.name || "Restaurant setup"}</h1>
          <p className="mt-1 text-sm text-slate-500">Complete the required launch checklist for the public website and direct ordering foundation.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone={readiness.websiteReady ? "good" : "warn"}>{readiness.completionPercentage || 0}% complete</StatusPill>
          <StatusPill tone={readiness.orderingReady ? "good" : "warn"}>{readiness.orderingReady ? "Ordering ready" : "Payments pending"}</StatusPill>
          <a className="button-muted" href={dashboardHref}>Dashboard</a>
          <a className="button-muted" href={publicHref} target="_blank" rel="noreferrer">Public site</a>
        </div>
      </div>

      <InlineError message={error} />
      <div className="sr-only" role="status" aria-live="polite">{liveAnnouncement}</div>
      {serverRefreshPending ? <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">Fresh server data is available. Save your current edits before reloading this step.</div> : null}
      {paymentNotice ? <div className="success-box">{paymentNotice}</div> : null}
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700" role="status" aria-live="polite">{message}</div> : null}

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <aside className="grid gap-2 self-start rounded-md border border-line bg-white p-3">
          {onboardingSteps.map((step, index) => (
            <StepStatus
              active={activeStep === step.id}
              done={Boolean(readiness.sections?.[step.id])}
              index={index}
              key={step.id}
              onSelect={selectStep}
              step={step}
            />
          ))}
        </aside>

        <section className="panel">
          <div className="flex flex-col gap-3 border-b border-line pb-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-black uppercase text-mint">Step {currentStepIndex + 1} of {onboardingSteps.length}</p>
              <h2 className="text-2xl font-black text-ink">{onboardingSteps[currentStepIndex]?.label}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="button-muted" type="button" onClick={previousStep} disabled={currentStepIndex === 0}>Back</button>
              <button className="button-muted" type="button" onClick={nextStep} disabled={currentStepIndex === onboardingSteps.length - 1}>Next</button>
              {optionalOnboardingSteps.has(activeStep) ? <button className="button-muted" type="button" onClick={() => skipStep(activeStep)} disabled={Boolean(saving)}>{saving === `skip:${activeStep}` ? "Skipping..." : "Skip for now"}</button> : null}
              {activeStep !== "menu" && activeStep !== "gallery" && activeStep !== "payments" && activeStep !== "review" ? <button className="button-primary" type="button" onClick={() => saveStep(activeStep)} disabled={Boolean(saving)}>{saving === activeStep ? "Saving..." : "Save step"}</button> : null}
            </div>
            {activeStepSave?.message ? <p className={`text-sm font-bold ${activeStepSave.status === "ERROR" ? "text-rose-600" : "text-slate-500"}`} role="status" aria-live="polite">{activeStepSave.message}</p> : null}
          </div>

          {activeStep === "business" ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="Legal business name"><TextInput field="businessName" /></Field>
              <Field label="Public restaurant name"><TextInput field="publicBusinessName" /></Field>
              <Field label="Business type"><select className="input" data-onboarding-field="businessType" value={draft.businessType || "RESTAURANT"} onChange={(event) => updateDraft("businessType", event.target.value)}>{businessTypes.map((type) => <option key={type} value={type}>{readable(type)}</option>)}</select></Field>
              <Field label="Cuisine/category label"><TextInput field="categoryLabel" /></Field>
              <Field label="Business email"><TextInput field="businessEmail" type="email" /></Field>
              <Field label="Phone"><TextInput field="phone" /></Field>
              <Field label="Address"><TextInput field="address" /></Field>
              <Field label="City"><TextInput field="city" /></Field>
              <Field label="State"><TextInput field="state" /></Field>
              <Field label="ZIP"><TextInput field="zip" /></Field>
              <Field label="Timezone"><TextInput field="timezone" /></Field>
              <div className="flex flex-wrap gap-2 self-end"><Toggle field="pickupEnabled" label="Pickup" /><Toggle field="deliveryEnabled" label="Delivery" /></div>
              <Field label="Restaurant description"><TextInput field="description" rows={4} /></Field>
            </div>
          ) : null}

          {activeStep === "owner" ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="Owner name"><TextInput field="ownerName" /></Field>
              <Field label="Owner email"><TextInput field="ownerEmail" type="email" /></Field>
              <Field label="Owner phone"><TextInput field="ownerPhone" /></Field>
              <div className="rounded-md border border-line bg-slate-50 p-4 text-sm text-slate-500">Owner updates save to the tenant owner account. Passwords are never displayed in the browser.</div>
            </div>
          ) : null}

          {activeStep === "branding" ? (
            <div className="mt-5 grid gap-5">
              <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="grid gap-4">
                  <div className="rounded-md border border-line bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-black uppercase text-mint">Brand design system</p>
                        <h3 className="text-xl font-black text-ink">Presets and color behavior</h3>
                        <p className="mt-1 text-sm text-slate-500">Draft changes stay local until you save this branding step.</p>
                      </div>
                      <Field label="Preview mode">
                        <select className="input min-w-56" data-onboarding-field="brandPreviewMode" value={draft.brandPreviewMode || "desktop-public-site"} onChange={(event) => updateDraft("brandPreviewMode", event.target.value)}>
                          {brandPreviewModes.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                        </select>
                      </Field>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {brandPresets.map((preset) => (
                        <button className="rounded-md border border-line bg-white p-3 text-left transition hover:border-mint" type="button" key={preset.id} onClick={() => applyBrandPreset(preset)}>
                          <span className="block text-sm font-black text-ink">{preset.label}</span>
                          <span className="mt-2 flex gap-1">
                            {[preset.brandColor, preset.accentColor, preset.buttonColor].map((color) => <span className="h-5 w-8 rounded border border-line" key={color} style={{ background: color }} />)}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="mt-4 grid gap-3 rounded-md border border-line bg-white p-3">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="text-sm font-black uppercase text-slate-500">Draft and publish controls</p>
                          <p className="text-xs font-bold text-slate-500">Preview updates immediately. Publishing only happens when you intentionally save it.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button className={`nav-tab ${draft.brandPublishState !== "ready_to_publish" ? "active" : ""}`} type="button" onClick={() => updateDraft("brandPublishState", "draft")}>
                            Draft preview
                          </button>
                          <button className={`nav-tab ${draft.brandPublishState === "ready_to_publish" ? "active" : ""}`} type="button" onClick={() => updateDraft("brandPublishState", "ready_to_publish")}>
                            Published preview
                          </button>
                          <button className="button-primary" type="button" onClick={() => saveBrandingPublishState("ready_to_publish")} disabled={Boolean(saving)}>
                            {saving === "branding" ? "Publishing..." : "Publish branding"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Brand color mode">
                      <select className="input" data-onboarding-field="brand-color-mode" value={currentBrandTheme.mode} onChange={(event) => updateBrandTheme({ mode: event.target.value })}>
                        {brandColorModes.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Theme opacity">
                      <input className="input" data-onboarding-field="brand-opacity" type="range" min="0" max="1" step="0.05" value={currentBrandTheme.opacity} onChange={(event) => updateBrandTheme({ opacity: event.target.value })} />
                    </Field>
                    <Field label="Brand color">
                      <div className="grid grid-cols-[56px_1fr] gap-2">
                        <input className="h-10 w-full rounded-md border border-line" data-onboarding-field="brand-color-picker" type="color" value={currentBrandTheme.brandColor} onChange={(event) => updateBrandTheme({ brandColor: event.target.value })} />
                        <input className="input" data-onboarding-field="brandColor" value={draft.brandColor ?? currentBrandTheme.brandColor} onChange={(event) => updateBrandColorText("brandColor", event.target.value)} onBlur={(event) => updateBrandTheme({ brandColor: event.target.value })} />
                      </div>
                    </Field>
                    <Field label="Accent color">
                      <div className="grid grid-cols-[56px_1fr] gap-2">
                        <input className="h-10 w-full rounded-md border border-line" data-onboarding-field="accent-color-picker" type="color" value={currentBrandTheme.accentColor} onChange={(event) => updateBrandTheme({ accentColor: event.target.value })} />
                        <input className="input" data-onboarding-field="accentColor" value={draft.accentColor ?? currentBrandTheme.accentColor} onChange={(event) => updateBrandColorText("accentColor", event.target.value)} onBlur={(event) => updateBrandTheme({ accentColor: event.target.value })} />
                      </div>
                    </Field>
                    <Field label="Button color">
                      <div className="grid grid-cols-[56px_1fr] gap-2">
                        <input className="h-10 w-full rounded-md border border-line" data-onboarding-field="button-color-picker" type="color" value={currentBrandTheme.buttonColor} onChange={(event) => updateBrandTheme({ buttonColor: event.target.value })} />
                        <input className="input" data-onboarding-field="buttonColor" value={draft.buttonColor ?? currentBrandTheme.buttonColor} onChange={(event) => updateBrandColorText("buttonColor", event.target.value)} onBlur={(event) => updateBrandTheme({ buttonColor: event.target.value })} />
                      </div>
                    </Field>
                    <Field label="Overlay opacity">
                      <input className="input" data-onboarding-field="brand-overlay-opacity" type="range" min="0" max="0.9" step="0.05" value={currentBrandTheme.overlayOpacity} onChange={(event) => updateBrandTheme({ overlayOpacity: event.target.value })} />
                    </Field>
                    <Field label="Heading font">
                      <select className="input" data-onboarding-field="headingFont" value={currentBrandTheme.headingFont} onChange={(event) => updateBrandTheme({ headingFont: event.target.value })}>
                        {approvedBrandFonts.map((font) => <option key={font.id} value={font.stack}>{font.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Body font">
                      <select className="input" data-onboarding-field="bodyFont" value={currentBrandTheme.bodyFont} onChange={(event) => updateBrandTheme({ bodyFont: event.target.value })}>
                        {approvedBrandFonts.map((font) => <option key={font.id} value={font.stack}>{font.label}</option>)}
                      </select>
                    </Field>
                  </div>

                  <div className="grid gap-4 rounded-md border border-line bg-white p-4">
                    <div>
                      <h3 className="text-lg font-black text-ink">Brand palette</h3>
                      <p className="text-sm text-slate-500">Use approved restaurant color tokens, recent draft colors, and accessible text readouts.</p>
                    </div>
                    <div className="flex flex-wrap gap-2" aria-label="Brand palette">
                      {visibleBrandPalette.map((color) => (
                        <button
                          className="h-10 w-10 rounded-md border border-line"
                          type="button"
                          key={color}
                          onClick={() => updateBrandTheme({ brandColor: color })}
                          style={{ background: color }}
                          aria-label={`Use ${color} as brand color`}
                        />
                      ))}
                    </div>
                    <div className="grid gap-2 text-sm text-slate-600 md:grid-cols-3">
                      <div className="rounded-md bg-slate-50 p-3"><span className="block text-xs font-black uppercase text-slate-400">Hex</span><strong>{currentBrandTheme.brandColor}</strong></div>
                      <div className="rounded-md bg-slate-50 p-3"><span className="block text-xs font-black uppercase text-slate-400">RGB</span><strong>{rgbColorString(currentBrandTheme.brandColor)}</strong></div>
                      <div className="rounded-md bg-slate-50 p-3"><span className="block text-xs font-black uppercase text-slate-400">HSL</span><strong>{hslColorString(currentBrandTheme.brandColor)}</strong></div>
                    </div>
                  </div>

                  {["LINEAR_GRADIENT", "RADIAL_GRADIENT", "IMAGE_OVERLAY"].includes(currentBrandTheme.mode) ? (
                    <div className="rounded-md border border-line bg-white p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <h3 className="text-lg font-black text-ink">Gradient stops</h3>
                          <p className="text-sm text-slate-500">Use 2-5 accessible color stops for gradients and image overlays.</p>
                        </div>
                        <Field label="Angle">
                          <input className="input w-32" data-onboarding-field="brand-gradient-angle" type="number" min="0" max="360" value={currentBrandTheme.gradientAngle} onChange={(event) => updateBrandTheme({ gradientAngle: event.target.value })} />
                        </Field>
                      </div>
                      <div className="mt-4 grid gap-3">
                        {currentBrandTheme.gradientStops.map((stop, index) => (
                          <div className="grid gap-2 md:grid-cols-[60px_1fr_1fr_1fr_auto] md:items-end" key={`gradient-stop-${index}`}>
                            <input className="h-10 w-full rounded-md border border-line" data-onboarding-field={`brand-gradient-picker-${index}`} type="color" value={stop.color} onChange={(event) => updateBrandGradientStop(index, { color: event.target.value })} />
                            <Field label="Color"><input className="input" data-onboarding-field={`brand-gradient-color-${index}`} value={stop.color} onChange={(event) => updateBrandGradientStop(index, { color: event.target.value })} /></Field>
                            <Field label="Position"><input className="input" data-onboarding-field={`brand-gradient-position-${index}`} type="number" min="0" max="100" value={stop.position} onChange={(event) => updateBrandGradientStop(index, { position: event.target.valueAsNumber })} /></Field>
                            <Field label="Opacity"><input className="input" data-onboarding-field={`brand-gradient-opacity-${index}`} type="number" min="0" max="1" step="0.05" value={stop.opacity} onChange={(event) => updateBrandGradientStop(index, { opacity: event.target.valueAsNumber })} /></Field>
                            <button className="button-muted min-h-10" type="button" onClick={() => removeBrandGradientStop(index)} disabled={currentBrandTheme.gradientStops.length <= 2}><Trash2 size={16} />Remove</button>
                          </div>
                        ))}
                        <button className="button-muted w-fit" type="button" onClick={addBrandGradientStop} disabled={currentBrandTheme.gradientStops.length >= 5}><Plus size={16} />Add stop</button>
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-md border border-line bg-white p-4">
                    <h3 className="text-lg font-black text-ink">Hero media</h3>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <Field label="Hero mode">
                        <select className="input" data-onboarding-field="heroMediaMode" value={currentHeroMedia.mode} onChange={(event) => updateHeroMedia({ mode: event.target.value })}>
                          {heroMediaModes.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Image behavior">
                        <select className="input" data-onboarding-field="heroImageBehavior" value={currentHeroMedia.imageBehavior} onChange={(event) => updateHeroMedia({ imageBehavior: event.target.value })}>
                          {["cover", "contain", "center"].map((behavior) => <option key={behavior} value={behavior}>{readable(behavior)}</option>)}
                        </select>
                      </Field>
                      <Field label="Transition">
                        <select className="input" data-onboarding-field="heroTransition" value={currentHeroMedia.transition} onChange={(event) => updateHeroMedia({ transition: event.target.value })}>
                          {["fade", "slide", "none"].map((transition) => <option key={transition} value={transition}>{readable(transition)}</option>)}
                        </select>
                      </Field>
                      <Field label="Interval seconds"><input className="input" data-onboarding-field="heroIntervalSeconds" type="number" min="3" max="15" value={currentHeroMedia.intervalSeconds} onChange={(event) => updateHeroMedia({ intervalSeconds: event.target.valueAsNumber })} /></Field>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button className={`nav-tab ${currentHeroMedia.reducedMotionFallback ? "active" : ""}`} type="button" onClick={() => updateHeroMedia({ reducedMotionFallback: !currentHeroMedia.reducedMotionFallback })}>
                        {currentHeroMedia.reducedMotionFallback ? <CheckCircle2 size={16} /> : null}Reduced motion fallback
                      </button>
                      <button className="button-muted" type="button" onClick={addBlankHeroSlide}><Plus size={16} />Add blank slide</button>
                    </div>

                    <div className="mt-4 grid gap-3">
                      {currentHeroMedia.slides.map((slide, index) => (
                        <div className="grid gap-3 rounded-md border border-line bg-slate-50 p-3 lg:grid-cols-[120px_1fr_auto]" key={slide.id || `hero-slide-${index}`}>
                          {slide.imageUrl ? <img className="h-24 w-full rounded-md object-cover" src={resolveImage(slide.imageUrl)} alt={slide.altText || "Hero slide preview"} onError={handleSafeImageError} /> : <div className="grid h-24 w-full place-items-center rounded-md bg-white text-xs font-black text-slate-400">Hero image</div>}
                          <div className="grid gap-2 md:grid-cols-2">
                            <input className="input" data-onboarding-field={`hero-slide-image-${slide.id || index}`} value={slide.imageUrl} placeholder="Image URL" onChange={(event) => updateHeroSlide(index, { imageUrl: event.target.value })} />
                            <input className="input" data-onboarding-field={`hero-slide-mobile-${slide.id || index}`} value={slide.mobileImageUrl} placeholder="Mobile image URL" onChange={(event) => updateHeroSlide(index, { mobileImageUrl: event.target.value })} />
                            <input className="input" data-onboarding-field={`hero-slide-title-${slide.id || index}`} value={slide.title} placeholder="Slide title" onChange={(event) => updateHeroSlide(index, { title: event.target.value })} />
                            <input className="input" data-onboarding-field={`hero-slide-alt-${slide.id || index}`} value={slide.altText} placeholder="Accessible alt text" onChange={(event) => updateHeroSlide(index, { altText: event.target.value })} />
                          </div>
                          <div className="flex flex-wrap gap-2 self-start lg:grid">
                            <button className={`nav-tab ${slide.published !== false ? "active" : ""}`} type="button" onClick={() => updateHeroSlide(index, { published: slide.published === false })}>
                              {slide.published !== false ? <CheckCircle2 size={16} /> : null}{slide.published === false ? "Draft" : "Published"}
                            </button>
                            <button className="button-muted min-h-10" type="button" onClick={() => moveHeroSlide(index, -1)} disabled={index === 0}>Move up</button>
                            <button className="button-muted min-h-10" type="button" onClick={() => moveHeroSlide(index, 1)} disabled={index === currentHeroMedia.slides.length - 1}>Move down</button>
                            <button className="button-muted min-h-10" type="button" onClick={() => removeHeroSlide(index)}><Trash2 size={16} />Remove</button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {gallery.length ? (
                      <div className="mt-4">
                        <p className="text-sm font-black uppercase text-slate-500">Add from gallery</p>
                        <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
                          {gallery.filter((image) => isValidImageUrl(image.imageUrl)).slice(0, 8).map((image) => (
                            <button className="min-w-32 rounded-md border border-line bg-white p-2 text-left text-xs font-bold text-slate-600" type="button" key={image.id} onClick={() => addHeroSlideFromGallery(image)}>
                              <img className="mb-2 h-16 w-full rounded object-cover" src={resolveImage(image.imageUrl)} alt={image.altText || image.title || "Gallery image"} onError={handleSafeImageError} />
                              Add image
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {currentHeroMedia.mode === "VIDEO" ? (
                      <div className="mt-4 grid gap-3 rounded-md border border-line bg-slate-50 p-4">
                        <p className="text-sm font-black uppercase text-mint">Video hero foundation</p>
                        <input className="input" data-onboarding-field="hero-video-url" value={currentHeroMedia.video.url} placeholder="Video URL" onChange={(event) => updateHeroMedia({ video: { ...currentHeroMedia.video, url: event.target.value } })} />
                        <input className="input" data-onboarding-field="hero-video-poster" value={currentHeroMedia.video.posterUrl} placeholder="Poster image URL" onChange={(event) => updateHeroMedia({ video: { ...currentHeroMedia.video, posterUrl: event.target.value } })} />
                        <input className="input" data-onboarding-field="hero-video-captions" value={currentHeroMedia.video.captionsUrl} placeholder="Captions URL" onChange={(event) => updateHeroMedia({ video: { ...currentHeroMedia.video, captionsUrl: event.target.value } })} />
                        <div className="flex flex-wrap gap-2">
                          {["muted", "loop", "controls"].map((field) => (
                            <button className={`nav-tab ${currentHeroMedia.video[field] ? "active" : ""}`} type="button" key={field} onClick={() => updateHeroMedia({ video: { ...currentHeroMedia.video, [field]: !currentHeroMedia.video[field] } })}>
                              {currentHeroMedia.video[field] ? <CheckCircle2 size={16} /> : null}{readable(field)}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <aside className="grid gap-4 self-start">
                  <div className="rounded-md border border-line bg-white p-4">
                    <p className="text-sm font-black uppercase text-mint">Brand preview</p>
                    <div className="mt-3 overflow-hidden rounded-md border border-line bg-slate-950 text-white" style={brandingPreviewStyle}>
                      <div
                        className="min-h-64 bg-cover bg-center p-5"
                        style={currentBrandTheme.mode === "IMAGE_OVERLAY" && currentHeroMedia.slides[0]?.imageUrl
                          ? { backgroundImage: `linear-gradient(rgba(0,0,0,${currentBrandTheme.overlayOpacity}), rgba(0,0,0,${currentBrandTheme.overlayOpacity})), url(${resolveImage(currentHeroMedia.slides[0].imageUrl)})` }
                          : { background: brandThemeBackground(currentBrandTheme) }}
                      >
                        <p className="text-xs font-black uppercase tracking-wide" style={{ color: currentBrandTheme.accentColor }}>{draft.cuisineType || draft.categoryLabel || "Restaurant"}</p>
                        <h3 className="mt-8 text-4xl font-black" style={{ fontFamily: currentBrandTheme.headingFont }}>{draft.heroTitle || draft.publicBusinessName || "Restaurant name"}</h3>
                        <p className="mt-3 max-w-md text-sm leading-6 text-white/85">{draft.heroSubtitle || draft.description || "Your restaurant story and direct ordering message appear here."}</p>
                        <button className="mt-5 rounded-md px-5 py-3 text-sm font-black text-white" type="button" style={{ background: currentBrandTheme.buttonColor }}>Order online</button>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-md border border-line bg-slate-50 p-4">
                    <h3 className="text-lg font-black text-ink">Media uploads</h3>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="button-muted justify-center">Upload logo<input className="sr-only" type="file" accept={logoImageAccept} onChange={(event) => uploadOnboardingImage("restaurant-logo", event)} /></label>
                      <label className="button-muted justify-center">Upload favicon<input className="sr-only" type="file" accept={logoImageAccept} onChange={(event) => uploadOnboardingImage("restaurant-favicon", event)} /></label>
                      <label className="button-muted justify-center">Upload hero<input className="sr-only" type="file" accept={photoImageAccept} onChange={(event) => uploadOnboardingImage("restaurant-hero", event)} /></label>
                      <label className="button-muted justify-center">Mobile hero<input className="sr-only" type="file" accept={photoImageAccept} onChange={(event) => uploadOnboardingImage("restaurant-mobile-hero", event)} /></label>
                    </div>
                    {uploading ? <p className="text-sm font-bold text-slate-500" role="status" aria-live="polite">Uploading {readable(uploading)}...</p> : null}
                    <div className="grid gap-3">
                      {[
                        ["Logo", draft.logoUrl],
                        ["Hero", draft.heroImageUrl],
                        ["Mobile hero", draft.mobileHeroImageUrl],
                        ["Favicon", draft.faviconUrl]
                      ].map(([label, imageUrl]) => imageUrl ? <img className="h-28 w-full rounded-md object-cover" key={label} src={resolveImage(imageUrl)} alt={`${label} preview`} onError={handleSafeImageError} /> : null)}
                    </div>
                  </div>

                  <div className="grid gap-2 rounded-md border border-line bg-white p-4 text-sm text-slate-600">
                    <div className="summary-line"><span>Contrast</span><strong>{brandContrastStatus} ({brandButtonContrast}:1)</strong></div>
                    <div className="summary-line"><span>Hero images</span><strong>{heroSlideCount}</strong></div>
                    <div className="summary-line"><span>Animation</span><strong>{currentHeroMedia.reducedMotionFallback ? "Reduced motion ready" : "Needs fallback"}</strong></div>
                    <div className="summary-line"><span>Performance</span><strong>5MB image limit</strong></div>
                    <div className="summary-line"><span>Publish state</span><strong>{readable(draft.brandPublishState || "draft")}</strong></div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button className="button-primary flex-1 justify-center" type="button" onClick={() => saveStep("branding")} disabled={Boolean(saving)}>{saving === "branding" ? "Saving branding..." : "Save branding"}</button>
                    <button className="button-muted flex-1 justify-center" type="button" onClick={resetBrandingDraft}>Reset changes</button>
                  </div>
                </aside>
              </div>
            </div>
          ) : null}

          {activeStep === "content" ? (
            <div className="mt-5 grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Hero title"><TextInput field="heroTitle" /></Field>
                <Field label="Tagline"><TextInput field="tagline" /></Field>
                <Field label="Cuisine type"><TextInput field="cuisineType" /></Field>
                <Field label="CTA text"><TextInput field="ctaText" /></Field>
              </div>
              <Field label="Hero subtitle"><TextInput field="heroSubtitle" rows={3} /></Field>
              <Field label="About story"><TextInput field="aboutStory" rows={5} /></Field>
              <Field label="Mission statement"><TextInput field="missionStatement" rows={3} /></Field>
              <Field label="Owner story"><TextInput field="ownerStory" rows={3} /></Field>
              <Field label="Special offer"><TextInput field="specialOfferText" rows={2} /></Field>
              <Field label="Contact message"><TextInput field="contactMessage" rows={2} /></Field>
              <Field label="Catering message"><TextInput field="cateringMessage" rows={2} /></Field>
              <div className="flex flex-wrap gap-2">
                {Object.keys(websiteSectionDefaults).map((section) => <button className={`nav-tab ${draft.sectionSettingsJson?.[section] !== false ? "active" : ""}`} type="button" key={section} onClick={() => updateSection(section, draft.sectionSettingsJson?.[section] === false)}>{readable(section)}</button>)}
              </div>
            </div>
          ) : null}

          {activeStep === "hours" ? (
            <div className="mt-5 grid gap-4">
              <div className="rounded-md border border-line bg-slate-50 p-4">
                <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-end">
                  <Field label="Location timezone"><TextInput field="timezone" placeholder="America/Denver" /></Field>
                  <button className="button-muted justify-center" type="button" onClick={copyMondayToWeekdays}>Copy Monday to weekdays</button>
                  <button className="button-muted justify-center" type="button" onClick={() => copyHourToAll("monday")}>Copy Monday to all</button>
                </div>
                <p className="mt-3 text-sm text-slate-500">These hours power the public website and ordering availability. POS can stay internal even before public hours are complete.</p>
              </div>

              {businessHourErrors.length ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
                  <p className="font-black">Fix hours before saving:</p>
                  <ul className="mt-2 grid gap-1">
                    {businessHourErrors.map((hourError) => <li key={hourError}>- {hourError}</li>)}
                  </ul>
                </div>
              ) : null}

              <div className="grid gap-3">
                {businessHourDays.map((day) => {
                  const dayHours = normalizeBusinessHoursForDraft(draft.storeHoursJson)[day];
                  const noteId = `hours-note-${day}`;
                  const noteLength = String(dayHours.note || "").length;
                  return (
                    <div className="rounded-md border border-line bg-white p-4" key={day}>
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <h3 className="text-lg font-black text-ink">{readable(day)}</h3>
                          <p className="text-sm text-slate-500">{dayHours.closed ? "Closed" : `${dayHours.windows.length} service window${dayHours.windows.length === 1 ? "" : "s"}`}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button className={`nav-tab ${dayHours.closed ? "" : "active"}`} type="button" onClick={() => updateHourDay(day, { closed: false })}>Open</button>
                          <button className={`nav-tab ${dayHours.closed ? "active" : ""}`} type="button" onClick={() => updateHourDay(day, { closed: true })}>Closed</button>
                          <button className="button-muted min-h-10" type="button" onClick={() => copyHourToAll(day)}>Copy to all</button>
                        </div>
                      </div>
                      {!dayHours.closed ? (
                        <div className="mt-4 grid gap-3">
                          {dayHours.windows.map((window, index) => (
                            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end" key={`${day}-${index}`}>
                              <Field label="Open"><input className="input" type="time" value={window.open || ""} onChange={(event) => updateHourWindow(day, index, { open: event.target.value })} /></Field>
                              <Field label="Close"><input className="input" type="time" value={window.close || ""} onChange={(event) => updateHourWindow(day, index, { close: event.target.value })} /></Field>
                              <button className={`nav-tab min-h-10 ${window.overnight ? "active" : ""}`} type="button" onClick={() => updateHourWindow(day, index, { overnight: !window.overnight })}>Overnight</button>
                              <button className="button-muted min-h-10" type="button" onClick={() => removeHourWindow(day, index)}>Remove</button>
                            </div>
                          ))}
                          <button className="button-muted w-fit" type="button" onClick={() => addHourWindow(day)}>Add service window</button>
                        </div>
                      ) : null}
                      <div className="mt-3">
                        <Field label="Holiday or special-hours note">
                          <textarea
                            id={noteId}
                            className="input min-h-20"
                            data-onboarding-field={noteId}
                            value={dayHours.note || ""}
                            placeholder="Optional note"
                            maxLength={businessHourNoteMaxLength}
                            aria-describedby={`${noteId}-counter`}
                            onChange={(event) => updateHourDay(day, { note: event.target.value })}
                          />
                          <span id={`${noteId}-counter`} className="text-xs font-bold text-slate-500">{noteLength}/{businessHourNoteMaxLength}</span>
                        </Field>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {activeStep === "fulfillment" ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="flex flex-wrap gap-2 md:col-span-2"><Toggle field="pickupEnabled" label="Pickup enabled" /><Toggle field="deliveryEnabled" label="Delivery enabled" /><Toggle field="tipsEnabled" label="Tips enabled" /></div>
              <Field label="Delivery zone name"><TextInput field="deliveryZoneName" /></Field>
              <Field label="Delivery radius miles"><TextInput field="deliveryRadiusMiles" type="number" /></Field>
              <Field label="Delivery fee cents"><TextInput field="deliveryFeeCents" type="number" /></Field>
              <Field label="Minimum order cents"><TextInput field="minimumOrderCents" type="number" /></Field>
              <Field label="Average prep minutes"><TextInput field="averagePrepMinutes" type="number" /></Field>
              <div className="rounded-md border border-line bg-slate-50 p-4 text-sm text-slate-500">{deliveryZones.length} active delivery zone{deliveryZones.length === 1 ? "" : "s"} configured.</div>
            </div>
          ) : null}

          {activeStep === "menu" ? (
            <div className="mt-5 grid gap-5">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-md border border-line bg-slate-50 p-4"><p className="text-sm font-bold uppercase text-slate-500">Categories</p><strong className="text-3xl text-ink">{readiness.counts?.activeCategories || 0}</strong></div>
                <div className="rounded-md border border-line bg-slate-50 p-4"><p className="text-sm font-bold uppercase text-slate-500">Available items</p><strong className="text-3xl text-ink">{readiness.counts?.availableItems || 0}</strong></div>
                <a className="button-muted self-center justify-center" href={`${dashboardHref}#menu`}>Open full menu manager</a>
              </div>
              <form className="grid gap-3 md:grid-cols-[1fr_auto]" onSubmit={createQuickCategory}>
                <input className="input" data-onboarding-field="menu-category-name" value={menuDraft.categoryName} placeholder="Quick add category" maxLength={80} onChange={(event) => updateMenuDraft("categoryName", event.target.value)} />
                <button className="button-primary" type="submit" disabled={saving === "menu-category"}>{saving === "menu-category" ? "Adding..." : "Add category"}</button>
              </form>
              <form className="grid gap-3 md:grid-cols-4" onSubmit={createQuickItem}>
                <input className="input" data-onboarding-field="menu-item-name" value={menuDraft.itemName} placeholder="Featured item name" maxLength={120} onChange={(event) => updateMenuDraft("itemName", event.target.value)} />
                <input className="input" data-onboarding-field="menu-item-description" value={menuDraft.itemDescription} placeholder="Description" maxLength={500} onChange={(event) => updateMenuDraft("itemDescription", event.target.value)} />
                <input className="input" data-onboarding-field="menu-item-price-cents" type="number" value={menuDraft.itemPriceCents} onChange={(event) => updateMenuDraft("itemPriceCents", event.target.value)} />
                <button className="button-primary" type="submit" disabled={saving === "menu-item"}>{saving === "menu-item" ? "Adding..." : "Add item"}</button>
              </form>
              <div className="grid gap-3">
                {categories.flatMap((category) => (category.items || []).map((item) => ({ ...item, categoryName: category.name }))).slice(0, 8).map((item) => (
                  <div className="flex flex-col gap-3 rounded-md border border-line bg-white p-3 sm:flex-row sm:items-center sm:justify-between" key={item.id}>
                    <div className="flex items-center gap-3">
                      {item.imageUrl ? <img className="h-14 w-14 rounded-md object-cover" src={resolveImage(item.imageUrl)} alt={item.name} onError={handleSafeImageError} /> : <div className="grid h-14 w-14 place-items-center rounded-md bg-slate-100 text-xs font-black text-slate-400">IMG</div>}
                      <div><strong className="text-ink">{item.name}</strong><p className="text-xs text-slate-500">{item.categoryName} - {money(item.priceCents)}</p></div>
                    </div>
                    <label className="button-muted min-h-10 justify-center">{uploading === `menu-item:${item.id}` ? "Uploading..." : item.imageUrl ? "Replace image" : "Upload image"}<input className="sr-only" type="file" accept={photoImageAccept} onChange={(event) => uploadMenuItemImage(item.id, event)} /></label>
                  </div>
                ))}
              </div>
              {menuReviewMessage || menuDraftDirty ? <p className="text-sm font-bold text-slate-500" role="status" aria-live="polite">{menuReviewMessage || "Menu changes have not been reviewed yet."}</p> : null}
              <button className="button-primary justify-center" type="button" onClick={() => saveStep("menu")} disabled={saving === "menu"} aria-busy={saving === "menu"}>{menuReviewButtonLabel}</button>
            </div>
          ) : null}

          {activeStep === "gallery" ? (
            <div className="mt-5 grid gap-5">
              <div className="flex flex-wrap gap-2">
                <label className="button-muted">Upload gallery photo<input className="sr-only" type="file" accept={photoImageAccept} onChange={uploadGallery} /></label>
                <button className="button-primary" type="button" onClick={() => saveStep("gallery")}>{saving === "gallery" ? "Saving..." : "Save gallery step"}</button>
              </div>
              {uploading === "gallery" ? <p className="text-sm font-bold text-slate-500">Uploading gallery photo...</p> : null}
              {gallery.length ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  {gallery
                    .slice()
                    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
                    .map((image) => {
                      const imageDraft = galleryDrafts[image.id] || {};
                      const imageStatus = gallerySaveState[image.id] || { status: galleryDirtyMap[image.id] ? "DIRTY" : "IDLE", message: galleryDirtyMap[image.id] ? "Unsaved image metadata changes." : "" };
                      const captionLength = String(imageDraft.caption || "").length;
                      return (
                        <article className="rounded-md border border-line bg-white p-3" key={image.id} aria-busy={imageStatus.status === "SAVING"}>
                          <div className="grid gap-3 md:grid-cols-[160px_1fr]">
                            <a href={resolveImage(image.imageUrl)} target="_blank" rel="noreferrer">
                              <img className="h-40 w-full rounded-md object-cover" src={resolveImage(image.imageUrl)} alt={imageDraft.altText || image.altText || "Restaurant gallery"} onError={handleSafeImageError} />
                            </a>
                            <div className="grid gap-3">
                              <div className="grid gap-3 md:grid-cols-2">
                                <Field label="Title"><input className="input" data-onboarding-field={`gallery-title-${image.id}`} value={imageDraft.title || ""} maxLength={galleryTitleMaxLength} onChange={(event) => updateGalleryDraft(image.id, "title", event.target.value)} /></Field>
                                <Field label="Category"><input className="input" data-onboarding-field={`gallery-category-${image.id}`} value={imageDraft.category ?? "food" } maxLength={galleryCategoryMaxLength} onChange={(event) => updateGalleryDraft(image.id, "category", event.target.value)} /></Field>
                                <Field label="Alt text"><input className="input" data-onboarding-field={`gallery-alt-${image.id}`} value={imageDraft.altText || ""} maxLength={galleryAltTextMaxLength} onChange={(event) => updateGalleryDraft(image.id, "altText", event.target.value)} /></Field>
                                <Field label="Sort order"><input className="input" data-onboarding-field={`gallery-sort-${image.id}`} type="number" min="0" step="1" value={imageDraft.sortOrder ?? 0} onChange={(event) => updateGalleryDraft(image.id, "sortOrder", event.target.value)} /></Field>
                              </div>
                              <Field label="Caption"><textarea className="input min-h-20" data-onboarding-field={`gallery-caption-${image.id}`} value={imageDraft.caption || ""} maxLength={galleryCaptionMaxLength} aria-describedby={`gallery-caption-${image.id}-counter`} onChange={(event) => updateGalleryDraft(image.id, "caption", event.target.value)} /><span id={`gallery-caption-${image.id}-counter`} className="text-xs font-bold text-slate-500">{captionLength}/{galleryCaptionMaxLength}</span></Field>
                              <div className="flex flex-wrap gap-2">
                                <button className={`nav-tab ${imageDraft.published !== false ? "active" : ""}`} type="button" onClick={() => updateGalleryDraft(image.id, "published", imageDraft.published === false)}>Published</button>
                                <label className="button-muted">{uploading === `gallery:${image.id}` ? "Replacing..." : "Replace"}<input className="sr-only" type="file" accept={photoImageAccept} onChange={(event) => replaceGalleryImage(image.id, event)} /></label>
                                <button className="button-muted" type="button" onClick={() => saveGalleryImage(image.id)} disabled={saving === `gallery:${image.id}`} aria-busy={saving === `gallery:${image.id}`}>{saving === `gallery:${image.id}` ? "Saving..." : imageStatus.status === "SAVED" ? "Saved" : imageStatus.status === "ERROR" ? "Retry save" : "Save image"}</button>
                                <button className="button-muted" type="button" onClick={() => deleteGalleryImage(image.id)} disabled={saving === `gallery-delete:${image.id}`}>{saving === `gallery-delete:${image.id}` ? "Deleting..." : "Delete"}</button>
                              </div>
                              {imageStatus.message ? <p className={`text-xs font-bold ${imageStatus.status === "ERROR" ? "text-rose-600" : "text-slate-500"}`} role="status" aria-live="polite">{imageStatus.message}</p> : null}
                              <p className="text-xs text-slate-500">Featured gallery image support is not enabled in the current database schema, so this editor preserves existing supported fields only.</p>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-line bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">No gallery images yet. Upload a photo to start the public gallery.</div>
              )}
              <form className="grid gap-3 md:grid-cols-[180px_1fr_auto]" onSubmit={addSocial}>
                <select className="input" data-onboarding-field="social-platform" value={socialDraft.platform} onChange={(event) => updateSocialDraft("platform", event.target.value)}>{Object.keys(socialPlatformLabels).map((platform) => <option key={platform} value={platform}>{socialPlatformLabels[platform]}</option>)}</select>
                <input className="input" data-onboarding-field="social-url" value={socialDraft.url} placeholder="https://instagram.com/restaurant" onChange={(event) => updateSocialDraft("url", event.target.value)} />
                <button className="button-primary" type="submit" disabled={saving === "social"}>{saving === "social" ? "Saving..." : "Add social"}</button>
              </form>
              {socialDraftDirty ? <p className="text-sm font-bold text-slate-500" role="status" aria-live="polite">Social link changes are not saved yet.</p> : null}
              <div className="flex flex-wrap gap-2">{socialLinks.map((link) => <StatusPill key={link.id}>{readable(link.platform)}</StatusPill>)}</div>
            </div>
          ) : null}

          {activeStep === "domain" ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="Default Loohar subdomain"><TextInput field="defaultSubdomain" /></Field>
              <Field label="Custom domain"><TextInput field="customDomain" placeholder="restaurant.com" /></Field>
              <Field label="SEO title"><TextInput field="seoTitle" /></Field>
              <Field label="Canonical URL"><TextInput field="canonicalUrl" /></Field>
              <Field label="SEO description"><TextInput field="seoDescription" rows={3} /></Field>
              <Field label="SEO keywords"><TextInput field="seoKeywords" rows={3} /></Field>
              <div className="flex flex-wrap gap-2 md:col-span-2"><Toggle field="indexingEnabled" label="Allow search indexing" /></div>
              <div className="rounded-md border border-line bg-slate-50 p-4 text-sm text-slate-500 md:col-span-2">DNS target: <strong>{domain.dnsTarget || "cname.vercel-dns.com"}</strong>. Default URL: <strong>{domain.defaultUrl || publicHref}</strong></div>
            </div>
          ) : null}

          {activeStep === "payments" ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-md border border-line bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-slate-500">Loohar subscription</p>
                    <h3 className="mt-1 text-xl font-black text-ink">SaaS billing</h3>
                    <p className="mt-2 text-sm text-slate-500">This is what the restaurant pays Loohar for software access. It is separate from customer order money.</p>
                  </div>
                  <StatusPill tone={["ACTIVE", "TRIALING"].includes(platformSubscriptionStatus) ? "good" : platformSubscription ? "warn" : "neutral"}>{platformSubscription?.status || "Not found"}</StatusPill>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-slate-600">
                  <div className="summary-line"><span>Plan</span><strong>{readable(platformSubscription?.plan?.code || restaurant.plan || "Starter")}</strong></div>
                  <div className="summary-line"><span>Current period</span><strong>{platformSubscription?.currentPeriodEnd ? new Date(platformSubscription.currentPeriodEnd).toLocaleDateString() : "Provider managed"}</strong></div>
                </div>
                {platformSubscriptionStatus === "TRIALING" ? (
                  <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
                    {introProgramActiveMessage}
                  </div>
                ) : null}
                <button className="button-muted mt-4 w-full justify-center" type="button" onClick={openPlatformBillingPortal} disabled={paymentsLoading || saving === "billing-portal"}>{saving === "billing-portal" ? "Opening..." : "Manage Loohar billing"}</button>
              </div>
              <div className="rounded-md border border-line bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-slate-500">Customer order payments</p>
                    <h3 className="mt-1 text-xl font-black text-ink">Restaurant merchant account</h3>
                    <p className="mt-2 text-sm text-slate-500">Connect your restaurant merchant account to accept online card payments and receive payouts.</p>
                  </div>
                  <StatusPill tone={merchantAccount?.status === "ENABLED" ? "good" : merchantAccount?.status === "RESTRICTED" || merchantAccount?.status === "DISABLED" ? "bad" : "warn"}>{readable(merchantAccount?.status || "NOT_STARTED")}</StatusPill>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-slate-600">
                  <div className="summary-line"><span>Charges</span><strong>{merchantAccount?.stripeChargesEnabled ? "Enabled" : "Not enabled"}</strong></div>
                  <div className="summary-line"><span>Payouts</span><strong>{merchantAccount?.stripePayoutsEnabled ? "Enabled" : "Not enabled"}</strong></div>
                </div>
                <button className="button-primary mt-4 w-full justify-center" type="button" onClick={startMerchantOnboarding} disabled={paymentsLoading || saving === "merchant-onboarding"}>{saving === "merchant-onboarding" ? "Opening..." : merchantAccount?.status === "ENABLED" ? "Update Stripe Connect" : "Start Stripe Connect onboarding"}</button>
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 md:col-span-2">
                Paid online ordering stays blocked until the restaurant merchant account is enabled. Platform subscription revenue and restaurant order volume are tracked in separate records.
              </div>
            </div>
          ) : null}

          {activeStep === "review" ? (
            <div className="mt-5 grid gap-5">
              <div className="grid gap-3 md:grid-cols-2">
                {readiness.blockers?.length ? <div className="rounded-md border border-rose-200 bg-rose-50 p-4"><h3 className="font-black text-rose-700">Required before publishing</h3><ul className="mt-3 grid gap-2 text-sm text-rose-700">{readiness.blockers.map((blocker) => <li key={`${blocker.step}-${blocker.message}`}>• {blocker.message}</li>)}</ul></div> : <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-700">Website requirements are complete.</div>}
                <div className="rounded-md border border-line bg-slate-50 p-4"><h3 className="font-black text-ink">Launch summary</h3><p className="mt-2 text-sm text-slate-500">Website: {readiness.websiteReady ? "Ready" : "Not ready"}</p><p className="text-sm text-slate-500">Paid ordering: {readiness.orderingReady ? "Ready" : "Blocked until payments connect"}</p><p className="text-sm text-slate-500">Menu items: {readiness.counts?.availableItems || 0}</p></div>
              </div>
              {readiness.warnings?.length ? <div className="rounded-md border border-amber-200 bg-amber-50 p-4"><h3 className="font-black text-amber-800">Warnings</h3><ul className="mt-3 grid gap-2 text-sm text-amber-800">{readiness.warnings.map((warning) => <li key={`${warning.step}-${warning.message}`}>• {warning.message}</li>)}</ul></div> : null}
              <button className="button-primary w-fit" type="button" onClick={publish} disabled={saving === "publish" || !readiness.websiteReady}>{saving === "publish" ? "Publishing..." : "Publish website"}</button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
    </OnboardingFieldContext.Provider>
  );
}

function AuthPage({ mode = "platform", apiOnline, onLogin }) {
  const copy = {
    platform: { title: "Platform Login", detail: "Sign in to Loohar and continue to the dashboard for your role.", allowed: null },
    admin: { title: "Platform Owner Login", detail: "Super Admin access for tenant, domain, subscription, and audit management.", allowed: adminRoles },
    restaurant: { title: "Restaurant Owner Login", detail: "Restaurant owner and staff access for orders, menu, delivery, loyalty, and operations.", allowed: restaurantRoles.concat(["CASHIER", "KITCHEN_STAFF"]) }
  }[mode];
  const demoRoleByMode = {
    platform: "SUPER_ADMIN",
    admin: "SUPER_ADMIN",
    restaurant: "TENANT_OWNER",
    driver: "DRIVER",
    customer: "CUSTOMER"
  };
  const demoLoginRole = demoRoleByMode[mode] || "SUPER_ADMIN";
  const showDemoLogin = import.meta.env.DEV && mode !== "platform";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [session, setSession] = useState(null);
  const [step, setStep] = useState("login");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const userEditedCredentials = useRef(false);
  const emailInputRef = useRef(null);
  const passwordInputRef = useRef(null);
  const issues = passwordIssues(newPassword);
  const normalizedLoginEmail = email.trim().toLowerCase();
  const loginEmailValid = emailPattern.test(normalizedLoginEmail);
  const loginPasswordReady = password.length > 0;
  const canSubmitLogin = loginEmailValid && loginPasswordReady && !loading;
  const loginReadinessMessage = !email.trim()
    ? "Enter your email address."
    : !loginEmailValid
      ? "Enter a valid email address."
      : !loginPasswordReady
        ? "Enter your password."
        : "";

  function clearLoginFields() {
    setEmail("");
    setPassword("");
    if (emailInputRef.current) emailInputRef.current.value = "";
    if (passwordInputRef.current) passwordInputRef.current.value = "";
  }

  function markCredentialEntry() {
    userEditedCredentials.current = true;
  }

  useEffect(() => {
    userEditedCredentials.current = false;
    clearLoginFields();
    const clearIfUntouched = () => {
      if (!userEditedCredentials.current) {
        clearLoginFields();
      }
    };
    window.addEventListener("pageshow", clearIfUntouched);
    const timers = [80, 400, 1200].map((delay) => window.setTimeout(clearIfUntouched, delay));
    return () => {
      window.removeEventListener("pageshow", clearIfUntouched);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [mode]);

  function continueAfterAuth(user) {
    navigateInApp(returnToForUser(user), { replace: true });
  }

  async function verifyAuthenticatedSession(payload) {
    if (!payload?.accessToken) throw new Error("Login did not return a usable session.");
    const current = await api("/api/auth/me", {
      token: payload.accessToken,
      authRetry: false,
      clearOnUnauthorized: false
    });
    const memberships = current.memberships || payload.memberships || [];
    return {
      ...payload,
      memberships,
      user: normalizeSessionUser(current.user || payload.user, memberships)
    };
  }

  function handleAuthenticated(payload) {
    const normalizedUser = normalizeSessionUser(payload.user, payload.memberships);
    const sessionPayload = { ...payload, user: normalizedUser };
    if (copy.allowed && !copy.allowed.includes(normalizedUser?.role)) {
      clearSession();
      setError("Access denied for this login area. Use the correct Loohar login for your role.");
      return;
    }
    setSession(sessionPayload);
    if (requiresPasswordChange(normalizedUser)) {
      setStep("password");
      return;
    }
    if (normalizedUser?.mfaEnabled) {
      setStep("mfa");
      return;
    }
    onLogin(sessionPayload);
    continueAfterAuth(normalizedUser);
  }

  async function submitLogin(event) {
    event.preventDefault();
    setError("");
    if (!canSubmitLogin) {
      setError(loginReadinessMessage || "Enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      const payload = await api("/api/auth/login", {
        method: "POST",
        body: { email: normalizedLoginEmail, password },
        skipAuth: true,
        authRetry: false,
        clearOnUnauthorized: false
      });
      handleAuthenticated(await verifyAuthenticatedSession(payload));
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setPassword("");
      setLoading(false);
    }
  }

  async function submitDemoLogin() {
    setError("");
    userEditedCredentials.current = false;
    clearLoginFields();
    setLoading(true);
    try {
      const payload = await api("/api/auth/demo-login", {
        method: "POST",
        body: { role: demoLoginRole },
        skipAuth: true,
        authRetry: false,
        clearOnUnauthorized: false
      });
      handleAuthenticated(await verifyAuthenticatedSession(payload));
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setLoading(false);
    }
  }

  async function submitPasswordChange(event) {
    event.preventDefault();
    setError("");
    if (issues.length > 0) return setError("Create a stronger password before continuing.");
    if (newPassword !== confirmPassword) return setError("Password confirmation does not match.");
    setLoading(true);
    try {
      const payload = await api("/api/auth/change-password", { method: "POST", token: session?.accessToken, body: { newPassword } });
      const reloadedSession = await api("/api/auth/me", { token: payload.accessToken, authRetry: false, clearOnUnauthorized: false })
        .then((current) => ({ ...payload, memberships: current.memberships || payload.memberships || [], user: normalizeSessionUser(current.user || payload.user, current.memberships || payload.memberships || []) }))
        .catch(() => ({ ...payload, user: normalizeSessionUser(payload.user, payload.memberships || []) }));
      onLogin(reloadedSession);
      setSession(reloadedSession);
      setNewPassword("");
      setConfirmPassword("");
      if (requiresPasswordChange(reloadedSession.user)) {
        setError("Password changed, but your account is still marked for reset. Please contact the platform owner.");
        return;
      }
      if (reloadedSession.user.mfaEnabled) {
        setStep("mfa");
        return;
      }
      continueAfterAuth(reloadedSession.user);
    } catch (passwordError) {
      setError(passwordError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <PublicLayout compactNav className="public-auth-page">
      <div className="public-container public-auth-grid">
        <section className="panel">
          <p className="text-xs font-bold uppercase tracking-wide text-mint">{appName} secure access</p>
          <h1 className="public-auth-title">{copy.title}</h1>
          <p className="mt-3 text-slate-500">{copy.detail}</p>
          <div className="mt-5 grid gap-2 text-sm text-slate-600">
            <div className="summary-line"><span>Live API</span><strong>{apiOnline ? "Connected" : "Unavailable"}</strong></div>
            <div className="summary-line"><span>Password policy</span><strong>12+ characters</strong></div>
            <div className="summary-line"><span>MFA</span><strong>Foundation ready</strong></div>
          </div>
        </section>

        {step === "login" ? (
          <form className="panel grid gap-4" noValidate onSubmit={submitLogin}>
            <h2 className="panel-title">Sign in</h2>
            <InlineError message={error} />
            <label className="text-sm font-semibold text-slate-600">
              Email
              <input
                ref={emailInputRef}
                className="input mt-1"
                type="email"
                name="email"
                autoComplete="username"
                value={email}
                onKeyDown={markCredentialEntry}
                onPaste={markCredentialEntry}
                onDrop={markCredentialEntry}
                onChange={(event) => {
                  markCredentialEntry();
                  setEmail(event.target.value);
                }}
              />
            </label>
            <label className="text-sm font-semibold text-slate-600">
              Password
              <input
                ref={passwordInputRef}
                className="input mt-1"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onKeyDown={markCredentialEntry}
                onPaste={markCredentialEntry}
                onDrop={markCredentialEntry}
                onChange={(event) => {
                  markCredentialEntry();
                  setPassword(event.target.value);
                }}
              />
            </label>
            <button className="button-primary justify-center" type="submit" disabled={!canSubmitLogin}><LogIn size={18} />{loading ? "Signing in" : "Login"}</button>
            <a className="text-center text-sm font-bold text-mint" href="/forgot-password">Forgot password?</a>
            {showDemoLogin ? <button className="button-muted justify-center" type="button" disabled={loading} onClick={submitDemoLogin}>Use seeded development account</button> : null}
            {import.meta.env.DEV && mode === "platform" ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                Restaurant owner testing uses the dedicated <a className="underline" href="/restaurant/login">Restaurant Login</a>.
              </p>
            ) : null}
            {loginReadinessMessage && !error ? <p className="text-sm text-slate-500">{loginReadinessMessage}</p> : null}
            {!apiOnline ? <p className="text-sm text-slate-500">Live API health is unavailable. You can still submit; network or credential errors will appear here.</p> : null}
          </form>
        ) : null}

        {step === "password" ? (
          <form className="panel grid gap-4" onSubmit={submitPasswordChange}>
            <h2 className="panel-title">Create a stronger password</h2>
            <p className="text-sm text-slate-500">This account is using a temporary password. Change it before entering Loohar.</p>
            <InlineError message={error} />
            <label className="text-sm font-semibold text-slate-600">
              New password
              <input className="input mt-1" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            </label>
            <label className="text-sm font-semibold text-slate-600">
              Confirm password
              <input className="input mt-1" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </label>
            <div className="grid gap-2 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
              {strongPasswordChecks.map((check) => {
                const passed = check.test(newPassword);
                return <span className={passed ? "font-bold text-emerald-700" : ""} key={check.label}>{passed ? "OK" : "-"} {check.label}</span>;
              })}
            </div>
            <button className="button-primary justify-center" type="submit" disabled={loading}>{loading ? "Saving password" : "Save password and continue"}</button>
          </form>
        ) : null}

        {step === "mfa" ? (
          <section className="panel">
            <h2 className="panel-title">MFA verification</h2>
            <p className="mt-3 text-sm text-slate-500">MFA is enabled for this account. This screen is ready for future TOTP, SMS, or email verification.</p>
            <button className="button-primary mt-5" onClick={() => continueAfterAuth(session.user)}>Continue securely</button>
          </section>
        ) : null}
      </div>
    </PublicLayout>
  );
}

function ForgotPasswordPage({ apiOnline }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!apiOnline) return setError("Password reset requires the live API.");
    setLoading(true);
    try {
      const payload = await api("/api/auth/forgot-password", {
        method: "POST",
        body: { email: email.trim().toLowerCase() },
        skipAuth: true,
        authRetry: false,
        clearOnUnauthorized: false
      });
      setMessage(payload.message || "If that email exists, a password reset link has been sent.");
    } catch (forgotError) {
      setError(forgotError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <PublicLayout compactNav className="public-auth-page">
      <div className="public-container public-auth-single">
        <form className="panel grid gap-4" onSubmit={submit}>
          <h1 className="public-auth-title">Reset password</h1>
          <p className="text-sm text-slate-500">Enter the account email and Loohar will create a one-time reset link.</p>
          <InlineError message={error} />
          {message ? <div className="success-box">{message}</div> : null}
          <input className="input" type="email" autoComplete="username" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <div className="flex flex-wrap gap-2">
            <button className="button-primary" type="submit" disabled={loading}>{loading ? "Sending" : "Send reset link"}</button>
            <a className="button-muted" href="/login">Back to login</a>
          </div>
        </form>
      </div>
    </PublicLayout>
  );
}

function ResetPasswordPage({ apiOnline, token: resetToken, onLogin }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const issues = passwordIssues(newPassword);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!apiOnline) return setError("Password reset requires the live API.");
    if (issues.length > 0) return setError("Create a stronger password before continuing.");
    if (newPassword !== confirmPassword) return setError("Password confirmation does not match.");
    setLoading(true);
    try {
      const payload = await api("/api/auth/reset-password", {
        method: "POST",
        body: { token: resetToken, newPassword },
        skipAuth: true,
        authRetry: false,
        clearOnUnauthorized: false
      });
      const current = await api("/api/auth/me", { token: payload.accessToken, authRetry: false, clearOnUnauthorized: false });
      const memberships = current.memberships || payload.memberships || [];
      const nextSession = { ...payload, memberships, user: normalizeSessionUser(current.user || payload.user, memberships) };
      onLogin(nextSession);
      navigateInApp(dashboardPathFor(nextSession.user), { replace: true });
    } catch (resetError) {
      setError(resetError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <PublicLayout compactNav className="public-auth-page">
      <div className="public-container public-auth-single">
        <form className="panel grid gap-4" onSubmit={submit}>
          <h1 className="public-auth-title">Create new password</h1>
          <InlineError message={error} />
          <input className="input" type="password" autoComplete="new-password" placeholder="New password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          <input className="input" type="password" autoComplete="new-password" placeholder="Confirm password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          <div className="grid gap-2 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            {strongPasswordChecks.map((check) => {
              const passed = check.test(newPassword);
              return <span className={passed ? "font-bold text-emerald-700" : ""} key={check.label}>{passed ? "OK" : "-"} {check.label}</span>;
            })}
          </div>
          <button className="button-primary justify-center" type="submit" disabled={loading}>{loading ? "Saving password" : "Save password and continue"}</button>
        </form>
      </div>
    </PublicLayout>
  );
}

function AdminCreateBusinessPage({ apiOnline, token }) {
  const [form, setForm] = useState(createAdminForm);
  const [formErrors, setFormErrors] = useState({});
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [error, setError] = useState("");
  const liveFormErrors = validateTenantForm(form);
  const missingFields = tenantRequiredFields.filter(([field]) => liveFormErrors[field]).map(([, label]) => label);
  const canCreateTenant = apiOnline && token && Object.keys(liveFormErrors).length === 0 && !creatingTenant;
  const createDisabledReason = !apiOnline
    ? "Start the API to create real tenants."
    : !token
      ? "Log in as Super Admin to create tenants."
      : Object.keys(liveFormErrors).length > 0
        ? "Resolve the missing fields below to enable business creation."
        : "";

  useEffect(() => {
    if (import.meta.env.DEV && Object.keys(liveFormErrors).length > 0) {
      globalThis.console?.info?.("Create Business validation errors", liveFormErrors);
    }
  }, [JSON.stringify(liveFormErrors)]);

  function updateBusinessName(businessName) {
    setForm((current) => ({
      ...current,
      businessName,
      publicBusinessName: current.publicBusinessName && current.publicBusinessName !== current.businessName ? current.publicBusinessName : businessName,
      slug: current.slug && current.slug !== slugify(current.businessName) ? current.slug : slugify(businessName)
    }));
  }

  function updateBusinessType(businessType) {
    setForm((current) => ({ ...current, businessType, enabledModules: moduleDefaultsFor(businessType), categoryLabel: current.categoryLabel || readable(businessType) }));
  }

  async function createBusiness(event) {
    event.preventDefault();
    if (!apiOnline) return setError("Live API connection is required to create a business.");
    if (!token) return setError("Super Admin login is required to create a business.");
    const nextForm = { ...form, slug: form.slug || slugify(form.businessName || form.publicBusinessName) };
    const nextErrors = validateTenantForm(nextForm);
    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      if (import.meta.env.DEV) globalThis.console?.info?.("Create Business submit blocked", nextErrors);
      return setError("Fix the highlighted fields before creating this business.");
    }
    setError("");
    setCreatingTenant(true);
    try {
      const idempotencyKey = window.crypto?.randomUUID?.() || `tenant-${nextForm.slug}-${Date.now()}`;
      await api("/api/admin/tenants", {
        method: "POST",
        body: tenantCreatePayload(nextForm),
        headers: { "Idempotency-Key": idempotencyKey }
      });
      window.sessionStorage.setItem("looharTenantCreated", nextForm.slug);
      navigateInApp("/admin", { replace: true });
    } catch (createError) {
      globalThis.console?.error?.("Business create failed", createError);
      setError(createError.message);
    } finally {
      setCreatingTenant(false);
    }
  }

  return (
    <div className="space-y-6" id="dashboard">
      <SectionHeader eyebrow="Master Admin" title="Create New Business" icon={Plus} action={<a className="button-muted" href="/admin">Back to Dashboard</a>} />
      <InlineError message={error} />
      {!apiOnline ? <div className="error-box">This is a live-only form. Start the API and PostgreSQL/Supabase connection before creating a business.</div> : null}
      <form className="space-y-5" onSubmit={createBusiness}>
        <section className="panel">
          <h3 className="panel-title">Business Information</h3>
          <div className="mt-4 form-grid">
            <div><input className="input" placeholder="Business name" value={form.businessName} onChange={(event) => updateBusinessName(event.target.value)} /><FieldError message={formErrors.businessName} /></div>
            <div><input className="input" placeholder="Public business name" value={form.publicBusinessName} onChange={(event) => setForm({ ...form, publicBusinessName: event.target.value })} /><FieldError message={formErrors.publicBusinessName} /></div>
            <div><input className="input" placeholder="slug" value={form.slug} onChange={(event) => setForm({ ...form, slug: slugify(event.target.value) })} /><FieldError message={formErrors.slug} /></div>
            <div>
              <select className="select" value={form.businessType} onChange={(event) => updateBusinessType(event.target.value)}>
                {businessTypes.map((type) => <option value={type} key={type}>{readable(type)}</option>)}
              </select>
              <FieldError message={formErrors.businessType} />
            </div>
            <div><input className="input" placeholder="Category or cuisine label" value={form.categoryLabel} onChange={(event) => setForm({ ...form, categoryLabel: event.target.value })} /><FieldError message={formErrors.categoryLabel} /></div>
            <div><input className="input" placeholder="Business email" value={form.businessEmail} onChange={(event) => setForm({ ...form, businessEmail: event.target.value })} /><FieldError message={formErrors.businessEmail} /></div>
            <div><input className="input" placeholder="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /><FieldError message={formErrors.phone} /></div>
          </div>
        </section>

        <section className="panel">
          <h3 className="panel-title">Owner Information</h3>
          <div className="mt-4 form-grid">
            <div><input className="input" placeholder="Owner email" value={form.ownerEmail} onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })} /><FieldError message={formErrors.ownerEmail} /></div>
            <div className="rounded-md border border-line bg-slate-50 p-3 text-sm font-semibold text-slate-600">Loohar emails a secure set-password link when an email provider is configured. Temporary passwords are never displayed or stored in the browser.</div>
          </div>
        </section>

        <section className="panel">
          <h3 className="panel-title">Address Information</h3>
          <div className="mt-4 form-grid">
            <div><input className="input" placeholder="Address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /><FieldError message={formErrors.address} /></div>
            <div><input className="input" placeholder="City" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /><FieldError message={formErrors.city} /></div>
            <div><input className="input" placeholder="State" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} /><FieldError message={formErrors.state} /></div>
            <div><input className="input" placeholder="ZIP" value={form.zip} onChange={(event) => setForm({ ...form, zip: event.target.value })} /><FieldError message={formErrors.zip} /></div>
            <div><input className="input" placeholder="Timezone" value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} /><FieldError message={formErrors.timezone} /></div>
          </div>
        </section>

        <section className="panel">
          <h3 className="panel-title">Modules</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {businessModules.map((module) => (
              <button className={`seg ${form.enabledModules.includes(module) ? "active" : ""}`} key={module} type="button" onClick={() => setForm((current) => ({ ...current, enabledModules: current.enabledModules.includes(module) ? current.enabledModules.filter((item) => item !== module) : [...current.enabledModules, module] }))}>
                {readable(module)}
              </button>
            ))}
          </div>
          <FieldError message={formErrors.enabledModules} />
        </section>

        <section className="panel">
          <h3 className="panel-title">Website Settings</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            <label className={`seg ${form.websiteEnabled ? "active" : ""}`}><input type="checkbox" checked={form.websiteEnabled} onChange={(event) => setForm({ ...form, websiteEnabled: event.target.checked })} />Website</label>
            <label className={`seg ${form.pickupEnabled ? "active" : ""}`}><input type="checkbox" checked={form.pickupEnabled} onChange={(event) => setForm({ ...form, pickupEnabled: event.target.checked })} />Pickup</label>
            <label className={`seg ${form.deliveryEnabled ? "active" : ""}`}><input type="checkbox" checked={form.deliveryEnabled} onChange={(event) => setForm({ ...form, deliveryEnabled: event.target.checked })} />Delivery</label>
          </div>
        </section>

        <section className="panel">
          <h3 className="panel-title">Plan</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
            <div>
              <select className="select" value={form.billingMode} onChange={(event) => setForm({ ...form, billingMode: event.target.value })}>
                <option value="INTRO_TRIAL">Start introductory program</option>
                <option value="PAYMENT_LINK">Send payment link</option>
                <option value="STRIPE_CHECKOUT">Collect payment now</option>
                <option value="COMPLIMENTARY">Complimentary</option>
                <option value="MANUAL_INVOICE">Manual invoice</option>
                <option value="DRAFT">Save as draft</option>
              </select>
              <FieldError message={formErrors.billingMode} />
            </div>
            <div>
              <select className="select" value={form.plan} onChange={(event) => setForm({ ...form, plan: event.target.value })}>
                {planCodes.map((plan) => <option value={plan} key={plan}>{readable(plan)}</option>)}
              </select>
              <FieldError message={formErrors.plan} />
            </div>
            <button className="button-primary justify-center" type="submit" disabled={!canCreateTenant}><Plus size={18} />{creatingTenant ? "Creating Business" : "Create Business"}</button>
            <a className="button-muted justify-center" href="/admin">Back to Dashboard</a>
          </div>
          {createDisabledReason ? <p className={`mt-3 text-sm font-semibold ${!apiOnline ? "text-rose-600" : "text-slate-500"}`}>{createDisabledReason}</p> : null}
          {missingFields.length > 0 ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-bold">Missing required fields</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {missingFields.map((field) => <span className="rounded-md bg-white px-2 py-1 font-semibold" key={field}>{field}</span>)}
              </div>
            </div>
          ) : null}
        </section>
      </form>
    </div>
  );
}

function AdminAuditPage({ apiOnline, token, businessId }) {
  const [business, setBusiness] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadAudit() {
    if (!apiOnline) return setError("Live API connection is required to view audit history.");
    if (!token) return setError("Super Admin login is required to view audit history.");
    setLoading(true);
    setError("");
    try {
      const payload = await api(`/api/admin/tenants/${businessId}/audit`, { token });
      setBusiness(payload.business || payload.restaurant);
      setAuditLogs(payload.auditLogs || []);
    } catch (auditError) {
      setError(auditError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAudit();
  }, [apiOnline, token, businessId]);

  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Audit History" title={business?.businessName || business?.name || "Business Audit History"} icon={Shield} action={<a className="button-muted" href="/admin">Back to Dashboard</a>} />
      <InlineError message={error} />
      <div className="panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="panel-title">Tenant events</h3>
          <button className="button-muted" onClick={loadAudit}><RefreshCw size={16} />{loading ? "Loading" : "Refresh"}</button>
        </div>
        {auditLogs.length === 0 ? <EmptyState title="No audit events" detail="Create, edit, domain, plan, status, and impersonation events for this tenant will appear here." /> : (
          <div className="space-y-3">
            {auditLogs.map((log) => (
              <div className="rounded-md border border-line p-3" key={log.id}>
                <div className="flex flex-col justify-between gap-2 md:flex-row md:items-center">
                  <div>
                    <p className="font-semibold text-ink">{log.action}</p>
                    <p className="text-sm text-slate-500">{log.actor?.name || log.actor?.email || "System"} - {log.entityType || "Business"}</p>
                  </div>
                  <StatusPill>{log.createdAt ? new Date(log.createdAt).toLocaleString() : "Recent"}</StatusPill>
                </div>
                {log.metadataJson ? <pre className="mt-3 overflow-x-auto rounded-md bg-slate-50 p-3 text-xs text-slate-600">{JSON.stringify(log.metadataJson, null, 2)}</pre> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function demoAdminSummary() {
  return {
    totalBusinesses: demoRestaurants.length,
    activeBusinesses: demoRestaurants.filter((restaurant) => restaurant.status === "ACTIVE").length,
    suspendedBusinesses: demoRestaurants.filter((restaurant) => restaurant.status === "SUSPENDED").length,
    totalCustomers: 1348,
    totalOrders: demoOrders.length,
    grossOrderVolume: 1840000,
    activeDrivers: 9,
    professionalPlans: demoRestaurants.filter((restaurant) => planFor(restaurant) === "PROFESSIONAL").length,
    enterprisePlans: demoRestaurants.filter((restaurant) => planFor(restaurant) === "ENTERPRISE").length,
    technologyFeeCents: 81200
  };
}

function AdminDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => <div className="h-28 animate-pulse rounded-md border border-line bg-white" key={index} />)}
      </div>
      <div className="panel">
        <div className="mb-4 h-6 w-52 animate-pulse rounded bg-slate-200" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, index) => <div className="h-14 animate-pulse rounded bg-slate-100" key={index} />)}
        </div>
      </div>
    </div>
  );
}

function AdminApp({ apiOnline, token, onImpersonate }) {
  const [restaurants, setRestaurants] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [savingTenant, setSavingTenant] = useState(false);
  const [businessTypeFilter, setBusinessTypeFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [userTenant, setUserTenant] = useState(null);
  const [tenantUsers, setTenantUsers] = useState([]);
  const [loadingTenantUsers, setLoadingTenantUsers] = useState(false);
  const [temporaryPasswordNotice, setTemporaryPasswordNotice] = useState("");
  const filteredRestaurants = restaurants.filter((restaurant) => {
    const matchesType = businessTypeFilter ? restaurant.businessType === businessTypeFilter : true;
    const haystack = [restaurant.businessName, restaurant.name, restaurant.slug, restaurant.email, ownerFor(restaurant)?.email].filter(Boolean).join(" ").toLowerCase();
    return matchesType && haystack.includes(searchQuery.trim().toLowerCase());
  });
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(filteredRestaurants.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRestaurants = filteredRestaurants.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const summary = analytics || {};
  const activeCount = summary.activeBusinesses ?? restaurants.filter((restaurant) => restaurant.status === "ACTIVE").length;
  const suspendedCount = summary.suspendedBusinesses ?? restaurants.filter((restaurant) => restaurant.status === "SUSPENDED").length;
  const customerCount = summary.totalCustomers ?? restaurants.reduce((sum, restaurant) => sum + (restaurant._count?.customers || 0), 0);
  const orderCount = summary.totalOrders ?? restaurants.reduce((sum, restaurant) => sum + (restaurant._count?.orders || 0), 0);
  const currentPlanCounts = planCodes.reduce((counts, plan) => {
    counts[plan] = restaurants.filter((restaurant) => planFor(restaurant) === plan).length;
    return counts;
  }, {});

  async function loadAdmin() {
    if (!apiOnline) {
      setRestaurants(demoRestaurants);
      setAnalytics(demoAdminSummary());
      setLoading(false);
      return;
    }
    if (!token) {
      setRestaurants([]);
      setAnalytics(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [restaurantPayload, summaryPayload] = await Promise.all([
        api(businessTypeFilter ? `/api/admin/businesses?businessType=${businessTypeFilter}` : "/api/admin/businesses", { token }),
        api("/api/admin/dashboard-summary", { token })
      ]);
      setRestaurants(restaurantPayload.businesses || restaurantPayload.restaurants || []);
      setAnalytics(summaryPayload);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAdmin();
  }, [apiOnline, token, businessTypeFilter]);

  useEffect(() => {
    const createdSlug = window.sessionStorage.getItem("looharTenantCreated");
    if (createdSlug) {
      window.sessionStorage.removeItem("looharTenantCreated");
      setSuccess(`Business ${createdSlug} created successfully. The live business list has been refreshed.`);
    }
  }, []);

  useEffect(() => {
    setPage(1);
  }, [businessTypeFilter, searchQuery]);

  async function suspendRestaurant(restaurant) {
    if (!apiOnline) return;
    setError("");
    setSuccess("");
    try {
      await api(`/api/admin/tenants/${restaurant.id}/status`, { method: "PATCH", token, body: { status: "SUSPENDED" } });
      setSuccess(`${restaurant.businessName || restaurant.name} suspended.`);
      await loadAdmin();
    } catch (suspendError) {
      setError(suspendError.message);
    }
  }

  async function activateRestaurant(restaurant) {
    if (!apiOnline) return;
    setError("");
    setSuccess("");
    try {
      await api(`/api/admin/tenants/${restaurant.id}/status`, { method: "PATCH", token, body: { status: "ACTIVE" } });
      setSuccess(`${restaurant.businessName || restaurant.name} activated.`);
      await loadAdmin();
    } catch (activateError) {
      setError(activateError.message);
    }
  }

  async function impersonate(restaurant) {
    if (!apiOnline) return;
    try {
      const payload = await api(`/api/admin/restaurants/${restaurant.id}/impersonate`, { method: "POST", token });
      onImpersonate({ accessToken: payload.accessToken, refreshToken: payload.refreshToken, user: payload.impersonatedUser });
    } catch (impersonateError) {
      setError(impersonateError.message);
    }
  }

  async function assignPlan(restaurant, planCode) {
    if (!apiOnline) return;
    setError("");
    setSuccess("");
    try {
      await api(`/api/admin/tenants/${restaurant.id}/plan`, { method: "PATCH", token, body: { plan: planCode } });
      setSuccess(`${restaurant.businessName || restaurant.name} moved to ${planCode}.`);
      await loadAdmin();
    } catch (planError) {
      setError(planError.message);
    }
  }

  async function manageDomain(restaurant) {
    if (!apiOnline) return;
    setError("");
    setSuccess("");
    try {
      const domain = domainFor(restaurant);
      await api(`/api/admin/tenants/${restaurant.id}/domain`, { method: "PATCH", token, body: { defaultSubdomain: domain?.defaultSubdomain || restaurant.slug, customDomain: domain?.customDomain || "", domainStatus: "PENDING_VERIFICATION", dnsTarget: domain?.dnsTarget || "cname.vercel-dns.com", sslStatus: "PENDING" } });
      setSuccess("Domain verification reset. Create a CNAME record for www pointing to cname.vercel-dns.com.");
      await loadAdmin();
    } catch (domainError) {
      setError(domainError.message);
    }
  }

  async function deleteRestaurant(restaurant) {
    if (!apiOnline) return;
    setError("");
    setSuccess("");
    try {
      await api(`/api/admin/tenants/${restaurant.id}/status`, { method: "PATCH", token, body: { status: "DELETED" } });
      setSuccess(`${restaurant.businessName || restaurant.name} soft deleted.`);
      await loadAdmin();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function saveSelectedTenant(event) {
    event.preventDefault();
    if (!selectedTenant) return;
    if (!apiOnline) return setError("API is offline. Demo tenants can be reviewed, but changes are not saved.");
    setError("");
    setSuccess("");
    setSavingTenant(true);
    try {
      await api(`/api/admin/tenants/${selectedTenant.id}`, { method: "PATCH", token, body: scalarTenantPayload(selectedTenant) });
      await api(`/api/admin/tenants/${selectedTenant.id}/website`, { method: "PATCH", token, body: websiteSettingsPayload(selectedTenant) });
      await api(`/api/admin/tenants/${selectedTenant.id}/domain`, { method: "PATCH", token, body: domainSettingsPayload(selectedTenant) });
      await api(`/api/admin/tenants/${selectedTenant.id}/plan`, { method: "PATCH", token, body: { plan: selectedTenant.planCode } });
      setSelectedTenant(null);
      setSuccess("Tenant settings saved. Public website, tenant table, and admin views now use the updated name and branding.");
      await loadAdmin();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingTenant(false);
    }
  }

  function ownerFor(restaurant) {
    return restaurant.users?.find((user) => ["TENANT_OWNER", "RESTAURANT_OWNER"].includes(user.role)) || restaurant.users?.[0];
  }

  function domainFor(restaurant) {
    return restaurant.domains?.[0];
  }

  async function openTenantUsers(restaurant) {
    if (!apiOnline) return;
    setError("");
    setSuccess("");
    setTemporaryPasswordNotice("");
    setUserTenant(restaurant);
    setLoadingTenantUsers(true);
    try {
      const payload = await api(`/api/admin/tenants/${restaurant.id}/users`, { token });
      setTenantUsers(payload.users || []);
    } catch (usersError) {
      setError(usersError.message);
    } finally {
      setLoadingTenantUsers(false);
    }
  }

  async function resetTenantUserPassword(userRow) {
    setError("");
    setSuccess("");
    try {
      const payload = await api(`/api/admin/users/${userRow.id}/reset-password`, {
        method: "POST",
        token,
        body: {}
      });
      setTenantUsers((users) => users.map((item) => item.id === payload.user.id ? payload.user : item));
      setTemporaryPasswordNotice(`${payload.user.email} now requires a password reset. No temporary password is displayed.`);
      setSuccess("Password reset saved. The user must change this password on next login.");
    } catch (resetError) {
      setError(resetError.message);
    }
  }

  async function updateTenantUserStatus(userRow, status) {
    setError("");
    setSuccess("");
    try {
      const payload = await api(`/api/admin/users/${userRow.id}/status`, { method: "PATCH", token, body: { status } });
      setTenantUsers((users) => users.map((item) => item.id === payload.user.id ? payload.user : item));
      setSuccess(`${payload.user.email} status updated to ${payload.user.status}.`);
    } catch (statusError) {
      setError(statusError.message);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Platform owner" title="Loohar Admin Center" icon={Shield} action={<button className="button-muted" onClick={loadAdmin}><RefreshCw size={18} />Refresh</button>} />
      <InlineError message={error} />
      {success ? <div className="success-box">{success}</div> : null}
      {!apiOnline ? <div className="error-box">API offline. Master Admin is showing demo data only; create, edit, domain, impersonation, and plan changes need the live API.</div> : null}
      {loading && apiOnline ? <AdminDashboardSkeleton /> : null}
      {!loading || !apiOnline ? (
      <>
      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={Store} label="Food businesses" value={summary.totalBusinesses ?? restaurants.length} detail={`${activeCount} active / ${suspendedCount} suspended`} />
        <Stat icon={ReceiptText} label="Gross order volume" value={money(summary.grossOrderVolume)} detail="Across all tenants" />
        <Stat icon={Truck} label="Active drivers" value={summary.activeDrivers ?? 0} detail="Owned restaurant fleets" />
        <Stat icon={CreditCard} label="Tech fees" value={money(summary.technologyFeeCents)} detail="Subscription plus usage" />
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={Users} label="Customers" value={customerCount} detail="Direct restaurant customers" />
        <Stat icon={PackageCheck} label="Orders" value={orderCount} detail="Tenant-owned order records" />
        <Stat icon={TicketPercent} label="Professional plans" value={summary.professionalPlans ?? currentPlanCounts.PROFESSIONAL ?? 0} detail="Delivery, loyalty, coupons" />
        <Stat icon={Shield} label="Enterprise plans" value={summary.enterprisePlans ?? currentPlanCounts.ENTERPRISE ?? 0} detail="Analytics and multi-location ready" />
      </div>
      <div className="panel">
        <div className="food-business-toolbar">
          <h3 className="panel-title">Food businesses</h3>
          <div className="food-business-toolbar-controls">
            <label className="food-business-search">
              <Search size={16} />
              <input placeholder="Search businesses" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
            </label>
            <select className="select food-business-filter" value={businessTypeFilter} onChange={(event) => setBusinessTypeFilter(event.target.value)}>
              <option value="">All food business types</option>
              {businessTypes.map((type) => <option value={type} key={type}>{readable(type)}</option>)}
            </select>
            <div className="food-business-count"><RefreshCw size={16} /><span>{loading ? "Loading" : `${filteredRestaurants.length} businesses`}</span></div>
          </div>
        </div>
        {filteredRestaurants.length === 0 ? <EmptyState title="No food businesses found" detail="Adjust the search or create a new restaurant tenant from Add Business." /> : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Food Business</th><th>Type</th><th>Owner</th><th>Website</th><th>Plan</th><th>Orders</th><th>Customers</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {pageRestaurants.map((restaurant) => (
                    <tr key={restaurant.id}>
                      <td><strong>{restaurant.businessName || restaurant.name}</strong><span>{restaurant.slug} - {restaurant.email || "No business email"}</span><span>{[restaurant.address, restaurant.city, restaurant.state, restaurant.zip].filter(Boolean).join(", ") || "Address not set"}</span></td>
                      <td>{readable(restaurant.businessType || "RESTAURANT")}</td>
                      <td>{ownerFor(restaurant)?.email || "Owner not loaded"}</td>
                      <td>
                        <StatusPill tone={restaurant.websiteSettings?.websiteEnabled === false ? "warn" : restaurant.onboarding?.websitePublished ? "good" : "neutral"}>{restaurant.websiteSettings?.websiteEnabled === false ? "Disabled" : restaurant.onboarding?.websitePublished ? "Published" : "Enabled"}</StatusPill>
                        <span>{restaurant.onboarding ? `Setup ${restaurant.onboarding.completionPercentage || 0}% - ${readable(restaurant.onboarding.currentStep || restaurant.onboarding.status || "setup")}` : restaurant.websiteSettings?.websiteEnabled === false ? "Food ordering" : "Website active"}</span>
                      </td>
                      <td>{readable(planFor(restaurant))}</td>
                      <td>{restaurant._count?.orders || 0}</td>
                      <td>{restaurant._count?.customers || 0}</td>
                      <td><StatusPill tone={restaurant.status === "ACTIVE" ? "good" : restaurant.status === "SUSPENDED" ? "warn" : "bad"}>{restaurant.status}</StatusPill></td>
                      <td>
                        <details className="action-menu">
                          <summary><MenuIcon size={16} />Actions</summary>
                          <div>
                            <button onClick={() => setSelectedTenant(tenantEditState(restaurant))}>Edit Tenant</button>
                            <button disabled={!apiOnline} onClick={() => openTenantUsers(restaurant)}>Manage Users</button>
                            <a href={publicPathForSlug(restaurant.slug)} target="_blank" rel="noreferrer">View Website</a>
                            <a href={`/restaurant/${restaurant.slug}`} target="_blank" rel="noreferrer">Open Restaurant Admin</a>
                            <button onClick={() => setSelectedTenant(tenantEditState(restaurant))}>Website Settings</button>
                            <button disabled={!apiOnline} onClick={() => manageDomain(restaurant)}>Manage Domain</button>
                            <a href={`/admin/business/${restaurant.id}/audit`}>Audit History</a>
                            <button disabled={!apiOnline} onClick={() => impersonate(restaurant)}>Impersonate</button>
                            {["SUSPENDED", "DELETED"].includes(restaurant.status) ? <button disabled={!apiOnline} onClick={() => activateRestaurant(restaurant)}>Activate</button> : <button disabled={!apiOnline} onClick={() => suspendRestaurant(restaurant)}>Suspend</button>}
                            {planCodes.map((plan) => <button disabled={!apiOnline || planFor(restaurant) === plan} key={plan} onClick={() => assignPlan(restaurant, plan)}>Change Plan: {readable(plan)}</button>)}
                            <button disabled={!apiOnline || restaurant.status === "DELETED"} onClick={() => deleteRestaurant(restaurant)}>Delete Business</button>
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-col justify-between gap-3 border-t border-line pt-4 sm:flex-row sm:items-center">
              <p className="text-sm font-semibold text-slate-500">Page {currentPage} of {pageCount}</p>
              <div className="flex gap-2">
                <button className="button-muted" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
                <button className="button-muted" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</button>
              </div>
            </div>
          </>
        )}
      </div>
      </>
      ) : null}
      {selectedTenant ? (
        <div className="modal-backdrop">
          <form className="tenant-modal form-grid" onSubmit={saveSelectedTenant}>
            <div className="md:col-span-3 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mint">Edit tenant</p>
                <h3 className="panel-title">{selectedTenant.businessName || selectedTenant.name}</h3>
              </div>
              <button className="button-muted" type="button" onClick={() => setSelectedTenant(null)}>Cancel</button>
            </div>
            <input className="input" value={selectedTenant.name} placeholder="Business name" onChange={(event) => setSelectedTenant({ ...selectedTenant, name: event.target.value })} />
            <input className="input" value={selectedTenant.businessName} placeholder="Public business name" onChange={(event) => setSelectedTenant({ ...selectedTenant, businessName: event.target.value })} />
            <input className="input" value={selectedTenant.slug} placeholder="slug" onChange={(event) => setSelectedTenant({ ...selectedTenant, slug: slugify(event.target.value) })} />
            <select className="select" value={selectedTenant.businessType} onChange={(event) => setSelectedTenant({ ...selectedTenant, businessType: event.target.value, enabledModules: moduleDefaultsFor(event.target.value) })}>
              {businessTypes.map((type) => <option value={type} key={type}>{readable(type)}</option>)}
            </select>
            <select className="select" value={selectedTenant.planCode} onChange={(event) => setSelectedTenant({ ...selectedTenant, planCode: event.target.value })}>
              {planCodes.map((plan) => <option key={plan}>{plan}</option>)}
            </select>
            <select className="select" value={selectedTenant.status} onChange={(event) => setSelectedTenant({ ...selectedTenant, status: event.target.value })}>
              <option>ACTIVE</option><option>PENDING</option><option>SUSPENDED</option><option>DELETED</option>
            </select>
            <input className="input" value={selectedTenant.ownerEmail} placeholder="Owner email" onChange={(event) => setSelectedTenant({ ...selectedTenant, ownerEmail: event.target.value })} />
            <input className="input" value={selectedTenant.email} placeholder="Business email" onChange={(event) => setSelectedTenant({ ...selectedTenant, email: event.target.value })} />
            <input className="input" value={selectedTenant.phone} placeholder="Phone" onChange={(event) => setSelectedTenant({ ...selectedTenant, phone: event.target.value })} />
            <input className="input" value={selectedTenant.cuisineType} placeholder="Category/cuisine label" onChange={(event) => setSelectedTenant({ ...selectedTenant, cuisineType: event.target.value })} />
            <input className="input" value={selectedTenant.address} placeholder="Address" onChange={(event) => setSelectedTenant({ ...selectedTenant, address: event.target.value })} />
            <input className="input" value={selectedTenant.city} placeholder="City" onChange={(event) => setSelectedTenant({ ...selectedTenant, city: event.target.value })} />
            <input className="input" value={selectedTenant.state} placeholder="State" onChange={(event) => setSelectedTenant({ ...selectedTenant, state: event.target.value })} />
            <input className="input" value={selectedTenant.zip} placeholder="ZIP" onChange={(event) => setSelectedTenant({ ...selectedTenant, zip: event.target.value })} />
            <input className="input md:col-span-2" value={selectedTenant.customDomain} placeholder="Custom domain" onChange={(event) => setSelectedTenant({ ...selectedTenant, customDomain: event.target.value })} />
            <select className="select" value={selectedTenant.domainStatus} onChange={(event) => setSelectedTenant({ ...selectedTenant, domainStatus: event.target.value })}>
              <option>NOT_CONFIGURED</option><option>PENDING_VERIFICATION</option><option>VERIFIED</option><option>SSL_PENDING</option><option>ACTIVE</option><option>FAILED</option><option>ERROR</option>
            </select>
            <input className="input" value={selectedTenant.defaultSubdomain} placeholder="Default subdomain" onChange={(event) => setSelectedTenant({ ...selectedTenant, defaultSubdomain: slugify(event.target.value) })} />
            <input className="input" value={selectedTenant.dnsTarget} placeholder="DNS target" onChange={(event) => setSelectedTenant({ ...selectedTenant, dnsTarget: event.target.value })} />
            <select className="select" value={selectedTenant.sslStatus} onChange={(event) => setSelectedTenant({ ...selectedTenant, sslStatus: event.target.value })}>
              <option>NOT_CONFIGURED</option><option>PENDING</option><option>SSL_PENDING</option><option>ACTIVE</option><option>FAILED</option><option>ERROR</option>
            </select>
            <select className="select md:col-span-2" value={selectedTenant.canonicalDomain === selectedTenant.customDomain && selectedTenant.customDomain ? "CUSTOM_DOMAIN" : "DEFAULT_SUBDOMAIN"} onChange={(event) => setSelectedTenant({ ...selectedTenant, canonicalDomain: event.target.value === "CUSTOM_DOMAIN" ? selectedTenant.customDomain : selectedTenant.primaryDomain || `${selectedTenant.defaultSubdomain || selectedTenant.slug}.${tenantRootDomain}` })}>
              <option value="DEFAULT_SUBDOMAIN">Canonical: Loohar subdomain</option>
              <option value="CUSTOM_DOMAIN">Canonical: custom domain</option>
            </select>
            <div className="md:col-span-3 border-t border-line pt-4">
              <h4 className="font-bold text-ink">Website Settings</h4>
            </div>
            <input className="input" value={selectedTenant.logoUrl} placeholder="Restaurant logo URL" onChange={(event) => setSelectedTenant({ ...selectedTenant, logoUrl: event.target.value })} />
            <input className="input" value={selectedTenant.heroImageUrl} placeholder="Hero banner image URL" onChange={(event) => setSelectedTenant({ ...selectedTenant, heroImageUrl: event.target.value })} />
            <input className="input" value={selectedTenant.tagline} placeholder="Restaurant tagline" onChange={(event) => setSelectedTenant({ ...selectedTenant, tagline: event.target.value })} />
            <input className="input" value={selectedTenant.brandColor} placeholder="Brand color" onChange={(event) => setSelectedTenant({ ...selectedTenant, brandColor: event.target.value })} />
            <input className="input" value={selectedTenant.accentColor} placeholder="Accent color" onChange={(event) => setSelectedTenant({ ...selectedTenant, accentColor: event.target.value })} />
            <input className="input" value={selectedTenant.heroTitle} placeholder="Homepage headline" onChange={(event) => setSelectedTenant({ ...selectedTenant, heroTitle: event.target.value })} />
            <input className="input" value={selectedTenant.heroSubtitle} placeholder="Homepage subtitle" onChange={(event) => setSelectedTenant({ ...selectedTenant, heroSubtitle: event.target.value })} />
            <input className="input" value={selectedTenant.specialOfferText} placeholder="Special offer text" onChange={(event) => setSelectedTenant({ ...selectedTenant, specialOfferText: event.target.value })} />
            <input className="input" value={selectedTenant.seoTitle} placeholder="SEO title" onChange={(event) => setSelectedTenant({ ...selectedTenant, seoTitle: event.target.value })} />
            <textarea className="input min-h-24 md:col-span-3" value={selectedTenant.aboutStory} placeholder="About story" onChange={(event) => setSelectedTenant({ ...selectedTenant, aboutStory: event.target.value })} />
            <textarea className="input min-h-20 md:col-span-3" value={selectedTenant.seoDescription} placeholder="SEO description" onChange={(event) => setSelectedTenant({ ...selectedTenant, seoDescription: event.target.value })} />
            <div className="md:col-span-3 flex flex-wrap gap-2">
              <label className="seg"><input type="checkbox" checked={selectedTenant.websiteEnabled} onChange={(event) => setSelectedTenant({ ...selectedTenant, websiteEnabled: event.target.checked })} />Website enabled</label>
              <label className="seg"><input type="checkbox" checked={selectedTenant.pickupEnabled} onChange={(event) => setSelectedTenant({ ...selectedTenant, pickupEnabled: event.target.checked })} />Pickup enabled</label>
              <label className="seg"><input type="checkbox" checked={selectedTenant.deliveryEnabled} onChange={(event) => setSelectedTenant({ ...selectedTenant, deliveryEnabled: event.target.checked })} />Delivery enabled</label>
            </div>
            <div className="md:col-span-3 flex flex-wrap gap-2">
              {businessModules.map((module) => (
                <button className={`seg ${selectedTenant.enabledModules.includes(module) ? "active" : ""}`} key={module} type="button" onClick={() => setSelectedTenant((current) => ({ ...current, enabledModules: current.enabledModules.includes(module) ? current.enabledModules.filter((item) => item !== module) : [...current.enabledModules, module] }))}>
                  {readable(module)}
                </button>
              ))}
            </div>
            <button className="button-primary" type="submit" disabled={!apiOnline || savingTenant}>{savingTenant ? "Saving tenant" : "Save tenant"}</button>
            <button className="button-muted" type="button" onClick={() => setSelectedTenant(null)}>Cancel</button>
          </form>
        </div>
      ) : null}
      {userTenant ? (
        <div className="modal-backdrop">
          <div className="tenant-modal">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mint">Tenant users</p>
                <h3 className="panel-title">{userTenant.businessName || userTenant.name}</h3>
              </div>
              <button className="button-muted" type="button" onClick={() => setUserTenant(null)}>Close</button>
            </div>
            {temporaryPasswordNotice ? <div className="success-box mt-4">{temporaryPasswordNotice}</div> : null}
            {loadingTenantUsers ? <AdminDashboardSkeleton /> : tenantUsers.length === 0 ? <EmptyState title="No tenant users" detail="This tenant does not have owner, staff, or driver accounts yet." /> : (
              <div className="mt-4 overflow-x-auto">
                <table className="table">
                  <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Password</th><th>Actions</th></tr></thead>
                  <tbody>
                    {tenantUsers.map((tenantUser) => (
                      <tr key={tenantUser.id}>
                        <td><strong>{tenantUser.name}</strong><span>{tenantUser.email}</span></td>
                        <td>{readable(tenantUser.role)}</td>
                        <td><StatusPill tone={tenantUser.status === "ACTIVE" ? "good" : tenantUser.status === "PASSWORD_RESET_REQUIRED" ? "warn" : "bad"}>{readable(tenantUser.status || "ACTIVE")}</StatusPill></td>
                        <td>{tenantUser.forcePasswordChange || tenantUser.temporaryPassword ? "Reset required" : tenantUser.passwordChangedAt ? "Permanent" : "Not changed"}</td>
                        <td>
                          <div className="flex flex-wrap gap-2">
                            <button className="button-muted" onClick={() => resetTenantUserPassword(tenantUser)}>Reset Password</button>
                            {tenantUser.status === "ACTIVE" ? <button className="button-muted" onClick={() => updateTenantUserStatus(tenantUser, "DISABLED")}>Disable</button> : <button className="button-muted" onClick={() => updateTenantUserStatus(tenantUser, "ACTIVE")}>Enable</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TrialCountdownPanel({ program }) {
  if (!program?.enabled) return null;
  const percentElapsed = Math.max(0, Math.min(100, Number(program.percentElapsed || 0)));
  const daysRemaining = Number.isFinite(Number(program.daysRemaining)) ? Number(program.daysRemaining) : null;
  const totalDays = Number.isFinite(Number(program.totalDays)) ? Number(program.totalDays) : null;
  const dayNumber = Number.isFinite(Number(program.dayNumber)) ? Number(program.dayNumber) : null;
  const endDateLabel = program.endsAt ? new Date(program.endsAt).toLocaleDateString() : "";
  const reminderCount = Array.isArray(program.upcomingReminders) ? program.upcomingReminders.length : 0;

  return (
    <div className="panel border-mint/30 bg-emerald-50/50">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-mint">{program.name || "Introductory Program"}</p>
          <h3 className="panel-title">Trial countdown</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {daysRemaining === null ? "Introductory access is active." : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining`}
            {endDateLabel ? ` until ${endDateLabel}.` : "."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone="good">{program.planCode ? readable(program.planCode) : "Intro trial"}</StatusPill>
          <StatusPill>{readable(program.paymentLifecycleStatus || "PAYMENT_METHOD_REQUIRED")}</StatusPill>
          {program.noAutomaticCharge ? <StatusPill tone="good">No automatic charge</StatusPill> : null}
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
        <div className="h-full rounded-full bg-mint" style={{ width: `${percentElapsed}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-slate-500">
        <span>{dayNumber && totalDays ? `Day ${dayNumber} of ${totalDays}` : "Program timing is managed by Loohar."}</span>
        {reminderCount ? <span>{reminderCount} scheduled reminder{reminderCount === 1 ? "" : "s"}</span> : null}
        {program.savingsBaseline?.status ? <span>Savings baseline: {readable(program.savingsBaseline.status)}</span> : null}
      </div>
    </div>
  );
}

function RestaurantDashboardPage({ children }) {
  return <div className="restaurant-owner-page restaurant-owner-page-dashboard">{children}</div>;
}

const posDeviceTypes = [
  { value: "POS_KIOSK", label: "POS kiosk" },
  { value: "MAIN_TERMINAL", label: "Main terminal" },
  { value: "APPROVED_MOBILE", label: "Approved mobile" },
  { value: "KITCHEN_DISPLAY", label: "Kitchen display" },
  { value: "MANAGER_DEVICE", label: "Manager device" }
];

const posOrderTypes = [
  { value: "WALK_IN", label: "Walk-in" },
  { value: "DINE_IN", label: "Dine-in" },
  { value: "PICKUP", label: "Pickup" },
  { value: "DELIVERY", label: "Delivery" }
];

function posDeviceFingerprint() {
  if (typeof window === "undefined") return "";
  const storageKey = "loohar-pos-device-fingerprint";
  const existing = window.localStorage.getItem(storageKey);
  if (existing) return existing;
  const randomPart = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const fingerprint = `browser-${randomPart}`;
  window.localStorage.setItem(storageKey, fingerprint);
  return fingerprint;
}

const posOwnerRoles = new Set(["TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_MANAGER"]);

function posCanManageSubscription(user) {
  return posOwnerRoles.has(normalizeRole(user?.role));
}

function normalizedPosError(error, user) {
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
  if (payload.upgradeRequired || code.startsWith("FEATURE_") || code === "PLAN_NOT_INCLUDED" || message.toLowerCase().includes("feature not included")) {
    return ownerOperator
      ? {
          tone: "upgrade",
          title: `${payload.featureLabel || "POS register"} is not included in the current plan.`,
          detail: `Current plan: ${payload.currentPlan || "Unknown"}. Required plan: ${payload.requiredPlan || "Professional"}.`,
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

function PosNotice({ error, user, onRetry, subscriptionHref }) {
  const normalized = normalizedPosError(error, user);
  if (!normalized) return null;
  const isUpgrade = normalized.tone === "upgrade";
  const isRateLimit = normalized.action === "Retry POS";
  return (
    <div className={`pos-notice ${normalized.tone}`} role="alert">
      <Shield size={20} aria-hidden="true" />
      <div>
        <strong>{normalized.title}</strong>
        <span>{normalized.detail}</span>
      </div>
      {isUpgrade ? <a className="button-muted" href={subscriptionHref}>Review Subscription</a> : null}
      {isRateLimit ? <button className="button-muted" type="button" onClick={onRetry}>Retry</button> : null}
    </div>
  );
}

function centsFromDollarInput(value) {
  const cleaned = String(value || "").replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  return Math.max(0, Math.round(Number(cleaned) * 100) || 0);
}

function itemCategoryId(item) {
  return item.categoryId || item.category?.id || "";
}

function itemCategoryName(item) {
  return item.categoryName || item.category?.name || "Menu";
}

const POS_MENU_STATUS = Object.freeze({
  IDLE: "IDLE",
  INITIAL_LOADING: "INITIAL_LOADING",
  SUCCESS: "SUCCESS",
  EMPTY: "EMPTY",
  REFRESHING: "REFRESHING",
  STALE: "STALE",
  ERROR: "ERROR",
  ENTITLEMENT_DENIED: "ENTITLEMENT_DENIED"
});

function emptyPosMenuState() {
  return {
    status: POS_MENU_STATUS.IDLE,
    categories: [],
    lastSuccessfulCategories: [],
    itemCount: 0,
    lastSuccessfulItemCount: 0,
    menuVersion: "",
    requestId: "",
    requestSequence: 0,
    acceptedSequence: 0,
    tenantId: "",
    locationId: "",
    availabilitySummary: null,
    menuDiagnostics: null,
    loadedAt: null,
    error: null,
    refreshError: null
  };
}

function countPosMenuItems(categories = []) {
  return categories.reduce((total, category) => total + (category.items || []).length, 0);
}

function posMenuErrorCode(error) {
  return String(error?.payload?.code || error?.code || "");
}

function isPosEntitlementDenied(error) {
  const code = posMenuErrorCode(error);
  const status = Number(error?.status || error?.payload?.status || 0);
  return status === 403 && (code.startsWith("FEATURE_") || code === "PLAN_NOT_INCLUDED" || code === "SUBSCRIPTION_SUSPENDED" || code === "SUBSCRIPTION_READ_ONLY");
}

function normalizePosMenuPayload(payload = {}) {
  const categories = Array.isArray(payload.categories) ? payload.categories : [];
  const availabilitySummary = payload.availabilitySummary || null;
  const menuDiagnostics = payload.menuDiagnostics || null;
  const itemCount = Number(
    availabilitySummary?.visibleItems ??
    availabilitySummary?.items ??
    menuDiagnostics?.visibleItems ??
    countPosMenuItems(categories)
  );
  return {
    categories,
    itemCount,
    availabilitySummary,
    menuDiagnostics,
    menuVersion: String(payload.menuVersion || `${categories.length}:${itemCount}`),
    tenantId: payload.tenantId || payload.restaurantId || "",
    locationId: payload.locationId || "",
    generatedAt: payload.generatedAt || new Date().toISOString(),
    requestId: payload.requestId || ""
  };
}

function debugPosMenu(event, details = {}) {
  if (import.meta.env?.DEV) {
    globalThis.console?.debug?.(`[Loohar POS menu] ${event}`, details);
  }
}

function posPerformanceMark(name) {
  if (!import.meta.env?.DEV || !globalThis.performance?.mark) return;
  globalThis.performance.mark(name);
}

function posPerformanceMeasure(name, start, end) {
  if (!import.meta.env?.DEV || !globalThis.performance?.measure) return;
  try {
    const measure = globalThis.performance.measure(name, start, end);
    const entry = Array.isArray(measure) ? measure[0] : measure;
    globalThis.console?.debug?.("[Loohar POS perf]", name, `${Math.round(entry?.duration || 0)}ms`);
  } catch {
    // Performance markers are diagnostics only; never block POS usage.
  }
}

function posCartLineId() {
  return `cart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePosModifierGroups(item = {}) {
  const groups = (item.optionGroups || [])
    .map((group) => ({
      ...group,
      id: group.id || `group-${group.name}`,
      minSelect: Number(group.minSelect || 0),
      maxSelect: Math.max(1, Number(group.maxSelect || 1)),
      options: [...(group.options || [])]
        .filter((option) => option.available !== false)
        .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || String(left.name || "").localeCompare(String(right.name || "")))
    }))
    .filter((group) => group.options.length > 0)
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || String(left.name || "").localeCompare(String(right.name || "")));
  const groupedOptionIds = new Set(groups.flatMap((group) => group.options.map((option) => option.id)));
  const looseOptions = (item.options || [])
    .filter((option) => option.available !== false && !groupedOptionIds.has(option.id))
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || String(left.name || "").localeCompare(String(right.name || "")));
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

function selectedPosModifierRows(item = {}, selections = {}) {
  return normalizePosModifierGroups(item).flatMap((group) => {
    const selectedIds = new Set(selections[group.id] || []);
    return group.options
      .filter((option) => selectedIds.has(option.id))
      .map((option) => ({
        id: option.id,
        optionId: option.id,
        name: option.name,
        priceCents: Number(option.priceCents || 0),
        groupId: group.id,
        groupName: group.name
      }));
  });
}

function posModifierOptionIds(selections = {}) {
  return Object.values(selections).flat().filter(Boolean);
}

function posModifierValidationErrors(item = {}, selections = {}) {
  return normalizePosModifierGroups(item).flatMap((group) => {
    const count = (selections[group.id] || []).length;
    const minimum = group.required ? Math.max(1, Number(group.minSelect || 0)) : Number(group.minSelect || 0);
    const maximum = Math.max(1, Number(group.maxSelect || 1));
    if (count < minimum) return [`Choose at least ${minimum} ${minimum === 1 ? "option" : "options"} for ${group.name}.`];
    if (count > maximum) return [`Choose no more than ${maximum} ${maximum === 1 ? "option" : "options"} for ${group.name}.`];
    return [];
  });
}

function posModifierSignature(optionIds = [], instructions = "") {
  return `${[...new Set(optionIds)].sort().join("|")}::${String(instructions || "").trim()}`;
}

function posSelectionsFromOptionIds(item = {}, optionIds = []) {
  const selected = new Set(optionIds || []);
  return Object.fromEntries(normalizePosModifierGroups(item).map((group) => [
    group.id,
    group.options.filter((option) => selected.has(option.id)).map((option) => option.id)
  ]));
}

function RestaurantKioskShell({ apiOnline, apiMode, token, user, restaurantSlug, onLogout }) {
  const ownerOperator = posCanManageSubscription(user);
  const profile = {
    id: user?.restaurantId,
    slug: restaurantSlug || user?.restaurantSlug || "",
    name: user?.restaurantName || readable(restaurantSlug || "Restaurant"),
    businessName: user?.restaurantName || readable(restaurantSlug || "Restaurant")
  };
  return (
    <div className="pos-kiosk-shell">
      <header className="pos-kiosk-topbar">
        <LooharPlatformBrand size="compact" href="/" />
        <div className="pos-kiosk-topbar-actions">
          <StatusPill tone={apiOnline ? "good" : apiMode === "CHECKING" ? "neutral" : "warn"}>{apiOnline ? "Live POS" : apiMode === "CHECKING" ? "Checking API" : "Offline"}</StatusPill>
          {ownerOperator ? <a className="button-muted" href={restaurantPagePath(profile.slug, "pos")}><CreditCard size={16} />Owner POS</a> : null}
          <button className="button-muted" type="button" onClick={onLogout}><LogOut size={16} />Logout</button>
        </div>
      </header>
      <main className="pos-kiosk-main">
        <RestaurantPosWorkspace apiOnline={apiOnline} token={token} user={user} restaurantId={user?.restaurantId} restaurantSlug={profile.slug} profile={profile} kioskOnly />
      </main>
    </div>
  );
}

function RestaurantPosWorkspace({ apiOnline, token, user, restaurantId, restaurantSlug, profile = {}, onRefresh, kioskOnly = false }) {
  const restaurantKey = restaurantSlug || profile.slug || user?.restaurantSlug || restaurantId;
  const posBasePath = restaurantKey ? `/api/restaurants/${restaurantKey}/pos` : "";
  const deviceStorageKey = restaurantKey ? `loohar-pos-device-id:${restaurantKey}` : "loohar-pos-device-id";
  const subscriptionHref = restaurantKey ? `/restaurant/${restaurantKey}/settings/subscription` : "/restaurant/settings/subscription";
  const ownerOperator = posCanManageSubscription(user);
  const [fingerprint, setFingerprint] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [config, setConfig] = useState(null);
  const [posMenuState, setPosMenuState] = useState(() => emptyPosMenuState());
  const [heldOrders, setHeldOrders] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [cart, setCart] = useState([]);
  const [quote, setQuote] = useState(null);
  const [lastOrder, setLastOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deviceForm, setDeviceForm] = useState({ name: "Front counter POS", deviceType: "POS_KIOSK", cardPaymentsEnabled: false });
  const [openingCashCents, setOpeningCashCents] = useState(10000);
  const [kioskPin, setKioskPin] = useState("");
  const [exitPin, setExitPin] = useState("");
  const [customer, setCustomer] = useState({ name: "Walk-in guest", phone: "", email: "" });
  const [orderType, setOrderType] = useState("WALK_IN");
  const [tipCents, setTipCents] = useState(0);
  const [customTip, setCustomTip] = useState("");
  const [notes, setNotes] = useState("");
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [showKioskExit, setShowKioskExit] = useState(false);
  const [customizingItem, setCustomizingItem] = useState(null);
  const [modifierSelections, setModifierSelections] = useState({});
  const [modifierInstructions, setModifierInstructions] = useState("");
  const [modifierError, setModifierError] = useState("");
  const inflightLoadRef = useRef(null);
  const posMenuSequenceRef = useRef(0);
  const acceptedPosMenuSequenceRef = useRef(0);
  const loadedOnceRef = useRef(false);

  useEffect(() => {
    setFingerprint(posDeviceFingerprint());
    if (typeof window !== "undefined") {
      setDeviceId(window.localStorage.getItem(deviceStorageKey) || "");
    }
  }, [deviceStorageKey]);

  const deviceHeaders = useMemo(() => ({
    ...(deviceId ? { "x-loohar-device-id": deviceId } : {}),
    ...(fingerprint ? { "x-loohar-device-fingerprint": fingerprint } : {})
  }), [deviceId, fingerprint]);

  async function posApi(path, options = {}) {
    if (!posBasePath) throw new Error("Restaurant POS route is not available yet.");
    return api(`${posBasePath}${path}`, {
      ...options,
      token,
      headers: {
        ...deviceHeaders,
        ...(options.headers || {})
      }
    });
  }

  async function loadPos(options = {}) {
    if (!apiOnline || !token || !posBasePath) return;
    if (inflightLoadRef.current) return inflightLoadRef.current;
    posPerformanceMark("pos-route-start");
    const requestSequence = posMenuSequenceRef.current + 1;
    posMenuSequenceRef.current = requestSequence;
    const requestId = `${restaurantKey || "restaurant"}:${requestSequence}:${Date.now()}`;
    const hadSuccessfulMenu = posMenuState.lastSuccessfulCategories.length > 0 || posMenuState.status === POS_MENU_STATUS.SUCCESS || posMenuState.status === POS_MENU_STATUS.EMPTY;
    setPosMenuState((current) => ({
      ...current,
      status: hadSuccessfulMenu ? POS_MENU_STATUS.REFRESHING : POS_MENU_STATUS.INITIAL_LOADING,
      requestId,
      requestSequence,
      refreshError: null,
      error: null
    }));
    if (!options.silent) setLoading(true);
    setError("");
    inflightLoadRef.current = (async () => {
      try {
        let configPayload;
        let menuPayload;
        let heldPayload;
        try {
          const bootstrapPayload = await posApi("/bootstrap", { headers: { "x-loohar-pos-request-id": requestId } });
          configPayload = bootstrapPayload.config;
          menuPayload = bootstrapPayload.menu;
          heldPayload = { heldOrders: bootstrapPayload.heldOrders || [] };
        } catch (bootstrapError) {
          const status = Number(bootstrapError?.status || bootstrapError?.payload?.status || 0);
          if (![404, 405].includes(status)) throw bootstrapError;
          [configPayload, menuPayload, heldPayload] = await Promise.all([
            posApi("/config"),
            posApi("/menu", { headers: { "x-loohar-pos-request-id": requestId } }),
            posApi("/held-orders")
          ]);
        }
        posPerformanceMark("pos-config-ready");
        posPerformanceMark("pos-menu-ready");
        if (requestSequence < acceptedPosMenuSequenceRef.current) {
          debugPosMenu("stale-response-rejected", { requestSequence, acceptedSequence: acceptedPosMenuSequenceRef.current });
          return;
        }
        const normalizedMenu = normalizePosMenuPayload(menuPayload);
        const expectedRestaurantId = configPayload?.restaurant?.id || restaurantId || user?.restaurantId || "";
        if (normalizedMenu.tenantId && expectedRestaurantId && normalizedMenu.tenantId !== expectedRestaurantId) {
          const staleError = new Error("Stale POS menu response was rejected.");
          staleError.code = "POS_MENU_TENANT_MISMATCH";
          throw staleError;
        }
        acceptedPosMenuSequenceRef.current = requestSequence;
        setConfig(configPayload);
        setHeldOrders(heldPayload.heldOrders || []);
        setPosMenuState((current) => {
          const nextStatus = normalizedMenu.itemCount > 0 ? POS_MENU_STATUS.SUCCESS : POS_MENU_STATUS.EMPTY;
          return {
            ...current,
            status: nextStatus,
            categories: normalizedMenu.categories,
            lastSuccessfulCategories: normalizedMenu.categories,
            itemCount: normalizedMenu.itemCount,
            lastSuccessfulItemCount: normalizedMenu.itemCount,
            menuVersion: normalizedMenu.menuVersion,
            tenantId: normalizedMenu.tenantId,
            locationId: normalizedMenu.locationId,
            availabilitySummary: normalizedMenu.availabilitySummary,
            menuDiagnostics: normalizedMenu.menuDiagnostics,
            acceptedSequence: requestSequence,
            requestId,
            loadedAt: normalizedMenu.generatedAt,
            error: null,
            refreshError: null
          };
        });
        debugPosMenu("response-accepted", { requestSequence, requestId, itemCount: normalizedMenu.itemCount, menuVersion: normalizedMenu.menuVersion });
        if (configPayload.device?.id) {
          setDeviceId((current) => current === configPayload.device.id ? current : configPayload.device.id);
          if (typeof window !== "undefined") window.localStorage.setItem(deviceStorageKey, configPayload.device.id);
        }
        loadedOnceRef.current = true;
        posPerformanceMark("pos-interactive");
        posPerformanceMeasure("pos-auth-duration", "pos-route-start", "pos-config-ready");
        posPerformanceMeasure("pos-config-duration", "pos-route-start", "pos-config-ready");
        posPerformanceMeasure("pos-menu-duration", "pos-route-start", "pos-menu-ready");
        posPerformanceMeasure(kioskOnly ? "kiosk-interactive-duration" : "pos-interactive-duration", "pos-route-start", "pos-interactive");
      } catch (posError) {
        const entitlementDenied = isPosEntitlementDenied(posError);
        setPosMenuState((current) => {
          const canKeepLastMenu = current.lastSuccessfulCategories.length > 0 && !entitlementDenied;
          return {
            ...current,
            status: entitlementDenied ? POS_MENU_STATUS.ENTITLEMENT_DENIED : canKeepLastMenu ? POS_MENU_STATUS.STALE : POS_MENU_STATUS.ERROR,
            categories: canKeepLastMenu ? current.lastSuccessfulCategories : current.categories,
            itemCount: canKeepLastMenu ? current.lastSuccessfulItemCount : current.itemCount,
            error: posError,
            refreshError: canKeepLastMenu ? posError : null,
            requestId,
            requestSequence
          };
        });
        debugPosMenu("response-error", { requestSequence, requestId, code: posMenuErrorCode(posError), message: posError?.message });
        setError(posError);
      } finally {
        setLoading(false);
        inflightLoadRef.current = null;
      }
    })();
    return inflightLoadRef.current;
  }

  useEffect(() => {
    if (!fingerprint) return;
    loadPos({ silent: loadedOnceRef.current });
  }, [apiOnline, token, posBasePath, fingerprint]);

  const categoriesForRegister = useMemo(() => (
    posMenuState.categories.length ? posMenuState.categories : posMenuState.lastSuccessfulCategories
  ), [posMenuState.categories, posMenuState.lastSuccessfulCategories]);
  const itemsForRegister = useMemo(() => categoriesForRegister.flatMap((category) => (
    category.items || []
  ).map((item) => ({ ...item, categoryName: category.name, categoryId: category.id }))), [categoriesForRegister]);
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleItems = itemsForRegister.filter((item) => {
    const matchesCategory = selectedCategory === "all" || itemCategoryId(item) === selectedCategory;
    if (!matchesCategory) return false;
    if (!normalizedSearch) return true;
    return [item.name, itemCategoryName(item), item.sku, item.searchAliases].filter(Boolean).join(" ").toLowerCase().includes(normalizedSearch);
  });
  useEffect(() => {
    if (selectedCategory === "all") return;
    if (!categoriesForRegister.some((category) => category.id === selectedCategory)) {
      setSelectedCategory("all");
    }
  }, [categoriesForRegister, selectedCategory]);
  const activeDevice = config?.device;
  const activeShift = config?.shift;
  const firstCashDrawer = config?.cashDrawers?.[0];
  const currentCashDrawer = config?.cashDrawers?.find((drawer) => drawer.id === activeShift?.cashDrawerId) || firstCashDrawer;
  const canAcceptCash = Boolean(activeDevice?.status === "ACTIVE" && activeDevice.deviceType === "MAIN_TERMINAL" && activeShift?.status === "OPEN" && currentCashDrawer?.status === "OPEN" && (config?.permissions || []).includes("POS_ACCEPT_CASH"));
  const canAcceptCard = Boolean(activeDevice?.status === "ACTIVE" && activeDevice.cardPaymentsEnabled && (config?.permissions || []).includes("POS_ACCEPT_CARD"));
  const cartTotalCents = cart.reduce((sum, line) => sum + (line.priceCents || 0) * line.quantity, 0);
  const cartItemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const cashDisabledReason = !activeDevice
    ? "Register this device before accepting payments."
    : activeDevice.deviceType !== "MAIN_TERMINAL"
      ? "Cash is allowed only on a main terminal."
      : !activeShift
        ? "Open a shift before accepting cash."
        : currentCashDrawer?.status !== "OPEN"
      ? "Open cash drawer required."
      : "";
  const posMenuItemCount = posMenuState.itemCount || countPosMenuItems(categoriesForRegister);
  const posMenuTone = [POS_MENU_STATUS.SUCCESS, POS_MENU_STATUS.EMPTY].includes(posMenuState.status)
    ? "good"
    : posMenuState.status === POS_MENU_STATUS.STALE
      ? "warn"
      : posMenuState.status === POS_MENU_STATUS.ENTITLEMENT_DENIED || posMenuState.status === POS_MENU_STATUS.ERROR
        ? "bad"
        : "neutral";
  const posMenuLabel = posMenuState.status === POS_MENU_STATUS.REFRESHING
    ? `Refreshing ${posMenuItemCount} items`
    : posMenuState.status === POS_MENU_STATUS.STALE
      ? `Stale ${posMenuItemCount} items`
      : posMenuState.status === POS_MENU_STATUS.EMPTY
        ? "Empty"
        : posMenuItemCount ? `${posMenuItemCount} items` : readable(posMenuState.status || "loading");
  const statusChips = [
    { icon: CreditCard, label: "Device", value: activeDevice ? readable(activeDevice.deviceType) : "Unregistered", tone: activeDevice?.status === "ACTIVE" ? "good" : "warn" },
    { icon: Clock, label: "Shift", value: activeShift?.status || "Closed", tone: activeShift?.status === "OPEN" ? "good" : "neutral" },
    { icon: Store, label: "Menu", value: posMenuLabel, tone: posMenuTone },
    { icon: ReceiptText, label: "Cart", value: `${cartItemCount} item${cartItemCount === 1 ? "" : "s"} / ${money(quote?.totalCents ?? cartTotalCents)}`, tone: cartItemCount ? "good" : "neutral" },
    { icon: Shield, label: "Kiosk", value: activeDevice?.kioskModeEnabled || kioskOnly ? "Locked" : "Off", tone: activeDevice?.kioskModeEnabled || kioskOnly ? "good" : "neutral" }
  ];
  const kioskLocked = Boolean(activeDevice?.kioskModeEnabled || kioskOnly);
  const canOpenKiosk = Boolean(activeDevice?.status === "ACTIVE" && activeDevice.kioskModeEnabled);
  const hiddenPosMenuItems = Number(posMenuState.menuDiagnostics?.totalItems || 0);
  const hasHiddenPosMenuItems = !normalizedSearch && posMenuState.status !== POS_MENU_STATUS.ERROR && hiddenPosMenuItems > 0 && posMenuItemCount === 0;
  const posEmptyTitle = normalizedSearch
    ? "No matching POS items"
    : posMenuState.status === POS_MENU_STATUS.ERROR
      ? "POS menu unavailable"
      : hasHiddenPosMenuItems
        ? hiddenPosMenuItems === 1 ? "Menu item exists but is not published to POS." : "Menu items exist but are not published to POS."
        : "No POS menu items";
  const posEmptyDetail = posMenuState.status === POS_MENU_STATUS.ERROR
    ? "The register could not load a live menu. Retry the POS refresh before taking orders."
    : hasHiddenPosMenuItems
      ? "Make the item available and keep its category active, then refresh the register."
      : ownerOperator ? "Add available menu items in Menu & Catalog, then refresh the register." : "POS menu items are not available. Contact your manager.";

  function addToCart(item) {
    if (normalizePosModifierGroups(item).length) {
      openModifierDialog(item);
      return;
    }
    addConfiguredItemToCart(item);
  }

  function openModifierDialog(item) {
    const defaults = Object.fromEntries(normalizePosModifierGroups(item).map((group) => [
      group.id,
      group.options.filter((option) => option.isDefault).slice(0, Math.max(1, Number(group.maxSelect || 1))).map((option) => option.id)
    ]));
    setCustomizingItem(item);
    setModifierSelections(defaults);
    setModifierInstructions("");
    setModifierError("");
  }

  function closeModifierDialog() {
    setCustomizingItem(null);
    setModifierSelections({});
    setModifierInstructions("");
    setModifierError("");
  }

  function toggleModifierSelection(group, option) {
    setModifierError("");
    setModifierSelections((current) => {
      const currentIds = current[group.id] || [];
      const selected = currentIds.includes(option.id);
      const maximum = Math.max(1, Number(group.maxSelect || 1));
      if (maximum === 1) {
        return { ...current, [group.id]: selected ? [] : [option.id] };
      }
      const nextIds = selected ? currentIds.filter((id) => id !== option.id) : [...currentIds, option.id].slice(0, maximum);
      return { ...current, [group.id]: nextIds };
    });
  }

  function addConfiguredItemToCart(item = customizingItem, options = {}) {
    if (!item?.id) return;
    const selections = options.selections || modifierSelections;
    const specialInstructions = options.specialInstructions ?? modifierInstructions;
    const validationErrors = posModifierValidationErrors(item, selections);
    if (validationErrors.length) {
      setModifierError(validationErrors[0]);
      return;
    }
    const modifiers = selectedPosModifierRows(item, selections);
    const optionIds = posModifierOptionIds(selections);
    const modifierPriceCents = modifiers.reduce((sum, option) => sum + Number(option.priceCents || 0), 0);
    const unitPriceCents = Number(item.priceCents || 0) + modifierPriceCents;
    const signature = posModifierSignature(optionIds, specialInstructions);
    setQuote(null);
    setLastOrder(null);
    setMobileCartOpen(true);
    setCart((current) => {
      const existing = current.find((line) => line.menuItemId === item.id && line.modifierSignature === signature);
      if (existing) {
        return current.map((line) => line.cartLineId === existing.cartLineId ? { ...line, quantity: line.quantity + 1 } : line);
      }
      return [...current, {
        cartLineId: posCartLineId(),
        menuItemId: item.id,
        name: item.name,
        basePriceCents: item.priceCents || 0,
        priceCents: unitPriceCents,
        quantity: 1,
        optionIds,
        modifierOptionIds: optionIds,
        modifiers,
        modifierSignature: signature,
        specialInstructions
      }];
    });
    closeModifierDialog();
  }

  function setQuantity(cartLineId, quantity) {
    updateCartLine(cartLineId, { quantity: Math.max(1, Number(quantity) || 1) });
  }

  function adjustQuantity(cartLineId, delta) {
    setQuote(null);
    setCart((current) => current
      .map((line) => line.cartLineId === cartLineId ? { ...line, quantity: Math.max(1, line.quantity + delta) } : line)
      .filter((line) => line.quantity > 0));
  }

  function setTipPreset(mode) {
    setQuote(null);
    if (mode === "none") {
      setTipCents(0);
      setCustomTip("");
      return;
    }
    if (mode === "custom") return;
    const percent = Number(mode);
    setTipCents(Math.round(cartTotalCents * (percent / 100)));
    setCustomTip("");
  }

  function updateCartLine(cartLineId, changes) {
    setQuote(null);
    setCart((current) => current
      .map((line) => line.cartLineId === cartLineId ? { ...line, ...changes, quantity: Math.max(1, Number(changes.quantity ?? line.quantity) || 1) } : line)
      .filter((line) => line.quantity > 0));
  }

  function removeCartLine(cartLineId) {
    setQuote(null);
    setCart((current) => current.filter((line) => line.cartLineId !== cartLineId));
  }

  async function registerDevice(event) {
    event.preventDefault();
    setSaving("device");
    setError("");
    setNotice("");
    try {
      const payload = await posApi("/devices", {
        method: "POST",
        body: {
          ...deviceForm,
          fingerprint,
          cashDrawerId: deviceForm.deviceType === "MAIN_TERMINAL" ? firstCashDrawer?.id || null : null,
          status: "ACTIVE"
        }
      });
      setDeviceId(payload.device.id);
      if (typeof window !== "undefined") window.localStorage.setItem(deviceStorageKey, payload.device.id);
      setNotice("POS device registered for this restaurant.");
      await loadPos();
    } catch (posError) {
      setError(posError);
    } finally {
      setSaving("");
    }
  }

  async function openRegisterShift() {
    setSaving("shift");
    setError("");
    setNotice("");
    try {
      await posApi("/shifts/clock-in", {
        method: "POST",
        body: {
          cashDrawerId: activeDevice?.deviceType === "MAIN_TERMINAL" ? firstCashDrawer?.id || null : null,
          openingCashCents
        }
      });
      setNotice("POS shift opened.");
      await loadPos();
    } catch (posError) {
      setError(posError);
    } finally {
      setSaving("");
    }
  }

  async function closeRegisterShift() {
    if (!activeShift?.id) return;
    setSaving("shift-close");
    setError("");
    setNotice("");
    try {
      await posApi(`/shifts/${activeShift.id}/clock-out`, {
        method: "POST",
        body: { closingCashCents: currentCashDrawer?.currentBalanceCents || openingCashCents }
      });
      setNotice("POS shift closed.");
      await loadPos();
    } catch (posError) {
      setError(posError);
    } finally {
      setSaving("");
    }
  }

  async function calculateQuote() {
    if (!cart.length) {
      setError("Add at least one menu item before calculating a quote.");
      return null;
    }
    setSaving("quote");
    setError("");
    setNotice("");
    try {
      const payload = await posApi("/quotes", {
        method: "POST",
        body: {
          orderType,
          tipCents,
          lineItems: cart.map((line) => ({
            menuItemId: line.menuItemId,
            quantity: line.quantity,
            optionIds: line.optionIds || [],
            modifierOptionIds: line.modifierOptionIds || line.optionIds || [],
            specialInstructions: line.specialInstructions || ""
          }))
        }
      });
      setQuote(payload.quote);
      setNotice("Server quote recalculated.");
      return payload.quote;
    } catch (posError) {
      setError(posError);
      return null;
    } finally {
      setSaving("");
    }
  }

  async function holdOrder() {
    if (!cart.length) return setError("Add items before holding this order.");
    setSaving("hold");
    setError("");
    setNotice("");
    try {
      await posApi("/held-orders", {
        method: "POST",
        body: {
          name: customer.name || "Held POS order",
          orderType,
          customer,
          cart: {
            lineItems: cart.map((line) => ({
              menuItemId: line.menuItemId,
              quantity: line.quantity,
              optionIds: line.optionIds || [],
              modifierOptionIds: line.modifierOptionIds || line.optionIds || [],
              modifiers: line.modifiers || [],
              specialInstructions: line.specialInstructions || ""
            }))
          }
        }
      });
      setCart([]);
      setQuote(null);
      setNotice("Order held for later.");
      await loadPos();
    } catch (posError) {
      setError(posError);
    } finally {
      setSaving("");
    }
  }

  async function submitOrder() {
    setSaving("submit");
    setError("");
    setNotice("");
    try {
      const activeQuote = quote || await calculateQuote();
      if (!activeQuote) return;
      const payload = await posApi("/orders", {
        method: "POST",
        body: {
          quoteId: activeQuote.id,
          customer,
          notes
        }
      });
      setLastOrder(payload.order);
      setCart([]);
      setQuote(null);
      setNotice("Order sent to the kitchen queue.");
      await onRefresh?.();
    } catch (posError) {
      setError(posError);
    } finally {
      setSaving("");
    }
  }

  async function acceptCashPayment() {
    if (!lastOrder?.id) return setError("Submit an order before accepting payment.");
    setSaving("cash");
    setError("");
    setNotice("");
    try {
      await posApi("/payments/cash", {
        method: "POST",
        body: {
          orderId: lastOrder.id,
          amountCents: lastOrder.totalCents
        }
      });
      setNotice("Cash payment accepted and receipt recorded.");
      await loadPos();
    } catch (posError) {
      setError(posError);
    } finally {
      setSaving("");
    }
  }

  async function requestCardPayment() {
    if (!lastOrder?.id) return setError("Submit an order before requesting card payment.");
    setSaving("card");
    setError("");
    setNotice("");
    try {
      const payload = await posApi("/payments/card", {
        method: "POST",
        body: { orderId: lastOrder.id }
      });
      setNotice(payload.message || "Hosted card payment request created.");
    } catch (posError) {
      setError(posError);
    } finally {
      setSaving("");
    }
  }

  async function setKiosk(enabled) {
    if (!activeDevice?.id) return setError("Register this device before enabling kiosk mode.");
    setSaving(enabled ? "kiosk" : "kiosk-exit");
    setError("");
    setNotice("");
    try {
      const path = enabled ? `/devices/${activeDevice.id}/kiosk` : `/devices/${activeDevice.id}/kiosk/exit`;
      await posApi(path, {
        method: "POST",
        body: enabled ? { enabled: true, exitPin: kioskPin || undefined } : { pin: exitPin || undefined }
      });
      setKioskPin("");
      setExitPin("");
      setNotice(enabled ? "Kiosk mode enabled for this device." : "Kiosk mode exited.");
      if (!enabled) setShowKioskExit(false);
      await loadPos();
    } catch (posError) {
      setError(posError);
    } finally {
      setSaving("");
    }
  }

  function recallHeldOrder(session) {
    const lines = session.cartJson?.lineItems || [];
    const itemById = new Map(itemsForRegister.map((item) => [item.id, item]));
    setOrderType(session.orderType || "WALK_IN");
    setCustomer({ name: session.customerJson?.name || "Walk-in guest", phone: session.customerJson?.phone || "", email: session.customerJson?.email || "" });
    setCart(lines.map((line) => {
      const item = itemById.get(line.menuItemId) || {};
      const optionIds = line.modifierOptionIds || line.optionIds || [];
      const selections = posSelectionsFromOptionIds(item, optionIds);
      const modifiers = line.modifiers || selectedPosModifierRows(item, selections);
      const modifierPriceCents = modifiers.reduce((sum, option) => sum + Number(option.priceCents || 0), 0);
      return {
        cartLineId: posCartLineId(),
        menuItemId: line.menuItemId,
        name: item.name || line.name || "Menu item",
        basePriceCents: item.priceCents || line.basePriceCents || line.unitPriceCents || 0,
        priceCents: line.priceCents || line.unitPriceCents || (Number(item.priceCents || 0) + modifierPriceCents),
        quantity: Number(line.quantity) || 1,
        optionIds,
        modifierOptionIds: optionIds,
        modifiers,
        modifierSignature: posModifierSignature(optionIds, line.specialInstructions || ""),
        specialInstructions: line.specialInstructions || ""
      };
    }));
    setQuote(null);
    setNotice("Held order loaded into the register.");
  }

  if (!apiOnline) {
    return (
      <div className="pos-register">
        <div className="pos-alert">Live API is required for POS register, payments, cash controls, and kiosk mode.</div>
      </div>
    );
  }

  return (
    <div className={`pos-register ${kioskLocked ? "kiosk-active" : ""}`}>
      <div className="pos-command-bar">
        <div>
          <p className="restaurant-shell-breadcrumb">{kioskOnly ? "Secure Kiosk" : "Restaurant POS"}</p>
          <h2>{kioskOnly ? "Counter register" : profile.businessName || profile.name || "POS register"}</h2>
          <p>{activeShift?.status === "OPEN" ? `Shift opened ${new Date(activeShift.openedAt).toLocaleTimeString()}` : "Register device, shift, menu, and checkout in one flow."}</p>
        </div>
        <div className="pos-command-actions">
          {kioskLocked ? <button className="button-muted" type="button" onClick={() => setShowKioskExit(true)}><Shield size={18} />Manager exit</button> : null}
          {!kioskOnly && ownerOperator && canOpenKiosk ? <a className="button-muted" href={restaurantKey ? `/restaurant/${restaurantKey}/kiosk` : "/restaurant/kiosk"}><Shield size={18} />Open Kiosk</a> : null}
          {!kioskOnly ? <button className="button-muted" type="button" onClick={() => loadPos()} disabled={loading}><RefreshCw size={18} />Refresh</button> : null}
        </div>
      </div>

      <PosNotice error={error} user={user} onRetry={() => loadPos()} subscriptionHref={subscriptionHref} />
      {notice ? <div className="success-box">{notice}</div> : null}
      {posMenuState.status === POS_MENU_STATUS.STALE ? (
        <div className="pos-menu-state stale" role="status">
          Showing the last synced POS menu. Refresh failed, but the current order and menu remain available.
        </div>
      ) : null}
      {posMenuState.status === POS_MENU_STATUS.REFRESHING ? (
        <div className="pos-menu-state refreshing" role="status">
          Refreshing menu in the background...
        </div>
      ) : null}
      {posMenuState.status === POS_MENU_STATUS.ENTITLEMENT_DENIED ? (
        <div className="pos-menu-state denied" role="alert">
          POS menu access is restricted by the current subscription or tenant status.
        </div>
      ) : null}

      {loading && !loadedOnceRef.current ? <div className="pos-loading-panel">Loading POS register...</div> : null}

      <div className="pos-status-strip" aria-label="POS register status">
        {statusChips.map(({ icon: Icon, label, value, tone }) => (
          <div className={`pos-status-chip ${tone}`} key={label}>
            <Icon size={17} aria-hidden="true" />
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <div className="pos-layout">
        <section className="pos-catalog panel">
          <div className="pos-menu-toolbar">
            <h3 className="panel-title">Menu</h3>
            <label className="pos-menu-search">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search POS menu items</span>
              <input value={searchQuery} placeholder="Search items..." onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setSearchQuery(""); }} />
              {searchQuery ? <button type="button" onClick={() => setSearchQuery("")} aria-label="Clear search"><X size={16} /></button> : null}
            </label>
            <select className="select pos-category-select" aria-label="Filter by menu category" value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
              <option value="all">All categories</option>
              {categoriesForRegister.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>
          <div className="pos-category-pills" aria-label="POS menu categories">
            <button className={`pos-category-pill ${selectedCategory === "all" ? "active" : ""}`} type="button" aria-pressed={selectedCategory === "all"} onClick={() => setSelectedCategory("all")}>All</button>
            {categoriesForRegister.map((category) => (
              <button className={`pos-category-pill ${selectedCategory === category.id ? "active" : ""}`} type="button" aria-pressed={selectedCategory === category.id} key={category.id} onClick={() => setSelectedCategory(category.id)}>
                {category.name}
              </button>
            ))}
          </div>
          {visibleItems.length === 0 ? (
            <EmptyState
              title={posEmptyTitle}
              detail={posEmptyDetail}
            />
          ) : (
            <div className="pos-item-grid">
              {visibleItems.map((item) => (
                <button className="pos-menu-item" type="button" key={item.id} onClick={() => addToCart(item)}>
                  {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" onError={handleSafeImageError} /> : <span className="pos-menu-item-fallback"><Store size={20} /></span>}
                  <span>
                    <strong>{item.name}</strong>
                    <small>{itemCategoryName(item)}</small>
                  </span>
                  <b>{money(item.priceCents)}</b>
                  {normalizePosModifierGroups(item).length ? <em className="customizable">Customizable</em> : null}
                  {item.featured || item.recommended ? <em>Popular</em> : null}
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className={`pos-cart panel ${mobileCartOpen ? "open" : ""}`}>
          <div className="pos-section-head">
            <div>
              <h3 className="panel-title">Current order</h3>
              <p>{cartItemCount ? `${cartItemCount} item${cartItemCount === 1 ? "" : "s"} in progress` : "Tap menu items to start."}</p>
            </div>
            <div className="pos-cart-head-actions">
              <button className="button-muted pos-mobile-close" type="button" onClick={() => setMobileCartOpen(false)}>Close</button>
              <button className="button-muted" type="button" onClick={() => { setCart([]); setQuote(null); setLastOrder(null); }} disabled={!cart.length}><Trash2 size={16} />Clear</button>
            </div>
          </div>
          <div className="pos-cart-body">
          <div className="pos-form-grid">
            <label>Order type
              <select className="select mt-1" value={orderType} onChange={(event) => { setOrderType(event.target.value); setQuote(null); }}>
                {posOrderTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <div className="pos-tip-panel">
              <span>Tip</span>
              <div className="pos-tip-buttons">
                {["none", "10", "15", "20"].map((mode) => <button className="seg" type="button" key={mode} onClick={() => setTipPreset(mode)}>{mode === "none" ? "No tip" : `${mode}%`}</button>)}
                <button className="seg" type="button" onClick={() => setTipPreset("custom")}>Custom</button>
              </div>
              <input className="input mt-2" inputMode="decimal" placeholder="$0.00" value={customTip} onChange={(event) => { setCustomTip(event.target.value); setTipCents(centsFromDollarInput(event.target.value)); setQuote(null); }} aria-label="Custom tip amount" />
            </div>
          </div>
          <div className="pos-form-grid mt-3">
            <label>Guest name
              <input className="input mt-1" value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.target.value })} />
            </label>
            <label>Phone
              <input className="input mt-1" value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} />
            </label>
          </div>
          <label className="mt-3 block text-sm font-semibold text-slate-600">Order notes
            <textarea className="input mt-1 min-h-20 py-2" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>

          <div className="pos-cart-lines">
            {cart.length === 0 ? <EmptyState title="Cart is empty" detail="Select menu items to start a walk-in, dine-in, pickup, or delivery order." /> : cart.map((line) => (
              <div className="pos-cart-line" key={line.cartLineId}>
                <div>
                  <strong>{line.name}</strong>
                  <small>{money(line.priceCents)} each / {money((line.priceCents || 0) * line.quantity)}</small>
                  {line.modifiers?.length ? (
                    <ul className="pos-cart-modifiers" aria-label={`${line.name} modifiers`}>
                      {line.modifiers.map((modifier) => (
                        <li key={modifier.optionId || modifier.id}>
                          {modifier.groupName ? `${modifier.groupName}: ` : ""}{modifier.name}
                          {modifier.priceCents ? ` +${money(modifier.priceCents)}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {line.specialInstructions ? <small className="pos-cart-instructions">Note: {line.specialInstructions}</small> : null}
                </div>
                <div className="pos-qty-stepper">
                  <button type="button" onClick={() => adjustQuantity(line.cartLineId, -1)} aria-label={`Decrease ${line.name}`}><Minus size={14} /></button>
                  <input className="input" type="number" min="1" value={line.quantity} onChange={(event) => setQuantity(line.cartLineId, event.target.value)} aria-label={`Quantity for ${line.name}`} />
                  <button type="button" onClick={() => adjustQuantity(line.cartLineId, 1)} aria-label={`Increase ${line.name}`}><Plus size={14} /></button>
                </div>
                <button className="icon-button" type="button" onClick={() => removeCartLine(line.cartLineId)} aria-label={`Remove ${line.name}`}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>

          </div>
          <div className="pos-cart-footer">
          <div className="pos-total-box">
            <span>Server quote</span>
            <strong>{money(quote?.totalCents ?? cartTotalCents)}</strong>
            {quote ? <small>Tax {money(quote.taxCents)} · expires {new Date(quote.expiresAt).toLocaleTimeString()}</small> : <small>Recalculate before sending to kitchen.</small>}
            {quote ? <small className="pos-fee-disclosure">{paymentFeeDisclosureText(quote)}</small> : null}
          </div>

          <div className="pos-action-grid">
            <button className="button-muted justify-center" type="button" onClick={calculateQuote} disabled={saving === "quote" || !cart.length}><ReceiptText size={16} />Quote</button>
            <button className="button-muted justify-center" type="button" onClick={holdOrder} disabled={saving === "hold" || !cart.length}><Clock size={16} />Hold</button>
            <button className="button-primary justify-center" type="button" onClick={submitOrder} disabled={saving === "submit" || !cart.length}><ChefHat size={16} />Send to kitchen</button>
          </div>

          {lastOrder ? (
            <div className="pos-last-order">
              <strong>{lastOrder.orderNumber}</strong>
              <span>{money(lastOrder.totalCents)} · {readable(lastOrder.status || "pending")}</span>
              <div className="pos-action-grid mt-3">
                <button className="button-muted justify-center" type="button" onClick={acceptCashPayment} disabled={!canAcceptCash || saving === "cash"}><ReceiptText size={16} />Cash</button>
                <button className="button-muted justify-center" type="button" onClick={requestCardPayment} disabled={!canAcceptCard || saving === "card"}><CreditCard size={16} />Card</button>
              </div>
              {!canAcceptCash && cashDisabledReason ? <small className="field-error">{cashDisabledReason}</small> : null}
            </div>
          ) : null}
          </div>
        </aside>
      </div>

      {!kioskOnly && ownerOperator ? <div className="pos-admin-grid">
        <section className="panel">
          <h3 className="panel-title" id="pos-device-controls">Device controls</h3>
          <form className="pos-device-form" onSubmit={registerDevice}>
            <label>Device name
              <input className="input mt-1" value={deviceForm.name} onChange={(event) => setDeviceForm({ ...deviceForm, name: event.target.value })} />
            </label>
            <label>Device type
              <select className="select mt-1" value={deviceForm.deviceType} onChange={(event) => setDeviceForm({ ...deviceForm, deviceType: event.target.value })}>
                {posDeviceTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="seg mt-6"><input type="checkbox" checked={deviceForm.cardPaymentsEnabled} onChange={(event) => setDeviceForm({ ...deviceForm, cardPaymentsEnabled: event.target.checked })} />Card payments</label>
            <button className="button-primary mt-6 justify-center" type="submit" disabled={saving === "device"}><Shield size={16} />Register device</button>
          </form>
          <div className="pos-kiosk-controls">
            <label>Kiosk exit PIN
              <input className="input mt-1" type="password" autoComplete="new-password" value={kioskPin} onChange={(event) => setKioskPin(event.target.value)} />
            </label>
            <button className="button-muted justify-center" type="button" onClick={() => setKiosk(true)} disabled={!activeDevice || saving === "kiosk"}><Shield size={16} />Enable kiosk</button>
          </div>
        </section>

        <section className="panel">
          <h3 className="panel-title">Shift and cash drawer</h3>
          <div className="pos-device-form">
            <label>Opening cash cents
              <input className="input mt-1" type="number" min="0" value={openingCashCents} onChange={(event) => setOpeningCashCents(Number(event.target.value) || 0)} />
            </label>
            <div className="pos-mini-card">
              <strong>{currentCashDrawer?.name || "No cash drawer"}</strong>
              <span>{currentCashDrawer ? `${readable(currentCashDrawer.status)} · ${money(currentCashDrawer.currentBalanceCents)}` : "Cash drawer required for cash payments."}</span>
            </div>
            {activeShift ? <button className="button-muted justify-center" type="button" onClick={closeRegisterShift} disabled={saving === "shift-close"}>Close shift</button> : <button className="button-primary justify-center" type="button" onClick={openRegisterShift} disabled={!activeDevice || saving === "shift"}>Open shift</button>}
          </div>
        </section>

        <section className="panel">
          <h3 className="panel-title">Held orders</h3>
          {heldOrders.length === 0 ? <EmptyState title="No held orders" detail="Held POS carts will appear here." /> : (
            <div className="pos-held-list">
              {heldOrders.map((session) => (
                <button className="pos-held-order" type="button" key={session.id} onClick={() => recallHeldOrder(session)}>
                  <strong>{session.name}</strong>
                  <span>{readable(session.orderType)} · {new Date(session.updatedAt).toLocaleTimeString()}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div> : null}

      <button className="pos-mobile-cart-summary" type="button" onClick={() => setMobileCartOpen(true)}>
        <span>{cartItemCount} item{cartItemCount === 1 ? "" : "s"}</span>
        <strong>{money(quote?.totalCents ?? cartTotalCents)}</strong>
        <span>View order</span>
      </button>

      {customizingItem ? (
        <div className="pos-modifier-dialog" role="dialog" aria-modal="true" aria-label={`Customize ${customizingItem.name}`}>
          <div className="pos-modifier-card">
            <div className="pos-modifier-head">
              <div>
                <p className="restaurant-shell-breadcrumb">Customize item</p>
                <h3>{customizingItem.name}</h3>
                <span>{money(customizingItem.priceCents)} base price</span>
              </div>
              <button className="icon-button" type="button" onClick={closeModifierDialog} aria-label="Close modifier selection"><X size={18} /></button>
            </div>
            <div className="pos-modifier-groups">
              {normalizePosModifierGroups(customizingItem).map((group) => {
                const selectedIds = modifierSelections[group.id] || [];
                const maximum = Math.max(1, Number(group.maxSelect || 1));
                const minimum = group.required ? Math.max(1, Number(group.minSelect || 0)) : Number(group.minSelect || 0);
                return (
                  <fieldset className="pos-modifier-group" key={group.id}>
                    <legend>
                      <strong>{group.name}</strong>
                      <span>{minimum ? `Choose at least ${minimum}` : "Optional"}{maximum ? ` · max ${maximum}` : ""}</span>
                    </legend>
                    <div className="pos-modifier-options">
                      {group.options.map((option) => {
                        const selected = selectedIds.includes(option.id);
                        return (
                          <button className={`pos-modifier-option ${selected ? "selected" : ""}`} type="button" key={option.id} onClick={() => toggleModifierSelection(group, option)} aria-pressed={selected}>
                            <span>{option.name}</span>
                            <strong>{option.priceCents ? `+${money(option.priceCents)}` : "Included"}</strong>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
            </div>
            <label className="text-sm font-semibold text-slate-600">Special instructions
              <textarea className="input mt-1 min-h-20 py-2" value={modifierInstructions} onChange={(event) => setModifierInstructions(event.target.value)} placeholder="No onions, sauce on the side..." />
            </label>
            {modifierError ? <div className="field-error">{modifierError}</div> : null}
            <div className="pos-modifier-actions">
              <button className="button-muted justify-center" type="button" onClick={closeModifierDialog}>Cancel</button>
              <button className="button-primary justify-center" type="button" onClick={() => addConfiguredItemToCart()}>Add to order</button>
            </div>
          </div>
        </div>
      ) : null}

      {showKioskExit ? (
        <div className="pos-kiosk-lock" role="dialog" aria-modal="true" aria-labelledby="pos-kiosk-title">
          <div className="pos-kiosk-card">
            <Shield size={42} />
            <h2 id="pos-kiosk-title">Kiosk mode is active</h2>
            <p>This device is locked to POS operations. Manager permission or a valid PIN is required to exit.</p>
            <input className="input" type="password" autoComplete="current-password" placeholder="Manager PIN" value={exitPin} onChange={(event) => setExitPin(event.target.value)} />
            <button className="button-primary justify-center" type="button" onClick={() => setKiosk(false)} disabled={saving === "kiosk-exit"}>Exit kiosk mode</button>
            <button className="button-muted justify-center" type="button" onClick={() => { setShowKioskExit(false); setExitPin(""); }}>Return to register</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RestaurantPosPage({ children }) {
  return <div className="restaurant-owner-page restaurant-owner-page-pos">{children}</div>;
}

function RestaurantOrdersPage({ children }) {
  return <div className="restaurant-owner-page restaurant-owner-page-orders">{children}</div>;
}

function RestaurantKitchenPage({ children }) {
  return <div className="restaurant-owner-page restaurant-owner-page-kitchen">{children}</div>;
}

function RestaurantCustomersPage({ children }) {
  return <div className="restaurant-owner-page restaurant-owner-page-customers">{children}</div>;
}

function RestaurantDriversPage({ children }) {
  return <div className="restaurant-owner-page restaurant-owner-page-drivers">{children}</div>;
}

function RestaurantReportsPage({ children }) {
  return <div className="restaurant-owner-page restaurant-owner-page-reports">{children}</div>;
}

function RestaurantSettingsPage({ children }) {
  return <div className="restaurant-owner-page restaurant-owner-page-settings">{children}</div>;
}

const restaurantPageComponents = {
  dashboard: RestaurantDashboardPage,
  pos: RestaurantPosPage,
  orders: RestaurantOrdersPage,
  kitchen: RestaurantKitchenPage,
  customers: RestaurantCustomersPage,
  drivers: RestaurantDriversPage,
  reports: RestaurantReportsPage,
  settings: RestaurantSettingsPage
};

function receiptDocumentKind(kind = "receipt") {
  const normalized = String(kind || "receipt").toLowerCase();
  if (normalized === "kitchen" || normalized === "kitchen_ticket") return "kitchen";
  if (normalized === "driver" || normalized === "driver_slip") return "driver";
  return "receipt";
}

function receiptKindLabel(kind = "receipt") {
  const normalized = receiptDocumentKind(kind);
  if (normalized === "kitchen") return "Kitchen ticket";
  if (normalized === "driver") return "Driver slip";
  return "Customer receipt";
}

function receiptQrFromPayload(payload, key, fallbackUrl = "") {
  if (!payload) return null;
  const qr = payload.qr || {};
  const qrCodes = payload.qrCodes || {};
  if (key === "customer") {
    const source = qr.customer || qr.publicOrder || {};
    const url = source.url || source.webUrl || qrCodes.customerReorderUrl || fallbackUrl;
    return url ? { ...source, url, label: source.label || "Order directly next time" } : null;
  }
  if (key === "tracking") {
    const source = qr.tracking || {};
    const url = source.url || source.webUrl || qrCodes.orderTrackingUrl || fallbackUrl;
    return url ? { ...source, url, label: source.label || "Track this order" } : null;
  }
  if (key === "driver") {
    const source = qr.driverAppDownload || qr.driver || {};
    const url = source.url || source.webUrl || qrCodes.driverAppDownloadUrl || fallbackUrl;
    return url ? { ...source, url, label: source.label || "Deliver with Loohar" } : null;
  }
  return null;
}

function ReceiptQr({ qr, fallbackUrl = "", description = "" }) {
  const url = qr?.url || qr?.webUrl || fallbackUrl;
  const [qrData, setQrData] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function renderQr() {
      if (!url) {
        setQrData("");
        return;
      }
      try {
        const data = await qrImageData(url);
        if (!cancelled) setQrData(data);
      } catch {
        if (!cancelled) setQrData("");
      }
    }
    renderQr();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url) return null;
  return (
    <div className="receipt-qr-card">
      {qrData ? <img src={qrData} alt={qr?.label || "Receipt QR code"} /> : <div className="receipt-qr-placeholder">QR</div>}
      <strong>{qr?.label || "Scan QR code"}</strong>
      {description ? <small>{description}</small> : null}
      <span>{url}</span>
    </div>
  );
}

function ReceiptPrintDocument({ receipt }) {
  if (!receipt) return null;
  const receiptInfo = receipt.receipt || {};
  const restaurant = receipt.restaurant || {};
  const order = receipt.order || {};
  const customer = receipt.customer || {};
  const payment = receipt.payment || {};
  const layoutFormat = receipt.layout?.format === "58mm" ? "58mm" : "80mm";
  const isKitchen = receipt.type === "KITCHEN_TICKET";
  const isDriver = receipt.type === "DRIVER_SLIP";
  const customerQr = isKitchen ? null : receiptQrFromPayload(receipt, "customer", restaurant.orderUrl);
  const trackingQr = isKitchen ? null : receiptQrFromPayload(receipt, "tracking");
  const driverQr = isKitchen ? null : receiptQrFromPayload(receipt, "driver");
  const createdLabel = order.displayCreatedAt || (order.createdAt ? new Date(order.createdAt).toLocaleString() : "");
  const totalsRows = receipt.text?.totals || [];
  const items = receipt.items || [];

  return (
    <article className={`tenant-receipt receipt-thermal ${layoutFormat === "58mm" ? "receipt-thermal--58mm" : ""}`} style={{ "--receipt-brand": restaurant.brandColor || "#111827", "--receipt-accent": restaurant.accentColor || "#10b981" }}>
      <header className="receipt-center">
        {restaurant.logoUrl ? <img className="receipt-logo" src={resolveImage(restaurant.logoUrl, "", defaultLooharImage)} alt={`${restaurant.name || "Restaurant"} logo`} onError={handleSafeImageError} /> : null}
        <h2>{restaurant.name || "Restaurant"}</h2>
        {restaurant.legalName && restaurant.legalName !== restaurant.name ? <p>{restaurant.legalName}</p> : null}
        {restaurant.address ? <p>{restaurant.address}</p> : null}
        {restaurant.phone || restaurant.email ? <p>{[restaurant.phone, restaurant.email].filter(Boolean).join(" | ")}</p> : null}
      </header>

      <div className="receipt-rule" />
      <section className="receipt-meta">
        <span>{receipt.title || receiptKindLabel(receipt.kind)}</span>
        <strong>{receiptInfo.receiptNumber || receipt.receiptNumber}</strong>
      </section>
      {receiptInfo.isReprint || receipt.isReprint ? <p className="receipt-center receipt-stamp">REPRINT</p> : null}
      <section className="receipt-meta">
        <span>Order</span>
        <strong>#{order.publicOrderNumber || order.orderNumber || order.id}</strong>
      </section>
      <section className="receipt-meta">
        <span>Type</span>
        <strong>{readable(order.type || receipt.kind || "ORDER")}</strong>
      </section>
      {createdLabel ? <section className="receipt-meta"><span>Placed</span><strong>{createdLabel}</strong></section> : null}
      {order.status ? <section className="receipt-meta"><span>Status</span><strong>{readable(order.status)}</strong></section> : null}
      {customer.name && !isKitchen ? <section className="receipt-meta"><span>Customer</span><strong>{customer.name}</strong></section> : null}
      {customer.phone && isDriver ? <section className="receipt-meta"><span>Phone</span><strong>{customer.phone}</strong></section> : null}
      {order.deliveryAddress && isDriver ? <p className="receipt-subtle">Dropoff: {order.deliveryAddress}</p> : null}
      {order.notes ? <p className="receipt-subtle">Notes: {order.notes}</p> : null}

      <div className="receipt-rule" />
      <section aria-label="Receipt items">
        {items.length === 0 ? <p className="receipt-center receipt-subtle">No items</p> : items.map((item) => {
          const modifiers = item.modifiers || item.options || [];
          return (
            <div className="receipt-line" key={item.id || `${item.name}-${item.quantity}`}>
              <div className="receipt-line-name">
                <strong>{item.quantity || 1} x {item.name}</strong>
                {item.specialInstructions ? <span className="receipt-modifier">Note: {item.specialInstructions}</span> : null}
                {modifiers.map((modifier, index) => <span className="receipt-modifier" key={`${item.id || item.name}-modifier-${index}`}>+ {modifier.name}{modifier.priceCents ? ` (${money(modifier.priceCents)})` : ""}</span>)}
              </div>
              {!isKitchen ? <strong className="receipt-line-price">{money(item.totalCents || ((item.quantity || 1) * (item.unitPriceCents || item.priceCents || 0)))}</strong> : null}
            </div>
          );
        })}
      </section>

      {!isKitchen ? (
        <>
          <div className="receipt-rule" />
          <section aria-label="Receipt totals">
            {totalsRows.map(([label, value]) => (
              <div className={`receipt-total-row ${String(label).toLowerCase() === "total" ? "receipt-grand-total" : ""}`} key={`${label}-${value}`}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </section>
          <div className="receipt-rule" />
          <section aria-label="Receipt payment">
            <div className="receipt-meta"><span>Payment</span><strong>{readable(payment.status || "PENDING")}</strong></div>
            {payment.provider ? <div className="receipt-meta"><span>Provider</span><strong>{payment.provider}</strong></div> : null}
            {payment.reference ? <div className="receipt-meta"><span>Reference</span><strong>{payment.reference}</strong></div> : null}
          </section>
        </>
      ) : null}

      <div className="receipt-rule" />
      <section className="receipt-qr-grid" aria-label="Receipt QR codes">
        {customerQr ? <ReceiptQr qr={customerQr} description="Skip marketplaces and order from this restaurant directly." /> : null}
        {trackingQr ? <ReceiptQr qr={trackingQr} description="Track this order from a secure customer link." /> : null}
        {driverQr ? <ReceiptQr qr={driverQr} description="Install the lightweight Loohar driver app." /> : null}
      </section>
      <p className="receipt-powered">{receipt.text?.footer || "Powered by Loohar"}</p>
    </article>
  );
}

function RestaurantReceiptPreviewPage({ apiOnline, token, restaurantId, orderId, onBack }) {
  const initialQuery = new window.URLSearchParams(window.location.search);
  const [selectedFormat, setSelectedFormat] = useState(initialQuery.get("format") === "58mm" ? "58mm" : "80mm");
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const kind = receiptDocumentKind(initialQuery.get("kind") || "receipt");
  const reprintRequested = initialQuery.get("reprint") === "1" || initialQuery.get("reprint") === "true";

  useEffect(() => {
    let cancelled = false;
    async function loadReceiptPreview() {
      if (!apiOnline || !token || !restaurantId || !orderId) {
        setLoading(false);
        setError("Live API is required to preview and print receipts.");
        return;
      }
      setLoading(true);
      setError("");
      try {
        const params = new window.URLSearchParams({ kind, format: selectedFormat, reprint: reprintRequested ? "1" : "0" });
        const payload = await api(`/api/restaurants/${restaurantId}/orders/${encodeURIComponent(orderId)}/receipt?${params.toString()}`, { token });
        if (!cancelled) setReceipt(payload.receipt);
      } catch (receiptError) {
        if (!cancelled) setError(receiptError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadReceiptPreview();
    return () => {
      cancelled = true;
    };
  }, [apiOnline, token, restaurantId, orderId, kind, selectedFormat, reprintRequested]);

  async function requestPrint({ reprint = reprintRequested } = {}) {
    if (!apiOnline || !token) {
      setError("Live API is required to preview and print receipts.");
      return;
    }
    setPrinting(true);
    setError("");
    setMessage("");
    try {
      const path = kind === "kitchen" ? "print-kitchen-ticket" : kind === "driver" ? "print-driver-slip" : "print-customer-receipt";
      const payload = await api(`/api/restaurants/${restaurantId}/orders/${encodeURIComponent(orderId)}/${path}`, {
        method: "POST",
        token,
        body: { kind, format: selectedFormat, reprint }
      });
      setReceipt(payload.receipt);
      setMessage(reprint ? "Reprint authorized." : "Receipt print authorized.");
      window.setTimeout(() => window.print(), 150);
    } catch (printError) {
      setError(printError.message);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="receipt-preview-shell">
      <div className="receipt-toolbar">
        <div>
          <p className="eyebrow">Receipt preview</p>
          <h2 className="panel-title">{receiptKindLabel(kind)}</h2>
          <p className="mt-1 text-sm text-slate-500">Server-generated tenant receipt for order #{receipt?.order?.orderNumber || orderId}.</p>
        </div>
        <div className="receipt-toolbar-actions">
          <button className="button-muted" type="button" onClick={onBack}>Back to Orders</button>
          <button className={`button-muted ${selectedFormat === "58mm" ? "active" : ""}`} type="button" onClick={() => setSelectedFormat("58mm")}>58mm</button>
          <button className={`button-muted ${selectedFormat === "80mm" ? "active" : ""}`} type="button" onClick={() => setSelectedFormat("80mm")}>80mm</button>
          <button className="button-primary" type="button" onClick={() => requestPrint()} disabled={printing || loading}><ReceiptText size={16} />{printing ? "Printing..." : "Print"}</button>
          <button className="button-muted" type="button" onClick={() => requestPrint({ reprint: true })} disabled={printing || loading}><RefreshCw size={16} />Reprint</button>
        </div>
      </div>
      <InlineError message={error} />
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{message}</div> : null}
      {loading ? <AppLoadingState /> : receipt ? <ReceiptPrintDocument receipt={{ ...receipt, layout: { ...(receipt.layout || {}), format: selectedFormat } }} /> : <EmptyState title="Receipt unavailable" detail="The server did not return receipt data for this order." />}
    </div>
  );
}

function DriverAppDownloadPage() {
  return (
    <div className="driver-download-page">
      <div className="driver-download-hero">
        <LooharPlatformBrand size="default" />
        <p className="eyebrow mt-6">Driver app</p>
        <h1>Deliver with Loohar</h1>
        <p>Open the lightweight Loohar Driver PWA to accept assignments, update delivery status, and track tips and earnings.</p>
        <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
          <a className="button-primary justify-center" href="/driver"><Truck size={18} />Open Driver App</a>
          <a className="button-muted justify-center" href="/"><ArrowRight size={18} />Back to Loohar</a>
        </div>
      </div>
      <div className="driver-download-card">
        <h2 className="panel-title">Install from your browser</h2>
        <p className="mt-3 text-sm leading-6 text-slate-500">For now, drivers can install the PWA from Safari or Chrome using Add to Home Screen. Native App Store and Google Play packaging can use this route as the public download destination later.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <StatusPill tone="good">Delivery only</StatusPill>
          <StatusPill tone="neutral">PWA ready</StatusPill>
          <StatusPill tone="neutral">Mobile app ready path</StatusPill>
        </div>
      </div>
    </div>
  );
}

function RestaurantApp({ apiOnline, token, user, initialSlug = "", activePage = "dashboard" }) {
  const [routeRestaurantId, setRouteRestaurantId] = useState("");
  const restaurantId = initialSlug || user?.restaurantSlug || routeRestaurantId || user?.restaurantId || "";
  const initialProfile = useMemo(
    () => restaurantProfilePlaceholder(user, initialSlug),
    [user?.restaurantId, user?.restaurantSlug, user?.restaurantName, user?.tenantName, initialSlug]
  );
  const [profile, setProfile] = useState(initialProfile);
  const [stats, setStats] = useState(() => emptyRestaurantStats());
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerSummary, setCustomerSummary] = useState(() => emptyCustomerSummary());
  const [loyalty, setLoyalty] = useState(() => emptyLoyaltyAnalytics());
  const [promotions, setPromotions] = useState(() => emptyPromotionsAnalytics());
  const [growthAnalytics, setGrowthAnalytics] = useState(() => emptyGrowthAnalytics());
  const [menuInsights, setMenuInsights] = useState(() => emptyMenuInsights());
  const [locations, setLocations] = useState([]);
  const [website, setWebsite] = useState(() => emptyWebsiteSettings());
  const [domain, setDomain] = useState(() => emptyDomainSettings(initialProfile.slug));
  const [gallery, setGallery] = useState([]);
  const [socialLinks, setSocialLinks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [dispatch, setDispatch] = useState(() => emptyDispatchCenter());
  const [deliveryZones, setDeliveryZones] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [printerSettings, setPrinterSettings] = useState(() => emptyPrinterSettings());
  const [notificationSettings, setNotificationSettings] = useState(() => emptyNotificationSettings());
  const [operationsReport, setOperationsReport] = useState(() => emptyOperationsReport());
  const [reportRange, setReportRange] = useState("30d");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerSegmentFilter, setCustomerSegmentFilter] = useState("ALL");
  const [customerTypeFilter, setCustomerTypeFilter] = useState("ALL");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [locationDrafts, setLocationDrafts] = useState({});
  const [savingLocationId, setSavingLocationId] = useState("");
  const [savingCustomerId, setSavingCustomerId] = useState("");
  const [featureLocks, setFeatureLocks] = useState({});
  const [error, setError] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [itemForm, setItemForm] = useState({ categoryId: "", name: "", priceCents: 1295, preparationTimeMins: 15, description: "", calories: "", spiceLevel: "", featured: false, available: true });
  const [newItemImage, setNewItemImage] = useState(null);
  const [itemFileInputKey, setItemFileInputKey] = useState(0);
  const [uploadingAsset, setUploadingAsset] = useState("");
  const [savingAction, setSavingAction] = useState("");
  const [menuValidation, setMenuValidation] = useState({});
  const [modifierDrafts, setModifierDrafts] = useState({});
  const [websiteSaveState, setWebsiteSaveState] = useState("idle");
  const [websiteDirty, setWebsiteDirty] = useState(false);
  const [websiteLastSavedAt, setWebsiteLastSavedAt] = useState(null);
  const [toast, setToast] = useState(null);
  const [galleryForm, setGalleryForm] = useState({ title: "", altText: "", caption: "", category: "food", published: true });
  const [socialForm, setSocialForm] = useState({ platform: "instagram", url: "" });
  const [employeeForm, setEmployeeForm] = useState({ name: "", email: "", phone: "", role: "KITCHEN_STAFF" });
  const [zoneForm, setZoneForm] = useState({ name: "Zone A", radiusMiles: 3, deliveryFeeCents: 399, minimumOrderCents: 1500 });
  const [inventoryForm, setInventoryForm] = useState({ name: "Chicken", quantity: 10, unit: "lb", costCents: 2500 });
  const loadRestaurantInFlightRef = useRef(null);
  const loadRestaurantRequestIdRef = useRef(0);
  const realtimeRefreshTimerRef = useRef(null);
  const publicPreviewPath = publicPathForSlug(profile.slug || user?.restaurantSlug || initialSlug || "restaurant");
  const publicSiteUrl = canonicalTenantUrlFor(profile, domain);

  function showToast(message, tone = "good") {
    setToast({ message, tone, id: Date.now() });
    window.clearTimeout(showToast.timeoutId);
    showToast.timeoutId = window.setTimeout(() => setToast(null), 4200);
  }

  function liveRestaurantRequired(message = "Live API connection and restaurant login are required for restaurant operations.") {
    setError(message);
    showToast(message, "bad");
    return false;
  }

  function resetRestaurantLiveState(nextProfile = initialProfile) {
    setProfile(nextProfile);
    setStats(emptyRestaurantStats());
    setCategories([]);
    setItems([]);
    setOrders([]);
    setDrivers([]);
    setCustomers([]);
    setCustomerSummary(emptyCustomerSummary());
    setLoyalty(emptyLoyaltyAnalytics());
    setPromotions(emptyPromotionsAnalytics());
    setGrowthAnalytics(emptyGrowthAnalytics());
    setMenuInsights(emptyMenuInsights());
    setLocations([]);
    setWebsite(emptyWebsiteSettings());
    setDomain(emptyDomainSettings(nextProfile?.slug || initialSlug || user?.restaurantSlug || ""));
    setGallery([]);
    setSocialLinks([]);
    setEmployees([]);
    setDispatch(emptyDispatchCenter());
    setDeliveryZones([]);
    setInventoryItems([]);
    setPrinterSettings(emptyPrinterSettings());
    setNotificationSettings(emptyNotificationSettings());
    setOperationsReport(emptyOperationsReport());
    setSelectedCustomerId("");
    setSelectedDriverId("");
    setLocationDrafts({});
    setSavingLocationId("");
    setSavingCustomerId("");
    setFeatureLocks({});
    setWebsiteDirty(false);
    setWebsiteSaveState("idle");
    setWebsiteLastSavedAt(null);
  }

  function setWebsiteField(field, value) {
    setWebsite((current) => ({ ...current, [field]: value }));
    setWebsiteDirty(true);
    setWebsiteSaveState("dirty");
  }

  function setWebsiteSections(nextSections) {
    setWebsite((current) => ({ ...current, sectionSettingsJson: nextSections }));
    setWebsiteDirty(true);
    setWebsiteSaveState("dirty");
  }

  function setProfileField(field, value) {
    setProfile((current) => ({ ...current, [field]: value }));
    setWebsiteDirty(true);
    setWebsiteSaveState("dirty");
  }

  function savedAtLabel() {
    if (websiteDirty) return "Unsaved changes";
    if (!websiteLastSavedAt) return "Ready to save";
    const seconds = Math.max(1, Math.round((Date.now() - websiteLastSavedAt.getTime()) / 1000));
    if (seconds < 60) return `Saved ${seconds} second${seconds === 1 ? "" : "s"} ago`;
    const minutes = Math.round(seconds / 60);
    return `Saved ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  function websiteButtonLabel() {
    if (websiteSaveState === "saving") return "Saving...";
    if (websiteSaveState === "saved") return "Saved";
    if (websiteSaveState === "failed") return "Save Failed";
    return "Save Website Settings";
  }

  function itemPayloadFromForm(form = itemForm) {
    return {
      categoryId: form.categoryId,
      name: form.name.trim(),
      description: form.description.trim(),
      priceCents: Number(form.priceCents),
      preparationTimeMins: Number(form.preparationTimeMins || 15),
      calories: form.calories === "" || form.calories === null || form.calories === undefined ? null : Number(form.calories),
      spiceLevel: form.spiceLevel || null,
      featured: Boolean(form.featured),
      available: form.available !== false
    };
  }

  function itemPayloadFromRow(item = {}) {
    return {
      categoryId: item.categoryId || item.category?.id,
      name: String(item.name || "").trim(),
      description: String(item.description || "").trim(),
      priceCents: Number(item.priceCents || 0),
      preparationTimeMins: Number(item.preparationTimeMins || 15),
      calories: item.calories === "" || item.calories === null || item.calories === undefined ? null : Number(item.calories),
      spiceLevel: item.spiceLevel || null,
      available: item.available !== false,
      featured: Boolean(item.featured),
      recommended: Boolean(item.recommended)
    };
  }

  function validateMenuItemPayload(payload) {
    const nextErrors = {};
    if (!payload.categoryId) nextErrors.categoryId = "Choose a category.";
    if (!payload.name || payload.name.length < 2) nextErrors.name = "Enter an item name.";
    if (!Number.isFinite(payload.priceCents) || payload.priceCents < 0) nextErrors.priceCents = "Enter a valid price.";
    if (!Number.isFinite(payload.preparationTimeMins) || payload.preparationTimeMins <= 0) nextErrors.preparationTimeMins = "Prep time must be greater than zero.";
    if (payload.calories !== null && (!Number.isFinite(payload.calories) || payload.calories < 0)) nextErrors.calories = "Calories must be zero or greater.";
    return nextErrors;
  }

  function updateItemDraft(itemId, data) {
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, ...data } : item));
  }

  function modifierDraftKey(itemId, optionGroupId = "new") {
    return `${itemId}:${optionGroupId || "new"}`;
  }

  function draftFromModifierGroup(group = {}) {
    return {
      id: group.id || "",
      name: group.name || "",
      required: Boolean(group.required),
      minSelect: Number(group.minSelect || 0),
      maxSelect: Number(group.maxSelect || 1),
      optionsText: (group.options || []).map((option) => `${option.name}${option.priceCents ? ` | ${option.priceCents}` : ""}`).join("\n")
    };
  }

  function modifierDraftFor(item, group = null) {
    const key = modifierDraftKey(item.id, group?.id || "new");
    return modifierDrafts[key] || draftFromModifierGroup(group || { name: "", maxSelect: 1, options: [] });
  }

  function updateModifierDraft(item, groupId, data) {
    const key = modifierDraftKey(item.id, groupId || "new");
    const fallback = groupId ? draftFromModifierGroup((item.optionGroups || []).find((group) => group.id === groupId) || {}) : modifierDraftFor(item);
    setModifierDrafts((current) => ({ ...current, [key]: { ...fallback, ...(current[key] || {}), ...data } }));
  }

  function parseModifierOptionsText(optionsText = "") {
    return String(optionsText)
      .split(/\n|,/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const [namePart, pricePart = "0"] = line.split("|").map((part) => part.trim());
        return {
          name: namePart,
          priceCents: Math.max(0, Number(pricePart.replace(/[^0-9.-]/g, "")) || 0),
          available: true,
          sortOrder: index + 1
        };
      })
      .filter((option) => option.name.length > 0);
  }

  function modifierPayloadFromDraft(draft = {}) {
    const maxSelect = Math.max(1, Number(draft.maxSelect || 1));
    const minSelect = Math.max(0, Math.min(maxSelect, Number(draft.minSelect || 0)));
    return {
      name: String(draft.name || "").trim(),
      required: Boolean(draft.required),
      minSelect: draft.required ? Math.max(1, minSelect) : minSelect,
      maxSelect,
      sortOrder: 0,
      options: parseModifierOptionsText(draft.optionsText)
    };
  }

  useEffect(() => {
    setProfile((current) => (current?.id || current?.slug ? current : initialProfile));
  }, [initialProfile]);

  useEffect(() => {
    async function resolveRouteRestaurant() {
      if (!apiOnline || !token || user?.restaurantId || !initialSlug || user?.role !== "SUPER_ADMIN") return;
      try {
        let tenant = null;
        try {
          const publicPayload = await api(`/api/customer/restaurants/${initialSlug}`);
          tenant = publicPayload.restaurant || null;
        } catch {
          tenant = null;
        }
        if (!tenant) {
          const payload = await api("/api/admin/tenants", { token });
          tenant = (payload.businesses || payload.restaurants || []).find((item) => item.slug === initialSlug || item.id === initialSlug);
        }
        if (tenant?.id) setRouteRestaurantId(tenant.id);
        else setError(`No restaurant found for ${initialSlug}.`);
      } catch (resolveError) {
        setError(resolveError.message);
      }
    }
    resolveRouteRestaurant();
  }, [apiOnline, token, user?.restaurantId, user?.role, initialSlug]);

  async function loadRestaurant(options = {}) {
    if (!apiOnline || !token || !restaurantId) return null;
    if (loadRestaurantInFlightRef.current && !options.force) return loadRestaurantInFlightRef.current;
    const requestId = loadRestaurantRequestIdRef.current + 1;
    loadRestaurantRequestIdRef.current = requestId;
    const request = (async () => {
      setError("");
      try {
      const lockedFeatures = {};
      const optionalApi = async (feature, path, fallback) => {
        try {
          return await api(path, { token });
        } catch (optionalError) {
          const payload = optionalError.payload || {};
          const isEntitlementError = optionalError.status === 403 && (
            payload.upgradeRequired ||
            String(payload.code || "").startsWith("FEATURE_") ||
            String(payload.code || "").startsWith("SUBSCRIPTION_") ||
            payload.code === "PLAN_NOT_INCLUDED"
          );
          if (!isEntitlementError) throw optionalError;
          lockedFeatures[feature] = {
            feature,
            featureLabel: payload.featureLabel || featureLabels[feature],
            currentPlan: payload.currentPlan,
            requiredPlan: payload.requiredPlan || featureRequiredPlans[feature],
            subscriptionStatus: payload.subscriptionStatus,
            code: payload.code,
            error: payload.error || optionalError.message
          };
          return fallback;
        }
      };
      const reportParams = new window.URLSearchParams();
      if (reportRange) reportParams.set("range", reportRange);
      const reportQuery = reportParams.toString() ? `?${reportParams.toString()}` : "";
      const customerParams = new window.URLSearchParams(reportParams);
      customerParams.set("pageSize", "100");
      const customerQuery = `?${customerParams.toString()}`;
      const [dashboardPayload, profilePayload, mePayload, categoriesPayload, itemsPayload, ordersPayload, driversPayload, customersPayload, customerSummaryPayload, loyaltyPayload, promotionsPayload, analyticsPayload, menuInsightsPayload, locationsPayload, websitePayload, domainPayload, galleryPayload, socialPayload, employeesPayload, dispatchPayload, zonesPayload, inventoryPayload, printingPayload, notificationsPayload, operationsPayload] = await Promise.all([
        api(`/api/restaurants/${restaurantId}/dashboard`, { token }),
        api(`/api/restaurants/${restaurantId}/profile`, { token }),
        api("/api/restaurants/me", { token }),
        api(`/api/restaurants/${restaurantId}/menu/categories`, { token }),
        api(`/api/restaurants/${restaurantId}/menu/items`, { token }),
        api(`/api/restaurants/${restaurantId}/orders`, { token }),
        optionalApi("DRIVER_MANAGEMENT", `/api/restaurants/${restaurantId}/drivers${reportQuery}`, { drivers: [], summary: emptyDispatchCenter().summary }),
        optionalApi("CUSTOMER_CRM", `/api/restaurants/${restaurantId}/customers${customerQuery}`, { customers: [], summary: emptyCustomerSummary() }),
        optionalApi("CUSTOMER_CRM", `/api/restaurants/${restaurantId}/customers/summary${reportQuery}`, emptyCustomerSummary()),
        optionalApi("LOYALTY", `/api/restaurants/${restaurantId}/loyalty`, { analytics: {}, rewards: [], topCustomers: [] }),
        optionalApi("COUPONS", `/api/restaurants/${restaurantId}/promotions/analytics`, { activePromotions: [], redemptions: [], performance: {} }),
        optionalApi("ANALYTICS", `/api/restaurants/${restaurantId}/analytics${reportQuery}`, { metrics: {}, salesTrend: [], ordersTrend: [], customerGrowth: [], loyaltyGrowth: [] }),
        optionalApi("MENU_INSIGHTS", `/api/restaurants/${restaurantId}/menu/insights`, { bestSellingItems: [], worstSellingItems: [], categoryPerformance: [] }),
        api(`/api/restaurants/${restaurantId}/locations`, { token }),
        api(`/api/restaurants/${restaurantId}/website`, { token }),
        optionalApi("CUSTOM_DOMAIN", `/api/restaurants/${restaurantId}/domain`, { domain: emptyDomainSettings(initialProfile.slug) }),
        api(`/api/restaurants/${restaurantId}/gallery`, { token }),
        api(`/api/restaurants/${restaurantId}/social-links`, { token }),
        optionalApi("EMPLOYEE_MANAGEMENT", `/api/restaurants/${restaurantId}/employees`, { employees: [] }),
        optionalApi("DRIVER_MANAGEMENT", `/api/restaurants/${restaurantId}/dispatch${reportQuery}`, emptyDispatchCenter()),
        optionalApi("DELIVERY_ZONES", `/api/restaurants/${restaurantId}/delivery-zones`, { zones: [] }),
        optionalApi("INVENTORY", `/api/restaurants/${restaurantId}/inventory`, { items: [] }),
        optionalApi("PRINTING", `/api/restaurants/${restaurantId}/printing`, { settings: {} }),
        optionalApi("NOTIFICATIONS", `/api/restaurants/${restaurantId}/notification-settings`, { settings: {} }),
        optionalApi("REPORTS", `/api/restaurants/${restaurantId}/reports/operations${reportQuery}`, emptyOperationsReport())
      ]);
      if (requestId !== loadRestaurantRequestIdRef.current) return null;
      const profileBase = profilePayload.restaurant || initialProfile;
      setProfile(profilePayload.restaurant || initialProfile);
      const nextProfile = {
        ...profileBase,
        introductoryProgram: mePayload.introductoryProgram || mePayload.restaurant?.introductoryProgram || profilePayload.restaurant?.introductoryProgram
      };
      const nextLocations = locationsPayload.locations || [];
      setFeatureLocks(lockedFeatures);
      setStats(dashboardPayload);
      setProfile(nextProfile);
      setCategories(categoriesPayload.categories || []);
      setItems(itemsPayload.items || []);
      setOrders(ordersPayload.orders || []);
      setDrivers(driversPayload.drivers || []);
      setCustomers(customersPayload.customers || []);
      setCustomerSummary(customersPayload.summary || customerSummaryPayload || emptyCustomerSummary());
      setLoyalty(loyaltyPayload);
      setPromotions(promotionsPayload);
      setGrowthAnalytics(analyticsPayload);
      setMenuInsights(menuInsightsPayload);
      setLocations(nextLocations);
      setLocationDrafts(Object.fromEntries(nextLocations.map((location) => [location.id, locationDraftFrom(location, nextProfile)])));
      setWebsite(websitePayload.website || emptyWebsiteSettings());
      setDomain(domainPayload.domain || emptyDomainSettings(nextProfile.slug));
      setGallery(galleryPayload.gallery || []);
      setSocialLinks(socialPayload.socialLinks || []);
      setEmployees(employeesPayload.employees || []);
      setDispatch(withDefaultDispatch(dispatchPayload));
      setDeliveryZones(zonesPayload.zones || []);
      setInventoryItems(inventoryPayload.items || []);
      setPrinterSettings(printingPayload.settings || {});
      setNotificationSettings(notificationsPayload.settings || {});
      setOperationsReport(withDefaultOperationsReport(operationsPayload));
      return true;
      } catch (loadError) {
        if (requestId === loadRestaurantRequestIdRef.current) {
          resetRestaurantLiveState(initialProfile);
          setError(loadError.message);
        }
        return null;
      } finally {
        if (loadRestaurantInFlightRef.current === request) loadRestaurantInFlightRef.current = null;
      }
    })();
    loadRestaurantInFlightRef.current = request;
    return request;
  }

  function updateCustomerDraft(customerId, updates) {
    setCustomers((current) => current.map((customer) => customer.id === customerId ? { ...customer, ...updates } : customer));
  }

  async function saveCustomerNotes(customer) {
    if (!apiOnline || !token || !restaurantId) return liveRestaurantRequired("Live API is required to save customer notes.");
    setSavingCustomerId(customer.id);
    try {
      const payload = await api(`/api/restaurants/${restaurantId}/customers/${customer.id}/notes`, {
        method: "PATCH",
        token,
        body: { notes: customer.notes || "", segment: customer.segment }
      });
      const updatedCustomer = payload.customer || {};
      setCustomers((current) => current.map((row) => row.id === customer.id ? {
        ...row,
        notes: updatedCustomer.notes ?? customer.notes ?? "",
        segment: updatedCustomer.segment ?? customer.segment
      } : row));
      showToast("Customer profile saved.");
    } catch (saveError) {
      setError(saveError.message);
      showToast(saveError.message, "bad");
    } finally {
      setSavingCustomerId("");
    }
  }

  function updateLocationDraft(location, updates) {
    setLocationDrafts((current) => ({
      ...current,
      [location.id]: { ...locationDraftFrom(location, profile), ...(current[location.id] || {}), ...updates }
    }));
  }

  async function saveLocation(location) {
    if (!apiOnline || !token || !restaurantId) return liveRestaurantRequired("Live API is required to save location settings.");
    const draft = locationDrafts[location.id] || locationDraftFrom(location, profile);
    setSavingLocationId(location.id);
    try {
      const payload = await api(`/api/restaurants/${restaurantId}/locations/${location.id}`, {
        method: "PATCH",
        token,
        body: draft
      });
      const nextLocations = payload.locations || (payload.location ? locations.map((row) => row.id === location.id ? payload.location : row) : locations);
      const nextProfile = payload.restaurant || profile;
      setLocations(nextLocations);
      setProfile(nextProfile);
      setLocationDrafts(Object.fromEntries(nextLocations.map((row) => [row.id, locationDraftFrom(row, nextProfile)])));
      showToast("Location saved.");
    } catch (saveError) {
      setError(saveError.message);
      showToast(saveError.message, "bad");
    } finally {
      setSavingLocationId("");
    }
  }

  useEffect(() => {
    loadRestaurant({ force: true });
  }, [apiOnline, token, restaurantId, reportRange]);

  useEffect(() => {
    if (!apiOnline || !restaurantId) return undefined;
    const socket = io(API_ORIGIN, { transports: ["websocket", "polling"] });
    const refresh = () => {
      window.clearTimeout(realtimeRefreshTimerRef.current);
      realtimeRefreshTimerRef.current = window.setTimeout(() => loadRestaurant({ force: true }), 500);
    };
    socket.on("connect", () => {
      socket.emit("join:restaurant", restaurantId);
      socket.emit("join:kitchen", restaurantId);
    });
    socket.on("order:update", refresh);
    socket.on("delivery:update", refresh);
    socket.on("kitchen:update", refresh);
    return () => {
      window.clearTimeout(realtimeRefreshTimerRef.current);
      socket.disconnect();
    };
  }, [apiOnline, restaurantId, token]);

  async function uploadRestaurantImage(kind, file, extra = {}) {
    const validationError = validateImageFile(file, { accept: kind === "restaurant-logo" ? logoImageAccept : photoImageAccept, label: kind === "restaurant-logo" ? "logo" : "photo" });
    if (validationError) {
      setError(validationError);
      showToast(validationError, "bad");
      return null;
    }
    if (!apiOnline || !token || !restaurantId) {
      setError("Live API connection and restaurant login are required for image uploads.");
      showToast("Live API connection and restaurant login are required for image uploads.", "bad");
      return null;
    }
    setError("");
    setUploadingAsset(kind);
    try {
      const dataUrl = await fileToDataUrl(file);
      const mimeType = mimeTypeForFile(file);
      const payload = await api(`/api/uploads/${kind}`, {
        method: "POST",
        token,
        body: {
          restaurantId,
          fileName: file.name,
          mimeType,
          base64: base64FromDataUrl(dataUrl),
          ...extra
        }
      });
      if (payload.website) setWebsite(payload.website);
      if (payload.restaurant) setProfile(payload.restaurant);
      if (payload.item) setItems((current) => current.map((item) => item.id === payload.item.id ? payload.item : item));
      if (payload.image) setGallery((current) => [...current, payload.image].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
      if (kind === "restaurant-logo" || kind === "restaurant-hero") {
        setWebsiteDirty(false);
        setWebsiteSaveState("saved");
        setWebsiteLastSavedAt(new Date());
      }
      showToast(kind === "menu-item" ? "Menu item image uploaded successfully." : kind === "gallery" ? "Gallery photo uploaded successfully." : "Website image uploaded successfully.");
      return payload;
    } catch (uploadError) {
      setError(uploadError.message);
      showToast(uploadError.message, "bad");
      return null;
    } finally {
      setUploadingAsset("");
    }
  }

  async function uploadLogo(event) {
    const file = event.target.files?.[0];
    await uploadRestaurantImage("restaurant-logo", file);
    event.target.value = "";
  }

  async function uploadHero(event) {
    const file = event.target.files?.[0];
    await uploadRestaurantImage("restaurant-hero", file);
    event.target.value = "";
  }

  async function uploadGalleryImage(event) {
    const files = Array.from(event.target.files || []);
    let uploadedCount = 0;
    for (const [index, file] of files.entries()) {
      const fallbackTitle = file.name.replace(/\.[^.]+$/, "");
      const uploaded = await uploadRestaurantImage("gallery", file, {
        title: galleryForm.title || fallbackTitle,
        altText: galleryForm.altText || galleryForm.title || fallbackTitle,
        caption: galleryForm.caption,
        category: galleryForm.category,
        published: galleryForm.published,
        sortOrder: gallery.length + index + 1
      });
      if (uploaded) uploadedCount += 1;
    }
    if (uploadedCount) {
      setGalleryForm({ title: "", altText: "", caption: "", category: "food", published: true });
      showToast(`${uploadedCount} gallery photo${uploadedCount === 1 ? "" : "s"} uploaded successfully.`);
    }
    event.target.value = "";
  }

  async function uploadMenuItemImage(item, event) {
    const file = event.target.files?.[0];
    await uploadRestaurantImage("menu-item", file, { menuItemId: item.id, altText: item.name });
    event.target.value = "";
  }

  async function createCategory(event) {
    event.preventDefault();
    const name = categoryName.trim();
    if (name.length < 2) {
      setError("Category name must be at least 2 characters.");
      return showToast("Category name must be at least 2 characters.", "bad");
    }
    setSavingAction("category:create");
    if (!apiOnline || !token || !restaurantId) {
      setSavingAction("");
      return liveRestaurantRequired("Live API connection and restaurant login are required to create menu categories.");
    }
    try {
      await api(`/api/restaurants/${restaurantId}/menu/categories`, { method: "POST", token, body: { name, sortOrder: categories.length + 1, active: true } });
      setCategoryName("");
      await loadRestaurant();
      showToast("Menu category created successfully.");
    } catch (createError) {
      setError(createError.message);
      showToast(createError.message, "bad");
    } finally {
      setSavingAction("");
    }
  }

  async function updateCategory(category, data, message = "Menu category updated successfully.") {
    const next = { ...category, ...data };
    if (next.name !== undefined && String(next.name).trim().length < 2) {
      setError("Category name must be at least 2 characters.");
      return showToast("Category name must be at least 2 characters.", "bad");
    }
    setSavingAction(`category:${category.id}`);
    if (!apiOnline || !token || !restaurantId) {
      setSavingAction("");
      return liveRestaurantRequired("Live API connection and restaurant login are required to update menu categories.");
    }
    setCategories((current) => current.map((item) => item.id === category.id ? next : item).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
    try {
      await api(`/api/restaurants/${restaurantId}/menu/categories/${category.id}`, { method: "PATCH", token, body: { name: next.name, sortOrder: Number(next.sortOrder || 0), active: next.active !== false } });
      await loadRestaurant();
      showToast(message);
    } catch (updateError) {
      setError(updateError.message);
      showToast(updateError.message, "bad");
      await loadRestaurant();
    } finally {
      setSavingAction("");
    }
  }

  async function moveCategory(category, direction) {
    const sorted = [...categories].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const index = sorted.findIndex((item) => item.id === category.id);
    const swapIndex = index + direction;
    if (index < 0 || swapIndex < 0 || swapIndex >= sorted.length) return;
    const currentSort = sorted[index].sortOrder || index + 1;
    const swapSort = sorted[swapIndex].sortOrder || swapIndex + 1;
    await Promise.all([
      updateCategory(sorted[index], { sortOrder: swapSort }, "Category order updated."),
      updateCategory(sorted[swapIndex], { sortOrder: currentSort }, "Category order updated.")
    ]);
  }

  async function reorderGalleryImage(image, direction) {
    const sorted = [...gallery].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const index = sorted.findIndex((item) => item.id === image.id);
    const swapIndex = index + direction;
    if (index < 0 || swapIndex < 0 || swapIndex >= sorted.length) return;
    const currentSort = sorted[index].sortOrder || index + 1;
    const swapSort = sorted[swapIndex].sortOrder || swapIndex + 1;
    setSavingAction(`gallery:${image.id}`);
    if (!apiOnline || !token || !restaurantId) {
      setSavingAction("");
      return liveRestaurantRequired("Live API connection and restaurant login are required to reorder gallery photos.");
    }
    setGallery((current) => current.map((item) => {
      if (item.id === sorted[index].id) return { ...item, sortOrder: swapSort };
      if (item.id === sorted[swapIndex].id) return { ...item, sortOrder: currentSort };
      return item;
    }).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
    try {
      await Promise.all([
        api(`/api/restaurants/${restaurantId}/gallery/${sorted[index].id}`, { method: "PATCH", token, body: { sortOrder: swapSort } }),
        api(`/api/restaurants/${restaurantId}/gallery/${sorted[swapIndex].id}`, { method: "PATCH", token, body: { sortOrder: currentSort } })
      ]);
      await loadRestaurant();
      showToast("Gallery order updated.");
    } catch (galleryError) {
      setError(galleryError.message);
      showToast(galleryError.message, "bad");
      await loadRestaurant();
    } finally {
      setSavingAction("");
    }
  }

  async function updateGalleryImage(image, updates, message = "Gallery photo updated.") {
    setSavingAction(`gallery:${image.id}:update`);
    if (!apiOnline || !token || !restaurantId) {
      setSavingAction("");
      return liveRestaurantRequired("Live API connection and restaurant login are required to update gallery photos.");
    }
    setGallery((current) => current.map((item) => (item.id === image.id ? { ...item, ...updates } : item)));
    try {
      const payload = await api(`/api/restaurants/${restaurantId}/gallery/${image.id}`, { method: "PATCH", token, body: updates });
      setGallery((current) => current.map((item) => (item.id === image.id ? payload.image : item)));
      showToast(message);
    } catch (galleryError) {
      setError(galleryError.message);
      showToast(galleryError.message, "bad");
      await loadRestaurant();
    } finally {
      setSavingAction("");
    }
  }

  async function deleteCategory(categoryId) {
    const category = categories.find((item) => item.id === categoryId);
    setSavingAction(`category:${categoryId}`);
    if (!apiOnline || !token || !restaurantId) {
      setSavingAction("");
      return liveRestaurantRequired("Live API connection and restaurant login are required to delete menu categories.");
    }
    try {
      const payload = await api(`/api/restaurants/${restaurantId}/menu/categories/${categoryId}`, { method: "DELETE", token });
      await loadRestaurant();
      showToast(payload?.message || `${category?.name || "Category"} deleted successfully.`);
    } catch (deleteError) {
      setError(deleteError.message);
      showToast(deleteError.message, "bad");
    } finally {
      setSavingAction("");
    }
  }

  async function createItem(event) {
    event.preventDefault();
    const payload = { ...itemPayloadFromForm(), options: [] };
    const validationErrors = validateMenuItemPayload(payload);
    setMenuValidation(validationErrors);
    if (Object.keys(validationErrors).length) {
      setError("Fix the highlighted menu item fields.");
      return showToast("Fix the highlighted menu item fields.", "bad");
    }
    const imageValidationError = newItemImage ? validateImageFile(newItemImage, { accept: photoImageAccept, label: "photo" }) : "";
    if (imageValidationError) {
      setError(imageValidationError);
      return showToast(imageValidationError, "bad");
    }
    setSavingAction("item:create");
    if (!apiOnline || !token || !restaurantId) {
      setSavingAction("");
      return liveRestaurantRequired("Live API connection and restaurant login are required to create menu items.");
    }
    try {
      const created = await api(`/api/restaurants/${restaurantId}/menu/items`, { method: "POST", token, body: payload });
      if (newItemImage && created.item?.id) {
        await uploadRestaurantImage("menu-item", newItemImage, { menuItemId: created.item.id, altText: payload.name });
      }
      setItemForm({ categoryId: categories[0]?.id || "", name: "", priceCents: 1295, preparationTimeMins: 15, description: "", calories: "", spiceLevel: "", featured: false, available: true });
      setNewItemImage(null);
      setItemFileInputKey((key) => key + 1);
      await loadRestaurant();
      showToast("Menu item created successfully.");
    } catch (createError) {
      setError(createError.message);
      showToast(createError.message, "bad");
    } finally {
      setSavingAction("");
    }
  }

  async function updateItem(item, data, message = "Menu item updated successfully.") {
    const payload = { ...itemPayloadFromRow(item), ...data };
    const validationErrors = validateMenuItemPayload(payload);
    if (Object.keys(validationErrors).length) {
      setMenuValidation(validationErrors);
      setError("Fix the highlighted menu item fields.");
      return showToast("Fix the highlighted menu item fields.", "bad");
    }
    setMenuValidation({});
    setSavingAction(`item:${item.id}`);
    if (!apiOnline || !token || !restaurantId) {
      setSavingAction("");
      return liveRestaurantRequired("Live API connection and restaurant login are required to update menu items.");
    }
    try {
      const updated = await api(`/api/restaurants/${restaurantId}/menu/items/${item.id}`, { method: "PATCH", token, body: payload });
      if (updated.item) setItems((current) => current.map((currentItem) => currentItem.id === item.id ? updated.item : currentItem));
      await loadRestaurant();
      showToast(message);
    } catch (updateError) {
      setError(updateError.message);
      showToast(updateError.message, "bad");
      await loadRestaurant();
    } finally {
      setSavingAction("");
    }
  }

  async function saveModifierGroup(item, group = null) {
    const draft = modifierDraftFor(item, group);
    const payload = modifierPayloadFromDraft(draft);
    if (!payload.name || payload.name.length < 2) {
      return showToast("Modifier group name must be at least 2 characters.", "bad");
    }
    if (!payload.options.length) {
      return showToast("Add at least one modifier option.", "bad");
    }
    if (!apiOnline || !token || !restaurantId) {
      return showToast("Live API connection and restaurant login are required to save modifiers.", "bad");
    }
    const actionKey = `modifier:${item.id}:${group?.id || "new"}`;
    setSavingAction(actionKey);
    try {
      const path = group?.id
        ? `/api/restaurants/${restaurantId}/menu-items/${item.id}/options/${group.id}`
        : `/api/restaurants/${restaurantId}/menu-items/${item.id}/options`;
      const result = await api(path, { method: group?.id ? "PATCH" : "POST", token, body: payload });
      if (result.optionGroup) {
        setItems((current) => current.map((row) => {
          if (row.id !== item.id) return row;
          const groups = row.optionGroups || [];
          const nextGroups = group?.id
            ? groups.map((currentGroup) => currentGroup.id === group.id ? result.optionGroup : currentGroup)
            : [...groups, result.optionGroup];
          return { ...row, optionGroups: nextGroups };
        }));
      }
      if (!group?.id) {
        const key = modifierDraftKey(item.id, "new");
        setModifierDrafts((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
      showToast(group?.id ? "Modifier group updated." : "Modifier group created.");
      await loadRestaurant();
    } catch (modifierError) {
      setError(modifierError.message);
      showToast(modifierError.message, "bad");
    } finally {
      setSavingAction("");
    }
  }

  async function deleteModifierGroup(item, group) {
    if (!group?.id) return;
    if (!apiOnline || !token || !restaurantId) {
      return showToast("Live API connection and restaurant login are required to delete modifiers.", "bad");
    }
    const actionKey = `modifier:${item.id}:${group.id}:delete`;
    setSavingAction(actionKey);
    try {
      await api(`/api/restaurants/${restaurantId}/menu-items/${item.id}/options/${group.id}`, { method: "DELETE", token });
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, optionGroups: (row.optionGroups || []).filter((currentGroup) => currentGroup.id !== group.id) } : row));
      showToast("Modifier group deleted.");
      await loadRestaurant();
    } catch (modifierError) {
      setError(modifierError.message);
      showToast(modifierError.message, "bad");
    } finally {
      setSavingAction("");
    }
  }

  async function duplicateItem(item) {
    const source = itemPayloadFromRow(item);
    const payload = { ...source, name: `${source.name} Copy`, available: false, featured: false, recommended: false, options: [] };
    setSavingAction(`item:${item.id}:duplicate`);
    if (!apiOnline || !token || !restaurantId) {
      setSavingAction("");
      return liveRestaurantRequired("Live API connection and restaurant login are required to duplicate menu items.");
    }
    try {
      const created = await api(`/api/restaurants/${restaurantId}/menu/items`, { method: "POST", token, body: payload });
      if (created.item) setItems((current) => [...current, created.item]);
      await loadRestaurant();
      showToast("Menu item duplicated successfully.");
    } catch (duplicateError) {
      setError(duplicateError.message);
      showToast(duplicateError.message, "bad");
    } finally {
      setSavingAction("");
    }
  }

  async function deleteItem(itemId) {
    setSavingAction(`item:${itemId}:delete`);
    if (!apiOnline || !token || !restaurantId) {
      setSavingAction("");
      return liveRestaurantRequired("Live API connection and restaurant login are required to delete menu items.");
    }
    try {
      const payload = await api(`/api/restaurants/${restaurantId}/menu/items/${itemId}`, { method: "DELETE", token });
      if (payload?.item) setItems((current) => current.map((item) => item.id === itemId ? payload.item : item));
      await loadRestaurant();
      showToast(payload?.message || "Menu item deleted successfully.");
    } catch (deleteError) {
      setError(deleteError.message);
      showToast(deleteError.message, "bad");
    } finally {
      setSavingAction("");
    }
  }

  async function updateOrderStatus(order, status) {
    if (!apiOnline || !token || !restaurantId) return liveRestaurantRequired("Live API connection and restaurant login are required to update orders.");
    try {
      await api(`/api/restaurants/${restaurantId}/orders/${order.id}/status`, { method: "PATCH", token, body: { status } });
      await loadRestaurant();
    } catch (statusError) {
      setError(statusError.message);
    }
  }

  async function assignDriver(order) {
    const driver = drivers[0];
    if (!driver) return setError("Create a driver before assigning delivery.");
    if (!apiOnline || !token || !restaurantId) return liveRestaurantRequired("Live API connection and restaurant login are required to assign drivers.");
    try {
      await api(`/api/restaurants/${restaurantId}/orders/${order.id}/assign-driver`, { method: "POST", token, body: { driverId: driver.id } });
      await loadRestaurant();
    } catch (assignError) {
      setError(assignError.message);
    }
  }

  async function saveWebsiteBuilder() {
    setWebsiteSaveState("saving");
    setSavingAction("website:save");
    if (!apiOnline || !token || !restaurantId) {
      setWebsiteSaveState("failed");
      setSavingAction("");
      return liveRestaurantRequired("Live API connection and restaurant login are required to save website settings.");
    }
    try {
      const profilePayload = await api(`/api/restaurants/${restaurantId}/profile`, {
        method: "PATCH",
        token,
        body: {
          name: profile.name,
          businessName: profile.businessName || profile.name,
          phone: profile.phone,
          email: profile.email,
          address: profile.address,
          city: profile.city,
          state: profile.state,
          zip: profile.zip,
          logoUrl: profile.logoUrl,
          storeHoursJson: website.storeHoursJson || profile.storeHoursJson
        }
      });
      const websitePayload = await api(`/api/restaurants/${restaurantId}/website`, {
        method: "PATCH",
        token,
        body: {
          ...website,
          sectionSettingsJson: { ...websiteSectionDefaults, ...(website.sectionSettingsJson || {}) }
        }
      });
      setProfile(profilePayload.restaurant);
      setWebsite(websitePayload.website);
      setWebsiteDirty(false);
      setWebsiteSaveState("saved");
      setWebsiteLastSavedAt(new Date());
      showToast("Website settings saved successfully.");
    } catch (brandingError) {
      setError(brandingError.message);
      setWebsiteSaveState("failed");
      showToast(brandingError.message, "bad");
    } finally {
      setSavingAction("");
    }
  }

  async function removeWebsiteImage(field) {
    const isLogo = field === "logoUrl";
    setSavingAction(`website:${field}:remove`);
    if (!apiOnline || !token || !restaurantId) {
      setSavingAction("");
      return liveRestaurantRequired(`Live API connection and restaurant login are required to remove the ${isLogo ? "logo" : "hero image"}.`);
    }
    setWebsiteField(field, null);
    if (isLogo) setProfileField("logoUrl", null);
    try {
      const websitePayload = await api(`/api/restaurants/${restaurantId}/website`, { method: "PATCH", token, body: { [field]: null } });
      setWebsite(websitePayload.website);
      if (isLogo) {
        const profilePayload = await api(`/api/restaurants/${restaurantId}/profile`, { method: "PATCH", token, body: { logoUrl: null } });
        setProfile(profilePayload.restaurant);
      }
      setWebsiteDirty(false);
      setWebsiteSaveState("saved");
      setWebsiteLastSavedAt(new Date());
      showToast(`${isLogo ? "Logo" : "Hero image"} removed successfully.`);
    } catch (removeError) {
      setError(removeError.message);
      setWebsiteSaveState("failed");
      showToast(removeError.message, "bad");
      await loadRestaurant();
    } finally {
      setSavingAction("");
    }
  }

  async function saveDomain(data = domain) {
    setSavingAction("domain:save");
    if (!apiOnline || !token || !restaurantId) {
      setSavingAction("");
      return liveRestaurantRequired("Live API connection and restaurant login are required to save domain settings.");
    }
    try {
      const payload = await api(`/api/restaurants/${restaurantId}/domain`, { method: "PATCH", token, body: data });
      setDomain(payload.domain);
      showToast("Domain settings saved successfully.");
    } catch (domainError) {
      setError(domainError.message);
      showToast(domainError.message, "bad");
    } finally {
      setSavingAction("");
    }
  }

  async function verifyDomain() {
    setSavingAction("domain:verify");
    if (!apiOnline || !token || !restaurantId) {
      setSavingAction("");
      return liveRestaurantRequired("Live API connection and restaurant login are required to verify domains.");
    }
    try {
      const payload = await api(`/api/restaurants/${restaurantId}/domain/verify`, { method: "POST", token, body: { canonicalDomain: domain.customDomain || domain.canonicalDomain } });
      setDomain(payload.domain);
      showToast("Domain verification checked successfully.");
    } catch (domainError) {
      setError(domainError.message);
      showToast(domainError.message, "bad");
    } finally {
      setSavingAction("");
    }
  }

  async function addSocialLink(event) {
    event.preventDefault();
    if (!socialForm.url.trim()) {
      setError("Enter a social profile URL.");
      return showToast("Enter a social profile URL.", "bad");
    }
    try {
      const parsed = new globalThis.URL(socialForm.url);
      if (parsed.protocol !== "https:") throw new Error("Invalid protocol");
    } catch {
      setError("Enter a valid https social URL.");
      return showToast("Enter a valid https social URL.", "bad");
    }
    setSavingAction("social:save");
    if (!apiOnline || !token || !restaurantId) {
      setSavingAction("");
      return liveRestaurantRequired("Live API connection and restaurant login are required to save social links.");
    }
    try {
      await api(`/api/restaurants/${restaurantId}/social-links`, { method: "POST", token, body: socialForm });
      setSocialForm({ platform: "instagram", url: "" });
      await loadRestaurant();
      showToast("Social link saved successfully.");
    } catch (socialError) {
      setError(socialError.message);
      showToast(socialError.message, "bad");
    } finally {
      setSavingAction("");
    }
  }

  async function updateSocialLink(link, updates, message = "Social link updated.") {
    if (!apiOnline || !token || !restaurantId) {
      return liveRestaurantRequired("Live API connection and restaurant login are required to update social links.");
    }
    setSavingAction(`social:${link.id}:update`);
    try {
      const payload = await api(`/api/restaurants/${restaurantId}/social-links/${link.id}`, { method: "PATCH", token, body: updates });
      setSocialLinks((current) => current.map((item) => (item.id === link.id ? payload.socialLink : item)));
      showToast(message);
    } catch (socialError) {
      setError(socialError.message);
      showToast(socialError.message, "bad");
    } finally {
      setSavingAction("");
    }
  }

  async function deleteSocialLink(linkId) {
    if (!apiOnline || !token || !restaurantId) {
      return liveRestaurantRequired("Live API connection and restaurant login are required to remove social links.");
    }
    setSavingAction(`social:${linkId}:delete`);
    try {
      await api(`/api/restaurants/${restaurantId}/social-links/${linkId}`, { method: "DELETE", token });
      setSocialLinks((current) => current.filter((link) => link.id !== linkId));
      showToast("Social link removed successfully.");
    } catch (socialError) {
      setError(socialError.message);
      showToast(socialError.message, "bad");
    } finally {
      setSavingAction("");
    }
  }

  async function deleteGalleryImage(imageId) {
    setSavingAction(`gallery:${imageId}:delete`);
    if (!apiOnline || !token || !restaurantId) {
      setSavingAction("");
      return liveRestaurantRequired("Live API connection and restaurant login are required to delete gallery photos.");
    }
    try {
      await api(`/api/restaurants/${restaurantId}/gallery/${imageId}`, { method: "DELETE", token });
      setGallery((current) => current.filter((image) => image.id !== imageId));
      showToast("Gallery photo removed successfully.");
    } catch (galleryError) {
      setError(galleryError.message);
      showToast(galleryError.message, "bad");
    } finally {
      setSavingAction("");
    }
  }

  async function createEmployee(event) {
    event.preventDefault();
    if (!apiOnline || !token || !restaurantId) return liveRestaurantRequired("Live API connection and restaurant login are required to create employees.");
    try {
      await api(`/api/restaurants/${restaurantId}/employees`, { method: "POST", token, body: employeeForm });
      setEmployeeForm({ name: "", email: "", phone: "", role: "KITCHEN_STAFF" });
      await loadRestaurant();
    } catch (employeeError) {
      setError(employeeError.message);
    }
  }

  async function disableEmployee(employee) {
    if (!apiOnline || !token || !restaurantId) return liveRestaurantRequired("Live API connection and restaurant login are required to disable employees.");
    try {
      await api(`/api/restaurants/${restaurantId}/employees/${employee.id}/disable`, { method: "PATCH", token });
      await loadRestaurant();
    } catch (employeeError) {
      setError(employeeError.message);
    }
  }

  async function assignDispatchDelivery(delivery, driverId) {
    if (!driverId) return setError("Select or create an available driver first.");
    if (!apiOnline || !token || !restaurantId) return liveRestaurantRequired("Live API connection and restaurant login are required to assign deliveries.");
    try {
      await api(`/api/restaurants/${restaurantId}/deliveries/${delivery.id}/assign-driver`, { method: "PATCH", token, body: { driverId } });
      await loadRestaurant();
    } catch (dispatchError) {
      setError(dispatchError.message);
    }
  }

  async function cancelDispatchAssignment(delivery) {
    if (!apiOnline || !token || !restaurantId) return liveRestaurantRequired("Live API connection and restaurant login are required to cancel dispatch assignments.");
    try {
      await api(`/api/restaurants/${restaurantId}/deliveries/${delivery.id}/cancel-assignment`, { method: "PATCH", token });
      await loadRestaurant();
    } catch (dispatchError) {
      setError(dispatchError.message);
    }
  }

  async function savePrinterSettings(next = printerSettings) {
    if (!apiOnline || !token || !restaurantId) return liveRestaurantRequired("Live API connection and restaurant login are required to save printer settings.");
    try {
      const payload = await api(`/api/restaurants/${restaurantId}/printing`, { method: "PATCH", token, body: next });
      setPrinterSettings(payload.settings);
    } catch (printError) {
      setError(printError.message);
    }
  }

  const restaurantBasePath = profile.slug || initialSlug ? `/restaurant/${profile.slug || initialSlug}` : "/restaurant";

  function receiptPathForOrder(order, kind = "receipt", { reprint = false } = {}) {
    const params = new window.URLSearchParams();
    const normalizedKind = receiptDocumentKind(kind);
    if (normalizedKind !== "receipt") params.set("kind", normalizedKind);
    if (reprint) params.set("reprint", "1");
    const query = params.toString();
    return `${restaurantBasePath}/orders/${encodeURIComponent(order.id)}/receipt${query ? `?${query}` : ""}`;
  }

  function printTestReceipt() {
    if (!orders[0]) {
      setError("Create an order before printing a test receipt.");
      return showToast("Create an order before printing a test receipt.", "bad");
    }
    printOrderTicket(orders[0], "receipt");
  }

  function printOrderTicket(order, kind, options = {}) {
    if (!order?.id) {
      setError("Select an order before printing a receipt.");
      return showToast("Select an order before printing a receipt.", "bad");
    }
    if (!apiOnline || !token || !restaurantId) {
      return liveRestaurantRequired("Live API connection and restaurant login are required to preview and print receipts.");
    }
    navigateInApp(receiptPathForOrder(order, kind, options));
  }

  async function saveNotificationSettings(next = notificationSettings) {
    if (!apiOnline || !token || !restaurantId) return liveRestaurantRequired("Live API connection and restaurant login are required to save notification settings.");
    try {
      const payload = await api(`/api/restaurants/${restaurantId}/notification-settings`, { method: "PATCH", token, body: next });
      setNotificationSettings(payload.settings);
    } catch (notificationError) {
      setError(notificationError.message);
    }
  }

  async function createDeliveryZone(event) {
    event.preventDefault();
    if (!apiOnline || !token || !restaurantId) return liveRestaurantRequired("Live API connection and restaurant login are required to create delivery zones.");
    try {
      await api(`/api/restaurants/${restaurantId}/delivery-zones`, { method: "POST", token, body: zoneForm });
      setZoneForm({ name: `Zone ${String.fromCharCode(65 + deliveryZones.length + 1)}`, radiusMiles: 3, deliveryFeeCents: 399, minimumOrderCents: 1500 });
      await loadRestaurant();
    } catch (zoneError) {
      setError(zoneError.message);
    }
  }

  async function disableDeliveryZone(zone) {
    if (!apiOnline || !token || !restaurantId) return liveRestaurantRequired("Live API connection and restaurant login are required to disable delivery zones.");
    try {
      await api(`/api/restaurants/${restaurantId}/delivery-zones/${zone.id}`, { method: "DELETE", token });
      await loadRestaurant();
    } catch (zoneError) {
      setError(zoneError.message);
    }
  }

  async function createInventoryItem(event) {
    event.preventDefault();
    if (!apiOnline || !token || !restaurantId) return liveRestaurantRequired("Live API connection and restaurant login are required to create inventory items.");
    try {
      await api(`/api/restaurants/${restaurantId}/inventory`, { method: "POST", token, body: inventoryForm });
      setInventoryForm({ name: "", quantity: 0, unit: "unit", costCents: 0 });
      await loadRestaurant();
    } catch (inventoryError) {
      setError(inventoryError.message);
    }
  }

  async function updateInventoryItem(item, data) {
    if (!apiOnline || !token || !restaurantId) return liveRestaurantRequired("Live API connection and restaurant login are required to update inventory items.");
    try {
      await api(`/api/restaurants/${restaurantId}/inventory/${item.id}`, { method: "PATCH", token, body: data });
      await loadRestaurant();
    } catch (inventoryError) {
      setError(inventoryError.message);
    }
  }

  const currentRestaurantPage = restaurantPageDefinitions[activePage] ? activePage : "dashboard";
  const RestaurantPageComponent = restaurantPageComponents[currentRestaurantPage] || RestaurantDashboardPage;
  const selectedSettingsSectionId = currentRestaurantPage === "settings" ? restaurantSettingsSectionFromPath(window.location.pathname, window.location.hash) : "";
  const restaurantOperationsTitle = `${profile.businessName || profile.name || "Restaurant"} operations`;

  useEffect(() => {
    if (currentRestaurantPage !== "settings" || !selectedSettingsSectionId) return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`settings-${selectedSettingsSectionId}`)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentRestaurantPage, selectedSettingsSectionId]);

  const businessType = profile.businessType || "RESTAURANT";
  if (!isOrderingBusiness(businessType)) {
    const moduleNotice = { title: "Food catalog", detail: "This food-retail tenant can manage its profile and website now. Full catalog ordering comes after restaurant direct ordering and delivery are hardened." };

    return (
      <div className="space-y-6">
        <SectionHeader eyebrow={`${readable(businessType)} dashboard`} title={profile.businessName || profile.name || "Business"} icon={Store} action={<button className="button-muted" onClick={loadRestaurant}><RefreshCw size={18} />Refresh</button>} />
        <InlineError message={error} />
        <div className="grid gap-4 md:grid-cols-3">
          <Stat icon={Store} label="Food business type" value={readable(businessType)} detail="Restaurant-centric SaaS foundation" />
          <Stat icon={TicketPercent} label="Modules" value={(profile.enabledModules || []).length} detail={(profile.enabledModules || []).map(readable).join(", ") || "No modules"} />
          <Stat icon={Clock} label="Status" value={profile.status || "ACTIVE"} detail="Restaurant module remains production-ready" />
        </div>
        <div className="panel" id="menu">
          <h3 className="panel-title">{moduleNotice.title}</h3>
          <p className="mt-3 text-sm text-slate-500">{moduleNotice.detail}</p>
        </div>
      </div>
    );
  }

  const sectionSettings = { ...websiteSectionDefaults, ...(website.sectionSettingsJson || {}) };
  const settingsStoreHours = Object.entries(website.storeHoursJson || profile.storeHoursJson || {});
  const orderingModuleEnabled = (profile.enabledModules || []).includes("RESTAURANT_ORDERING");
  const lockFor = (feature) => featureLocks[feature];
  const hasLock = (feature) => Boolean(lockFor(feature));
  const entitlementSummary = profile.entitlements || {};
  const kitchenDisplayLock = lockFor("KITCHEN_DISPLAY") || (lockFor("PRINTING") ? { ...lockFor("PRINTING"), featureLabel: featureLabels.KITCHEN_DISPLAY, requiredPlan: featureRequiredPlans.KITCHEN_DISPLAY } : null);
  const settingsCenterLinks = restaurantSettingsLinks.map((item) => {
    const normalizedId = normalizeRestaurantSettingsSectionId(item.id);
    const lock = item.feature ? lockFor(item.feature) : null;
    return {
      ...item,
      id: normalizedId,
      href: item.id === "payments" ? `${restaurantBasePath}/onboarding#payments` : restaurantSettingPath(restaurantBasePath, normalizedId),
      status: lock ? "PLAN_RESTRICTED" : item.status,
      selected: selectedSettingsSectionId === normalizedId
    };
  });
  const dashboardShortcuts = [
    { label: "POS register", detail: "Create in-store orders, manage shifts, cash, card, and kiosk mode.", icon: CreditCard, href: `${restaurantBasePath}/pos`, value: "Open" },
    { label: "Pending orders", detail: "Open live orders and kitchen queue.", icon: ReceiptText, href: `${restaurantBasePath}/orders?status=pending`, value: stats.pendingOrders ?? orders.filter((order) => !["DELIVERED", "CANCELLED"].includes(order.status)).length },
    { label: "Today's sales", detail: "Review current-day sales and performance.", icon: CreditCard, href: `${restaurantBasePath}/reports?range=today`, value: money(stats.sales?.amountCents || stats.sales?.restaurantNetCents || 0) },
    { label: "Available drivers", detail: "Manage delivery coverage and dispatch.", icon: Truck, href: `${restaurantBasePath}/drivers?filter=available`, value: stats.activeDrivers ?? drivers.filter((driver) => driver.available).length },
    { label: "Customers", detail: "Open customer CRM and loyalty activity.", icon: Users, href: `${restaurantBasePath}/customers`, value: customerSummary.totalCustomers || customers.length },
    { label: "Website", detail: "Edit branding, website content, and gallery.", icon: Store, href: restaurantSettingPath(restaurantBasePath, "website-branding"), value: website.websiteEnabled === false ? "Disabled" : "Active" },
    { label: "Menu", detail: "Manage categories, food items, photos, and availability.", icon: MenuIcon, href: restaurantSettingPath(restaurantBasePath, "menu-catalog"), value: items.length }
  ];
  const isDashboardPage = currentRestaurantPage === "dashboard";
  const isOrdersPage = currentRestaurantPage === "orders";
  const isCustomersPage = currentRestaurantPage === "customers";
  const isDriversPage = currentRestaurantPage === "drivers";
  const isReportsPage = currentRestaurantPage === "reports";
  const isSettingsPage = currentRestaurantPage === "settings";
  const isSettingsCenterPage = isSettingsPage && !selectedSettingsSectionId;
  const showSettingsSection = (sectionId) => isSettingsPage && selectedSettingsSectionId === normalizeRestaurantSettingsSectionId(sectionId);
  const settingsCenterGroups = groupRestaurantSettingsLinks(settingsCenterLinks);
  const filteredCustomers = customers.filter((customer) => {
    const query = customerSearch.trim().toLowerCase();
    const haystack = [
      customer.safeName || customer.name,
      safeCustomerContact(customer),
      customer.segment,
      customer.computedSegment,
      customer.customerType,
      customer.notes
    ].filter(Boolean).join(" ").toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (customerSegmentFilter !== "ALL" && customer.segment !== customerSegmentFilter && customer.computedSegment !== customerSegmentFilter) return false;
    if (customerTypeFilter !== "ALL" && customer.customerType !== customerTypeFilter) return false;
    return true;
  });
  const selectedCustomer = filteredCustomers.find((customer) => customer.id === selectedCustomerId) || filteredCustomers[0] || null;
  const dispatchWithDefaults = withDefaultDispatch(dispatch);
  const dispatchSummary = dispatchWithDefaults.summary || emptyDispatchCenter().summary;
  const driverRoster = dispatchWithDefaults.drivers?.length ? dispatchWithDefaults.drivers : drivers;
  const selectedDriver = driverRoster.find((driver) => driver.id === selectedDriverId) || driverRoster[0] || null;
  const operationsWithDefaults = withDefaultOperationsReport(operationsReport);
  const reportSales = operationsWithDefaults.sales || {};
  const reportCharts = operationsWithDefaults.charts || {};
  const receiptRouteMatch = window.location.pathname.match(/^\/restaurant\/[^/]+\/orders\/([^/]+)\/receipt\/?$/);

  if (receiptRouteMatch) {
    return (
      <RestaurantPageComponent>
        <RestaurantReceiptPreviewPage
          apiOnline={apiOnline}
          token={token}
          restaurantId={restaurantId}
          orderId={decodeURIComponent(receiptRouteMatch[1])}
          onBack={() => navigateInApp(`${restaurantBasePath}/orders`)}
        />
      </RestaurantPageComponent>
    );
  }

  if (currentRestaurantPage === "pos") {
    return (
      <RestaurantPageComponent>
        <RestaurantPosWorkspace
          apiOnline={apiOnline}
          token={token}
          user={user}
          restaurantId={restaurantId}
          restaurantSlug={profile.slug || initialSlug || user?.restaurantSlug || ""}
          profile={profile}
          onRefresh={loadRestaurant}
        />
      </RestaurantPageComponent>
    );
  }

  return (
    <RestaurantPageComponent>
      <div className={`space-y-6 restaurant-dashboard restaurant-dashboard-${currentRestaurantPage}`}>
        <SectionHeader eyebrow={`${restaurantPageDefinitions[currentRestaurantPage].label} workspace`} title={currentRestaurantPage === "dashboard" ? restaurantOperationsTitle : restaurantPageDefinitions[currentRestaurantPage].title} icon={restaurantPageDefinitions[currentRestaurantPage].icon || ChefHat} action={<button className="button-muted" onClick={loadRestaurant}><RefreshCw size={18} />Refresh</button>} />
        <InlineError message={error} />
        {toast ? <div className={`rounded-md border px-4 py-3 text-sm font-bold ${toast.tone === "bad" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{toast.message}</div> : null}
        {entitlementSummary.planCode ? (
          <div className="rounded-md border border-line bg-white px-4 py-3 text-sm font-semibold text-slate-600">
            Plan: <strong className="text-ink">{readable(entitlementSummary.planCode)}</strong>
            {entitlementSummary.subscriptionStatus ? <> - Status: <strong className="text-ink">{readable(entitlementSummary.subscriptionStatus)}</strong></> : null}
          </div>
        ) : null}
        {isDashboardPage ? <TrialCountdownPanel program={profile.introductoryProgram} /> : null}
        {isDashboardPage ? (
          <div className="grid gap-4 md:grid-cols-4">
            <Stat icon={Clock} label="Pending orders" value={stats.pendingOrders ?? orders.filter((order) => !["DELIVERED", "CANCELLED"].includes(order.status)).length} detail="Live kitchen queue" />
            <Stat icon={ReceiptText} label="Today's sales" value={money(stats.sales?.amountCents || stats.sales?.restaurantNetCents || orders.reduce((sum, order) => sum + order.totalCents, 0))} detail="Tips separated" />
            <Stat icon={Truck} label="Available drivers" value={stats.activeDrivers ?? drivers.filter((driver) => driver.available).length} detail="Internal fleet" />
            <Stat icon={TicketPercent} label="Orders today" value={stats.ordersToday ?? orders.length} detail="Pickup and delivery" />
          </div>
        ) : null}
      {isDashboardPage ? (
        <div className="restaurant-dashboard-shortcuts" aria-label="Restaurant dashboard shortcuts">
          {dashboardShortcuts.map(({ label, detail, icon: Icon, href, value }) => (
            <a className="restaurant-dashboard-shortcut" href={href} key={label}>
              <span className="restaurant-dashboard-shortcut-icon"><Icon size={20} aria-hidden="true" /></span>
              <span>
                <strong>{label}</strong>
                <small>{detail}</small>
              </span>
              <b>{value}</b>
            </a>
          ))}
        </div>
      ) : null}
      {(showSettingsSection("menu-catalog") || isOrdersPage) ? (
      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        {showSettingsSection("menu-catalog") ? (
        <div className="panel" id="settings-menu-catalog">
          <h3 className="panel-title">Menu management</h3>
          <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={createCategory}>
            <input className="input" placeholder="New category" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} />
            <button className="button-primary" type="submit"><Plus size={16} />Category</button>
          </form>
          <form className="mt-4 form-grid" onSubmit={createItem}>
            <label className="text-sm font-semibold text-slate-600">Category
              <select className="select mt-1" value={itemForm.categoryId} onChange={(event) => setItemForm({ ...itemForm, categoryId: event.target.value })}>
                <option value="">Select category</option>
                {categories.map((category) => <option value={category.id} key={category.id}>{category.name}{category.active === false ? " (hidden)" : ""}</option>)}
              </select>
              {menuValidation.categoryId ? <span className="mt-1 block text-xs font-bold text-rose-600">{menuValidation.categoryId}</span> : null}
            </label>
            <label className="text-sm font-semibold text-slate-600">Item name
              <input className="input mt-1" placeholder="Chicken tikka masala" value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} />
              {menuValidation.name ? <span className="mt-1 block text-xs font-bold text-rose-600">{menuValidation.name}</span> : null}
            </label>
            <label className="text-sm font-semibold text-slate-600">Price cents
              <input className="input mt-1" type="number" min="0" placeholder="1295" value={itemForm.priceCents} onChange={(event) => setItemForm({ ...itemForm, priceCents: event.target.value })} />
              {menuValidation.priceCents ? <span className="mt-1 block text-xs font-bold text-rose-600">{menuValidation.priceCents}</span> : null}
            </label>
            <input className="input" placeholder="Description" value={itemForm.description} onChange={(event) => setItemForm({ ...itemForm, description: event.target.value })} />
            <label className="text-sm font-semibold text-slate-600">Prep minutes
              <input className="input mt-1" type="number" min="1" placeholder="15" value={itemForm.preparationTimeMins} onChange={(event) => setItemForm({ ...itemForm, preparationTimeMins: event.target.value })} />
              {menuValidation.preparationTimeMins ? <span className="mt-1 block text-xs font-bold text-rose-600">{menuValidation.preparationTimeMins}</span> : null}
            </label>
            <input className="input" type="number" min="0" placeholder="Calories optional" value={itemForm.calories} onChange={(event) => setItemForm({ ...itemForm, calories: event.target.value })} />
            <input className="input" placeholder="Spice level optional" value={itemForm.spiceLevel} onChange={(event) => setItemForm({ ...itemForm, spiceLevel: event.target.value })} />
            <label className={`seg ${itemForm.featured ? "active" : ""}`}><input type="checkbox" checked={itemForm.featured} onChange={(event) => setItemForm({ ...itemForm, featured: event.target.checked })} />Featured</label>
            <label className={`seg ${itemForm.available ? "active" : ""}`}><input type="checkbox" checked={itemForm.available} onChange={(event) => setItemForm({ ...itemForm, available: event.target.checked })} />Available</label>
            <label className="button-muted justify-center">
              <Plus size={16} />{newItemImage ? newItemImage.name : "Food image"}
              <input key={itemFileInputKey} className="sr-only" type="file" accept={photoImageAccept} onChange={(event) => setNewItemImage(event.target.files?.[0] || null)} />
            </label>
            {newItemImage ? <button className="button-muted justify-center" type="button" onClick={() => { setNewItemImage(null); setItemFileInputKey((key) => key + 1); }}>Remove selected image</button> : null}
            <button className="button-primary" type="submit" disabled={savingAction === "item:create"}><MenuIcon size={16} />{savingAction === "item:create" ? "Saving..." : "Create Item"}</button>
          </form>
          <div className="mt-5 space-y-4">
            {categories.length === 0 ? <EmptyState title="No menu categories" detail="Add a category before creating menu items." /> : categories.map((category) => (
              <div key={category.id}>
                <div className="mb-2 grid gap-2 rounded-md border border-line bg-slate-50 p-3 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                    <input className="input font-bold" value={category.name} onChange={(event) => setCategories((current) => current.map((item) => item.id === category.id ? { ...item, name: event.target.value } : item))} />
                    <StatusPill tone={category.active === false ? "warn" : "good"}>{category.active === false ? "Hidden" : "Published"}</StatusPill>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="button-muted" type="button" onClick={() => moveCategory(category, -1)} disabled={savingAction.startsWith("category:")}>Move up</button>
                    <button className="button-muted" type="button" onClick={() => moveCategory(category, 1)} disabled={savingAction.startsWith("category:")}>Move down</button>
                    <button className="button-muted" type="button" onClick={() => updateCategory(category, { active: category.active === false }, category.active === false ? "Category published." : "Category hidden.")}>{category.active === false ? "Publish" : "Hide"}</button>
                    <button className="button-primary" type="button" onClick={() => updateCategory(category, { name: category.name, sortOrder: category.sortOrder || 0, active: category.active !== false })} disabled={savingAction === `category:${category.id}`}>{savingAction === `category:${category.id}` ? "Saving..." : "Save Category"}</button>
                    <button className="button-muted" type="button" onClick={() => deleteCategory(category.id)}><Trash2 size={15} />Delete</button>
                  </div>
                </div>
                <div className="space-y-2">
                  {items.filter((item) => item.categoryId === category.id || item.category?.id === category.id).length === 0 ? <p className="text-sm text-slate-500">No items in this category.</p> : items.filter((item) => item.categoryId === category.id || item.category?.id === category.id).map((item) => (
                    <div className="rounded-md border border-line bg-white p-3" key={item.id}>
                      <div className="grid gap-3 lg:grid-cols-[112px_1fr]">
                        <div>
                          {item.imageUrl ? <img className="order-card-img" src={resolveImage(item.imageUrl, "", defaultLooharImage)} alt={item.name} onError={handleSafeImageError} /> : <div className="grid h-28 w-28 shrink-0 place-items-center rounded-md bg-slate-100 text-xs font-bold text-slate-400">Photo</div>}
                          <label className="button-muted mt-2 w-full justify-center">
                            <Plus size={15} />{uploadingAsset === "menu-item" ? "Uploading" : item.imageUrl ? "Replace" : "Add photo"}
                            <input className="sr-only" type="file" accept={photoImageAccept} onChange={(event) => uploadMenuItemImage(item, event)} />
                          </label>
                          <p className="mt-2 text-xs text-slate-500">Square food photo recommended. JPG, PNG, or WEBP up to 5MB.</p>
                          {item.imageUrl ? <button className="button-muted mt-2 w-full justify-center" type="button" onClick={() => updateItem(item, { imageUrl: null }, "Menu item image removed.")}>Remove photo</button> : null}
                        </div>
                        <div className="grid gap-3">
                          <div className="grid gap-2 md:grid-cols-2">
                            <input className="input font-semibold" value={item.name || ""} onChange={(event) => updateItemDraft(item.id, { name: event.target.value })} />
                            <select className="select" value={item.categoryId || item.category?.id || ""} onChange={(event) => updateItemDraft(item.id, { categoryId: event.target.value })}>
                              {categories.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}
                            </select>
                          </div>
                          <textarea className="input min-h-20" value={item.description || ""} placeholder="Description" onChange={(event) => updateItemDraft(item.id, { description: event.target.value })} />
                          <div className="grid gap-2 md:grid-cols-4">
                            <label className="text-xs font-bold uppercase text-slate-500">Price cents
                              <input className="input mt-1" type="number" min="0" value={item.priceCents ?? 0} onChange={(event) => updateItemDraft(item.id, { priceCents: event.target.value })} />
                            </label>
                            <label className="text-xs font-bold uppercase text-slate-500">Prep minutes
                              <input className="input mt-1" type="number" min="1" value={item.preparationTimeMins ?? 15} onChange={(event) => updateItemDraft(item.id, { preparationTimeMins: event.target.value })} />
                            </label>
                            <label className="text-xs font-bold uppercase text-slate-500">Calories
                              <input className="input mt-1" type="number" min="0" value={item.calories ?? ""} onChange={(event) => updateItemDraft(item.id, { calories: event.target.value })} />
                            </label>
                            <label className="text-xs font-bold uppercase text-slate-500">Spice level
                              <input className="input mt-1" value={item.spiceLevel || ""} onChange={(event) => updateItemDraft(item.id, { spiceLevel: event.target.value })} />
                            </label>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <strong>{money(Number(item.priceCents || 0))}</strong>
                            <StatusPill tone={item.available === false ? "warn" : "good"}>{item.available === false ? "Unavailable" : "Available"}</StatusPill>
                            {item.featured ? <StatusPill tone="good">Featured</StatusPill> : null}
                            {item.recommended ? <StatusPill tone="neutral">Recommended</StatusPill> : null}
                          </div>
                          <details className="menu-modifier-builder">
                            <summary>
                              <span>Modifiers</span>
                              <StatusPill tone={(item.optionGroups || []).length ? "good" : "neutral"}>{(item.optionGroups || []).length ? `${(item.optionGroups || []).length} groups` : "None"}</StatusPill>
                            </summary>
                            <div className="menu-modifier-list">
                              {(item.optionGroups || []).map((group) => {
                                const draft = modifierDraftFor(item, group);
                                const actionKey = `modifier:${item.id}:${group.id}`;
                                return (
                                  <div className="menu-modifier-panel" key={group.id}>
                                    <div className="menu-modifier-panel-head">
                                      <strong>{group.name}</strong>
                                      <span>{group.required ? "Required" : "Optional"} · max {group.maxSelect || 1}</span>
                                    </div>
                                    <div className="menu-modifier-form">
                                      <input className="input" value={draft.name} placeholder="Group name" onChange={(event) => updateModifierDraft(item, group.id, { name: event.target.value })} />
                                      <label className="seg"><input type="checkbox" checked={draft.required} onChange={(event) => updateModifierDraft(item, group.id, { required: event.target.checked })} />Required</label>
                                      <input className="input" type="number" min="0" value={draft.minSelect} aria-label="Minimum selections" onChange={(event) => updateModifierDraft(item, group.id, { minSelect: event.target.value })} />
                                      <input className="input" type="number" min="1" value={draft.maxSelect} aria-label="Maximum selections" onChange={(event) => updateModifierDraft(item, group.id, { maxSelect: event.target.value })} />
                                      <textarea className="input menu-modifier-options-input" value={draft.optionsText} placeholder={"Option name | price cents\nExtra cheese | 150"} onChange={(event) => updateModifierDraft(item, group.id, { optionsText: event.target.value })} />
                                    </div>
                                    <div className="menu-modifier-actions">
                                      <button className="button-primary" type="button" onClick={() => saveModifierGroup(item, group)} disabled={savingAction === actionKey}>{savingAction === actionKey ? "Saving..." : "Save modifiers"}</button>
                                      <button className="button-muted" type="button" onClick={() => deleteModifierGroup(item, group)} disabled={savingAction === `${actionKey}:delete`}><Trash2 size={15} />Delete group</button>
                                    </div>
                                  </div>
                                );
                              })}
                              {(() => {
                                const draft = modifierDraftFor(item);
                                const actionKey = `modifier:${item.id}:new`;
                                return (
                                  <div className="menu-modifier-panel new">
                                    <div className="menu-modifier-panel-head">
                                      <strong>Add modifier group</strong>
                                      <span>Examples: Size, protein, spice level, sides</span>
                                    </div>
                                    <div className="menu-modifier-form">
                                      <input className="input" value={draft.name} placeholder="Group name" onChange={(event) => updateModifierDraft(item, "new", { name: event.target.value })} />
                                      <label className="seg"><input type="checkbox" checked={draft.required} onChange={(event) => updateModifierDraft(item, "new", { required: event.target.checked })} />Required</label>
                                      <input className="input" type="number" min="0" value={draft.minSelect} aria-label="Minimum selections" onChange={(event) => updateModifierDraft(item, "new", { minSelect: event.target.value })} />
                                      <input className="input" type="number" min="1" value={draft.maxSelect} aria-label="Maximum selections" onChange={(event) => updateModifierDraft(item, "new", { maxSelect: event.target.value })} />
                                      <textarea className="input menu-modifier-options-input" value={draft.optionsText} placeholder={"Option name | price cents\nMild | 0\nMedium | 0\nExtra spicy | 50"} onChange={(event) => updateModifierDraft(item, "new", { optionsText: event.target.value })} />
                                    </div>
                                    <button className="button-primary menu-modifier-save" type="button" onClick={() => saveModifierGroup(item)} disabled={savingAction === actionKey}>{savingAction === actionKey ? "Saving..." : "Create modifier group"}</button>
                                  </div>
                                );
                              })()}
                            </div>
                          </details>
                          <div className="flex flex-wrap items-center gap-2">
                            <button className="button-primary" type="button" onClick={() => updateItem(item)} disabled={savingAction === `item:${item.id}`}>{savingAction === `item:${item.id}` ? "Saving..." : "Save Item"}</button>
                            <button className="button-muted" type="button" onClick={() => updateItem(item, { available: item.available === false }, item.available === false ? "Item marked available." : "Item marked unavailable.")}>{item.available === false ? "Mark available" : "Mark unavailable"}</button>
                            <button className="button-muted" type="button" onClick={() => updateItem(item, { featured: !item.featured }, item.featured ? "Item removed from featured menu." : "Item marked featured.")}>{item.featured ? "Unfeature" : "Feature"}</button>
                            <button className="button-muted" type="button" onClick={() => updateItem(item, { recommended: !item.recommended }, item.recommended ? "Item removed from recommendations." : "Item marked recommended.")}>{item.recommended ? "Unrecommend" : "Recommend"}</button>
                            <button className="button-muted" type="button" onClick={() => duplicateItem(item)} disabled={savingAction === `item:${item.id}:duplicate`}>Duplicate</button>
                            <button className="button-muted" type="button" onClick={() => deleteItem(item.id)}><Trash2 size={15} />Delete</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        ) : null}
        {isOrdersPage ? (
        <div className="panel" id="orders">
          <h3 className="panel-title">Live orders</h3>
          <div className="mt-4 space-y-3">
            {orders.length === 0 ? <EmptyState title="No orders yet" detail="Customer orders will appear here in real time." /> : orders.map((order) => (
              <div className="order-row" key={order.id}>
                <div>
                  <p className="font-bold text-ink">#{order.orderNumber} - {order.customer?.name || "Customer"}</p>
                  <p className="text-sm text-slate-500">{order.type} - Total {money(order.totalCents)} - Driver tip {money(order.tipCents)}</p>
                  {order.delivery?.driver?.user?.name ? <p className="text-xs text-slate-500">Driver: {order.delivery.driver.user.name}</p> : null}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <StatusPill tone={order.status === "DELIVERED" ? "good" : order.status === "READY" ? "warn" : "neutral"}>{order.status}</StatusPill>
                  {["ACCEPTED", "PREPARING", "READY", "PICKED_UP", "DELIVERED", "CANCELLED"].map((status) => <button className="button-muted" key={status} onClick={() => updateOrderStatus(order, status)}>{status.replaceAll("_", " ")}</button>)}
                  <button className="button-muted" onClick={() => printOrderTicket(order, "receipt")}><ReceiptText size={16} />Print Receipt</button>
                  <button className="button-muted" onClick={() => printOrderTicket(order, "receipt", { reprint: true })}><RefreshCw size={16} />Reprint</button>
                  <button className="button-muted" onClick={() => printOrderTicket(order, "kitchen")}>Kitchen Ticket</button>
                  {order.type === "DELIVERY" ? <button className="button-muted" onClick={() => printOrderTicket(order, "driver")}>Driver Slip</button> : null}
                  {order.type === "DELIVERY" ? <button className="button-primary" onClick={() => assignDriver(order)}><Truck size={16} />Assign</button> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
        ) : null}
      </div>
      ) : null}
      {isCustomersPage ? (
      <div className="grid gap-4 md:grid-cols-4" id="customers-summary">
        <Stat icon={Users} label="Total customers" value={integer(customerSummary.totalCustomers || customers.length)} detail={`${integer(customerSummary.newCustomersThisMonth || 0)} new this month`} />
        <Stat icon={RefreshCw} label="Repeat rate" value={percentText(customerSummary.repeatCustomerPercentage)} detail={`${integer(customerSummary.returningCustomers || 0)} returning customers`} />
        <Stat icon={TicketPercent} label="VIP customers" value={integer(customerSummary.vipCustomerCount || 0)} detail={`${integer(customerSummary.atRiskCustomers || 0)} at risk`} />
        <Stat icon={CreditCard} label="Lifetime spend" value={money(customerSummary.lifetimeSpendCents)} detail={`${money(customerSummary.averageOrderValueCents)} average order`} />
      </div>
      ) : null}
      {(isCustomersPage || showSettingsSection("loyalty")) ? (
      <div className="grid gap-5 xl:grid-cols-2" id={isCustomersPage ? "customers" : undefined}>
        {isCustomersPage ? (
        <div className="panel" id="customers-crm">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
            <div>
              <h3 className="panel-title">Customer CRM</h3>
              <p className="mt-2 text-sm text-slate-500">Live customer profiles, segmentation, order history, loyalty points, favorites, and owner notes.</p>
            </div>
            <StatusPill tone="good">{integer(customerSummary.contactableCustomers || 0)} contactable</StatusPill>
          </div>
          {hasLock("CUSTOMER_CRM") ? <div className="mt-4"><UpgradeRequired feature="CUSTOMER_CRM" lock={lockFor("CUSTOMER_CRM")} /></div> : (
          <>
          <div className="crm-toolbar mt-4">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input className="input pl-9" id="customer-search" placeholder="Search customers, notes, contact..." value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} />
            </div>
            <select className="select" value={customerSegmentFilter} onChange={(event) => setCustomerSegmentFilter(event.target.value)}>
              <option value="ALL">All segments</option>
              {["NEW_CUSTOMER", "ACTIVE_CUSTOMER", "VIP_CUSTOMER", "AT_RISK_CUSTOMER", "INACTIVE_CUSTOMER"].map((segment) => <option value={segment} key={segment}>{readable(segment)}</option>)}
            </select>
            <select className="select" value={customerTypeFilter} onChange={(event) => setCustomerTypeFilter(event.target.value)}>
              <option value="ALL">All customer types</option>
              <option value="REGISTERED">Registered</option>
              <option value="GUEST_CONTACTABLE">Guest contactable</option>
              <option value="WALK_IN_GUEST">Walk-in guest</option>
            </select>
          </div>
          <div className="crm-layout mt-5">
            <div>
              <div className="flex items-center justify-between gap-3">
                <h4 className="font-bold text-ink">Customer list</h4>
                <span className="text-sm font-bold text-slate-500">{integer(filteredCustomers.length)} shown</span>
              </div>
              <div className="customer-list mt-3">
                {filteredCustomers.length === 0 ? <EmptyState title="No customers found" detail="Adjust the search or wait for live orders to create customer records." /> : filteredCustomers.map((customerRow) => (
                  <button className={`customer-list-row ${selectedCustomer?.id === customerRow.id ? "active" : ""}`} type="button" key={customerRow.id} onClick={() => setSelectedCustomerId(customerRow.id)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-black text-ink">{customerRow.safeName || customerRow.name || "Customer"}</p>
                        <p className="truncate text-sm font-semibold text-slate-500">{safeCustomerContact(customerRow)}</p>
                        <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-400">{readable(customerRow.customerType || "GUEST_CONTACTABLE")}</p>
                      </div>
                      <StatusPill tone={customerRow.segment === "VIP_CUSTOMER" ? "good" : customerRow.segment === "AT_RISK_CUSTOMER" || customerRow.segment === "INACTIVE_CUSTOMER" ? "warn" : "neutral"}>{readable(customerRow.segment || "NEW_CUSTOMER")}</StatusPill>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-bold text-slate-500">
                      <span>{integer(customerRow.totalOrders || 0)} orders</span>
                      <span>{money(customerRow.lifetimeSpendCents)}</span>
                      <span>{integer(customerRow.loyaltyPointBalance || 0)} pts</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div className="customer-detail-panel">
              {!selectedCustomer ? <EmptyState title="No customer selected" detail="Choose a customer to view profile details." /> : (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-wide text-mint">Customer profile</p>
                      <h4 className="text-2xl font-black text-ink">{selectedCustomer.safeName || selectedCustomer.name || "Customer"}</h4>
                      <p className="text-sm font-semibold text-slate-500">{safeCustomerContact(selectedCustomer)}</p>
                    </div>
                    <StatusPill tone={selectedCustomer.segment === "VIP_CUSTOMER" ? "good" : selectedCustomer.segment === "AT_RISK_CUSTOMER" || selectedCustomer.segment === "INACTIVE_CUSTOMER" ? "warn" : "neutral"}>{readable(selectedCustomer.segment || "NEW_CUSTOMER")}</StatusPill>
                  </div>
                  <div className="customer-detail-grid">
                    <div><span>Lifetime spend</span><strong>{money(selectedCustomer.lifetimeSpendCents)}</strong></div>
                    <div><span>Average order</span><strong>{money(selectedCustomer.averageOrderValueCents)}</strong></div>
                    <div><span>Total orders</span><strong>{integer(selectedCustomer.totalOrders || 0)}</strong></div>
                    <div><span>Last order</span><strong>{dateText(selectedCustomer.lastOrderDate)}</strong></div>
                    <div><span>Loyalty points</span><strong>{integer(selectedCustomer.loyaltyPointBalance || 0)}</strong></div>
                    <div><span>Favorite items</span><strong>{(selectedCustomer.favoriteMenuItems || []).slice(0, 2).map((item) => item.name).join(", ") || "No favorites yet"}</strong></div>
                  </div>
                  <label className="block text-sm font-semibold text-slate-600">Segment
                    <select className="select mt-1" value={selectedCustomer.segment || "NEW_CUSTOMER"} onChange={(event) => updateCustomerDraft(selectedCustomer.id, { segment: event.target.value })}>
                      {["NEW_CUSTOMER", "ACTIVE_CUSTOMER", "VIP_CUSTOMER", "AT_RISK_CUSTOMER", "INACTIVE_CUSTOMER"].map((segment) => <option value={segment} key={segment}>{readable(segment)}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm font-semibold text-slate-600">Notes
                    <textarea className="input mt-1 min-h-24" value={selectedCustomer.notes || ""} placeholder="Add private owner notes for this customer." onChange={(event) => updateCustomerDraft(selectedCustomer.id, { notes: event.target.value })} />
                  </label>
                  <button className="button-primary" type="button" onClick={() => saveCustomerNotes(selectedCustomer)} disabled={savingCustomerId === selectedCustomer.id}>
                    <CheckCircle2 size={16} />{savingCustomerId === selectedCustomer.id ? "Saving..." : "Save Customer"}
                  </button>
                  <div>
                    <h5 className="font-bold text-ink">Recent orders</h5>
                    <div className="mt-2 space-y-2">
                      {(selectedCustomer.orders || []).length === 0 ? <EmptyState title="No orders" detail="Order history appears after this customer orders." /> : selectedCustomer.orders.slice(0, 5).map((order) => (
                        <div className="summary-line rounded-md bg-white px-3 py-2" key={order.id}>
                          <span>#{order.orderNumber || order.id} - {readable(order.status || "PENDING")}</span>
                          <strong>{money(order.netSalesCents || order.totalCents)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          </>
          )}
        </div>
        ) : null}
        {showSettingsSection("loyalty") ? (
        <div className="panel" id="settings-loyalty">
          <h3 className="panel-title">Loyalty program</h3>
          {hasLock("LOYALTY") ? <div className="mt-4"><UpgradeRequired feature="LOYALTY" lock={lockFor("LOYALTY")} /></div> : <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-md bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">Points issued</p><strong className="text-xl text-ink">{loyalty.analytics?.pointsIssued || 0}</strong></div>
            <div className="rounded-md bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">Redeemed</p><strong className="text-xl text-ink">{loyalty.analytics?.pointsRedeemed || 0}</strong></div>
            <div className="rounded-md bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">Rewards</p><strong className="text-xl text-ink">{loyalty.rewards?.length || 0}</strong></div>
          </div>
          <div className="mt-4 space-y-2">
            {(loyalty.rewards || []).length === 0 ? <p className="text-sm text-slate-500">Reward examples: free drink, free appetizer, discount coupon, free delivery.</p> : loyalty.rewards.map((reward) => (
              <div className="summary-line" key={reward.id}><span>{reward.name}</span><strong>{reward.pointsRequired} pts</strong></div>
            ))}
          </div>
          </>}
        </div>
        ) : null}
      </div>
      ) : null}
      {(showSettingsSection("coupons") || isReportsPage) ? (
      <div className="grid gap-5 xl:grid-cols-3">
        {showSettingsSection("coupons") ? (
        <div className="panel" id="settings-coupons">
          <h3 className="panel-title">Promotions</h3>
          {hasLock("COUPONS") ? <div className="mt-4"><UpgradeRequired feature="COUPONS" lock={lockFor("COUPONS")} /></div> : <div className="mt-4 space-y-2">
            {(promotions.activePromotions || []).length === 0 ? <EmptyState title="No active promotions" detail="Create coupons for fixed discounts, percentage discounts, free delivery, or BOGO campaigns." /> : promotions.activePromotions.map((coupon) => (
              <div className="summary-line" key={coupon.id}><span>{coupon.code}</span><strong>{coupon.redeemedCount || 0} used</strong></div>
            ))}
          </div>}
        </div>
        ) : null}
        {isReportsPage ? (
        <div className="panel" id="reports-analytics-summary">
          <h3 className="panel-title">Restaurant analytics</h3>
          {hasLock("ANALYTICS") ? <div className="mt-4"><UpgradeRequired feature="ANALYTICS" lock={lockFor("ANALYTICS")} /></div> : <div className="mt-4 space-y-2 text-sm text-slate-600">
            <div className="summary-line"><span>Total orders</span><strong>{integer(reportSales.totalOrders || 0)}</strong></div>
            <div className="summary-line"><span>Delivery orders</span><strong>{integer(reportSales.deliveryOrders || 0)}</strong></div>
            <div className="summary-line"><span>Pickup orders</span><strong>{integer(reportSales.pickupOrders || 0)}</strong></div>
            <div className="summary-line"><span>Driver tips</span><strong>{money(reportSales.driverTipsCents)}</strong></div>
          </div>}
        </div>
        ) : null}
        {isReportsPage ? (
        <div className="panel" id="reports-menu-insights">
          <h3 className="panel-title">Menu insights</h3>
          {hasLock("MENU_INSIGHTS") ? <div className="mt-4"><UpgradeRequired feature="MENU_INSIGHTS" lock={lockFor("MENU_INSIGHTS")} /></div> : <div className="mt-4 space-y-2">
            {(menuInsights.bestSellingItems || []).length === 0 ? <EmptyState title="No item insights yet" detail="Best sellers and weak performers appear after orders." /> : menuInsights.bestSellingItems.slice(0, 4).map((item) => (
              <div className="summary-line" key={item.id}><span>{item.name}</span><strong>{item.quantity} sold</strong></div>
            ))}
          </div>}
        </div>
        ) : null}
      </div>
      ) : null}
      {(showSettingsSection("website-branding") || showSettingsSection("domains-seo") || showSettingsSection("gallery-social")) ? (
      <div className="grid gap-5 xl:grid-cols-2">
        {showSettingsSection("website-branding") ? (
        <div className="panel" id="settings-website-branding">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <h3 className="panel-title">Website Builder</h3>
              <p className="mt-2 text-sm text-slate-500">Manage the public restaurant website generated from this tenant.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a className="button-muted" href={publicPreviewPath} target="_blank" rel="noreferrer">Preview Website</a>
              <a className="button-muted" href={`${publicPreviewPath}/menu`}>Preview Menu</a>
              <a className="button-muted" href={`${publicPreviewPath}/order`}>Preview Order</a>
              <a className="button-muted" href={`${publicPreviewPath}/contact`}>Preview Contact</a>
              <a className="button-primary" href={publicSiteUrl} target="_blank" rel="noreferrer">Open Public Website</a>
              <button className="button-muted" onClick={() => navigator.clipboard?.writeText(publicSiteUrl)}>Copy Website Link</button>
            </div>
          </div>
          <div className={`mt-4 rounded-md border px-3 py-2 text-sm font-bold ${websiteDirty ? "border-amber-200 bg-amber-50 text-amber-700" : websiteSaveState === "failed" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
            {savedAtLabel()}
          </div>
          <div className="mt-4 form-grid">
            <input className="input" placeholder="Restaurant name" value={profile.businessName || profile.name || ""} onChange={(event) => { setProfile((current) => ({ ...current, name: event.target.value, businessName: event.target.value })); setWebsiteDirty(true); setWebsiteSaveState("dirty"); }} />
            <input className="input" placeholder="Phone" value={profile.phone || ""} onChange={(event) => setProfileField("phone", event.target.value)} />
            <input className="input" placeholder="Email" value={profile.email || ""} onChange={(event) => setProfileField("email", event.target.value)} />
            <input className="input" placeholder="Address" value={profile.address || ""} onChange={(event) => setProfileField("address", event.target.value)} />
            <input className="input" placeholder="City" value={profile.city || ""} onChange={(event) => setProfileField("city", event.target.value)} />
            <input className="input" placeholder="State" value={profile.state || ""} onChange={(event) => setProfileField("state", event.target.value)} />
            <label className="text-sm font-semibold text-slate-600">Website status
              <select className="select mt-1" value={website.websiteEnabled ? "enabled" : "disabled"} onChange={(event) => setWebsiteField("websiteEnabled", event.target.value === "enabled")}>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-600">Brand color
              <input className="input mt-1" value={website.brandColor || ""} onChange={(event) => setWebsiteField("brandColor", event.target.value)} />
            </label>
            <label className="text-sm font-semibold text-slate-600">Accent color
              <input className="input mt-1" value={website.accentColor || ""} onChange={(event) => setWebsiteField("accentColor", event.target.value)} />
            </label>
            <input className="input" placeholder="Homepage headline" value={website.heroTitle || ""} onChange={(event) => setWebsiteField("heroTitle", event.target.value)} />
            <input className="input" placeholder="Homepage subtitle" value={website.heroSubtitle || ""} onChange={(event) => setWebsiteField("heroSubtitle", event.target.value)} />
            <input className="input" placeholder="Tagline" value={website.tagline || ""} onChange={(event) => setWebsiteField("tagline", event.target.value)} />
            <input className="input" placeholder="Cuisine type" value={website.cuisineType || ""} onChange={(event) => setWebsiteField("cuisineType", event.target.value)} />
            <input className="input" placeholder="Special offer text" value={website.specialOfferText || ""} onChange={(event) => setWebsiteField("specialOfferText", event.target.value)} />
            <input className="input" placeholder="Heading font" value={website.headingFont || ""} onChange={(event) => setWebsiteField("headingFont", event.target.value)} />
            <input className="input" placeholder="Body font" value={website.bodyFont || ""} onChange={(event) => setWebsiteField("bodyFont", event.target.value)} />
            <input className="input" placeholder="SEO title" value={website.seoTitle || ""} onChange={(event) => setWebsiteField("seoTitle", event.target.value)} />
            <textarea className="input min-h-24 md:col-span-3" placeholder="About story" value={website.aboutStory || ""} onChange={(event) => setWebsiteField("aboutStory", event.target.value)} />
            <textarea className="input min-h-20 md:col-span-3" placeholder="SEO description" value={website.seoDescription || ""} onChange={(event) => setWebsiteField("seoDescription", event.target.value)} />
            <div className="md:col-span-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-line p-3">
                <p className="text-sm font-bold text-ink">Logo</p>
                {website.logoUrl ? <img className="mt-2 h-20 w-20 rounded-md object-cover" src={resolveImage(website.logoUrl, profile.logoUrl)} alt={`${profile.name} logo`} onError={handleSafeImageError} /> : <p className="mt-2 text-sm text-slate-500">Loohar default logo will display until a logo is uploaded.</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <label className="button-muted">
                    <Plus size={15} />{uploadingAsset === "restaurant-logo" ? "Uploading logo" : website.logoUrl ? "Replace logo" : "Upload logo"}
                    <input className="sr-only" type="file" accept={logoImageAccept} onChange={uploadLogo} />
                  </label>
                  {website.logoUrl ? <button className="button-muted" type="button" onClick={() => removeWebsiteImage("logoUrl")} disabled={websiteSaveState === "saving"}><Trash2 size={15} />Remove</button> : null}
                </div>
              </div>
              <div className="rounded-md border border-line p-3">
                <p className="text-sm font-bold text-ink">Hero image</p>
                {website.heroImageUrl ? <img className="mt-2 h-24 w-full rounded-md object-cover" src={resolveImage(website.heroImageUrl, profile.logoUrl)} alt={`${profile.name} hero`} onError={handleSafeImageError} /> : <p className="mt-2 text-sm text-slate-500">Upload a restaurant, food, or storefront hero image.</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <label className="button-muted">
                    <Plus size={15} />{uploadingAsset === "restaurant-hero" ? "Uploading hero" : website.heroImageUrl ? "Replace hero" : "Upload hero"}
                    <input className="sr-only" type="file" accept={photoImageAccept} onChange={uploadHero} />
                  </label>
                  {website.heroImageUrl ? <button className="button-muted" type="button" onClick={() => removeWebsiteImage("heroImageUrl")} disabled={websiteSaveState === "saving"}><Trash2 size={15} />Remove</button> : null}
                </div>
              </div>
            </div>
            <div className="md:col-span-3 flex flex-wrap gap-2">
              {Object.entries(websiteSectionDefaults).map(([section]) => (
                <label className={`seg ${sectionSettings[section] ? "active" : ""}`} key={section}>
                  <input
                    type="checkbox"
                    checked={sectionSettings[section]}
                    onChange={(event) => setWebsiteSections({ ...sectionSettings, [section]: event.target.checked })}
                  />
                  {readable(section)}
                </label>
              ))}
            </div>
          </div>
          <button className="button-primary mt-4" onClick={saveWebsiteBuilder} disabled={websiteSaveState === "saving"}><Store size={16} />{websiteButtonLabel()}</button>
        </div>
        ) : null}
        {(showSettingsSection("domains-seo") || showSettingsSection("gallery-social")) ? (
        <div className="panel" id="settings-domains-seo">
          <h3 className="panel-title">{showSettingsSection("gallery-social") ? "Gallery and social links" : "Domain Management"}</h3>
          {showSettingsSection("domains-seo") ? (hasLock("CUSTOM_DOMAIN") ? <div className="mt-4"><UpgradeRequired feature="CUSTOM_DOMAIN" lock={lockFor("CUSTOM_DOMAIN")} /></div> : <>
          <div className="mt-4 space-y-2 text-sm text-slate-600">
            <div className="summary-line"><span>Default Loohar subdomain</span><strong>{defaultTenantUrlFor(profile, domain)}</strong></div>
            <div className="summary-line"><span>Canonical URL</span><strong>{canonicalTenantUrlFor(profile, domain)}</strong></div>
            <div className="summary-line"><span>Domain status</span><strong>{readable(domain.domainStatus || "NOT_CONFIGURED")}</strong></div>
            <div className="summary-line"><span>SSL status</span><strong>{readable(domain.sslStatus || "NOT_CONFIGURED")}</strong></div>
            <p className="rounded-md bg-slate-50 p-3 font-semibold text-ink">DNS: create CNAME www pointing to {domain.dnsTarget || "cname.vercel-dns.com"}</p>
          </div>
          <div className="mt-4 grid gap-2">
            <input className="input" placeholder="Custom domain" value={domain.customDomain || ""} onChange={(event) => setDomain({ ...domain, customDomain: event.target.value })} />
            <select className="select" value={domain.canonicalDomain === domain.customDomain && domain.customDomain ? "CUSTOM_DOMAIN" : "DEFAULT_SUBDOMAIN"} onChange={(event) => setDomain({ ...domain, canonicalDomain: event.target.value === "CUSTOM_DOMAIN" ? domain.customDomain : domain.primaryDomain || `${domain.defaultSubdomain || profile.slug}.${tenantRootDomain}` })}>
              <option value="DEFAULT_SUBDOMAIN">Use Loohar subdomain as canonical</option>
              <option value="CUSTOM_DOMAIN">Use custom domain as canonical</option>
            </select>
            <button className="button-primary" type="button" onClick={() => saveDomain({ ...domain, domainStatus: "PENDING_VERIFICATION", sslStatus: "PENDING" })} disabled={savingAction === "domain:save"}>{savingAction === "domain:save" ? "Saving domain..." : "Save Domain"}</button>
            <button className="button-muted" type="button" onClick={verifyDomain} disabled={savingAction === "domain:verify"}>{savingAction === "domain:verify" ? "Checking..." : "Verify Domain"}</button>
            <button className="button-muted" type="button" onClick={() => saveDomain({ ...domain, customDomain: "", canonicalDomain: domain.primaryDomain || `${domain.defaultSubdomain || profile.slug}.${tenantRootDomain}`, domainStatus: "NOT_CONFIGURED", sslStatus: "NOT_CONFIGURED" })} disabled={savingAction === "domain:save"}>Remove Custom Domain</button>
          </div>
          </>) : null}
          {showSettingsSection("gallery-social") ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2" id="settings-gallery-social">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-bold text-ink">Gallery</h4>
              </div>
              <div className="mt-3 grid gap-2">
                <input className="input" placeholder="Gallery title" value={galleryForm.title} onChange={(event) => setGalleryForm({ ...galleryForm, title: event.target.value })} />
                <input className="input" placeholder="Alt text for accessibility" value={galleryForm.altText} onChange={(event) => setGalleryForm({ ...galleryForm, altText: event.target.value })} />
                <input className="input" placeholder="Caption" value={galleryForm.caption} onChange={(event) => setGalleryForm({ ...galleryForm, caption: event.target.value })} />
                <select className="select" value={galleryForm.category} onChange={(event) => setGalleryForm({ ...galleryForm, category: event.target.value })}>
                  <option value="food">Food</option>
                  <option value="dining-room">Dining Room</option>
                  <option value="kitchen">Kitchen</option>
                  <option value="staff">Staff</option>
                  <option value="events">Events</option>
                  <option value="catering">Catering</option>
                  <option value="exterior">Exterior</option>
                  <option value="other">Other</option>
                </select>
                <label className="flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-600">
                  <input type="checkbox" checked={galleryForm.published} onChange={(event) => setGalleryForm({ ...galleryForm, published: event.target.checked })} />
                  Show on public website
                </label>
                <label className="button-muted justify-center">
                  <Plus size={15} />{uploadingAsset === "gallery" ? "Uploading photos" : "Upload gallery photos"}
                  <input className="sr-only" type="file" accept={photoImageAccept} multiple onChange={uploadGalleryImage} />
                </label>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {gallery.length === 0 ? <p className="text-sm text-slate-500">No gallery photos yet.</p> : [...gallery].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map((image, index, sortedGallery) => (
                  <figure className="rounded-md border border-line p-2" key={image.id}>
                    <img className="h-20 w-full rounded-md object-cover" src={resolveImage(image.imageUrl, "", defaultLooharImage)} alt={image.altText || "Restaurant gallery"} onError={handleSafeImageError} />
                    <figcaption className="mt-1 text-xs text-slate-500"><strong className="block truncate text-ink">{image.title || image.altText || readable(image.category)}</strong>{image.caption ? <span className="block truncate">{image.caption}</span> : null}<span className="block">{image.published === false ? "Hidden from public site" : "Published"}</span></figcaption>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <button className="button-muted min-h-8 px-2 py-1 text-xs" type="button" onClick={() => reorderGalleryImage(image, -1)} disabled={index === 0 || savingAction.startsWith("gallery:")}>Up</button>
                      <button className="button-muted min-h-8 px-2 py-1 text-xs" type="button" onClick={() => reorderGalleryImage(image, 1)} disabled={index === sortedGallery.length - 1 || savingAction.startsWith("gallery:")}>Down</button>
                      <button className="button-muted min-h-8 px-2 py-1 text-xs" type="button" onClick={() => updateGalleryImage(image, { published: image.published === false }, image.published === false ? "Gallery photo published." : "Gallery photo hidden.")} disabled={savingAction === `gallery:${image.id}:update`}>{image.published === false ? "Publish" : "Hide"}</button>
                      <button className="button-muted min-h-8 px-2 py-1 text-xs" type="button" onClick={() => deleteGalleryImage(image.id)} disabled={savingAction === `gallery:${image.id}:delete`}><Trash2 size={13} />Delete</button>
                    </div>
                  </figure>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-bold text-ink">Social links</h4>
              </div>
              <form className="mt-3 grid gap-2" onSubmit={addSocialLink}>
                <select className="select" value={socialForm.platform} onChange={(event) => setSocialForm({ ...socialForm, platform: event.target.value })}>
                  {Object.entries(socialPlatformLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
                <input className="input" placeholder="https:// social profile URL" value={socialForm.url} onChange={(event) => setSocialForm({ ...socialForm, url: event.target.value })} />
                <button className="button-primary" type="submit" disabled={savingAction === "social:save"}><Plus size={15} />{savingAction === "social:save" ? "Saving link..." : "Save link"}</button>
              </form>
              <div className="mt-3 space-y-2">{socialLinks.length === 0 ? <p className="text-sm text-slate-500">No social links yet.</p> : socialLinks.map((link) => <div className="summary-line gap-3" key={link.id}><span><strong>{socialPlatformLabels[link.platform] || readable(link.platform)}</strong><small className="block max-w-[220px] truncate text-slate-500">{link.enabled === false ? "Hidden" : "Visible"} - {link.url}</small></span><span className="flex flex-wrap gap-1"><button className="button-muted" type="button" onClick={() => updateSocialLink(link, { enabled: link.enabled === false }, link.enabled === false ? "Social link visible." : "Social link hidden.")} disabled={savingAction === `social:${link.id}:update`}>{link.enabled === false ? "Show" : "Hide"}</button><button className="button-muted" type="button" onClick={() => deleteSocialLink(link.id)} disabled={savingAction === `social:${link.id}:delete`}><Trash2 size={14} />Remove</button></span></div>)}</div>
            </div>
          </div>
          ) : null}
        </div>
        ) : null}
      </div>
      ) : null}
      {showSettingsSection("receipts-printing") ? (
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="panel" id="settings-receipts-printing">
          <h3 className="panel-title">Receipt and ticket printing</h3>
          {hasLock("PRINTING") ? <div className="mt-4"><UpgradeRequired feature="PRINTING" lock={lockFor("PRINTING")} /></div> : <>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input className="input" placeholder="Kitchen printer" value={printerSettings.kitchenPrinterName || ""} onChange={(event) => setPrinterSettings({ ...printerSettings, kitchenPrinterName: event.target.value })} />
            <input className="input" placeholder="Front counter printer" value={printerSettings.frontCounterPrinterName || ""} onChange={(event) => setPrinterSettings({ ...printerSettings, frontCounterPrinterName: event.target.value })} />
            <label className={`seg ${printerSettings.kitchenPrinterEnabled ? "active" : ""}`}><input type="checkbox" checked={!!printerSettings.kitchenPrinterEnabled} onChange={(event) => setPrinterSettings({ ...printerSettings, kitchenPrinterEnabled: event.target.checked })} />Kitchen printer</label>
            <label className={`seg ${printerSettings.frontCounterPrinterEnabled ? "active" : ""}`}><input type="checkbox" checked={!!printerSettings.frontCounterPrinterEnabled} onChange={(event) => setPrinterSettings({ ...printerSettings, frontCounterPrinterEnabled: event.target.checked })} />Counter printer</label>
            <label className={`seg ${printerSettings.autoPrintKitchenTickets ? "active" : ""}`}><input type="checkbox" checked={!!printerSettings.autoPrintKitchenTickets} onChange={(event) => setPrinterSettings({ ...printerSettings, autoPrintKitchenTickets: event.target.checked })} />Auto kitchen tickets</label>
            <label className={`seg ${printerSettings.autoPrintCustomerReceipts ? "active" : ""}`}><input type="checkbox" checked={!!printerSettings.autoPrintCustomerReceipts} onChange={(event) => setPrinterSettings({ ...printerSettings, autoPrintCustomerReceipts: event.target.checked })} />Auto receipts</label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="button-primary" onClick={() => savePrinterSettings()}><ReceiptText size={16} />Save printing</button>
            <button className="button-muted" onClick={printTestReceipt}>Print Test Receipt</button>
            {orders[0] ? <button className="button-muted" onClick={() => printOrderTicket(orders[0], "kitchen")}>Print Kitchen Ticket</button> : null}
            {orders[0] ? <button className="button-muted" onClick={() => printOrderTicket(orders[0], "receipt")}>Print Customer Receipt</button> : null}
          </div>
          <p className="mt-3 text-xs font-semibold text-slate-500">Provider: {printerSettings.provider || "browser_print"}. Star Micronics, Epson, and thermal printer integrations are ready as provider targets.</p>
          </>}
        </div>
      </div>
      ) : null}
      {(showSettingsSection("staff-roles") || isDriversPage) ? (
      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        {showSettingsSection("staff-roles") ? (
        <div className="panel" id="settings-staff-roles">
          <h3 className="panel-title">Employees</h3>
          {hasLock("EMPLOYEE_MANAGEMENT") ? <div className="mt-4"><UpgradeRequired feature="EMPLOYEE_MANAGEMENT" lock={lockFor("EMPLOYEE_MANAGEMENT")} /></div> : <>
          <form className="mt-4 form-grid" onSubmit={createEmployee}>
            <input className="input" placeholder="Name" value={employeeForm.name} onChange={(event) => setEmployeeForm({ ...employeeForm, name: event.target.value })} />
            <input className="input" placeholder="Email" value={employeeForm.email} onChange={(event) => setEmployeeForm({ ...employeeForm, email: event.target.value })} />
            <input className="input" placeholder="Phone" value={employeeForm.phone} onChange={(event) => setEmployeeForm({ ...employeeForm, phone: event.target.value })} />
            <select className="select" value={employeeForm.role} onChange={(event) => setEmployeeForm({ ...employeeForm, role: event.target.value })}>
              {["RESTAURANT_MANAGER", "CASHIER", "KITCHEN_STAFF", "DRIVER"].map((role) => <option value={role} key={role}>{readable(role)}</option>)}
            </select>
            <button className="button-primary md:col-span-2" type="submit"><UserCog size={16} />Add Employee</button>
          </form>
          <div className="mt-4 space-y-2">
            {employees.length === 0 ? <EmptyState title="No employees" detail="Managers, cashiers, kitchen staff, and drivers appear here." /> : employees.map((employee) => (
              <div className="menu-row" key={employee.id}>
                <div>
                  <p className="font-semibold text-ink">{employee.name}</p>
                  <p className="text-sm text-slate-500">{employee.email} - {readable(employee.role)}</p>
                  <p className="text-xs text-slate-500">{(employee.permissions || []).join(", ") || "Default role permissions"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={employee.status === "ACTIVE" && employee.active !== false ? "good" : "warn"}>{employee.status || (employee.active === false ? "SUSPENDED" : "ACTIVE")}</StatusPill>
                  <button className="button-muted" onClick={() => disableEmployee(employee)} disabled={employee.status === "SUSPENDED" || employee.active === false}>Disable</button>
                </div>
              </div>
            ))}
          </div>
          </>}
        </div>
        ) : null}
        {isDriversPage ? (
        <div className="panel" id="drivers">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <h3 className="panel-title">Driver Dispatch Center</h3>
              <p className="mt-2 text-sm text-slate-500">Live driver availability, active deliveries, tips, earnings, and assignment controls for this restaurant only.</p>
            </div>
            <StatusPill tone={dispatchSummary.schedulingStatus === "Setup Required" ? "warn" : "good"}>{dispatchSummary.schedulingStatus || "Dispatch active"}</StatusPill>
          </div>
          {hasLock("DRIVER_MANAGEMENT") ? <div className="mt-4"><UpgradeRequired feature="DRIVER_MANAGEMENT" lock={lockFor("DRIVER_MANAGEMENT")} /></div> : <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat icon={Truck} label="Available" value={integer(dispatchSummary.availableDrivers || dispatchWithDefaults.availableDrivers?.length || 0)} detail="Ready to assign" />
            <Stat icon={Activity} label="Busy" value={integer(dispatchSummary.busyDrivers || dispatchWithDefaults.busyDrivers?.length || 0)} detail="On delivery" />
            <Stat icon={Clock} label="Offline" value={integer(dispatchSummary.offlineDrivers || dispatchWithDefaults.offlineDrivers?.length || 0)} detail="Unavailable" />
            <Stat icon={CreditCard} label="Tips" value={money(dispatchSummary.driverTipsCents)} detail={`${integer(dispatchSummary.completedDeliveries || 0)} completed`} />
          </div>
          <div className="driver-dispatch-grid mt-5">
            <div>
              <div className="flex items-center justify-between gap-3">
                <h4 className="font-bold text-ink">Driver roster</h4>
                <span className="text-sm font-bold text-slate-500">{integer(driverRoster.length)} drivers</span>
              </div>
              <div className="driver-roster mt-3">
                {driverRoster.length === 0 ? <EmptyState title="No drivers" detail="Add drivers before assigning delivery orders." /> : driverRoster.map((driver) => (
                  <button className={`driver-roster-row ${selectedDriver?.id === driver.id ? "active" : ""}`} type="button" key={driver.id} onClick={() => setSelectedDriverId(driver.id)}>
                    <div>
                      <p className="font-black text-ink">{driver.name || driver.user?.name || driver.email || "Driver"}</p>
                      <p className="text-sm font-semibold text-slate-500">{driver.phone || driver.email || "Contact not set"}</p>
                    </div>
                    <StatusPill tone={driver.availabilityLabel === "Available" || driver.available ? "good" : driver.activeDeliveries?.length ? "warn" : "neutral"}>{driver.availabilityLabel || (driver.available ? "Available" : "Unavailable")}</StatusPill>
                    <div className="driver-roster-meta">
                      <span>{integer(driver.activeDeliveries?.length || 0)} active</span>
                      <span>{integer(driver.completedDeliveries || 0)} completed</span>
                      <span>{money(driver.tipsCents)} tips</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div className="driver-detail-panel">
              {!selectedDriver ? <EmptyState title="No driver selected" detail="Choose a driver to view dispatch performance." /> : (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-wide text-mint">Driver profile</p>
                      <h4 className="text-2xl font-black text-ink">{selectedDriver.name || selectedDriver.user?.name || "Driver"}</h4>
                      <p className="text-sm font-semibold text-slate-500">{selectedDriver.phone || selectedDriver.email || "Contact not set"}</p>
                    </div>
                    <StatusPill tone={selectedDriver.availabilityLabel === "Available" || selectedDriver.available ? "good" : selectedDriver.activeDeliveries?.length ? "warn" : "neutral"}>{selectedDriver.availabilityLabel || (selectedDriver.available ? "Available" : "Unavailable")}</StatusPill>
                  </div>
                  <div className="customer-detail-grid">
                    <div><span>Active deliveries</span><strong>{integer(selectedDriver.activeDeliveries?.length || 0)}</strong></div>
                    <div><span>Completed</span><strong>{integer(selectedDriver.completedDeliveries || 0)}</strong></div>
                    <div><span>Earnings</span><strong>{money(selectedDriver.earningsCents)}</strong></div>
                    <div><span>Tips</span><strong>{money(selectedDriver.tipsCents)}</strong></div>
                    <div><span>Average delivery</span><strong>{minutesText(selectedDriver.averageDeliveryMinutes)}</strong></div>
                    <div><span>Mileage</span><strong>{selectedDriver.distanceStatus || "Not Tracked"}</strong></div>
                  </div>
                  <div>
                    <h5 className="font-bold text-ink">Current active delivery</h5>
                    <div className="mt-2 space-y-2">
                      {(selectedDriver.activeDeliveries || []).length === 0 ? <EmptyState title="No active delivery" detail="Assigned delivery details appear here while the driver is busy." /> : selectedDriver.activeDeliveries.map((delivery) => (
                        <div className="summary-line rounded-md bg-white px-3 py-2" key={delivery.id}>
                          <span>#{delivery.orderNumber || delivery.orderId} - {delivery.customerName || "Customer"}</span>
                          <strong>{readable(delivery.status || "ASSIGNED")}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {(dispatchWithDefaults.deliveries || []).length === 0 ? <EmptyState title="No active deliveries" detail="Delivery orders waiting for assignment will appear here." /> : dispatchWithDefaults.deliveries.map((delivery) => (
              <div className="order-row" key={delivery.id}>
                <div>
                  <p className="font-bold text-ink">Delivery #{delivery.orderNumber || delivery.order?.orderNumber || delivery.id}</p>
                  <p className="text-sm text-slate-500">{delivery.customerName || delivery.order?.customer?.safeName || delivery.order?.customer?.name || "Customer"} - {readable(delivery.status)} - Tip {money(delivery.tipCents)}</p>
                  <p className="text-xs text-slate-500">Driver: {delivery.driverName || delivery.driver?.user?.name || "Unassigned"} · Pickup {delivery.pickupAddress || profile.address || "restaurant address"} · Dropoff {delivery.dropoffAddress || "customer address"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select className="select max-w-52" defaultValue={delivery.driverId || ""} onChange={(event) => assignDispatchDelivery(delivery, event.target.value)}>
                    <option value="">Assign driver</option>
                    {(dispatchWithDefaults.availableDrivers || []).map((driver) => <option value={driver.id} key={driver.id}>{driver.name || driver.user?.name || driver.id}</option>)}
                  </select>
                  <button className="button-muted" onClick={() => cancelDispatchAssignment(delivery)}>Cancel Assignment</button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs font-semibold text-slate-500">Driver SMS and push notifications are routed through provider-ready notification services. On-time rate and mileage remain not tracked until navigation telemetry is connected.</p>
          </>}
        </div>
        ) : null}
      </div>
      ) : null}
      {(showSettingsSection("delivery-zones") || showSettingsSection("inventory") || showSettingsSection("notifications")) ? (
      <div className="grid gap-5 xl:grid-cols-3">
        {showSettingsSection("delivery-zones") ? (
        <div className="panel" id="settings-delivery-zones">
          <h3 className="panel-title">Delivery Zones</h3>
          {hasLock("DELIVERY_ZONES") ? <div className="mt-4"><UpgradeRequired feature="DELIVERY_ZONES" lock={lockFor("DELIVERY_ZONES")} /></div> : <>
          <form className="mt-4 grid gap-2" onSubmit={createDeliveryZone}>
            <input className="input" placeholder="Zone name" value={zoneForm.name} onChange={(event) => setZoneForm({ ...zoneForm, name: event.target.value })} />
            <div className="grid gap-2 sm:grid-cols-3">
              <input className="input" type="number" placeholder="Radius miles" value={zoneForm.radiusMiles} onChange={(event) => setZoneForm({ ...zoneForm, radiusMiles: Number(event.target.value) })} />
              <input className="input" type="number" placeholder="Delivery fee cents" value={zoneForm.deliveryFeeCents} onChange={(event) => setZoneForm({ ...zoneForm, deliveryFeeCents: Number(event.target.value) })} />
              <input className="input" type="number" placeholder="Minimum cents" value={zoneForm.minimumOrderCents} onChange={(event) => setZoneForm({ ...zoneForm, minimumOrderCents: Number(event.target.value) })} />
            </div>
            <button className="button-primary" type="submit"><MapPin size={16} />Create Zone</button>
          </form>
          <div className="mt-4 space-y-2">
            {deliveryZones.length === 0 ? <EmptyState title="No delivery zones" detail="Create zones with radius, delivery fee, and minimum order." /> : deliveryZones.map((zone) => (
              <div className="summary-line rounded-md border border-line px-3 py-2" key={zone.id}>
                <span>{zone.name} - {zone.radiusMiles} mi - {money(zone.deliveryFeeCents)}</span>
                <button className="button-muted" onClick={() => disableDeliveryZone(zone)}>Disable</button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs font-semibold text-slate-500">Map drawing integration is reserved for a later provider pass.</p>
          </>}
        </div>
        ) : null}
        {showSettingsSection("inventory") ? (
        <div className="panel" id="settings-inventory">
          <h3 className="panel-title">Inventory Foundation</h3>
          {hasLock("INVENTORY") ? <div className="mt-4"><UpgradeRequired feature="INVENTORY" lock={lockFor("INVENTORY")} /></div> : <>
          <form className="mt-4 grid gap-2" onSubmit={createInventoryItem}>
            <input className="input" placeholder="Ingredient" value={inventoryForm.name} onChange={(event) => setInventoryForm({ ...inventoryForm, name: event.target.value })} />
            <div className="grid gap-2 sm:grid-cols-3">
              <input className="input" type="number" placeholder="Quantity" value={inventoryForm.quantity} onChange={(event) => setInventoryForm({ ...inventoryForm, quantity: Number(event.target.value) })} />
              <input className="input" placeholder="Unit" value={inventoryForm.unit} onChange={(event) => setInventoryForm({ ...inventoryForm, unit: event.target.value })} />
              <input className="input" type="number" placeholder="Cost cents" value={inventoryForm.costCents} onChange={(event) => setInventoryForm({ ...inventoryForm, costCents: Number(event.target.value) })} />
            </div>
            <button className="button-primary" type="submit"><PackageCheck size={16} />Add Ingredient</button>
          </form>
          <div className="mt-4 space-y-2">
            {inventoryItems.length === 0 ? <EmptyState title="No inventory items" detail="Track ingredients, stock levels, units, and cost." /> : inventoryItems.map((item) => (
              <div className="summary-line rounded-md border border-line px-3 py-2" key={item.id}>
                <span>{item.name} - {item.quantity} {item.unit}</span>
                <button className="button-muted" onClick={() => updateInventoryItem(item, { active: false })}>Disable</button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs font-semibold text-slate-500">Automatic depletion from orders is a future inventory phase.</p>
          </>}
        </div>
        ) : null}
        {showSettingsSection("notifications") ? (
        <div className="panel" id="settings-notifications">
          <h3 className="panel-title">Notifications</h3>
          {hasLock("NOTIFICATIONS") ? <div className="mt-4"><UpgradeRequired feature="NOTIFICATIONS" lock={lockFor("NOTIFICATIONS")} /></div> : <>
          <div className="mt-4 grid gap-2">
            {[
              ["smsEnabled", "SMS enabled"],
              ["emailEnabled", "Email enabled"],
              ["orderConfirmedSms", "Order confirmed SMS"],
              ["orderReadySms", "Order ready SMS"],
              ["outForDeliverySms", "Out for delivery SMS"],
              ["deliveredSms", "Delivered SMS"],
              ["orderConfirmationEmail", "Order confirmation email"],
              ["receiptEmail", "Receipt email"],
              ["passwordResetEmail", "Password reset email"],
              ["welcomeEmail", "Welcome email"]
            ].map(([key, label]) => (
              <label className={`seg justify-between ${notificationSettings[key] ? "active" : ""}`} key={key}>
                <input type="checkbox" checked={!!notificationSettings[key]} onChange={(event) => setNotificationSettings({ ...notificationSettings, [key]: event.target.checked })} />
                {label}
              </label>
            ))}
          </div>
          <button className="button-primary mt-4" onClick={() => saveNotificationSettings()}><Activity size={16} />Save Notifications</button>
          <p className="mt-3 text-xs font-semibold text-slate-500">Twilio-ready SMS and provider-based email are wired through backend abstractions.</p>
          </>}
        </div>
        ) : null}
      </div>
      ) : null}
      {isReportsPage ? (
      <div className="panel" id="reports">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
          <div>
            <h3 className="panel-title">Advanced reporting</h3>
            <p className="mt-2 text-sm text-slate-500">Sales, customer, menu, and driver metrics for day-to-day restaurant operations.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select className="select max-w-40" value={reportRange} onChange={(event) => setReportRange(event.target.value)}>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="ytd">Year to date</option>
              <option value="all">All time</option>
            </select>
            <button className="button-muted" onClick={() => loadRestaurant({ force: true })}><RefreshCw size={16} />Refresh Reports</button>
          </div>
        </div>
        {hasLock("REPORTS") ? <div className="mt-4"><UpgradeRequired feature="REPORTS" lock={lockFor("REPORTS")} /></div> : <>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Stat icon={CreditCard} label="Gross sales" value={money(reportSales.grossSalesCents)} detail={operationsWithDefaults.range?.label || "Selected range"} />
          <Stat icon={ReceiptText} label="Net sales" value={money(reportSales.netSalesCents)} detail={`${integer(reportSales.paidOrders || 0)} paid orders`} />
          <Stat icon={TicketPercent} label="Average order" value={money(reportSales.averageOrderValueCents)} detail={`${integer(reportSales.totalOrders || 0)} total orders`} />
          <Stat icon={Truck} label="Delivery sales" value={money(reportSales.deliveryFeesCents)} detail={`${integer(reportSales.deliveryOrders || 0)} delivery orders`} />
          <Stat icon={CreditCard} label="Daily sales" value={money(operationsReport.sales?.dailySalesCents)} detail="Today" />
          <Stat icon={ReceiptText} label="Weekly sales" value={money(operationsReport.sales?.weeklySalesCents)} detail="This week" />
          <Stat icon={TicketPercent} label="Monthly sales" value={money(operationsReport.sales?.monthlySalesCents)} detail="This month" />
          <Stat icon={Activity} label="Driver tips" value={money(reportSales.driverTipsCents)} detail={`${money(reportSales.refundsCents)} refunds`} />
        </div>
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <MetricBarList title="Sales trend" description="Net sales by day or month." rows={reportCharts.salesTrend || []} labelKey="date" valueKey="netSalesCents" valueFormatter={money} emptyTitle="No paid sales in this range" />
          <MetricBarList title="Orders trend" description="Paid order count over time." rows={reportCharts.ordersTrend || []} labelKey="date" valueKey="orders" emptyTitle="No orders in this range" />
          <MetricBarList title="Customer growth" description="New customers created during the selected range." rows={reportCharts.customerGrowth || []} labelKey="date" valueKey="customers" emptyTitle="No new customer records in this range" />
          <MetricBarList title="Driver performance" description="Completed deliveries by driver." rows={reportCharts.driverPerformance || []} labelKey="name" valueKey="deliveries" emptyTitle="No completed deliveries in this range" />
        </div>
        <div className="mt-5 grid gap-5 xl:grid-cols-3">
          <div className="rounded-md border border-line bg-slate-50 p-4">
            <h4 className="font-bold text-ink">Top selling items</h4>
            <div className="mt-2 space-y-2">{(operationsWithDefaults.items?.topSellingItems || []).length === 0 ? <p className="text-sm text-slate-500">No sales yet.</p> : operationsWithDefaults.items.topSellingItems.slice(0, 5).map((item) => <div className="summary-line rounded-md bg-white px-3" key={item.id || item.name}><span>{item.name}</span><strong>{integer(item.quantity)} sold · {money(item.revenueCents)}</strong></div>)}</div>
          </div>
          <div className="rounded-md border border-line bg-slate-50 p-4">
            <h4 className="font-bold text-ink">Customer metrics</h4>
            <div className="mt-2 space-y-2">
              <div className="summary-line rounded-md bg-white px-3"><span>Total customers</span><strong>{integer(operationsWithDefaults.customers?.totalCustomers || 0)}</strong></div>
              <div className="summary-line rounded-md bg-white px-3"><span>New in range</span><strong>{integer(operationsWithDefaults.customers?.newCustomersInRange || 0)}</strong></div>
              <div className="summary-line rounded-md bg-white px-3"><span>Returning customers</span><strong>{integer(operationsWithDefaults.customers?.returningCustomers || 0)}</strong></div>
              <div className="summary-line rounded-md bg-white px-3"><span>VIP customers</span><strong>{integer(operationsWithDefaults.customers?.vipCustomerCount || 0)}</strong></div>
            </div>
          </div>
          <div className="rounded-md border border-line bg-slate-50 p-4">
            <h4 className="font-bold text-ink">Driver metrics</h4>
            <div className="mt-2 space-y-2">{(operationsWithDefaults.drivers || []).length === 0 ? <p className="text-sm text-slate-500">No driver history yet.</p> : operationsWithDefaults.drivers.slice(0, 5).map((driver) => <div className="summary-line rounded-md bg-white px-3" key={driver.id || driver.driverId || driver.name}><span>{driver.name}</span><strong>{integer(driver.completedDeliveries || driver.deliveries || 0)} · {money(driver.tipsCents)} tips</strong></div>)}</div>
            <p className="mt-3 text-xs font-semibold text-slate-500">Mileage and on-time rate show as not tracked until the mobile navigation telemetry phase is connected.</p>
          </div>
        </div>
        </>}
      </div>
      ) : null}
      {isSettingsPage ? (
        <div className="grid gap-5 xl:grid-cols-2" id="settings">
        {isSettingsCenterPage ? (
        <div className="panel xl:col-span-2">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <h3 className="panel-title">Settings center</h3>
              <p className="mt-2 text-sm text-slate-500">Configuration and editing tools live here, keeping the top navigation focused on daily restaurant operations.</p>
            </div>
            <a className="button-muted" href={publicPreviewPath} target="_blank" rel="noreferrer"><Store size={16} />Preview website</a>
          </div>
          <div className="mt-5 grid gap-4">
            {settingsCenterGroups.map((group) => (
              <section className="settings-group" key={group.id}>
                <div className="settings-group-title">
                  <span>{group.label}</span>
                  <small>{integer(group.items.length)} sections</small>
                </div>
                <div className="settings-group-grid">
                  {group.items.map((item) => (
                    <a className={`rounded-md border p-4 transition hover:border-mint hover:shadow-soft ${item.selected ? "border-mint bg-mint/5 shadow-soft" : "border-line bg-white"}`} href={item.href} key={item.id}>
                      <StatusPill tone={settingsStatusTone(item.status)}>{settingsStatusLabel(item.status)}</StatusPill>
                      <strong className="mt-2 block text-lg text-ink">{item.label}</strong>
                      <span className="mt-1 block text-sm text-slate-500">{item.detail}</span>
                    </a>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
        ) : null}
        {showSettingsSection("account") ? (
        <div className="panel" id="settings-account">
          <h3 className="panel-title">Account</h3>
          <p className="mt-2 text-sm text-slate-500">Owner login, profile, password recovery, and session access stay separate from the platform owner console.</p>
          <div className="mt-4 grid gap-2 text-sm text-slate-600">
            <div className="summary-line"><span>Signed in as</span><strong>{user?.email || "Restaurant owner"}</strong></div>
            <div className="summary-line"><span>Role</span><strong>{readable(user?.role || "TENANT_OWNER")}</strong></div>
          </div>
        </div>
        ) : null}
        {showSettingsSection("restaurant-profile") ? (
        <div className="panel" id="settings-restaurant-profile">
          <h3 className="panel-title">Restaurant profile</h3>
          <p className="mt-2 text-sm text-slate-500">Business name, public contact details, address, and restaurant identity are edited in Website & Branding and saved to the live restaurant profile.</p>
          <div className="mt-4 grid gap-2 text-sm text-slate-600">
            <div className="summary-line"><span>Restaurant</span><strong>{profile.businessName || profile.name || "Restaurant"}</strong></div>
            <div className="summary-line"><span>Phone</span><strong>{profile.phone || "Not set"}</strong></div>
            <div className="summary-line"><span>Location</span><strong>{[profile.city, profile.state].filter(Boolean).join(", ") || "Not set"}</strong></div>
          </div>
          <a className="button-primary mt-4" href={restaurantSettingPath(restaurantBasePath, "website-branding")}><Store size={16} />Edit profile</a>
        </div>
        ) : null}
        {showSettingsSection("business-hours") ? (
        <div className="panel" id="settings-business-hours">
          <h3 className="panel-title">Business Hours</h3>
          <p className="mt-2 text-sm text-slate-500">Public website hours are stored on the tenant website settings record and shown across ordering surfaces.</p>
          <div className="mt-4 space-y-2 text-sm text-slate-600">
            {settingsStoreHours.length === 0 ? <EmptyState title="No hours configured" detail="Add store hours in Website & Branding before public launch." /> : settingsStoreHours.map(([day, hours]) => (
              <div className="summary-line rounded-md bg-slate-50 px-3" key={day}>
                <span>{readable(day)}</span>
                <strong>{Array.isArray(hours) ? hours.join(", ") : String(hours || "Closed")}</strong>
              </div>
            ))}
          </div>
          <a className="button-muted mt-4" href={restaurantSettingPath(restaurantBasePath, "website-branding")}><Clock size={16} />Edit website hours</a>
        </div>
        ) : null}
        {showSettingsSection("ordering") ? (
        <div className="panel" id="settings-ordering">
          <h3 className="panel-title">Ordering</h3>
          <p className="mt-2 text-sm text-slate-500">Pickup, delivery, order readiness, and kitchen workflow state are read from the live restaurant tenant.</p>
          <div className="mt-4 grid gap-2 text-sm text-slate-600">
            <div className="summary-line"><span>Ordering module</span><strong>{orderingModuleEnabled ? "Enabled" : "Tenant controlled"}</strong></div>
            <div className="summary-line"><span>Pickup</span><strong>{profile.pickupEnabled === false ? "Disabled" : "Enabled"}</strong></div>
            <div className="summary-line"><span>Delivery</span><strong>{profile.deliveryEnabled === false ? "Disabled" : "Enabled"}</strong></div>
            <div className="summary-line"><span>Kitchen workflow</span><strong>{kitchenDisplayLock ? "Upgrade required" : "Available"}</strong></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusPill tone="neutral">Read only</StatusPill>
            <a className="button-muted" href={`${restaurantBasePath}/orders`}><ReceiptText size={16} />Open orders</a>
          </div>
        </div>
        ) : null}
        {showSettingsSection("restaurant-profile") ? (
        <div className="panel" id="settings-restaurants-ownership">
          <h3 className="panel-title">Restaurants & Ownership</h3>
          <p className="mt-2 text-sm text-slate-500">This account opens only the assigned restaurant tenant. Platform-owner controls remain in the Master Admin portal.</p>
          <div className="mt-4 grid gap-2 text-sm text-slate-600">
            <div className="summary-line"><span>Assigned restaurant</span><strong>{profile.businessName || profile.name || "Restaurant"}</strong></div>
            <div className="summary-line"><span>Slug</span><strong>{profile.slug || user?.restaurantSlug || "Not set"}</strong></div>
          </div>
        </div>
        ) : null}
        {showSettingsSection("locations") ? (
        <div className="panel" id="settings-locations">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <h3 className="panel-title">Locations</h3>
              <p className="mt-2 text-sm text-slate-500">Edit the live restaurant location record. Saving the primary location also updates the restaurant profile used by public pages and operations screens.</p>
            </div>
            <StatusPill tone={locations.length ? "good" : "warn"}>{locations.length ? `${integer(locations.length)} location${locations.length === 1 ? "" : "s"}` : "Setup required"}</StatusPill>
          </div>
          <div className="mt-4 grid gap-4">
            {locations.length === 0 ? <EmptyState title="No location records" detail="Refresh while the API is online to create the primary restaurant location from the tenant profile." /> : locations.map((location) => {
              const draft = locationDrafts[location.id] || locationDraftFrom(location, profile);
              return (
                <div className="location-editor" key={location.id || location.name}>
                  <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
                    <div>
                      <h4 className="font-black text-ink">{draft.name || location.name || profile.businessName || profile.name || "Restaurant location"}</h4>
                      <p className="text-sm font-semibold text-slate-500">{[draft.address, draft.city, draft.state, draft.zip].filter(Boolean).join(", ") || "Address not set"}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill tone={draft.active ? "good" : "neutral"}>{draft.active ? "Active" : "Inactive"}</StatusPill>
                      {draft.primary ? <StatusPill tone="good">Primary</StatusPill> : null}
                    </div>
                  </div>
                  <div className="location-editor-grid mt-4">
                    <label className="text-sm font-semibold text-slate-600">Location name
                      <input className="input mt-1" value={draft.name || ""} onChange={(event) => updateLocationDraft(location, { name: event.target.value })} />
                    </label>
                    <label className="text-sm font-semibold text-slate-600">Phone
                      <input className="input mt-1" value={draft.phone || ""} onChange={(event) => updateLocationDraft(location, { phone: event.target.value })} />
                    </label>
                    <label className="text-sm font-semibold text-slate-600 md:col-span-2">Address
                      <input className="input mt-1" value={draft.address || ""} onChange={(event) => updateLocationDraft(location, { address: event.target.value })} />
                    </label>
                    <label className="text-sm font-semibold text-slate-600 md:col-span-2">Address 2
                      <input className="input mt-1" value={draft.address2 || ""} onChange={(event) => updateLocationDraft(location, { address2: event.target.value })} />
                    </label>
                    <label className="text-sm font-semibold text-slate-600">City
                      <input className="input mt-1" value={draft.city || ""} onChange={(event) => updateLocationDraft(location, { city: event.target.value })} />
                    </label>
                    <label className="text-sm font-semibold text-slate-600">State
                      <input className="input mt-1" value={draft.state || ""} onChange={(event) => updateLocationDraft(location, { state: event.target.value })} />
                    </label>
                    <label className="text-sm font-semibold text-slate-600">ZIP
                      <input className="input mt-1" value={draft.zip || ""} onChange={(event) => updateLocationDraft(location, { zip: event.target.value })} />
                    </label>
                    <label className="text-sm font-semibold text-slate-600">Country
                      <input className="input mt-1" value={draft.country || "US"} onChange={(event) => updateLocationDraft(location, { country: event.target.value })} />
                    </label>
                    <label className="text-sm font-semibold text-slate-600 md:col-span-2">Timezone
                      <input className="input mt-1" value={draft.timezone || "America/Denver"} onChange={(event) => updateLocationDraft(location, { timezone: event.target.value })} />
                    </label>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <label className={`seg ${draft.active ? "active" : ""}`}><input type="checkbox" checked={!!draft.active} onChange={(event) => updateLocationDraft(location, { active: event.target.checked })} />Active location</label>
                    <label className={`seg ${draft.primary ? "active" : ""}`}><input type="checkbox" checked={!!draft.primary} onChange={(event) => updateLocationDraft(location, { primary: event.target.checked })} />Primary location</label>
                    <button className="button-primary" type="button" onClick={() => saveLocation(location)} disabled={savingLocationId === location.id}><CheckCircle2 size={16} />{savingLocationId === location.id ? "Saving..." : "Save Location"}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        ) : null}
        {showSettingsSection("payments") ? (
        <div className="panel" id="settings-payments">
          <h3 className="panel-title">Payments</h3>
          <p className="mt-2 text-sm text-slate-500">Restaurant payment provider onboarding and payout readiness are managed through the secure onboarding flow.</p>
          <a className="button-primary mt-4" href={`${restaurantBasePath}/onboarding#payments`}><CreditCard size={16} />Open payment setup</a>
        </div>
        ) : null}
        {showSettingsSection("billing-subscription") ? (
        <>
        <div className="panel" id="settings-billing-subscription">
          <h3 className="panel-title">Billing & Subscription</h3>
          <p className="mt-2 text-sm text-slate-500">Subscription plan and account billing state are enforced server-side by Loohar entitlements.</p>
          <div className="mt-4 space-y-2 text-sm text-slate-600">
            <div className="summary-line"><span>Plan</span><strong>{readable(entitlementSummary.planCode || "STARTER")}</strong></div>
            <div className="summary-line"><span>Status</span><strong>{readable(entitlementSummary.subscriptionStatus || "ACTIVE")}</strong></div>
          </div>
        </div>
        <DevelopmentEntitlementSimulator apiOnline={apiOnline} token={token} restaurantKey={profile.slug || restaurantId} />
        </>
        ) : null}
        {showSettingsSection("pos-kiosk") ? (
        <div className="panel" id="settings-pos-kiosk">
          <h3 className="panel-title">POS & Kiosk</h3>
          <p className="mt-2 text-sm text-slate-500">Register devices, shifts, cash controls, card payment flow, and kiosk mode are managed in the POS workspace.</p>
          <div className="mt-4 grid gap-2 text-sm text-slate-600">
            <div className="summary-line"><span>POS register</span><strong>{hasLock("POS_REGISTER") ? "Upgrade required" : "Available"}</strong></div>
            <div className="summary-line"><span>Kiosk mode</span><strong>{hasLock("POS_KIOSK_MODE") ? "Plan restricted" : "Available"}</strong></div>
            <div className="summary-line"><span>Payments</span><strong>{hasLock("ORDER_PAYMENTS") ? "Setup required" : "Ready to configure"}</strong></div>
          </div>
          <a className="button-primary mt-4" href={`${restaurantBasePath}/pos`}><CreditCard size={16} />Open POS</a>
        </div>
        ) : null}
        {showSettingsSection("integrations") ? (
        <div className="panel" id="settings-integrations">
          <h3 className="panel-title">Integrations</h3>
          <p className="mt-2 text-sm text-slate-500">Delivery, accounting, marketing, and external POS integrations are intentionally not editable until provider-specific connections are implemented.</p>
          <div className="mt-4 grid gap-2">
            <StatusPill tone="warn">Coming soon</StatusPill>
            <StatusPill tone="neutral">No external providers connected</StatusPill>
          </div>
        </div>
        ) : null}
        {showSettingsSection("security-audit") ? (
        <div className="panel" id="settings-security-audit">
          <h3 className="panel-title">Security & Audit Logs</h3>
          <p className="mt-2 text-sm text-slate-500">Password policy, role-based access, session checks, and audit logging protect tenant operations.</p>
          <div className="mt-4 grid gap-2">
            <StatusPill tone="good">RBAC active</StatusPill>
            <StatusPill tone="good">Tenant isolation active</StatusPill>
            <StatusPill tone="neutral">Audit logs retained</StatusPill>
          </div>
        </div>
        ) : null}
        {showSettingsSection("developer-api") ? (
        <div className="panel" id="settings-developer-api">
          <h3 className="panel-title">Developer/API</h3>
          <p className="mt-2 text-sm text-slate-500">API keys, webhook delivery logs, and developer docs are planned for a future release. Nothing is exposed until the backend key management flow is implemented.</p>
          <div className="mt-4 grid gap-2">
            <StatusPill tone="warn">Coming soon</StatusPill>
            <StatusPill tone="neutral">No API keys issued</StatusPill>
          </div>
        </div>
        ) : null}
        </div>
      ) : null}
      </div>
    </RestaurantPageComponent>
  );
}

function DevelopmentEntitlementSimulator({ apiOnline, token, restaurantKey }) {
  const [state, setState] = useState({ loading: true, available: false, payload: null, error: "" });
  const [saving, setSaving] = useState("");

  async function loadSimulation() {
    if (!apiOnline || !token || !restaurantKey) return setState({ loading: false, available: false, payload: null, error: "" });
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const payload = await api(`/api/restaurants/${restaurantKey}/entitlements/simulation`, { token });
      setState({ loading: false, available: true, payload, error: "" });
    } catch (simulationError) {
      const code = simulationError?.payload?.code || "";
      if (simulationError?.status === 403 || code === "ENTITLEMENT_SIMULATION_NOT_AVAILABLE") {
        setState({ loading: false, available: false, payload: null, error: "" });
        return;
      }
      setState({ loading: false, available: false, payload: null, error: simulationError.message || "Could not load entitlement simulation." });
    }
  }

  useEffect(() => {
    loadSimulation();
  }, [apiOnline, token, restaurantKey]);

  async function applySimulation(label, body) {
    setSaving(label);
    setState((current) => ({ ...current, error: "" }));
    try {
      const payload = await api(`/api/restaurants/${restaurantKey}/entitlements/simulation`, { method: "PATCH", token, body });
      setState((current) => ({ ...current, available: true, payload: { ...(current.payload || {}), ...payload }, error: "" }));
    } catch (simulationError) {
      setState((current) => ({ ...current, error: simulationError.message || "Could not update entitlement simulation." }));
    } finally {
      setSaving("");
    }
  }

  if (state.loading) return null;
  if (!state.available) return state.error ? <InlineError message={state.error} /> : null;
  const entitlement = state.payload?.entitlements || {};
  const simulation = state.payload?.simulation || {};
  const actions = [
    { label: "Full access", body: { enabled: true, mode: "FULL_ACCESS" } },
    { label: "Starter", body: { enabled: true, mode: "SIMULATE_PLAN", simulatedPlan: "STARTER" } },
    { label: "Professional", body: { enabled: true, mode: "SIMULATE_PLAN", simulatedPlan: "PROFESSIONAL" } },
    { label: "Enterprise", body: { enabled: true, mode: "SIMULATE_PLAN", simulatedPlan: "ENTERPRISE" } },
    { label: "Past due", body: { enabled: true, mode: "SIMULATE_PAST_DUE" } },
    { label: "Suspended", body: { enabled: true, mode: "SIMULATE_SUSPENDED" } },
    { label: "Cancelled", body: { enabled: true, mode: "SIMULATE_CANCELLED" } },
    { label: "Disable simulation", body: { enabled: false, mode: "SIMULATE_PLAN", simulatedPlan: entitlement.actualPlanCode || "STARTER" } }
  ];

  return (
    <div className="panel" id="settings-development-entitlements">
      <h3 className="panel-title">Development entitlement simulator</h3>
      <p className="mt-2 text-sm text-slate-500">Internal/private-beta controls for testing plan restrictions. Real Stripe subscriptions, billing, payments, and payout records are not changed.</p>
      {state.error ? <InlineError message={state.error} /> : null}
      <div className="mt-4 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
        <div className="summary-line"><span>Effective plan</span><strong>{readable(entitlement.planCode || "STARTER")}</strong></div>
        <div className="summary-line"><span>Effective status</span><strong>{readable(entitlement.subscriptionStatus || "ACTIVE")}</strong></div>
        <div className="summary-line"><span>Actual plan</span><strong>{readable(entitlement.actualPlanCode || entitlement.planCode || "STARTER")}</strong></div>
        <div className="summary-line"><span>Actual status</span><strong>{readable(entitlement.actualSubscriptionStatus || entitlement.subscriptionStatus || "ACTIVE")}</strong></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <StatusPill tone={simulation.active ? "good" : "neutral"}>{simulation.active ? readable(simulation.mode) : "Actual billing"}</StatusPill>
        {entitlement.fullAccess ? <StatusPill tone="good">Full access</StatusPill> : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {actions.map((action) => (
          <button className="button-muted" type="button" key={action.label} disabled={Boolean(saving)} onClick={() => applySimulation(action.label, action.body)}>
            {saving === action.label ? "Saving..." : action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function KitchenApp({ apiOnline, token, user, initialSlug = "" }) {
  const routeSlug = initialSlug || (window.location.pathname.startsWith("/kitchen/") ? window.location.pathname.split("/")[2] : "");
  const demoKitchenOrders = demoOrders
    .filter((order) => !["DELIVERED", "CANCELLED"].includes(order.status))
    .map((order, index) => ({
      ...order,
      kdsStatus: kdsStatusFor(order.status),
      elapsedSeconds: 180 + index * 420,
      items: demoRestaurant.categories[index]?.items?.slice(0, 2).map((item, itemIndex) => ({
        id: `${order.id}-${item.id}`,
        name: item.name,
        quantity: itemIndex + 1,
        optionsJson: item.options?.slice(0, 2) || [],
        specialInstructions: itemIndex === 0 ? "Sauce on the side" : ""
      })) || []
    }));
  const [restaurant, setRestaurant] = useState(demoRestaurant);
  const [orders, setOrders] = useState(demoKitchenOrders);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const activeOrders = orders.filter((order) => !["COMPLETED", "CANCELLED"].includes(order.kdsStatus || kdsStatusFor(order.status)));
  const completedOrders = orders.filter((order) => ["COMPLETED", "CANCELLED"].includes(order.kdsStatus || kdsStatusFor(order.status)));
  function kitchenActionsFor(order) {
    return [
      ["ACCEPTED", "Accept Order"],
      ["PREPARING", "Start Preparing"],
      ["READY", order.type === "DELIVERY" ? "Ready For Delivery" : "Ready For Pickup"],
      ["COMPLETED", "Complete Order"]
    ];
  }

  async function loadKitchen() {
    if (!apiOnline) {
      setRestaurant(demoRestaurant);
      setOrders(demoKitchenOrders);
      return;
    }
    if (!token) {
      setOrders([]);
      setError("Kitchen staff, cashier, manager, or owner login is required.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = await api(routeSlug ? `/api/kitchen/${routeSlug}/orders` : "/api/kitchen/orders", { token });
      setRestaurant(payload.restaurant || demoRestaurant);
      setOrders(payload.orders || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadKitchen();
  }, [apiOnline, token, routeSlug]);

  useEffect(() => {
    if (!apiOnline || !restaurant?.id) return undefined;
    const socket = io(API_ORIGIN, { transports: ["websocket", "polling"] });
    const refresh = () => loadKitchen();
    socket.on("connect", () => {
      socket.emit("join:kitchen", restaurant.id);
      socket.emit("join:restaurant", restaurant.id);
    });
    socket.on("kitchen:update", refresh);
    socket.on("order:update", refresh);
    return () => socket.disconnect();
  }, [apiOnline, restaurant?.id, token, routeSlug]);

  async function updateKitchenOrder(order, status) {
    if (!apiOnline) {
      return setOrders((current) => current.map((item) => item.id === order.id ? { ...item, kdsStatus: status, status: status === "COMPLETED" ? "DELIVERED" : status } : item));
    }
    try {
      const path = routeSlug ? `/api/kitchen/${routeSlug}/orders/${order.id}/status` : `/api/kitchen/orders/${order.id}/status`;
      const payload = await api(path, { method: "PATCH", token, body: { status } });
      setOrders((current) => current.map((item) => item.id === order.id ? payload.order : item));
      await loadKitchen();
    } catch (statusError) {
      setError(statusError.message);
    }
  }

  function itemModifiers(item) {
    const modifiers = Array.isArray(item.optionsJson) ? item.optionsJson : item.options || [];
    return modifiers.map((modifier) => modifier.group ? `${modifier.group}: ${modifier.name}` : modifier.name).filter(Boolean).join(" / ");
  }

  return (
    <div className="kds-shell" id="kitchen">
      <SectionHeader eyebrow="Kitchen Display System" title={restaurant.businessName || restaurant.name || "Kitchen"} icon={ReceiptText} action={<button className="button-muted" onClick={loadKitchen}><RefreshCw size={18} />{loading ? "Loading" : "Refresh"}</button>} />
      <InlineError message={error} />
      <div className="grid gap-4 md:grid-cols-4" id="kitchen-summary">
        <Stat icon={ReceiptText} label="Incoming" value={orders.filter((order) => (order.kdsStatus || kdsStatusFor(order.status)) === "NEW").length} detail="New orders" />
        <Stat icon={Activity} label="Preparing" value={orders.filter((order) => (order.kdsStatus || kdsStatusFor(order.status)) === "PREPARING").length} detail="Kitchen queue" />
        <Stat icon={PackageCheck} label="Ready" value={orders.filter((order) => (order.kdsStatus || kdsStatusFor(order.status)) === "READY").length} detail="Pickup or delivery" />
        <Stat icon={CheckCircle2} label="Completed" value={completedOrders.length} detail="This screen session" />
      </div>
      {loading ? <EmptyState title="Loading kitchen queue" detail="Fetching active orders from the live API." /> : null}
      {!loading && activeOrders.length === 0 ? <EmptyState title="No active kitchen orders" detail={apiOnline ? "Incoming orders will appear here without the restaurant team refreshing the page." : "Offline demo mode has no active kitchen queue right now."} /> : null}
      <div className="kds-grid">
        {activeOrders.map((order) => {
          const kdsStatus = order.kdsStatus || kdsStatusFor(order.status);
          return (
            <article className={`kds-card ${kdsStatus.toLowerCase()}`} key={order.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black uppercase tracking-wide text-slate-500">#{order.orderNumber}</p>
                  <h3>{order.customer?.name || "Customer"}</h3>
                  <p>{order.type} - {order.deliveryAddress || "Pickup at counter"}</p>
                </div>
                <div className="text-right">
                  <StatusPill tone={kdsStatus === "READY" ? "warn" : kdsStatus === "NEW" ? "bad" : "neutral"}>{kdsStatus}</StatusPill>
                  <p className="mt-2 text-sm font-black text-ink">{elapsedLabel(order.elapsedSeconds)}</p>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {(order.items || []).length === 0 ? <EmptyState title="No item detail" detail="Order item details load with live kitchen orders." /> : order.items.map((item) => (
                  <div className="kds-item" key={item.id}>
                    <div className="flex items-start justify-between gap-3">
                      <strong>{item.quantity}x {item.name}</strong>
                      {item.specialInstructions ? <StatusPill tone="warn">Note</StatusPill> : null}
                    </div>
                    {itemModifiers(item) ? <p>{itemModifiers(item)}</p> : null}
                    {item.specialInstructions ? <p>Instruction: {item.specialInstructions}</p> : null}
                  </div>
                ))}
              </div>
              {order.notes ? <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm font-semibold text-amber-900">{order.notes}</p> : null}
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {kitchenActionsFor(order).map(([status, label], index) => (
                  <button className={`kds-action ${kdsStatus === status ? "active" : ""}`} key={`${status}-${index}`} onClick={() => updateKitchenOrder(order, status)}>
                    {label}
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      {completedOrders.length > 0 ? (
        <div className="panel">
          <h3 className="panel-title">Completed tickets</h3>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {completedOrders.slice(0, 6).map((order) => <div className="summary-line rounded-md bg-slate-50 px-3" key={order.id}><span>#{order.orderNumber}</span><strong>{order.customer?.name || "Customer"}</strong></div>)}
          </div>
        </div>
      ) : null}
      {user?.role ? <p className="text-sm font-semibold text-slate-500">Signed in as {user.role.replaceAll("_", " ")}.</p> : null}
    </div>
  );
}

function CustomerApp({ apiOnline, token, user, initialSlug = "demo-bistro", embedded = false }) {
  const [slug, setSlug] = useState(initialSlug);
  const [restaurant, setRestaurant] = useState(() => apiOnline ? emptyPublicRestaurant(initialSlug) : demoRestaurant);
  const [orderingEnabled, setOrderingEnabled] = useState(true);
  const [storefrontPlaceholder, setStorefrontPlaceholder] = useState(null);
  const [cart, setCart] = useState([]);
  const [serviceType, setServiceType] = useState("DELIVERY");
  const [customer, setCustomer] = useState({ name: "Maya Chen", email: "customer@demo.local", phone: "555-0166", deliveryAddress: "2425 Market St, Denver, CO" });
  const [orderStatus, setOrderStatus] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [paymentClientSecret, setPaymentClientSecret] = useState("");
  const [paymentPublicKey, setPaymentPublicKey] = useState("");
  const [paymentElementReady, setPaymentElementReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const stripeRef = useRef(null);
  const stripeElementsRef = useRef(null);
  const stripeElementMountRef = useRef(null);
  const [couponCode, setCouponCode] = useState("");
  const [restaurantTipChoice, setRestaurantTipChoice] = useState("10");
  const [driverTipChoice, setDriverTipChoice] = useState("15");
  const [customRestaurantTip, setCustomRestaurantTip] = useState("");
  const [customDriverTip, setCustomDriverTip] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedOptions, setSelectedOptions] = useState({});
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [history, setHistory] = useState([]);
  const [loyaltyPrograms, setLoyaltyPrograms] = useState([]);
  const [error, setError] = useState("");
  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + (item.linePriceCents || item.priceCents) * item.quantity, 0), [cart]);
  const delivery = serviceType === "DELIVERY" ? restaurant.deliveryFeeCents || 0 : 0;
  const tax = Math.round(subtotal * 0.0825);
  const tipOptions = ["0", "10", "15", "20", "25", "CUSTOM"];
  const tipFromChoice = (choice, customValue) => {
    if (choice === "CUSTOM") return Math.max(0, Math.round(Number(customValue || 0) * 100));
    return Math.round(subtotal * (Number(choice || 0) / 100));
  };
  const restaurantTip = tipFromChoice(restaurantTipChoice, customRestaurantTip);
  const driverTip = serviceType === "DELIVERY" ? tipFromChoice(driverTipChoice, customDriverTip) : 0;
  const tip = restaurantTip + driverTip;
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const orderTotal = quote?.totalCents ?? subtotal + delivery + tax + tip;
  const displaySubtotal = quote?.subtotalCents ?? subtotal;
  const displayDiscount = quote?.discountCents || 0;
  const displayDelivery = quote?.deliveryFeeCents ?? delivery;
  const displayTax = quote?.taxCents ?? tax;
  const displayRestaurantTip = quote?.restaurantTipCents ?? restaurantTip;
  const displayDriverTip = quote?.driverTipCents ?? driverTip;
  const displayServiceFee = quote?.serviceFeeCents || 0;

  function orderPaymentBody(includeCustomer = false) {
    return {
      restaurantId: restaurant.id,
      customer: includeCustomer ? { name: customer.name, email: customer.email, phone: customer.phone } : undefined,
      type: serviceType,
      deliveryAddress: serviceType === "DELIVERY" ? customer.deliveryAddress : undefined,
      tipCents: tip,
      restaurantTipCents: restaurantTip,
      driverTipCents: driverTip,
      customTipCents: (restaurantTipChoice === "CUSTOM" ? restaurantTip : 0) + (driverTipChoice === "CUSTOM" ? driverTip : 0),
      tipPercentage: restaurantTipChoice !== "CUSTOM" ? Number(restaurantTipChoice) : undefined,
      tipType: restaurantTipChoice === "CUSTOM" || driverTipChoice === "CUSTOM" ? "CUSTOM" : tip > 0 ? "PERCENTAGE" : "NONE",
      couponCode: couponCode || undefined,
      items: cart.map((item) => ({ menuItemId: item.id, quantity: item.quantity, options: item.selectedModifiers || [] }))
    };
  }

  async function loadQuote() {
    if (!apiOnline || !orderingEnabled || cart.length === 0 || !restaurant.id) {
      setQuote(null);
      setQuoteError("");
      return;
    }
    setQuoteLoading(true);
    setQuoteError("");
    try {
      const payload = await api("/api/order-payments/quote", { method: "POST", body: orderPaymentBody(false) });
      setQuote(payload.quote || null);
    } catch (quoteLoadError) {
      setQuote(null);
      setQuoteError(quoteLoadError.message);
    } finally {
      setQuoteLoading(false);
    }
  }

  function loadStripeJs() {
    if (window.Stripe) return Promise.resolve(window.Stripe);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-loohar-stripe-js]");
      if (existing) {
        existing.addEventListener("load", () => resolve(window.Stripe), { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://js.stripe.com/v3/";
      script.async = true;
      script.dataset.looharStripeJs = "true";
      script.onload = () => resolve(window.Stripe);
      script.onerror = () => reject(new Error("Stripe.js could not be loaded."));
      document.head.appendChild(script);
    });
  }

  async function loadMenu(targetSlug = slug) {
    if (!targetSlug) {
      setRestaurant(emptyPublicRestaurant(""));
      setError("Restaurant ordering page not found.");
      return;
    }
    if (!apiOnline) {
      setRestaurant(demoWebsiteBundle(targetSlug).restaurant);
      setOrderingEnabled(true);
      setStorefrontPlaceholder(null);
      setPaymentClientSecret("");
      setPaymentPublicKey("");
      return;
    }
    setError("");
    setRestaurant(emptyPublicRestaurant(targetSlug));
    try {
      const payload = await api(`/api/customer/restaurants/${targetSlug}`);
      setRestaurant(normalizePublicRestaurant(payload, emptyPublicRestaurant(targetSlug)));
      setOrderingEnabled(payload.orderingEnabled ?? isOrderingBusiness(payload.restaurant?.businessType));
      setStorefrontPlaceholder(payload.moduleNotice || payload.placeholder || null);
      setCart([]);
      setPaymentClientSecret("");
      setPaymentPublicKey("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  async function loadHistory() {
    if (!apiOnline || !token || user?.role !== "CUSTOMER") return;
    try {
      const payload = await api("/api/customer/me/orders", { token });
      setHistory(payload.orders || []);
      const loyaltyPayload = await api("/api/customer/me/loyalty", { token });
      setLoyaltyPrograms(loyaltyPayload.programs || []);
    } catch (historyError) {
      setError(historyError.message);
    }
  }

  useEffect(() => {
    setSlug(initialSlug);
    loadMenu(initialSlug);
  }, [initialSlug]);

  useEffect(() => {
    loadMenu();
  }, [apiOnline]);

  useEffect(() => {
    loadHistory();
  }, [apiOnline, token, user?.role]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadQuote();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [apiOnline, orderingEnabled, restaurant.id, serviceType, couponCode, restaurantTip, driverTip, cart]);

  useEffect(() => {
    let cancelled = false;
    async function mountStripePaymentElement() {
      setPaymentElementReady(false);
      stripeRef.current = null;
      stripeElementsRef.current = null;
      if (stripeElementMountRef.current) stripeElementMountRef.current.innerHTML = "";
      if (!paymentClientSecret || !paymentPublicKey) return;
      try {
        const Stripe = await loadStripeJs();
        if (cancelled || !Stripe || !stripeElementMountRef.current) return;
        const stripe = Stripe(paymentPublicKey);
        const elements = stripe.elements({ clientSecret: paymentClientSecret });
        const paymentElement = elements.create("payment", { layout: "tabs" });
        paymentElement.mount(stripeElementMountRef.current);
        stripeRef.current = stripe;
        stripeElementsRef.current = elements;
        setPaymentElementReady(true);
      } catch (stripeError) {
        if (!cancelled) setError(stripeError.message);
      }
    }
    mountStripePaymentElement();
    return () => {
      cancelled = true;
      if (stripeElementMountRef.current) stripeElementMountRef.current.innerHTML = "";
    };
  }, [paymentClientSecret, paymentPublicKey]);

  function addItem(item) {
    if ((item.optionGroups || []).length > 0) {
      setSelectedItem(item);
      const defaults = {};
      (item.optionGroups || []).forEach((group) => {
        const defaultOptions = (group.options || []).filter((option) => option.isDefault);
        defaults[group.id || group.name] = group.maxSelect === 1 ? defaultOptions[0]?.name || "" : defaultOptions.map((option) => option.name);
      });
      setSelectedOptions(defaults);
      setSelectedQuantity(1);
      setSpecialInstructions("");
      return;
    }
    setCart((current) => {
      const existing = current.find((cartItem) => cartItem.id === item.id);
      if (existing) return current.map((cartItem) => cartItem.id === item.id ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem);
      return [...current, { ...item, quantity: 1, menuItemId: item.id, lineId: crypto.randomUUID(), selectedModifiers: [] }];
    });
  }

  function toggleOption(group, option) {
    const key = group.id || group.name;
    setSelectedOptions((current) => {
      if (group.maxSelect === 1) return { ...current, [key]: option.name };
      const selected = Array.isArray(current[key]) ? current[key] : [];
      return selected.includes(option.name)
        ? { ...current, [key]: selected.filter((name) => name !== option.name) }
        : { ...current, [key]: [...selected, option.name].slice(0, group.maxSelect || 99) };
    });
  }

  function selectedModifierRows() {
    if (!selectedItem) return [];
    return (selectedItem.optionGroups || []).flatMap((group) => {
      const key = group.id || group.name;
      const selected = Array.isArray(selectedOptions[key]) ? selectedOptions[key] : [selectedOptions[key]].filter(Boolean);
      return (group.options || []).filter((option) => selected.includes(option.name)).map((option) => ({ group: group.name, name: option.name, priceCents: option.priceCents || 0 }));
    });
  }

  function addConfiguredItem() {
    if (!selectedItem) return;
    const modifiers = selectedModifierRows();
    const modifierTotal = modifiers.reduce((sum, option) => sum + option.priceCents, 0);
    setCart((current) => [...current, {
      ...selectedItem,
      quantity: selectedQuantity,
      menuItemId: selectedItem.id,
      lineId: crypto.randomUUID(),
      selectedModifiers: modifiers,
      specialInstructions,
      linePriceCents: selectedItem.priceCents + modifierTotal
    }]);
    setSelectedItem(null);
  }

  function updateCartQuantity(lineId, nextQuantity) {
    if (nextQuantity <= 0) return setCart((current) => current.filter((item) => (item.lineId || item.id) !== lineId));
    setCart((current) => current.map((item) => (item.lineId || item.id) === lineId ? { ...item, quantity: nextQuantity } : item));
  }

  function removeCartLine(lineId) {
    setCart((current) => current.filter((item) => (item.lineId || item.id) !== lineId));
  }

  async function placeOrder() {
    if (cart.length === 0) return setError("Add at least one item to the cart.");
    if (!orderingEnabled) return setError("Ordering is not enabled for this business type yet.");
    if (!apiOnline) {
      setOrderStatus({ id: "offline-order", orderNumber: "DEMO", status: "PENDING", totalCents: orderTotal, restaurantTipCents: restaurantTip, driverTipCents: driverTip, statusHistory: [{ status: "PENDING" }] });
      setPaymentStatus({ status: "PENDING", provider: "offline_demo" });
      setPaymentClientSecret("");
      setPaymentPublicKey("");
      return;
    }
    if (!customer.name || !customer.email) return setError("Enter your name and email before checkout.");
    if (serviceType === "DELIVERY" && !customer.deliveryAddress) return setError("Enter a delivery address before checkout.");
    try {
      setPaymentClientSecret("");
      setPaymentPublicKey("");
      const payload = await api("/api/order-payments/create", {
        method: "POST",
        body: orderPaymentBody(true)
      });
      setOrderStatus({ ...payload.order, tracking: payload.tracking });
      setPaymentStatus(payload.payment);
      setPaymentPublicKey(payload.publishableKey || "");
      setPaymentClientSecret(payload.clientSecret || "");
      await loadHistory();
    } catch (orderError) {
      setError(orderError.message);
    }
  }

  async function confirmRestaurantPayment() {
    if (!stripeRef.current || !stripeElementsRef.current || !orderStatus?.id) return setError("Secure payment form is still loading.");
    setPaying(true);
    setError("");
    try {
      const returnUrl = orderStatus?.tracking?.webUrl || `${window.location.origin}/app/order/${encodeURIComponent(orderStatus.id)}`;
      const result = await stripeRef.current.confirmPayment({
        elements: stripeElementsRef.current,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required"
      });
      if (result.error) throw new Error(result.error.message || "Payment could not be completed.");
      setPaymentStatus((current) => ({ ...(current || {}), status: result.paymentIntent?.status === "succeeded" ? "PAID" : (result.paymentIntent?.status || current?.status || "PROCESSING").toUpperCase() }));
      if (result.paymentIntent?.status === "succeeded") {
        setCart([]);
        await refreshStatus(orderStatus.id);
      }
    } catch (paymentError) {
      setError(paymentError.message);
    } finally {
      setPaying(false);
    }
  }

  async function refreshStatus(orderId) {
    if (!apiOnline || !orderId) return;
    try {
      const trackingToken = orderStatus?.tracking?.token;
      const query = trackingToken ? `?token=${encodeURIComponent(trackingToken)}` : "";
      const payload = await api(`/api/customer/orders/${orderId}/status${query}`);
      setOrderStatus((current) => ({ ...payload.order, tracking: current?.tracking }));
    } catch (statusError) {
      setError(statusError.message);
    }
  }

  async function quickReorder(order) {
    if (!order?.items?.length) return;
    const draftItems = order.items.map((item) => ({ id: item.menuItemId, menuItemId: item.menuItemId, name: item.name, priceCents: item.unitPriceCents, quantity: item.quantity }));
    setCart(draftItems);
    setServiceType(order.type);
  }

  async function saveFavoriteOrder(order) {
    if (!apiOnline || !token) return setError("Sign in as a customer to save favorites.");
    try {
      await api("/api/customer/me/favorites", { method: "PATCH", token, body: { restaurantId: order.restaurantId, favoriteOrdersJson: [{ orderId: order.id, orderNumber: order.orderNumber }], favoriteItemsJson: order.items?.map((item) => ({ menuItemId: item.menuItemId, name: item.name })) || [] } });
    } catch (favoriteError) {
      setError(favoriteError.message);
    }
  }

  function renderTipSelector(label, choice, setChoice, customValue, setCustomValue) {
    return (
      <div className="tip-selector">
        <p className="text-sm font-bold text-ink">{label}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {tipOptions.map((option) => (
            <button className={`tip-button ${choice === option ? "active" : ""}`} key={`${label}-${option}`} type="button" onClick={() => setChoice(option)}>
              {option === "0" ? "No Tip" : option === "CUSTOM" ? "Custom" : `${option}%`}
            </button>
          ))}
        </div>
        {choice === "CUSTOM" ? (
          <input className="input mt-2" type="number" min="0" step="0.01" placeholder="Custom tip amount" value={customValue} onChange={(event) => setCustomValue(event.target.value)} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <InlineError message={error} />
      <div className={embedded ? "site-card" : "storefront"}>
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-mint">Direct ordering</p>
          <h2>{restaurant.name}</h2>
          <p>{restaurant.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {embedded ? null : <input className="input max-w-44" value={slug} onChange={(event) => setSlug(event.target.value)} />}
          {embedded ? null : <button className="button-muted" onClick={loadMenu}><Search size={16} />Load menu</button>}
          <button className={`seg ${serviceType === "DELIVERY" ? "active" : ""}`} onClick={() => setServiceType("DELIVERY")}><Truck size={17} />Delivery</button>
          <button className={`seg ${serviceType === "PICKUP" ? "active" : ""}`} onClick={() => setServiceType("PICKUP")}><PackageCheck size={17} />Pickup</button>
        </div>
      </div>
      <div className="order-layout">
        <div className="space-y-5">
          {!orderingEnabled ? (
            <section className="panel">
              <h3 className="panel-title">{storefrontPlaceholder?.module ? readable(storefrontPlaceholder.module) : "Food catalog"}</h3>
              <p className="mt-3 text-sm text-slate-500">{storefrontPlaceholder?.message || "This business type is supported by the SaaS foundation, but its customer workflow is not built yet."}</p>
            </section>
          ) : (restaurant.categories || []).length === 0 ? <EmptyState title="No public menu" detail="This business has not published orderable items yet." /> : restaurant.categories.map((category) => (
            <section className="panel" key={category.id}>
              <h3 className="panel-title">{category.name}</h3>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {(category.items || []).map((item) => (
                  <div className="food-card" key={item.id}>
                    {item.imageUrl ? <img className="order-card-img" src={item.imageUrl} alt={item.name} /> : null}
                    <div>
                      <p className="font-bold text-ink">{item.name}</p>
                      <p className="mt-1 text-sm text-slate-500">{item.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1">{dietaryBadges(item).map((badge) => <span className="diet-badge" key={badge}>{badge}</span>)}</div>
                      <p className="mt-3 font-bold text-mint">{money(item.priceCents)}</p>
                    </div>
                    <button className="button-primary h-fit" onClick={() => addItem(item)} aria-label={`Add ${item.name}`}><Plus size={16} />Add</button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <aside className="panel order-cart-panel" id="checkout">
          <h3 className="panel-title">Cart and checkout</h3>
          <div className="mt-2 flex items-center justify-between text-sm text-slate-500">
            <span>{cartCount} items in cart</span>
            {cart.length > 0 ? <button className="button-muted" onClick={() => setCart([])}>Clear cart</button> : null}
          </div>
          <div className="mt-4 grid gap-2">
            <input className="input" placeholder="Name" value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.target.value })} />
            <input className="input" placeholder="Email" value={customer.email} onChange={(event) => setCustomer({ ...customer, email: event.target.value })} />
            <input className="input" placeholder="Phone" value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} />
            {serviceType === "DELIVERY" ? <input className="input" placeholder="Delivery address" value={customer.deliveryAddress} onChange={(event) => setCustomer({ ...customer, deliveryAddress: event.target.value })} /> : null}
            <input className="input" placeholder="Coupon code" value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} />
          </div>
          <div className="mt-4 space-y-3">
            {cart.length === 0 ? <p className="text-sm text-slate-500">Add menu items to start an order.</p> : cart.map((item) => (
              <div className="rounded-md border border-line p-2" key={item.lineId || item.id}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-ink">{item.quantity}x {item.name}</span>
                  <span className="text-sm text-slate-600">{money((item.linePriceCents || item.priceCents) * item.quantity)}</span>
                </div>
                {(item.selectedModifiers || []).length > 0 ? <p className="mt-1 text-xs text-slate-500">{item.selectedModifiers.map((option) => `${option.group}: ${option.name}`).join(" / ")}</p> : null}
                {item.specialInstructions ? <p className="mt-1 text-xs text-slate-500">Note: {item.specialInstructions}</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button className="button-muted" onClick={() => updateCartQuantity(item.lineId || item.id, item.quantity - 1)}>-</button>
                  <span className="rounded-md bg-slate-50 px-3 py-2 text-sm font-bold text-ink">{item.quantity}</span>
                  <button className="button-muted" onClick={() => updateCartQuantity(item.lineId || item.id, item.quantity + 1)}>+</button>
                  <button className="button-muted" onClick={() => removeCartLine(item.lineId || item.id)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
          {cart.length > 0 ? (
            <div className="mt-5 space-y-4 border-t border-line pt-4">
              {renderTipSelector("Restaurant tip", restaurantTipChoice, setRestaurantTipChoice, customRestaurantTip, setCustomRestaurantTip)}
              {serviceType === "DELIVERY" ? renderTipSelector("Driver tip", driverTipChoice, setDriverTipChoice, customDriverTip, setCustomDriverTip) : null}
            </div>
          ) : null}
          <div className="mt-5 border-t border-line pt-4 text-sm text-slate-600">
            {quoteLoading ? <p className="mb-2 text-xs font-bold uppercase text-slate-400">Updating live quote...</p> : null}
            {quoteError ? <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs font-bold text-amber-800">{quoteError}</p> : null}
            <div className="summary-line"><span>Subtotal</span><strong>{money(displaySubtotal)}</strong></div>
            {displayDiscount ? <div className="summary-line"><span>Discount</span><strong>-{money(displayDiscount)}</strong></div> : null}
            <div className="summary-line"><span>Delivery fee</span><strong>{money(displayDelivery)}</strong></div>
            <div className="summary-line"><span>Estimated tax</span><strong>{money(displayTax)}</strong></div>
            {displayServiceFee ? <div className="summary-line"><span>Service fee</span><strong>{money(displayServiceFee)}</strong></div> : null}
            <div className="summary-line"><span>Restaurant tip</span><strong>{money(displayRestaurantTip)}</strong></div>
            {serviceType === "DELIVERY" ? <div className="summary-line"><span>Driver tip</span><strong>{money(displayDriverTip)}</strong></div> : null}
            <div className="summary-line total"><span>Total</span><strong>{money(orderTotal)}</strong></div>
            {quote ? <p className="payment-fee-disclosure">{paymentFeeDisclosureText(quote)}</p> : null}
          </div>
          <button className="button-primary mt-5 w-full justify-center" disabled={!orderingEnabled || cart.length === 0 || quoteLoading || Boolean(quoteError)} onClick={placeOrder}><CreditCard size={18} />Continue to secure payment</button>
          {paymentClientSecret ? (
            <div className="mt-5 rounded-md border border-line bg-white p-3">
              <p className="mb-3 text-sm font-black text-ink">Secure restaurant payment</p>
              <div ref={stripeElementMountRef} className="min-h-24" />
              <button className="button-primary mt-4 w-full justify-center" type="button" onClick={confirmRestaurantPayment} disabled={!paymentElementReady || paying}>
                <CreditCard size={18} />{paying ? "Processing..." : `Pay ${money(orderStatus?.totalCents || orderTotal)}`}
              </button>
              <p className="mt-2 text-xs text-slate-500">Payment is processed by the restaurant's connected merchant account. No Loohar transaction fee is added to this order; processor fees may still apply.</p>
            </div>
          ) : null}
          <div className="mt-5 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-ink">Order tracking</p>
              {orderStatus?.id ? <button className="button-muted" onClick={() => refreshStatus(orderStatus.id)}><RefreshCw size={15} />Refresh</button> : null}
            </div>
            {orderStatus ? <p className="mt-2">#{orderStatus.orderNumber} is {orderStatus.status}. Payment {paymentStatus?.status || "PENDING"}. Total {money(orderStatus.totalCents)}</p> : <p className="mt-1">Orders are created as pending payment and are confirmed after secure checkout succeeds.</p>}
            {orderStatus?.tracking?.webUrl ? <a className="button-muted mt-3 w-full justify-center" href={orderStatus.tracking.webUrl}>Track order</a> : null}
            {paymentStatus?.provider === "STRIPE_CONNECT" && paymentStatus.status !== "PAID" ? <p className="mt-2 text-xs text-slate-500">Complete the secure payment form above, then refresh order tracking if needed.</p> : null}
          </div>
          {history.length > 0 ? (
            <div className="mt-5">
              <h4 className="font-bold text-ink">Order history</h4>
              <div className="mt-2 space-y-2">
                {history.map((order) => (
                  <div className="rounded-md border border-line p-2" key={order.id}>
                    <button className="button-muted w-full justify-between" onClick={() => refreshStatus(order.id)}>#{order.orderNumber}<span>{order.status}</span></button>
                    <div className="mt-2 flex gap-2">
                      <button className="button-muted flex-1 justify-center" onClick={() => quickReorder(order)}>Quick reorder</button>
                      <button className="button-muted flex-1 justify-center" onClick={() => saveFavoriteOrder(order)}>Save favorite</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {selectedItem ? (
            <div className="modal-backdrop">
              <div className="item-modal">
                <img src={selectedItem.imageUrl} alt={selectedItem.name} />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3>{selectedItem.name}</h3>
                      <p>{selectedItem.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1">{dietaryBadges(selectedItem).map((badge) => <span className="diet-badge" key={badge}>{badge}</span>)}</div>
                    </div>
                    <button className="button-muted" onClick={() => setSelectedItem(null)}>Close</button>
                  </div>
                  <div className="mt-4 space-y-4">
                    {(selectedItem.optionGroups || []).map((group) => (
                      <div className="rounded-md border border-line p-3" key={group.id || group.name}>
                        <p className="font-bold text-ink">{group.name} {group.required ? <span className="text-xs text-rose-600">Required</span> : null}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(group.options || []).map((option) => {
                            const key = group.id || group.name;
                            const selected = Array.isArray(selectedOptions[key]) ? selectedOptions[key].includes(option.name) : selectedOptions[key] === option.name;
                            return <button className={`seg ${selected ? "active" : ""}`} key={option.id || option.name} onClick={() => toggleOption(group, option)}>{option.name}{option.priceCents ? ` +${money(option.priceCents)}` : ""}</button>;
                          })}
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <button className="button-muted" onClick={() => setSelectedQuantity(Math.max(1, selectedQuantity - 1))}>-</button>
                      <strong className="px-3">{selectedQuantity}</strong>
                      <button className="button-muted" onClick={() => setSelectedQuantity(selectedQuantity + 1)}>+</button>
                    </div>
                    <textarea className="input min-h-20" placeholder="Special instructions" value={specialInstructions} onChange={(event) => setSpecialInstructions(event.target.value)} />
                    <button className="button-primary w-full justify-center" onClick={addConfiguredItem}>Add to cart - {money((selectedItem.priceCents + selectedModifierRows().reduce((sum, option) => sum + option.priceCents, 0)) * selectedQuantity)}</button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {loyaltyPrograms.length > 0 ? (
            <div className="mt-5 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
              <p className="font-semibold text-ink">Loyalty</p>
              {loyaltyPrograms.map((program) => (
                <div className="summary-line" key={program.restaurant.id}><span>{program.restaurant.name}</span><strong>{program.currentPoints} pts</strong></div>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
      {embedded && cartCount > 0 ? (
        <div className="mobile-cart-summary">
          <div>
            <strong>{cartCount} item{cartCount === 1 ? "" : "s"}</strong>
            <span>{money(orderTotal)}</span>
          </div>
          <a className="button-primary" href="#checkout">View cart</a>
        </div>
      ) : null}
    </div>
  );
}

function CustomerOrderTrackingPage({ apiOnline, orderId }) {
  const [order, setOrder] = useState(null);
  const [tipAmount, setTipAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const token = new globalThis.URLSearchParams(window.location.search).get("token") || "";

  async function loadTracking() {
    if (!apiOnline) {
      setLoading(false);
      setError("Order tracking requires the live Loohar API.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = await api(`/api/orders/${orderId}/track?token=${encodeURIComponent(token)}`);
      setOrder(payload.order);
    } catch (trackError) {
      setError(trackError.message);
    } finally {
      setLoading(false);
    }
  }

  async function addPostOrderTip() {
    setError("");
    setMessage("");
    try {
      const tipCents = Math.max(0, Math.round(Number(tipAmount || 0) * 100));
      const payload = await api(`/api/orders/${orderId}/tip?token=${encodeURIComponent(token)}`, {
        method: "PATCH",
        body: { tipCents, restaurantTipCents: order?.type === "DELIVERY" ? 0 : tipCents, driverTipCents: order?.type === "DELIVERY" ? tipCents : 0, customTipCents: tipCents, tipType: "CUSTOM" }
      });
      setOrder(payload.order);
      setMessage("Tip updated for this order.");
    } catch (tipError) {
      setError(tipError.message);
    }
  }

  useEffect(() => {
    loadTracking();
  }, [apiOnline, orderId, token]);

  return (
    <div className="tracking-shell">
      <a className="site-brand tracking-brand" href="/">
        <div className="site-brand-mark">L</div>
        <strong>Loohar</strong>
      </a>
      <main className="tracking-card">
        <SectionHeader eyebrow="Order tracking" title={order ? `Order #${order.orderNumber}` : "Track your order"} icon={ReceiptText} action={order ? <button className="button-muted" onClick={loadTracking}><RefreshCw size={16} />Refresh</button> : null} />
        <InlineError message={error} />
        {message ? <div className="success-box">{message}</div> : null}
        {loading ? <AppLoadingState /> : null}
        {!loading && order ? (
          <div className="space-y-5">
            <div className="tracking-status">
              <StatusPill tone={["DELIVERED", "READY"].includes(order.status) ? "good" : "neutral"}>{readable(order.status)}</StatusPill>
              <p>{order.restaurant?.name}</p>
              <a href={publicPathForSlug(order.restaurant?.slug, "order")}>Open restaurant menu</a>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="panel">
                <h3 className="panel-title">Items</h3>
                {(order.items || []).map((item, index) => <div className="summary-line" key={`${item.name}-${index}`}><span>{item.quantity} x {item.name}</span></div>)}
              </div>
              <div className="panel">
                <h3 className="panel-title">Summary</h3>
                <div className="summary-line"><span>Subtotal</span><strong>{money(order.totals?.subtotalCents)}</strong></div>
                <div className="summary-line"><span>Tax</span><strong>{money(order.totals?.taxCents)}</strong></div>
                {order.totals?.restaurantTipCents ? <div className="summary-line"><span>Restaurant tip</span><strong>{money(order.totals.restaurantTipCents)}</strong></div> : null}
                {order.totals?.driverTipCents ? <div className="summary-line"><span>Driver tip</span><strong>{money(order.totals.driverTipCents)}</strong></div> : null}
                {order.totals?.deliveryFeeCents ? <div className="summary-line"><span>Delivery fee</span><strong>{money(order.totals.deliveryFeeCents)}</strong></div> : null}
                <div className="summary-line total"><span>Total</span><strong>{money(order.totals?.totalCents)}</strong></div>
              </div>
            </div>
            <div className="panel">
              <h3 className="panel-title">Loohar mobile app</h3>
              <p className="text-sm text-slate-500">Native app deep links are prepared for a future mobile release. For now, this web tracking page is the secure fallback.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a className="button-primary" href={publicPathForSlug(order.restaurant?.slug, "order")}>Reorder</a>
                <button className="button-muted" type="button">Rate order placeholder</button>
              </div>
            </div>
            <div className="panel">
              <h3 className="panel-title">Additional tip</h3>
              <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                <input className="input" type="number" min="0" step="0.01" placeholder="Tip amount" value={tipAmount} onChange={(event) => setTipAmount(event.target.value)} />
                <button className="button-primary" type="button" onClick={addPostOrderTip}>Update tip</button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function DriverApp({ apiOnline, token }) {
  const [available, setAvailable] = useState(true);
  const [deliveries, setDeliveries] = useState([]);
  const [earnings, setEarnings] = useState({ deliveries: 3, earnings: 8600, tips: 4200 });
  const [error, setError] = useState("");
  const fallbackDelivery = { id: "demo-delivery", status: "ASSIGNED", pickupAddress: "Demo Bistro, 100 Main St", dropoffAddress: "2425 Market St, Denver", tipCents: 600, baseEarningsCents: 650, order: { orderNumber: "894120", customer: { name: "Maya Chen" }, restaurant: demoRestaurant, items: [] } };
  const shownDeliveries = deliveries.length > 0 ? deliveries : apiOnline ? [] : [fallbackDelivery];
  const statuses = ["ACCEPTED", "ARRIVED_AT_RESTAURANT", "PICKED_UP", "ON_THE_WAY", "DELIVERED"];

  async function loadDriver() {
    if (!apiOnline || !token) return;
    setError("");
    try {
      const [deliveryPayload, earningsPayload] = await Promise.all([
        api("/api/driver/deliveries", { token }),
        api("/api/driver/earnings", { token })
      ]);
      setDeliveries(deliveryPayload.deliveries || []);
      setEarnings(earningsPayload);
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    loadDriver();
  }, [apiOnline, token]);

  async function toggleAvailability() {
    const next = !available;
    setAvailable(next);
    if (!apiOnline || !token) return;
    try {
      await api("/api/driver/availability", { method: "PATCH", token, body: { available: next } });
    } catch (availabilityError) {
      setError(availabilityError.message);
    }
  }

  async function acceptDelivery(delivery) {
    if (!apiOnline) return setDeliveries((current) => current.map((item) => item.id === delivery.id ? { ...item, status: "ACCEPTED" } : item));
    try {
      await api(`/api/driver/deliveries/${delivery.id}/accept`, { method: "POST", token });
      await loadDriver();
    } catch (acceptError) {
      setError(acceptError.message);
    }
  }

  async function updateDeliveryStatus(delivery, status) {
    if (!apiOnline) return setDeliveries((current) => current.map((item) => item.id === delivery.id ? { ...item, status } : item));
    try {
      await api(`/api/driver/deliveries/${delivery.id}/status`, { method: "PATCH", token, body: { status } });
      await loadDriver();
    } catch (statusError) {
      setError(statusError.message);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Driver PWA" title="Assigned delivery workflow" icon={Bike} action={<button className={`button-primary ${available ? "" : "opacity-70"}`} onClick={toggleAvailability}><Activity size={18} />{available ? "Available" : "Unavailable"}</button>} />
      <InlineError message={error} />
      <div className="grid gap-4 md:grid-cols-3">
        <Stat icon={ReceiptText} label="Earnings" value={money(earnings.earnings)} detail="Base delivery pay" />
        <Stat icon={CreditCard} label="Tips" value={money(earnings.tips)} detail="Tracked separately" />
        <Stat icon={CheckCircle2} label="Completed" value={earnings.deliveries || 0} detail="Delivery history" />
      </div>
      {shownDeliveries.length === 0 ? <EmptyState title="No assigned deliveries" detail="Restaurant-assigned delivery orders will appear here." /> : shownDeliveries.map((delivery) => (
        <div className="grid gap-5 lg:grid-cols-[1fr_0.8fr]" key={delivery.id}>
          <div className="panel">
            <h3 className="panel-title">Delivery #{delivery.order?.orderNumber || delivery.id}</h3>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="route-box"><Store size={20} /><div><strong>Pickup</strong><span>{delivery.pickupAddress || delivery.order?.restaurant?.address}</span></div></div>
              <div className="route-box"><MapPin size={20} /><div><strong>Dropoff</strong><span>{delivery.dropoffAddress}</span></div></div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button className="seg active" onClick={() => acceptDelivery(delivery)}>Accept delivery</button>
              {statuses.map((item) => (
                <button className={`seg ${delivery.status === item ? "active" : ""}`} key={item} onClick={() => updateDeliveryStatus(delivery, item)}>{item.replaceAll("_", " ")}</button>
              ))}
            </div>
            <div className="mt-5 rounded-md border border-line p-4">
              <p className="font-bold text-ink">Status: {delivery.status.replaceAll("_", " ")}</p>
              <p className="mt-1 text-sm text-slate-500">Customer: {delivery.order?.customer?.name || "Customer"} - Tip {money(delivery.tipCents)}</p>
            </div>
          </div>
          <div className="panel">
            <h3 className="panel-title">Delivery details</h3>
            <div className="mt-4 space-y-3">
              {(delivery.order?.items || []).length === 0 ? <EmptyState title="No item detail" detail="Order item details load with assigned deliveries." /> : delivery.order.items.map((item) => (
                <div className="rounded-md bg-slate-50 p-3 text-sm font-semibold text-slate-700" key={item.id}>{item.quantity}x {item.name}</div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DiscoveryPage({ apiOnline }) {
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [type, setType] = useState("ALL");
  const [delivery, setDelivery] = useState("ALL");
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(apiOnline);
  const [error, setError] = useState("");
  const [locationLabel, setLocationLabel] = useState("Showing public food businesses");

  function fallbackRestaurants() {
    return demoRestaurants
      .filter((restaurant) => type === "ALL" || restaurant.businessType === type)
      .filter((restaurant) => delivery !== "true" || restaurant.deliveryEnabled !== false)
      .filter((restaurant) => !city || [restaurant.city, restaurant.address, restaurant.name].filter(Boolean).join(" ").toLowerCase().includes(city.toLowerCase()))
      .filter((restaurant) => !zip || [restaurant.zip, restaurant.address].filter(Boolean).join(" ").includes(zip))
      .map((restaurant) => {
        const bundle = demoWebsiteBundle(restaurant.slug);
        return {
          id: restaurant.id,
          name: restaurant.businessName || restaurant.name,
          slug: restaurant.slug,
          businessType: restaurant.businessType,
          cuisine: bundle.website?.cuisineType || readable(restaurant.businessType),
          logoUrl: bundle.website?.logoUrl,
          heroImageUrl: bundle.website?.heroImageUrl,
          address: fullRestaurantAddress(bundle.restaurant) || restaurant.address || "Denver, CO",
          pickupEnabled: bundle.restaurant.pickupEnabled !== false,
          deliveryEnabled: bundle.restaurant.deliveryEnabled !== false,
          distanceMiles: null,
          openStatus: "Hours vary",
          websiteUrl: publicPathForSlug(restaurant.slug),
          orderUrl: publicPathForSlug(restaurant.slug, "order")
        };
      });
  }

  async function searchDiscovery(next = {}) {
    const nextCity = next.city ?? city;
    const nextZip = next.zip ?? zip;
    const nextType = next.type ?? type;
    const nextDelivery = next.delivery ?? delivery;
    const params = new globalThis.URLSearchParams();
    if (nextCity) params.set("city", nextCity);
    if (nextZip) params.set("zip", nextZip);
    if (nextType && nextType !== "ALL") params.set("type", nextType);
    if (nextDelivery && nextDelivery !== "ALL") params.set("delivery", nextDelivery);
    if (next.lat && next.lng) {
      params.set("lat", next.lat);
      params.set("lng", next.lng);
      setLocationLabel("Sorted by your browser location");
    } else if (nextZip) {
      setLocationLabel(`Searching near ZIP ${nextZip}`);
    } else if (nextCity) {
      setLocationLabel(`Searching near ${nextCity}`);
    } else {
      setLocationLabel("Showing public food businesses");
    }
    setLoading(true);
    setError("");
    if (!apiOnline) {
      setRestaurants(fallbackRestaurants());
      setLoading(false);
      return;
    }
    try {
      const payload = await api(`/api/public/discover?${params.toString()}`);
      setRestaurants(payload.restaurants || []);
    } catch (discoveryError) {
      setError(discoveryError.message);
      setRestaurants(fallbackRestaurants());
    } finally {
      setLoading(false);
    }
  }

  function useLocation() {
    if (!navigator.geolocation) {
      setError("Browser location is not available. Search by city or ZIP.");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => searchDiscovery({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => {
        setLoading(false);
        setError("Location permission was not granted. Search by city or ZIP.");
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }

  useEffect(() => {
    searchDiscovery();
  }, [apiOnline]);

  return (
    <div className="discover-shell">
      <header className="discover-hero">
        <a className="site-brand" href="/">
          <div className="site-brand-mark">L</div>
          <div>
            <strong>Loohar Discover</strong>
            <span>Find local restaurants with direct ordering.</span>
          </div>
        </a>
        <div className="discover-copy">
          <p className="lux-kicker">Restaurant-owned ordering</p>
          <h1>Discover pickup and delivery near you</h1>
          <p>Search food businesses that keep ordering, delivery, loyalty, and guest relationships direct.</p>
        </div>
      </header>
      <main className="discover-main">
        <section className="panel discover-toolbar">
          <div className="discover-search-grid">
            <input className="input" placeholder="City" value={city} onChange={(event) => setCity(event.target.value)} />
            <input className="input" placeholder="ZIP" value={zip} onChange={(event) => setZip(event.target.value)} />
            <select className="select" value={type} onChange={(event) => setType(event.target.value)}>
              <option value="ALL">All food business types</option>
              {businessTypes.map((businessType) => <option value={businessType} key={businessType}>{readable(businessType)}</option>)}
            </select>
            <select className="select" value={delivery} onChange={(event) => setDelivery(event.target.value)}>
              <option value="ALL">Pickup or delivery</option>
              <option value="true">Delivery available</option>
              <option value="false">Pickup available</option>
            </select>
          </div>
          <div className="discover-actions">
            <button className="button-muted" type="button" onClick={useLocation}><MapPin size={16} />Use my location</button>
            <button className="button-primary" type="button" onClick={() => searchDiscovery()}><Search size={16} />Search</button>
          </div>
        </section>
        <div className="my-4 flex flex-wrap items-center gap-2">
          <StatusPill tone={apiOnline ? "good" : "warn"}>{apiOnline ? "Live discovery API" : "Demo discovery fallback"}</StatusPill>
          <StatusPill>{locationLabel}</StatusPill>
          <StatusPill>{restaurants.length} result{restaurants.length === 1 ? "" : "s"}</StatusPill>
        </div>
        <InlineError message={error} />
        {loading ? <PublicSiteSkeleton premium /> : restaurants.length === 0 ? <EmptyState title="No food businesses found" detail="Try a different city, ZIP, or filter." /> : (
          <section className="discover-grid">
            {restaurants.map((restaurant) => (
              <article className="discover-card" key={restaurant.id || restaurant.slug}>
                <img src={resolveImage(restaurant.heroImageUrl, restaurant.logoUrl)} alt={restaurant.name} loading="lazy" onError={handleSafeImageError} />
                <div className="discover-card-body">
                  <div className="flex flex-wrap gap-2">
                    <StatusPill tone="good">{restaurant.openStatus || "Hours vary"}</StatusPill>
                    {restaurant.distanceMiles !== null && restaurant.distanceMiles !== undefined ? <StatusPill>{restaurant.distanceMiles} mi</StatusPill> : null}
                  </div>
                  <h2>{restaurant.name}</h2>
                  <p>{restaurant.cuisine || readable(restaurant.businessType)}</p>
                  <p className="discover-address">{restaurant.address}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {restaurant.pickupEnabled ? <span className="diet-badge">Pickup</span> : null}
                    {restaurant.deliveryEnabled ? <span className="diet-badge">Delivery</span> : null}
                    <span className="diet-badge">{restaurant.rating || 4.8} rating</span>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <a className="button-primary" href={restaurant.orderUrl}>Order direct</a>
                    <a className="button-muted" href={restaurant.websiteUrl}>View website</a>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const [currentPath, setCurrentPath] = useState(() => window.location.pathname);
  const initialPath = currentPath;
  const [token, setToken] = useState(() => getStoredSession().token);
  const [refreshToken, setRefreshToken] = useState(() => getStoredSession().refreshToken);
  const [user, setUser] = useState(() => getStoredSession().user);
  const [apiOnline, setApiOnline] = useState(false);
  const [apiMode, setApiMode] = useState("CHECKING");
  const [authChecking, setAuthChecking] = useState(true);
  const isLoginRoute = initialPath === "/login" || initialPath === "/admin/login" || initialPath === "/restaurant/login";
  const isForgotPasswordRoute = initialPath === "/forgot-password";
  const resetPasswordMatch = initialPath.match(/^\/reset-password\/([^/]+)\/?$/);
  const appOrderMatch = initialPath.match(/^\/app\/order\/([^/]+)\/?$/);
  const isPricingRoute = initialPath === "/pricing";
  const isRegisterRoute = initialPath === "/register" || initialPath.startsWith("/register/");
  const isFeatureRoute = initialPath === "/features" || initialPath.startsWith("/features/");
  const isPublicInfoRoute = ["/about", "/security", "/support", "/privacy", "/terms", "/resources"].includes(initialPath) || initialPath.startsWith("/resources/");
  const isDriverHost = window.location.hostname.startsWith("driver.");
  const tenantHost = tenantHostRouteInfo();
  const isDriverAppDownloadRoute = initialPath === "/driver-app";
  const isDriverRoute = initialPath === "/driver" || initialPath.startsWith("/driver/") || (isDriverHost && /^\/order\/[^/]+\/?$/.test(initialPath));
  const isDiscoverRoute = initialPath === "/discover";
  const isAdminRoute = initialPath === "/admin" || initialPath.startsWith("/admin/");
  const isKitchenRoute = initialPath === "/kitchen" || initialPath.startsWith("/kitchen/");
  const isRestaurantRoute = initialPath === "/restaurant" || initialPath.startsWith("/restaurant/");
  const isRestaurantOnboardingRoute = isRestaurantOnboardingPath(initialPath);
  const isCustomerRoute = initialPath === "/customer" || initialPath.startsWith("/customer/");
  const isSiteAdminRoute = /^\/sites\/[^/]+\/admin\/?$/.test(initialPath);
  const isTenantHostPublicPath = tenantHost.isTenantHost && !["/login", "/admin/login", "/restaurant/login", "/forgot-password"].includes(initialPath) && !initialPath.startsWith("/admin") && !initialPath.startsWith("/restaurant") && !initialPath.startsWith("/driver") && !initialPath.startsWith("/customer") && !initialPath.startsWith("/kitchen") && !initialPath.startsWith("/app/") && !initialPath.startsWith("/register") && !initialPath.startsWith("/features") && initialPath !== "/pricing";
  const isPathPublicSiteRoute = isPathBasedPublicRestaurantPath(initialPath);
  const isSiteRoute = ((initialPath === "/sites" || initialPath.startsWith("/sites/")) && !isSiteAdminRoute) || isTenantHostPublicPath || isPathPublicSiteRoute;
  const orderRouteSlug = initialPath.startsWith("/order/") ? initialPath.split("/")[2] : null;
  const isAdminCreateRoute = initialPath === "/admin/business/new";
  const adminAuditMatch = initialPath.match(/^\/admin\/business\/([^/]+)\/audit\/?$/);

  useEffect(() => {
    function syncCurrentPath() {
      setCurrentPath(window.location.pathname);
    }
    window.addEventListener("popstate", syncCurrentPath);
    window.addEventListener("loohar:navigate", syncCurrentPath);
    return () => {
      window.removeEventListener("popstate", syncCurrentPath);
      window.removeEventListener("loohar:navigate", syncCurrentPath);
    };
  }, []);

  useEffect(() => {
    const privateRoute = isAdminRoute || isRestaurantRoute || isDriverRoute || isKitchenRoute || isCustomerRoute || isSiteAdminRoute || isLoginRoute || isForgotPasswordRoute || Boolean(resetPasswordMatch) || Boolean(appOrderMatch);
    setRobots(!privateRoute);
  }, [isAdminRoute, isRestaurantRoute, isDriverRoute, isKitchenRoute, isCustomerRoute, isSiteAdminRoute, isLoginRoute, isForgotPasswordRoute, resetPasswordMatch, appOrderMatch]);

  useEffect(() => {
    let cancelled = false;
    let timerId;
    let inFlight = false;

    async function probeApiHealth() {
      if (cancelled || inFlight) return;
      inFlight = true;
      let nextOnline = false;
      try {
        await checkApiHealth();
        nextOnline = true;
        if (!cancelled) {
          setApiOnline(true);
          setApiMode("LIVE");
        }
      } catch {
        if (!cancelled) {
          setApiOnline(false);
          setApiMode("DEMO");
        }
      } finally {
        inFlight = false;
        if (!cancelled) {
          timerId = window.setTimeout(probeApiHealth, nextOnline ? 30000 : 5000);
        }
      }
    }

    function retryApiHealthNow() {
      if (timerId) window.clearTimeout(timerId);
      probeApiHealth();
    }

    probeApiHealth();
    window.addEventListener("focus", retryApiHealthNow);
    window.addEventListener("online", retryApiHealthNow);
    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
      window.removeEventListener("focus", retryApiHealthNow);
      window.removeEventListener("online", retryApiHealthNow);
    };
  }, []);

  useEffect(() => {
    function syncStoredSession(session = getStoredSession()) {
      setToken(session.token || "");
      setRefreshToken(session.refreshToken || "");
      setUser(session.user || null);
    }

    function handleAuthUpdated(event) {
      syncStoredSession(event.detail?.session || getStoredSession());
    }

    function handleAuthExpired(event) {
      clearSession(event.detail?.reason || "session_expired", { emit: false });
      setToken("");
      setRefreshToken("");
      setUser(null);
      setAuthChecking(false);
      const path = window.location.pathname;
      if (isAuthPagePath(path)) return;
      if (path.startsWith("/admin")) {
        navigateInApp(loginHrefWithReturnTo("/admin/login", path), { replace: true });
      } else if (path.startsWith("/restaurant") || path.startsWith("/kitchen")) {
        navigateInApp(loginHrefWithReturnTo("/restaurant/login", path), { replace: true });
      } else if (path.startsWith("/customer") || path.startsWith("/driver")) {
        navigateInApp(loginHrefWithReturnTo("/login", path), { replace: true });
      }
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    window.addEventListener(AUTH_SESSION_UPDATED_EVENT, handleAuthUpdated);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
      window.removeEventListener(AUTH_SESSION_UPDATED_EVENT, handleAuthUpdated);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSessionFromAccessToken(accessToken, retainedRefreshToken) {
      const current = await api("/api/auth/me", { token: accessToken, clearOnUnauthorized: false, authRetry: false });
      const memberships = current.memberships || [];
      return {
        accessToken,
        refreshToken: retainedRefreshToken || "",
        memberships,
        user: normalizeSessionUser(current.user, memberships)
      };
    }

    async function refreshSession(retainedRefreshToken) {
      const refreshed = await api("/api/auth/refresh", {
        method: "POST",
        body: { refreshToken: retainedRefreshToken },
        skipAuth: true,
        clearOnUnauthorized: false,
        authRetry: false
      });
      if (!refreshed?.accessToken) throw new Error("Refresh did not return a usable session.");
      const nextSession = await loadSessionFromAccessToken(refreshed.accessToken, refreshed.refreshToken || retainedRefreshToken);
      return { ...refreshed, ...nextSession };
    }

    function applyVerifiedSession(nextSession) {
      setToken(nextSession.accessToken);
      setRefreshToken(nextSession.refreshToken || "");
      setUser(nextSession.user);
      storeSession(nextSession);
      setAuthChecking(false);
    }

    function clearInvalidSession() {
      clearSession();
      setToken("");
      setRefreshToken("");
      setUser(null);
      setAuthChecking(false);
    }

    async function verifySession() {
      if (apiMode === "CHECKING") return;
      if (apiMode === "DEMO") {
        if (!cancelled) setAuthChecking(false);
        return;
      }
      setAuthChecking(true);
      if (!token) {
        if (!refreshToken) {
          if (!cancelled) clearInvalidSession();
          return;
        }
        try {
          const nextSession = await refreshSession(refreshToken);
          if (!cancelled) applyVerifiedSession(nextSession);
        } catch {
          if (!cancelled) clearInvalidSession();
        }
        return;
      }
      try {
        const nextSession = await loadSessionFromAccessToken(token, refreshToken);
        if (!cancelled) {
          applyVerifiedSession(nextSession);
        }
      } catch {
        if (!refreshToken) {
          if (!cancelled) clearInvalidSession();
          return;
        }
        try {
          const nextSession = await refreshSession(refreshToken);
          if (!cancelled) applyVerifiedSession(nextSession);
        } catch {
          if (!cancelled) clearInvalidSession();
        }
      }
    }
    verifySession();
    return () => {
      cancelled = true;
    };
  }, [apiMode, token, refreshToken]);

  function handleLogin(payload) {
    const normalizedUser = normalizeSessionUser(payload.user, payload.memberships);
    const nextSession = { ...payload, user: normalizedUser };
    setToken(payload.accessToken);
    setRefreshToken(payload.refreshToken || "");
    setUser(normalizedUser);
    storeSession(nextSession);
  }

  function handleImpersonate(payload) {
    handleLogin({ accessToken: payload.accessToken, refreshToken: payload.refreshToken, memberships: payload.memberships || [], user: payload.user });
    navigateInApp(dashboardPathFor(payload.user), { replace: true });
  }

  function logout() {
    if (token) api("/api/auth/logout", { method: "POST", token }).catch(() => {});
    setToken("");
    setRefreshToken("");
    setUser(null);
    clearSession();
    navigateInApp("/", { replace: true });
  }

  if (isForgotPasswordRoute) {
    return <ForgotPasswordPage apiOnline={apiOnline} />;
  }

  if (resetPasswordMatch) {
    return <ResetPasswordPage apiOnline={apiOnline} token={decodeURIComponent(resetPasswordMatch[1])} onLogin={handleLogin} />;
  }

  if (appOrderMatch) {
    if (apiMode === "CHECKING") return <PublicSiteSkeleton premium />;
    return <CustomerOrderTrackingPage apiOnline={apiOnline} orderId={decodeURIComponent(appOrderMatch[1])} />;
  }

  if (isPricingRoute) {
    return <PricingPage apiMode={apiMode} apiOnline={apiOnline} />;
  }

  if (isRegisterRoute) {
    if (initialPath === "/register/status") return <RegistrationStatusPage apiOnline={apiOnline} />;
    if (initialPath === "/register/success" && new window.URLSearchParams(window.location.search).get("session_id")) return <RegistrationStatusPage apiOnline={apiOnline} />;
    if (initialPath === "/register/success") return <RegistrationResultPage type="success" />;
    if (initialPath === "/register/cancelled") return <RegistrationResultPage type="cancelled" />;
    if (initialPath === "/register/failed") return <RegistrationResultPage type="failed" />;
    return <RegistrationPage apiMode={apiMode} apiOnline={apiOnline} />;
  }

  if (isFeatureRoute) {
    return <FeatureDetailPage path={initialPath} user={user} onLogout={logout} />;
  }

  if (isPublicInfoRoute) {
    return <PublicInfoPage path={initialPath} user={user} onLogout={logout} />;
  }

  if (isLoginRoute) {
    if (apiMode === "CHECKING" || (apiOnline && authChecking)) {
      return (
        <div className="min-h-screen bg-[#f7f8fb] px-4 py-10 text-slate-700">
          <AppLoadingState />
        </div>
      );
    }
    if (user && !requiresPasswordChange(user)) {
      return <Redirecting to={dashboardPathFor(user)} />;
    }
    const mode = initialPath === "/admin/login" ? "admin" : initialPath === "/restaurant/login" ? "restaurant" : "platform";
    return <AuthPage mode={mode} apiOnline={apiOnline} onLogin={handleLogin} />;
  }

  if (isDiscoverRoute) {
    if (apiMode === "CHECKING") return <PublicSiteSkeleton premium />;
    return <DiscoveryPage apiOnline={apiOnline} />;
  }

  if (isDriverAppDownloadRoute) {
    return <DriverAppDownloadPage />;
  }

  if (isDriverRoute) {
    if (apiMode === "CHECKING" || (apiOnline && authChecking)) return <div className="min-h-screen bg-[#f7f8fb] px-4 py-6 text-slate-700"><AppLoadingState /></div>;
    if (apiOnline && !user) return <AccessDenied title="Please sign in to continue." loginHref={loginHrefWithReturnTo("/login")} detail="Driver login is required for this route." />;
    if (apiOnline && user?.role !== "DRIVER") return <AccessDenied loginHref="/login" detail="The Driver app is available only to driver accounts." />;
    return <DriverPwaApp apiOnline={apiOnline} token={token} />;
  }

  if (isKitchenRoute) {
    const kitchenSlug = window.location.pathname.startsWith("/kitchen/") ? window.location.pathname.split("/")[2] : "";
    const canOpenKitchen = kitchenRoles.includes(user?.role) && canAccessTenantRoute(user, initialPath, "kitchen") && !requiresPasswordChange(user);
    if (apiMode === "CHECKING" || (apiOnline && authChecking)) return <AppLoadingState />;
    if (!canOpenKitchen) return !user ? <AccessDenied title="Please sign in to continue." loginHref={loginHrefWithReturnTo("/restaurant/login")} detail="Restaurant operations login is required for this route." /> : <AccessDenied loginHref="/restaurant/login" detail="This route is only for assigned kitchen staff, cashiers, managers, and restaurant owners." />;
    return (
      <RestaurantAppShell user={user} restaurantSlug={kitchenSlug || user?.restaurantSlug || ""} activePage="kitchen" apiOnline={apiOnline} apiMode={apiMode} authChecking={authChecking} onLogout={logout}>
        <KitchenApp apiOnline={apiOnline} token={token} user={user} initialSlug={kitchenSlug} />
      </RestaurantAppShell>
    );
  }

  if (isAdminRoute) {
    if (initialPath === "/admin/login") return <AuthPage mode="admin" apiOnline={apiOnline} onLogin={handleLogin} />;
    if (apiMode !== "CHECKING" && !(apiOnline && authChecking) && !user) {
      return <AuthPage mode="admin" apiOnline={apiOnline} onLogin={handleLogin} />;
    }
    const canOpenAdmin = adminRoles.includes(user?.role) && !requiresPasswordChange(user);
    const adminContent = isAdminCreateRoute
      ? <AdminCreateBusinessPage apiOnline={apiOnline} token={token} />
      : adminAuditMatch
        ? <AdminAuditPage apiOnline={apiOnline} token={token} businessId={decodeURIComponent(adminAuditMatch[1])} />
        : <AdminApp apiOnline={apiOnline} token={token} onImpersonate={handleImpersonate} />;
    return (
      <div className="min-h-screen bg-[#f7f8fb] text-slate-700">
        <AppHeader navItems={platformNavigation(initialPath, user?.role === "SUPER_ADMIN")} />
        <main className="mx-auto max-w-7xl px-4 py-6">
          <LoginStrip user={user} onLogout={logout} />
          <div className="my-4 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <StatusPill tone={apiOnline ? "good" : apiMode === "CHECKING" ? "neutral" : "warn"}>{apiOnline ? "Live API connected" : apiMode === "CHECKING" ? "Checking API" : "Offline demo fallback"}</StatusPill>
            <StatusPill tone={canOpenAdmin ? "good" : "warn"}>{canOpenAdmin ? "Super admin" : "Super admin login required"}</StatusPill>
          </div>
          {apiMode === "CHECKING" || (apiOnline && authChecking) ? <AppLoadingState /> : canOpenAdmin ? adminContent : !user ? <AccessDenied title="Please sign in to continue." loginHref={loginHrefWithReturnTo("/admin/login")} detail="Super admin login is required for this route." /> : <AccessDenied loginHref="/admin/login" detail="This route is only for the platform owner." />}
        </main>
      </div>
    );
  }

  if (isRestaurantRoute || isSiteAdminRoute) {
    if (initialPath === "/restaurant/login") return <AuthPage mode="restaurant" apiOnline={apiOnline} onLogin={handleLogin} />;
    if (apiMode !== "CHECKING" && !(apiOnline && authChecking) && !user) {
      return <AuthPage mode="restaurant" apiOnline={apiOnline} onLogin={handleLogin} />;
    }
    const restaurantSlug = isRestaurantRoute && !isRestaurantOnboardingRoute ? routeSlug(initialPath, "restaurant") : isRestaurantOnboardingRoute && initialPath !== "/restaurant/onboarding" ? routeSlug(initialPath, "restaurant") : "";
    const restaurantPage = restaurantPageFromPath(initialPath);
    const legacyRestaurantRedirect = user ? legacyRestaurantRedirectPath(initialPath, user) : "";
    const restaurantShellSlug = restaurantSlug || primaryRestaurantSlugFor(user);
    const allowedRestaurantRouteRoles = restaurantPage === "kitchen" || restaurantPage === "kiosk" ? restaurantStaffRoles : restaurantRoles;
    const canOpenRestaurant = allowedRestaurantRouteRoles.includes(user?.role) && canAccessTenantRoute(user, initialPath, "restaurant") && !requiresPasswordChange(user);
    const shouldResumeOnboarding = canOpenRestaurant && restaurantRoles.includes(user?.role) && !restaurantOnboardingComplete(user) && !isRestaurantOnboardingRoute && (initialPath === "/restaurant" || initialPath === `/restaurant/${restaurantSlug}`);
    const restaurantContent = isRestaurantOnboardingRoute
      ? <RestaurantOnboardingWizard apiOnline={apiOnline} token={token} user={user} initialSlug={restaurantSlug} />
      : shouldResumeOnboarding
        ? <Redirecting to={restaurantOnboardingPathFor(user, restaurantSlug)} />
        : restaurantPage === "kitchen"
          ? <KitchenApp apiOnline={apiOnline} token={token} user={user} initialSlug={restaurantShellSlug} />
          : <RestaurantApp apiOnline={apiOnline} token={token} user={user} initialSlug={restaurantSlug} activePage={restaurantPage} />;
    if (apiMode === "CHECKING" || (apiOnline && authChecking)) return <AppLoadingState />;
    if (legacyRestaurantRedirect) return <Redirecting to={legacyRestaurantRedirect} />;
    if (!canOpenRestaurant) {
      const deniedDetail = restaurantPage === "kiosk"
        ? "This secure kiosk route is only for assigned restaurant staff with POS access."
        : "This route is only for the assigned restaurant owner, manager, or admin.";
      return !user
        ? <AccessDenied title="Please sign in to continue." loginHref={loginHrefWithReturnTo("/restaurant/login")} detail="Restaurant login is required for this route." />
        : <AccessDenied loginHref="/restaurant/login" detail={deniedDetail} />;
    }
    if (restaurantPage === "kiosk") {
      return <RestaurantKioskShell apiOnline={apiOnline} apiMode={apiMode} token={token} user={user} restaurantSlug={restaurantShellSlug} onLogout={logout} />;
    }
    return (
      <RestaurantAppShell user={user} restaurantSlug={restaurantShellSlug} activePage={restaurantPage} apiOnline={apiOnline} apiMode={apiMode} authChecking={authChecking} onLogout={logout}>
        {restaurantContent}
      </RestaurantAppShell>
    );
  }

  if (isSiteRoute) {
    if (apiMode === "CHECKING") return <PublicSiteSkeleton premium />;
    return <PremiumRestaurantSite apiOnline={apiOnline} />;
  }

  if (orderRouteSlug) {
    return (
      <div className="min-h-screen bg-[#f7f8fb] px-4 py-6 text-slate-700">
        <main className="mx-auto max-w-7xl">
          <CustomerApp apiOnline={apiOnline} token={token} user={user} initialSlug={orderRouteSlug} embedded />
        </main>
      </div>
    );
  }

  if (isCustomerRoute) {
    const canOpenCustomer = customerRoles.includes(user?.role) && !requiresPasswordChange(user);
    return (
      <div className="min-h-screen bg-[#f7f8fb] text-slate-700">
        <AppHeader navItems={[{ label: "Customer", icon: Store, href: "/customer", active: true }]} />
        <main className="mx-auto max-w-7xl px-4 py-6">
          <LoginStrip user={user} onLogout={logout} />
          {apiMode === "CHECKING" || (apiOnline && authChecking) ? <AppLoadingState /> : canOpenCustomer ? <CustomerApp apiOnline={apiOnline} token={token} user={user} /> : !user ? <AccessDenied title="Please sign in to continue." loginHref={loginHrefWithReturnTo("/login")} detail="Customer login is required for this route." /> : <AccessDenied loginHref="/login" detail="This route is only for customer accounts." />}
        </main>
      </div>
    );
  }

  return <PublicHome user={user} onLogout={logout} />;
}
