import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../apps/api/src/server.js", import.meta.url), "utf8");

function assertIncludes(fragment, label = fragment) {
  if (!server.includes(fragment)) {
    console.error(`Missing rate-limit regression marker: ${label}`);
    process.exit(1);
  }
}

[
  "function isSafeReadBurstPath",
  "restaurantSafeReadPathPattern",
  "posSafeReadPathPattern",
  "rateLimit",
  "skip: (req) => req.method === \"GET\" && isSafeReadBurstPath(req)"
].forEach((fragment) => assertIncludes(fragment));

if (server.includes("limit: 1000") || server.includes("max: 1000")) {
  console.error("Global rate limit appears to have been raised instead of scoped safe-read bypass.");
  process.exit(1);
}

console.log("Rate-limit regression test passed.");
