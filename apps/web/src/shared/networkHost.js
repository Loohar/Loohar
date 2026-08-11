export function isPrivateNetworkHost(value = "") {
  const host = String(value || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  const isIpv6 = host.includes(":");
  if (host === "::1" || (isIpv6 && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")))) return true;

  const octets = host.split(".");
  if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [first, second] = octets.map(Number);
  return first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}
