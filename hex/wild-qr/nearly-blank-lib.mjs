// nearly-blank-lib.mjs — shared helpers for the nearly-blank family of pieces.
//
// COPIED and generalized from build-01-nearly-blank.mjs (piece 1). build-01 keeps
// its own private copies of `line` / `safeMask` / `meterLine` / `flipSeedFor`;
// this module is imported by build-08-geometric.mjs ONLY. Divergence from build-01
// is intentional and fine — do not wire build-01 to this file.
//
// What lives here:
//   - line / circleOutline / arcOutline : Bresenham drawing primitives → a sink.
//   - safeMask   : block-aware white-pin classifier (piece 1's core insight).
//   - meterLine / flipSeedFor : reporting + deterministic flip-seed rotation.
//   - segmentStroke : cut an ordered module path into fixed-length chunks.
//   - solveDashed   : the "dashes not nibbles" solver core — a probe solve that
//                     measures per-segment satisfaction, sacrifices WHOLE
//                     under-satisfied outer segments (never single modules), then
//                     re-solves with the sacrificed segments pinned white so the
//                     misses land as an intentional dash rhythm. See build-08 for
//                     how each design feeds it.
import { QRArt } from "./engine.mjs";

// ---------------------------------------------------------------------------
// Drawing primitives (row, col) → sink(r, c). Copied from build-01.
// ---------------------------------------------------------------------------
export function line(r0, c0, r1, c1, sink) {
  let dr = Math.abs(r1 - r0), dc = Math.abs(c1 - c0);
  let sr = r0 < r1 ? 1 : -1, sc = c0 < c1 ? 1 : -1;
  let err = dr - dc, r = r0, c = c0;
  for (;;) {
    sink(r, c);
    if (r === r1 && c === c1) break;
    const e2 = 2 * err;
    if (e2 > -dc) { err -= dc; r += sr; }
    if (e2 < dr) { err += dr; c += sc; }
  }
}

// A 1-module-thick circle outline as an ORDERED path (angle 0..2π). Ordering
// matters: segmentStroke walks it so chunks are contiguous arcs.
export function circleOutline(cy, cx, radius, aStart = 0, aEnd = 360, step = null) {
  const pts = [];
  const seen = new Set();
  // angular step so consecutive samples are ~1 module apart on the circumference
  const dstep = step ?? Math.max(0.4, 57.2958 / Math.max(1, radius));
  for (let a = aStart; a <= aEnd + 1e-9; a += dstep) {
    const rad = (a * Math.PI) / 180;
    const rr = Math.round(cy + radius * Math.sin(rad));
    const cc = Math.round(cx + radius * Math.cos(rad));
    const k = rr * 1000 + cc;
    if (seen.has(k)) continue;
    seen.add(k);
    pts.push([rr, cc]);
  }
  return pts;
}

// Alias: an arc is just a partial circle outline.
export const arcOutline = circleOutline;

// ---------------------------------------------------------------------------
// Block-aware white-pin classifier (piece 1's insight). A field cell is "safe"
// to pin white iff its codeword lives in block 1 or is an EC codeword — those
// failures are absorbed by block 1's separate flip budget without spending the
// block-0 budget that the (frozen-URL-region) hero strokes need.
// ---------------------------------------------------------------------------
export function safeMask(prep, S) {
  const lay = prep.lay;
  const safe = new Uint8Array(S * S);
  for (let mi = 0; mi < S * S; mi++) {
    const bit = lay.moduleToBit[mi];
    if (bit < 0 || bit >= lay.totalCw * 8) { safe[mi] = 1; continue; } // remainder bits
    const info = lay.inter[bit >> 3];
    safe[mi] = info.isEC || info.block === 1 ? 1 : 0;
  }
  return safe;
}

// steerableMask — a cell is "steerable" if SOME free basis vector touches its
// codeword (i.e. a pad codeword in either block, an EC codeword, or a remainder
// bit). Setting such a cell costs solver RANK, not flip budget, so pinning the
// field white here never spends the block-0 flips the hero strokes need. This is
// the broadened version of piece 1's block-1/EC `safeMask`: it also reclaims
// block-0's own pad codewords (which piece 1 left as grey grain). Cells NOT
// steerable are the frozen URL codewords — left free, they read as paper grain.
export function steerableMask(prep, S) {
  const lay = prep.lay;
  const steer = new Set();
  for (const b of prep.bases) steer.add(b.byte); // codeword indices with a free bit
  const mask = new Uint8Array(S * S);
  for (let mi = 0; mi < S * S; mi++) {
    const bit = lay.moduleToBit[mi];
    if (bit < 0 || bit >= lay.totalCw * 8) { mask[mi] = 1; continue; } // remainder bits
    mask[mi] = steer.has(bit >> 3) ? 1 : 0;
  }
  return mask;
}

// True where the module's codeword is a frozen block-0 data codeword (the URL
// region + block-0 padding). Used only for reporting where dashes land.
export function block0Data(prep, S) {
  const lay = prep.lay;
  const b0 = new Uint8Array(S * S);
  for (let mi = 0; mi < S * S; mi++) {
    const bit = lay.moduleToBit[mi];
    if (bit < 0 || bit >= lay.totalCw * 8) continue;
    const info = lay.inter[bit >> 3];
    b0[mi] = !info.isEC && info.block === 0 ? 1 : 0;
  }
  return b0;
}

export function meterLine(perBlock) {
  return perBlock
    .map((b, i) => `blk${i}: ${b.errorsUsed ?? b.errors}/${b.capacity} used (${b.capacity - (b.errorsUsed ?? b.errors)} headroom)`)
    .join("\n  ");
}

export const flipSeedFor = (t) => (t === 0 ? 0 : (Math.imul(t, 2654435761) >>> 0) % 5000000);

// ---------------------------------------------------------------------------
// segmentStroke — cut an ordered module path into contiguous chunks of `segLen`
// modules (2–3). Deduplicates modules already claimed by an earlier stroke
// (via `claimed`) and splits a chunk if the path jumps (finder gap, clip), so a
// segment is always a run of adjacent modules. Returns array of {mods:[i,...]}.
// ---------------------------------------------------------------------------
export function segmentStroke(path, S, segLen, claimed, funcSet) {
  // path: array of [r,c]. Produce module indices, drop func/oob/claimed/dupe.
  const seq = [];
  const localSeen = new Set();
  for (const [r, c] of path) {
    if (r < 0 || c < 0 || r >= S || c >= S) { seq.push(null); continue; }
    const i = r * S + c;
    if (funcSet[i]) { seq.push(null); continue; }       // function cell → break run
    if (claimed.has(i)) { seq.push(null); continue; }   // already drawn → break run
    if (localSeen.has(i)) continue;                     // dupe within this stroke
    localSeen.add(i);
    seq.push(i);
  }
  // Break `seq` into maximal contiguous runs (null = break), then chop runs into
  // chunks of segLen. adjacency = Chebyshev distance 1.
  const segs = [];
  let run = [];
  const flushRun = () => {
    for (let k = 0; k < run.length; k += segLen) {
      const chunk = run.slice(k, k + segLen);
      // never leave a 1-module orphan trailing a run: merge it back if possible
      segs.push({ mods: chunk });
    }
    run = [];
  };
  let prev = null;
  for (const i of seq) {
    if (i === null) { flushRun(); prev = null; continue; }
    if (prev !== null) {
      const pr = (prev / S) | 0, pc = prev % S, rr = (i / S) | 0, cc = i % S;
      if (Math.max(Math.abs(pr - rr), Math.abs(pc - cc)) > 1) flushRun();
    }
    run.push(i);
    prev = i;
  }
  flushRun();
  // Merge trailing 1-orphan chunks into the previous chunk of the same run so a
  // dropped segment is always ≥2 modules (a real dash, not a nibble).
  for (let k = segs.length - 1; k > 0; k--) {
    if (segs[k].mods.length === 1) {
      const a = segs[k - 1].mods, b = segs[k].mods[0];
      const la = a[a.length - 1];
      const pr = (la / S) | 0, pc = la % S, rr = (b / S) | 0, cc = b % S;
      if (Math.max(Math.abs(pr - rr), Math.abs(pc - cc)) === 1) {
        a.push(b);
        segs.splice(k, 1);
      }
    }
  }
  claimForSegs(segs, claimed);
  return segs;
}

function claimForSegs(segs, claimed) {
  for (const s of segs) for (const i of s.mods) claimed.add(i);
}

// ---------------------------------------------------------------------------
// solveDashed — the taste-critical core.
//
// Input segments carry {mods, hero, prio}. Priority order for pinning:
//   hero segments (by prio) → outer segments (by prio) → field-white → done.
// A first PROBE solve pins every segment dark + the safe field white, then
// measures each OUTER segment's satisfaction. Whole outer segments that are not
// fully dark are SACRIFICED (never partially kept — that is the nibble we are
// avoiding). The RE-SOLVE pins hero + kept outer segments dark, pins the
// sacrificed segments' modules WHITE at high priority (clean dash gaps), then
// the safe field white. Because kept/hero segments are pinned first with equal-
// or-greater free rank than the probe, they stay fully satisfied; the misses
// become whole dropped 2–3-module segments — a dash rhythm.
//
// Returns the best (mask, flipSeed) config by: headroom≥2, then hero 100%, then
// stroke%, then whiteness — plus the sacrifice set and per-config metrics.
// ---------------------------------------------------------------------------
export function solveDashed(prep, opts) {
  const {
    S, segments, fieldWhiteSafe, center, funcSet,
    discCells = [],   // optional: modules pinned WHITE at high priority (build-01
                      // clean-disc technique). Innermost-first order recommended.
    masks = [0, 1, 2, 3, 4, 5, 6, 7],
    flipRestarts = 120, baseNoise = 12345,
    margin = 0.5, marginCap = 0.8,
  } = opts;

  const [cy, cx] = center;
  const d2 = (i) => { const r = (i / S) | 0, c = i % S; return (r - cy) * (r - cy) + (c - cx) * (c - cx); };

  // Static ordering of segments: hero first, then by prio, then by center dist.
  const segIdx = segments.map((_, k) => k);
  const segKey = (k) => {
    const s = segments[k];
    const cmods = s.mods.reduce((a, i) => a + d2(i), 0) / s.mods.length;
    return { hero: s.hero ? 0 : 1, prio: s.prio ?? 0, dist: cmods };
  };
  const cmp = (ka, kb) => {
    const A = segKey(ka), B = segKey(kb);
    return A.hero - B.hero || A.prio - B.prio || A.dist - B.dist;
  };
  const heroOrder = segIdx.filter((k) => segments[k].hero).sort(cmp);
  // Outer segments split into "active" (compete for budget) and "preDrop"
  // (a DESIGNED peripheral dissolve — whole segments the design chose to fade
  // out, e.g. the lattice thinning toward the frozen edges). preDrop segments
  // are sacrificed up front (pinned white), never probed.
  const outerActive = segIdx.filter((k) => !segments[k].hero && !segments[k].forceDrop).sort(cmp);
  const preDrop = segIdx.filter((k) => !segments[k].hero && segments[k].forceDrop);
  const outerOrder = outerActive;

  // Field-white modules (safe cells only), nearest-to-center first.
  const fieldMods = fieldWhiteSafe.slice().sort((a, b) => d2(a) - d2(b));

  // Build order/target/seq arrays. Priority: hero dark → CLEAN DISC white →
  // outer dark → sacrificed white (dash gaps) → field white. Placing the disc
  // right after the hero strokes (and before the outer strokes) is build-01's
  // trick: the disc's non-stroke cells win rank ahead of everything but the hero
  // drawing, so the disc stays speckle-free. When discCells is empty the order
  // reduces to hero→outer→white→field — identical to the pre-disc behaviour.
  const buildIO = (heroDark, outerDark, whiteSegs) => {
    const order = [];
    const target = new Uint8Array(S * S);
    const seq = new Int32Array(S * S).fill(-1);
    const push = (i, dark) => {
      if (seq[i] !== -1) return;            // already claimed by earlier pin
      order.push(i);
      target[i] = dark ? 1 : 0;
      seq[i] = order.length;
    };
    for (const k of heroDark) for (const i of segments[k].mods) push(i, true);
    for (const i of discCells) push(i, false);      // clean disc
    for (const k of outerDark) for (const i of segments[k].mods) push(i, true);
    for (const k of whiteSegs) for (const i of segments[k].mods) push(i, false);
    for (const i of fieldMods) push(i, false);
    return { order, target, seq };
  };

  const runSolve = (io, mask, flipSeed, noiseSeed) =>
    QRArt.solveArt(prep, {
      order: io.order, target: io.target, seq: io.seq, mask,
      margin, marginCap,
      noiseRng: QRArt.mulberry32(noiseSeed >>> 0),
      flipSeed,
    });

  // Segment fully dark in a matrix?
  const segDark = (matrix, k) => segments[k].mods.every((i) => matrix[i] === 1);

  let best = null;

  for (const mask of masks) {
    for (let t = 0; t < flipRestarts; t++) {
      const flipSeed = flipSeedFor(t);
      // --- PROBE: everything dark + disc/field white; measure segment satisfaction.
      const probeIO = buildIO(heroOrder, outerOrder, []);
      const probe = runSolve(probeIO, mask, flipSeed, baseNoise);
      if (probe.headroom < 2) continue;
      // Sacrifice whole outer segments that aren't fully dark, PLUS the designed
      // pre-drop (peripheral-dissolve) segments.
      const sacrificed = [...preDrop, ...outerOrder.filter((k) => !segDark(probe.matrix, k))];
      const keptOuter = outerOrder.filter((k) => segDark(probe.matrix, k));
      // --- RE-SOLVE: hero dark, disc white, kept dark, sacrificed white, field.
      const resIO = buildIO(heroOrder, keptOuter, sacrificed);
      const res = runSolve(resIO, mask, flipSeed, baseNoise);
      if (res.headroom < 2) continue;
      const m = measure(res.matrix, segments, heroOrder, funcSet, S, sacrificed, discCells);
      // Selection key: clean disc FIRST (zero speckle is a hard art gate), then
      // maximize hero satisfaction (continuously), then stroke%, then whiteness.
      const key = -m.discDark * 1e12 + m.heroSat * 1e9 + m.strokeSat * 1e3 + m.whiteness * 1;
      if (!best || key > best.key) {
        best = { key, mask, flipSeed, sacrificed, keptOuter, m };
      }
    }
  }

  return {
    best, buildIO, runSolve, heroOrder, outerOrder, fieldMods,
    measure: (mat, sac) => measure(mat, segments, heroOrder, funcSet, S, sac, discCells),
  };
}

// Per-config metrics over the drawn geometry.
export function measure(matrix, segments, heroSegKeys, funcSet, S, sacrificed, discCells = []) {
  const heroSet = new Set(heroSegKeys);
  // "Active" strokes = the drawn line (hero + non-faded outer). Designed-fade
  // segments (forceDrop) are intentional negative space and are excluded from
  // the stroke denominator — they are not misses.
  let strokeTot = 0, strokeSatN = 0, heroTot = 0, heroSatN = 0;
  const droppedSegs = [], fadedSegs = [];
  segments.forEach((s, k) => {
    let darkN = 0;
    for (const i of s.mods) if (matrix[i] === 1) darkN++;
    if (s.forceDrop) { fadedSegs.push({ k, mods: s.mods, len: s.mods.length }); return; }
    strokeTot += s.mods.length;
    strokeSatN += darkN;
    if (heroSet.has(k)) { heroTot += s.mods.length; heroSatN += darkN; }
    if (darkN < s.mods.length) droppedSegs.push({ k, mods: s.mods, darkN, len: s.mods.length, hero: heroSet.has(k) });
  });
  // gapDark: modules inside SACRIFICED segments that came out dark anyway (a
  // stray within an intended gap — the one nibble risk; report it).
  let gapDark = 0, gapTot = 0;
  const sacSet = new Set(sacrificed || []);
  segments.forEach((s, k) => {
    if (!sacSet.has(k)) return;
    for (const i of s.mods) { gapTot++; if (matrix[i] === 1) gapDark++; }
  });
  // discDark: clean-disc speckle. A disc cell is pinned white unless it is a
  // hero-stroke cell (hero pins before the disc). Any non-hero disc cell that is
  // dark is speckle — the build-01 gate wants this at 0.
  let discDark = 0, discTot = 0;
  if (discCells.length) {
    const heroMods = new Set();
    for (const k of heroSegKeys) for (const i of segments[k].mods) heroMods.add(i);
    for (const i of discCells) {
      if (heroMods.has(i)) continue;
      discTot++;
      if (matrix[i] === 1) discDark++;
    }
  }
  let nfTot = 0, nfLight = 0;
  for (let i = 0; i < S * S; i++) { if (funcSet[i]) continue; nfTot++; if (matrix[i] === 0) nfLight++; }
  return {
    strokeTot, strokeSatN, strokeSat: strokeTot ? strokeSatN / strokeTot : 1,
    heroTot, heroSatN, heroSat: heroTot ? heroSatN / heroTot : 1,
    droppedSegs, fadedSegs, gapDark, gapTot,
    discDark, discTot,
    whiteness: nfLight / nfTot, nfLight, nfTot,
    sacrificedCount: sacSet.size,
  };
}
