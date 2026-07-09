import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sanitizeSensitiveFields, sanitizeUser } from "../apps/api/src/utils/sanitize.js";

const sourceRoots = ["apps/web/src", "apps/web/public", "apps/web/index.html"].filter((path) => existsSync(path));
const bundleRoots = ["apps/web/dist"].filter((path) => existsSync(path));
const apiRoots = ["apps/api/src"].filter((path) => existsSync(path));
const seededPasswordCheck = { label: "seeded password", pattern: /(LooharOwner2026|Owner2026|Welcome12|Welcome2026|Admin123|ChangeMe123|Driver123|Staff123|Owner123|Customer123)/ };
const logCallPattern = String.raw`console\.(log|info|warn|error)[^\n]*`;
const secretWordPattern = String.raw`(password|token|authorization|credentials)`;
const sensitiveConsolePattern = new RegExp(logCallPattern + secretWordPattern, "i");
const localUrlChecks = [
  { label: "localhost 5173", pattern: new RegExp("local" + "host:5173") },
  { label: "localhost 5174", pattern: new RegExp("local" + "host:5174") },
  { label: "localhost 5001", pattern: new RegExp("local" + "host:5001") },
  { label: "localhost URL", pattern: new RegExp("http://" + "localhost") },
  { label: "loopback IP", pattern: new RegExp(["127", "0", "0", "1"].join("\\.")) }
];
const secretAssignmentChecks = [
  { label: "database URL assignment", pattern: /\bDATABASE_URL\s*=\s*["'][^"']+/ },
  { label: "JWT secret assignment", pattern: /\b(JWT_SECRET|REFRESH_TOKEN_SECRET|JWT_REFRESH_SECRET)\s*=\s*["'][^"']+/ },
  { label: "Stripe secret assignment", pattern: /\b(STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET)\s*=\s*["'][^"']+/ },
  { label: "Resend API key assignment", pattern: /\bRESEND_API_KEY\s*=\s*["'][^"']+/ },
  { label: "Twilio auth token assignment", pattern: /\bTWILIO_AUTH_TOKEN\s*=\s*["'][^"']+/ },
  { label: "Supabase service role assignment", pattern: /\bSUPABASE_SERVICE_ROLE_KEY\s*=\s*["'][^"']+/ }
];
const sourceChecks = [
  seededPasswordCheck,
  { label: "seeded password variable", pattern: /\b(defaultPassword|demoPassword|seededPassword)\b/i },
  { label: "password near 2026", pattern: /password[^\n\r]{0,80}2026/i },
  { label: "password in localStorage", pattern: /localStorage\.(getItem|setItem|removeItem)\(\s*["'][^"']*(password|passwordHash|resetToken|mfaSecret)[^"']*["']/i },
  { label: "sensitive console log", pattern: sensitiveConsolePattern },
  { label: "dangerous HTML injection", pattern: /dangerouslySetInnerHTML/ },
  ...secretAssignmentChecks
];
const bundleChecks = sourceChecks.filter((check) => check.label !== "dangerous HTML injection").concat(localUrlChecks);
const apiChecks = [
  { label: "sensitive console log", pattern: sensitiveConsolePattern },
  ...secretAssignmentChecks
];
const ignoredExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".map"]);
const findings = [];

function extensionFor(file) {
  const match = file.match(/\.[^.]+$/);
  return match ? match[0].toLowerCase() : "";
}

function walk(path, checks) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const child of readdirSync(path)) walk(join(path, child), checks);
    return;
  }
  if (ignoredExtensions.has(extensionFor(path))) return;
  const content = readFileSync(path, "utf8");
  checks.forEach((check) => {
    if (check.pattern.test(content)) findings.push(`${check.label}: ${path}`);
  });
}

sourceRoots.forEach((root) => walk(root, sourceChecks));
bundleRoots.forEach((root) => walk(root, bundleChecks));
apiRoots.forEach((root) => walk(root, apiChecks));

const unsafeUser = sanitizeUser({
  id: "user-test",
  email: "safe@example.test",
  password: "secret",
  passwordHash: "hash",
  hashedPassword: "hash",
  temporaryPassword: true,
  resetToken: "reset",
  resetPasswordToken: "reset",
  mfaSecret: "totp",
  accessToken: "access",
  refreshToken: "refresh",
  restaurant: { slug: "demo-bistro", businessName: "Demo Bistro" }
});
["password", "passwordHash", "hashedPassword", "temporaryPassword", "resetToken", "resetPasswordToken", "mfaSecret", "accessToken", "refreshToken"].forEach((key) => {
  if (Object.prototype.hasOwnProperty.call(unsafeUser, key)) findings.push(`sanitizeUser exposes ${key}`);
});

const unsafeResponse = sanitizeSensitiveFields({
  user: { passwordHash: "hash", temporaryPassword: true, mfaSecret: "totp" },
  refreshToken: "top-level-refresh-token"
});
["passwordHash", "temporaryPassword", "mfaSecret"].forEach((key) => {
  if (Object.prototype.hasOwnProperty.call(unsafeResponse.user, key)) findings.push(`sanitizeSensitiveFields exposes user.${key}`);
});
if (!unsafeResponse.refreshToken) findings.push("sanitizeSensitiveFields removed top-level refreshToken unexpectedly");

if (findings.length) {
  console.error("Security scan failed:");
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log("Security scan passed: frontend credential checks clean.");
