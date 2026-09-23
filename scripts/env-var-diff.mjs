// Which environment variables does a candidate read that the deployed version did not?
//
//   node scripts/env-var-diff.mjs <deployed-ref> [candidate-ref]
//
// Run this before every production release. A variable the new code requires and the environment
// does not have is invisible until the exact code path runs.
//
// This exists because the check it replaces was done by hand and got it wrong. It grepped for the
// literal `process.env.NAME` and so missed this, which is what broke two-step verification in
// production on 2026-09-23:
//
//   function serverSecret(env = process.env) {
//     if (!env.MFA_ENCRYPTION_KEY) throw new Error("MFA_ENCRYPTION_KEY must be set in production");
//
// The variable is reached through a parameter, so the name never appears next to `process.env`.
// Both forms are matched here, and any name read inside a throw is reported as required.
//
// It errs toward reporting. A name near a throw is called REQUIRED even when the throw is
// conditional, so LOOHAR_ALLOW_DEV_SECRETS — whose safe state is absence — shows up too. Checking a
// variable that turns out not to matter costs a minute; missing one costs a broken sign-in path in
// production that reports itself healthy.
import { execFileSync } from "node:child_process";

const [deployedRef, candidateRef = "HEAD"] = process.argv.slice(2);
if (!deployedRef) {
  console.error("Usage: node scripts/env-var-diff.mjs <deployed-ref> [candidate-ref]");
  process.exit(1);
}

const SCAN = "apps/api/src";
// `process.env.NAME`, `env.NAME`, and destructured `const { NAME } = env`.
const PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]{2,})/g,
  /\benv\.([A-Z][A-Z0-9_]{2,})/g,
  /\benv\[["']([A-Z][A-Z0-9_]{2,})["']\]/g
];

function filesAt(ref) {
  return execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "--", SCAN], { encoding: "utf8" })
    .split("\n").filter((name) => name.endsWith(".js"));
}
function sourceAt(ref, file) {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return "";
  }
}

function namesIn(ref) {
  const found = new Map();
  for (const file of filesAt(ref)) {
    const source = sourceAt(ref, file);
    for (const pattern of PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const name = match[1];
        if (!found.has(name)) found.set(name, new Set());
        found.get(name).add(file);
      }
    }
  }
  return found;
}

// A name mentioned in the same statement as a throw is one the code refuses to run without.
function requiredNames(ref) {
  const required = new Set();
  for (const file of filesAt(ref)) {
    const source = sourceAt(ref, file);
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      const window = lines.slice(index, index + 2).join(" ");
      if (!/throw\s+new\s+Error|process\.exit\(/.test(window)) return;
      for (const pattern of PATTERNS) {
        for (const match of window.matchAll(pattern)) required.add(match[1]);
      }
      // "NAME must be set" style messages name the variable in the text, not as a lookup.
      for (const match of window.matchAll(/([A-Z][A-Z0-9_]{2,})\s+(?:must be set|is required)/g)) required.add(match[1]);
    });
  }
  return required;
}

const deployed = namesIn(deployedRef);
const candidate = namesIn(candidateRef);
const required = requiredNames(candidateRef);

const added = [...candidate.keys()].filter((name) => !deployed.has(name)).sort();
if (!added.length) {
  console.log(`No environment variable is read by ${candidateRef} that ${deployedRef} did not read.`);
  process.exit(0);
}

console.log(`Environment variables ${candidateRef} reads that ${deployedRef} did not:\n`);
let blocking = 0;
for (const name of added) {
  const mustHave = required.has(name);
  if (mustHave) blocking += 1;
  console.log(`  ${mustHave ? "REQUIRED" : "optional"}  ${name}`);
  console.log(`            ${[...candidate.get(name)].slice(0, 2).join(", ")}`);
}
if (blocking) {
  console.log(`\n${blocking} of these are REQUIRED: the code throws or exits without them.`);
  console.log("Set them on the production service BEFORE deploying, and remember a running process");
  console.log("cannot see a variable added after it started — it needs a restart.");
  process.exit(1);
}
console.log("\nNone of these are required; the code has a fallback for each.");
