#!/usr/bin/env node
// Deploys a validated commit to the Loohar STAGING API and waits until staging reports that exact
// SHA. The credential is read from ~/.loohar/staging.env (or the environment) and is never printed,
// logged or written anywhere. Production is verified to be untouched before and after.
//
//   node scripts/deploy-staging.mjs <full-sha>
//
// Accepts either RENDER_STAGING_DEPLOY_HOOK (a Render deploy hook URL) or RENDER_API_KEY, in which
// case the service is looked up by name and refused unless it is loohar-api-staging.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STAGING_SERVICE = "loohar-api-staging";
const STAGING_ORIGIN = "https://loohar-api-staging.onrender.com";
const PRODUCTION_ORIGIN = "https://loohar-api.onrender.com";
const CREDENTIAL_FILE = join(homedir(), ".loohar", "staging.env");

function fail(message) {
  console.error(`deploy-staging: ${message}`);
  process.exit(1);
}

function credentials() {
  const values = { ...process.env };
  if (existsSync(CREDENTIAL_FILE)) {
    for (const line of readFileSync(CREDENTIAL_FILE, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.replace(/^export\s+/, "").split("=");
      const value = rest.join("=").trim().replace(/^["']|["']$/g, "");
      if (value) values[key.trim()] = value;
    }
  }
  return values;
}

async function deployedSha() {
  const response = await fetch(`${STAGING_ORIGIN}/version`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  return { sha: payload.commitSha || "", service: payload.serviceName || "", environment: payload.environment || "" };
}

// `--check` reports whether the stored credential is usable, describing its shape only. It never
// prints the value.
if (process.argv.includes("--check")) {
  const stored = credentials();
  const hookValue = stored.RENDER_STAGING_DEPLOY_HOOK || "";
  const keyValue = stored.RENDER_API_KEY || stored.RENDER_STAGING_API_KEY || "";
  if (!hookValue && !keyValue) fail(`no value is stored. ${CREDENTIAL_FILE} has the key but no credential after the "=".`);
  if (hookValue && !/^https:\/\/api\.render\.com\/deploy\/srv-[A-Za-z0-9]+/.test(hookValue)) {
    const looksLikeShell = /printf|chmod|staging\.env|PASTE/i.test(hookValue);
    fail(looksLikeShell
      ? "the stored value is shell text, not a deploy hook URL. Copy the hook URL from Render and write only that URL."
      : "the stored value is not a Render deploy hook URL (expected https://api.render.com/deploy/srv-...).");
  }
  console.log(hookValue ? "PASS: a Render staging deploy hook is stored and structurally valid." : "PASS: a Render API key is stored; the service will be checked by name at deploy time.");
  process.exit(0);
}

const targetSha = (process.argv[2] || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })).trim();
if (!/^[0-9a-f]{40}$/.test(targetSha)) fail("pass the full 40-character commit SHA to deploy.");

const env = credentials();
const hook = env.RENDER_STAGING_DEPLOY_HOOK || "";
const apiKey = env.RENDER_API_KEY || env.RENDER_STAGING_API_KEY || "";
if (!hook && !apiKey) {
  fail(`no staging deploy credential found. Put a Render deploy hook URL in ${CREDENTIAL_FILE} as RENDER_STAGING_DEPLOY_HOOK=<url> (the file currently has no value), or set RENDER_API_KEY.`);
}

// Never deploy anything that is not the staging service.
const before = await deployedSha();
if (before.service && before.service !== STAGING_SERVICE) fail(`refusing to deploy: ${STAGING_ORIGIN} reports service ${before.service}.`);
if (before.environment && before.environment !== "staging") fail(`refusing to deploy: ${STAGING_ORIGIN} reports environment ${before.environment}.`);
const productionBefore = await fetch(`${PRODUCTION_ORIGIN}/version`).then((response) => response.json()).catch(() => ({}));

let triggered;
if (hook) {
  if (!/^https:\/\/api\.render\.com\/deploy\/srv-[A-Za-z0-9]+/.test(hook)) {
    fail("the configured deploy hook is not a Render deploy hook URL (expected https://api.render.com/deploy/srv-...).");
  }
  const url = new URL(hook);
  url.searchParams.set("ref", targetSha);
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) fail(`the deploy hook returned ${response.status}.`);
  triggered = "deploy hook";
} else {
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
  const list = await fetch("https://api.render.com/v1/services?limit=100", { headers }).then((response) => response.json()).catch(() => []);
  const service = (Array.isArray(list) ? list : []).map((entry) => entry.service || entry).find((entry) => entry?.name === STAGING_SERVICE);
  if (!service?.id) fail(`the API key cannot see a service named ${STAGING_SERVICE}.`);
  const response = await fetch(`https://api.render.com/v1/services/${service.id}/deploys`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ commitId: targetSha })
  });
  if (!response.ok) fail(`Render refused the deploy with ${response.status}.`);
  triggered = `service ${service.id}`;
}

console.log(`Triggered staging deploy of ${targetSha} via ${triggered}. Waiting for staging to report it...`);
const deadline = Date.now() + 15 * 60 * 1000;
let current = before;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 15_000));
  current = await deployedSha().catch(() => current);
  if (current.sha === targetSha) break;
  process.stdout.write(".");
}
process.stdout.write("\n");

const productionAfter = await fetch(`${PRODUCTION_ORIGIN}/version`).then((response) => response.json()).catch(() => ({}));
if (productionBefore.commitSha && productionAfter.commitSha !== productionBefore.commitSha) {
  fail(`production changed during this deploy (${productionBefore.commitSha} -> ${productionAfter.commitSha}). Investigate immediately.`);
}
console.log(`production unchanged at ${productionAfter.commitSha || "unknown"}`);

if (current.sha !== targetSha) {
  fail(`staging still reports ${current.sha || "unknown"} after 15 minutes; check the Render dashboard for the build.`);
}

const health = await fetch(`${STAGING_ORIGIN}/health`).then((response) => response.json()).catch(() => ({}));
console.log(`staging ${current.service} is on ${current.sha}`);
console.log(`health ok=${health.ok} schema=${health.schema?.ok} issues=${(health.schema?.issues || []).length}`);
if (health.ok !== true || health.schema?.ok !== true) fail("staging deployed but is not healthy.");
