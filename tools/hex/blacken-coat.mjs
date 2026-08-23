#!/usr/bin/env node
// Re-inks Hex's DAY coat to the night drawing's black.
//
// Hex used to be two cats: a grey-brown day cat (#665B59) and a black night one
// (#0C0B0A). She is one black cat now, and this script is how the day art got
// there — the artist's day sheet is untouched upstream, this is the transform,
// and re-running it after a fresh export re-blackens the new frames.
//
//   node tools/hex/blacken-coat.mjs            # rewrite the day frames in place
//   node tools/hex/blacken-coat.mjs --check    # exit 1 if any frame is still grey
//
// WHY A BAKE AND NOT A FILTER: a CSS/SVG filter would have to run on the cat
// every frame (she squashes on every pet, and the shadow layer deliberately
// carries no filter for exactly that reason — see index.html), and no single
// curve does the job anyway: the coat has to fall 102 -> 12 while the drawn line
// stays at 48, which is not monotonic. Baking it into the pixels is free at
// runtime and is the same thing the artist would have done in Procreate.
//
// HOW: the day sheet is a THREE-INK drawing — coat, line, inner-ear pink — and
// every other pixel in it is an antialiased blend of two of those three. So each
// pixel is projected onto whichever of the three ink-pair segments it sits
// closest to, and re-mixed at the same ratio with the COAT endpoint moved to the
// night black. Line and pink are endpoints that did not move, which is why the
// keyline survives the change. Measured residual off this model on hex-day.png:
// mean 0.15/255 — the drawing really is just these three inks.
//
// The line is now LIGHTER than the coat rather than darker, and that is the
// whole look: the outline reads as a charcoal rim on black, the whiskers still
// carry against the pink page, and the night sheet keeps its white keyline so
// the day->night cross-fade is still a visible change of coat.
//
// The coat ink is read off each frame rather than hardcoded: the squash sheets
// export one level lighter than the resting one (103,92,90 vs 102,91,89), and a
// fixed anchor pushed that difference onto the coat-pink segment and tinted the
// squash frames four levels warm. Per-frame, every frame lands on exactly the
// night black.
//
// Pixels with alpha < 8 are left exactly as exported: the day sheet carries a
// fringe of (0,0,0,1..6) pixels that are invisible on screen but would project
// past the line endpoint and get lightened for no reason.

import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ART = join(dirname(fileURLToPath(import.meta.url)), "..", "..",
                 "apps", "hex-clicker", "public", "art");

// Every frame of the DAY cat: the resting coat and its cut-away ears, the three
// pet-squash frames, and the shadow layers (painted in coat colour outside her
// line, which is why they recolour with her). hex-night.png is not here — it is
// where the black came from.
const FRAMES = [
  "hex-day.png", "hex-day-earL.png", "hex-day-earR.png",
  "hex-squash1.png", "hex-squash2.png", "hex-squash3.png",
  "hex-day-shadow.png",
  "hex-squash1-shadow.png", "hex-squash2-shadow.png", "hex-squash3-shadow.png",
];

const DAY_COAT = [102, 91, 89];      // what the artist's day sheet is inked in
const NIGHT_COAT = [12, 11, 10];     // sampled off hex-night.png
const LINE = [48, 43, 42];           // the drawn line — unchanged, see above
const PINK = [155, 113, 109];        // inner ear — unchanged
const ALPHA_FLOOR = 8;               // below this a pixel is invisible; leave it
const SAME = 24;                     // "this frame is already inked in that"

// ---- PNG: 8-bit RGBA, non-interlaced. Every frame in art/ is exactly that, and
// decode() refuses anything else rather than quietly writing out garbage. ----

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const [depth, color, , , interlace] = buf.subarray(24, 29);
  if (depth !== 8 || color !== 6 || interlace !== 0)
    throw new Error(`unsupported PNG (depth ${depth}, colour ${color}, interlace ${interlace})`);
  const idat = [];
  for (let i = 8; i < buf.length; ) {
    const len = buf.readUInt32BE(i), type = buf.toString("ascii", i + 4, i + 8);
    if (type === "IDAT") idat.push(buf.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[y * stride + x - 4] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad row filter ${filter}`);
      px[y * stride + x] = v & 0xff;
    }
  }
  return { w, h, px };
}

function encode({ w, h, px }) {
  const stride = w * 4;
  // Filter 1 (Sub) on every row: this art is flat fills, so Sub collapses each
  // run to zeroes and deflate does the rest. Matching the exporter's own choice
  // of filter per row is not worth a heuristic — the frames come out within a
  // few KB of where they went in.
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 1;
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? px[y * stride + x - 4] : 0;
      raw[y * (stride + 1) + 1 + x] = (px[y * stride + x] - left) & 0xff;
    }
  }
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(CRC(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- the re-inking ----

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Closest point on the segment A-B, as the mix ratio t plus how far off it the
// pixel sits. The distance picks WHICH pair of inks a pixel is a blend of; the
// ratio is what re-mixes it from the new pair.
function project(p, a, b) {
  let num = 0, den = 0;
  for (let k = 0; k < 3; k++) {
    num += (p[k] - a[k]) * (b[k] - a[k]);
    den += (b[k] - a[k]) ** 2;
  }
  const t = Math.min(1, Math.max(0, num / den));
  let d = 0;
  for (let k = 0; k < 3; k++) d += (p[k] - (a[k] + t * (b[k] - a[k]))) ** 2;
  return { t, d };
}

// The frame's coat ink: the commonest visible colour. Every frame here is mostly
// coat — the shadow layers are nothing but coat at varying alpha.
function coatOf(px) {
  const seen = new Map();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < ALPHA_FLOOR) continue;
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let best = 0, bestN = -1;
  for (const [key, n] of seen) if (n > bestN) { best = key; bestN = n; }
  return [(best >> 16) & 0xff, (best >> 8) & 0xff, best & 0xff];
}

// Grey or already black, decided on the frame's coat ink rather than on "does
// any pixel look greyish" — a line/pink blend passes straight through the old
// coat colour, and a test that fell for it would let a second run re-ink an
// already-black frame (its coat would clamp to the far end of the coat-line
// segment and come back out as the LINE colour, i.e. a grey cat again).
function reink(px) {
  const coat = coatOf(px);
  if (dist(coat, NIGHT_COAT) < SAME) return null;                 // already done
  if (dist(coat, DAY_COAT) >= SAME) throw new Error(
    `dominant colour rgb(${coat}) is neither the day coat nor the night black — ` +
    `not a frame of the day cat, or the artist has re-inked her`);

  const from = [coat, LINE, PINK];
  const to = [NIGHT_COAT, LINE, PINK];
  let touched = 0, worst = 0;
  const p = [0, 0, 0];
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < ALPHA_FLOOR) continue;
    p[0] = px[i]; p[1] = px[i + 1]; p[2] = px[i + 2];
    let best = null;
    for (const [x, y] of [[0, 1], [0, 2], [1, 2]]) {
      const { t, d } = project(p, from[x], from[y]);
      if (!best || d < best.d) best = { d, t, x, y };
    }
    worst = Math.max(worst, Math.sqrt(best.d));
    const A = to[best.x], B = to[best.y];
    for (let k = 0; k < 3; k++) px[i + k] = Math.round(A[k] + best.t * (B[k] - A[k]));
    touched++;
  }
  return { coat, touched, worst };
}

const check = process.argv.includes("--check");
let grey = 0;
for (const name of FRAMES) {
  const file = join(ART, name);
  const img = decode(readFileSync(file));
  let done;
  try {
    done = reink(img.px);
  } catch (err) {
    console.error(`  ${name}: ${err.message}`);
    process.exit(1);
  }
  if (!done) { console.log(`  ${name}: already black`); continue; }
  grey++;
  if (check) { console.log(`  ${name}: STILL GREY (coat rgb(${done.coat}))`); continue; }
  writeFileSync(file, encode(img));
  console.log(`  ${name}: rgb(${done.coat}) -> rgb(${NIGHT_COAT}), ` +
              `${done.touched} px, worst off-model pixel ${done.worst.toFixed(1)}/255`);
}
if (check && grey) {
  console.error(`${grey} frame(s) still carry the grey coat — run: node tools/hex/blacken-coat.mjs`);
  process.exit(1);
}
console.log(check ? "day coat is black" : "done");
