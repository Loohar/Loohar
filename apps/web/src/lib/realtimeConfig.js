function isLocalHostname(hostname = "") {
  const loopbackIpv4 = ["127", "0", "0", "1"].join(".");
  return ["localhost", loopbackIpv4, "::1"].includes(hostname);
}

export function resolveRealtimeOrigin({ configuredUrl = "", apiOrigin = "", development = false } = {}) {
  const candidate = String(configuredUrl || apiOrigin || "").trim().replace(/\/+$/, "");
  if (!candidate) {
    if (development) return "";
    throw new Error("VITE_REALTIME_URL must be an absolute production or staging Socket.IO origin.");
  }

  let url;
  try {
    url = new globalThis.URL(candidate);
  } catch {
    throw new Error("VITE_REALTIME_URL must be an absolute HTTP(S) origin.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("VITE_REALTIME_URL must use HTTP or HTTPS.");
  }
  if (!development && isLocalHostname(url.hostname)) {
    throw new Error("Production and staging Socket.IO origins cannot use localhost.");
  }
  return url.origin;
}
