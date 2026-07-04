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
import paymentRoutes from "./routes/payments.js";
import publicRoutes from "./routes/public.js";
import restaurantRoutes from "./routes/restaurant.js";
import superAdminRoutes from "./routes/superAdmin.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { bindRealtime } from "./services/realtimeService.js";

const app = express();
const corsOrigin = process.env.CORS_ORIGIN || process.env.WEB_ORIGIN || "http://localhost:5173";
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOrigin }
});

bindRealtime(io);

app.use(helmet());
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120 }));
app.use(morgan("dev"));

const healthPayload = { ok: true, service: "api", domain: process.env.PLATFORM_DOMAIN || "loohar.com" };
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
app.use("/api/payments", paymentRoutes);
app.use("/api/public", publicRoutes);

app.use(notFound);
app.use(errorHandler);

const port = Number(process.env.PORT || 5001);
server.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
