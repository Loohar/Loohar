import { notifyWelcomeEmail } from "./notificationService.js";
import { createPasswordResetLink } from "./passwordResetService.js";

export async function sendAccountSetupEmail({ user }) {
  if (!user?.id || !user?.email) return { queued: false, error: "User id and email are required" };
  const { resetUrl, expiresAt } = await createPasswordResetLink({ userId: user.id });
  return notifyWelcomeEmail({ user, resetUrl, expiresAt });
}
