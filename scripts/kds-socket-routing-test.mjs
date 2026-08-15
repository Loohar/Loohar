import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveRealtimeOrigin } from "../apps/web/src/lib/realtimeConfig.js";

const productionOrigin = "https://loohar-api.onrender.com";
const stagingOrigin = "https://loohar-api-staging.onrender.com";
const developmentOrigin = "http://localhost:5001";

assert.equal(resolveRealtimeOrigin({ configuredUrl: productionOrigin }), productionOrigin);
assert.equal(resolveRealtimeOrigin({ configuredUrl: stagingOrigin }), stagingOrigin);
assert.equal(resolveRealtimeOrigin({ apiOrigin: developmentOrigin, development: true }), developmentOrigin);
assert.throws(() => resolveRealtimeOrigin({ configuredUrl: developmentOrigin }), /cannot use localhost/);
assert.throws(() => resolveRealtimeOrigin({ apiOrigin: "" }), /VITE_REALTIME_URL/);

const app = readFileSync("apps/web/src/App.jsx", "utf8");
const api = readFileSync("apps/web/src/lib/api.js", "utf8");
const vercel = readFileSync("apps/web/vercel.json", "utf8");
assert.equal(app.match(/io\(REALTIME_ORIGIN/g)?.length, 2, "both realtime clients should use the explicit realtime origin");
assert.equal(app.includes("io(API_ORIGIN"), false, "Socket.IO must not reuse the same-origin HTTP API proxy");
assert.ok(api.includes("import.meta.env.VITE_REALTIME_URL"), "realtime origin should come from the Vite environment");
assert.equal(vercel.includes('"source": "/socket.io'), false, "direct Socket.IO must not depend on a Vercel rewrite");

function productionLikeBuild(socketOrigin, forbiddenOrigins) {
  const outDir = mkdtempSync(join(tmpdir(), "loohar-kds-socket-"));
  try {
    const result = spawnSync("npm", ["--workspace", "apps/web", "run", "build", "--", "--outDir", outDir], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        VITE_API_URL: "/api",
        VITE_API_HEALTH_URL: "/health",
        VITE_REALTIME_URL: socketOrigin
      }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const assetsDir = join(outDir, "assets");
    const bundle = readdirSync(assetsDir)
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFileSync(join(assetsDir, name), "utf8"))
      .join("\n");
    assert.ok(bundle.includes(socketOrigin), `bundle should contain ${socketOrigin}`);
    forbiddenOrigins.forEach((origin) => assert.equal(bundle.includes(origin), false, `bundle must not contain ${origin}`));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

productionLikeBuild(productionOrigin, [stagingOrigin, developmentOrigin]);
productionLikeBuild(stagingOrigin, [productionOrigin, developmentOrigin]);

console.log("kds-socket-routing-test passed (environment routing, build isolation, and direct Socket.IO origin).");
