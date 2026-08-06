import { createHash } from "node:crypto";

export function maskValue(value) {
  if (!value) return "";
  if (value.length <= 8) return `${value.slice(0, 2)}...${value.slice(-2)}`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function redactSensitiveText(text) {
  if (!text) return text;
  return String(text)
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://<redacted>@")
    .replace(/db\.([a-z0-9]{8,})\.supabase\.co/gi, (_match, ref) => `db.${maskValue(ref)}.supabase.co`)
    .replace(/postgres\.([a-z0-9]{8,})/gi, (_match, ref) => `postgres.${maskValue(ref)}`);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value || "");
  } catch {
    return value || "";
  }
}

export function describeDatabaseUrl(rawUrl) {
  if (!rawUrl) {
    return {
      ok: false,
      error: "missing",
      mode: "missing",
      protocol: null,
      hostname: null,
      maskedHostname: null,
      port: null,
      database: null,
      username: null,
      maskedUsername: null,
      projectRef: null,
      maskedProjectRef: null,
      fingerprint: null
    };
  }

  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname;
    const port = parsed.port || "5432";
    const username = safeDecode(parsed.username);
    const database = parsed.pathname.replace(/^\//, "") || "postgres";
    const directMatch = hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    const userMatch = username.match(/^postgres\.([a-z0-9]+)$/i);
    const isPooler = /(?:^|\.)pooler\.supabase\.com$/i.test(hostname);
    const projectRef = directMatch?.[1] || (isPooler ? userMatch?.[1] : null) || null;
    let mode = "other";

    if (directMatch) mode = "direct";
    else if (isPooler && port === "5432") mode = "supabase-session-pooler";
    else if (isPooler && port === "6543") mode = "supabase-transaction-pooler";
    else if (isPooler) mode = "supabase-pooler";

    const fingerprint = createHash("sha256")
      .update(`${hostname.toLowerCase()}|${username.toLowerCase()}|${database.toLowerCase()}`)
      .digest("hex")
      .slice(0, 12);

    return {
      ok: true,
      mode,
      protocol: parsed.protocol.replace(/:$/, ""),
      hostname,
      maskedHostname: redactSensitiveText(hostname),
      port,
      database,
      username,
      maskedUsername: username.startsWith("postgres.") ? `postgres.${maskValue(projectRef)}` : maskValue(username),
      projectRef,
      maskedProjectRef: maskValue(projectRef),
      fingerprint
    };
  } catch {
    return {
      ok: false,
      error: "unparseable",
      mode: "unparseable",
      protocol: null,
      hostname: null,
      maskedHostname: "unparseable database URL",
      port: null,
      database: null,
      username: null,
      maskedUsername: null,
      projectRef: null,
      maskedProjectRef: null,
      fingerprint: null
    };
  }
}

export function printSafeUrlSummary(label, metadata, expectedProjectRef) {
  const matchesExpected = expectedProjectRef ? metadata.projectRef === expectedProjectRef : null;
  console.log(`${label}:`, {
    protocol: metadata.protocol,
    mode: metadata.mode,
    host: metadata.maskedHostname,
    port: metadata.port,
    database: metadata.database,
    username: metadata.maskedUsername,
    projectRef: metadata.maskedProjectRef,
    fingerprint: metadata.fingerprint,
    stagingMatch: matchesExpected
  });
}
