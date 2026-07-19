import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const mode = process.argv[2] || "financial-separation";
const failures = [];

function read(filePath) {
  const absolutePath = join(root, filePath);
  if (!existsSync(absolutePath)) {
    failures.push(`Missing required file: ${filePath}`);
    return "";
  }
  return readFileSync(absolutePath, "utf8");
}

function assertCheck(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
    return;
  }
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function includesAll(content, values) {
  return values.every((value) => content.includes(value));
}

const schema = read("apps/api/prisma/schema.prisma");
const server = read("apps/api/src/server.js");
const platformService = read("apps/api/src/modules/platformBilling/platformBillingService.js");
const platformRoutes = read("apps/api/src/routes/platformBilling.js");
const registrationRoutes = read("apps/api/src/routes/registration.js");
const registrationService = read("apps/api/src/modules/registration/registrationService.js");
const orderService = read("apps/api/src/modules/orderPayments/orderPaymentService.js");
const quoteService = read("apps/api/src/modules/orderPayments/quoteService.js");
const orderRoutes = read("apps/api/src/routes/orderPayments.js");
const webhooks = read("apps/api/src/routes/webhooks.js");
const apiEnv = read("apps/api/.env.example");
const webEnv = read("apps/web/.env.example");
const app = read("apps/web/src/App.jsx");

const groups = {
  registration: () => {
    assertCheck(schema.includes("model PendingRegistration") && schema.includes("model SlugReservation"), "Registration stores pending registration and slug reservation records");
    assertCheck(server.includes("/api/registration") && includesAll(registrationRoutes, ['"/plans"', '"/slug/:slug"', '"/start"', '"/checkout"', '"/status"', '"/:registrationId/status"']), "Self-service registration API routes are mounted");
    assertCheck(includesAll(registrationService, ["passwordHash", "SlugReservation", "validatePublicSlug", "normalizeEmail"]), "Registration hashes passwords, reserves slugs, and normalizes email");
    assertCheck(registrationService.includes("safeRegistrationJson") && !registrationService.includes("registrationJson: body"), "Registration persists only sanitized registration metadata");
    assertCheck(platformService.includes("createPlatformCheckout") && platformService.includes("activatePaidRegistration"), "Platform checkout activates tenants from backend webhook logic");
    assertCheck(platformService.includes("checkout.session.completed") && platformService.includes("TENANT_CREATED"), "Registration tenant creation is driven by Stripe checkout completion");
    assertCheck(app.includes("/api/registration/start") && app.includes("/api/registration/checkout") && app.includes("/api/registration/plans"), "Frontend uses the public registration API");
    assertCheck(!app.includes("stripePriceId") && !app.includes("priceId") && !app.includes("STRIPE_PLATFORM"), "Frontend registration never submits Stripe Price IDs");
    assertCheck(!app.includes("activatePaidRegistration") && !app.includes("/tenant-created") && !app.includes("/payment-verified"), "Frontend does not activate paid registrations directly");
  },
  "slug-reservation": () => {
    assertCheck(schema.includes("model SlugReservation") && schema.includes("slug        String    @unique"), "Slug reservations are modeled with a unique slug");
    assertCheck(schema.includes("model PendingRegistration") && schema.includes("@@unique([slug])"), "Pending registrations enforce one active slug record");
    assertCheck(registrationRoutes.includes('"/slug/:slug"'), "Registration exposes a slug availability route");
    assertCheck(includesAll(registrationService, ["validatePublicSlug", "prisma.slugReservation.findUnique", "prisma.pendingRegistration.findUnique", "prisma.restaurant.findUnique"]), "Slug checks compare reservations, pending registrations, and tenants");
    assertCheck(includesAll(registrationService, ["expiresAt", "terminalStatuses", "That slug is temporarily reserved during another checkout."]), "Slug reservation checks honor expiration and terminal states");
    assertCheck(includesAll(registrationService, ["tx.slugReservation.upsert", "registration.slug.reserved", "registration.cancelled"]), "Registration reserves and releases slugs through audited writes");
  },
  "registration-security": () => {
    assertCheck(includesAll(registrationService, ["normalizeEmail(body.email)", "bcrypt.hash(body.password, 12)", "passwordHash"]), "Registration normalizes email and hashes passwords");
    assertCheck(!registrationService.includes("password: body.password") && !registrationService.includes("registrationJson: body"), "Registration does not persist plaintext password or raw request body");
    assertCheck(includesAll(registrationService, ["safeRegistrationJson", "maskEmail", "forcePasswordChange: false", "temporaryPassword: false"]), "Registration returns sanitized metadata and avoids temporary-password state");
    assertCheck(includesAll(registrationRoutes, ["validate(registrationSchema)", "validate(checkoutSchema)", "validate(cancelSchema)"]), "Registration routes validate mutating requests");
    assertCheck(includesAll(registrationRoutes, ["strongPasswordSchema", "termsAccepted: z.literal(true)", "privacyAccepted: z.literal(true)"]), "Registration account validation requires strong password policy and user agreements");
    assertCheck(!app.includes("localStorage.setItem(\"password") && !app.includes("sessionStorage.setItem(\"password") && !app.includes("passwordHash"), "Frontend does not store registration password or hash");
    assertCheck(!app.includes("STRIPE_PLATFORM_SECRET") && !app.includes("STRIPE_PLATFORM_WEBHOOK_SECRET"), "Frontend contains no platform Stripe secrets");
  },
  "platform-billing": () => {
    assertCheck(includesAll(schema, ["model PlatformPlan", "model PlatformSubscription", "model PlatformInvoice", "model PlatformBillingEvent"]), "Platform billing models are separate from restaurant order payments");
    assertCheck(includesAll(platformRoutes, ['"/checkout"', '"/portal"', '"/change-plan"', '"/cancel"', '"/subscription"', '"/invoices"']), "Platform billing routes exist");
    assertCheck(platformService.includes('mode: "subscription"') && platformService.includes('path: "/checkout/sessions"'), "Platform billing uses Stripe subscription Checkout Sessions");
    assertCheck(!platformService.includes("transfer_data[destination]") && !platformService.includes("RestaurantOrderPayment"), "Platform billing service does not create restaurant order payments or destination charges");
  },
  "order-payments": () => {
    assertCheck(includesAll(schema, ["model RestaurantMerchantAccount", "model RestaurantOrderPayment", "model RestaurantPaymentEvent", "model RestaurantRefund"]), "Restaurant order payment models are present");
    assertCheck(includesAll(orderRoutes, ['"/quote"', '"/create"', '"/confirm"', '"/refund"', '"/:orderId/status"', '"/:orderId/receipt"', '"/merchant-account/onboarding-link"']), "Restaurant order payment routes exist");
    assertCheck(orderService.includes("transfer_data[destination]") && orderService.includes("application_fee_amount"), "Restaurant order payments use Stripe Connect destination charges with platform fee");
    assertCheck(!orderService.includes('path: "/checkout/sessions"') && !orderService.includes('mode: "subscription"'), "Restaurant order payments do not use Stripe Billing Checkout Sessions");
  },
  "stripe-billing": () => {
    assertCheck(apiEnv.includes("STRIPE_PLATFORM_SECRET_KEY") && apiEnv.includes("STRIPE_PLATFORM_WEBHOOK_SECRET"), "Platform Stripe secret and webhook env vars are split");
    assertCheck(includesAll(apiEnv, ["STRIPE_PLATFORM_STARTER_MONTHLY_PRICE_ID", "STRIPE_PLATFORM_STARTER_ANNUAL_PRICE_ID", "STRIPE_PLATFORM_PRO_MONTHLY_PRICE_ID", "STRIPE_PLATFORM_PRO_ANNUAL_PRICE_ID", "STRIPE_PLATFORM_ENTERPRISE_MONTHLY_PRICE_ID", "STRIPE_PLATFORM_ENTERPRISE_ANNUAL_PRICE_ID"]), "Platform monthly and annual Stripe Price IDs are explicit");
    assertCheck(apiEnv.includes("STRIPE_PLATFORM_PRICE_STARTER") && apiEnv.includes("STRIPE_PLATFORM_PRICE_PROFESSIONAL") && apiEnv.includes("STRIPE_PLATFORM_PRICE_ENTERPRISE"), "Legacy platform price ID env vars remain documented");
    assertCheck(webhooks.includes("STRIPE_PLATFORM_WEBHOOK_SECRET") && server.includes("/api/webhooks/stripe-platform"), "Stripe platform webhook has its own route and secret");
  },
  "stripe-connect": () => {
    assertCheck(apiEnv.includes("STRIPE_CONNECT_SECRET_KEY") && apiEnv.includes("STRIPE_CONNECT_WEBHOOK_SECRET") && apiEnv.includes("STRIPE_CONNECT_CLIENT_ID"), "Stripe Connect env vars are split");
    assertCheck(webEnv.includes("VITE_STRIPE_CONNECT_PUBLIC_KEY"), "Frontend exposes only the Stripe Connect publishable key");
    assertCheck(webhooks.includes("STRIPE_CONNECT_WEBHOOK_SECRET") && server.includes("/api/webhooks/stripe-connect"), "Stripe Connect webhook has its own route and secret");
    assertCheck(orderService.includes('type: "express"') && orderService.includes("account_links"), "Merchant onboarding uses provider-hosted Stripe Express account links");
  },
  "authorize-net-platform": () => {
    assertCheck(apiEnv.includes("AUTHORIZE_NET_PLATFORM_ENABLED=false"), "Authorize.Net platform billing is disabled by default");
    assertCheck(server.includes("/api/webhooks/authorize-net-platform") && webhooks.includes("authorizeNetPlatformWebhookRouter"), "Authorize.Net platform webhook route exists behind a disabled gate");
  },
  "authorize-net-orders": () => {
    assertCheck(apiEnv.includes("AUTHORIZE_NET_ORDERS_ENABLED=false") && apiEnv.includes("AUTHORIZE_NET_ORDER_PAYMENTS_ENABLED=false"), "Authorize.Net order payments are disabled by default");
    assertCheck(server.includes("/api/webhooks/authorize-net-orders") && webhooks.includes("authorizeNetOrdersWebhookRouter"), "Authorize.Net order webhook route exists behind a disabled gate");
  },
  "tenant-provisioning": () => {
    assertCheck(platformService.includes("checkout.session.completed") && platformService.includes("activatePaidRegistration"), "Tenant provisioning starts from verified Stripe platform webhook processing");
    assertCheck(includesAll(platformService, ["restaurant.create", "websiteSettings", "domains", "categories", "restaurantStaff.upsert", "registration.completed"]), "Provisioning creates tenant, website/domain settings, starter categories, memberships, and audit records");
    assertCheck(platformService.includes("restaurantId: createdRestaurant.id") && platformService.includes("stripeCheckoutSessionId"), "Provisioning attaches the platform subscription to the created tenant");
    assertCheck(registrationService.includes("status: \"INVITED\"") && registrationService.includes("forcePasswordChange: false") && registrationService.includes("temporaryPassword: false"), "Self-service owner account remains unpaid and not temporary until webhook provisioning");
  },
  tax: () => {
    assertCheck(schema.includes("model TaxConfiguration") && schema.includes("model OrderTaxSnapshot"), "Tax configuration and per-order tax snapshots exist");
    assertCheck(includesAll(quoteService, ["taxableAmountCents", "taxRateBps", "taxCents"]), "Order quote service calculates tax server-side");
    assertCheck(apiEnv.includes("TAX_PROVIDER") && apiEnv.includes("DEFAULT_TAX_RATE_BPS"), "Tax env foundation exists");
  },
  tips: () => {
    assertCheck(includesAll(schema, ["restaurantTipCents", "driverTipCents", "DriverEarningLedger"]), "Restaurant tips, driver tips, and driver earning ledger are modeled");
    assertCheck(includesAll(quoteService, ["restaurantTipCents", "driverTipCents", "normalizeTipInput"]), "Order quote service separates restaurant and driver tips");
    assertCheck(app.includes("Restaurant tip") && app.includes("Driver tip"), "Customer checkout presents separate restaurant and driver tip controls");
  },
  refunds: () => {
    assertCheck(schema.includes("model RestaurantRefund") && schema.includes("enum RefundStatus"), "Restaurant refunds have dedicated records and statuses");
    assertCheck(orderService.includes('path: "/refunds"') && orderRoutes.includes('"/refund"'), "Refund route and Stripe refund call exist");
    assertCheck(orderService.includes("requested_by_customer") && orderService.includes("refundNote"), "Refund reasons are provider-safe while retaining operator notes");
  },
  reconciliation: () => {
    assertCheck(includesAll(schema, ["model RestaurantPayout", "model RestaurantPaymentDispute", "model RestaurantPaymentEvent"]), "Payout, dispute, and payment event records are modeled");
    assertCheck(includesAll(orderService, ["PAYOUT", "DISPUTE", "MERCHANT_ACCOUNT", "RESTAURANT_ORDER_PAYMENT"]), "Restaurant payment events are domain-classified");
    assertCheck(schema.includes("platformFeeCents") && schema.includes("restaurantNetCents"), "Restaurant payment rows preserve platform fee and restaurant net amounts");
  },
  "financial-separation": () => {
    groups.registration();
    groups["platform-billing"]();
    groups["order-payments"]();
    groups["stripe-billing"]();
    groups["stripe-connect"]();
    groups["authorize-net-platform"]();
    groups["authorize-net-orders"]();
    groups["tenant-provisioning"]();
    groups.tax();
    groups.tips();
    groups.refunds();
    groups.reconciliation();
    assertCheck(app.includes("/api/order-payments/quote") && app.includes("/api/order-payments/create"), "Customer checkout calls the restaurant order payment API");
    assertCheck(app.includes("/api/platform-billing/subscription") && app.includes("/api/platform-billing/portal"), "Restaurant settings surface Loohar subscription billing separately");
    assertCheck(server.includes("/api/platform-billing") && server.includes("/api/order-payments"), "API mounts platform billing and restaurant order payment modules separately");
  }
};

if (!groups[mode]) {
  console.error(`Unknown financial separation test mode: ${mode}`);
  console.error(`Available modes: ${Object.keys(groups).join(", ")}`);
  process.exit(1);
}

groups[mode]();

if (failures.length) {
  console.error(`${mode} failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log(`${mode} passed.`);
