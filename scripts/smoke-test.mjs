const loopback = ["127", "0", "0", "1"].join(".");
const apiOrigin = (process.env.SMOKE_API_ORIGIN || `http://${loopback}:5001`).replace(/\/+$/, "");
const webOrigin = (process.env.SMOKE_WEB_ORIGIN || `http://${loopback}:5173`).replace(/\/+$/, "");
const checks = [];

function compactDetail(detail = "", maxLength = 260) {
  const text = String(detail);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function pass(name, detail = "") {
  checks.push({ name, ok: true, detail: compactDetail(detail) });
}

function fail(name, detail = "") {
  checks.push({ name, ok: false, detail: compactDetail(detail) });
}

async function requestJson(name, url, options = {}, validate = (response) => response.ok) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    const valid = await validate(response, payload);
    if (valid) pass(name, `${response.status}`);
    else fail(name, `${response.status} ${payload?.error || payload?.message || "Unexpected response shape"}`);
    return { response, payload };
  } catch (error) {
    fail(name, error.message);
    return { response: null, payload: null };
  }
}

async function requestHead(name, url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (response.ok) pass(name, `${response.status}`);
    else fail(name, `${response.status}`);
  } catch (error) {
    fail(name, error.message);
  }
}

async function demoLogin(role) {
  const { payload } = await requestJson(
    `${role} demo login`,
    `${apiOrigin}/api/auth/demo-login`,
    { method: "POST", body: JSON.stringify({ role }) },
    (response, body) => response.ok && Boolean(body?.accessToken) && body?.user?.role === role
  );
  return payload?.accessToken || "";
}

await requestJson("API health", `${apiOrigin}/health`, {}, (response, body) => response.ok && body?.ok === true);
await requestJson("API namespaced health", `${apiOrigin}/api/health`, {}, (response, body) => response.ok && body?.ok === true);
await requestHead("Web root", `${webOrigin}/`);
await requestHead("Web public site route", `${webOrigin}/sites/loohar-restaurant`);
await requestHead("Web restaurant route", `${webOrigin}/restaurant/loohar-restaurant`);

await requestJson("Public site bundle", `${apiOrigin}/api/public/sites/loohar-restaurant`, {}, (response, body) => response.ok && Boolean(body?.restaurant?.slug) && Boolean(body?.seo) && Boolean(body?.jsonLd));
await requestJson("Public menu bundle", `${apiOrigin}/api/public/sites/loohar-restaurant/menu`, {}, (response, body) => response.ok && Array.isArray(body?.menuItems));
await requestJson("Discovery search", `${apiOrigin}/api/public/discover?city=Denver&type=RESTAURANT`, {}, (response, body) => response.ok && Array.isArray(body?.restaurants));
await requestJson("Customer restaurant menu API", `${apiOrigin}/api/customer/restaurants/loohar-restaurant`, {}, (response, body) => response.ok && Boolean(body?.restaurant?.id));
await requestJson("Admin route rejects anonymous", `${apiOrigin}/api/admin/tenants`, {}, (response) => response.status === 401);
await requestJson("Forgot password generic response", `${apiOrigin}/api/auth/forgot-password`, { method: "POST", body: JSON.stringify({ email: "missing-smoke-user@loohar.local" }) }, (response, body) => response.ok && body?.ok === true);

const adminToken = await demoLogin("SUPER_ADMIN");
if (adminToken) {
  await requestJson("Admin tenants", `${apiOrigin}/api/admin/tenants`, { headers: { Authorization: `Bearer ${adminToken}` } }, (response, body) => response.ok && Array.isArray(body?.restaurants));
  await requestJson("Admin dashboard summary", `${apiOrigin}/api/admin/dashboard-summary`, { headers: { Authorization: `Bearer ${adminToken}` } }, (response, body) => response.ok && Number.isFinite(body?.totalBusinesses));
}

let restaurantId = "";
let deliveryOrderId = "";
const ownerToken = await demoLogin("RESTAURANT_OWNER");
if (ownerToken) {
  const ownerMe = await requestJson("Restaurant owner me", `${apiOrigin}/api/restaurants/me`, { headers: { Authorization: `Bearer ${ownerToken}` } }, (response, body) => response.ok && Boolean(body?.restaurant?.id));
  restaurantId = ownerMe.payload?.restaurant?.id || "";
  if (restaurantId) {
    const orderList = await requestJson("Restaurant orders", `${apiOrigin}/api/restaurants/${restaurantId}/orders`, { headers: { Authorization: `Bearer ${ownerToken}` } }, (response, body) => response.ok && Array.isArray(body?.orders));
    const orders = orderList.payload?.orders || [];
    const receiptOrder = orders[0];
    deliveryOrderId = orders.find((order) => order.type === "DELIVERY")?.id || "";
    if (receiptOrder) {
      const receiptPayload = await requestJson(
        "Receipt payload with QR",
        `${apiOrigin}/api/restaurants/${restaurantId}/orders/${receiptOrder.id}/receipt?kind=customer`,
        { headers: { Authorization: `Bearer ${ownerToken}` } },
        (response, body) => response.ok && Boolean(body?.receipt?.qr?.customer?.webUrl) && Array.isArray(body?.receipt?.items)
      );
      const trackingUrl = receiptPayload.payload?.receipt?.qr?.customer?.webUrl || "";
      const trackingToken = trackingUrl ? new URL(trackingUrl).searchParams.get("token") : "";
      await requestJson("Customer QR tracking", `${apiOrigin}/api/orders/${receiptOrder.id}/track?token=${encodeURIComponent(trackingToken || "")}`, {}, (response, body) => response.ok && body?.order?.id === receiptOrder.id && !body?.order?.customer?.email);
    } else {
      fail("Seeded order available for receipt smoke", "No restaurant orders found");
    }
    if (deliveryOrderId) {
      await requestJson(
        "Driver slip receipt payload",
        `${apiOrigin}/api/restaurants/${restaurantId}/orders/${deliveryOrderId}/receipt?kind=driver`,
        { headers: { Authorization: `Bearer ${ownerToken}` } },
        (response, body) => response.ok && Boolean(body?.receipt?.qr?.driver?.webUrl)
      );
    }
  }
}

const driverToken = await demoLogin("DRIVER");
if (driverToken) {
  await requestJson("Driver me", `${apiOrigin}/api/driver/me`, { headers: { Authorization: `Bearer ${driverToken}` } }, (response, body) => response.ok && Boolean(body?.driver?.id));
  const driverDeliveries = await requestJson("Driver deliveries", `${apiOrigin}/api/driver/deliveries`, { headers: { Authorization: `Bearer ${driverToken}` } }, (response, body) => response.ok && Array.isArray(body?.deliveries));
  const driverOrderId = driverDeliveries.payload?.deliveries?.[0]?.orderId || deliveryOrderId;
  if (driverOrderId) {
    await requestJson("Driver QR order route", `${apiOrigin}/api/driver/orders/${driverOrderId}`, { headers: { Authorization: `Bearer ${driverToken}` } }, (response, body) => response.ok && Boolean(body?.order?.id));
  }
  await requestJson("Driver earnings", `${apiOrigin}/api/driver/earnings`, { headers: { Authorization: `Bearer ${driverToken}` } }, (response, body) => response.ok && Number.isFinite(body?.totalEarningsCents));
}

const kitchenToken = await demoLogin("KITCHEN_STAFF");
if (kitchenToken) {
  await requestJson("Kitchen orders", `${apiOrigin}/api/kitchen/orders`, { headers: { Authorization: `Bearer ${kitchenToken}` } }, (response, body) => response.ok && Array.isArray(body?.orders));
}

const passed = checks.filter((check) => check.ok).length;
const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  const mark = check.ok ? "PASS" : "FAIL";
  console.log(`${mark} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
}
console.log(`Smoke test: ${passed}/${checks.length} passed`);

if (failed.length > 0) process.exit(1);
