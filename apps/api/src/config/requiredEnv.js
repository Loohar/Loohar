// Variables the API cannot function without in production, checked at boot.
//
// This exists because of a real outage. The 2026-09-23 release introduced a hard requirement for
// MFA_ENCRYPTION_KEY, production did not have it, and nothing noticed: the service started, /health
// reported ok, and the only symptom was that every privileged user's two-step verification enrolment
// returned 500. The API was reporting itself healthy while a sign-in path was completely broken.
//
// A missing required variable is a deployment fault, not a request fault. Failing at boot means
// Render's health check never passes, the deploy is rolled back, and the previous version keeps
// serving — which is the correct outcome and far better than a half-working release.
//
// Add a variable here the moment code starts *requiring* it in production. The cost of a boot
// failure is a failed deploy; the cost of omitting it is what happened above.
export const REQUIRED_PRODUCTION_ENV = Object.freeze([
  {
    name: "DATABASE_URL",
    why: "the API cannot reach its database"
  },
  {
    name: "JWT_SECRET",
    why: "access tokens cannot be signed or verified, so nobody can sign in"
  },
  {
    name: "MFA_ENCRYPTION_KEY",
    why: "authenticator secrets and recovery codes cannot be encrypted, so no privileged user can enrol in or pass two-step verification",
    // Deliberately separate from JWT_SECRET: if MFA reused it, rotating JWT_SECRET would make every
    // stored authenticator secret unreadable and lock out every privileged user at once.
    minimumLength: 32
  },
  {
    name: "STRIPE_CONNECT_SECRET_KEY",
    why: "card payments cannot be created, captured or refunded",
    // Card payments are not part of every deployment, so this is reported but does not stop boot.
    warnOnly: true
  }
]);

export function missingProductionEnv(env = process.env) {
  const problems = [];
  for (const variable of REQUIRED_PRODUCTION_ENV) {
    const value = env[variable.name];
    if (!value) {
      problems.push({ ...variable, reason: "is not set" });
      continue;
    }
    if (variable.minimumLength && String(value).length < variable.minimumLength) {
      problems.push({ ...variable, reason: `is shorter than ${variable.minimumLength} characters` });
    }
  }
  return problems;
}

// Returns the warnings so the caller can log them; throws on anything that must stop the boot.
export function assertProductionEnv(env = process.env) {
  if (env.NODE_ENV !== "production") return [];

  const problems = missingProductionEnv(env);
  const fatal = problems.filter((problem) => !problem.warnOnly);
  const warnings = problems.filter((problem) => problem.warnOnly);

  if (fatal.length) {
    const detail = fatal.map((problem) => `  ${problem.name} ${problem.reason}: ${problem.why}`).join("\n");
    throw new Error(
      `Refusing to start: required production configuration is missing.\n${detail}\n` +
      "Set these on the service and redeploy. A running process cannot see variables added after it started."
    );
  }
  return warnings;
}
