import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../apps/web/src/lib/api.js", import.meta.url), "utf8");

function assertIncludes(fragment, label = fragment) {
  if (!source.includes(fragment)) {
    console.error(`Missing request deduplication marker: ${label}`);
    process.exit(1);
  }
}

[
  "function shouldDedupeRequest",
  "function requestDedupeKey",
  "async function performApiRequest",
  "inflightRequests.has",
  "inflightRequests.get",
  "inflightRequests.set",
  "inflightRequests.delete",
  "requestMethod(options) === \"GET\"",
  "!isAuthPath(path)"
].forEach((fragment) => assertIncludes(fragment));

console.log("Request deduplication test passed.");
