// build-03-animated.mjs — Piece 3: the animated code (every frame scans).
//
// A chunky black sitting-cat silhouette whose TAIL swishes across 10 frames.
// Head/body/eyes are byte-identical every frame (the figure must not boil);
// only the tail pose and the surrendered-noise ground change per frame. Each
// frame is solved independently at v6/L and re-scans with jsQR.
//
// Outputs (hex/wild-qr/out/):
//   animated.png            — APNG, 10 frames @ 100ms, looping
//   animated-frames/f0..f9.png
//   animated-contact.png    — 5x2 grid of frames
//   animated-report.md      — per-frame meter + round-trip results
//
// Run: node build-03-animated.mjs           (build everything)
//      node build-03-animated.mjs --preview (ASCII dump, no files)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import UPNG from "upng-js";
import { QRArt } from "./engine.mjs";
import { renderMatrix, writePNG, readPNG } from "./png.mjs";
import { verifyMatrix, scanRGBA } from "./verify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "out");
const FRAMES_DIR = path.join(OUT, "animated-frames");

const URL = "https://github.com/minigolf2000/cat-games";
const VERSION = 6;
const LEVEL = "L";
const S = QRArt.sizeOf(VERSION); // 41
const FRAMES = 10;
const DELAY_MS = 100;
const MASK = 3; // fixed across frames (see report); chosen empirically below.
// Flip budget 0: the pure Gauss-Jordan solve is already a valid codeword with
// ZERO RS errors, so keeping the budget at 0 gives full per-block headroom AND
// means no deliberate flips can disturb the figure across frames (constancy).
const MARGIN = 0;
const MARGIN_CAP = 0;
const RESTARTS = 6; // noise-only restarts (pins/headroom are seed-invariant here)
const SCALE = 8;
const QUIET = 4;

const fp = QRArt.functionPatterns(VERSION);

// ---------------------------------------------------------------------------
// Geometry helpers on the module grid. Module centers are integer (r,c).
// ---------------------------------------------------------------------------
const idx = (r, c) => r * S + c;
const inBounds = (r, c) => r >= 0 && c >= 0 && r < S && c < S;

// Filled ellipse test: point (r,c) inside ellipse centered (cr,cc) with
// half-axes (hr,hc).
function inEllipse(r, c, cr, cc, hr, hc) {
  const dr = (r - cr) / hr;
  const dc = (c - cc) / hc;
  return dr * dr + dc * dc <= 1;
}

// ---------------------------------------------------------------------------
// The cat silhouette (constant across frames).
// Sitting cat, front view: triangular ears with a notch, a narrow head, and a
// broad body mass grounded at the bottom of the symbol.
// ---------------------------------------------------------------------------
// The cat sits CENTER-RIGHT so the tail can swish in the high-rank left columns
// (0-14 are 100% pinnable; 15+ degrade; 32+ are frozen by the URL). CX (the cat
// centre column) trades body scratch-holes (grows as the body moves right into
// medium-rank columns) against tail room on the left; swept empirically.
const CX = Number(process.env.CX) || 16;
const HEAD = { cr: 13.0, cc: CX, hr: 5.0, hc: 4.7 }; // narrow head (width ~9)
const BODY = { cc: CX }; // body is a bell defined by a per-row half-width

// body half-width as a function of row (shoulders under the head -> broad base)
function bodyHalfWidth(r) {
  if (r < 16 || r > 38) return -1;
  // grows from ~5.6 at the shoulders to ~8.3 at the seated base (width ~11-17)
  const t = (r - 16) / (38 - 16);
  return 5.6 + t * 2.7;
}

function inBody(r, c) {
  const w = bodyHalfWidth(r);
  if (w < 0) return false;
  return Math.abs(c - BODY.cc) <= w;
}

function inHead(r, c) {
  return inEllipse(r, c, HEAD.cr, HEAD.cc, HEAD.hr, HEAD.hc);
}

// Two triangular ears rising off the head, with a clear notch between them.
// Left ear apex ~(6,11), right ear apex ~(6,19); bases meet the head near row 11.
const EAR_APEX = 2, EAR_BASE = 11; // tall pointy triangles between the finders
function inEars(r, c) {
  if (r < EAR_APEX || r > EAR_BASE) return false;
  const t = (EAR_BASE - r) / (EAR_BASE - EAR_APEX); // 0 at base -> 1 at apex
  // half-width shrinks linearly to a sharp apex
  const earHalf = 2.8 * (1 - t) + 0.4;
  // ears at CX∓3.5 -> clear notch at CX
  if (Math.abs(c - (CX - 3.5)) <= earHalf) return true;
  if (Math.abs(c - (CX + 3.5)) <= earHalf) return true;
  return false;
}

function inSilhouette(r, c) {
  return inHead(r, c) || inBody(r, c) || inEars(r, c);
}

// Two almond white eye cutouts in the head.
const EYES = [
  { cr: 12.8, cc: CX - 2.3, hr: 1.35, hc: 1.15 },
  { cr: 12.8, cc: CX + 2.3, hr: 1.35, hc: 1.15 },
];
function inEyes(r, c) {
  return EYES.some((e) => inEllipse(r, c, e.cr, e.cc, e.hr, e.hc));
}

// ---------------------------------------------------------------------------
// The tail — a solid 3-module-thick curve rising from the body's LEFT side (the
// high-rank left columns, where pins actually stick), drawn in a different pose
// per frame. The pose parameter is a smooth metronome:
// angle = AMP * sin(2π f / FRAMES), so frame 0 and the loop point match.
// It is long enough to rise above shoulder height at the sweep extremes.
// ---------------------------------------------------------------------------
const TAIL_BASE = { r: 30, c: CX - 6 }; // anchored on the body's lower-left (constant)
const TAIL_THICK = 1.05; // centerline half-thickness -> solid 3 modules

// The tail is a quadratic Bezier base -> control -> tip. The pose parameter
// s = sin(2π f/FRAMES) in [-1,1] sweeps the tip (and, at half rate, the mid
// control) so the whole stroke stays clearly LEFT of the body in every frame
// while the tip metronomes ~7 columns. The base is pinned; the tip rides high
// above shoulder height so the swish reads as a tail, not a leg.
const TIP_MID = { r: 10.5, c: CX - 11.7 }, TIP_SWING = { r: 0.6, c: 2.5 };
const CTL_MID = { r: 20.5, c: CX - 10.3 }, CTL_SWING = { r: 0.0, c: 1.3 };

// Dark modules for the tail at pose s in [-1,1]. Returns a Set of module idx.
function tailDarkAt(s) {
  const p0 = TAIL_BASE;
  const p1 = { r: CTL_MID.r + s * CTL_SWING.r, c: CTL_MID.c - s * CTL_SWING.c };
  const p2 = { r: TIP_MID.r + s * TIP_SWING.r, c: TIP_MID.c - s * TIP_SWING.c };
  const set = new Set();
  const N = 240;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const mt = 1 - t;
    const fr = mt * mt * p0.r + 2 * mt * t * p1.r + t * t * p2.r;
    const fc = mt * mt * p0.c + 2 * mt * t * p1.c + t * t * p2.c;
    const r0 = Math.floor(fr - 1.5);
    const c0 = Math.floor(fc - 1.5);
    for (let r = r0; r <= r0 + 3; r++) {
      for (let c = c0; c <= c0 + 3; c++) {
        if (!inBounds(r, c)) continue;
        const d = Math.hypot(r - fr, c - fc);
        if (d <= TAIL_THICK + 0.5) set.add(idx(r, c));
      }
    }
  }
  return set;
}

// Smooth looping metronome: s(f) = sin(2π f/FRAMES), frame 0 == loop point.
function frameAngle(f) {
  return Math.sin((2 * Math.PI * f) / FRAMES);
}

// Union of every tail pose (constant): the whole area the tail sweeps through.
function swingUnion() {
  const u = new Set();
  for (let f = 0; f < FRAMES; f++) {
    for (const mi of tailDarkAt(frameAngle(f))) u.add(mi);
  }
  return u;
}

// Dilate a set of module indices by 1 (Chebyshev) -> a 1-module halo.
function dilate1(set) {
  const out = new Set();
  for (const mi of set) {
    const r = (mi / S) | 0;
    const c = mi % S;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (inBounds(r + dr, c + dc)) out.add(idx(r + dr, c + dc));
      }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-frame target build. Priority order (highest first, i.e. painted first):
//   1. figure dark (head/body/ears)   -- constant
//   2. eyes white                     -- constant
//   3. current tail dark              -- varies
//   4. 1-module white halo around the current tail -- varies
// Figure+eyes get the highest priority so they are pinned first (within rank)
// and come out byte-identical every frame. The tail beats its own halo for
// rank, so the moving tail stays solid; the halo is a thin white outline that
// separates the dark tail from the shimmering noise ground in every pose.
// ---------------------------------------------------------------------------
// The constant white swing lane: the whole sweep area, dilated by 1, MINUS the
// figure (dark wins). Pinned white in every frame (constant region) so the dark
// tail always reads as black-on-white; the tail overrides it dark per frame.
const SWING = dilate1(dilate1(swingUnion())); // 2-module white margin around sweep
const FIGURE_DARK = (() => {
  const s = new Set();
  for (let r = 0; r < S; r++)
    for (let c = 0; c < S; c++) {
      if (fp.func[idx(r, c)]) continue;
      if (inSilhouette(r, c) && !inEyes(r, c)) s.add(idx(r, c));
    }
  return s;
})();
const EYES_WHITE = (() => {
  const s = new Set();
  for (let r = 0; r < S; r++)
    for (let c = 0; c < S; c++) {
      if (fp.func[idx(r, c)]) continue;
      if (inEyes(r, c)) s.add(idx(r, c));
    }
  return s;
})();

function buildFrameTarget(f) {
  const tone = new Int8Array(S * S); // 0 none, 1 dark, 2 white
  const seq = new Int32Array(S * S).fill(-1);
  let counter = 0;
  const paint = (mi, t) => {
    if (fp.func[mi]) return;
    if (tone[mi] !== 0) return; // first paint wins (priority)
    tone[mi] = t;
    seq[mi] = counter++;
  };
  // 1. figure dark
  for (const mi of FIGURE_DARK) paint(mi, 1);
  // 2. eyes white
  for (const mi of EYES_WHITE) paint(mi, 2);
  // 3. current tail dark
  const tail = tailDarkAt(frameAngle(f));
  for (const mi of tail) paint(mi, 1);
  // 4. constant white swing lane, everywhere the tail is NOT this frame
  for (const mi of SWING) if (!tail.has(mi) && !FIGURE_DARK.has(mi)) paint(mi, 2);

  const order = [];
  for (let i = 0; i < S * S; i++) if (tone[i] > 0 && !fp.func[i]) order.push(i);
  order.sort((a, b) => seq[a] - seq[b]);
  const target = new Uint8Array(S * S);
  for (const i of order) target[i] = tone[i] === 1 ? 1 : 0;
  return { order, target, seq, tail };
}

// ---------------------------------------------------------------------------
// Solve one frame: best-of RESTARTS by (pins satisfied desc, headroom desc).
// ---------------------------------------------------------------------------
function solveFrame(prep, f) {
  const { order, target, seq, tail } = buildFrameTarget(f);
  let best = null;
  for (let k = 0; k < RESTARTS; k++) {
    const noiseSeed = 0x51701 + f * 1000 + k;
    const flipSeed = 1 + f * 131 + k * 17;
    const res = QRArt.solveArt(prep, {
      order,
      target,
      seq,
      mask: MASK,
      margin: MARGIN,
      marginCap: MARGIN_CAP,
      noiseRng: QRArt.mulberry32(noiseSeed),
      flipSeed,
    });
    const satisfied = order.length - res.unsatisfied.length;
    const v = QRArt.validate(res.matrix, VERSION);
    const minHead = v.ok
      ? Math.min(...v.perBlock.map((b) => b.capacity - b.errors))
      : -1;
    const score = { satisfied, minHead, res, v, k, noiseSeed, flipSeed };
    if (
      !best ||
      score.satisfied > best.satisfied ||
      (score.satisfied === best.satisfied && score.minHead > best.minHead)
    ) {
      best = score;
    }
    // early out: everything pinned exactly and comfortable headroom
    if (satisfied === order.length && minHead >= 4) break;
  }
  best.order = order;
  best.tail = tail;
  // per-category unsatisfied breakdown
  const un = new Set(best.res.unsatisfied);
  let figUn = 0, eyeUn = 0, tailUn = 0, corrUn = 0;
  for (const mi of un) {
    if (FIGURE_DARK.has(mi)) figUn++;
    else if (EYES_WHITE.has(mi)) eyeUn++;
    else if (tail.has(mi)) tailUn++;
    else corrUn++;
  }
  best.breakdown = { figUn, eyeUn, tailUn, corrUn, tailTotal: tail.size };
  return best;
}

// ---------------------------------------------------------------------------
// ASCII preview (silhouette + a couple of tail poses), no solving.
// ---------------------------------------------------------------------------
function preview() {
  const glyph = (r, c, tailSet, haloSet) => {
    const mi = idx(r, c);
    if (fp.func[mi]) return "+";
    if (inEyes(r, c)) return "o";
    if (tailSet.has(mi)) return "#";
    if (inSilhouette(r, c)) return "@";
    if (haloSet.has(mi)) return ".";
    return " ";
  };
  for (const f of [0, 2, 5, 8]) {
    const tail = tailDarkAt(frameAngle(f));
    const halo = dilate1(tail);
    console.log(`\n=== frame ${f} (angle ${(frameAngle(f) * 180 / Math.PI).toFixed(1)}deg) ===`);
    let head = "   ";
    for (let c = 0; c < S; c++) head += c % 10;
    console.log(head);
    for (let r = 0; r < S; r++) {
      let line = String(r).padStart(2, " ") + " ";
      for (let c = 0; c < S; c++) line += glyph(r, c, tail, halo);
      console.log(line);
    }
  }
  console.log(`\nFIGURE_DARK ${FIGURE_DARK.size}  EYES ${EYES_WHITE.size}`);
}

// ---------------------------------------------------------------------------
// Contact sheet: 5x2 grid of the frame renders.
// ---------------------------------------------------------------------------
function contactSheet(frameImgs) {
  const cols = 5, rows = 2;
  const fw = frameImgs[0].width;
  const fh = frameImgs[0].height;
  const pad = 6;
  const W = cols * fw + (cols + 1) * pad;
  const H = rows * fh + (rows + 1) * pad;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  // light gray backdrop
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = 210; data[i * 4 + 1] = 210; data[i * 4 + 2] = 210; data[i * 4 + 3] = 255;
  }
  frameImgs.forEach((img, f) => {
    const gx = f % cols, gy = (f / cols) | 0;
    const ox = pad + gx * (fw + pad);
    const oy = pad + gy * (fh + pad);
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const src = (y * fw + x) * 4;
        const dst = ((oy + y) * W + (ox + x)) * 4;
        data[dst] = img.data[src];
        data[dst + 1] = img.data[src + 1];
        data[dst + 2] = img.data[src + 2];
        data[dst + 3] = 255;
      }
  });
  return { data, width: W, height: H };
}

// ---------------------------------------------------------------------------
// Main build.
// ---------------------------------------------------------------------------
function main() {
  if (process.argv.includes("--preview")) {
    preview();
    return;
  }
  if (process.argv.includes("--measure")) {
    const prep = QRArt.prepareArt(URL, VERSION, LEVEL, "schemehost");
    let figHoles = 0, tailWorst = 0, tailWorstPct = 0;
    const m0 = solveFrame(prep, 0).res.matrix;
    for (const mi of FIGURE_DARK) if (m0[mi] !== 1) figHoles++;
    for (const mi of EYES_WHITE) if (m0[mi] !== 0) figHoles++;
    for (let f = 0; f < FRAMES; f++) {
      const b = solveFrame(prep, f);
      const t = b.breakdown.tailUn, tot = b.breakdown.tailTotal;
      const pct = (100 * t) / tot;
      if (pct > tailWorstPct) { tailWorstPct = pct; tailWorst = `${t}/${tot}`; }
    }
    console.log(`CX=${CX}: figHoles ${figHoles}/${FIGURE_DARK.size + EYES_WHITE.size}, worst tail ${tailWorst} = ${tailWorstPct.toFixed(1)}%`);
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  const prep = QRArt.prepareArt(URL, VERSION, LEVEL, "schemehost");
  const matrices = [];
  const frameStats = [];

  for (let f = 0; f < FRAMES; f++) {
    const best = solveFrame(prep, f);
    const res = best.res;
    // acceptance: jsQR at scale 8 AND scale 3, allowing scheme+host case remix
    const vres = verifyMatrix(res.matrix, VERSION, URL, { allowSchemeHostCase: true });
    const perBlock = vres.perBlock.map((b) => ({
      used: b.errorsUsed,
      cap: b.capacity,
      head: b.capacity - b.errorsUsed,
    }));
    const minHead = Math.min(...perBlock.map((b) => b.head));
    matrices.push(res.matrix);
    frameStats.push({
      f,
      order: best.order.length,
      satisfied: best.satisfied,
      unsatisfied: res.unsatisfied.length,
      flips: res.flips.length,
      freeDim: res.freeDim,
      perBlock,
      minHead,
      restart: best.k,
      decoded8: vres.scales[0].decoded,
      decoded3: vres.scales[1].decoded,
      tailUn: best.breakdown.tailUn,
      tailTotal: best.breakdown.tailTotal,
      tailHolePct: (100 * best.breakdown.tailUn) / best.breakdown.tailTotal,
    });
    const bd = best.breakdown;
    console.log(
      `frame ${f}: pins ${best.satisfied}/${best.order.length}, flips ${res.flips.length}, minHead ${minHead}` +
        ` | unsat fig ${bd.figUn} eye ${bd.eyeUn} tail ${bd.tailUn}/${bd.tailTotal} corr ${bd.corrUn}`
    );
  }

  // --- Constancy check: figure+eyes byte-identical across frames? ---
  const figureIdx = [...FIGURE_DARK, ...EYES_WHITE];
  let boilCount = 0;
  const boilFrames = new Set();
  for (const mi of figureIdx) {
    const v0 = matrices[0][mi];
    for (let f = 1; f < FRAMES; f++) {
      if (matrices[f][mi] !== v0) { boilCount++; boilFrames.add(f); break; }
    }
  }
  // Full-matrix diff summary (which modules vary at all = the animated area).
  const varying = new Set();
  for (let mi = 0; mi < S * S; mi++) {
    const v0 = matrices[0][mi];
    for (let f = 1; f < FRAMES; f++) if (matrices[f][mi] !== v0) { varying.add(mi); break; }
  }
  // Furniture (function-pattern) constancy: must be identical across frames.
  let funcBoil = 0;
  for (let mi = 0; mi < S * S; mi++) {
    if (!fp.func[mi]) continue;
    const v0 = matrices[0][mi];
    for (let f = 1; f < FRAMES; f++) if (matrices[f][mi] !== v0) { funcBoil++; break; }
  }
  // Constant figure "scratch" holes: figure-dark modules that render light in
  // frame 0 (identical every frame since figure does not boil).
  let figHoles = 0;
  for (const mi of FIGURE_DARK) if (matrices[0][mi] !== 1) figHoles++;
  for (const mi of EYES_WHITE) if (matrices[0][mi] !== 0) figHoles++;

  // --- Render frames + write PNGs ---
  const frameImgs = matrices.map((m) => renderMatrix(m, VERSION, { scale: SCALE, quiet: QUIET }));
  frameImgs.forEach((img, f) => writePNG(path.join(FRAMES_DIR, `f${f}.png`), img));

  // --- Contact sheet ---
  const sheet = contactSheet(frameImgs);
  writePNG(path.join(OUT, "animated-contact.png"), sheet);

  // --- APNG encode ---
  const w = frameImgs[0].width, h = frameImgs[0].height;
  const buffers = frameImgs.map((img) =>
    Uint8Array.from(img.data).buffer
  );
  const dels = new Array(FRAMES).fill(DELAY_MS);
  // cnum=0 -> lossless truecolor (no palette quantization surprises)
  const apng = UPNG.encode(buffers, w, h, 0, dels);
  fs.writeFileSync(path.join(OUT, "animated.png"), Buffer.from(apng));

  // --- Round-trip: decode the APNG back to frames, assert each equals its
  // source render, then jsQR each extracted frame. ---
  const decoded = UPNG.decode(fs.readFileSync(path.join(OUT, "animated.png")));
  const rgbaFrames = UPNG.toRGBA8(decoded); // array of ArrayBuffers
  const roundTrip = [];
  for (let f = 0; f < FRAMES; f++) {
    const got = new Uint8ClampedArray(rgbaFrames[f]);
    const src = frameImgs[f].data;
    let pixelDiff = 0;
    for (let i = 0; i < src.length; i++) if (got[i] !== src[i]) pixelDiff++;
    const scan = scanRGBA({ data: got, width: w, height: h });
    roundTrip.push({ f, pixelDiff, scan });
  }

  // --- Report ---
  const lines = [];
  lines.push("# Piece 3 — animated code: build report\n");
  lines.push(`- URL: \`${URL}\` (v${VERSION}, level ${LEVEL}, urlCase schemehost)`);
  lines.push(`- ${FRAMES} frames @ ${DELAY_MS}ms, looping APNG via upng-js.`);
  lines.push(`  UPNG auto-picked a lossless 2-colour palette (round-trip is byte-exact,`);
  lines.push(`  see below), acTL num_plays = 0 (loops forever).`);
  lines.push(`- Mask **fixed at ${MASK}** across all frames; EC level fixed at ${LEVEL}.`);
  lines.push(`  Fixed mask chosen empirically: it keeps the figure byte-identical and`);
  lines.push(`  the furniture rock-steady (see furniture check). Varying the mask would`);
  lines.push(`  reseed the whole rendered field and risk visible boiling for no gain.`);
  lines.push(`- **Flip budget 0** (margin 0). The pure Gauss-Jordan solve is already a`);
  lines.push(`  valid codeword with zero RS errors, so every block keeps full headroom`);
  lines.push(`  (9/9) AND no deliberate flip can disturb the figure between frames.`);
  lines.push(`- Render: scale ${SCALE}, quiet ${QUIET}, black on white.`);
  lines.push(`- Restarts/frame: ${RESTARTS} (noise-only; pins/headroom are seed-invariant here).\n`);

  lines.push("## Constancy\n");
  lines.push(`- Figure (head/body/ears/eyes) pinned modules: ${figureIdx.length}`);
  lines.push(`- Figure modules that differ across frames: **${boilCount}** ` +
    `(${boilCount === 0 ? "byte-identical — figure does not boil" : "BOILING in frames " + [...boilFrames].join(",")})`);
  lines.push(`- Function-pattern (finder/timing/alignment) modules differing across frames: **${funcBoil}** ` +
    `(${funcBoil === 0 ? "furniture is rock-steady" : "FURNITURE FLICKER"})`);
  lines.push(`- Total modules that vary across frames (the animated tail + shimmer ground): ${varying.size}`);
  lines.push(`- Figure "ink scratch" holes (pins the right-side codeword rank can't`);
  lines.push(`  satisfy exactly): ${figHoles} of ${figureIdx.length} figure modules, **identical every`);
  lines.push(`  frame** (constant, so they read as scratchiness, not boiling).\n`);

  lines.push("## Per-frame acceptance meter\n");
  lines.push("| frame | pins | flips | per-block headroom | min head | jsQR@8 | jsQR@3 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const s of frameStats) {
    const hb = s.perBlock.map((b) => `${b.head}`).join(" / ");
    lines.push(
      `| ${s.f} | ${s.satisfied}/${s.order} | ${s.flips} | ${hb} | ${s.minHead} | ` +
        `${s.decoded8 ? "ok" : "FAIL"} | ${s.decoded3 ? "ok" : "FAIL"} |`
    );
  }
  lines.push("");
  lines.push("Per-block detail (used/cap):\n");
  for (const s of frameStats) {
    lines.push(`- f${s.f}: ` + s.perBlock.map((b) => `${b.used}/${b.cap}`).join("  "));
  }
  lines.push("");

  lines.push("## Round-trip (APNG decode -> compare to source render -> jsQR)\n");
  lines.push("| frame | pixel diff vs source | jsQR decode |");
  lines.push("| --- | --- | --- |");
  for (const rt of roundTrip) {
    lines.push(`| ${rt.f} | ${rt.pixelDiff} | ${rt.scan ? "ok" : "FAIL"} |`);
  }
  lines.push("");
  const allExact = roundTrip.every((r) => r.pixelDiff === 0);
  const allScan = roundTrip.every((r) => r.scan);
  lines.push(`- All frames decode byte-identical to source render: **${allExact}**`);
  lines.push(`- All extracted frames scan with jsQR: **${allScan}**`);
  lines.push("");
  lines.push("## Files\n");
  lines.push("- `out/animated.png` — APNG (10 frames, looping)");
  lines.push("- `out/animated-frames/f0..f9.png` — per-frame PNGs");
  lines.push("- `out/animated-contact.png` — 5x2 contact sheet");

  fs.writeFileSync(path.join(OUT, "animated-report.md"), lines.join("\n") + "\n");

  // --- Console summary ---
  console.log("\n=== SUMMARY ===");
  console.log(`figure boil modules: ${boilCount} (want 0)`);
  console.log(`animated area modules: ${varying.size}`);
  console.log(`round-trip byte-exact: ${allExact}, all jsQR: ${allScan}`);
  console.log(`min headroom over all frames: ${Math.min(...frameStats.map((s) => s.minHead))}`);
  console.log("wrote out/animated.png, out/animated-frames/, out/animated-contact.png, out/animated-report.md");
}

main();
