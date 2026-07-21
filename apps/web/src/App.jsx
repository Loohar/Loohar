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
import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import QRCode from "qrcode";
import DriverPwaApp from "./apps/driver/DriverApp.jsx";
import { api, API_ORIGIN, checkApiHealth } from "./lib/api.js";
import { clearSession, getStoredSession, storeSession } from "./shared/auth.js";
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
const kitchenRoles = ["TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER", "CASHIER", "KITCHEN_STAFF", "SUPER_ADMIN"];
const customerRoles = ["CUSTOMER"];
const strongPasswordChecks = [
  { label: "At least 12 characters", test: (value) => value.length >= 12 },
  { label: "Uppercase letter", test: (value) => /[A-Z]/.test(value) },
  { label: "Lowercase letter", test: (value) => /[a-z]/.test(value) },
  { label: "Number", test: (value) => /[0-9]/.test(value) },
  { label: "Special character", test: (value) => /[^A-Za-z0-9]/.test(value) }
];

const businessTypes = ["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK", "CONVENIENCE_STORE", "GAS_STATION_FOOD_SHOP", "LIQUOR_STORE", "OTHER_FOOD_RETAIL"];
const businessModules = ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"];
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
  NOTIFICATIONS: "PROFESSIONAL",
  ANALYTICS: "ENTERPRISE",
  MENU_INSIGHTS: "ENTERPRISE",
  CUSTOM_DOMAIN: "ENTERPRISE",
  REPORTS: "ENTERPRISE",
  MULTI_LOCATION: "ENTERPRISE"
};
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
  { id: "profile", label: "Profile", detail: "Business name, phone, address, and public restaurant identity.", href: "#settings-profile", status: "Available" },
  { id: "website-branding", label: "Website & Branding", detail: "Homepage copy, logo, hero image, colors, fonts, and section visibility.", href: "#settings-website-branding", status: "Available" },
  { id: "menu-catalog", label: "Menu & Catalog", detail: "Categories, food items, pricing, photos, featured items, and availability.", href: "#settings-menu-catalog", status: "Available" },
  { id: "gallery-social", label: "Gallery & Social", detail: "Public gallery photos and social profile links.", href: "#settings-gallery-social", status: "Available" },
  { id: "ordering", label: "Ordering", detail: "Pickup, delivery, order handling, kitchen flow, and ticket printing.", href: "#settings-ordering", status: "Available" },
  { id: "delivery", label: "Delivery", detail: "Delivery zones, fees, minimums, drivers, and dispatch settings.", href: "#settings-delivery", status: "Available" },
  { id: "domains-seo", label: "Domains & SEO", detail: "Loohar subdomain, custom domain, canonical URL, SSL, and search metadata.", href: "#settings-domains-seo", status: "Available" },
  { id: "payments", label: "Payments", detail: "Payment provider onboarding and restaurant payout readiness.", href: "#settings-payments", status: "Onboarding" },
  { id: "staff-access", label: "Staff & Access", detail: "Managers, cashiers, kitchen staff, drivers, roles, and access status.", href: "#settings-staff-access", status: "Available" },
  { id: "notifications", label: "Notifications", detail: "Customer SMS and email events for orders, receipts, resets, and welcome flows.", href: "#settings-notifications", status: "Available" },
  { id: "billing", label: "Billing", detail: "Subscription plan and account billing status.", href: "#settings-billing", status: "Foundation" },
  { id: "security", label: "Security", detail: "Password policy, session controls, audit trails, and account protection.", href: "#settings-security", status: "Foundation" },
  { id: "advanced", label: "Advanced", detail: "Multi-location foundation and future operational controls.", href: "#settings-advanced", status: "Foundation" }
];
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

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function qrImageData(url) {
  if (!url) return "";
  return QRCode.toDataURL(url, { width: 192, margin: 3, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
}

async function buildReceiptPrintHtml(receipt) {
  const customerQr = await qrImageData(receipt.qr?.customer?.url);
  const driverQr = await qrImageData(receipt.qr?.driver?.url);
  const rows = receipt.items.map((item) => `
    <div class="item">
      <div><strong>${escapeHtml(item.quantity)} x ${escapeHtml(item.name)}</strong>${(item.modifiers || []).map((modifier) => `<small>+ ${escapeHtml(modifier.group ? `${modifier.group}: ` : "")}${escapeHtml(modifier.name)}</small>`).join("")}</div>
      <span>${money(item.totalCents)}</span>
    </div>
  `).join("");
  const totals = receipt.text.totals.map(([label, value]) => `<div class="total"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Receipt #${escapeHtml(receipt.order.orderNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f3f4f6; color: #111827; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .toolbar { display: flex; gap: 8px; justify-content: center; padding: 16px; }
    button { border: 0; border-radius: 8px; background: #111827; color: white; cursor: pointer; font: 700 14px system-ui; padding: 12px 16px; }
    .receipt { width: 80mm; min-height: 100vh; margin: 0 auto; background: white; padding: 14px; }
    .center { text-align: center; }
    .logo { max-width: 48px; max-height: 48px; object-fit: cover; border-radius: 8px; }
    h1 { font-size: 17px; margin: 8px 0 2px; }
    p { margin: 3px 0; font-size: 11px; }
    .rule { border-top: 1px dashed #111827; margin: 10px 0; }
    .meta, .total, .item { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; }
    .item { align-items: flex-start; margin: 7px 0; }
    .item div { max-width: 48mm; }
    small { display: block; color: #374151; margin-top: 2px; }
    .total { margin: 5px 0; }
    .grand { font-size: 14px; border-top: 1px solid #111827; padding-top: 7px; }
    .qr { margin: 12px auto 4px; padding: 10px; background: #fff; width: 210px; text-align: center; }
    .qr img { width: 192px; height: 192px; image-rendering: pixelated; }
    .qr-label { font: 700 11px system-ui; color: #111827; }
    .fallback { overflow-wrap: anywhere; font-size: 9px; color: #374151; }
    @page { size: 80mm auto; margin: 0; }
    @media print {
      body { background: white; }
      .toolbar { display: none !important; }
      .receipt { width: 80mm; margin: 0; padding: 8px; box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Print Receipt</button></div>
  <main class="receipt" aria-label="Loohar receipt">
    <section class="center">
      ${receipt.restaurant.logoUrl ? `<img class="logo" src="${escapeHtml(receipt.restaurant.logoUrl)}" alt="${escapeHtml(receipt.restaurant.name)} logo" />` : ""}
      <h1>${escapeHtml(receipt.restaurant.name)}</h1>
      ${receipt.restaurant.address ? `<p>${escapeHtml(receipt.restaurant.address)}</p>` : ""}
      ${receipt.restaurant.phone ? `<p>${escapeHtml(receipt.restaurant.phone)}</p>` : ""}
    </section>
    <div class="rule"></div>
    <section>
      <div class="meta"><span>Order</span><strong>#${escapeHtml(receipt.order.orderNumber)}</strong></div>
      <div class="meta"><span>Type</span><strong>${escapeHtml(receipt.order.type)}</strong></div>
      <div class="meta"><span>Customer</span><strong>${escapeHtml(receipt.customer.name)}</strong></div>
      <div class="meta"><span>Date</span><strong>${escapeHtml(new Date(receipt.order.createdAt).toLocaleString())}</strong></div>
      <div class="meta"><span>Payment</span><strong>${escapeHtml(receipt.payment.status)}</strong></div>
    </section>
    <div class="rule"></div>
    <section>${rows}</section>
    <div class="rule"></div>
    <section>${totals.replace("Total</span><strong>", "Total</span><strong class=\"grand\">")}</section>
    ${receipt.order.notes ? `<div class="rule"></div><p><strong>Instructions:</strong> ${escapeHtml(receipt.order.notes)}</p>` : ""}
    ${customerQr ? `<section class="qr"><img src="${customerQr}" alt="Customer order tracking QR code" /><p class="qr-label">${escapeHtml(receipt.qr.customer.label)}</p><p class="fallback">${escapeHtml(receipt.qr.customer.webUrl)}</p></section>` : ""}
    ${driverQr ? `<section class="qr"><img src="${driverQr}" alt="Driver delivery QR code" /><p class="qr-label">${escapeHtml(receipt.qr.driver.label)}</p><p class="fallback">${escapeHtml(receipt.qr.driver.webUrl)}</p></section>` : ""}
  </main>
</body>
</html>`;
}

async function openReceiptPrintWindow(receipt) {
  const html = await buildReceiptPrintHtml(receipt);
  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=420,height=760");
  if (!printWindow) throw new Error("Browser blocked the receipt print window. Allow popups for Loohar and try again.");
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.setTimeout(() => printWindow.print(), 500);
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

function restaurantOperationsNavigation(user, restaurantSlug, path) {
  const slug = restaurantSlug || user?.restaurantSlug || "";
  const base = slug ? `/restaurant/${slug}` : "/restaurant";
  const kitchenSlug = slug || user?.restaurantSlug || user?.restaurantId || "";
  const canUseKitchen = ["TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER", "CASHIER", "KITCHEN_STAFF"].includes(user?.role);
  const showSetup = restaurantRoles.includes(user?.role) && (!restaurantOnboardingComplete(user) || path.includes("/onboarding"));
  const items = [
    showSetup ? { label: "Setup", icon: PackageCheck, href: `${base}/onboarding`, active: path.includes("/onboarding") } : null,
    { label: "Dashboard", icon: LayoutDashboard, href: base, active: path === base || path === "/restaurant" },
    { label: "Orders", icon: ReceiptText, href: `${base}#orders` },
    canUseKitchen ? { label: "Kitchen", icon: ReceiptText, href: kitchenSlug ? `/kitchen/${kitchenSlug}` : "/kitchen", active: path.startsWith("/kitchen") } : null,
    { label: "Customers", icon: Users, href: `${base}#customers` },
    { label: "Drivers", icon: Truck, href: `${base}#drivers` },
    { label: "Reports", icon: Activity, href: `${base}#reports` },
    { label: "Settings", icon: UserCog, href: `${base}#settings` }
  ];
  return items.filter(Boolean);
}

function kitchenNavigation(user, kitchenSlug, path) {
  const slug = kitchenSlug || user?.restaurantSlug || "";
  const items = [{ label: "Kitchen", icon: ReceiptText, href: slug ? `/kitchen/${slug}` : "/kitchen", active: path.startsWith("/kitchen") }];
  if (["TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER", "CASHIER"].includes(user?.role)) {
    const restaurantBase = slug ? `/restaurant/${slug}` : "/restaurant";
    items.push({ label: "Orders", icon: ReceiptText, href: `${restaurantBase}#orders` });
  }
  return items;
}

function dashboardPathFor(user) {
  const slug = user?.restaurantSlug || user?.restaurantId || "";
  const restaurantPath = slug ? `/restaurant/${slug}` : "/restaurant";
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
  const slug = user?.restaurantSlug || fallbackSlug || user?.restaurantId || "";
  return slug ? `/restaurant/${slug}/onboarding` : "/restaurant/onboarding";
}

function isRestaurantOnboardingPath(path = "") {
  return path === "/restaurant/onboarding" || /^\/restaurant\/[^/]+\/onboarding\/?$/.test(path);
}

function isAuthPagePath(path = "") {
  return ["/login", "/admin/login", "/restaurant/login", "/forgot-password"].includes(path) || path.startsWith("/reset-password/");
}

function routeSlug(path, prefix) {
  const parts = path.split("/").filter(Boolean);
  return parts[0] === prefix && parts[1] ? parts[1] : "";
}

function canAccessTenantRoute(user, path, prefix) {
  if (!user || user.role === "SUPER_ADMIN") return Boolean(user);
  const slug = routeSlug(path, prefix);
  if (prefix === "restaurant" && slug === "onboarding") return restaurantRoles.includes(user.role);
  return !slug || !user.restaurantSlug || slug === user.restaurantSlug;
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
  if (restaurantRoles.concat(["CASHIER", "KITCHEN_STAFF"]).includes(user?.role) && (requested.startsWith("/restaurant") || requested.startsWith("/kitchen"))) return requested;
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

const fallbackRegistrationPlans = [
  {
    code: "STARTER",
    displayName: "Starter",
    description: "Launch a branded ordering website with pickup.",
    monthlyPriceCents: 9900,
    annualPriceCents: 99000,
    features: ["Direct ordering website", "Pickup ordering", "Basic menu/catalog", "Restaurant onboarding"],
    trialDays: 0,
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
    trialDays: 0,
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
    trialDays: 0,
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
  if (planConfigPending(planConfigStatus)) return { tone: "neutral", label: "Checking checkout" };
  if (planConfigStatus === PLAN_CONFIG_STATUS.ERROR) return { tone: "warn", label: "Checkout not confirmed" };
  return planCheckoutAvailable(plan, interval)
    ? { tone: "good", label: "Checkout ready" }
    : { tone: "warn", label: "Checkout temporarily unavailable" };
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
      setError("Checkout availability could not be confirmed because the live API is offline.");
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
        setError(planError.message || "Checkout availability could not be confirmed. Please try again.");
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
            <span className="font-semibold">{error || "Checkout availability could not be confirmed. Please try again."}</span>
            <button className="button-muted justify-center" type="button" onClick={() => setPlanRequestKey((key) => key + 1)}>Retry</button>
          </div>
        ) : null}
      </section>
      <section className="mt-5 grid gap-4 md:grid-cols-3">
        {planConfigIsPending ? <PlanCardSkeletons count={3} /> : plans.map((plan) => {
          const checkoutStatus = checkoutStatusForPlan(plan, billingInterval, planConfigStatus);
          const available = planConfigStatus === PLAN_CONFIG_STATUS.READY && planCheckoutAvailable(plan, billingInterval);
          return (
            <div className="panel flex flex-col" key={plan.code}>
              <StatusPill tone={checkoutStatus.tone}>{checkoutStatus.label}</StatusPill>
              <h2 className="public-plan-title">{plan.displayName || normalizePlanLabel(plan.code)}</h2>
              <p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">{plan.description}</p>
              <p className="public-plan-price">{money(planPrice(plan, billingInterval))}<span>/{billingInterval === "ANNUAL" ? "year" : "month"}</span></p>
              {plan.trialDays ? <p className="mt-2 text-sm font-bold text-mint">{plan.trialDays}-day trial configured</p> : null}
              <div className="mt-5 space-y-3">
                {(plan.features || []).map((feature) => <p className="flex items-start gap-2 text-sm text-slate-600" key={feature}><CheckCircle2 className="mt-0.5 text-mint" size={16} />{feature}</p>)}
              </div>
              <a className={`mt-6 justify-center ${available ? "button-primary" : "button-muted"}`} href={`/register?plan=${encodeURIComponent(plan.code)}&billingInterval=${billingInterval}`}>
                {available ? "Select plan" : "Start setup"}
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
  const visibleErrors = registrationVisibleErrors(errors, currentStep);
  const planConfigIsPending = planConfigPending(planConfigStatus);
  const checkoutReady = apiOnline && planConfigStatus === PLAN_CONFIG_STATUS.READY && planCheckoutAvailable(selectedPlan, form.billingInterval);

  useEffect(() => {
    if (apiMode === "CHECKING") {
      setPlanConfigStatus(PLAN_CONFIG_STATUS.IDLE);
      setPlanError("");
      return;
    }
    if (!apiOnline) {
      setPlans(fallbackRegistrationPlans);
      setPlanConfigStatus(PLAN_CONFIG_STATUS.ERROR);
      setPlanError("Checkout availability could not be confirmed because the live API is offline.");
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
        setPlanError(planLoadError.message || "Checkout availability could not be confirmed. Please try again.");
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
      else setError(apiOnline ? "Online subscription checkout is temporarily unavailable. Please contact Loohar support to finish setup." : "Live API is required to start checkout.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const started = registration?.id ? { registration } : await api("/api/registration/start", { method: "POST", skipAuth: true, body: form });
      const activeRegistration = started.registration;
      setRegistration(activeRegistration);
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
        <p className="mt-3 max-w-3xl text-slate-500">Create the owner account, reserve your restaurant URL, choose a SaaS plan, and continue through secure Stripe-hosted checkout. Your tenant is created only after Loohar receives a verified Stripe webhook.</p>
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
                Checking secure checkout availability...
              </div>
            ) : null}
            {planConfigStatus === PLAN_CONFIG_STATUS.ERROR ? (
              <div className="mb-4 flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 md:flex-row md:items-center md:justify-between" role="status">
                <span className="font-semibold">{planError || "Checkout availability could not be confirmed. Please try again."}</span>
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
            <SectionHeader eyebrow="Step 4" title="Secure checkout" icon={Shield} />
            <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
              <div>
                <p className="text-sm leading-6 text-slate-500">Review your registration and continue to Stripe-hosted subscription checkout. Loohar provisions your restaurant tenant only after the payment webhook is verified by the API.</p>
                <div className="mt-4 grid gap-2 text-sm">
                  <div className="summary-line"><span>Restaurant</span><strong>{form.publicBusinessName || form.businessName || "Restaurant"}</strong></div>
                  <div className="summary-line"><span>Owner</span><strong>{form.firstName} {form.lastName}</strong></div>
                  <div className="summary-line"><span>Public URL</span><strong>/{form.preferredSlug || "restaurant"}</strong></div>
                  <div className="summary-line"><span>Plan</span><strong>{selectedPlan?.displayName || form.planCode} - {readable(form.billingInterval)}</strong></div>
                </div>
              </div>
              <div className="rounded-md border border-line bg-slate-50 p-4">
                <p className="text-sm font-bold uppercase text-slate-500">Due now</p>
                <p className="public-plan-price compact">{money(planPrice(selectedPlan, form.billingInterval))}</p>
                <p className="mt-2 text-sm text-slate-500">Plan price is resolved by the backend. The browser never submits an amount or Stripe Price ID.</p>
                {planConfigIsPending ? <p className="mt-3 text-sm font-semibold text-slate-600" aria-live="polite">Checking secure checkout availability...</p> : null}
                {planConfigStatus === PLAN_CONFIG_STATUS.ERROR ? (
                  <div className="mt-3 space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <p className="font-semibold">{planError || "Checkout availability could not be confirmed."}</p>
                    <button className="button-muted justify-center" type="button" onClick={() => setPlanRequestKey((key) => key + 1)}>Retry</button>
                  </div>
                ) : null}
                {planConfigStatus === PLAN_CONFIG_STATUS.READY && !checkoutReady ? <p className="mt-3 text-sm font-semibold text-amber-800">Online subscription checkout is temporarily unavailable. Please contact Loohar support to finish setup.</p> : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-between gap-2 border-t border-line pt-4">
          <button className="button-muted" type="button" disabled={stepIndex === 0} onClick={() => setStepIndex((index) => Math.max(index - 1, 0))}>Back</button>
          {currentStep === "checkout"
            ? <button className="button-primary" type="submit" disabled={submitting || !checkoutReady}>{submitting ? "Opening checkout..." : "Start secure checkout"}</button>
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
    ["paymentConfirmed", "Payment confirmed"],
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
        <p className="mt-3 text-slate-500">This page checks backend provisioning. Access is created only after the verified Stripe webhook completes tenant setup.</p>
        <InlineError message={error} />
        {!registration && !error ? <AppLoadingState title="Checking registration" detail="Waiting for payment and provisioning status." /> : null}
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

function RestaurantOnboardingWizard({ apiOnline, token, user, initialSlug = "" }) {
  const [routeRestaurantId, setRouteRestaurantId] = useState("");
  const restaurantKey = user?.restaurantId || routeRestaurantId || initialSlug || user?.restaurantSlug || "";
  const apiBase = restaurantKey ? `/api/restaurants/${restaurantKey}` : "/api/restaurant";
  const [payload, setPayload] = useState(null);
  const [activeStep, setActiveStep] = useState(user?.onboardingCurrentStep || "business");
  const [draft, setDraft] = useState({});
  const [menuDraft, setMenuDraft] = useState({ categoryName: "", itemName: "", itemDescription: "", itemPriceCents: 1295 });
  const [socialDraft, setSocialDraft] = useState({ platform: "instagram", url: "" });
  const [saving, setSaving] = useState("");
  const [uploading, setUploading] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [merchantAccount, setMerchantAccount] = useState(null);
  const [platformSubscription, setPlatformSubscription] = useState(null);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

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

  function stepEndpoint(step = activeStep) {
    return `${apiBase}/onboarding/${step}`;
  }

  function normalizePayload(nextPayload) {
    setPayload(nextPayload);
    const nextRestaurant = nextPayload.restaurant || {};
    const nextWebsite = nextPayload.website || {};
    const nextDomain = nextPayload.domain || {};
    const nextOwner = nextPayload.owner || {};
    const nextDeliveryZones = nextPayload.deliveryZones || [];
    const nextHours = nextWebsite.storeHoursJson || nextRestaurant.storeHoursJson || {
      monday: "11:00 AM - 9:00 PM",
      tuesday: "11:00 AM - 9:00 PM",
      wednesday: "11:00 AM - 9:00 PM",
      thursday: "11:00 AM - 9:00 PM",
      friday: "11:00 AM - 10:00 PM",
      saturday: "11:00 AM - 10:00 PM",
      sunday: "Closed"
    };
    setDraft({
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
      brandColor: nextWebsite.brandColor || "#1f9d80",
      accentColor: nextWebsite.accentColor || "#f4b740",
      buttonColor: nextWebsite.buttonColor || nextWebsite.brandColor || "#1f9d80",
      headingFont: nextWebsite.headingFont || "",
      bodyFont: nextWebsite.bodyFont || "",
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
      sectionSettingsJson: { ...websiteSectionDefaults, ...(nextWebsite.sectionSettingsJson || {}) },
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
    });
    setActiveStep(nextPayload.progress?.currentStep || user?.onboardingCurrentStep || "business");
  }

  async function resolveRouteRestaurant() {
    if (!apiOnline || !token || user?.restaurantId || !initialSlug || user?.role !== "SUPER_ADMIN") return;
    const tenants = await api("/api/admin/tenants", { token });
    const tenant = (tenants.businesses || tenants.restaurants || []).find((item) => item.slug === initialSlug || item.id === initialSlug);
    if (tenant?.id) setRouteRestaurantId(tenant.id);
  }

  async function loadOnboarding() {
    if (!apiOnline || !token || !restaurantKey) return;
    setError("");
    try {
      const nextPayload = await api(`${apiBase}/onboarding`, { token });
      normalizePayload(nextPayload);
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  async function loadPaymentSetup() {
    if (!apiOnline || !token || activeStep !== "payments") return;
    setPaymentsLoading(true);
    setError("");
    try {
      const [subscriptionPayload, merchantPayload] = await Promise.all([
        api("/api/platform-billing/subscription", { token }).catch((subscriptionError) => ({ error: subscriptionError.message })),
        api("/api/order-payments/merchant-account", { token }).catch((merchantError) => ({ error: merchantError.message }))
      ]);
      if (!subscriptionPayload.error) setPlatformSubscription(subscriptionPayload.subscription || null);
      if (!merchantPayload.error) setMerchantAccount(merchantPayload.merchantAccount || null);
      if (subscriptionPayload.error || merchantPayload.error) {
        setError([subscriptionPayload.error, merchantPayload.error].filter(Boolean).join(" "));
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
      setError(portalError.message);
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

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateSection(section, value) {
    setDraft((current) => ({ ...current, sectionSettingsJson: { ...(current.sectionSettingsJson || {}), [section]: value } }));
  }

  function updateHour(day, value) {
    setDraft((current) => ({ ...current, storeHoursJson: { ...(current.storeHoursJson || {}), [day]: value } }));
  }

  function bodyForStep(step) {
    if (step === "business") {
      return {
        businessName: draft.businessName,
        publicBusinessName: draft.publicBusinessName,
        businessType: draft.businessType,
        categoryLabel: draft.categoryLabel,
        description: draft.description,
        businessEmail: draft.businessEmail,
        phone: draft.phone,
        address: draft.address,
        city: draft.city,
        state: draft.state,
        zip: draft.zip,
        timezone: draft.timezone,
        pickupEnabled: draft.pickupEnabled,
        deliveryEnabled: draft.deliveryEnabled,
        enabledModules: businessModules
      };
    }
    if (step === "owner") return { ownerName: draft.ownerName, ownerEmail: draft.ownerEmail, ownerPhone: draft.ownerPhone };
    if (step === "branding") {
      return {
        logoUrl: draft.logoUrl,
        heroImageUrl: draft.heroImageUrl,
        mobileHeroImageUrl: draft.mobileHeroImageUrl,
        faviconUrl: draft.faviconUrl,
        brandColor: draft.brandColor,
        accentColor: draft.accentColor,
        buttonColor: draft.buttonColor,
        headingFont: draft.headingFont,
        bodyFont: draft.bodyFont
      };
    }
    if (step === "content") {
      return {
        heroTitle: draft.heroTitle,
        heroSubtitle: draft.heroSubtitle,
        tagline: draft.tagline,
        cuisineType: draft.cuisineType,
        aboutTitle: draft.aboutTitle,
        aboutStory: draft.aboutStory,
        missionStatement: draft.missionStatement,
        ownerStory: draft.ownerStory,
        specialOfferText: draft.specialOfferText,
        ctaText: draft.ctaText,
        contactMessage: draft.contactMessage,
        cateringMessage: draft.cateringMessage,
        publicEmail: draft.publicEmail,
        sectionSettingsJson: draft.sectionSettingsJson
      };
    }
    if (step === "hours") return { storeHoursJson: draft.storeHoursJson };
    if (step === "fulfillment") {
      return {
        pickupEnabled: draft.pickupEnabled,
        deliveryEnabled: draft.deliveryEnabled,
        deliveryFeeCents: Number(draft.deliveryFeeCents || 0),
        deliveryRadiusMiles: Number(draft.deliveryRadiusMiles || 0),
        minimumOrderCents: Number(draft.minimumOrderCents || 0),
        averagePrepMinutes: Number(draft.averagePrepMinutes || 20),
        tipsEnabled: draft.tipsEnabled !== false,
        deliveryZone: draft.deliveryEnabled ? {
          name: draft.deliveryZoneName || "Local Delivery",
          radiusMiles: Number(draft.deliveryRadiusMiles || 0),
          deliveryFeeCents: Number(draft.deliveryFeeCents || 0),
          minimumOrderCents: Number(draft.minimumOrderCents || 0),
          active: true
        } : null
      };
    }
    if (step === "domain") {
      return {
        defaultSubdomain: draft.defaultSubdomain,
        customDomain: draft.customDomain,
        seoTitle: draft.seoTitle,
        seoDescription: draft.seoDescription,
        seoKeywords: draft.seoKeywords,
        canonicalUrl: draft.canonicalUrl,
        ogImageUrl: draft.ogImageUrl,
        indexingEnabled: draft.indexingEnabled !== false
      };
    }
    if (step === "payments") return { paymentSetup: { provider: draft.paymentProvider, status: draft.paymentStatus } };
    return {};
  }

  async function saveStep(step = activeStep) {
    if (!apiOnline || !token) {
      setError("Live API connection and restaurant login are required for onboarding.");
      return;
    }
    setSaving(step);
    setError("");
    setMessage("");
    try {
      const nextPayload = await api(stepEndpoint(step), { method: "PATCH", token, body: bodyForStep(step) });
      normalizePayload(nextPayload);
      setMessage(`${onboardingSteps.find((item) => item.id === step)?.label || "Step"} saved.`);
    } catch (saveError) {
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
    setMessage("");
    try {
      const nextPayload = await api(`${apiBase}/onboarding/${step}/skip`, { method: "POST", token });
      normalizePayload(nextPayload);
      setMessage(`${onboardingSteps.find((item) => item.id === step)?.label || "Step"} skipped for now.`);
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
        ["logoUrl", "heroImageUrl", "mobileHeroImageUrl", "faviconUrl"].forEach((field) => {
          if (uploaded.website[field]) updateDraft(field, uploaded.website[field]);
        });
      }
      if (uploaded.restaurant?.logoUrl) updateDraft("logoUrl", uploaded.restaurant.logoUrl);
      setMessage("Image uploaded and saved.");
      await loadOnboarding();
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
      setMessage("Gallery photo uploaded.");
      await loadOnboarding();
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading("");
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
      setMessage("Menu item image uploaded.");
      await loadOnboarding();
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
      await loadOnboarding();
      setMessage("Menu category added.");
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
      await loadOnboarding();
      setMessage("Menu item added.");
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
      await loadOnboarding();
      setMessage("Social link saved.");
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
      normalizePayload(nextPayload);
      setMessage(nextPayload.readiness?.orderingReady ? "Website and ordering are live." : "Website is live. Payments are still required before paid ordering.");
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
    setActiveStep(next.id);
  }

  function previousStep() {
    const previous = onboardingSteps[Math.max(0, currentStepIndex - 1)];
    setActiveStep(previous.id);
  }

  function Field({ label, children }) {
    return <label className="grid gap-1 text-sm font-semibold text-slate-600"><span>{label}</span>{children}</label>;
  }

  function TextInput({ field, type = "text", placeholder = "", rows = 0 }) {
    if (rows) return <textarea className="input min-h-28" value={draft[field] || ""} placeholder={placeholder} onChange={(event) => updateDraft(field, event.target.value)} />;
    return <input className="input" type={type} value={draft[field] ?? ""} placeholder={placeholder} onChange={(event) => updateDraft(field, type === "number" ? event.target.valueAsNumber || 0 : event.target.value)} />;
  }

  function Toggle({ field, label }) {
    return (
      <button type="button" className={`nav-tab ${draft[field] ? "active" : ""}`} onClick={() => updateDraft(field, !draft[field])}>
        {draft[field] ? <CheckCircle2 size={16} /> : null}{label}
      </button>
    );
  }

  function StepStatus({ step }) {
    const done = readiness.sections?.[step.id];
    const active = activeStep === step.id;
    return (
      <button className={`nav-tab justify-start ${active ? "active" : ""}`} type="button" onClick={() => setActiveStep(step.id)}>
        <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-black ${done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{done ? "✓" : onboardingSteps.findIndex((item) => item.id === step.id) + 1}</span>
        {step.label}
      </button>
    );
  }

  if (!apiOnline) return <AccessDenied title="Live API required" detail="Restaurant onboarding saves directly to PostgreSQL and requires the live API." loginHref="/restaurant/login" />;
  if (!payload) return <AppLoadingState title="Loading onboarding" detail="Preparing the restaurant setup checklist." />;

  return (
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
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{message}</div> : null}

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <aside className="grid gap-2 self-start rounded-md border border-line bg-white p-3">
          {onboardingSteps.map((step) => <StepStatus step={step} key={step.id} />)}
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
          </div>

          {activeStep === "business" ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="Legal business name"><TextInput field="businessName" /></Field>
              <Field label="Public restaurant name"><TextInput field="publicBusinessName" /></Field>
              <Field label="Business type"><select className="input" value={draft.businessType || "RESTAURANT"} onChange={(event) => updateDraft("businessType", event.target.value)}>{businessTypes.map((type) => <option key={type} value={type}>{readable(type)}</option>)}</select></Field>
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
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Brand color"><TextInput field="brandColor" type="color" /></Field>
                <Field label="Accent color"><TextInput field="accentColor" type="color" /></Field>
                <Field label="Button color"><TextInput field="buttonColor" type="color" /></Field>
                <Field label="Heading font"><TextInput field="headingFont" placeholder="Inter, serif, system" /></Field>
                <Field label="Body font"><TextInput field="bodyFont" placeholder="Inter, system" /></Field>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <label className="button-muted justify-center">Upload logo<input className="sr-only" type="file" accept={logoImageAccept} onChange={(event) => uploadOnboardingImage("restaurant-logo", event)} /></label>
                <label className="button-muted justify-center">Upload hero<input className="sr-only" type="file" accept={photoImageAccept} onChange={(event) => uploadOnboardingImage("restaurant-hero", event)} /></label>
                <label className="button-muted justify-center">Mobile hero<input className="sr-only" type="file" accept={photoImageAccept} onChange={(event) => uploadOnboardingImage("restaurant-mobile-hero", event)} /></label>
                <label className="button-muted justify-center">Favicon<input className="sr-only" type="file" accept={logoImageAccept} onChange={(event) => uploadOnboardingImage("restaurant-favicon", event)} /></label>
              </div>
              {uploading ? <p className="text-sm font-bold text-slate-500">Uploading {readable(uploading)}...</p> : null}
              <div className="grid gap-4 md:grid-cols-3">
                {draft.logoUrl ? <img className="h-32 w-full rounded-md object-cover" src={resolveImage(draft.logoUrl)} alt="Logo preview" onError={handleSafeImageError} /> : null}
                {draft.heroImageUrl ? <img className="h-32 w-full rounded-md object-cover" src={resolveImage(draft.heroImageUrl)} alt="Hero preview" onError={handleSafeImageError} /> : null}
                {draft.mobileHeroImageUrl ? <img className="h-32 w-full rounded-md object-cover" src={resolveImage(draft.mobileHeroImageUrl)} alt="Mobile hero preview" onError={handleSafeImageError} /> : null}
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
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {Object.entries(draft.storeHoursJson || {}).map(([day, value]) => <Field label={readable(day)} key={day}><input className="input" value={value || ""} onChange={(event) => updateHour(day, event.target.value)} /></Field>)}
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
                <input className="input" value={menuDraft.categoryName} placeholder="Quick add category" onChange={(event) => setMenuDraft((current) => ({ ...current, categoryName: event.target.value }))} />
                <button className="button-primary" disabled={saving === "menu-category"}>{saving === "menu-category" ? "Adding..." : "Add category"}</button>
              </form>
              <form className="grid gap-3 md:grid-cols-4" onSubmit={createQuickItem}>
                <input className="input" value={menuDraft.itemName} placeholder="Featured item name" onChange={(event) => setMenuDraft((current) => ({ ...current, itemName: event.target.value }))} />
                <input className="input" value={menuDraft.itemDescription} placeholder="Description" onChange={(event) => setMenuDraft((current) => ({ ...current, itemDescription: event.target.value }))} />
                <input className="input" type="number" value={menuDraft.itemPriceCents} onChange={(event) => setMenuDraft((current) => ({ ...current, itemPriceCents: event.target.valueAsNumber || 0 }))} />
                <button className="button-primary" disabled={saving === "menu-item"}>{saving === "menu-item" ? "Adding..." : "Add item"}</button>
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
              <button className="button-primary justify-center" type="button" onClick={() => saveStep("menu")}>Mark menu reviewed</button>
            </div>
          ) : null}

          {activeStep === "gallery" ? (
            <div className="mt-5 grid gap-5">
              <div className="flex flex-wrap gap-2">
                <label className="button-muted">Upload gallery photo<input className="sr-only" type="file" accept={photoImageAccept} onChange={uploadGallery} /></label>
                <button className="button-primary" type="button" onClick={() => saveStep("gallery")}>Save gallery step</button>
              </div>
              <div className="grid gap-3 md:grid-cols-4">{gallery.slice(0, 8).map((image) => <img className="h-28 w-full rounded-md object-cover" src={resolveImage(image.imageUrl)} alt={image.altText || "Restaurant gallery"} key={image.id} onError={handleSafeImageError} />)}</div>
              <form className="grid gap-3 md:grid-cols-[180px_1fr_auto]" onSubmit={addSocial}>
                <select className="input" value={socialDraft.platform} onChange={(event) => setSocialDraft((current) => ({ ...current, platform: event.target.value }))}>{Object.keys(socialPlatformLabels).map((platform) => <option key={platform} value={platform}>{socialPlatformLabels[platform]}</option>)}</select>
                <input className="input" value={socialDraft.url} placeholder="https://instagram.com/restaurant" onChange={(event) => setSocialDraft((current) => ({ ...current, url: event.target.value }))} />
                <button className="button-primary" disabled={saving === "social"}>{saving === "social" ? "Saving..." : "Add social"}</button>
              </form>
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
                  <StatusPill tone={platformSubscription?.status === "ACTIVE" ? "good" : platformSubscription ? "warn" : "neutral"}>{platformSubscription?.status || "Not found"}</StatusPill>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-slate-600">
                  <div className="summary-line"><span>Plan</span><strong>{readable(platformSubscription?.plan?.code || restaurant.plan || "Starter")}</strong></div>
                  <div className="summary-line"><span>Current period</span><strong>{platformSubscription?.currentPeriodEnd ? new Date(platformSubscription.currentPeriodEnd).toLocaleDateString() : "Provider managed"}</strong></div>
                </div>
                <button className="button-muted mt-4 w-full justify-center" type="button" onClick={openPlatformBillingPortal} disabled={paymentsLoading || saving === "billing-portal"}>{saving === "billing-portal" ? "Opening..." : "Manage Loohar billing"}</button>
              </div>
              <div className="rounded-md border border-line bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-slate-500">Customer order payments</p>
                    <h3 className="mt-1 text-xl font-black text-ink">Restaurant merchant account</h3>
                    <p className="mt-2 text-sm text-slate-500">Customers pay the restaurant through Stripe Connect. Loohar does not collect bank details, SSN, or card data.</p>
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
    restaurant: "RESTAURANT_OWNER",
    driver: "DRIVER",
    customer: "CUSTOMER"
  };
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
    onLogin(sessionPayload);
    setSession(sessionPayload);
    if (requiresPasswordChange(normalizedUser)) {
      setStep("password");
      return;
    }
    if (normalizedUser?.mfaEnabled) {
      setStep("mfa");
      return;
    }
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
        body: { role: demoRoleByMode[mode] || "SUPER_ADMIN" },
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
            {import.meta.env.DEV ? <button className="button-muted justify-center" type="button" disabled={loading} onClick={submitDemoLogin}>Use seeded development account</button> : null}
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
      await api("/api/admin/tenants", { method: "POST", token, body: tenantCreatePayload(nextForm) });
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
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <select className="select" value={form.plan} onChange={(event) => setForm({ ...form, plan: event.target.value })}>
              {planCodes.map((plan) => <option value={plan} key={plan}>{readable(plan)}</option>)}
            </select>
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

function RestaurantApp({ apiOnline, token, user, initialSlug = "" }) {
  const [routeRestaurantId, setRouteRestaurantId] = useState("");
  const restaurantId = user?.restaurantId || routeRestaurantId;
  const [profile, setProfile] = useState(demoRestaurant);
  const [stats, setStats] = useState({ ordersToday: demoOrders.length, pendingOrders: 2, activeDrivers: demoDrivers.filter((driver) => driver.available).length, sales: { amountCents: 9621, driverTipCents: 1500 } });
  const [categories, setCategories] = useState(demoRestaurant.categories);
  const [items, setItems] = useState(demoRestaurant.categories.flatMap((category) => category.items.map((item) => ({ ...item, category }))));
  const [orders, setOrders] = useState(demoOrders);
  const [drivers, setDrivers] = useState(demoDrivers);
  const [customers, setCustomers] = useState(demoCustomers);
  const [customerSummary, setCustomerSummary] = useState(demoCustomerSummary);
  const [loyalty, setLoyalty] = useState(demoGrowth.loyalty);
  const [promotions, setPromotions] = useState(demoGrowth.promotions);
  const [growthAnalytics, setGrowthAnalytics] = useState(demoGrowth.analytics);
  const [menuInsights, setMenuInsights] = useState(demoGrowth.menuInsights);
  const [locations, setLocations] = useState(demoGrowth.locations);
  const [website, setWebsite] = useState(demoWebsiteSettings);
  const [domain, setDomain] = useState(demoDomain);
  const [gallery, setGallery] = useState(demoGallery);
  const [socialLinks, setSocialLinks] = useState(demoSocialLinks);
  const [employees, setEmployees] = useState(demoEmployees);
  const [dispatch, setDispatch] = useState(demoDispatch);
  const [deliveryZones, setDeliveryZones] = useState(demoDeliveryZones);
  const [inventoryItems, setInventoryItems] = useState(demoInventoryItems);
  const [printerSettings, setPrinterSettings] = useState(demoPrinterSettings);
  const [notificationSettings, setNotificationSettings] = useState(demoNotificationSettings);
  const [operationsReport, setOperationsReport] = useState(demoOperationsReport);
  const [featureLocks, setFeatureLocks] = useState({});
  const [error, setError] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [itemForm, setItemForm] = useState({ categoryId: "", name: "", priceCents: 1295, preparationTimeMins: 15, description: "", calories: "", spiceLevel: "", featured: false, available: true });
  const [newItemImage, setNewItemImage] = useState(null);
  const [itemFileInputKey, setItemFileInputKey] = useState(0);
  const [uploadingAsset, setUploadingAsset] = useState("");
  const [savingAction, setSavingAction] = useState("");
  const [menuValidation, setMenuValidation] = useState({});
  const [websiteSaveState, setWebsiteSaveState] = useState("idle");
  const [websiteDirty, setWebsiteDirty] = useState(false);
  const [websiteLastSavedAt, setWebsiteLastSavedAt] = useState(null);
  const [toast, setToast] = useState(null);
  const [galleryForm, setGalleryForm] = useState({ title: "", altText: "", caption: "", category: "food", published: true });
  const [socialForm, setSocialForm] = useState({ platform: "instagram", url: "" });
  const [employeeForm, setEmployeeForm] = useState({ name: "", email: "", phone: "", role: "KITCHEN_STAFF" });
  const [zoneForm, setZoneForm] = useState({ name: "Zone A", radiusMiles: 3, deliveryFeeCents: 399, minimumOrderCents: 1500 });
  const [inventoryForm, setInventoryForm] = useState({ name: "Chicken", quantity: 10, unit: "lb", costCents: 2500 });
  const publicPreviewPath = publicPathForSlug(profile.slug || "demo-bistro");
  const publicSiteUrl = canonicalTenantUrlFor(profile, domain);

  function showToast(message, tone = "good") {
    setToast({ message, tone, id: Date.now() });
    window.clearTimeout(showToast.timeoutId);
    showToast.timeoutId = window.setTimeout(() => setToast(null), 4200);
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

  async function loadRestaurant() {
    if (!apiOnline || !token || !restaurantId) return;
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
      const [dashboardPayload, profilePayload, categoriesPayload, itemsPayload, ordersPayload, driversPayload, customersPayload, customerSummaryPayload, loyaltyPayload, promotionsPayload, analyticsPayload, menuInsightsPayload, locationsPayload, websitePayload, domainPayload, galleryPayload, socialPayload, employeesPayload, dispatchPayload, zonesPayload, inventoryPayload, printingPayload, notificationsPayload, operationsPayload] = await Promise.all([
        api(`/api/restaurants/${restaurantId}/dashboard`, { token }),
        api(`/api/restaurants/${restaurantId}/profile`, { token }),
        api(`/api/restaurants/${restaurantId}/menu/categories`, { token }),
        api(`/api/restaurants/${restaurantId}/menu/items`, { token }),
        api(`/api/restaurants/${restaurantId}/orders`, { token }),
        optionalApi("DRIVER_MANAGEMENT", `/api/restaurants/${restaurantId}/drivers`, { drivers: [] }),
        optionalApi("CUSTOMER_CRM", `/api/restaurants/${restaurantId}/customers`, { customers: [] }),
        optionalApi("CUSTOMER_CRM", `/api/restaurants/${restaurantId}/customers/summary`, { totalCustomers: 0, newCustomersThisMonth: 0, repeatCustomerPercentage: 0, vipCustomerCount: 0 }),
        optionalApi("LOYALTY", `/api/restaurants/${restaurantId}/loyalty`, { analytics: {}, rewards: [], topCustomers: [] }),
        optionalApi("COUPONS", `/api/restaurants/${restaurantId}/promotions/analytics`, { activePromotions: [], redemptions: [], performance: {} }),
        optionalApi("ANALYTICS", `/api/restaurants/${restaurantId}/analytics`, { metrics: {}, salesTrend: [], ordersTrend: [], customerGrowth: [], loyaltyGrowth: [] }),
        optionalApi("MENU_INSIGHTS", `/api/restaurants/${restaurantId}/menu/insights`, { bestSellingItems: [], worstSellingItems: [], categoryPerformance: [] }),
        optionalApi("MULTI_LOCATION", `/api/restaurants/${restaurantId}/locations`, { locations: [] }),
        api(`/api/restaurants/${restaurantId}/website`, { token }),
        optionalApi("CUSTOM_DOMAIN", `/api/restaurants/${restaurantId}/domain`, { domain: demoDomain }),
        api(`/api/restaurants/${restaurantId}/gallery`, { token }),
        api(`/api/restaurants/${restaurantId}/social-links`, { token }),
        optionalApi("EMPLOYEE_MANAGEMENT", `/api/restaurants/${restaurantId}/employees`, { employees: [] }),
        optionalApi("DRIVER_MANAGEMENT", `/api/restaurants/${restaurantId}/dispatch`, { availableDrivers: [], busyDrivers: [], offlineDrivers: [], deliveries: [] }),
        optionalApi("DELIVERY_ZONES", `/api/restaurants/${restaurantId}/delivery-zones`, { zones: [] }),
        optionalApi("INVENTORY", `/api/restaurants/${restaurantId}/inventory`, { items: [] }),
        optionalApi("PRINTING", `/api/restaurants/${restaurantId}/printing`, { settings: {} }),
        optionalApi("NOTIFICATIONS", `/api/restaurants/${restaurantId}/notification-settings`, { settings: {} }),
        optionalApi("REPORTS", `/api/restaurants/${restaurantId}/reports/operations`, { sales: {}, items: {}, customers: {}, drivers: [] })
      ]);
      setFeatureLocks(lockedFeatures);
      setStats(dashboardPayload);
      setProfile(profilePayload.restaurant || demoRestaurant);
      setCategories(categoriesPayload.categories || []);
      setItems(itemsPayload.items || []);
      setOrders(ordersPayload.orders || []);
      setDrivers(driversPayload.drivers || []);
      setCustomers(customersPayload.customers || []);
      setCustomerSummary(customerSummaryPayload);
      setLoyalty(loyaltyPayload);
      setPromotions(promotionsPayload);
      setGrowthAnalytics(analyticsPayload);
      setMenuInsights(menuInsightsPayload);
      setLocations(locationsPayload.locations || []);
      setWebsite(websitePayload.website || demoWebsiteSettings);
      setDomain(domainPayload.domain || demoDomain);
      setGallery(galleryPayload.gallery || []);
      setSocialLinks(socialPayload.socialLinks || []);
      setEmployees(employeesPayload.employees || []);
      setDispatch(dispatchPayload || { availableDrivers: [], busyDrivers: [], offlineDrivers: [], deliveries: [] });
      setDeliveryZones(zonesPayload.zones || []);
      setInventoryItems(inventoryPayload.items || []);
      setPrinterSettings(printingPayload.settings || {});
      setNotificationSettings(notificationsPayload.settings || {});
      setOperationsReport(operationsPayload || { sales: {}, items: {}, customers: {}, drivers: [] });
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    loadRestaurant();
  }, [apiOnline, token, restaurantId]);

  useEffect(() => {
    if (!apiOnline || !restaurantId) return undefined;
    const socket = io(API_ORIGIN, { transports: ["websocket", "polling"] });
    const refresh = () => loadRestaurant();
    socket.on("connect", () => {
      socket.emit("join:restaurant", restaurantId);
      socket.emit("join:kitchen", restaurantId);
    });
    socket.on("order:update", refresh);
    socket.on("delivery:update", refresh);
    socket.on("kitchen:update", refresh);
    return () => socket.disconnect();
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
    if (!apiOnline) {
      setCategories((current) => [...current, { id: crypto.randomUUID(), name, active: true, sortOrder: current.length + 1, items: [] }]);
      setCategoryName("");
      setSavingAction("");
      return showToast("Category created in demo mode.");
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
    setCategories((current) => current.map((item) => item.id === category.id ? next : item).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
    setSavingAction(`category:${category.id}`);
    if (!apiOnline) {
      setSavingAction("");
      return showToast(message);
    }
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
    setGallery((current) => current.map((item) => {
      if (item.id === sorted[index].id) return { ...item, sortOrder: swapSort };
      if (item.id === sorted[swapIndex].id) return { ...item, sortOrder: currentSort };
      return item;
    }).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
    if (!apiOnline) {
      setSavingAction("");
      return showToast("Gallery order updated.");
    }
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
    setGallery((current) => current.map((item) => (item.id === image.id ? { ...item, ...updates } : item)));
    if (!apiOnline) {
      setSavingAction("");
      return showToast(message);
    }
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
    if (!apiOnline) {
      setCategories((current) => current.filter((item) => item.id !== categoryId));
      setSavingAction("");
      return showToast("Category removed in demo mode.");
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
    if (!apiOnline) {
      setItems((current) => [...current, { ...payload, id: crypto.randomUUID(), imageUrl: newItemImage ? globalThis.URL.createObjectURL(newItemImage) : "", available: true }]);
      setItemForm({ categoryId: categories[0]?.id || "", name: "", priceCents: 1295, preparationTimeMins: 15, description: "", calories: "", spiceLevel: "", featured: false, available: true });
      setNewItemImage(null);
      setItemFileInputKey((key) => key + 1);
      setSavingAction("");
      return showToast("Menu item created in demo mode.");
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
    if (!apiOnline) {
      setItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, ...payload } : currentItem));
      setSavingAction("");
      return showToast(message);
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

  async function duplicateItem(item) {
    const source = itemPayloadFromRow(item);
    const payload = { ...source, name: `${source.name} Copy`, available: false, featured: false, recommended: false, options: [] };
    setSavingAction(`item:${item.id}:duplicate`);
    if (!apiOnline) {
      setItems((current) => [...current, { ...item, ...payload, id: crypto.randomUUID(), imageUrl: item.imageUrl }]);
      setSavingAction("");
      return showToast("Menu item duplicated in demo mode.");
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
    if (!apiOnline) {
      setItems((current) => current.filter((item) => item.id !== itemId));
      setSavingAction("");
      return showToast("Menu item deleted in demo mode.");
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
    if (!apiOnline) return setOrders((current) => current.map((currentOrder) => currentOrder.id === order.id ? { ...currentOrder, status } : currentOrder));
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
    if (!apiOnline) return setOrders((current) => current.map((currentOrder) => currentOrder.id === order.id ? { ...currentOrder, delivery: { driver } } : currentOrder));
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
    if (!apiOnline) {
      setWebsiteDirty(false);
      setWebsiteSaveState("saved");
      setWebsiteLastSavedAt(new Date());
      setSavingAction("");
      return showToast("Website settings saved in demo mode.");
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
    setWebsiteField(field, null);
    if (isLogo) setProfileField("logoUrl", null);
    setSavingAction(`website:${field}:remove`);
    if (!apiOnline) {
      setSavingAction("");
      return showToast(`${isLogo ? "Logo" : "Hero image"} removed in demo mode.`);
    }
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
    if (!apiOnline) {
      setDomain(data);
      setSavingAction("");
      return showToast("Domain settings saved in demo mode.");
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
    if (!apiOnline) {
      setDomain({ ...domain, domainStatus: "VERIFIED", sslStatus: "SSL_PENDING" });
      setSavingAction("");
      return showToast("Domain marked verified in demo mode.");
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
    if (!apiOnline) {
      setSavingAction("");
      setError("Live API connection is required to save social links.");
      return showToast("Live API connection is required to save social links.", "bad");
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
    if (!apiOnline) return showToast("Live API connection is required to update social links.", "bad");
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
    if (!apiOnline) return;
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
    if (!apiOnline) {
      setGallery((current) => current.filter((image) => image.id !== imageId));
      setSavingAction("");
      return showToast("Gallery photo removed in demo mode.");
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
    if (!apiOnline) return setError("Live API connection is required to create employees.");
    try {
      await api(`/api/restaurants/${restaurantId}/employees`, { method: "POST", token, body: employeeForm });
      setEmployeeForm({ name: "", email: "", phone: "", role: "KITCHEN_STAFF" });
      await loadRestaurant();
    } catch (employeeError) {
      setError(employeeError.message);
    }
  }

  async function disableEmployee(employee) {
    if (!apiOnline) return;
    try {
      await api(`/api/restaurants/${restaurantId}/employees/${employee.id}/disable`, { method: "PATCH", token });
      await loadRestaurant();
    } catch (employeeError) {
      setError(employeeError.message);
    }
  }

  async function assignDispatchDelivery(delivery, driverId) {
    if (!driverId) return setError("Select or create an available driver first.");
    if (!apiOnline) return setError("Live API connection is required to assign deliveries.");
    try {
      await api(`/api/restaurants/${restaurantId}/deliveries/${delivery.id}/assign-driver`, { method: "PATCH", token, body: { driverId } });
      await loadRestaurant();
    } catch (dispatchError) {
      setError(dispatchError.message);
    }
  }

  async function cancelDispatchAssignment(delivery) {
    if (!apiOnline) return setError("Live API connection is required to cancel dispatch assignments.");
    try {
      await api(`/api/restaurants/${restaurantId}/deliveries/${delivery.id}/cancel-assignment`, { method: "PATCH", token });
      await loadRestaurant();
    } catch (dispatchError) {
      setError(dispatchError.message);
    }
  }

  async function savePrinterSettings(next = printerSettings) {
    if (!apiOnline) return setPrinterSettings(next);
    try {
      const payload = await api(`/api/restaurants/${restaurantId}/printing`, { method: "PATCH", token, body: next });
      setPrinterSettings(payload.settings);
    } catch (printError) {
      setError(printError.message);
    }
  }

  async function printTestReceipt() {
    try {
      await openReceiptPrintWindow({
        kind: "test",
        order: { id: "test", orderNumber: "TEST", type: "PICKUP", status: "READY", createdAt: new Date().toISOString(), notes: "Local printer test" },
        restaurant: { name: profile.businessName || profile.name || "Loohar Restaurant", logoUrl: profile.logoUrl || "", address: fullRestaurantAddress(profile), phone: profile.phone || "" },
        customer: { name: "Printer Test" },
        items: [
          { id: "test-1", quantity: 1, name: "Kitchen ticket line", totalCents: 0, modifiers: [{ name: "Thermal printer check", priceCents: 0 }] },
          { id: "test-2", quantity: 1, name: "Customer receipt line", totalCents: 0, modifiers: [] }
        ],
        text: { totals: [["Subtotal", "$0.00"], ["Tax", "$0.00"], ["Total", "$0.00"]] },
        payment: { status: "TEST" },
        qr: { customer: null, driver: null }
      });
    } catch (printError) {
      setError(printError.message);
    }
  }

  async function printOrderTicket(order, kind) {
    if (!apiOnline) {
      return openReceiptPrintWindow({
        kind,
        order: { id: order.id, orderNumber: order.orderNumber, type: order.type || "PICKUP", status: order.status || "PENDING", createdAt: order.createdAt || new Date().toISOString(), notes: order.notes || "" },
        restaurant: { name: profile.businessName || profile.name || "Loohar Restaurant", logoUrl: profile.logoUrl || "", address: fullRestaurantAddress(profile), phone: profile.phone || "" },
        customer: { name: order.customer?.name || "Customer" },
        items: (order.items || []).map((item) => ({ ...item, totalCents: (item.quantity || 1) * (item.unitPriceCents || item.priceCents || 0), modifiers: [] })),
        text: { totals: [["Subtotal", money(order.subtotalCents || order.totalCents || 0)], ["Restaurant tip", money(order.restaurantTipCents || 0)], ["Driver tip", money(order.driverTipCents ?? order.tipCents ?? 0)], ["Total", money(order.totalCents || 0)]] },
        payment: { status: order.payment?.status || "PENDING" },
        qr: { customer: null, driver: null }
      });
    }
    try {
      const path = kind === "kitchen" ? "print-kitchen-ticket" : kind === "driver" ? "print-driver-slip" : "print-customer-receipt";
      const payload = await api(`/api/restaurants/${restaurantId}/orders/${order.id}/${path}`, { method: "POST", token });
      await openReceiptPrintWindow(payload.receipt);
    } catch (printError) {
      setError(printError.message);
    }
  }

  async function saveNotificationSettings(next = notificationSettings) {
    if (!apiOnline) return setNotificationSettings(next);
    try {
      const payload = await api(`/api/restaurants/${restaurantId}/notification-settings`, { method: "PATCH", token, body: next });
      setNotificationSettings(payload.settings);
    } catch (notificationError) {
      setError(notificationError.message);
    }
  }

  async function createDeliveryZone(event) {
    event.preventDefault();
    if (!apiOnline) {
      setDeliveryZones((current) => [...current, { ...zoneForm, id: crypto.randomUUID(), active: true }]);
      return setZoneForm({ name: `Zone ${String.fromCharCode(65 + deliveryZones.length + 1)}`, radiusMiles: 3, deliveryFeeCents: 399, minimumOrderCents: 1500 });
    }
    try {
      await api(`/api/restaurants/${restaurantId}/delivery-zones`, { method: "POST", token, body: zoneForm });
      setZoneForm({ name: `Zone ${String.fromCharCode(65 + deliveryZones.length + 1)}`, radiusMiles: 3, deliveryFeeCents: 399, minimumOrderCents: 1500 });
      await loadRestaurant();
    } catch (zoneError) {
      setError(zoneError.message);
    }
  }

  async function disableDeliveryZone(zone) {
    if (!apiOnline) return setDeliveryZones((current) => current.filter((item) => item.id !== zone.id));
    try {
      await api(`/api/restaurants/${restaurantId}/delivery-zones/${zone.id}`, { method: "DELETE", token });
      await loadRestaurant();
    } catch (zoneError) {
      setError(zoneError.message);
    }
  }

  async function createInventoryItem(event) {
    event.preventDefault();
    if (!apiOnline) {
      setInventoryItems((current) => [...current, { ...inventoryForm, id: crypto.randomUUID(), active: true }]);
      return setInventoryForm({ name: "", quantity: 0, unit: "unit", costCents: 0 });
    }
    try {
      await api(`/api/restaurants/${restaurantId}/inventory`, { method: "POST", token, body: inventoryForm });
      setInventoryForm({ name: "", quantity: 0, unit: "unit", costCents: 0 });
      await loadRestaurant();
    } catch (inventoryError) {
      setError(inventoryError.message);
    }
  }

  async function updateInventoryItem(item, data) {
    if (!apiOnline) return setInventoryItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, ...data } : currentItem));
    try {
      await api(`/api/restaurants/${restaurantId}/inventory/${item.id}`, { method: "PATCH", token, body: data });
      await loadRestaurant();
    } catch (inventoryError) {
      setError(inventoryError.message);
    }
  }

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
  const lockFor = (feature) => featureLocks[feature];
  const hasLock = (feature) => Boolean(lockFor(feature));
  const entitlementSummary = profile.entitlements || {};
  const kitchenDisplayLock = lockFor("KITCHEN_DISPLAY") || (lockFor("PRINTING") ? { ...lockFor("PRINTING"), featureLabel: featureLabels.KITCHEN_DISPLAY, requiredPlan: featureRequiredPlans.KITCHEN_DISPLAY } : null);
  const restaurantBasePath = profile.slug ? `/restaurant/${profile.slug}` : restaurantId ? `/restaurant/${restaurantId}` : "/restaurant";
  const settingsCenterLinks = restaurantSettingsLinks.map((item) => item.id === "payments" ? { ...item, href: `${restaurantBasePath}/onboarding#payments` } : item);

  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Restaurant dashboard" title={apiOnline ? "Live restaurant operations" : "Demo Bistro operations"} icon={ChefHat} action={<button className="button-muted" onClick={loadRestaurant}><RefreshCw size={18} />Refresh</button>} />
      <InlineError message={error} />
      {toast ? <div className={`rounded-md border px-4 py-3 text-sm font-bold ${toast.tone === "bad" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{toast.message}</div> : null}
      {entitlementSummary.planCode ? (
        <div className="rounded-md border border-line bg-white px-4 py-3 text-sm font-semibold text-slate-600">
          Plan: <strong className="text-ink">{readable(entitlementSummary.planCode)}</strong>
          {entitlementSummary.subscriptionStatus ? <> - Status: <strong className="text-ink">{readable(entitlementSummary.subscriptionStatus)}</strong></> : null}
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={Clock} label="Pending orders" value={stats.pendingOrders ?? orders.filter((order) => !["DELIVERED", "CANCELLED"].includes(order.status)).length} detail="Live kitchen queue" />
        <Stat icon={ReceiptText} label="Today's sales" value={money(stats.sales?.amountCents || stats.sales?.restaurantNetCents || orders.reduce((sum, order) => sum + order.totalCents, 0))} detail="Tips separated" />
        <Stat icon={Truck} label="Available drivers" value={stats.activeDrivers ?? drivers.filter((driver) => driver.available).length} detail="Internal fleet" />
        <Stat icon={TicketPercent} label="Orders today" value={stats.ordersToday ?? orders.length} detail="Pickup and delivery" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
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
                  <button className="button-muted" onClick={() => printOrderTicket(order, "receipt")}><RefreshCw size={16} />Reprint</button>
                  <button className="button-muted" onClick={() => printOrderTicket(order, "kitchen")}>Kitchen Ticket</button>
                  {order.type === "DELIVERY" ? <button className="button-muted" onClick={() => printOrderTicket(order, "driver")}>Driver Slip</button> : null}
                  {order.type === "DELIVERY" ? <button className="button-primary" onClick={() => assignDriver(order)}><Truck size={16} />Assign</button> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={Users} label="Customers" value={customerSummary.totalCustomers || customers.length} detail={`${customerSummary.newCustomersThisMonth || 0} new this month`} />
        <Stat icon={RefreshCw} label="Repeat rate" value={`${customerSummary.repeatCustomerPercentage || 0}%`} detail="Customers with orders" />
        <Stat icon={TicketPercent} label="VIP customers" value={customerSummary.vipCustomerCount || 0} detail="High-value guests" />
        <Stat icon={CreditCard} label="Average order" value={money(growthAnalytics.metrics?.averageOrderValueCents)} detail="All completed orders" />
      </div>
      <div className="grid gap-5 xl:grid-cols-2" id="customers">
        <div className="panel">
          <h3 className="panel-title">Customer CRM</h3>
          {hasLock("CUSTOMER_CRM") ? <div className="mt-4"><UpgradeRequired feature="CUSTOMER_CRM" lock={lockFor("CUSTOMER_CRM")} /></div> : <div className="mt-4 space-y-3">
            {customers.length === 0 ? <EmptyState title="No customers yet" detail="Customer profiles appear after orders are placed." /> : customers.slice(0, 6).map((customerRow) => (
              <div className="menu-row" key={customerRow.id}>
                <div>
                  <p className="font-semibold text-ink">{customerRow.name}</p>
                  <p className="text-sm text-slate-500">{customerRow.email} - {readable(customerRow.segment || "NEW_CUSTOMER")}</p>
                </div>
                <div className="text-right">
                  <strong>{money(customerRow.lifetimeSpendCents)}</strong>
                  <p className="text-xs text-slate-500">{customerRow.totalOrders} orders - {customerRow.loyaltyPointBalance} pts</p>
                </div>
              </div>
            ))}
          </div>}
        </div>
        <div className="panel">
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
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="panel">
          <h3 className="panel-title">Promotions</h3>
          {hasLock("COUPONS") ? <div className="mt-4"><UpgradeRequired feature="COUPONS" lock={lockFor("COUPONS")} /></div> : <div className="mt-4 space-y-2">
            {(promotions.activePromotions || []).length === 0 ? <EmptyState title="No active promotions" detail="Create coupons for fixed discounts, percentage discounts, free delivery, or BOGO campaigns." /> : promotions.activePromotions.map((coupon) => (
              <div className="summary-line" key={coupon.id}><span>{coupon.code}</span><strong>{coupon.redeemedCount || 0} used</strong></div>
            ))}
          </div>}
        </div>
        <div className="panel">
          <h3 className="panel-title">Restaurant analytics</h3>
          {hasLock("ANALYTICS") ? <div className="mt-4"><UpgradeRequired feature="ANALYTICS" lock={lockFor("ANALYTICS")} /></div> : <div className="mt-4 space-y-2 text-sm text-slate-600">
            <div className="summary-line"><span>Total orders</span><strong>{growthAnalytics.metrics?.totalOrders || orders.length}</strong></div>
            <div className="summary-line"><span>Delivery orders</span><strong>{growthAnalytics.metrics?.deliveryOrders || 0}</strong></div>
            <div className="summary-line"><span>Pickup orders</span><strong>{growthAnalytics.metrics?.pickupOrders || 0}</strong></div>
            <div className="summary-line"><span>Driver tips</span><strong>{money(growthAnalytics.metrics?.driverTipsCents)}</strong></div>
          </div>}
        </div>
        <div className="panel">
          <h3 className="panel-title">Menu insights</h3>
          {hasLock("MENU_INSIGHTS") ? <div className="mt-4"><UpgradeRequired feature="MENU_INSIGHTS" lock={lockFor("MENU_INSIGHTS")} /></div> : <div className="mt-4 space-y-2">
            {(menuInsights.bestSellingItems || []).length === 0 ? <EmptyState title="No item insights yet" detail="Best sellers and weak performers appear after orders." /> : menuInsights.bestSellingItems.slice(0, 4).map((item) => (
              <div className="summary-line" key={item.id}><span>{item.name}</span><strong>{item.quantity} sold</strong></div>
            ))}
          </div>}
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
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
        <div className="panel" id="settings-domains-seo">
          <h3 className="panel-title">Domain Management</h3>
          {hasLock("CUSTOM_DOMAIN") ? <div className="mt-4"><UpgradeRequired feature="CUSTOM_DOMAIN" lock={lockFor("CUSTOM_DOMAIN")} /></div> : <>
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
          </>}
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
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]" id="kitchen">
        <div className="panel">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <h3 className="panel-title">Kitchen Display System</h3>
              <p className="mt-2 text-sm text-slate-500">Touch-friendly order queue for kitchen staff, cashiers, and managers.</p>
            </div>
            {kitchenDisplayLock ? null : <a className="button-primary" href={`/kitchen/${profile.slug || restaurantId}`} target="_blank" rel="noreferrer"><ReceiptText size={16} />Open KDS</a>}
          </div>
          {kitchenDisplayLock ? <div className="mt-4"><UpgradeRequired feature="KITCHEN_DISPLAY" lock={kitchenDisplayLock} /></div> : <div className="mt-4 grid gap-3">
            {orders.filter((order) => !["DELIVERED", "CANCELLED"].includes(order.status)).length === 0 ? <EmptyState title="No active kitchen orders" detail="New pickup and delivery orders will appear here." /> : orders.filter((order) => !["DELIVERED", "CANCELLED"].includes(order.status)).slice(0, 4).map((order) => (
              <div className="summary-line rounded-md border border-line px-3 py-2" key={order.id}>
                <span>#{order.orderNumber} - {order.customer?.name || "Customer"}</span>
                <StatusPill tone={order.status === "READY" ? "warn" : "neutral"}>{kdsStatusFor(order.status)}</StatusPill>
              </div>
            ))}
          </div>}
        </div>
        <div className="panel" id="settings-ordering">
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
      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="panel" id="settings-staff-access">
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
        <div className="panel" id="drivers">
          <h3 className="panel-title">Driver Dispatch Center</h3>
          {hasLock("DRIVER_MANAGEMENT") ? <div className="mt-4"><UpgradeRequired feature="DRIVER_MANAGEMENT" lock={lockFor("DRIVER_MANAGEMENT")} /></div> : <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Stat icon={Truck} label="Available" value={dispatch.availableDrivers?.length || 0} detail="Ready to assign" />
            <Stat icon={Activity} label="Busy" value={dispatch.busyDrivers?.length || 0} detail="On delivery" />
            <Stat icon={Clock} label="Offline" value={dispatch.offlineDrivers?.length || 0} detail="Unavailable" />
          </div>
          <div className="mt-4 space-y-3">
            {(dispatch.deliveries || []).length === 0 ? <EmptyState title="No active deliveries" detail="Delivery orders waiting for assignment will appear here." /> : dispatch.deliveries.map((delivery) => (
              <div className="order-row" key={delivery.id}>
                <div>
                  <p className="font-bold text-ink">Delivery #{delivery.order?.orderNumber || delivery.id}</p>
                  <p className="text-sm text-slate-500">{delivery.order?.customer?.name || "Customer"} - {delivery.status} - Tip {money(delivery.tipCents)}</p>
                  <p className="text-xs text-slate-500">Driver: {delivery.driver?.user?.name || "Unassigned"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select className="select max-w-52" defaultValue={delivery.driverId || ""} onChange={(event) => assignDispatchDelivery(delivery, event.target.value)}>
                    <option value="">Assign driver</option>
                    {(dispatch.availableDrivers || []).map((driver) => <option value={driver.id} key={driver.id}>{driver.user?.name || driver.id}</option>)}
                  </select>
                  <button className="button-muted" onClick={() => cancelDispatchAssignment(delivery)}>Cancel Assignment</button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs font-semibold text-slate-500">Driver SMS and push notifications are routed through provider-ready notification services.</p>
          </>}
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="panel" id="settings-delivery">
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
        <div className="panel">
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
      </div>
      <div className="panel" id="reports">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
          <div>
            <h3 className="panel-title">Advanced reporting</h3>
            <p className="mt-2 text-sm text-slate-500">Sales, customer, menu, and driver metrics for day-to-day restaurant operations.</p>
          </div>
          <button className="button-muted" onClick={loadRestaurant}><RefreshCw size={16} />Refresh Reports</button>
        </div>
        {hasLock("REPORTS") ? <div className="mt-4"><UpgradeRequired feature="REPORTS" lock={lockFor("REPORTS")} /></div> : <>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Stat icon={CreditCard} label="Daily sales" value={money(operationsReport.sales?.dailySalesCents)} detail="Today" />
          <Stat icon={ReceiptText} label="Weekly sales" value={money(operationsReport.sales?.weeklySalesCents)} detail="This week" />
          <Stat icon={TicketPercent} label="Monthly sales" value={money(operationsReport.sales?.monthlySalesCents)} detail="This month" />
        </div>
        <div className="mt-4 grid gap-5 xl:grid-cols-3">
          <div>
            <h4 className="font-bold text-ink">Top selling items</h4>
            <div className="mt-2 space-y-2">{(operationsReport.items?.topSellingItems || []).length === 0 ? <p className="text-sm text-slate-500">No sales yet.</p> : operationsReport.items.topSellingItems.slice(0, 5).map((item) => <div className="summary-line rounded-md bg-slate-50 px-3" key={item.id || item.name}><span>{item.name}</span><strong>{item.quantity} sold</strong></div>)}</div>
          </div>
          <div>
            <h4 className="font-bold text-ink">Customer metrics</h4>
            <div className="mt-2 space-y-2">
              <div className="summary-line rounded-md bg-slate-50 px-3"><span>New customers</span><strong>{operationsReport.customers?.newCustomers || 0}</strong></div>
              <div className="summary-line rounded-md bg-slate-50 px-3"><span>Returning customers</span><strong>{operationsReport.customers?.returningCustomers || 0}</strong></div>
              <div className="summary-line rounded-md bg-slate-50 px-3"><span>VIP customers</span><strong>{operationsReport.customers?.vipCustomers || 0}</strong></div>
            </div>
          </div>
          <div>
            <h4 className="font-bold text-ink">Driver metrics</h4>
            <div className="mt-2 space-y-2">{(operationsReport.drivers || []).length === 0 ? <p className="text-sm text-slate-500">No driver history yet.</p> : operationsReport.drivers.slice(0, 5).map((driver) => <div className="summary-line rounded-md bg-slate-50 px-3" key={driver.driverId || driver.name}><span>{driver.name}</span><strong>{driver.deliveries} - {money(driver.tipsCents)} tips</strong></div>)}</div>
          </div>
        </div>
        </>}
      </div>
      <div className="grid gap-5 xl:grid-cols-2" id="settings">
        <div className="panel xl:col-span-2">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <h3 className="panel-title">Settings center</h3>
              <p className="mt-2 text-sm text-slate-500">Configuration and editing tools live here, keeping the top navigation focused on daily restaurant operations.</p>
            </div>
            <a className="button-muted" href={publicPreviewPath} target="_blank" rel="noreferrer"><Store size={16} />Preview website</a>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {settingsCenterLinks.map((item) => (
              <a className="rounded-md border border-line bg-white p-4 transition hover:border-mint hover:shadow-soft" href={item.href} key={item.id}>
                <span className="text-xs font-black uppercase tracking-wide text-mint">{item.status}</span>
                <strong className="mt-2 block text-lg text-ink">{item.label}</strong>
                <span className="mt-1 block text-sm text-slate-500">{item.detail}</span>
              </a>
            ))}
          </div>
        </div>
        <div className="panel" id="settings-profile">
          <h3 className="panel-title">Restaurant profile</h3>
          <p className="mt-2 text-sm text-slate-500">Business name, public contact details, address, and restaurant identity are edited in Website & Branding and saved to the live restaurant profile.</p>
          <div className="mt-4 grid gap-2 text-sm text-slate-600">
            <div className="summary-line"><span>Restaurant</span><strong>{profile.businessName || profile.name || "Restaurant"}</strong></div>
            <div className="summary-line"><span>Phone</span><strong>{profile.phone || "Not set"}</strong></div>
            <div className="summary-line"><span>Location</span><strong>{[profile.city, profile.state].filter(Boolean).join(", ") || "Not set"}</strong></div>
          </div>
          <a className="button-primary mt-4" href="#settings-website-branding"><Store size={16} />Edit profile</a>
        </div>
        <div className="panel" id="settings-payments">
          <h3 className="panel-title">Payments</h3>
          <p className="mt-2 text-sm text-slate-500">Restaurant payment provider onboarding and payout readiness are managed through the secure onboarding flow.</p>
          <a className="button-primary mt-4" href={`${restaurantBasePath}/onboarding#payments`}><CreditCard size={16} />Open payment setup</a>
        </div>
        <div className="panel" id="settings-billing">
          <h3 className="panel-title">Billing</h3>
          <p className="mt-2 text-sm text-slate-500">Subscription plan and account billing state are enforced server-side by Loohar entitlements.</p>
          <div className="mt-4 space-y-2 text-sm text-slate-600">
            <div className="summary-line"><span>Plan</span><strong>{readable(entitlementSummary.planCode || "STARTER")}</strong></div>
            <div className="summary-line"><span>Status</span><strong>{readable(entitlementSummary.subscriptionStatus || "ACTIVE")}</strong></div>
          </div>
        </div>
        <div className="panel" id="settings-security">
          <h3 className="panel-title">Security</h3>
          <p className="mt-2 text-sm text-slate-500">Password policy, role-based access, session checks, and audit logging protect tenant operations.</p>
          <div className="mt-4 grid gap-2">
            <StatusPill tone="good">RBAC active</StatusPill>
            <StatusPill tone="good">Tenant isolation active</StatusPill>
            <StatusPill tone="neutral">Audit logs retained</StatusPill>
          </div>
        </div>
        <div className="panel" id="settings-advanced">
          <h3 className="panel-title">Advanced</h3>
          {hasLock("MULTI_LOCATION") ? <div className="mt-4"><UpgradeRequired feature="MULTI_LOCATION" lock={lockFor("MULTI_LOCATION")} /></div> : <p className="mt-2 text-sm text-slate-500">{locations.length} configured location records. Future support will separate menus, drivers, and reporting by location.</p>}
        </div>
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
    <div className="kds-shell">
      <SectionHeader eyebrow="Kitchen Display System" title={restaurant.businessName || restaurant.name || "Kitchen"} icon={ReceiptText} action={<button className="button-muted" onClick={loadKitchen}><RefreshCw size={18} />{loading ? "Loading" : "Refresh"}</button>} />
      <InlineError message={error} />
      <div className="grid gap-4 md:grid-cols-4">
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
          </div>
          <button className="button-primary mt-5 w-full justify-center" disabled={!orderingEnabled || cart.length === 0 || quoteLoading || Boolean(quoteError)} onClick={placeOrder}><CreditCard size={18} />Continue to secure payment</button>
          {paymentClientSecret ? (
            <div className="mt-5 rounded-md border border-line bg-white p-3">
              <p className="mb-3 text-sm font-black text-ink">Secure restaurant payment</p>
              <div ref={stripeElementMountRef} className="min-h-24" />
              <button className="button-primary mt-4 w-full justify-center" type="button" onClick={confirmRestaurantPayment} disabled={!paymentElementReady || paying}>
                <CreditCard size={18} />{paying ? "Processing..." : `Pay ${money(orderStatus?.totalCents || orderTotal)}`}
              </button>
              <p className="mt-2 text-xs text-slate-500">Payment is processed by the restaurant's connected merchant account. Loohar platform billing is separate.</p>
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
    checkApiHealth()
      .then(() => {
        setApiOnline(true);
        setApiMode("LIVE");
      })
      .catch(() => {
        setApiOnline(false);
        setApiMode("DEMO");
      });
  }, []);

  useEffect(() => {
    function handleAuthExpired() {
      clearSession();
      setToken("");
      setRefreshToken("");
      setUser(null);
      setAuthChecking(false);
    }
    window.addEventListener("loohar:auth-expired", handleAuthExpired);
    return () => window.removeEventListener("loohar:auth-expired", handleAuthExpired);
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

  if (isDriverRoute) {
    if (apiMode === "CHECKING" || (apiOnline && authChecking)) return <div className="min-h-screen bg-[#f7f8fb] px-4 py-6 text-slate-700"><AppLoadingState /></div>;
    if (apiOnline && !user) return <AccessDenied title="Please sign in to continue." loginHref={loginHrefWithReturnTo("/login")} detail="Driver login is required for this route." />;
    if (apiOnline && user?.role !== "DRIVER") return <AccessDenied loginHref="/login" detail="The Driver app is available only to driver accounts." />;
    return <DriverPwaApp apiOnline={apiOnline} token={token} />;
  }

  if (isKitchenRoute) {
    const kitchenSlug = window.location.pathname.startsWith("/kitchen/") ? window.location.pathname.split("/")[2] : "";
    const canOpenKitchen = kitchenRoles.includes(user?.role) && canAccessTenantRoute(user, initialPath, "kitchen") && !requiresPasswordChange(user);
    return (
      <div className="min-h-screen bg-[#f7f8fb] text-slate-700">
        <AppHeader navItems={kitchenNavigation(user, kitchenSlug, initialPath)} />
        <main className="mx-auto max-w-7xl px-4 py-6">
          <LoginStrip user={user} onLogout={logout} />
          <div className="my-4 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <StatusPill tone={apiOnline ? "good" : apiMode === "CHECKING" ? "neutral" : "warn"}>{apiOnline ? "Live API connected" : apiMode === "CHECKING" ? "Checking API" : "Offline demo fallback"}</StatusPill>
            <StatusPill tone={canOpenKitchen ? "good" : "warn"}>{user?.role || "Kitchen login required"}</StatusPill>
          </div>
          {apiMode === "CHECKING" || (apiOnline && authChecking) ? <AppLoadingState /> : canOpenKitchen ? <KitchenApp apiOnline={apiOnline} token={token} user={user} initialSlug={kitchenSlug} /> : !user ? <AccessDenied title="Please sign in to continue." loginHref={loginHrefWithReturnTo("/restaurant/login")} detail="Restaurant operations login is required for this route." /> : <AccessDenied loginHref="/restaurant/login" detail="This route is only for assigned kitchen staff, cashiers, managers, and restaurant owners." />}
        </main>
      </div>
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
    const canOpenRestaurant = restaurantRoles.concat(["SUPER_ADMIN"]).includes(user?.role) && canAccessTenantRoute(user, initialPath, "restaurant") && !requiresPasswordChange(user);
    const shouldResumeOnboarding = canOpenRestaurant && restaurantRoles.includes(user?.role) && !restaurantOnboardingComplete(user) && !isRestaurantOnboardingRoute && (initialPath === "/restaurant" || initialPath === `/restaurant/${restaurantSlug}`);
    const restaurantContent = isRestaurantOnboardingRoute
      ? <RestaurantOnboardingWizard apiOnline={apiOnline} token={token} user={user} initialSlug={restaurantSlug} />
      : shouldResumeOnboarding
        ? <Redirecting to={restaurantOnboardingPathFor(user, restaurantSlug)} />
        : <RestaurantApp apiOnline={apiOnline} token={token} user={user} initialSlug={restaurantSlug} />;
    return (
      <div className="min-h-screen bg-[#f7f8fb] text-slate-700">
        <AppHeader navItems={restaurantOperationsNavigation(user, restaurantSlug, initialPath)} />
        <main className="mx-auto max-w-7xl px-4 py-6">
          <LoginStrip user={user} onLogout={logout} />
          <div className="my-4 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <StatusPill tone={apiOnline ? "good" : apiMode === "CHECKING" ? "neutral" : "warn"}>{apiOnline ? "Live API connected" : apiMode === "CHECKING" ? "Checking API" : "Offline demo fallback"}</StatusPill>
            <StatusPill tone={canOpenRestaurant ? "good" : "warn"}>{user?.role || "Restaurant login required"}</StatusPill>
          </div>
          {apiMode === "CHECKING" || (apiOnline && authChecking) ? <AppLoadingState /> : canOpenRestaurant ? restaurantContent : !user ? <AccessDenied title="Please sign in to continue." loginHref={loginHrefWithReturnTo("/restaurant/login")} detail="Restaurant login is required for this route." /> : <AccessDenied loginHref="/restaurant/login" detail="This route is only for the assigned restaurant owner, manager, or admin." />}
        </main>
      </div>
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
