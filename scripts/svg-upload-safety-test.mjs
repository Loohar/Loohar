// SVG uploads are screened by an allowlist, not a blocklist (L-28).
//
//   node --test scripts/svg-upload-safety-test.mjs
//
// Every "bypass" case below passes the previous screen, which rejected only `<script`, an `on…=`
// attribute, or the literal `javascript:`. A browser opening such a file from the restaurant's
// storage domain would run the script.
import assert from "node:assert/strict";
import { test } from "node:test";

const { svgUploadRejection, isSafeSvgUpload } = await import("../apps/api/src/services/svgSafety.js");
const { parseImageUpload } = await import("../apps/api/src/services/uploadService.js");

// The previous screen, kept here so the tests can show what it missed.
function previousBlocklistAccepted(svg) {
  const text = svg.trimStart().toLowerCase();
  if (text.includes("<script") || /\son[a-z]+\s*=/.test(text) || text.includes("javascript:")) return false;
  return text.startsWith("<svg") || text.startsWith("<?xml");
}

const REAL_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <title>Loohar</title>
  <defs><linearGradient id="g" gradientUnits="objectBoundingBox"><stop offset="0" stop-color="#0A1929"/><stop offset="1" stop-color="#00D9FF"/></linearGradient></defs>
  <g transform="translate(2,2)">
    <rect x="0" y="0" width="60" height="60" rx="8" fill="url" stroke="#111827" stroke-width="2"/>
    <path d="M12 44 L12 16 L20 16 L20 36 L40 36 L40 44 Z" fill="#F8FAFC" fill-rule="evenodd"/>
    <text x="30" y="56" font-family="serif" font-size="8" text-anchor="middle" fill="#9CA3AF">LOOHAR</text>
  </g>
</svg>`;

const BYPASSES = [
  ["SMIL animation sets an event handler", `<svg xmlns="http://www.w3.org/2000/svg"><set attributeName="onload" to="alert(1)"/></svg>`],
  ["foreignObject smuggles HTML", `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="100" height="100"><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror=alert(1)/></body></foreignObject></svg>`],
  ["use pulls in a data URL", `<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+"/></svg>`],
  ["entity encoding hides the scheme", `<svg xmlns="http://www.w3.org/2000/svg"><a href="java&#115;cript:alert(1)"><rect width="10" height="10"/></a></svg>`],
  ["animate rewrites an attribute to a script URL", `<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="href" values="jav&#97;script:alert(1)"/></svg>`],
  ["an external image is referenced", `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/track.png" width="10" height="10"/></svg>`],
  ["a DOCTYPE declares an entity", `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="0">&x;</text></svg>`],
  ["a style imports outside CSS", `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" style="fill:url(#x);background:url('https://example.invalid/x')"/></svg>`],
  ["an iframe is embedded", `<svg xmlns="http://www.w3.org/2000/svg"><iframe src="https://example.invalid"/></svg>`]
];

test("a real logo is still accepted", () => {
  assert.equal(svgUploadRejection(REAL_LOGO), "", `a legitimate logo must upload: ${svgUploadRejection(REAL_LOGO)}`);
  assert.equal(isSafeSvgUpload(REAL_LOGO), true);
});

test("every payload that slipped past the old blocklist is now refused", () => {
  for (const [name, svg] of BYPASSES) {
    assert.equal(isSafeSvgUpload(svg), false, `still accepted: ${name}`);
    assert.ok(svgUploadRejection(svg).length > 0, `${name} must say why it was refused`);
  }
});

test("the old blocklist really did accept most of them", () => {
  const slipped = BYPASSES.filter(([, svg]) => previousBlocklistAccepted(svg));
  assert.ok(slipped.length >= 6, `expected the old screen to accept several payloads, it accepted ${slipped.length}`);
  // The obvious ones it did catch are still caught.
  assert.equal(previousBlocklistAccepted(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`), false);
});

test("a plainly hostile document is refused", () => {
  assert.equal(isSafeSvgUpload(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`), false);
  assert.equal(isSafeSvgUpload(`<svg onload="alert(1)" xmlns="http://www.w3.org/2000/svg"></svg>`), false);
  assert.equal(isSafeSvgUpload("<html><body>not an svg</body></html>"), false);
  assert.equal(isSafeSvgUpload(""), false);
});

test("the upload path itself refuses a hostile SVG and accepts a real logo", () => {
  const asDataUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;

  const accepted = parseImageUpload({ dataUrl: asDataUrl(REAL_LOGO), fileName: "logo.svg" });
  assert.equal(accepted.mimeType, "image/svg+xml");
  assert.equal(accepted.extension, "svg");

  for (const [name, svg] of BYPASSES) {
    assert.throws(
      () => parseImageUpload({ dataUrl: asDataUrl(svg), fileName: "logo.svg" }),
      (error) => error.status === 400,
      `the upload endpoint still accepted: ${name}`
    );
  }
});
