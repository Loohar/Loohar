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
import taxProfileRoutes from "./routes/taxProfiles.js";
import uploadRoutes from "./routes/uploads.js";
import { authorizeNetOrdersWebhookRouter, authorizeNetPlatformWebhookRouter, stripeConnectAccountsV2WebhookRouter, stripeConnectWebhookRouter, stripePlatformWebhookRouter } from "./routes/webhooks.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { bindRealtime } from "./services/realtimeService.js";
import { sanitizeSensitiveFields } from "./utils/sanitize.js";
import { refreshSchemaCompatibility, schemaCompatibilitySnapshot } from "./utils/schemaCompatibility.js";
import { apiDeploymentMetadata } from "./utils/deploymentMetadata.js";
import { buildHealthPayload } from "./utils/healthPayload.js";
import { configureTrustProxy } from "./config/trustProxy.js";
import { createCorsPolicy } from "./config/corsPolicy.js";
import { tenantRootDomain } from "./config/urls.js";
import { disconnectPrisma } from "./config/prisma.js";

const app = express();
configureTrustProxy(app);

// CORS policy lives in config/corsPolicy.js so it can be exercised directly by tests.
const corsPolicy = createCorsPolicy(process.env);
function isCorsOriginAllowed(origin = "") {
  return corsPolicy.isCorsOriginAllowed(origin);
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
app.use("/api/webhooks/stripe-connect-accounts-v2", express.raw({ type: "application/json", limit: "2mb" }), stripeConnectAccountsV2WebhookRouter);
app.use("/api/webhooks/stripe-connect", express.raw({ type: "application/json", limit: "2mb" }), stripeConnectWebhookRouter);
app.use("/api/webhooks/authorize-net-platform", express.raw({ type: "application/json", limit: "2mb" }), authorizeNetPlatformWebhookRouter);
app.use("/api/webhooks/authorize-net-orders", express.raw({ type: "application/json", limit: "2mb" }), authorizeNetOrdersWebhookRouter);
app.use(express.json({ limit: "8mb" }));
const posSafeReadPathPattern = /^\/api\/restaurants?\/[^/]+\/pos\/(?:bootstrap|config|menu|held-orders|devices|shifts\/current|orders\/[^/]+\/receipt)\/?$/;
const restaurantSafeReadPathPattern = /^\/api\/restaurants?\/[^/]+\/(?:dashboard|profile|settings(?:\/(?:search|audit|[a-z0-9-]+))?|menu\/(?:categories|items|insights)|orders|drivers|dispatch|customers(?:\/summary)?|loyalty|promotions\/analytics|analytics|locations|tax-profiles|locations\/[^/]+\/tax-profile(?:\/history)?|website|domain|gallery|social-links|employees|printing|notification-settings|delivery-zones|inventory|reports\/(?:sales|operations))\/?$/;
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
// Request logs keep the path only: query strings can carry order tracking tokens.
morgan.token("url-path", (req) => String(req.originalUrl || req.url || "").split("?")[0]);
app.use(morgan(":method :url-path :status :response-time ms - :res[content-length]"));
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => json(sanitizeSensitiveFields(body));
  next();
});

function healthHandler(req, res) {
  const payload = buildHealthPayload({ schema: schemaCompatibilitySnapshot() });
  const ok = payload.ok;
  res.status(ok ? 200 : 503).json(payload);
  void refreshSchemaCompatibility();
}
function versionHandler(req, res) {
  res.json(apiDeploymentMetadata());
}
app.get("/health", healthHandler);
app.get("/api/health", healthHandler);
app.get("/version", versionHandler);
app.get("/api/version", versionHandler);
app.use("/public", publicRoutes);
app.use("/admin", superAdminRoutes);
app.use("/restaurant", restaurantRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", superAdminRoutes);
app.use("/api/restaurants", posRoutes);
app.use("/api/restaurant", posRoutes);
app.use("/api/restaurants", entitlementSimulationRoutes);
app.use("/api/restaurant", entitlementSimulationRoutes);
app.use("/api/restaurants", taxProfileRoutes);
app.use("/api/restaurant", taxProfileRoutes);
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
await refreshSchemaCompatibility({ force: true });
server.listen(port, () => {
  console.log(`API listening on port ${port}`);
  console.log("CORS allowed origins:", corsPolicy.configuredCorsOrigins.join(", "));
  console.log("CORS tenant subdomains:", corsPolicy.allowTenantSubdomainCors ? `enabled for *.${tenantRootDomain()}` : "disabled");
  console.log("CORS local development:", corsPolicy.allowLocalCors ? "enabled" : "disabled");
  console.log("CORS native apps:", corsPolicy.allowNativeAppOrigins ? "enabled" : "disabled");
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
