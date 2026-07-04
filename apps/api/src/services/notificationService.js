const configuredEmailProvider = process.env.EMAIL_PROVIDER || "console";
const configuredSmsProvider = process.env.SMS_PROVIDER || "console";

function maskRecipient(value = "") {
  if (!value) return null;
  const [name, domain] = value.split("@");
  if (!domain) return value.replace(/\d(?=\d{2})/g, "*");
  return `${name.slice(0, 2)}***@${domain}`;
}

export async function sendEmail({ to, subject, template, data = {} }) {
  const message = {
    provider: configuredEmailProvider,
    channel: "email",
    to: maskRecipient(to),
    subject,
    template,
    data
  };
  if (configuredEmailProvider === "console") console.log("Email notification placeholder", message);
  return { queued: true, ...message };
}

export async function sendSms({ to, template, data = {} }) {
  const message = {
    provider: configuredSmsProvider,
    channel: "sms",
    to: maskRecipient(to),
    template,
    data
  };
  if (configuredSmsProvider === "console") console.log("SMS notification placeholder", message);
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

export async function notifyWelcomeEmail({ user }) {
  return sendEmail({
    to: user.email,
    subject: "Welcome to your restaurant ordering platform",
    template: "welcome_email",
    data: { userId: user.id, role: user.role }
  });
}

export async function notifyPasswordReset({ user, resetUrl }) {
  return sendEmail({
    to: user.email,
    subject: "Reset your password",
    template: "password_reset",
    data: { resetUrl }
  });
}
