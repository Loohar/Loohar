// Renders an enrolment otpauth:// URL as a QR code an authenticator app can scan.
//
// Typing a 32-character base32 secret by hand is where people give up, and a mistyped character
// produces codes that are simply wrong with nothing to explain why. Scanning removes that entirely.
//
// The QR is generated in the browser from a URL the page already holds, so the secret is not sent
// anywhere new to make the picture. The typed key stays on screen as the fallback: a QR is useless
// when the authenticator is on the same device as the screen, or when a camera is unavailable.
import QRCode from "qrcode";

// Error correction M, and a quiet zone, because these are photographed off a screen at an angle.
const OPTIONS = { errorCorrectionLevel: "M", margin: 2, width: 208, color: { dark: "#0A1929", light: "#FFFFFF" } };

export async function otpauthQrDataUrl(otpauthUrl) {
  if (!otpauthUrl) return "";
  try {
    return await QRCode.toDataURL(String(otpauthUrl), OPTIONS);
  } catch {
    // A failed QR must never block enrolment; the typed key still works.
    return "";
  }
}
