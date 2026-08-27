import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import rateLimit from "express-rate-limit";
import {
  RENDER_TRUST_PROXY_HOPS,
  configureTrustProxy,
  resolveTrustProxySetting
} from "../apps/api/src/config/trustProxy.js";

const serverSource = readFileSync(new URL("../apps/api/src/server.js", import.meta.url), "utf8");
const trustProxyIndex = serverSource.indexOf("configureTrustProxy(app);");
const rateLimitIndex = serverSource.indexOf("app.use(rateLimit({");

assert.notEqual(trustProxyIndex, -1, "server configures trust proxy");
assert.notEqual(rateLimitIndex, -1, "server registers global rate limiter");
assert.ok(serverSource.includes("app.get(\"/health\", healthHandler);"), "public health route is preserved");
assert.ok(serverSource.includes("app.get(\"/api/health\", healthHandler);"), "API health route is preserved");
assert.ok(serverSource.includes("app.use(\"/api/auth\", authRoutes);"), "auth route mount is preserved");
assert.ok(
  trustProxyIndex < rateLimitIndex,
  "trust proxy must be configured before rate limiters inspect req.ip"
);

assert.equal(resolveTrustProxySetting({}), false, "local/dev defaults to direct client IPs");
assert.equal(
  resolveTrustProxySetting({ NODE_ENV: "production" }),
  false,
  "generic production without Render metadata is unchanged"
);
assert.equal(
  resolveTrustProxySetting({ RENDER_SERVICE_NAME: "loohar-api" }),
  RENDER_TRUST_PROXY_HOPS,
  "Render service name enables one trusted proxy hop"
);
assert.equal(
  resolveTrustProxySetting({ RENDER_GIT_COMMIT: "abc123" }),
  RENDER_TRUST_PROXY_HOPS,
  "Render git metadata enables one trusted proxy hop"
);

function createProbeApp(env) {
  const app = express();
  configureTrustProxy(app, env);
  app.use(rateLimit({
    windowMs: 60_000,
    limit: 2,
    standardHeaders: true,
    legacyHeaders: false,
    handler(req, res) {
      res.status(429).json({ code: "RATE_LIMITED", ip: req.ip });
    }
  }));
  app.get("/probe", (req, res) => {
    res.json({
      ip: req.ip,
      ips: req.ips,
      trustProxy: req.app.get("trust proxy")
    });
  });
  return app;
}

async function withServer(app, callback) {
  const server = await new Promise((resolve, reject) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    listeningServer.once("error", reject);
  });
  try {
    const { port } = server.address();
    return await callback(port);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function getProbe(port, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/probe`, { headers });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  return { response, body };
}

const capturedConsoleErrors = [];
const originalConsoleError = console.error;
console.error = (...args) => {
  capturedConsoleErrors.push(args.map(String).join(" "));
};

try {
  await withServer(createProbeApp({ RENDER_SERVICE_NAME: "loohar-api" }), async (port) => {
    const first = await getProbe(port, {
      "X-Forwarded-For": "203.0.113.10, 198.51.100.44"
    });
    assert.equal(first.response.status, 200);
    assert.equal(first.body.trustProxy, RENDER_TRUST_PROXY_HOPS);
    assert.equal(first.body.ip, "198.51.100.44");
    assert.deepEqual(first.body.ips, ["198.51.100.44"]);

    const second = await getProbe(port, {
      "X-Forwarded-For": "203.0.113.10, 198.51.100.44"
    });
    assert.equal(second.response.status, 200);

    const limited = await getProbe(port, {
      "X-Forwarded-For": "203.0.113.10, 198.51.100.44"
    });
    assert.equal(limited.response.status, 429);
    assert.equal(limited.body.code, "RATE_LIMITED");

    const malformedPrefix = await getProbe(port, {
      "X-Forwarded-For": "malformed-client, 198.51.100.77"
    });
    assert.equal(malformedPrefix.response.status, 200);
    assert.equal(malformedPrefix.body.ip, "198.51.100.77");

    await getProbe(port, {
      "X-Forwarded-For": "malformed-client, 198.51.100.77"
    });
    const malformedLimited = await getProbe(port, {
      "X-Forwarded-For": "malformed-client, 198.51.100.77"
    });
    assert.equal(malformedLimited.response.status, 429);
    assert.equal(malformedLimited.body.code, "RATE_LIMITED");
  });

  await withServer(createProbeApp({}), async (port) => {
    const first = await getProbe(port);
    assert.equal(first.response.status, 200);
    assert.equal(first.body.trustProxy, false);

    await getProbe(port);
    const limited = await getProbe(port);
    assert.equal(limited.response.status, 429);
    assert.equal(limited.body.code, "RATE_LIMITED");
  });
} finally {
  console.error = originalConsoleError;
}

assert.ok(
  !capturedConsoleErrors.some((message) => message.includes("ERR_ERL_UNEXPECTED_X_FORWARDED_FOR")),
  "Render forwarded headers should not trigger express-rate-limit proxy validation warnings"
);
assert.ok(
  !capturedConsoleErrors.some((message) => message.includes("ERR_ERL_PERMISSIVE_TRUST_PROXY")),
  "Render trust proxy configuration must not use permissive true"
);

console.log("Render trust proxy test passed.");
