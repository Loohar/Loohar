// SVG is accepted for restaurant logos, and a browser will execute script inside an SVG when it is
// opened as a document. Uploads used to be screened with a blocklist: reject anything containing
// `<script`, an `on…=` attribute, or `javascript:`. Blocklists lose. Each of these passes that
// screen and still runs script or pulls in outside content:
//
//   <set attributeName="onload" to="alert(1)"/>      SMIL: no `on…=` token appears
//   <foreignObject><body onload=…>                   HTML smuggled inside SVG
//   <use xlink:href="data:image/svg+xml;base64,…"/>  payload arrives by reference
//   <a href="java&#115;cript:alert(1)">              entity encoding hides the scheme
//
// So this is an allowlist instead: every element and attribute must be one that a logo legitimately
// needs, and anything else is refused. It is deliberately strict — refusing a slightly unusual but
// harmless logo is a much smaller problem than serving script from the restaurant's own storage
// domain, and the restaurant can always upload a PNG.
const ALLOWED_ELEMENTS = new Set([
  "svg", "g", "defs", "title", "desc", "metadata",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan",
  "lineargradient", "radialgradient", "stop",
  "clippath", "mask"
]);

const ALLOWED_ATTRIBUTES = new Set([
  "id", "class", "style", "transform", "opacity",
  "d", "points", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "width", "height", "viewbox", "preserveaspectratio", "version",
  "fill", "fill-opacity", "fill-rule", "clip-rule", "clip-path", "mask",
  "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit",
  "offset", "stop-color", "stop-opacity",
  "gradientunits", "gradienttransform", "spreadmethod", "maskunits", "clippathunits",
  "font-family", "font-size", "font-weight", "font-style", "text-anchor",
  "dominant-baseline", "letter-spacing", "xml:space",
  "xmlns", "xmlns:xlink", "xmlns:svg"
]);

// Entity encoding is how a payload hides from a plain string search, so scanning happens after
// decoding. Only the numeric forms matter here; named entities cannot express a scheme or a tag.
function decodeNumericEntities(text) {
  return text.replace(/&#(x?)([0-9a-f]+);?/gi, (match, hex, value) => {
    const code = Number.parseInt(value, hex ? 16 : 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

export function svgUploadRejection(svgSource = "") {
  const decoded = decodeNumericEntities(String(svgSource)).toLowerCase();

  if (!/^\s*(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/.test(decoded)) {
    return "must be an SVG document";
  }
  // A DOCTYPE can declare entities that expand into a payload or read local files.
  if (decoded.includes("<!doctype") || decoded.includes("<!entity")) {
    return "must not declare a DOCTYPE or entities";
  }
  if (decoded.includes("<![cdata[")) {
    return "must not contain CDATA sections";
  }

  for (const [, element] of decoded.matchAll(/<\/?\s*([a-z0-9:_-]+)/g)) {
    if (!ALLOWED_ELEMENTS.has(element)) return `contains an element that is not allowed in a logo: ${element}`;
  }

  for (const [, attribute, value] of decoded.matchAll(/\s([a-z_:][a-z0-9:._-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g)) {
    if (attribute.startsWith("on")) return `contains an event handler attribute: ${attribute}`;
    if (!ALLOWED_ATTRIBUTES.has(attribute)) return `contains an attribute that is not allowed in a logo: ${attribute}`;
    const unquoted = value.replace(/^['"]|['"]$/g, "");
    if (/(javascript|vbscript|data)\s*:/.test(unquoted)) return `contains a script or data URL in ${attribute}`;
    if (attribute === "style" && /(url\s*\(|expression\s*\(|@import)/.test(unquoted)) {
      return "contains a style that loads outside content";
    }
  }

  return "";
}

export function isSafeSvgUpload(svgSource = "") {
  return svgUploadRejection(svgSource) === "";
}
