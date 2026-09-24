// The enrolment QR must encode exactly the otpauth URL the server issued.
//
//   node --test scripts/mfa-enrolment-qr-test.mjs
//
// A QR that renders but encodes the wrong thing is worse than no QR: the authenticator adds an
// account that produces codes which are silently never accepted. So this decodes the generated
// image and compares it with the server's own URL, rather than checking that an <img> appeared.
import assert from "node:assert/strict";
import { test } from "node:test";
import jsQR from "jsqr";
import { PNG } from "pngjs";

const { otpauthQrDataUrl } = await import("../apps/web/src/shared/otpauthQr.js");
const { base32Encode } = await import("../apps/api/src/services/mfaService.js");

function decodeQr(dataUrl) {
  const png = PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return decoded?.data || "";
}

// Exactly the URL apps/api/src/services/mfaService.js builds.
function serverOtpauthUrl(secretBase32, email) {
  return `otpauth://totp/${encodeURIComponent(`Loohar:${email}`)}?secret=${secretBase32}&issuer=Loohar&algorithm=SHA1&digits=6&period=30`;
}

test("the QR decodes back to the server's otpauth URL, character for character", async () => {
  const secret = base32Encode(Buffer.from("0123456789abcdefghij"));
  const url = serverOtpauthUrl(secret, "owner@loohar.com");

  const dataUrl = await otpauthQrDataUrl(url);
  assert.match(dataUrl, /^data:image\/png;base64,/, "a PNG data URL is produced");
  assert.equal(decodeQr(dataUrl), url, "a QR encoding anything else would add a silently broken account");
});

test("the secret survives scanning, which is the whole point", async () => {
  const secret = base32Encode(Buffer.from("abcdefghijklmnopqrst"));
  const decoded = decodeQr(await otpauthQrDataUrl(serverOtpauthUrl(secret, "owner@loohar.com")));
  assert.equal(new URL(decoded).searchParams.get("secret"), secret);
  assert.equal(new URL(decoded).searchParams.get("issuer"), "Loohar");
  assert.equal(new URL(decoded).searchParams.get("period"), "30");
  assert.equal(new URL(decoded).searchParams.get("digits"), "6");
});

test("an address with characters that need escaping still scans", async () => {
  const secret = base32Encode(Buffer.from("qrstuvwxyz0123456789"));
  const email = "owner+pos@loohar.com";
  const url = serverOtpauthUrl(secret, email);
  assert.equal(decodeQr(await otpauthQrDataUrl(url)), url);
});

test("no URL produces no image rather than a broken one", async () => {
  assert.equal(await otpauthQrDataUrl(""), "");
  assert.equal(await otpauthQrDataUrl(undefined), "");
});
