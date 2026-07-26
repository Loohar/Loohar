import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../apps/web/src/lib/api.js", import.meta.url), "utf8");

function assertIncludes(fragment, label = fragment) {
  if (!source.includes(fragment)) {
    console.error(`Missing API health stabilization marker: ${label}`);
    process.exit(1);
  }
}

[
  "const inflightRequests = new Map",
  "const healthState =",
  "healthState.promise",
  "runApiHealthProbe",
  "okUntil",
  "failUntil",
  "healthOkUntil",
  "healthFailUntil",
  "lastError",
  "resetApiHealthCache",
  "apiDebugState",
  "checkApiHealthLegacyForTests",
  "8000",
  "2500",
  "/health",
  "/api/health"
].forEach((fragment) => assertIncludes(fragment));

console.log("API health state test passed.");
