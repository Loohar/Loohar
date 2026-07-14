import {
  Activity,
  Bike,
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
  Users
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import QRCode from "qrcode";
import DriverPwaApp from "./apps/driver/DriverApp.jsx";
import { api, API_ORIGIN, apiRequestUrl, checkApiHealth } from "./lib/api.js";
import { clearSession, getStoredSession, storeSession } from "./shared/auth.js";
import { demoCustomerSummary, demoCustomers, demoDrivers, demoGallery, demoGrowth, demoOrders, demoRestaurant, demoRestaurants, demoSocialLinks, demoWebsiteBundle, demoWebsiteSettings, demoDomain } from "./data/demo.js";

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
const authDiagnosticsEnabled = import.meta.env.VITE_AUTH_DIAGNOSTICS === "true";
const authDiagnosticPageEnabled = import.meta.env.VITE_AUTH_DIAGNOSTIC === "true";
const reservedTenantHosts = new Set([tenantRootDomain, appDomain, vercelProjectDomain, `www.${tenantRootDomain}`, `admin.${tenantRootDomain}`, `app.${tenantRootDomain}`, `driver.${tenantRootDomain}`, `api.${tenantRootDomain}`, `sites.${tenantRootDomain}`, "localhost"]);
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
const imageAccept = "image/png,image/jpeg,image/jpg,image/webp,image/svg+xml";
const maxImageBytes = 5 * 1024 * 1024;
const imageMimeByExtension = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml"
};
const websiteSectionDefaults = { hero: true, featuredMenu: true, story: true, gallery: true, catering: true, contact: true };
const defaultLooharImage = "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1600&q=80";
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
  if (form.slug && !/^[a-z0-9-]+$/.test(form.slug)) errors.slug = "Use lowercase letters, numbers, and hyphens only.";
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

function FieldError({ message }) {
  return message ? <p className="field-error">{message}</p> : null;
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
  const items = [
    { label: "Dashboard", icon: LayoutDashboard, href: base, active: path === base || path === "/restaurant" },
    { label: "Orders", icon: ReceiptText, href: `${base}#orders` },
    canUseKitchen ? { label: "Kitchen", icon: ReceiptText, href: kitchenSlug ? `/kitchen/${kitchenSlug}` : "/kitchen", active: path.startsWith("/kitchen") } : null,
    { label: "Menu", icon: MenuIcon, href: `${base}#menu` },
    { label: "Drivers", icon: Truck, href: `${base}#drivers` },
    { label: "Customers", icon: Users, href: `${base}#customers` },
    { label: "Website", icon: Store, href: `${base}#website` },
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
  const activeRestaurantMemberships = (user?.memberships || []).filter((membership) => membership?.status === "ACTIVE" && membership?.tenantSlug);
  const slug = activeRestaurantMemberships[0]?.tenantSlug || user?.restaurantSlug || "";
  const hasRestaurantRole = restaurantRoles.includes(user?.role);
  const restaurantPath = activeRestaurantMemberships.length > 1
    ? "/restaurant/select-business"
    : slug
      ? `/restaurant/${slug}`
      : hasRestaurantRole
        ? "/restaurant/account-not-assigned"
        : "/restaurant";
  const kitchenPath = slug ? `/kitchen/${slug}` : "/kitchen";
  const destinations = {
    SUPER_ADMIN: "/admin",
    TENANT_OWNER: restaurantPath,
    RESTAURANT_ADMIN: restaurantPath,
    RESTAURANT_OWNER: restaurantPath,
    RESTAURANT_MANAGER: restaurantPath,
    CASHIER: kitchenPath,
    KITCHEN_STAFF: kitchenPath,
    DRIVER: "/driver",
    CUSTOMER: "/customer"
  };
  return destinations[user?.role] || "/login";
}

function getPostLoginDestination(user) {
  return returnToForUser(user);
}

function validateAuthPayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Login response was empty.");
  if (!payload.accessToken) throw new Error("Login response did not include an access token.");
  if (!payload.user?.id) throw new Error("Login response did not include a user profile.");
  if (!payload.user?.role) throw new Error("Login response did not include a user role.");
  return payload;
}

function safeAuthErrorMessage(error, mode) {
  const message = error?.message || "Login failed.";
  if (/invalid email or password/i.test(message)) {
    if (mode === "admin") return "Invalid platform owner email or password. Use your Loohar super admin account.";
    if (mode === "restaurant") return "Invalid restaurant owner or staff email/password. Use the account assigned to this restaurant.";
  }
  if (/login response|auth\/me|session/i.test(message)) {
    return `${message} Please refresh and try again.`;
  }
  return message;
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
  if (!slug) return true;
  if (["select-business", "account-not-assigned"].includes(slug)) return true;
  return Boolean(user.restaurantSlug) && slug === user.restaurantSlug;
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
  if (restaurantRoles.concat(["CASHIER", "KITCHEN_STAFF"]).includes(user?.role) && requested.startsWith("/restaurant") && canAccessTenantRoute(user, requested, "restaurant")) return requested;
  if (restaurantRoles.concat(["CASHIER", "KITCHEN_STAFF"]).includes(user?.role) && requested.startsWith("/kitchen") && canAccessTenantRoute(user, requested, "kitchen")) return requested;
  if (user?.role === "DRIVER" && requested.startsWith("/driver")) return requested;
  if (user?.role === "CUSTOMER" && (requested.startsWith("/customer") || requested.startsWith("/app/order"))) return requested;
  return fallback;
}

function loginHrefWithReturnTo(loginPath, returnTo = window.location.pathname) {
  const safePath = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return `${loginPath}?returnTo=${encodeURIComponent(safePath)}`;
}

function requiresPasswordChange(user) {
  return Boolean(user?.forcePasswordChange || user?.temporaryPassword);
}

function passwordIssues(value) {
  return strongPasswordChecks.filter((check) => !check.test(value)).map((check) => check.label);
}

function validateImageFile(file) {
  if (!file) return "Select an image file.";
  if (!imageAccept.split(",").includes(mimeTypeForFile(file))) return "Use PNG, JPG, JPEG, WEBP, or SVG.";
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
    return { slug: hostRoute.slug || "", page: page || "home", byHost: true, host: hostRoute.host };
  }
  const [, root, slug, page = "home"] = window.location.pathname.split("/");
  if (root !== "sites") return null;
  return { slug: slug || "", page, byHost: false, host: "" };
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
  return `/sites/${slug}`;
}

function publicSiteHref(route, slug, target = "home") {
  const base = routeBaseForPublicSite(route, slug);
  if (target === "home") return base || "/";
  return `${base}/${target}`;
}

function defaultTenantUrlFor(profile = {}, domain = {}) {
  if (domain.defaultUrl) return domain.defaultUrl;
  return `https://${domain.defaultSubdomain || profile.slug || "restaurant"}.${tenantRootDomain}`;
}

function canonicalTenantUrlFor(profile = {}, domain = {}) {
  if (domain.canonicalUrl) return domain.canonicalUrl;
  if (domain.canonicalDomain) return `https://${domain.canonicalDomain}`;
  return defaultTenantUrlFor(profile, domain);
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
  const fallbackGallery = usingDemoFallback && Array.isArray(fallback.gallery) && fallback.gallery.length ? fallback.gallery : [];
  const liveGallery = Array.isArray(live.gallery) ? live.gallery : [];
  const heroImageUrl = resolveImage(liveWebsite.heroImageUrl, fallbackWebsite.heroImageUrl || fallbackGallery[0]?.imageUrl, defaultWebsite.heroImageUrl);
  const logoUrl = resolveImage(liveWebsite.logoUrl || liveRestaurant.logoUrl, fallbackWebsite.logoUrl || fallbackRestaurant.logoUrl, heroImageUrl);
  const website = {
    ...defaultWebsite,
    ...(usingDemoFallback ? fallbackWebsite : {}),
    ...liveWebsite,
    heroImageUrl,
    logoUrl,
    brandColor: liveWebsite.brandColor || fallbackWebsite.brandColor || defaultWebsite.brandColor,
    accentColor: liveWebsite.accentColor || fallbackWebsite.accentColor || defaultWebsite.accentColor,
    sectionSettingsJson: { ...websiteSectionDefaults, ...(fallbackWebsite.sectionSettingsJson || {}), ...(liveWebsite.sectionSettingsJson || {}) }
  };
  const sourceGallery = liveGallery.length ? liveGallery : usingDemoFallback ? fallbackGallery : [];
  const gallery = sourceGallery.map((image, index) => {
    const fallbackImage = usingDemoFallback ? fallbackGallery[index] || fallbackGallery[0] || {} : {};
    return {
      ...(usingDemoFallback ? fallbackImage : {}),
      ...image,
      id: image.id || fallbackImage.id || `gallery-${index}`,
      altText: image.altText || fallbackImage.altText || `${publicRestaurantName(baseRestaurant)} photo`,
      imageUrl: resolveImage(image.imageUrl, fallbackImage.imageUrl, heroImageUrl)
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
        imageUrl: resolveImage(item.imageUrl, fallbackItem.imageUrl, heroImageUrl)
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
    socialLinks: Array.isArray(live.socialLinks) ? live.socialLinks : usingDemoFallback && Array.isArray(fallback.socialLinks) ? fallback.socialLinks : [],
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

function applyPublicSeo(bundle, page = "home") {
  if (!bundle) return;
  const restaurant = bundle.restaurant || {};
  const website = bundle.website || {};
  const name = restaurant.businessName || restaurant.name || "Restaurant";
  const canonicalUrl = bundle.seo?.canonicalUrl || `${window.location.origin}/sites/${restaurant.slug || ""}${page === "home" ? "" : `/${page}`}`;
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
  setRobots(true);
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
    const endpoint = route?.byHost ? `/api/public/site-by-host?host=${encodeURIComponent(route.host)}` : `/api/public/sites/${slug}`;
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
  const heroImage = resolveImage(website.heroImageUrl, gallery[0]?.imageUrl);
  const logoImage = resolveImage(website.logoUrl, heroImage, heroImage);
  const sectionSettings = { ...websiteSectionDefaults, ...(website.sectionSettingsJson || {}) };
  const siteStyle = { "--brand": website.brandColor, "--accent": website.accentColor, "--heading-font": website.headingFont || "inherit", "--body-font": website.bodyFont || "inherit" };

  function navLink(target, label) {
    return <a className={page === target ? "site-nav active" : "site-nav"} href={publicSiteHref(route, currentSlug, target)}>{label}</a>;
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
          {navLink("contact", "Contact")}
          {navLink("gallery", "Gallery")}
          {navLink("loyalty", "Loyalty")}
          {navLink("catering", "Catering")}
          {navLink("careers", "Careers")}
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
                {(category.items || []).map((item) => <div className="food-card" key={item.id}>{item.imageUrl ? <img className="order-card-img" src={resolveImage(item.imageUrl, heroImage)} alt={item.name} loading="lazy" onError={handleSafeImageError} /> : null}<div><p className="font-bold text-ink">{item.name}</p><p className="text-sm text-slate-500">{item.description}</p><p className="mt-2 text-sm">{item.available === false ? "Unavailable" : "Available"} {item.featured ? "- Featured" : ""} {item.recommended ? "- Recommended" : ""}</p><p className="mt-2 text-xs font-bold uppercase text-slate-400">{item.preparationTimeMins || 15} min</p></div><a className="button-primary h-fit" href={`${routeBase}/order`}>{money(item.priceCents)}</a></div>)}
              </div>
            </div>
          ))}
        </section>
      ) : null}
      {page === "order" ? <section className="lux-section"><div className="lux-section-head"><p>Order Online</p><h2>Pickup and delivery from {restaurant.businessName || restaurant.name}</h2><a href={`${routeBase}/menu`}>View menu</a></div><CustomerApp apiOnline={apiOnline} initialSlug={currentSlug} embedded /></section> : null}

      {page === "about" ? <section className="site-card"><h2>{website.aboutTitle}</h2><p>{website.aboutStory}</p><h3>Mission</h3><p>{website.missionStatement}</p><h3>Owner / chef story</h3><p>{website.ownerStory}</p><div className="site-image mt-4"><img src={resolveImage(gallery[1]?.imageUrl, heroImage)} alt={gallery[1]?.altText || "Restaurant story"} onError={handleSafeImageError} /></div></section> : null}
      {page === "contact" ? <section className="site-grid"><div className="site-card"><h2>Contact</h2><p>{fullRestaurantAddress(restaurant) || restaurant.address}</p><p>{restaurant.phone}</p><p>{restaurant.email}</p><p>{Object.entries(restaurant.storeHoursJson || {}).map(([day, hours]) => `${readable(day)}: ${hours}`).join(" / ") || "Call for current hours"}</p>{socialLinks.map((link) => <a className="site-nav mr-2" href={link.url} key={link.id}>{link.platform}</a>)}</div><div className="site-card"><h3>Location</h3>{googleMapEmbedUrl(fullRestaurantAddress(restaurant)) ? <iframe className="map-frame" title={`${restaurant.name} map`} src={googleMapEmbedUrl(fullRestaurantAddress(restaurant))} loading="lazy" /> : <div className="map-card">{restaurant.address || "Address coming soon"}</div>}<div className="mt-4 flex flex-wrap gap-2"><a className="button-primary" href={googleDirectionsUrl(fullRestaurantAddress(restaurant))} target="_blank" rel="noreferrer"><MapPin size={16} />Directions</a><a className="button-muted" href={`tel:${restaurant.phone || ""}`}>Call</a><a className="button-muted" href={`mailto:${restaurant.email || ""}`}>Email</a></div><h3 className="mt-4">Questions</h3><p>Call or email the restaurant for event requests, order help, or catering details.</p></div></section> : null}
      {page === "gallery" ? <section className="site-card"><h2>Gallery</h2>{gallery.length === 0 ? <EmptyState title="Gallery coming soon" detail="This restaurant has not added gallery images yet." /> : <div className="mt-4 grid gap-3 md:grid-cols-3">{gallery.map((image) => <div className="site-image" key={image.id}><img src={resolveImage(image.imageUrl, heroImage)} alt={image.altText || "Restaurant photo"} onError={handleSafeImageError} /></div>)}</div>}</section> : null}
      {page === "loyalty" ? <section className="site-card"><h2>Loyalty</h2><p>Earn {restaurant.loyaltySettingsJson?.pointsPerDollar || 1} point per dollar when ordering direct.</p><div className="mt-4 grid gap-3 md:grid-cols-2">{(restaurant.loyaltyRewards || bundle.restaurant?.loyaltyRewards || []).map((reward) => <div className="summary-line rounded-md bg-slate-50 px-3" key={reward.id}><span>{reward.name}</span><strong>{reward.pointsRequired} pts</strong></div>)}</div><a className="button-primary mt-4" href={`${routeBase}/order`}>Join at checkout</a></section> : null}
      {page === "catering" ? <section className="site-card"><h2>Catering</h2><p>Bring restaurant favorites to your next event.</p><a className="button-primary mt-4" href={`mailto:${restaurant.email || ""}`}>Request catering</a><p className="mt-3 text-sm text-slate-500">Include event date, guest count, and menu preferences.</p></section> : null}
      {page === "careers" ? <section className="site-card"><h2>Careers</h2><p>We are always interested in great restaurant people.</p><a className="button-primary mt-4" href={`mailto:${restaurant.email || ""}`}>Contact hiring manager</a></section> : null}

      <footer className="site-footer">
        <span>{restaurant.businessName || restaurant.name}</span>
        <span>{restaurant.address}</span>
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
    const endpoint = route?.byHost ? `/api/public/site-by-host?host=${encodeURIComponent(route.host)}` : `/api/public/sites/${slug}`;
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
  const heroImage = resolveImage(website.heroImageUrl, gallery[0]?.imageUrl);
  const logoImage = resolveImage(website.logoUrl, heroImage, heroImage);
  const address = bundle.contactInfo?.address || fullRestaurantAddress(restaurant);
  const mapSrc = bundle.location?.mapEmbedUrl || googleMapEmbedUrl(address);
  const directionsHref = bundle.location?.directionsUrl || googleDirectionsUrl(address);
  const sectionSettings = { ...websiteSectionDefaults, ...(website.sectionSettingsJson || {}) };
  const siteStyle = { "--brand": website.brandColor, "--accent": website.accentColor, "--heading-font": website.headingFont || "inherit", "--body-font": website.bodyFont || "inherit" };

  function navLink(target, label) {
    return <a className={page === target ? "site-nav active" : "site-nav"} href={publicSiteHref(route, currentSlug, target)}>{label}</a>;
  }

  function MenuCard({ item: menuItem }) {
    const itemImage = resolveImage(menuItem.imageUrl, website.heroImageUrl || gallery[0]?.imageUrl, heroImage);
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
        <button className="site-menu-toggle" onClick={() => setMenuOpen((open) => !open)}>Menu</button>
        <nav className={`site-navs ${menuOpen ? "open" : ""}`}>
          {navLink("home", "Home")}
          {navLink("menu", "Menu")}
          {navLink("order", "Order Online")}
          {navLink("about", "About")}
          {navLink("gallery", "Gallery")}
          {navLink("loyalty", "Loyalty")}
          {navLink("catering", "Catering")}
          {navLink("contact", "Contact")}
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
                <a className="button-primary" href={`${routeBase}/order`}><CreditCard size={18} />Order Online</a>
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
            <img src={resolveImage(gallery[0]?.imageUrl, heroImage)} alt={gallery[0]?.altText || restaurant.name} onError={handleSafeImageError} />
            <div>
              <p className="lux-kicker">About the restaurant</p>
              <h2>{website.aboutTitle}</h2>
              <p>{website.aboutStory}</p>
              <a className="button-primary mt-5" href={`${routeBase}/about`}>Read our story</a>
            </div>
          </section> : null}
          <section className="site-grid">
            <div className="site-card"><h3>Special offer</h3><p>{website.specialOfferText}</p><a className="button-primary mt-4" href={`${routeBase}/order`}>Redeem online</a></div>
            <div className="site-card"><h3>Direct ordering</h3><p>Order from this restaurant-owned site for pickup, delivery, loyalty, and direct customer support.</p></div>
            {sectionSettings.contact ? <div className="site-card"><h3>Location & hours</h3><p>{restaurant.address}</p><p>{restaurant.phone}</p><p>{hoursPreview || "Hours available soon"}</p></div> : null}
          </section>
          {isLiquor ? <section className="site-card"><h3>Age verification and compliance</h3><p>{bundle.complianceNote || "Age verification and local delivery compliance are required for regulated items."}</p></section> : null}
          {sectionSettings.gallery && gallery.length ? <section className="lux-gallery-strip">{gallery.slice(0, 4).map((image) => <img src={resolveImage(image.imageUrl, heroImage)} alt={image.altText} key={image.id} loading="lazy" onError={handleSafeImageError} />)}</section> : null}
          <section className="lux-cta"><h2>Order direct from {restaurant.businessName || restaurant.name}</h2><p>Keep more value with the restaurant while earning loyalty rewards.</p><a className="button-primary" href={`${routeBase}/order`}>Start an order</a></section>
        </>
      ) : null}

      {page === "menu" ? <section className="lux-section"><div className="lux-section-head"><p>Full menu</p><h2>{isLiquor ? "Bottle shop catalog" : "Prepared for pickup and delivery"}</h2><a href={`${routeBase}/order`}>Order now</a></div>{isLiquor ? <div className="site-card mb-4"><h3>Regulated items</h3><p>{bundle.complianceNote || "Age verification and local delivery rules apply."}</p></div> : null}{categories.length === 0 ? <EmptyState title="Menu coming soon" detail="This restaurant has not published public menu items yet." /> : categories.map((category) => <div className="lux-category" key={category.id}><h3>{category.name}</h3><div className="lux-card-grid">{(category.items || []).map((menuItem) => <MenuCard item={menuItem} key={menuItem.id} />)}</div></div>)}</section> : null}
      {page === "order" ? <section className="lux-section public-order-page"><div className="lux-section-head"><p>Order Online</p><h2>{restaurant.pickupEnabled && restaurant.deliveryEnabled ? "Pickup and delivery" : restaurant.deliveryEnabled ? "Delivery" : "Pickup"} from {restaurant.businessName || restaurant.name}</h2><a href={`${routeBase}/menu`}>View menu</a></div><div className="public-order-hero"><img src={heroImage} alt={`${restaurant.businessName || restaurant.name} food`} loading="lazy" onError={handleSafeImageError} /><div><p className="lux-kicker">{website.cuisineType || readable(restaurant.businessType)}</p><h3>{website.heroTitle || restaurant.businessName || restaurant.name}</h3><p>{website.heroSubtitle || restaurant.description}</p><div className="mt-4 flex flex-wrap gap-2"><StatusPill tone={restaurant.pickupEnabled ? "good" : "neutral"}>{restaurant.pickupEnabled ? "Pickup available" : "Pickup unavailable"}</StatusPill><StatusPill tone={restaurant.deliveryEnabled ? "good" : "neutral"}>{restaurant.deliveryEnabled ? "Delivery available" : "Delivery unavailable"}</StatusPill><StatusPill>{hoursPreview || "Hours vary"}</StatusPill></div></div></div><CustomerApp apiOnline={apiOnline} initialSlug={currentSlug} embedded /></section> : null}
      {page === "about" ? <section className="lux-split page"><img src={resolveImage(gallery[1]?.imageUrl, heroImage)} alt="Chef and restaurant team" onError={handleSafeImageError} /><div><p className="lux-kicker">Our story</p><h2>{website.aboutTitle}</h2><p>{website.aboutStory}</p><h3>Mission</h3><p>{website.missionStatement}</p><h3>Fresh ingredients</h3><p>Seasonal produce, thoughtful sourcing, and a menu designed for dining room quality at home.</p><h3>Community</h3><p>Ordering direct helps keep customer relationships and revenue with the local restaurant team.</p></div></section> : null}
      {page === "contact" ? <section className="site-grid contact"><div className="site-card"><h2>Contact</h2><p>{address || restaurant.address}</p><p>{restaurant.phone}</p><p>{restaurant.email}</p><p>Delivery availability depends on restaurant settings.</p><div className="mt-4 flex flex-wrap gap-2"><a className="button-primary" href={directionsHref} target="_blank" rel="noreferrer"><MapPin size={16} />Directions</a><a className="button-muted" href={`tel:${restaurant.phone || ""}`}>Call</a><a className="button-muted" href={`mailto:${restaurant.email || ""}`}>Email</a></div>{socialLinks.map((link) => <a className="site-nav mr-2 mt-3" href={link.url} key={link.id}>{link.platform}</a>)}</div><div className="site-card"><h3>Opening hours</h3>{hours.length ? hours.map(([day, value]) => <div className="summary-line" key={day}><span>{readable(day)}</span><strong>{value}</strong></div>) : <p className="mt-2 text-sm text-slate-500">Call for current hours.</p>}</div><div className="site-card"><h3>Location & message</h3>{mapSrc ? <iframe className="map-frame" title={`${restaurant.businessName || restaurant.name} map`} src={mapSrc} loading="lazy" /> : <div className="map-card">{address || "Address coming soon"}</div>}<p className="mt-4">Call or email the restaurant for private events, questions, and order help.</p></div></section> : null}
      {page === "gallery" ? <section className="lux-section"><div className="lux-section-head"><p>Gallery</p><h2>Food, room, team, and events</h2><a href={`${routeBase}/order`}>Order from the menu</a></div>{gallery.length === 0 ? <EmptyState title="Gallery coming soon" detail="This restaurant has not added gallery images yet." /> : <div className="lux-gallery-grid">{gallery.map((image) => <figure key={image.id}><img src={resolveImage(image.imageUrl, heroImage)} alt={image.altText} loading="lazy" onError={handleSafeImageError} /><figcaption>{image.altText} / {image.category || "food"}</figcaption></figure>)}</div>}</section> : null}
      {page === "loyalty" ? <section className="lux-section"><div className="lux-section-head"><p>Loyalty</p><h2>Rewards for ordering direct</h2><a href={`${routeBase}/order`}>Join at checkout</a></div><div className="site-grid"><div className="site-card"><h3>How it works</h3><p>Earn {restaurant.loyaltySettingsJson?.pointsPerDollar || 1} point per dollar on eligible direct orders. Redeem points for restaurant-owned rewards.</p><a className="button-primary mt-4" href={`${routeBase}/order`}>Join at checkout</a></div>{rewards.map((reward) => <div className="site-card" key={reward.id}><h3>{reward.name}</h3><p>{reward.pointsRequired} points required.</p></div>)}</div></section> : null}
      {page === "catering" ? <section className="lux-section"><div className="lux-section-head"><p>Catering</p><h2>Events, party trays, and corporate lunches</h2><a href={`tel:${restaurant.phone || ""}`}>Call restaurant</a></div><div className="site-grid"><div className="site-card"><h3>Party trays</h3><p>Shareable appetizers, salads, and entrees sized for groups.</p></div><div className="site-card"><h3>Corporate lunch</h3><p>Pickup and delivery-friendly lunch packages for teams.</p></div><div className="site-card"><h3>Family meals</h3><p>Comfortable dinner packages built around restaurant favorites.</p></div></div><div className="site-card"><h3>Request quote</h3><p>Send event date, guest count, and menu preferences to the restaurant team.</p><a className="button-primary mt-4" href={`mailto:${restaurant.email || ""}`}>Request quote</a></div></section> : null}
      {page === "careers" ? <section className="lux-section"><div className="lux-section-head"><p>Careers</p><h2>Join the restaurant team</h2><a href={`mailto:${restaurant.email || ""}`}>Contact hiring manager</a></div><div className="site-grid"><div className="site-card"><h3>Why work here</h3><p>Focused service, direct customer relationships, and a team built around hospitality.</p></div><div className="site-card"><h3>Open roles</h3><p>Contact the restaurant for current kitchen, service, and driver opportunities.</p></div><div className="site-card"><h3>Apply</h3><p>Email the hiring manager with your experience and availability.</p><a className="button-primary mt-4" href={`mailto:${restaurant.email || ""}`}>Apply by email</a></div></div></section> : null}

      <footer className="site-footer premium">
        <span>{restaurant.businessName || restaurant.name}</span>
        <span>{restaurant.address}</span>
        <span>Direct ordering powered by Loohar</span>
      </footer>
    </div>
  );
}

function BrandMark() {
  return (
    <div className="app-brand">
      <div className="app-brand-icon"><Shield size={22} /></div>
      <div className="app-brand-copy">
        <strong className="block text-xl font-black text-ink">{appName}</strong>
      </div>
    </div>
  );
}

function AppHeader({ navItems = [] }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <BrandMark compact />
        <button className="app-menu-toggle" type="button" onClick={() => setMenuOpen((open) => !open)}>
          <MenuIcon size={18} />Menu
        </button>
        <nav className={`app-nav ${menuOpen ? "open" : ""}`}>
          {navItems.map(({ href, label, icon: Icon, active, target, rel }) => (
            <a className={`nav-tab ${active ? "active" : ""}`} href={href} target={target} rel={rel} key={`${label}-${href}`}>
              {Icon ? <Icon size={17} /> : null}{label}
            </a>
          ))}
        </nav>
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

function RestaurantAccountNotAssigned({ user, onLogout }) {
  return (
    <div className="min-h-screen bg-[#f7f8fb] text-slate-700">
      <AppHeader navItems={restaurantOperationsNavigation(user, "", "/restaurant/account-not-assigned")} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <LoginStrip user={user} onLogout={onLogout} />
        <AccessDenied title="Restaurant account not assigned." detail="This restaurant login succeeded, but no active tenant membership was found for the account." loginHref="/restaurant/login" />
      </main>
    </div>
  );
}

function RestaurantBusinessSelector({ user, onLogout }) {
  const memberships = (user?.memberships || []).filter((membership) => membership?.status === "ACTIVE" && membership?.tenantSlug);
  return (
    <div className="min-h-screen bg-[#f7f8fb] text-slate-700">
      <AppHeader navItems={restaurantOperationsNavigation(user, user?.restaurantSlug, "/restaurant/select-business")} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <LoginStrip user={user} onLogout={onLogout} />
        <section className="panel mt-4">
          <h1 className="text-2xl font-black text-ink">Select a restaurant</h1>
          <p className="mt-2 text-slate-500">Choose the active business you want to manage.</p>
          <div className="mt-5 grid gap-3">
            {memberships.length ? memberships.map((membership) => (
              <a className="button-muted justify-between" href={`/restaurant/${membership.tenantSlug}`} key={membership.tenantId || membership.tenantSlug}>
                <span>{membership.tenantName || membership.tenantSlug}</span>
                <span className="text-xs uppercase text-slate-500">{membership.role}</span>
              </a>
            )) : <p className="rounded-md border border-line p-4 text-sm text-slate-500">No active tenant memberships were found.</p>}
          </div>
        </section>
      </main>
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
    window.location.replace(to);
  }, [to]);
  return (
    <div className="min-h-screen bg-[#f7f8fb] px-4 py-10 text-slate-700">
      <AppLoadingState title="Opening Loohar" detail="Taking you to the right dashboard." />
    </div>
  );
}

const authDiagnosticStages = [
  "FORM_SUBMITTED",
  "LOGIN_REQUEST_SENT",
  "LOGIN_RESPONSE_STATUS",
  "LOGIN_RESPONSE_SHAPE_VALID",
  "SESSION_STORED",
  "AUTH_ME_REQUEST_SENT",
  "AUTH_ME_RESPONSE_STATUS",
  "ROLE_RESOLVED",
  "MEMBERSHIP_RESOLVED",
  "REDIRECT_TARGET_CALCULATED"
];

function createDiagnosticStageState() {
  return authDiagnosticStages.map((name) => ({ name, status: "pending", detail: "" }));
}

function AuthDiagnosticPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [expectedRole, setExpectedRole] = useState("SUPER_ADMIN");
  const [stages, setStages] = useState(createDiagnosticStageState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [redirectTarget, setRedirectTarget] = useState("");

  function updateStage(name, status, detail = "") {
    setStages((current) => current.map((stage) => (stage.name === name ? { ...stage, status, detail } : stage)));
  }

  function failStage(name, detail) {
    updateStage(name, "failed", detail);
  }

  function markUnresolvedFailure(detail) {
    setStages((current) => {
      if (current.some((stage) => stage.status === "failed")) return current;
      const firstPending = current.find((stage) => stage.status === "pending");
      if (!firstPending) return current;
      return current.map((stage) => (stage.name === firstPending.name ? { ...stage, status: "failed", detail } : stage));
    });
  }

  async function readJson(response) {
    return response.json().catch(() => ({}));
  }

  async function submitDiagnostic(event) {
    event.preventDefault();
    const submittedEmail = email.trim().toLowerCase();
    const submittedPassword = password;
    setError("");
    setRedirectTarget("");
    setStages(createDiagnosticStageState());

    if (!submittedEmail || !submittedPassword) {
      setError("Email and password are required.");
      setPassword("");
      return;
    }

    setLoading(true);
    try {
      updateStage("FORM_SUBMITTED", "passed", "Submit handler fired.");
      updateStage("LOGIN_REQUEST_SENT", "passed", "POST /api/auth/login");
      const loginResponse = await fetch(apiRequestUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: submittedEmail, password: submittedPassword })
      });
      updateStage("LOGIN_RESPONSE_STATUS", loginResponse.ok ? "passed" : "failed", `HTTP ${loginResponse.status}`);
      const loginPayload = await readJson(loginResponse);
      if (!loginResponse.ok) throw new Error(loginPayload.error || `Login failed with HTTP ${loginResponse.status}.`);

      try {
        validateAuthPayload(loginPayload);
      } catch (validationError) {
        failStage("LOGIN_RESPONSE_SHAPE_VALID", "Login response is incomplete.");
        throw validationError;
      }
      updateStage("LOGIN_RESPONSE_SHAPE_VALID", "passed", "accessToken, refreshToken, user, and memberships parsed.");

      const provisionalMemberships = loginPayload.memberships || [];
      const provisionalUser = normalizeSessionUser(loginPayload.user, provisionalMemberships);
      storeSession({ ...loginPayload, user: provisionalUser });
      const stored = getStoredSession();
      if (!stored.token || !stored.user?.id) {
        failStage("SESSION_STORED", "Session material was missing after storage.");
        throw new Error("Session was not present after storage.");
      }
      updateStage("SESSION_STORED", "passed", "Session material is present in the existing bearer-token store.");

      updateStage("AUTH_ME_REQUEST_SENT", "passed", "GET /api/auth/me");
      const meResponse = await fetch(apiRequestUrl("/api/auth/me"), {
        headers: { Authorization: `Bearer ${loginPayload.accessToken}` }
      });
      updateStage("AUTH_ME_RESPONSE_STATUS", meResponse.ok ? "passed" : "failed", `HTTP ${meResponse.status}`);
      const mePayload = await readJson(meResponse);
      if (!meResponse.ok) throw new Error(mePayload.error || `auth/me failed with HTTP ${meResponse.status}.`);

      const memberships = mePayload.memberships || provisionalMemberships;
      const resolvedUser = normalizeSessionUser(mePayload.user || loginPayload.user, memberships);
      const roleMatches = expectedRole === "SUPER_ADMIN"
        ? resolvedUser.role === "SUPER_ADMIN"
        : restaurantRoles.includes(resolvedUser.role);
      if (!roleMatches) {
        failStage("ROLE_RESOLVED", `Resolved role ${resolvedUser.role || "UNKNOWN"} does not match ${expectedRole}.`);
        throw new Error(`Resolved role ${resolvedUser.role || "UNKNOWN"} does not match ${expectedRole}.`);
      }
      updateStage("ROLE_RESOLVED", "passed", resolvedUser.role);

      const membership = activeMembership(memberships);
      if (expectedRole === "RESTAURANT_OWNER" && !membership?.tenantSlug) {
        failStage("MEMBERSHIP_RESOLVED", "No active tenant membership was resolved.");
        throw new Error("Restaurant login succeeded but no active tenant membership was resolved.");
      }
      updateStage("MEMBERSHIP_RESOLVED", "passed", expectedRole === "SUPER_ADMIN" ? "No tenant membership required." : membership.tenantSlug);

      const nextSession = { ...loginPayload, memberships, user: resolvedUser };
      storeSession(nextSession);
      const target = dashboardPathFor(resolvedUser);
      setRedirectTarget(target);
      updateStage("REDIRECT_TARGET_CALCULATED", "passed", target);
    } catch (diagnosticError) {
      markUnresolvedFailure(diagnosticError.message);
      setError(diagnosticError.message);
    } finally {
      setPassword("");
      setLoading(false);
    }
  }

  if (!authDiagnosticPageEnabled) {
    return (
      <div className="min-h-screen bg-[#f7f8fb] px-4 py-10 text-slate-700">
        <AccessDenied title="Auth diagnostic disabled." detail="Set VITE_AUTH_DIAGNOSTIC=true for a temporary controlled login trace." loginHref="/admin/login" />
      </div>
    );
  }

  const allPassed = stages.every((stage) => stage.status === "passed");

  return (
    <div className="min-h-screen bg-[#f7f8fb] text-slate-700">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <BrandMark />
          <a className="button-muted" href="/">Back to Loohar</a>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-4 px-4 py-8 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="panel">
          <p className="text-sm font-black uppercase text-mint">Controlled auth diagnostic</p>
          <h1 className="mt-3 text-3xl font-black text-ink">Trace one login attempt</h1>
          <p className="mt-3 text-slate-500">This page stores a bearer-token session only after login succeeds, then verifies it with /api/auth/me. It never displays passwords, tokens, cookies, or hashes.</p>
          <form className="mt-6 grid gap-4" onSubmit={submitDiagnostic}>
            <label className="text-sm font-semibold text-slate-600">
              Email
              <input className="input mt-1" name="username" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label className="text-sm font-semibold text-slate-600">
              Password
              <input className="input mt-1" name="current-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </label>
            <label className="text-sm font-semibold text-slate-600">
              Expected role
              <select className="input mt-1" value={expectedRole} onChange={(event) => setExpectedRole(event.target.value)}>
                <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                <option value="RESTAURANT_OWNER">RESTAURANT_OWNER</option>
              </select>
            </label>
            <button className="button-primary justify-center" type="submit" disabled={loading}>{loading ? "Tracing..." : "Sign In"}</button>
            {allPassed && redirectTarget ? <a className="button-muted justify-center" href={redirectTarget}>Continue to Dashboard</a> : null}
          </form>
          <InlineError message={error} />
        </section>
        <section className="panel">
          <h2 className="panel-title">Safe stages</h2>
          <div className="mt-4 grid gap-2">
            {stages.map((stage, index) => (
              <div className="rounded-md border border-line bg-white p-3" key={stage.name}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-black text-ink">{index + 1}. {stage.name}</p>
                  <StatusPill tone={stage.status === "passed" ? "good" : stage.status === "failed" ? "warn" : "neutral"}>{stage.status}</StatusPill>
                </div>
                {stage.detail ? <p className="mt-1 break-words text-sm text-slate-500">{stage.detail}</p> : null}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function PublicHome({ user, onLogout }) {
  const benefits = [
    { icon: Store, title: "Restaurant website", detail: "Launch a branded ordering website for each restaurant tenant." },
    { icon: ReceiptText, title: "Direct online ordering", detail: "Keep customer relationships and reduce marketplace dependency." },
    { icon: Truck, title: "Delivery app", detail: "Dispatch orders to in-house drivers with tips and earnings tracking." },
    { icon: TicketPercent, title: "Customer loyalty", detail: "Reward repeat guests with points, coupons, and direct reordering." },
    { icon: CreditCard, title: "Lower fees", detail: "Use subscription and platform fees instead of high marketplace commissions." },
    { icon: LayoutDashboard, title: "Operations dashboard", detail: "Manage menu, orders, kitchen, drivers, staff, reporting, and settings." }
  ];
  return (
    <div className="min-h-screen bg-[#f7f8fb] text-slate-700">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <BrandMark />
          <nav className="flex flex-wrap gap-2">
            {user ? <a className="nav-tab active" href={dashboardPathFor(user)}>Dashboard</a> : null}
            <a className="nav-tab" href="/admin/login">Admin Login</a>
            <a className="nav-tab" href="/restaurant/login">Restaurant Owner Login</a>
            {user ? <button className="nav-tab" onClick={onLogout}>Logout</button> : null}
          </nav>
        </div>
      </header>
      <main>
        <section
          className="loohar-hero"
          style={{ backgroundImage: "linear-gradient(90deg, rgba(9, 15, 23, 0.92), rgba(9, 15, 23, 0.52)), url('https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1800&q=80')" }}
        >
          <div className="mx-auto flex min-h-[68vh] max-w-7xl flex-col justify-center px-4 py-16 text-white">
            <p className="text-sm font-black uppercase tracking-wide text-mint">Restaurant direct ordering platform</p>
            <h1 className="mt-4 max-w-4xl text-5xl font-black leading-tight md:text-7xl">{appName}</h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-white/85">Restaurant websites, direct ordering, delivery, loyalty, and operations in one restaurant-owned SaaS platform.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a className="button-primary bg-mint hover:bg-emerald-700" href="/admin/login"><LogIn size={18} />Admin Login</a>
              <a className="button-muted border-white/30 bg-white/10 text-white hover:bg-white hover:text-ink" href="/restaurant/login"><ChefHat size={18} />Restaurant Owner Login</a>
            </div>
          </div>
        </section>
        <section className="mx-auto grid max-w-7xl gap-4 px-4 py-8 md:grid-cols-3">
          {benefits.map(({ icon: Icon, title, detail }) => (
            <div className="panel" key={title}>
              <Icon className="text-mint" size={24} />
              <h2 className="mt-3 text-lg font-black text-ink">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="border-t border-line bg-white px-4 py-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
          <span>{appName} - restaurant direct ordering, delivery, website, and operations SaaS.</span>
          <span>{tenantRootDomain}</span>
        </div>
      </footer>
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
  const [authDiagnostic, setAuthDiagnostic] = useState(null);
  const [loading, setLoading] = useState(false);
  const userEditedCredentials = useRef(false);
  const emailInputRef = useRef(null);
  const passwordInputRef = useRef(null);
  const issues = passwordIssues(newPassword);

  function clearLoginFields() {
    setEmail("");
    setPassword("");
    if (emailInputRef.current) emailInputRef.current.value = "";
    if (passwordInputRef.current) passwordInputRef.current.value = "";
  }

  function markCredentialEntry() {
    userEditedCredentials.current = true;
  }

  function updateAuthDiagnostic(stage, requestId, detail = "") {
    if (!authDiagnosticsEnabled) return;
    setAuthDiagnostic({
      requestId,
      stage,
      detail,
      updatedAt: new Date().toLocaleTimeString()
    });
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
    window.location.replace(getPostLoginDestination(user));
  }

  async function verifyLoginSession(payload, requestId) {
    updateAuthDiagnostic("/auth/me called", requestId, "Validating the new bearer token.");
    const current = await api("/api/auth/me", { token: payload.accessToken, clearOnUnauthorized: false, authRetry: false });
    updateAuthDiagnostic("/auth/me succeeded", requestId, "Session is valid.");
    const memberships = current.memberships || payload.memberships || [];
    return {
      ...payload,
      memberships,
      user: normalizeSessionUser(current.user || payload.user, memberships)
    };
  }

  function handleAuthenticated(payload, requestId) {
    const normalizedUser = normalizeSessionUser(payload.user, payload.memberships);
    const sessionPayload = { ...payload, user: normalizedUser };
    if (copy.allowed && !copy.allowed.includes(normalizedUser?.role)) {
      clearSession();
      setError("Access denied for this login area. Use the correct Loohar login for your role.");
      updateAuthDiagnostic("role rejected", requestId, `Received role ${normalizedUser?.role || "unknown"}.`);
      return;
    }
    onLogin(sessionPayload);
    setSession(sessionPayload);
    updateAuthDiagnostic("session saved", requestId, `Role ${normalizedUser?.role || "unknown"} accepted.`);
    if (requiresPasswordChange(normalizedUser)) {
      setStep("password");
      return;
    }
    if (normalizedUser?.mfaEnabled) {
      setStep("mfa");
      return;
    }
    updateAuthDiagnostic("redirect selected", requestId, getPostLoginDestination(normalizedUser));
    continueAfterAuth(normalizedUser);
  }

  async function submitLogin(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const requestId = globalThis.crypto?.randomUUID?.() || `auth-${Date.now()}`;
    updateAuthDiagnostic("form submitted", requestId, "Login form submit handler fired.");
    try {
      updateAuthDiagnostic("request sent", requestId, "POST /api/auth/login");
      const payload = validateAuthPayload(await api("/api/auth/login", { method: "POST", body: { email: email.trim().toLowerCase(), password }, clearOnUnauthorized: false, authRetry: false, skipAuth: true }));
      updateAuthDiagnostic("response received", requestId, "Login returned a token-bearing response.");
      const verifiedPayload = await verifyLoginSession(payload, requestId);
      handleAuthenticated(verifiedPayload, requestId);
    } catch (loginError) {
      updateAuthDiagnostic("failed", requestId, safeAuthErrorMessage(loginError, mode));
      setError(safeAuthErrorMessage(loginError, mode));
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
    const requestId = globalThis.crypto?.randomUUID?.() || `auth-${Date.now()}`;
    updateAuthDiagnostic("demo request sent", requestId, "POST /api/auth/demo-login");
    try {
      const payload = validateAuthPayload(await api("/api/auth/demo-login", { method: "POST", body: { role: demoRoleByMode[mode] || "SUPER_ADMIN" }, clearOnUnauthorized: false, authRetry: false, skipAuth: true }));
      const verifiedPayload = await verifyLoginSession(payload, requestId);
      handleAuthenticated(verifiedPayload, requestId);
    } catch (loginError) {
      updateAuthDiagnostic("failed", requestId, safeAuthErrorMessage(loginError, mode));
      setError(safeAuthErrorMessage(loginError, mode));
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
      const reloadedSession = await api("/api/auth/me", { token: payload.accessToken })
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
    <div className="min-h-screen bg-[#f7f8fb] text-slate-700">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <BrandMark compact />
          <a className="button-muted" href="/">Back to Loohar</a>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <section className="panel">
          <p className="text-xs font-black uppercase tracking-wide text-mint">{appName} secure access</p>
          <h1 className="mt-3 text-3xl font-black text-ink">{copy.title}</h1>
          <p className="mt-3 text-slate-500">{copy.detail}</p>
          <div className="mt-5 grid gap-2 text-sm text-slate-600">
            <div className="summary-line"><span>Live API</span><strong>{apiOnline ? "Connected" : "Unavailable"}</strong></div>
            <div className="summary-line"><span>Password policy</span><strong>12+ characters</strong></div>
            <div className="summary-line"><span>MFA</span><strong>Foundation ready</strong></div>
          </div>
        </section>

        {step === "login" ? (
          <form className="panel grid gap-4" onSubmit={submitLogin}>
            <h2 className="panel-title">Sign in</h2>
            <InlineError message={error} />
            {authDiagnosticsEnabled && authDiagnostic ? (
              <div className="rounded-md border border-line bg-slate-50 p-3 text-xs text-slate-600">
                <div className="font-black text-ink">Auth diagnostic</div>
                <div className="mt-1">Stage: {authDiagnostic.stage}</div>
                <div>Request ID: {authDiagnostic.requestId}</div>
                {authDiagnostic.detail ? <div>Detail: {authDiagnostic.detail}</div> : null}
                <div>Updated: {authDiagnostic.updatedAt}</div>
              </div>
            ) : null}
            <label className="text-sm font-semibold text-slate-600">
              Email
              <input
                ref={emailInputRef}
                className="input mt-1"
                type="email"
                name="username"
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
                name="current-password"
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
            <button className="button-primary justify-center" type="submit" disabled={loading || !apiOnline}><LogIn size={18} />{loading ? "Signing in" : "Login"}</button>
            <a className="text-center text-sm font-bold text-mint" href="/forgot-password">Forgot password?</a>
            {import.meta.env.DEV ? <button className="button-muted justify-center" type="button" disabled={loading || !apiOnline} onClick={submitDemoLogin}>Use seeded development account</button> : null}
            {!apiOnline ? <p className="text-sm text-slate-500">Start the API before using secure login.</p> : null}
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
      </main>
    </div>
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
      const payload = await api("/api/auth/forgot-password", { method: "POST", body: { email: email.trim().toLowerCase() } });
      setMessage(payload.message || "If that email exists, a password reset link has been sent.");
    } catch (forgotError) {
      setError(forgotError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f8fb] text-slate-700">
      <main className="mx-auto grid max-w-4xl gap-6 px-4 py-10">
        <BrandMark />
        <form className="panel grid gap-4" onSubmit={submit}>
          <h1 className="text-3xl font-black text-ink">Reset password</h1>
          <p className="text-sm text-slate-500">Enter the account email and Loohar will create a one-time reset link.</p>
          <InlineError message={error} />
          {message ? <div className="success-box">{message}</div> : null}
          <input className="input" type="email" autoComplete="username" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <div className="flex flex-wrap gap-2">
            <button className="button-primary" type="submit" disabled={loading}>{loading ? "Sending" : "Send reset link"}</button>
            <a className="button-muted" href="/login">Back to login</a>
          </div>
        </form>
      </main>
    </div>
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
      const payload = await api("/api/auth/reset-password", { method: "POST", body: { token: resetToken, newPassword } });
      onLogin(payload);
      window.location.assign(dashboardPathFor(payload.user));
    } catch (resetError) {
      setError(resetError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f8fb] text-slate-700">
      <main className="mx-auto grid max-w-4xl gap-6 px-4 py-10">
        <BrandMark />
        <form className="panel grid gap-4" onSubmit={submit}>
          <h1 className="text-3xl font-black text-ink">Create new password</h1>
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
      </main>
    </div>
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
      window.location.assign("/admin");
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
                      <td><StatusPill tone={restaurant.websiteSettings?.websiteEnabled === false ? "warn" : "good"}>{restaurant.websiteSettings?.websiteEnabled === false ? "Disabled" : "Enabled"}</StatusPill><span>{restaurant.websiteSettings?.websiteEnabled === false ? "Food ordering" : "Website active"}</span></td>
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
                            <a href={`/sites/${restaurant.slug}`} target="_blank" rel="noreferrer">View Website</a>
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
  const [error, setError] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [itemForm, setItemForm] = useState({ categoryId: "", name: "", priceCents: 1295, preparationTimeMins: 15, description: "" });
  const [newItemImage, setNewItemImage] = useState(null);
  const [itemFileInputKey, setItemFileInputKey] = useState(0);
  const [uploadingAsset, setUploadingAsset] = useState("");
  const [galleryForm, setGalleryForm] = useState({ title: "", category: "food" });
  const [socialForm, setSocialForm] = useState({ platform: "instagram", url: "" });
  const [employeeForm, setEmployeeForm] = useState({ name: "", email: "", phone: "", role: "KITCHEN_STAFF" });
  const [zoneForm, setZoneForm] = useState({ name: "Zone A", radiusMiles: 3, deliveryFeeCents: 399, minimumOrderCents: 1500 });
  const [inventoryForm, setInventoryForm] = useState({ name: "Chicken", quantity: 10, unit: "lb", costCents: 2500 });
  const publicPreviewPath = `/sites/${profile.slug || "demo-bistro"}`;
  const publicSiteUrl = canonicalTenantUrlFor(profile, domain);

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
      const [dashboardPayload, profilePayload, categoriesPayload, itemsPayload, ordersPayload, driversPayload, customersPayload, customerSummaryPayload, loyaltyPayload, promotionsPayload, analyticsPayload, menuInsightsPayload, locationsPayload, websitePayload, domainPayload, galleryPayload, socialPayload, employeesPayload, dispatchPayload, zonesPayload, inventoryPayload, printingPayload, notificationsPayload, operationsPayload] = await Promise.all([
        api(`/api/restaurants/${restaurantId}/dashboard`, { token }),
        api(`/api/restaurants/${restaurantId}/profile`, { token }),
        api(`/api/restaurants/${restaurantId}/menu/categories`, { token }),
        api(`/api/restaurants/${restaurantId}/menu/items`, { token }),
        api(`/api/restaurants/${restaurantId}/orders`, { token }),
        api(`/api/restaurants/${restaurantId}/drivers`, { token }),
        api(`/api/restaurants/${restaurantId}/customers`, { token }),
        api(`/api/restaurants/${restaurantId}/customers/summary`, { token }),
        api(`/api/restaurants/${restaurantId}/loyalty`, { token }),
        api(`/api/restaurants/${restaurantId}/promotions/analytics`, { token }),
        api(`/api/restaurants/${restaurantId}/analytics`, { token }),
        api(`/api/restaurants/${restaurantId}/menu/insights`, { token }),
        api(`/api/restaurants/${restaurantId}/locations`, { token }),
        api(`/api/restaurants/${restaurantId}/website`, { token }),
        api(`/api/restaurants/${restaurantId}/domain`, { token }),
        api(`/api/restaurants/${restaurantId}/gallery`, { token }),
        api(`/api/restaurants/${restaurantId}/social-links`, { token }),
        api(`/api/restaurants/${restaurantId}/employees`, { token }),
        api(`/api/restaurants/${restaurantId}/dispatch`, { token }),
        api(`/api/restaurants/${restaurantId}/delivery-zones`, { token }),
        api(`/api/restaurants/${restaurantId}/inventory`, { token }),
        api(`/api/restaurants/${restaurantId}/printing`, { token }),
        api(`/api/restaurants/${restaurantId}/notification-settings`, { token }),
        api(`/api/restaurants/${restaurantId}/reports/operations`, { token })
      ]);
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
    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return null;
    }
    if (!apiOnline || !token || !restaurantId) {
      setError("Live API connection and restaurant login are required for image uploads.");
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
      return payload;
    } catch (uploadError) {
      setError(uploadError.message);
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
    const file = event.target.files?.[0];
    const uploaded = await uploadRestaurantImage("gallery", file, {
      title: galleryForm.title,
      altText: galleryForm.title,
      category: galleryForm.category,
      sortOrder: gallery.length + 1
    });
    if (uploaded) setGalleryForm({ title: "", category: "food" });
    event.target.value = "";
  }

  async function uploadMenuItemImage(item, event) {
    const file = event.target.files?.[0];
    await uploadRestaurantImage("menu-item", file, { menuItemId: item.id, altText: item.name });
    event.target.value = "";
  }

  async function createCategory(event) {
    event.preventDefault();
    if (!apiOnline) return setCategories((current) => [...current, { id: categoryName, name: categoryName, items: [] }]);
    try {
      await api(`/api/restaurants/${restaurantId}/menu/categories`, { method: "POST", token, body: { name: categoryName, sortOrder: categories.length + 1 } });
      setCategoryName("");
      await loadRestaurant();
    } catch (createError) {
      setError(createError.message);
    }
  }

  async function deleteCategory(categoryId) {
    if (!apiOnline) return setCategories((current) => current.filter((category) => category.id !== categoryId));
    try {
      await api(`/api/restaurants/${restaurantId}/menu/categories/${categoryId}`, { method: "DELETE", token });
      await loadRestaurant();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function createItem(event) {
    event.preventDefault();
    const payload = { ...itemForm, priceCents: Number(itemForm.priceCents), preparationTimeMins: Number(itemForm.preparationTimeMins), options: [] };
    const imageValidationError = newItemImage ? validateImageFile(newItemImage) : "";
    if (imageValidationError) return setError(imageValidationError);
    if (!apiOnline) return setItems((current) => [...current, { ...payload, id: crypto.randomUUID(), available: true }]);
    try {
      const created = await api(`/api/restaurants/${restaurantId}/menu/items`, { method: "POST", token, body: payload });
      if (newItemImage && created.item?.id) {
        await uploadRestaurantImage("menu-item", newItemImage, { menuItemId: created.item.id, altText: payload.name });
      }
      setItemForm({ categoryId: categories[0]?.id || "", name: "", priceCents: 1295, preparationTimeMins: 15, description: "" });
      setNewItemImage(null);
      setItemFileInputKey((key) => key + 1);
      await loadRestaurant();
    } catch (createError) {
      setError(createError.message);
    }
  }

  async function updateItem(item, data) {
    if (!apiOnline) return setItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, ...data } : currentItem));
    try {
      await api(`/api/restaurants/${restaurantId}/menu/items/${item.id}`, { method: "PATCH", token, body: data });
      await loadRestaurant();
    } catch (updateError) {
      setError(updateError.message);
    }
  }

  async function deleteItem(itemId) {
    if (!apiOnline) return setItems((current) => current.filter((item) => item.id !== itemId));
    try {
      await api(`/api/restaurants/${restaurantId}/menu/items/${itemId}`, { method: "DELETE", token });
      await loadRestaurant();
    } catch (deleteError) {
      setError(deleteError.message);
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
    if (!apiOnline) return;
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
    } catch (brandingError) {
      setError(brandingError.message);
    }
  }

  async function saveDomain(data = domain) {
    if (!apiOnline) return setDomain(data);
    try {
      const payload = await api(`/api/restaurants/${restaurantId}/domain`, { method: "PATCH", token, body: data });
      setDomain(payload.domain);
    } catch (domainError) {
      setError(domainError.message);
    }
  }

  async function verifyDomain() {
    if (!apiOnline) return setDomain({ ...domain, domainStatus: "VERIFIED", sslStatus: "SSL_PENDING" });
    try {
      const payload = await api(`/api/restaurants/${restaurantId}/domain/verify`, { method: "POST", token, body: { canonicalDomain: domain.customDomain || domain.canonicalDomain } });
      setDomain(payload.domain);
    } catch (domainError) {
      setError(domainError.message);
    }
  }

  async function addSocialLink(event) {
    event.preventDefault();
    if (!socialForm.url.trim()) return setError("Enter a social profile URL.");
    if (!apiOnline) return setError("Live API connection is required to save social links.");
    try {
      await api(`/api/restaurants/${restaurantId}/social-links`, { method: "POST", token, body: socialForm });
      setSocialForm({ platform: "instagram", url: "" });
      await loadRestaurant();
    } catch (socialError) {
      setError(socialError.message);
    }
  }

  async function deleteSocialLink(linkId) {
    if (!apiOnline) return;
    try {
      await api(`/api/restaurants/${restaurantId}/social-links/${linkId}`, { method: "DELETE", token });
      setSocialLinks((current) => current.filter((link) => link.id !== linkId));
    } catch (socialError) {
      setError(socialError.message);
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

  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Restaurant dashboard" title={apiOnline ? "Live restaurant operations" : "Demo Bistro operations"} icon={ChefHat} action={<button className="button-muted" onClick={loadRestaurant}><RefreshCw size={18} />Refresh</button>} />
      <InlineError message={error} />
      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={Clock} label="Pending orders" value={stats.pendingOrders ?? orders.filter((order) => !["DELIVERED", "CANCELLED"].includes(order.status)).length} detail="Live kitchen queue" />
        <Stat icon={ReceiptText} label="Today's sales" value={money(stats.sales?.amountCents || stats.sales?.restaurantNetCents || orders.reduce((sum, order) => sum + order.totalCents, 0))} detail="Tips separated" />
        <Stat icon={Truck} label="Available drivers" value={stats.activeDrivers ?? drivers.filter((driver) => driver.available).length} detail="Internal fleet" />
        <Stat icon={TicketPercent} label="Orders today" value={stats.ordersToday ?? orders.length} detail="Pickup and delivery" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="panel" id="orders">
          <h3 className="panel-title">Menu management</h3>
          <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={createCategory}>
            <input className="input" placeholder="New category" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} />
            <button className="button-primary" type="submit"><Plus size={16} />Category</button>
          </form>
          <form className="mt-4 form-grid" onSubmit={createItem}>
            <select className="select" value={itemForm.categoryId} onChange={(event) => setItemForm({ ...itemForm, categoryId: event.target.value })}>
              <option value="">Select category</option>
              {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
            </select>
            <input className="input" placeholder="Item name" value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} />
            <input className="input" type="number" placeholder="Price cents" value={itemForm.priceCents} onChange={(event) => setItemForm({ ...itemForm, priceCents: event.target.value })} />
            <input className="input" placeholder="Description" value={itemForm.description} onChange={(event) => setItemForm({ ...itemForm, description: event.target.value })} />
            <input className="input" type="number" placeholder="Prep minutes" value={itemForm.preparationTimeMins} onChange={(event) => setItemForm({ ...itemForm, preparationTimeMins: event.target.value })} />
            <label className="button-muted justify-center">
              <Plus size={16} />{newItemImage ? newItemImage.name : "Food image"}
              <input key={itemFileInputKey} className="sr-only" type="file" accept={imageAccept} onChange={(event) => setNewItemImage(event.target.files?.[0] || null)} />
            </label>
            <button className="button-primary" type="submit"><MenuIcon size={16} />Create item</button>
          </form>
          <div className="mt-5 space-y-4">
            {categories.length === 0 ? <EmptyState title="No menu categories" detail="Add a category before creating menu items." /> : categories.map((category) => (
              <div key={category.id}>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="font-bold text-ink">{category.name}</h4>
                  <button className="button-muted" onClick={() => deleteCategory(category.id)}><Trash2 size={15} />Delete</button>
                </div>
                <div className="space-y-2">
                  {items.filter((item) => item.categoryId === category.id || item.category?.id === category.id).length === 0 ? <p className="text-sm text-slate-500">No items in this category.</p> : items.filter((item) => item.categoryId === category.id || item.category?.id === category.id).map((item) => (
                    <div className="menu-row" key={item.id}>
                      <div className="flex items-center gap-3">
                        {item.imageUrl ? <img className="order-card-img" src={resolveImage(item.imageUrl, website.heroImageUrl)} alt={item.name} onError={handleSafeImageError} /> : <div className="grid h-20 w-20 shrink-0 place-items-center rounded-md bg-slate-100 text-xs font-bold text-slate-400">Photo</div>}
                        <div>
                        <p className="font-semibold text-ink">{item.name}</p>
                        <p className="text-sm text-slate-500">{item.preparationTimeMins} min prep - {item.available === false ? "Unavailable" : "Available"}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{money(item.priceCents)}</strong>
                        <label className="button-muted">
                          <Plus size={15} />{uploadingAsset === "menu-item" ? "Uploading" : item.imageUrl ? "Change photo" : "Add photo"}
                          <input className="sr-only" type="file" accept={imageAccept} onChange={(event) => uploadMenuItemImage(item, event)} />
                        </label>
                        <button className="button-muted" onClick={() => updateItem(item, { available: !item.available })}>{item.available === false ? "Enable" : "Disable"}</button>
                        <button className="button-muted" onClick={() => deleteItem(item.id)}><Trash2 size={15} />Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
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
          <div className="mt-4 space-y-3">
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
          </div>
        </div>
        <div className="panel">
          <h3 className="panel-title">Loyalty program</h3>
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
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="panel">
          <h3 className="panel-title">Promotions</h3>
          <div className="mt-4 space-y-2">
            {(promotions.activePromotions || []).length === 0 ? <EmptyState title="No active promotions" detail="Create coupons for fixed discounts, percentage discounts, free delivery, or BOGO campaigns." /> : promotions.activePromotions.map((coupon) => (
              <div className="summary-line" key={coupon.id}><span>{coupon.code}</span><strong>{coupon.redeemedCount || 0} used</strong></div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3 className="panel-title">Restaurant analytics</h3>
          <div className="mt-4 space-y-2 text-sm text-slate-600">
            <div className="summary-line"><span>Total orders</span><strong>{growthAnalytics.metrics?.totalOrders || orders.length}</strong></div>
            <div className="summary-line"><span>Delivery orders</span><strong>{growthAnalytics.metrics?.deliveryOrders || 0}</strong></div>
            <div className="summary-line"><span>Pickup orders</span><strong>{growthAnalytics.metrics?.pickupOrders || 0}</strong></div>
            <div className="summary-line"><span>Driver tips</span><strong>{money(growthAnalytics.metrics?.driverTipsCents)}</strong></div>
          </div>
        </div>
        <div className="panel">
          <h3 className="panel-title">Menu insights</h3>
          <div className="mt-4 space-y-2">
            {(menuInsights.bestSellingItems || []).length === 0 ? <EmptyState title="No item insights yet" detail="Best sellers and weak performers appear after orders." /> : menuInsights.bestSellingItems.slice(0, 4).map((item) => (
              <div className="summary-line" key={item.id}><span>{item.name}</span><strong>{item.quantity} sold</strong></div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-2" id="website">
        <div className="panel">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <h3 className="panel-title">Website Builder</h3>
              <p className="mt-2 text-sm text-slate-500">Manage the public restaurant website generated from this tenant.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a className="button-muted" href={publicPreviewPath}>Preview Website</a>
              <a className="button-muted" href={`${publicPreviewPath}/menu`}>Preview Menu</a>
              <a className="button-muted" href={`${publicPreviewPath}/order`}>Preview Order</a>
              <a className="button-muted" href={`${publicPreviewPath}/contact`}>Preview Contact</a>
              <a className="button-primary" href={publicSiteUrl} target="_blank" rel="noreferrer">Open Public Website</a>
              <button className="button-muted" onClick={() => navigator.clipboard?.writeText(publicSiteUrl)}>Copy Website Link</button>
            </div>
          </div>
          <div className="mt-4 form-grid">
            <input className="input" placeholder="Restaurant name" value={profile.businessName || profile.name || ""} onChange={(event) => setProfile({ ...profile, name: event.target.value, businessName: event.target.value })} />
            <input className="input" placeholder="Phone" value={profile.phone || ""} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} />
            <input className="input" placeholder="Email" value={profile.email || ""} onChange={(event) => setProfile({ ...profile, email: event.target.value })} />
            <input className="input" placeholder="Address" value={profile.address || ""} onChange={(event) => setProfile({ ...profile, address: event.target.value })} />
            <input className="input" placeholder="City" value={profile.city || ""} onChange={(event) => setProfile({ ...profile, city: event.target.value })} />
            <input className="input" placeholder="State" value={profile.state || ""} onChange={(event) => setProfile({ ...profile, state: event.target.value })} />
            <label className="text-sm font-semibold text-slate-600">Website status
              <select className="select mt-1" value={website.websiteEnabled ? "enabled" : "disabled"} onChange={(event) => setWebsite({ ...website, websiteEnabled: event.target.value === "enabled" })}>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-600">Brand color
              <input className="input mt-1" value={website.brandColor || ""} onChange={(event) => setWebsite({ ...website, brandColor: event.target.value })} />
            </label>
            <label className="text-sm font-semibold text-slate-600">Accent color
              <input className="input mt-1" value={website.accentColor || ""} onChange={(event) => setWebsite({ ...website, accentColor: event.target.value })} />
            </label>
            <input className="input" placeholder="Homepage headline" value={website.heroTitle || ""} onChange={(event) => setWebsite({ ...website, heroTitle: event.target.value })} />
            <input className="input" placeholder="Homepage subtitle" value={website.heroSubtitle || ""} onChange={(event) => setWebsite({ ...website, heroSubtitle: event.target.value })} />
            <input className="input" placeholder="Tagline" value={website.tagline || ""} onChange={(event) => setWebsite({ ...website, tagline: event.target.value })} />
            <input className="input" placeholder="Cuisine type" value={website.cuisineType || ""} onChange={(event) => setWebsite({ ...website, cuisineType: event.target.value })} />
            <input className="input" placeholder="Special offer text" value={website.specialOfferText || ""} onChange={(event) => setWebsite({ ...website, specialOfferText: event.target.value })} />
            <input className="input" placeholder="Heading font" value={website.headingFont || ""} onChange={(event) => setWebsite({ ...website, headingFont: event.target.value })} />
            <input className="input" placeholder="Body font" value={website.bodyFont || ""} onChange={(event) => setWebsite({ ...website, bodyFont: event.target.value })} />
            <input className="input" placeholder="SEO title" value={website.seoTitle || ""} onChange={(event) => setWebsite({ ...website, seoTitle: event.target.value })} />
            <textarea className="input min-h-24 md:col-span-3" placeholder="About story" value={website.aboutStory || ""} onChange={(event) => setWebsite({ ...website, aboutStory: event.target.value })} />
            <textarea className="input min-h-20 md:col-span-3" placeholder="SEO description" value={website.seoDescription || ""} onChange={(event) => setWebsite({ ...website, seoDescription: event.target.value })} />
            <div className="md:col-span-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-line p-3">
                <p className="text-sm font-bold text-ink">Logo</p>
                {website.logoUrl ? <img className="mt-2 h-20 w-20 rounded-md object-cover" src={resolveImage(website.logoUrl, profile.logoUrl)} alt={`${profile.name} logo`} onError={handleSafeImageError} /> : <p className="mt-2 text-sm text-slate-500">Loohar default logo will display until a logo is uploaded.</p>}
                <label className="button-muted mt-3">
                  <Plus size={15} />{uploadingAsset === "restaurant-logo" ? "Uploading logo" : "Upload logo"}
                  <input className="sr-only" type="file" accept={imageAccept} onChange={uploadLogo} />
                </label>
              </div>
              <div className="rounded-md border border-line p-3">
                <p className="text-sm font-bold text-ink">Hero image</p>
                {website.heroImageUrl ? <img className="mt-2 h-24 w-full rounded-md object-cover" src={resolveImage(website.heroImageUrl, profile.logoUrl)} alt={`${profile.name} hero`} onError={handleSafeImageError} /> : <p className="mt-2 text-sm text-slate-500">Upload a restaurant, food, or storefront hero image.</p>}
                <label className="button-muted mt-3">
                  <Plus size={15} />{uploadingAsset === "restaurant-hero" ? "Uploading hero" : "Upload hero"}
                  <input className="sr-only" type="file" accept={imageAccept} onChange={uploadHero} />
                </label>
              </div>
            </div>
            <div className="md:col-span-3 flex flex-wrap gap-2">
              {Object.entries(websiteSectionDefaults).map(([section]) => (
                <label className={`seg ${sectionSettings[section] ? "active" : ""}`} key={section}>
                  <input
                    type="checkbox"
                    checked={sectionSettings[section]}
                    onChange={(event) => setWebsite({ ...website, sectionSettingsJson: { ...sectionSettings, [section]: event.target.checked } })}
                  />
                  {readable(section)}
                </label>
              ))}
            </div>
          </div>
          <button className="button-primary mt-4" onClick={saveWebsiteBuilder}><Store size={16} />Save Website Settings</button>
        </div>
        <div className="panel">
          <h3 className="panel-title">Domain Management</h3>
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
            <button className="button-primary" onClick={() => saveDomain({ ...domain, domainStatus: "PENDING_VERIFICATION", sslStatus: "PENDING" })}>Save Domain</button>
            <button className="button-muted" onClick={verifyDomain}>Verify Domain</button>
            <button className="button-muted" onClick={() => saveDomain({ ...domain, customDomain: "", canonicalDomain: domain.primaryDomain || `${domain.defaultSubdomain || profile.slug}.${tenantRootDomain}`, domainStatus: "NOT_CONFIGURED", sslStatus: "NOT_CONFIGURED" })}>Remove Custom Domain</button>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-bold text-ink">Gallery</h4>
              </div>
              <div className="mt-3 grid gap-2">
                <input className="input" placeholder="Gallery title" value={galleryForm.title} onChange={(event) => setGalleryForm({ ...galleryForm, title: event.target.value })} />
                <select className="select" value={galleryForm.category} onChange={(event) => setGalleryForm({ ...galleryForm, category: event.target.value })}>
                  <option value="food">Food</option>
                  <option value="interior">Interior</option>
                  <option value="team">Team</option>
                  <option value="events">Events</option>
                </select>
                <label className="button-muted justify-center">
                  <Plus size={15} />{uploadingAsset === "gallery" ? "Uploading photo" : "Upload gallery photo"}
                  <input className="sr-only" type="file" accept={imageAccept} onChange={uploadGalleryImage} />
                </label>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">{gallery.length === 0 ? <p className="text-sm text-slate-500">No gallery photos yet.</p> : gallery.slice(0, 4).map((image) => <figure className="rounded-md border border-line p-2" key={image.id}><img className="h-20 w-full rounded-md object-cover" src={resolveImage(image.imageUrl, website.heroImageUrl)} alt={image.altText || "Restaurant gallery"} onError={handleSafeImageError} /><figcaption className="mt-1 truncate text-xs text-slate-500">{image.altText || image.category}</figcaption></figure>)}</div>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-bold text-ink">Social links</h4>
              </div>
              <form className="mt-3 grid gap-2" onSubmit={addSocialLink}>
                <select className="select" value={socialForm.platform} onChange={(event) => setSocialForm({ ...socialForm, platform: event.target.value })}>
                  <option value="facebook">Facebook</option>
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                  <option value="youtube">YouTube</option>
                </select>
                <input className="input" placeholder="Profile URL" value={socialForm.url} onChange={(event) => setSocialForm({ ...socialForm, url: event.target.value })} />
                <button className="button-primary" type="submit"><Plus size={15} />Save link</button>
              </form>
              <div className="mt-3 space-y-2">{socialLinks.length === 0 ? <p className="text-sm text-slate-500">No social links yet.</p> : socialLinks.map((link) => <div className="summary-line" key={link.id}><span>{readable(link.platform)}</span><button className="button-muted" onClick={() => deleteSocialLink(link.id)}><Trash2 size={14} />Remove</button></div>)}</div>
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
            <a className="button-primary" href={`/kitchen/${profile.slug || restaurantId}`} target="_blank" rel="noreferrer"><ReceiptText size={16} />Open KDS</a>
          </div>
          <div className="mt-4 grid gap-3">
            {orders.filter((order) => !["DELIVERED", "CANCELLED"].includes(order.status)).length === 0 ? <EmptyState title="No active kitchen orders" detail="New pickup and delivery orders will appear here." /> : orders.filter((order) => !["DELIVERED", "CANCELLED"].includes(order.status)).slice(0, 4).map((order) => (
              <div className="summary-line rounded-md border border-line px-3 py-2" key={order.id}>
                <span>#{order.orderNumber} - {order.customer?.name || "Customer"}</span>
                <StatusPill tone={order.status === "READY" ? "warn" : "neutral"}>{kdsStatusFor(order.status)}</StatusPill>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3 className="panel-title">Receipt and ticket printing</h3>
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
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="panel" id="drivers">
          <h3 className="panel-title">Employees</h3>
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
        </div>
        <div className="panel">
          <h3 className="panel-title">Driver Dispatch Center</h3>
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
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="panel">
          <h3 className="panel-title">Delivery Zones</h3>
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
        </div>
        <div className="panel">
          <h3 className="panel-title">Inventory Foundation</h3>
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
        </div>
        <div className="panel">
          <h3 className="panel-title">Notifications</h3>
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
      </div>
      <div className="grid gap-5 xl:grid-cols-2" id="settings">
        <div className="panel">
          <h3 className="panel-title">Branding and settings</h3>
          <p className="mt-2 text-sm text-slate-500">Logo, hero image, brand colors, social links, contact info, and store hours are saved to the live restaurant profile and website records.</p>
          <button className="button-primary mt-4" onClick={saveWebsiteBuilder}><Store size={16} />Save branding</button>
        </div>
        <div className="panel">
          <h3 className="panel-title">Multi-location foundation</h3>
          <p className="mt-2 text-sm text-slate-500">{locations.length} configured location records. Future support will separate menus, drivers, and reporting by location.</p>
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
  const [checkoutUrl, setCheckoutUrl] = useState("");
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
  const orderTotal = subtotal + delivery + tax + tip;

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
      setCheckoutUrl("");
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
      setCheckoutUrl("");
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
      setCheckoutUrl("");
      return;
    }
    try {
      const payload = await api("/api/customer/orders", {
        method: "POST",
        body: {
          restaurantId: restaurant.id,
          customer: { name: customer.name, email: customer.email, phone: customer.phone },
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
        }
      });
      setOrderStatus({ ...payload.order, tracking: payload.tracking });
      setPaymentStatus(payload.payment);
      setCheckoutUrl(payload.checkoutUrl || "");
      setCart([]);
      await loadHistory();
    } catch (orderError) {
      setError(orderError.message);
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
            <div className="summary-line"><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
            {orderStatus?.discountCents ? <div className="summary-line"><span>Discount</span><strong>-{money(orderStatus.discountCents)}</strong></div> : null}
            <div className="summary-line"><span>Delivery</span><strong>{money(delivery)}</strong></div>
            <div className="summary-line"><span>Tax</span><strong>{money(tax)}</strong></div>
            <div className="summary-line"><span>Restaurant tip</span><strong>{money(restaurantTip)}</strong></div>
            {serviceType === "DELIVERY" ? <div className="summary-line"><span>Driver tip</span><strong>{money(driverTip)}</strong></div> : null}
            <div className="summary-line total"><span>Total</span><strong>{money(orderTotal)}</strong></div>
          </div>
          <button className="button-primary mt-5 w-full justify-center" disabled={!orderingEnabled || cart.length === 0} onClick={placeOrder}><CreditCard size={18} />Continue to secure payment</button>
          <div className="mt-5 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-ink">Order tracking</p>
              {orderStatus?.id ? <button className="button-muted" onClick={() => refreshStatus(orderStatus.id)}><RefreshCw size={15} />Refresh</button> : null}
            </div>
            {orderStatus ? <p className="mt-2">#{orderStatus.orderNumber} is {orderStatus.status}. Payment {paymentStatus?.status || "PENDING"}. Total {money(orderStatus.totalCents)}</p> : <p className="mt-1">Orders are created as pending payment and are confirmed after secure checkout succeeds.</p>}
            {orderStatus?.tracking?.webUrl ? <a className="button-muted mt-3 w-full justify-center" href={orderStatus.tracking.webUrl}>Track order</a> : null}
            {checkoutUrl && paymentStatus?.status !== "PAID" ? <a className="button-primary mt-3 w-full justify-center" href={checkoutUrl} target="_blank" rel="noreferrer"><CreditCard size={16} />Continue to Stripe Checkout</a> : null}
            {paymentStatus?.provider === "stripe" && paymentStatus.status !== "PAID" ? <p className="mt-2 text-xs text-slate-500">Complete payment in Stripe, then refresh order tracking.</p> : null}
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
              <a href={`/sites/${order.restaurant?.slug}/order`}>Open restaurant menu</a>
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
                <a className="button-primary" href={`/sites/${order.restaurant?.slug}/order`}>Reorder</a>
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
          rating: 4.8,
          reviewCount: 128,
          openStatus: "Hours vary",
          websiteUrl: `/sites/${restaurant.slug}`,
          orderUrl: `/sites/${restaurant.slug}/order`
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
  const initialPath = window.location.pathname;
  const [token, setToken] = useState(() => getStoredSession().token);
  const [refreshToken, setRefreshToken] = useState(() => getStoredSession().refreshToken);
  const [user, setUser] = useState(() => getStoredSession().user);
  const [apiOnline, setApiOnline] = useState(false);
  const [apiMode, setApiMode] = useState("CHECKING");
  const [authChecking, setAuthChecking] = useState(true);
  const isLoginRoute = initialPath === "/login" || initialPath === "/admin/login" || initialPath === "/restaurant/login";
  const isAuthDiagnosticRoute = initialPath === "/auth-diagnostic";
  const isForgotPasswordRoute = initialPath === "/forgot-password";
  const resetPasswordMatch = initialPath.match(/^\/reset-password\/([^/]+)\/?$/);
  const appOrderMatch = initialPath.match(/^\/app\/order\/([^/]+)\/?$/);
  const isDriverHost = window.location.hostname.startsWith("driver.");
  const tenantHost = tenantHostRouteInfo();
  const isDriverRoute = initialPath === "/driver" || initialPath.startsWith("/driver/") || (isDriverHost && /^\/order\/[^/]+\/?$/.test(initialPath));
  const isDiscoverRoute = initialPath === "/discover";
  const isAdminRoute = initialPath === "/admin" || initialPath.startsWith("/admin/");
  const isKitchenRoute = initialPath === "/kitchen" || initialPath.startsWith("/kitchen/");
  const isRestaurantRoute = initialPath === "/restaurant" || initialPath.startsWith("/restaurant/");
  const isCustomerRoute = initialPath === "/customer" || initialPath.startsWith("/customer/");
  const isSiteAdminRoute = /^\/sites\/[^/]+\/admin\/?$/.test(initialPath);
  const isTenantHostPublicPath = tenantHost.isTenantHost && !["/login", "/admin/login", "/restaurant/login", "/forgot-password"].includes(initialPath) && !initialPath.startsWith("/admin") && !initialPath.startsWith("/restaurant") && !initialPath.startsWith("/driver") && !initialPath.startsWith("/customer") && !initialPath.startsWith("/kitchen") && !initialPath.startsWith("/app/");
  const isSiteRoute = ((initialPath === "/sites" || initialPath.startsWith("/sites/")) && !isSiteAdminRoute) || isTenantHostPublicPath;
  const orderRouteSlug = initialPath.startsWith("/order/") ? initialPath.split("/")[2] : null;
  const isAdminCreateRoute = initialPath === "/admin/business/new";
  const adminAuditMatch = initialPath.match(/^\/admin\/business\/([^/]+)\/audit\/?$/);
  const isRestaurantBusinessSelectRoute = initialPath === "/restaurant/select-business";
  const isRestaurantAccountNotAssignedRoute = initialPath === "/restaurant/account-not-assigned";

  useEffect(() => {
    const privateRoute = isAdminRoute || isRestaurantRoute || isDriverRoute || isKitchenRoute || isCustomerRoute || isSiteAdminRoute || isLoginRoute || isAuthDiagnosticRoute || isForgotPasswordRoute || Boolean(resetPasswordMatch) || Boolean(appOrderMatch);
    setRobots(!privateRoute);
  }, [isAdminRoute, isRestaurantRoute, isDriverRoute, isKitchenRoute, isCustomerRoute, isSiteAdminRoute, isLoginRoute, isAuthDiagnosticRoute, isForgotPasswordRoute, resetPasswordMatch, appOrderMatch]);

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
    async function verifySession() {
      if (apiMode === "CHECKING") return;
      if (apiMode === "DEMO") {
        if (!cancelled) setAuthChecking(false);
        return;
      }
      if (!token) {
        clearSession();
        if (!cancelled) {
          setUser(null);
          setRefreshToken("");
          setAuthChecking(false);
        }
        return;
      }
      setAuthChecking(true);
      try {
        const current = await api("/api/auth/me", { token, clearOnUnauthorized: false, authRetry: false });
        const currentUser = normalizeSessionUser(current.user, current.memberships);
        if (!cancelled) {
          setUser(currentUser);
          storeSession({ accessToken: token, refreshToken, user: currentUser });
          setAuthChecking(false);
        }
      } catch {
        if (!refreshToken) {
          clearSession();
          if (!cancelled) {
            setToken("");
            setUser(null);
            setAuthChecking(false);
          }
          return;
        }
        try {
          const refreshed = await api("/api/auth/refresh", { method: "POST", body: { refreshToken }, clearOnUnauthorized: false, authRetry: false });
          const current = await api("/api/auth/me", { token: refreshed.accessToken, clearOnUnauthorized: false, authRetry: false });
          const nextMemberships = current.memberships || refreshed.memberships || [];
          const nextSession = { ...refreshed, memberships: nextMemberships, user: normalizeSessionUser(current.user || refreshed.user, nextMemberships) };
          if (!cancelled) {
            setToken(nextSession.accessToken);
            setRefreshToken(nextSession.refreshToken);
            setUser(nextSession.user);
            storeSession(nextSession);
            setAuthChecking(false);
          }
        } catch {
          clearSession();
          if (!cancelled) {
            setToken("");
            setRefreshToken("");
            setUser(null);
            setAuthChecking(false);
          }
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
    window.location.assign(dashboardPathFor(payload.user));
  }

  function logout() {
    if (token) api("/api/auth/logout", { method: "POST", token }).catch(() => {});
    setToken("");
    setRefreshToken("");
    setUser(null);
    clearSession();
    window.location.assign("/");
  }

  if (isForgotPasswordRoute) {
    return <ForgotPasswordPage apiOnline={apiOnline} />;
  }

  if (isAuthDiagnosticRoute) {
    return <AuthDiagnosticPage />;
  }

  if (resetPasswordMatch) {
    return <ResetPasswordPage apiOnline={apiOnline} token={decodeURIComponent(resetPasswordMatch[1])} onLogin={handleLogin} />;
  }

  if (appOrderMatch) {
    if (apiMode === "CHECKING") return <PublicSiteSkeleton premium />;
    return <CustomerOrderTrackingPage apiOnline={apiOnline} orderId={decodeURIComponent(appOrderMatch[1])} />;
  }

  if (isLoginRoute) {
    if (apiMode === "CHECKING" || (apiOnline && authChecking && token)) {
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
    if (isRestaurantAccountNotAssignedRoute) return <RestaurantAccountNotAssigned user={user} onLogout={logout} />;
    if (isRestaurantBusinessSelectRoute) return <RestaurantBusinessSelector user={user} onLogout={logout} />;
    const restaurantSlug = isRestaurantRoute ? routeSlug(initialPath, "restaurant") : "";
    const canOpenRestaurant = restaurantRoles.concat(["SUPER_ADMIN"]).includes(user?.role) && canAccessTenantRoute(user, initialPath, "restaurant") && !requiresPasswordChange(user);
    return (
      <div className="min-h-screen bg-[#f7f8fb] text-slate-700">
        <AppHeader navItems={restaurantOperationsNavigation(user, restaurantSlug, initialPath)} />
        <main className="mx-auto max-w-7xl px-4 py-6">
          <LoginStrip user={user} onLogout={logout} />
          <div className="my-4 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <StatusPill tone={apiOnline ? "good" : apiMode === "CHECKING" ? "neutral" : "warn"}>{apiOnline ? "Live API connected" : apiMode === "CHECKING" ? "Checking API" : "Offline demo fallback"}</StatusPill>
            <StatusPill tone={canOpenRestaurant ? "good" : "warn"}>{user?.role || "Restaurant login required"}</StatusPill>
          </div>
          {apiMode === "CHECKING" || (apiOnline && authChecking) ? <AppLoadingState /> : canOpenRestaurant ? <RestaurantApp apiOnline={apiOnline} token={token} user={user} initialSlug={restaurantSlug} /> : !user ? <AccessDenied title="Please sign in to continue." loginHref={loginHrefWithReturnTo("/restaurant/login")} detail="Restaurant login is required for this route." /> : <AccessDenied loginHref="/restaurant/login" detail="This route is only for the assigned restaurant owner, manager, or admin." />}
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
