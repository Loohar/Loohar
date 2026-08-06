import "dotenv/config";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import http from "http";
import morgan from "morgan";
import { Server } from "socket.io";
import authRoutes from "./routes/auth.js";
import customerRoutes from "./routes/customer.js";
import driverRoutes from "./routes/driver.js";
import entitlementSimulationRoutes from "./routes/entitlementSimulation.js";
import kitchenRoutes from "./routes/kitchen.js";
import orderPaymentRoutes from "./routes/orderPayments.js";
import orderRoutes from "./routes/orders.js";
import paymentRoutes from "./routes/payments.js";
import platformBillingRoutes from "./routes/platformBilling.js";
import posRoutes from "./routes/pos.js";
import publicRoutes from "./routes/public.js";
import registrationRoutes from "./routes/registration.js";
import restaurantRoutes from "./routes/restaurant.js";
import superAdminRoutes from "./routes/superAdmin.js";
import uploadRoutes from "./routes/uploads.js";
import { authorizeNetOrdersWebhookRouter, authorizeNetPlatformWebhookRouter, stripeConnectWebhookRouter, stripePlatformWebhookRouter } from "./routes/webhooks.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { bindRealtime } from "./services/realtimeService.js";
import { sanitizeSensitiveFields } from "./utils/sanitize.js";
import { refreshSchemaCompatibility } from "./utils/schemaCompatibility.js";
import { productionOriginAllowlist, tenantRootDomain } from "./config/urls.js";
import { disconnectPrisma } from "./config/prisma.js";
import { RESERVED_PLATFORM_SLUGS } from "../../shared/reservedSlugs.js";

const app = express();
const isProduction = process.env.NODE_ENV === "production";

function splitOriginConfig(value = "") {
  return String(value).split(",").map((origin) => origin.trim()).filter(Boolean);
}

function normalizeCorsOrigin(origin = "") {
  const trimmed = String(origin || "").trim().replace(/\/+$/, "");
  if (!trimmed || trimmed === "*") return trimmed;
  const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const withProtocol = hasProtocol
    ? trimmed
    : /^(localhost|127\.0\.0\.1|\[?::1\]?)(:\d+)?$/i.test(trimmed)
      ? `http://${trimmed}`
      : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function configuredCorsOriginSources() {
  return [
    process.env.CORS_ORIGINS,
    process.env.CORS_ORIGIN,
    process.env.WEB_ORIGIN,
    process.env.APP_URL,
    process.env.PUBLIC_APP_URL,
    process.env.PLATFORM_URL,
    process.env.PLATFORM_WEBSITE_URL,
    process.env.ADMIN_URL,
    process.env.DRIVER_APP_URL,
    process.env.PUBLIC_DRIVER_APP_URL,
    process.env.PUBLIC_SITE_FALLBACK_URL,
    process.env.PUBLIC_SITE_URL,
    process.env.PUBLIC_SITE_ORIGIN
  ];
}

const localDevHosts = new Set(["localhost", ["127", "0", "0", "1"].join("."), "::1"]);
const allowLocalCors = !isProduction || process.env.ALLOW_LOCAL_CORS === "true";
function isLocalDevOrigin(origin = "") {
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) && localDevHosts.has(url.hostname);
  } catch {
    return false;
  }
}

const rawCorsOrigins = configuredCorsOriginSources().flatMap(splitOriginConfig);
const configuredCorsOrigins = [...new Set([
  ...(rawCorsOrigins.length ? rawCorsOrigins : productionOriginAllowlist()),
  ...productionOriginAllowlist()
].map(normalizeCorsOrigin).filter((origin) => origin && (!isProduction || allowLocalCors || !isLocalDevOrigin(origin))))];
if (isProduction && configuredCorsOrigins.length === 0) {
  throw new Error("CORS origins are required in production. Set CORS_ORIGINS, WEB_ORIGIN, or APP_URL to explicit Loohar domains before starting the API.");
}
if (isProduction && configuredCorsOrigins.includes("*")) {
  throw new Error("Wildcard CORS is not allowed in production. Set CORS_ORIGINS to explicit Loohar domains.");
}
const reservedCorsSubdomains = new Set(RESERVED_PLATFORM_SLUGS.filter((slug) => !slug.includes(".")));
const allowTenantSubdomainCors = process.env.ALLOW_TENANT_SUBDOMAIN_CORS === "true";
function isTenantSubdomainOrigin(origin = "") {
  if (!allowTenantSubdomainCors) return false;
  try {
    const url = new URL(origin);
    const rootDomain = tenantRootDomain();
    if (url.protocol !== "https:" || !url.hostname.endsWith(`.${rootDomain}`)) return false;
    const subdomain = url.hostname.slice(0, -(rootDomain.length + 1));
    return Boolean(subdomain) && !subdomain.includes(".") && !reservedCorsSubdomains.has(subdomain);
  } catch {
    return false;
  }
}
function isCorsOriginAllowed(origin = "") {
  const normalizedOrigin = normalizeCorsOrigin(origin);
  return !origin ||
    configuredCorsOrigins.includes(normalizedOrigin) ||
    isTenantSubdomainOrigin(normalizedOrigin) ||
    (!isProduction && configuredCorsOrigins.includes("*")) ||
    (allowLocalCors && isLocalDevOrigin(normalizedOrigin));
}
const corsOptions = {
  origin(origin, callback) {
    callback(null, isCorsOriginAllowed(origin));
  },
  credentials: true,
  optionsSuccessStatus: 204
};
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOptions.origin, credentials: true }
});

bindRealtime(io);

app.use(helmet());
app.use((req, res, next) => {
  if (!isCorsOriginAllowed(req.headers.origin)) {
    return res.status(403).json({ error: "CORS origin not allowed.", code: "CORS_ORIGIN_DENIED" });
  }
  next();
});
app.use(cors(corsOptions));
app.use("/api/payments/webhook", express.raw({ type: "application/json", limit: "2mb" }));
app.use("/api/webhooks/stripe-platform", express.raw({ type: "application/json", limit: "2mb" }), stripePlatformWebhookRouter);
app.use("/api/webhooks/stripe-connect", express.raw({ type: "application/json", limit: "2mb" }), stripeConnectWebhookRouter);
app.use("/api/webhooks/authorize-net-platform", express.raw({ type: "application/json", limit: "2mb" }), authorizeNetPlatformWebhookRouter);
app.use("/api/webhooks/authorize-net-orders", express.raw({ type: "application/json", limit: "2mb" }), authorizeNetOrdersWebhookRouter);
app.use(express.json({ limit: "8mb" }));
const posSafeReadPathPattern = /^\/api\/restaurants?\/[^/]+\/pos\/(?:bootstrap|config|menu|held-orders|devices|shifts\/current|orders\/[^/]+\/receipt)\/?$/;
const restaurantSafeReadPathPattern = /^\/api\/restaurants?\/[^/]+\/(?:dashboard|profile|settings(?:\/(?:search|audit|[a-z0-9-]+))?|menu\/(?:categories|items|insights)|orders|drivers|dispatch|customers(?:\/summary)?|loyalty|promotions\/analytics|analytics|locations|website|domain|gallery|social-links|employees|printing|notification-settings|delivery-zones|inventory|reports\/(?:sales|operations))\/?$/;
function isSafeReadBurstPath(req) {
  return posSafeReadPathPattern.test(req.path) || restaurantSafeReadPathPattern.test(req.path);
}
app.use(rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "GET" && isSafeReadBurstPath(req),
  message: {
    error: "Too many requests. Please wait a moment and try again.",
    code: "RATE_LIMITED"
  }
}));
app.use(morgan("dev"));
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => json(sanitizeSensitiveFields(body));
  next();
});

const baseHealthPayload = { service: "api", platform: process.env.PLATFORM_NAME || "Loohar", domain: process.env.PLATFORM_DOMAIN || "loohar.com" };
async function healthHandler(req, res) {
  const schema = await refreshSchemaCompatibility();
  const ok = Boolean(schema.ok);
  res.status(ok ? 200 : 503).json({ ok, ...baseHealthPayload, schema });
}
app.get("/health", healthHandler);
app.get("/api/health", healthHandler);
app.use("/public", publicRoutes);
app.use("/admin", superAdminRoutes);
app.use("/restaurant", restaurantRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", superAdminRoutes);
app.use("/api/restaurants", posRoutes);
app.use("/api/restaurant", posRoutes);
app.use("/api/restaurants", entitlementSimulationRoutes);
app.use("/api/restaurant", entitlementSimulationRoutes);
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/restaurant", restaurantRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/driver", driverRoutes);
app.use("/api/kitchen", kitchenRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/order-payments", orderPaymentRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/platform-billing", platformBillingRoutes);
app.use("/api/registration", registrationRoutes);
app.use("/api/public", publicRoutes);
app.use("/uploads", uploadRoutes);
app.use("/api/uploads", uploadRoutes);

app.use(notFound);
app.use(errorHandler);

const port = Number(process.env.PORT || 5001);
server.listen(port, () => {
  console.log(`API listening on port ${port}`);
  console.log("CORS allowed origins:", configuredCorsOrigins.join(", "));
  console.log("CORS tenant subdomains:", allowTenantSubdomainCors ? `enabled for *.${tenantRootDomain()}` : "disabled");
  console.log("CORS local development:", allowLocalCors ? "enabled" : "disabled");
});

async function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down API.`);
  server.close(async () => {
    await disconnectPrisma();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
