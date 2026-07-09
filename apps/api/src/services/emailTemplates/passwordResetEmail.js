function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function isPublicImageUrl(value = "") {
  try {
    const url = new URL(value);
    const loopbackHost = ["127", "0", "0", "1"].join(".");
    return url.protocol === "https:" && !["localhost", loopbackHost, "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function renderLogo({ logoUrl, platformName }) {
  if (!isPublicImageUrl(logoUrl)) {
    return `
      <div style="display:inline-block;text-align:center;">
        <div style="width:64px;height:64px;border-radius:18px;background:#111827;margin:0 auto 12px auto;text-align:center;line-height:64px;color:#ffffff;font-size:30px;font-weight:800;font-family:Arial,Helvetica,sans-serif;" aria-label="${escapeHtml(platformName)} secure logo">L</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:24px;font-weight:800;color:#111827;letter-spacing:0;">${escapeHtml(platformName)}</div>
      </div>
    `;
  }

  return `
    <img src="${escapeHtml(logoUrl)}" width="120" alt="${escapeHtml(platformName)} logo" style="display:block;width:120px;max-width:120px;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;" />
  `;
}

export function renderPasswordResetEmail({
  customerName = "there",
  resetUrl,
  currentYear = new Date().getFullYear(),
  logoUrl = process.env.EMAIL_LOGO_URL,
  platformName = process.env.PLATFORM_NAME || "Loohar",
  supportEmail = process.env.SUPPORT_EMAIL || "support@loohar.com",
  websiteUrl = process.env.PLATFORM_URL || process.env.PLATFORM_WEBSITE_URL || "https://loohar.com"
} = {}) {
  const safePlatformName = escapeHtml(platformName);
  const safeCustomerName = escapeHtml(customerName || "there");
  const safeResetUrl = escapeHtml(resetUrl || "");
  const safeSupportEmail = escapeHtml(supportEmail);
  const safeWebsiteUrl = escapeHtml(websiteUrl);
  const safeYear = escapeHtml(currentYear);
  const preheader = `Reset your ${platformName} password. This secure link expires in 30 minutes.`;

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>Reset Your Password</title>
    <!--[if mso]>
    <noscript>
      <xml>
        <o:OfficeDocumentSettings>
          <o:AllowPNG/>
          <o:PixelsPerInch>96</o:PixelsPerInch>
        </o:OfficeDocumentSettings>
      </xml>
    </noscript>
    <![endif]-->
    <style>
      @media screen and (max-width: 620px) {
        .loohar-container { width: 100% !important; }
        .loohar-card { border-radius: 18px !important; }
        .loohar-content { padding: 28px 22px !important; }
        .loohar-title { font-size: 30px !important; line-height: 36px !important; }
        .loohar-button { width: 100% !important; }
      }
      @media (prefers-color-scheme: dark) {
        body, .loohar-bg { background: #0B1220 !important; }
        .loohar-card, .loohar-panel { background: #111827 !important; }
        .loohar-title, .loohar-text-strong { color: #F9FAFB !important; }
        .loohar-text, .loohar-muted { color: #CBD5E1 !important; }
        .loohar-border { border-color: #253044 !important; }
        .loohar-warning { background: #1F2937 !important; border-color: #92400E !important; }
      }
      .loohar-button:hover { background: #1D4ED8 !important; }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#F9FAFB;color:#111827;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader)}</div>
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

    <table role="presentation" class="loohar-bg" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#F9FAFB;">
      <tr>
        <td align="center" style="padding:36px 16px;">
          <table role="presentation" class="loohar-container" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;">
            <tr>
              <td align="center" style="padding:0 0 22px 0;">
                ${renderLogo({ logoUrl, platformName })}
              </td>
            </tr>
            <tr>
              <td class="loohar-card loohar-border" style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:24px;box-shadow:0 24px 60px rgba(17,24,39,0.12);overflow:hidden;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="height:6px;background:linear-gradient(90deg,#111827 0%,#2563EB 55%,#F59E0B 100%);font-size:0;line-height:0;">&nbsp;</td>
                  </tr>
                  <tr>
                    <td class="loohar-content" style="padding:42px 44px 34px 44px;">
                      <main aria-label="Password reset email">
                        <div style="text-align:center;margin:0 0 22px 0;">
                          <div style="display:inline-block;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:999px;padding:8px 13px;color:#047857;font-size:13px;line-height:16px;font-weight:700;">Secure account recovery</div>
                        </div>
                        <h1 class="loohar-title" style="margin:0;text-align:center;color:#111827;font-size:36px;line-height:42px;font-weight:800;letter-spacing:0;">Reset Your Password</h1>
                        <p class="loohar-muted" style="margin:14px 0 0 0;text-align:center;color:#64748B;font-size:17px;line-height:26px;">We received a request to reset your ${safePlatformName} account password.</p>

                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:32px 0 0 0;">
                          <tr>
                            <td class="loohar-panel loohar-border" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:18px;padding:26px;">
                              <p class="loohar-text" style="margin:0 0 14px 0;color:#334155;font-size:16px;line-height:25px;">Hello ${safeCustomerName},</p>
                              <p class="loohar-text" style="margin:0 0 20px 0;color:#334155;font-size:16px;line-height:25px;">We received a request to reset the password associated with your ${safePlatformName} account. To continue, click the button below.</p>

                              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:28px auto 24px auto;">
                                <tr>
                                  <td align="center" style="border-radius:12px;background:#2563EB;">
                                    <!--[if mso]>
                                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeResetUrl}" style="height:54px;v-text-anchor:middle;width:230px;" arcsize="22%" stroke="f" fillcolor="#2563EB">
                                      <w:anchorlock/>
                                      <center style="color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;">Reset Password</center>
                                    </v:roundrect>
                                    <![endif]-->
                                    <!--[if !mso]><!-->
                                    <a class="loohar-button" href="${safeResetUrl}" aria-label="Reset your ${safePlatformName} password" style="display:inline-block;background:linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%);border-radius:12px;color:#FFFFFF;font-size:17px;font-weight:800;line-height:54px;text-align:center;text-decoration:none;width:230px;min-height:54px;box-shadow:0 12px 24px rgba(37,99,235,0.28);">Reset Password</a>
                                    <!--<![endif]-->
                                  </td>
                                </tr>
                              </table>

                              <p class="loohar-muted" style="margin:0;color:#64748B;font-size:13px;line-height:20px;text-align:center;">If the button does not work, copy and paste this secure URL into your browser:</p>
                              <p style="margin:8px 0 0 0;text-align:center;word-break:break-all;">
                                <a href="${safeResetUrl}" aria-label="Password reset fallback URL" style="color:#2563EB;font-size:13px;line-height:20px;text-decoration:underline;">${safeResetUrl}</a>
                              </p>
                            </td>
                          </tr>
                        </table>

                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 0 0;">
                          <tr>
                            <td class="loohar-border" style="border:1px solid #DBEAFE;border-radius:16px;background:#EFF6FF;padding:22px;">
                              <p class="loohar-text-strong" style="margin:0 0 12px 0;color:#111827;font-size:15px;line-height:22px;font-weight:800;">Security notice</p>
                              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                  <td style="width:22px;color:#10B981;font-size:16px;line-height:24px;vertical-align:top;">&bull;</td>
                                  <td class="loohar-text" style="color:#334155;font-size:15px;line-height:24px;">This link expires in 30 minutes</td>
                                </tr>
                                <tr>
                                  <td style="width:22px;color:#10B981;font-size:16px;line-height:24px;vertical-align:top;">&bull;</td>
                                  <td class="loohar-text" style="color:#334155;font-size:15px;line-height:24px;">This link can only be used once</td>
                                </tr>
                                <tr>
                                  <td style="width:22px;color:#10B981;font-size:16px;line-height:24px;vertical-align:top;">&bull;</td>
                                  <td class="loohar-text" style="color:#334155;font-size:15px;line-height:24px;">If you did not request a password reset, you can safely ignore this email</td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>

                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0 0 0;">
                          <tr>
                            <td class="loohar-warning" style="border:1px solid #FED7AA;background:#FFF7ED;border-radius:16px;padding:20px;">
                              <p style="margin:0 0 8px 0;color:#9A3412;font-size:15px;line-height:22px;font-weight:800;">Did not request this?</p>
                              <p class="loohar-text" style="margin:0;color:#334155;font-size:14px;line-height:22px;">If you did not initiate this request, no action is required. Your account remains secure.</p>
                            </td>
                          </tr>
                        </table>
                      </main>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:28px 16px 0 16px;">
                <p class="loohar-muted" style="margin:0;color:#64748B;font-size:14px;line-height:22px;">Need help? Contact <a href="mailto:${safeSupportEmail}" style="color:#2563EB;text-decoration:underline;">${safeSupportEmail}</a></p>
                <p class="loohar-muted" style="margin:8px 0 0 0;color:#64748B;font-size:14px;line-height:22px;"><a href="${safeWebsiteUrl}" style="color:#2563EB;text-decoration:underline;">${safeWebsiteUrl}</a></p>
                <p class="loohar-muted" style="margin:16px 0 0 0;color:#94A3B8;font-size:12px;line-height:18px;">&copy; ${safeYear} ${safePlatformName}. All rights reserved.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `Reset Your Password

Hello ${customerName || "there"},

We received a request to reset the password associated with your ${platformName} account.

Reset Password:
${resetUrl || ""}

Security notice:
- This link expires in 30 minutes
- This link can only be used once
- If you did not request a password reset, you can safely ignore this email

Did not request this?
If you did not initiate this request, no action is required. Your account remains secure.

Need help? Contact ${supportEmail}
${websiteUrl}

(c) ${currentYear} ${platformName}. All rights reserved.`;

  return { html, text };
}
