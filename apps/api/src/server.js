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
import kitchenRoutes from "./routes/kitchen.js";
import orderRoutes from "./routes/orders.js";
import paymentRoutes from "./routes/payments.js";
import publicRoutes from "./routes/public.js";
import restaurantRoutes from "./routes/restaurant.js";
import superAdminRoutes from "./routes/superAdmin.js";
import uploadRoutes from "./routes/uploads.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { bindRealtime } from "./services/realtimeService.js";
import { sanitizeSensitiveFields } from "./utils/sanitize.js";
import { productionOriginAllowlist, tenantRootDomain } from "./config/urls.js";
import { disconnectPrisma } from "./config/prisma.js";

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const corsOriginConfig = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || process.env.WEB_ORIGIN || productionOriginAllowlist().join(",");
const configuredCorsOrigins = corsOriginConfig.split(",").map((origin) => origin.trim()).filter(Boolean);
if (isProduction && !process.env.CORS_ORIGINS) {
  throw new Error("CORS_ORIGINS is required in production. Set explicit Loohar domains before starting the API.");
}
if (isProduction && configuredCorsOrigins.includes("*")) {
  throw new Error("Wildcard CORS is not allowed in production. Set CORS_ORIGINS to explicit Loohar domains.");
}
const localDevHosts = new Set(["localhost", ["127", "0", "0", "1"].join("."), "::1"]);
const reservedCorsSubdomains = new Set(["admin", "api", "app", "driver", "sites", "www"]);
const allowLocalCors = !isProduction || process.env.ALLOW_LOCAL_CORS === "true";
const allowTenantSubdomainCors = process.env.ALLOW_TENANT_SUBDOMAIN_CORS === "true";
function isLocalDevOrigin(origin = "") {
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) && localDevHosts.has(url.hostname);
  } catch {
    return false;
  }
}
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
const corsOptions = {
  origin(origin, callback) {
    if (!origin || configuredCorsOrigins.includes(origin) || isTenantSubdomainOrigin(origin) || (!isProduction && configuredCorsOrigins.includes("*")) || (allowLocalCors && isLocalDevOrigin(origin))) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true
};
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOptions.origin, credentials: true }
});

bindRealtime(io);

app.use(helmet());
app.use(cors(corsOptions));
app.use("/api/payments/webhook", express.raw({ type: "application/json", limit: "2mb" }));
app.use(express.json({ limit: "8mb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120 }));
app.use(morgan("dev"));
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => json(sanitizeSensitiveFields(body));
  next();
});

const healthPayload = { ok: true, service: "api", platform: process.env.PLATFORM_NAME || "Loohar", domain: process.env.PLATFORM_DOMAIN || "loohar.com" };
app.get("/health", (req, res) => res.json(healthPayload));
app.get("/api/health", (req, res) => res.json(healthPayload));
app.use("/public", publicRoutes);
app.use("/admin", superAdminRoutes);
app.use("/restaurant", restaurantRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", superAdminRoutes);
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/restaurant", restaurantRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/driver", driverRoutes);
app.use("/api/kitchen", kitchenRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/public", publicRoutes);
app.use("/uploads", uploadRoutes);
app.use("/api/uploads", uploadRoutes);

app.use(notFound);
app.use(errorHandler);

const port = Number(process.env.PORT || 5001);
server.listen(port, () => {
  console.log(`API listening on port ${port}`);
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
