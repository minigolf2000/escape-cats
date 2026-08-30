/*
 * Independent scan check. The engine's own validate() is the honest decode
 * path (format info, unmask, de-interleave, Berlekamp-Massey) and reports the
 * error budget per block; this adds a SECOND opinion from jsQR over the
 * rendered pixels, at several scales, the way the studio's exports were
 * cross-checked in development.
 *
 * jsQR is a dev-only dependency and is not in package.json — point
 * JSQR_PATH at an install, or skip: the arithmetic still stands on its own.
 *   mkdir -p /tmp/qrverify && cd /tmp/qrverify && npm i jsqr
 *   JSQR_PATH=/tmp/qrverify/node_modules/jsqr node scan-check.mjs runs/both-11
 */
import { readFileSync, readdirSync } from "node:fs";
import { QR } from "./engine.mjs";
import { sameURL } from "./solve.mjs";

let jsQR = null;
try {
  const p = process.env.JSQR_PATH || "/tmp/qrverify/node_modules/jsqr";
  jsQR = (await import(`${p}/dist/jsQR.js`)).default;
} catch { /* optional */ }

export function scanCheck(matrix, version, url, quiets = [4, 2], scales = [1, 2, 3, 8]) {
  const v = QR.validate(matrix, version, {});
  const out = { validate: v.ok && sameURL(v.text, url), decoded: v.text, jsqr: {} };
  const worst = v.perBlock ? Math.min(...v.perBlock.map((b) => b.capacity - b.errors)) : null;
  out.headroom = worst;
  if (!jsQR) return out;
  for (const quiet of quiets)
    for (const scale of scales) {
      const { data, width, height } = QR.toRGBA(matrix, version, { scale, quiet });
      const r = jsQR(new Uint8ClampedArray(data), width, height);
      out.jsqr[`q${quiet}x${scale}`] = r ? (sameURL(r.data, url) ? "ok" : `WRONG:${r.data}`) : "no-read";
    }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  const man = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
  for (const r of man.results) {
    const g = r.genome;
    const { renderDesign } = await import("./design.mjs");
    const { evaluate } = await import("./solve.mjs");
    const e = evaluate(g, man.url);
    const res = scanCheck(e.matrix, g.version, man.url);
    console.log(r.name.padEnd(12), "validate", String(res.validate).padEnd(5),
      "headroom", String(res.headroom).padEnd(3), JSON.stringify(res.jsqr));
  }
}
