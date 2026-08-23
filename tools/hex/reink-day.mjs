#!/usr/bin/env node
// Re-inks Hex's DAY sheet to the colours she actually ships in.
//
// The artist draws the day cat grey-brown (#665B59) with a dark line (#302B2A);
// the night sheet draws the same cat black (#0C0B0A) with a white keyline. Hex
// is one black cat with white whiskers now, so the day sheet gets the night
// sheet's two inks: the coat falls to #0C0B0A and the drawn line — outline, ear
// rims, nose dashes, whiskers — goes to white. The inner-ear pink is the one ink
// that does not move.
//
//   node tools/hex/reink-day.mjs            # rewrite the day frames in place
//   node tools/hex/reink-day.mjs --check    # exit 1 if any frame is still raw
//
// The artist's sheet upstream is untouched; this is the transform, and it is how
// a fresh export gets re-inked. It reads each frame's CURRENT inks rather than
// assuming, so it converts a raw export and a half-converted one alike, and is a
// no-op on a frame that is already there.
//
// WHY A BAKE AND NOT A FILTER: a CSS/SVG filter would have to run on the cat
// every frame (she squashes on every pet, and the shadow layer deliberately
// carries no filter for exactly that reason — see index.html), and no single
// curve does the job anyway: the coat has to fall while the line RISES past it.
// Baking it into the pixels is free at runtime and is the same thing the artist
// would have done in Procreate.
//
// HOW: the day sheet is a THREE-INK drawing — coat, line, inner-ear pink — and
// every other pixel in it is an antialiased blend of two of those three. So each
// pixel is projected onto whichever of the three ink-pair segments it sits
// closest to, and re-mixed at the same ratio from the new inks. Measured
// residual off that model on hex-day.png: mean 0.15/255 — the drawing really is
// just these three inks.
//
// THE GATE is the one non-obvious part. Coat -> line spans 36 levels; black ->
// white spans 243, so the remap multiplies anything sitting between the two inks
// by nearly 7. The line's own antialiased rim SHOULD stretch like that — that is
// the soft edge of a white line. But the coat also carries the artist's brush
// texture, a scatter of pixels one to twenty levels off the flat fill in the
// middle of her face, and stretching THOSE turned her cheeks and chin into grey
// mottling. So a pixel only gets to carry line ink if it is within GATE px of a
// pixel that actually IS line ink; anywhere else it snaps to the flat coat.
// Radius 2 — 1 and 3 render identically on the whiskers, so the rim is fully
// covered and the gate is not clipping anything.
//
// Pixels with alpha < 8 are left exactly as exported: the day sheet carries a
// fringe of (0,0,0,1..6) pixels that are invisible on screen but would project
// past an ink endpoint and get re-coloured for no reason.

import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ART = join(dirname(fileURLToPath(import.meta.url)), "..", "..",
                 "apps", "hex-clicker", "public", "art");

// Every frame of the DAY cat: the resting coat and its cut-away ears, the three
// pet-squash frames, and the shadow layers (painted in coat colour outside her
// line, which is why they recolour with her — and why they carry no line ink of
// their own). hex-night.png is not here: it is where both new inks came from.
const FRAMES = [
  "hex-day.png", "hex-day-earL.png", "hex-day-earR.png",
  "hex-squash1.png", "hex-squash2.png", "hex-squash3.png",
  "hex-day-shadow.png",
  "hex-squash1-shadow.png", "hex-squash2-shadow.png", "hex-squash3-shadow.png",
];

const DAY_COAT = [102, 91, 89];   // the artist's day coat
const DAY_LINE = [48, 43, 42];    // the artist's drawn line
const COAT = [12, 11, 10];        // shipped: sampled off hex-night.png
const LINE = [255, 255, 255];     // shipped: the night sheet's keyline white
const PINK = [155, 113, 109];     // inner ear — the ink that does not move

const ALPHA_FLOOR = 8;   // below this a pixel is invisible; leave it as exported
const SAME = 24;         // "this frame is already inked in that"
const LINE_SHARE = 0.02; // a frame with fewer line pixels than this has no line
const GATE = 2;          // px a pixel may sit from real line ink and still carry it

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

// ---- reading a frame's current inks ----

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const at = (px, i) => [px[i], px[i + 1], px[i + 2]];

// The frame's coat ink: the commonest visible colour. Every frame here is mostly
// coat — the shadow layers are nothing but coat at varying alpha.
function coatOf(px) {
  const seen = new Map();
  let visible = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < ALPHA_FLOOR) continue;
    visible++;
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let best = 0, bestN = -1;
  for (const [key, n] of seen) if (n > bestN) { best = key; bestN = n; }
  return { coat: [(best >> 16) & 0xff, (best >> 8) & 0xff, best & 0xff], visible };
}

// The frame's line ink, or null for the shadow layers, which are pure coat. Both
// candidates are tried so a raw export and an already-white frame both read
// correctly — that is what makes this re-runnable.
function lineOf(px, visible) {
  let dark = 0, white = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < ALPHA_FLOOR) continue;
    const p = at(px, i);
    if (dist(p, DAY_LINE) < SAME) dark++;
    else if (dist(p, LINE) < SAME) white++;
  }
  const need = visible * LINE_SHARE;
  if (dark >= need && dark >= white) return { ink: DAY_LINE, done: false };
  if (white >= need) return { ink: LINE, done: true };
  return null;
}

// ---- the re-inking ----

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

// Which pixels are line ink, grown by GATE px — see THE GATE at the top. Two
// separable passes rather than a square kernel: a plus-shaped grow repeated GATE
// times, which is all the precision a 2px rim needs.
function lineNeighbourhood(px, w, h, coat, line) {
  let mask = new Uint8Array(w * h);
  for (let i = 0, n = 0; i < px.length; i += 4, n++) {
    if (px[i + 3] < ALPHA_FLOOR) continue;
    const p = at(px, i);
    if (dist(p, line) < dist(p, coat)) mask[n] = 1;
  }
  for (let r = 0; r < GATE; r++) {
    const next = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = y * w + x;
        next[n] = mask[n]
          || (x > 0 && mask[n - 1]) || (x < w - 1 && mask[n + 1])
          || (y > 0 && mask[n - w]) || (y < h - 1 && mask[n + w]) ? 1 : 0;
      }
    }
    mask = next;
  }
  return mask;
}

function reink({ w, h, px }) {
  const { coat, visible } = coatOf(px);
  const line = lineOf(px, visible);
  const coatDone = dist(coat, COAT) < SAME;
  if (coatDone && (!line || line.done)) return null;                // already there
  if (!coatDone && dist(coat, DAY_COAT) >= SAME) throw new Error(
    `dominant colour rgb(${coat}) is neither the day coat nor the shipped black — ` +
    `not a frame of the day cat, or the artist has re-inked her`);

  // Anchors, in the frame's current inks and in the shipped ones. A shadow layer
  // has no line, so it maps on the coat/pink pair alone.
  const from = [coat, PINK], to = [COAT, PINK];
  let lineIdx = -1;
  if (line) { lineIdx = from.length; from.push(line.ink); to.push(LINE); }
  const pairs = [];
  for (let i = 0; i < from.length; i++)
    for (let j = i + 1; j < from.length; j++) pairs.push([i, j]);

  const near = lineIdx < 0 ? null : lineNeighbourhood(px, w, h, coat, line.ink);

  let touched = 0, worst = 0, gated = 0;
  for (let i = 0, n = 0; i < px.length; i += 4, n++) {
    if (px[i + 3] < ALPHA_FLOOR) continue;
    const p = at(px, i);
    let best = null;
    for (const [x, y] of pairs) {
      const { t, d } = project(p, from[x], from[y]);
      if (!best || d < best.d) best = { d, t, x, y };
    }
    worst = Math.max(worst, Math.sqrt(best.d));
    // Brush texture in the middle of the coat is not the line's soft edge, and
    // must not be stretched into grey mottling: away from the line, snap to
    // whichever end of the pair is NOT the line.
    let t = best.t;
    if (lineIdx >= 0 && !near[n]) {
      if (best.y === lineIdx) { if (t > 0) gated++; t = 0; }
      else if (best.x === lineIdx) { if (t < 1) gated++; t = 1; }
    }
    const A = to[best.x], B = to[best.y];
    for (let k = 0; k < 3; k++) px[i + k] = Math.round(A[k] + t * (B[k] - A[k]));
    touched++;
  }
  return { coat, line: line?.ink ?? null, touched, gated, worst };
}

const check = process.argv.includes("--check");
let raw = 0;
for (const name of FRAMES) {
  const file = join(ART, name);
  const img = decode(readFileSync(file));
  let done;
  try {
    done = reink(img);
  } catch (err) {
    console.error(`  ${name}: ${err.message}`);
    process.exit(1);
  }
  if (!done) { console.log(`  ${name}: already re-inked`); continue; }
  raw++;
  if (check) { console.log(`  ${name}: NOT RE-INKED (coat rgb(${done.coat}))`); continue; }
  writeFileSync(file, encode(img));
  const line = done.line ? `line rgb(${done.line}) -> rgb(${LINE})` : "no line ink";
  console.log(`  ${name}: coat rgb(${done.coat}) -> rgb(${COAT}), ${line}, ` +
              `${done.touched} px (${done.gated} gated), ` +
              `worst off-model pixel ${done.worst.toFixed(1)}/255`);
}
if (check && raw) {
  console.error(`${raw} frame(s) still carry the artist's inks — run: node tools/hex/reink-day.mjs`);
  process.exit(1);
}
console.log(check ? "day sheet is re-inked" : "done");
