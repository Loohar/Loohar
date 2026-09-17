import { readFileSync } from "node:fs";
import {
  base32Decode,
  base32Encode,
  decryptMfaSecret,
  encryptMfaSecret,
  generateTotp,
  hashRecoveryCode,
  matchTotp,
  mfaEnforcementEnabled,
  roleRequiresMfa,
  totpStep
} from "../apps/api/src/services/mfaService.js";

const failures = [];
function assertCheck(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    failures.push(message);
    console.error(`FAIL ${message}`);
  }
}

// RFC 6238 Appendix B (SHA-1 seed "12345678901234567890"), 8-digit vectors.
const rfcSecret = Buffer.from("12345678901234567890");
const vectors = [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]];
assertCheck(vectors.every(([seconds, expected]) => generateTotp(rfcSecret, totpStep(seconds * 1000), 8) === expected), "TOTP matches every RFC 6238 SHA-1 test vector");
assertCheck(base32Decode(base32Encode(rfcSecret)).equals(rfcSecret), "Base32 round-trips authenticator secrets");

const env = { NODE_ENV: "test", MFA_ENCRYPTION_KEY: "static-test-key" };
const encrypted = encryptMfaSecret(rfcSecret, env);
assertCheck(encrypted.startsWith("v1.") && !encrypted.includes(base32Encode(rfcSecret)), "MFA secrets are encrypted at rest");
assertCheck(decryptMfaSecret(encrypted, env).equals(rfcSecret), "Encrypted MFA secrets decrypt with the server key");
let tampered = false;
try {
  decryptMfaSecret(encrypted, { ...env, MFA_ENCRYPTION_KEY: "other-key" });
} catch {
  tampered = true;
}
assertCheck(tampered, "A different server key cannot decrypt MFA secrets");

const now = 1_900_000_000_000;
const step = totpStep(now);
const current = generateTotp(rfcSecret, step);
assertCheck(matchTotp(rfcSecret, current, { atMs: now }) === step, "Current code is accepted");
assertCheck(matchTotp(rfcSecret, generateTotp(rfcSecret, step - 1), { atMs: now }) === step - 1, "One step of clock drift is tolerated");
assertCheck(matchTotp(rfcSecret, generateTotp(rfcSecret, step - 3), { atMs: now }) === null, "Expired codes are rejected");
assertCheck(matchTotp(rfcSecret, current, { atMs: now, lastUsedStep: step }) === null, "A code at or before the last used step cannot be replayed");
assertCheck(matchTotp(rfcSecret, "12a456", { atMs: now }) === null, "Malformed codes are rejected");
assertCheck(hashRecoveryCode("abcde-fghij", env) === hashRecoveryCode("ABCDEFGHIJ", env) && hashRecoveryCode("ABCDEFGHIJ", env).length === 64, "Recovery codes are normalised and stored as HMAC-SHA256");

assertCheck(["SUPER_ADMIN", "TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_MANAGER"].every(roleRequiresMfa), "MFA is required for platform, owner, admin and manager roles");
assertCheck(!["CASHIER", "KITCHEN_STAFF", "DRIVER", "CUSTOMER"].some(roleRequiresMfa), "Frontline and customer roles keep their existing sign-in");
assertCheck(mfaEnforcementEnabled({ NODE_ENV: "production", MFA_ENFORCEMENT: "off" }), "MFA enforcement cannot be switched off in production");
let keyRequired = false;
try {
  encryptMfaSecret(rfcSecret, { NODE_ENV: "production", JWT_SECRET: "only-jwt" });
} catch {
  keyRequired = true;
}
assertCheck(keyRequired, "Production requires a dedicated MFA_ENCRYPTION_KEY (no JWT_SECRET fallback)");

const middleware = readFileSync("apps/api/src/middleware/auth.js", "utf8");
const authRoutes = readFileSync("apps/api/src/routes/auth.js", "utf8");
const sanitizer = readFileSync("apps/api/src/utils/sanitize.js", "utf8");
const posSession = readFileSync("apps/api/src/middleware/posSession.js", "utf8");
const tokens = readFileSync("apps/api/src/utils/tokens.js", "utf8");
assertCheck(middleware.includes("AUTH_MFA_REQUIRED") && middleware.includes("AUTH_MFA_ENROLLMENT_REQUIRED") && middleware.includes("AUTH_PASSWORD_CHANGE_REQUIRED"), "Central access-token check enforces MFA and password-change gates for every consumer (REST, sockets, payments)");
assertCheck((authRoutes.match(/mfaChallengeResponse\(/g) || []).length >= 4, "Login, demo login and password reset return an MFA challenge instead of a session");
assertCheck(authRoutes.includes('if (user.mfaEnabled && !session.mfaVerifiedAt)'), "Refresh cannot mint tokens for a session that never passed MFA");
assertCheck(authRoutes.includes("AUTH_REGISTRATION_ROLE_FORBIDDEN") && authRoutes.includes('role: "CUSTOMER", restaurantId: null'), "Public registration only creates customer accounts");
assertCheck(authRoutes.includes("AUTH_CURRENT_PASSWORD_INVALID"), "Password change requires the current password");
assertCheck(sanitizer.includes('"mfaPendingSecret"') && sanitizer.includes('"codeHash"') && sanitizer.includes('"mfaSecret"'), "MFA secrets and recovery code hashes are stripped from responses");
assertCheck(posSession.includes("payload.authSessionId !== req.user?.sessionId"), "POS register sessions end when the signed-in session ends");
assertCheck(tokens.includes('algorithms: ["HS256"]') && !tokens.includes('process.env.NODE_ENV === "production") {\n    throw new Error(`${name} must be set in production`)'), "JWT verification pins HS256 and default secrets are refused outside development/test");

if (failures.length) {
  console.error(`\n${failures.length} MFA/auth check(s) failed.`);
  process.exit(1);
}
console.log("\nMFA and authentication hardening checks passed.");
