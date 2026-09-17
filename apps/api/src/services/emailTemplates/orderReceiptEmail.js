// Itemized receipt email sent to a customer when their order is paid. Built from the same receipt
// payload the printed receipt uses, so the email and the paper agree.
function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function money(cents) {
  const amount = Number(cents || 0) / 100;
  return amount < 0 ? `-$${Math.abs(amount).toFixed(2)}` : `$${amount.toFixed(2)}`;
}

function tenderLabel(payment = {}) {
  const provider = String(payment.provider || "").toUpperCase();
  const source = String(payment.source || "").toUpperCase();
  if (source === "POS_CASH" || provider === "MANUAL") return "Cash";
  if (source === "POS_TERMINAL") return "Card, in store";
  if (provider === "STRIPE_CONNECT") return "Card";
  return "Payment";
}

// Every line the printed receipt shows, so the emailed lines always add up to the same total.
function totalsRows(totals = {}, payment = {}) {
  const rows = [
    ["Subtotal", totals.subtotalCents],
    ...(totals.discountCents ? [["Discount", -totals.discountCents]] : []),
    ...(totals.deliveryFeeCents ? [["Delivery", totals.deliveryFeeCents]] : []),
    ...(totals.serviceFeeCents ? [["Service fee", totals.serviceFeeCents]] : []),
    ["Tax", totals.taxCents],
    ...(totals.restaurantTipCents ? [["Tip", totals.restaurantTipCents]] : []),
    ...(totals.driverTipCents ? [["Driver tip", totals.driverTipCents]] : []),
    ...(totals.otherFeesCents ? [["Other", totals.otherFeesCents]] : [])
  ];
  const refunded = Number(payment.refundedCents || 0);
  return { rows, refunded };
}

export function renderOrderReceiptEmail({ receipt, platformName = "Loohar", trackingUrl = "" }) {
  const restaurantName = receipt?.restaurant?.name || platformName;
  const order = receipt?.order || {};
  const totals = receipt?.totals || {};
  const payment = receipt?.payment || {};
  const items = Array.isArray(receipt?.items) ? receipt.items : [];
  const { rows, refunded } = totalsRows(totals, payment);

  const itemLines = items.map((item) => ({
    name: `${item.quantity || 1} x ${item.name || "Item"}`,
    amount: money(item.lineTotalCents ?? item.totalCents ?? item.unitPriceCents)
  }));

  const itemsHtml = itemLines
    .map((line) => `<tr><td style="padding:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;">${escapeHtml(line.name)}</td><td align="right" style="padding:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;">${escapeHtml(line.amount)}</td></tr>`)
    .join("");
  const totalsHtml = rows
    .map(([label, amount]) => `<tr><td style="padding:2px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#4b5563;">${escapeHtml(label)}</td><td align="right" style="padding:2px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#4b5563;">${escapeHtml(money(amount))}</td></tr>`)
    .join("");
  const refundHtml = refunded
    ? `<tr><td style="padding:2px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#b91c1c;">Refunded</td><td align="right" style="padding:2px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#b91c1c;">-${escapeHtml(money(refunded))}</td></tr>`
    : "";
  const trackingHtml = trackingUrl
    ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#4b5563;">Track this order: <a href="${escapeHtml(trackingUrl)}">${escapeHtml(trackingUrl)}</a></p>`
    : "";

  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;">
    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:20px;color:#111827;margin:0 0 4px 0;">${escapeHtml(restaurantName)}</h1>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b7280;margin:0 0 16px 0;">Order #${escapeHtml(order.orderNumber || "")} &middot; ${escapeHtml(tenderLabel(payment))} &middot; ${escapeHtml(payment.status === "PAID" ? "Paid" : String(payment.status || "Pending"))}</p>
    <table width="100%" cellspacing="0" cellpadding="0">${itemsHtml}</table>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;" />
    <table width="100%" cellspacing="0" cellpadding="0">${totalsHtml}${refundHtml}
      <tr><td style="padding-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#111827;">Total</td><td align="right" style="padding-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#111827;">${escapeHtml(money(totals.totalCents))}</td></tr>
    </table>
    ${trackingHtml}
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#9ca3af;margin-top:16px;">Questions about this order? Contact ${escapeHtml(restaurantName)}${receipt?.restaurant?.phone ? ` at ${escapeHtml(receipt.restaurant.phone)}` : ""}.</p>
  </div>
</body></html>`;

  const text = [
    restaurantName,
    `Order #${order.orderNumber || ""} - ${tenderLabel(payment)} - ${payment.status === "PAID" ? "Paid" : payment.status || "Pending"}`,
    "",
    ...itemLines.map((line) => `${line.name}  ${line.amount}`),
    "",
    ...rows.map(([label, amount]) => `${label}: ${money(amount)}`),
    ...(refunded ? [`Refunded: -${money(refunded)}`] : []),
    `Total: ${money(totals.totalCents)}`,
    ...(trackingUrl ? ["", `Track this order: ${trackingUrl}`] : [])
  ].join("\n");

  return { html, text };
}
