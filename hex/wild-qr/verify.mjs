// verify.mjs — real scan verification. Renders a matrix to RGBA at two scales,
// runs jsQR on each, and asserts the decoded text matches. Also runs the
// engine's own validate() decode path for the per-block error meter.
//
// CLI: node verify.mjs <file.png> <expectedText>
import jsQR from "jsqr";
import { QRArt } from "./engine.mjs";
import { renderMatrix, readPNG } from "./png.mjs";

// RFC 3986: scheme and host are case-insensitive. Art solves with
// urlCase:"schemehost" emit case-remixed-but-equivalent URLs; this compares
// with scheme+host lowercased and everything after the host exact.
export function sameURL(a, b) {
  if (a === b) return true;
  if (typeof a !== "string" || typeof b !== "string") return false;
  const norm = (u) => {
    const m = u.match(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)(.*)$/i);
    return m ? m[1].toLowerCase() + m[2] : u;
  };
  return norm(a) === norm(b);
}

// Scan an RGBA image with jsQR. Returns the decoded string, or null.
export function scanRGBA({ data, width, height }) {
  // jsQR wants a plain Uint8ClampedArray of length width*height*4.
  const buf = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
  const res = jsQR(buf, width, height);
  return res ? res.data : null;
}

// verifyMatrix(matrix, version, expectedText) -> {
//   decoded, scales:[{scale,quiet,decoded}], validate:{ok,text,perBlock,...},
//   perBlock:[{errorsUsed,capacity}]
// }
// Throws with a clear message if either scale fails to decode to expectedText,
// or if the engine's validate() disagrees.
export function verifyMatrix(matrix, version, expectedText, opts = {}) {
  // allowSchemeHostCase: accept RFC-3986-equivalent case remixes of
  // scheme+host (for urlCase:"schemehost" art solves).
  const match = opts.allowSchemeHostCase
    ? (got) => sameURL(got, expectedText)
    : (got) => got === expectedText;
  const renders = [
    { scale: 8, quiet: 4 },
    { scale: 3, quiet: 4 },
  ];
  const scales = [];
  for (const r of renders) {
    const img = renderMatrix(matrix, version, r);
    const decoded = scanRGBA(img);
    scales.push({ scale: r.scale, quiet: r.quiet, decoded });
    if (!match(decoded)) {
      throw new Error(
        `jsQR scan failed at scale ${r.scale}/quiet ${r.quiet}: ` +
          `expected ${JSON.stringify(expectedText)}, got ${JSON.stringify(decoded)}`
      );
    }
  }

  const v = QRArt.validate(matrix, version);
  if (!v.ok) {
    throw new Error(`engine validate() failed: ${v.reason || "unknown"}`);
  }
  if (!match(v.text)) {
    throw new Error(
      `engine validate() decoded ${JSON.stringify(v.text)}, expected ${JSON.stringify(expectedText)}`
    );
  }

  const perBlock = v.perBlock.map((b) => ({ errorsUsed: b.errors, capacity: b.capacity }));
  return { decoded: expectedText, scales, validate: v, perBlock };
}

// --- CLI ---
async function main() {
  const [, , file, expectedText] = process.argv;
  if (!file || expectedText === undefined) {
    console.error("usage: node verify.mjs <file.png> <expectedText>");
    process.exit(2);
  }
  const img = readPNG(file);
  const decoded = scanRGBA(img);
  if (decoded === null) {
    console.error(`FAIL: jsQR could not decode ${file}`);
    process.exit(1);
  }
  if (!sameURL(decoded, expectedText)) {
    console.error(`FAIL: ${file} decoded ${JSON.stringify(decoded)}, expected ${JSON.stringify(expectedText)}`);
    process.exit(1);
  }
  console.log(`OK: ${file} decoded ${JSON.stringify(decoded)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
