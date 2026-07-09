import { renderPasswordResetEmail } from "./emailTemplates/passwordResetEmail.js";

const configuredEmailProvider = process.env.EMAIL_PROVIDER || "console";
const configuredSmsProvider = process.env.SMS_PROVIDER || "console";
const emailFrom = process.env.EMAIL_FROM || "orders@loohar.com";
const emailReplyTo = process.env.EMAIL_REPLY_TO || process.env.SUPPORT_EMAIL || "";

function parseEmailAddress(value = "") {
  const match = String(value).match(/^(.*)<([^>]+)>$/);
  if (!match) return { email: String(value).trim() };
  return { name: match[1].replaceAll("\"", "").trim(), email: match[2].trim() };
}

function maskRecipient(value = "") {
  if (!value) return null;
  const [name, domain] = value.split("@");
  if (!domain) return value.replace(/\d(?=\d{2})/g, "*");
  return `${name.slice(0, 2)}***@${domain}`;
}

function sanitizeNotificationData(data = {}) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      if (/token|password|secret|resetUrl/i.test(key)) return [key, "[redacted]"];
      return [key, value];
    })
  );
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function renderEmail({ subject, template, data = {} }) {
  const platformName = process.env.PLATFORM_NAME || "Loohar";
  const title = escapeHtml(subject);
  let body = "";
  if (template === "welcome_email") {
    const resetUrl = data.resetUrl;
    body = resetUrl
      ? `<p>Welcome to ${escapeHtml(platformName)}.</p><p>Your restaurant account is ready. Use the secure link below to set your password and sign in.</p><p><a href="${escapeHtml(resetUrl)}">Set your password</a></p><p>This link expires at ${escapeHtml(data.expiresAt || "the configured expiration time")}.</p>`
      : `<p>Welcome to ${escapeHtml(platformName)}.</p><p>Your account is ready. Ask your platform owner to send a password setup link if you cannot sign in.</p>`;
  } else if (template === "password_reset") {
    return renderPasswordResetEmail({
      customerName: data.customerName,
      resetUrl: data.resetUrl,
      currentYear: new Date().getFullYear(),
      platformName
    });
  } else {
    body = `<pre>${escapeHtml(JSON.stringify(sanitizeNotificationData(data), null, 2))}</pre>`;
  }
  const text = body
    .replace(/<a href="([^"]+)">([^<]+)<\/a>/g, "$2: $1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'");
  const html = `<!doctype html><html><body><h1>${title}</h1>${body}<p>If you did not expect this email, you can ignore it.</p></body></html>`;
  return { html, text };
}

async function deliverWithResend({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) return { queued: false, error: "RESEND_API_KEY is not configured" };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from: emailFrom, to: [to], subject, html, text, ...(emailReplyTo ? { reply_to: emailReplyTo } : {}) })
  });
  if (!response.ok) return { queued: false, error: `Resend returned ${response.status}` };
  const payload = await response.json().catch(() => ({}));
  return { queued: true, providerMessageId: payload.id };
}

async function deliverWithSendGrid({ to, subject, html, text }) {
  if (!process.env.SENDGRID_API_KEY) return { queued: false, error: "SENDGRID_API_KEY is not configured" };
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: parseEmailAddress(emailFrom),
      ...(emailReplyTo ? { reply_to: parseEmailAddress(emailReplyTo) } : {}),
      subject,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html", value: html }
      ]
    })
  });
  if (!response.ok) return { queued: false, error: `SendGrid returned ${response.status}` };
  return { queued: true };
}

export async function sendEmail({ to, subject, template, data = {} }) {
  const rendered = renderEmail({ subject, template, data });
  const message = {
    provider: configuredEmailProvider,
    channel: "email",
    to: maskRecipient(to),
    subject,
    template,
    data: sanitizeNotificationData(data)
  };
  if (configuredEmailProvider === "console") {
    console.log("Email notification", message);
    return { queued: false, delivery: "console_only", ...message };
  }
  if (configuredEmailProvider === "resend") {
    return { ...message, ...(await deliverWithResend({ to, subject, ...rendered })) };
  }
  if (configuredEmailProvider === "sendgrid") {
    return { ...message, ...(await deliverWithSendGrid({ to, subject, ...rendered })) };
  }
  return { queued: false, error: `Email provider "${configuredEmailProvider}" is not implemented`, ...message };
}

export async function sendSms({ to, template, data = {} }) {
  const message = {
    provider: configuredSmsProvider,
    channel: "sms",
    to: maskRecipient(to),
    template,
    data: sanitizeNotificationData(data)
  };
  if (configuredSmsProvider === "console") console.log("SMS notification", message);
  return { queued: true, ...message };
}

export async function notifyOrderConfirmation({ order }) {
  return sendEmail({
    to: order.customer?.email,
    subject: `Order #${order.orderNumber} confirmed`,
    template: "order_confirmation",
    data: { orderId: order.id, orderNumber: order.orderNumber, totalCents: order.totalCents }
  });
}

export async function notifyNewOrderAlert({ order }) {
  return sendEmail({
    to: order.restaurant?.email,
    subject: `New order #${order.orderNumber}`,
    template: "new_order_alert",
    data: { orderId: order.id, orderNumber: order.orderNumber, type: order.type }
  });
}

export async function notifyDriverAssignment({ delivery }) {
  return sendSms({
    to: delivery.driver?.user?.phone,
    template: "driver_assignment",
    data: { deliveryId: delivery.id, orderId: delivery.orderId }
  });
}

export async function notifyOrderStatusUpdate({ order }) {
  await sendEmail({
    to: order.customer?.email,
    subject: `Order #${order.orderNumber} is ${order.status}`,
    template: "order_status_update",
    data: { orderId: order.id, status: order.status }
  });
  if (order.customer?.phone) {
    await sendSms({
      to: order.customer.phone,
      template: "order_status_update",
      data: { orderId: order.id, status: order.status }
    });
  }
}

export async function notifyWelcomeEmail({ user, resetUrl, expiresAt }) {
  return sendEmail({
    to: user.email,
    subject: resetUrl ? "Set up your Loohar account" : "Welcome to your restaurant ordering platform",
    template: "welcome_email",
    data: { userId: user.id, role: user.role, resetUrl, expiresAt }
  });
}

export async function notifyPasswordReset({ user, resetUrl, expiresAt }) {
  return sendEmail({
    to: user.email,
    subject: "Reset your password",
    template: "password_reset",
    data: { customerName: user.name || user.email, resetUrl, expiresAt }
  });
}
