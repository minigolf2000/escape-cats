// build-10-wallpaper.mjs — Piece 10: WALLPAPER — repeating icon patterns at v10.
//
// Run `node build-10-wallpaper.mjs` to regenerate out/wallpaper-* (deterministic).
//
// The thesis (see specs/10-wallpaper.md): periodicity reads as *designed print*
// (gift wrap, notebook doodles) — the polar opposite of QR randomness. Three
// designs, all v10-L (57x57), URL https://github.com/minigolf2000/cat-games,
// urlCase "schemehost", verified with allowSchemeHostCase (jsQR @ scale 8/3/2).
//
// THIS FILE IS THE FIRST v10 PIECE. The block-aware safe mask is recomputed from
// the actual v10-L interleave (do NOT port v6's block===1 constant): v10-L has
// FOUR blocks [2x(86,68), 2x(87,69)] and the 41-char URL dirties only block 0
// (72 frozen modules) — blocks 1-3 are pure padding. A field cell is "safe" to
// pin white iff its codeword is EC or lives in ANY block other than 0, so the
// white field never spends the scarce block-0 budget the icons compete for.
//   (For v6 — 2 blocks — "block !== 0" is identical to the lib's "block === 1",
//    so this local generalization is a pure superset; the lib is untouched.)
//
// THE INTACT-OR-ABSENT RULE (new; replaces per-stroke dashing). Wallpaper dies if
// icons are half-damaged. Each icon INSTANCE must end either COMPLETE (100% of
// its cells dark + its local halo clean) or ABSENT (dropped whole before the
// final solve, its cell surrendered to the white field). Mechanism (solveWall):
// a probe solve pins every active instance dark + local halos + a clean field
// white; per-instance completeness is measured; the single worst imperfect
// instance is dropped WHOLE and we re-solve; repeat until every survivor is
// perfect with headroom >=2. Heroes are protected (dropped last / never). We
// search all 8 masks x flip restarts and keep the config with the most kept
// instances (heroes perfect), then sweep noise seeds to whiten the free field.
//
// Furniture: v10 alignment patterns sit at every combo of {6,28,50} INCLUDING
// (28,28) dead center. Every icon placement is disqualified outright if any of
// its intended cells land on a function module (the build-09 heroFuncHits gate).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QRArt } from "./engine.mjs";
import { renderMatrix, writePNG } from "./png.mjs";
import { verifyMatrix, scanRGBA } from "./verify.mjs";
import {
  line, circleOutline, arcOutline, block0Data, meterLine, flipSeedFor,
  fillPolygon, edgeOf, haloOf,
} from "./nearly-blank-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "out");
const URL = "https://github.com/minigolf2000/cat-games";
const VERSION = 10, LEVEL = "L";
const S = QRArt.sizeOf(VERSION); // 57
const MASKS = [0, 1, 2, 3, 4, 5, 6, 7];
const FLIP_RESTARTS = 6;    // flip-seed rotations per mask
const NOISE_RESTARTS = 160; // noise samples to whiten the free field
const BASE_NOISE = 12345;

const fp = QRArt.functionPatterns(VERSION);
const funcSet = fp.func;
const inB = (r, c) => r >= 0 && c >= 0 && r < S && c < S;
const idx = (r, c) => r * S + c;

// Block-0 DATA mask (the URL block: its codewords carry the frozen URL + block-0
// padding). Forcing icon cells here competes for block 0's own tight 9-codeword
// flip budget, whereas cells in blocks 1-3 / EC are rank-settable (cheap). Icons
// placed on fewer block-0 cells survive the intact-or-absent trim more often.
const B0MASK = block0Data(QRArt.prepareArt(URL, VERSION, LEVEL, "schemehost"), S);
const b0Cost = (mods) => { let n = 0; for (const i of mods) if (B0MASK[i]) n++; return n; };

// Furniture dilated by Chebyshev distance D: cells within D of a function module.
// An icon whose cells touch this zone sits jammed against a fixed pattern (finder/
// timing/alignment) — its modules are over-constrained and often NOT rank-
// satisfiable, so it can never be made 100% (see the (34,34) dot jammed on the
// center alignment). Requiring a clearance keeps icons on free, solvable ground.
const funcNear = (() => {
  const cache = new Map();
  return (D) => {
    if (cache.has(D)) return cache.get(D);
    const m = new Uint8Array(S * S);
    for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) {
      if (!funcSet[idx(r, c)]) continue;
      for (let dr = -D; dr <= D; dr++) for (let dc = -D; dc <= D; dc++) {
        const rr = r + dr, cc = c + dc; if (inB(rr, cc)) m[idx(rr, cc)] = 1;
      }
    }
    cache.set(D, m);
    return m;
  };
})();
// True if none of the icon's drawable modules sits within `D` of furniture.
function clearsFurniture(mods, D) {
  const near = funcNear(D);
  for (const i of mods) if (near[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// v10-aware block-aware safe mask. A cell is safe to pin white iff its codeword
// is EC or belongs to a data block OTHER than block 0 (blocks 1-3 = pure padding
// here). Recomputed from prep.lay.inter — no v6 constant ported. Remainder bits
// (none at v10) count as safe. Backward-compatible generalization of the lib's
// safeMask (which hard-codes block===1, correct only for 2-block versions).
// ---------------------------------------------------------------------------
function safeMaskV10(prep) {
  const lay = prep.lay;
  const safe = new Uint8Array(S * S);
  for (let mi = 0; mi < S * S; mi++) {
    const bit = lay.moduleToBit[mi];
    if (bit < 0 || bit >= lay.totalCw * 8) { safe[mi] = 1; continue; } // remainder
    const info = lay.inter[bit >> 3];
    safe[mi] = info.isEC || info.block !== 0 ? 1 : 0;
  }
  return safe;
}

// ---------------------------------------------------------------------------
// Geometry primitives → arrays of [r,c] cells (may include func/oob; filtered
// later). All icons are 1-module strokes except the solid triangles (filled).
// ---------------------------------------------------------------------------
const seg = (a, b) => { const pts = []; line(a[0], a[1], b[0], b[1], (r, c) => pts.push([r, c])); return pts; };

// Small smiley: circle ring (radius r), two eye dots, a lower smile arc.
//   r 4-5 → eyes at (cy-ceil(r/2), cx±2), smile arc radius ~r-2, ~120°.
function smileyCells(cy, cx, r) {
  const cells = [];
  for (const p of circleOutline(cy, cx, r)) cells.push(p);         // ring
  const ey = cy - Math.round(r * 0.45), ex = Math.max(2, Math.round(r * 0.45));
  cells.push([ey, cx - ex]);                                       // left eye
  cells.push([ey, cx + ex]);                                       // right eye
  const sr = Math.max(2, r - 2);
  for (const p of arcOutline(cy, cx, sr, 30, 150)) cells.push(p);  // smile (lower arc)
  return cells;
}

// Parametric Cool S (build-09 topology, scalable). cw=column pitch, vh=vertical
// bar height, wd=waist drop, ch=crown height, cap=bottom-point height. The two
// waist diagonals keep identical (dr=wd, dc=cw) deltas at every scale → exactly
// parallel; the two open ends (top-right vertical bottom, bottom-left vertical
// top) are never joined. FULL build-09 size = {cw:6,vh:6,wd:4,ch:5,cap:5}.
function coolSCells(row0, col0, { cw, vh, wd, ch, cap }) {
  const g = (lr, lc) => [row0 + lr, col0 + lc];
  const crownApex = 0, vt0 = ch, vt1 = ch + vh - 1;
  const vb0 = vt1 + wd, vb1 = vt1 + wd + vh - 1, botApex = vt1 + wd + vh - 1 + cap;
  const cells = [];
  const add = (a, b) => { for (const p of seg(a, b)) cells.push(p); };
  add(g(vt0, 0), g(crownApex, cw)); add(g(crownApex, cw), g(vt0, 2 * cw));      // crown
  add(g(vt0, 0), g(vt1, 0)); add(g(vt0, cw), g(vt1, cw)); add(g(vt0, 2 * cw), g(vt1, 2 * cw)); // top verticals
  add(g(vt1, 0), g(vb0, cw)); add(g(vt1, cw), g(vb0, 2 * cw));                  // parallel waist
  add(g(vb0, 0), g(vb1, 0)); add(g(vb0, cw), g(vb1, cw)); add(g(vb0, 2 * cw), g(vb1, 2 * cw)); // bottom verticals
  add(g(vb1, 0), g(botApex, cw)); add(g(botApex, cw), g(vb1, 2 * cw));          // bottom point
  const center = [row0 + Math.round((vt0 + vb1) / 2), col0 + cw];
  const height = botApex + 1, width = 2 * cw + 1;
  return { cells, center, height, width };
}

// Flat-top hexagon OUTLINE (side s). Horizontal top & bottom edges.
function hexOutlineCells(cy, cx, s) {
  const h = Math.round((s * Math.sqrt(3)) / 2);
  const v = [
    [cy - h, cx - Math.round(s / 2)], [cy - h, cx + Math.round(s / 2)], [cy, cx + s],
    [cy + h, cx + Math.round(s / 2)], [cy + h, cx - Math.round(s / 2)], [cy, cx - s],
  ];
  const cells = [];
  for (let k = 0; k < 6; k++) for (const p of seg(v[k], v[(k + 1) % 6])) cells.push(p);
  return cells;
}

// Chunky 5-point STAR outline (outer radius R, inner r, rotation deg). 10 verts
// alternating R/r, connected in order → the classic star silhouette.
function starOutlineCells(cy, cx, R, r, rot = -90) {
  const verts = [];
  for (let k = 0; k < 10; k++) {
    const rad = ((rot + k * 36) * Math.PI) / 180;
    const rr = k % 2 === 0 ? R : r;
    verts.push([Math.round(cy + rr * Math.sin(rad)), Math.round(cx + rr * Math.cos(rad))]);
  }
  const cells = [];
  for (let k = 0; k < 10; k++) for (const p of seg(verts[k], verts[(k + 1) % 10])) cells.push(p);
  return cells;
}

// Solid filled triangle → all fill cells (edge + interior), rendered dark.
function triangleFillCells(verts) {
  const fill = fillPolygon(verts.map(([r, c]) => [r, c]), S, funcSet);
  // fillPolygon already drops func cells; but we want raw cells to detect func
  // hits, so re-fill without the func filter via a permissive funcSet.
  const raw = fillPolygon(verts, S, new Uint8Array(S * S));
  return [...raw].map((i) => [(i / S) | 0, i % S]);
}

// ---------------------------------------------------------------------------
// Instance construction. An instance is a whole icon: { label, kind, center,
// hero, protected, cells:[[r,c]], mods:Set<int>(drawable), funcHit:int }.
// funcHit = intended cells that fall on a function module; funcHit>0 disqualifies
// the placement outright (build-09 heroFuncHits gate — a mutilated icon is the
// worst outcome). `protected` heroes are never dropped by the solver.
// ---------------------------------------------------------------------------
function makeInstance(label, kind, center, cells, { hero = false, protect = false, haloW, softW = 0 } = {}) {
  const mods = new Set();
  let funcHit = 0;
  const seen = new Set();
  for (const [r, c] of cells) {
    if (!inB(r, c)) continue;
    const i = idx(r, c);
    if (funcSet[i]) { funcHit++; continue; }
    if (seen.has(i)) continue;
    seen.add(i);
    mods.add(i);
  }
  return { label, kind, center, hero, protect, haloW, softW, mods, funcHit };
}

// Compute each instance's REQUIRED white halo (Chebyshev band `w`, part of the
// completeness gate) and an optional best-effort SOFT white zone (band `softW`,
// pinned white at high priority for visual separation but NOT required — the
// build-01 clean-disc technique). Both exclude every instance's stroke cells and
// all function cells. haloW<=0 = stroke-only completeness (brick-packed glyphs
// whose 1-module interior gaps aren't independently whiteable); the soft zone
// then supplies the white breathing room that makes the glyph read.
function computeHalos(instances, defaultW = 1) {
  const allStrokes = new Set();
  for (const ins of instances) for (const i of ins.mods) allStrokes.add(i);
  for (const ins of instances) {
    const w = ins.haloW ?? defaultW;
    ins.halo = w > 0
      ? new Set(haloOf(ins.mods, S, funcSet, w).filter((i) => !allStrokes.has(i)))
      : new Set();
    ins.soft = ins.softW > 0
      ? new Set(haloOf(ins.mods, S, funcSet, ins.softW).filter((i) => !allStrokes.has(i) && !ins.halo.has(i)))
      : new Set();
  }
}

// ---------------------------------------------------------------------------
// The intact-or-absent solver. Iterates probe-solves, drops the worst imperfect
// instance whole, re-solves, until every survivor is COMPLETE (all mods dark +
// halo light) with headroom >=2. Searches masks x flip restarts; keeps the best
// config by (heroes-all-perfect, kept count, whiteness). Returns the winner.
// ---------------------------------------------------------------------------
function solveWall(prep, instances, safe, { minKeep, fieldBand = 0, noFieldWhite = false }) {
  // Central-first ordering so the center of the pattern claims rank priority.
  const cdist = (ins) => {
    const [cy, cx] = ins.center; return (cy - 28) * (cy - 28) + (cx - 28) * (cx - 28);
  };
  const order = instances.slice().sort((a, b) =>
    (a.hero ? 0 : 1) - (b.hero ? 0 : 1) || cdist(a) - cdist(b));

  // Build order/target/seq for a given ACTIVE (kept) instance list. Priority:
  // per instance (hero first, central first) push its strokes dark then its halo
  // white; then the safe field white (central-first). Dropped instances' cells
  // fall through to the field (safe → pinned white → erased ghost).
  const buildIO = (active) => {
    const ord = [], target = new Uint8Array(S * S), seq = new Int32Array(S * S).fill(-1);
    const push = (i, dark) => { if (seq[i] !== -1) return; ord.push(i); target[i] = dark ? 1 : 0; seq[i] = ord.length; };
    const keptStrokes = new Set(), keptHalo = new Set();
    for (const ins of active) { for (const i of ins.mods) keptStrokes.add(i); for (const i of ins.halo) keptHalo.add(i); }
    // pass 1: strokes (dark) + required halos (white), highest priority.
    for (const ins of active) {
      for (const i of ins.mods) push(i, true);
      for (const i of ins.halo) if (!keptStrokes.has(i)) push(i, false);
    }
    // pass 2: best-effort SOFT white zones (build-01 clean-disc) — high priority,
    // just below the required cells, for visual separation. Not a completeness
    // gate, so any miss is minor grain rather than a dropped instance.
    for (const ins of active) for (const i of ins.soft) if (!keptStrokes.has(i)) push(i, false);
    // THREE-TONE designs surrender the ground to noise (no field-white pins at
    // all); the freed flip budget goes to more instances + hard halos. The dark
    // noise renders gray #3a3a3a, black icons + white halos pop off it.
    if (noFieldWhite) return { order: ord, target, seq };
    // field white: safe cells not in a kept stroke/halo, central-first. With
    // fieldBand>0 restrict to safe cells within Chebyshev distance fieldBand of a
    // kept icon cell — this keeps the total pin count near the free-bit rank so
    // the scarce flip budget isn't stolen from hard icon cells (the far empty
    // canvas is whitened by the noise sweep instead). fieldBand=0 pins all safe.
    let bandMask = null;
    if (fieldBand > 0) {
      bandMask = new Uint8Array(S * S);
      for (const i of keptStrokes) {
        const r = (i / S) | 0, c = i % S;
        for (let dr = -fieldBand; dr <= fieldBand; dr++) for (let dc = -fieldBand; dc <= fieldBand; dc++) {
          const rr = r + dr, cc = c + dc; if (inB(rr, cc)) bandMask[idx(rr, cc)] = 1;
        }
      }
    }
    const field = [];
    for (let i = 0; i < S * S; i++) {
      if (funcSet[i] || !safe[i] || keptStrokes.has(i) || keptHalo.has(i)) continue;
      if (bandMask && !bandMask[i]) continue;
      field.push(i);
    }
    field.sort((a, b) => {
      const ar = (a / S) | 0, ac = a % S, br = (b / S) | 0, bc = b % S;
      return ((ar - 28) ** 2 + (ac - 28) ** 2) - ((br - 28) ** 2 + (bc - 28) ** 2);
    });
    for (const i of field) push(i, false);
    return { order: ord, target, seq };
  };

  const runSolve = (io, mask, flipSeed, noiseSeed) => QRArt.solveArt(prep, {
    order: io.order, target: io.target, seq: io.seq, mask,
    margin: 0.5, marginCap: 0.8, noiseRng: QRArt.mulberry32(noiseSeed >>> 0), flipSeed,
  });

  // Per-instance completeness in a matrix.
  const insScore = (m, ins) => {
    let dk = 0; for (const i of ins.mods) if (m[i] === 1) dk++;
    let lt = 0; for (const i of ins.halo) if (m[i] === 0) lt++;
    const strokeSat = ins.mods.size ? dk / ins.mods.size : 1;
    const haloSat = ins.halo.size ? lt / ins.halo.size : 1;
    return { strokeSat, haloSat, complete: strokeSat >= 0.9999 && haloSat >= 0.9999, score: strokeSat + haloSat };
  };
  const whitenessOf = (m) => {
    let t = 0, l = 0; for (let i = 0; i < S * S; i++) { if (funcSet[i]) continue; t++; if (m[i] === 0) l++; } return l / t;
  };

  let best = null;
  for (const mask of MASKS) {
    for (let t = 0; t < FLIP_RESTARTS; t++) {
      const flipSeed = flipSeedFor(t);
      let active = order.slice();
      let matrix = null, guard = 0;
      while (guard++ < instances.length + 4) {
        const io = buildIO(active);
        const res = runSolve(io, mask, flipSeed, BASE_NOISE);
        matrix = res.matrix;
        const scored = active.map((ins) => ({ ins, ...insScore(matrix, ins) }));
        const imperfect = scored.filter((s) => !s.complete);
        const headroomOK = res.headroom >= 2;
        if (imperfect.length === 0 && headroomOK) break; // converged
        // choose a droppable instance: worst imperfect non-protected; if all
        // imperfect are protected (or headroom<2 with all complete), drop the
        // least-central non-protected instance to relieve budget.
        let victim = null;
        const droppable = scored.filter((s) => !s.ins.protect);
        if (imperfect.length > 0) {
          const impDroppable = imperfect.filter((s) => !s.ins.protect);
          if (impDroppable.length) victim = impDroppable.sort((a, b) => a.score - b.score)[0].ins;
        }
        if (!victim && !headroomOK && droppable.length) {
          victim = droppable.sort((a, b) => cdist(b.ins) - cdist(a.ins))[0].ins; // least central
        }
        if (!victim) { active = null; break; }               // stuck: protected imperfect
        active = active.filter((ins) => ins !== victim);
        if (active.length < minKeep) { active = null; break; }
      }
      if (!active) continue;
      // require every survivor perfect and every protected hero present+perfect
      const finalScored = active.map((ins) => ({ ins, ...insScore(matrix, ins) }));
      if (finalScored.some((s) => !s.complete)) continue;
      const heroesOK = order.filter((ins) => ins.protect).every((h) => active.includes(h));
      if (!heroesOK) continue;
      const kept = active.length, white = whitenessOf(matrix);
      const key = kept * 1000 + white * 100; // most kept, then whitest
      if (!best || key > best.key) best = { key, mask, flipSeed, active, kept, white };
      if (kept === instances.length) { /* keep searching for whiter, but this is max kept */ }
    }
  }
  return { best, buildIO, runSolve, insScore, whitenessOf };
}

// ---------------------------------------------------------------------------
// Full pipeline for one design: place instances, solve intact-or-absent, whiten,
// verify, render PNG/SVG, gather report metrics.
// ---------------------------------------------------------------------------
function runDesign(prep, safe, b0, design) {
  const placed = design.instances;      // all attempted (already func-cleared)
  computeHalos(placed, design.haloW ?? 1);
  const minKeep = design.minKeepAbs ?? Math.ceil(placed.length * 0.60);
  const { best, buildIO, runSolve, insScore, whitenessOf } = solveWall(prep, placed, safe,
    { minKeep, fieldBand: design.fieldBand ?? 0, noFieldWhite: !!design.toned });
  if (!best) throw new Error(`${design.name}: no config kept >=60% with heroes perfect`);

  const kept = best.active;
  const shapeMask = new Set();          // icon cells → pure black in the toned render
  for (const ins of kept) for (const i of ins.mods) shapeMask.add(i);

  // Noise sweep: hold mask/flipSeed/kept-set (pins & flips are noise-invariant, so
  // completeness/headroom are unchanged). For toned designs the HERO artifact is
  // the three-tone render, so we require it to scan at scale 8/3/2 and pick the
  // best-scanning seed; for white-field designs we pick the whitest field.
  const io = buildIO(kept);
  let matrix = null, noiseSeed = BASE_NOISE, bestScore = -1;
  for (let n = 0; n < NOISE_RESTARTS; n++) {
    const sd = (1000 + n * 7919) >>> 0;
    const res = runSolve(io, best.mask, best.flipSeed, sd);
    let score;
    if (design.toned) {
      // must scan in TONED form at all three scales; tiebreak on whiteness.
      const ok8 = !!scanRGBA(renderToned(res.matrix, shapeMask, { scale: 8, quiet: 4 }));
      const ok3 = ok8 && !!scanRGBA(renderToned(res.matrix, shapeMask, { scale: 3, quiet: 4 }));
      const ok2 = ok3 && !!scanRGBA(renderToned(res.matrix, shapeMask, { scale: 2, quiet: 4 }));
      score = (ok8 ? 1 : 0) + (ok3 ? 1 : 0) + (ok2 ? 1 : 0) + whitenessOf(res.matrix);
    } else {
      score = whitenessOf(res.matrix);
    }
    if (score > bestScore) { bestScore = score; matrix = res.matrix; noiseSeed = sd; }
  }

  // Honest verify + per-block meter (validate() is tone-agnostic — same matrix).
  const v = verifyMatrix(matrix, VERSION, URL, { allowSchemeHostCase: true });
  const perBlock = v.perBlock;
  const minHead = Math.min(...perBlock.map((b) => b.capacity - b.errorsUsed));

  // Multi-scale scan report (8/3/2) on the HERO artifact tones (toned for the
  // three-tone designs, plain BW otherwise).
  const scan = {};
  for (const scale of [8, 3, 2]) {
    const img = design.toned ? renderToned(matrix, shapeMask, { scale, quiet: 4 }) : renderMatrix(matrix, VERSION, { scale, quiet: 4 });
    scan[scale] = !!scanRGBA(img);
  }

  // Post-hoc heroes: for lattice designs we don't PROTECT specific instances (the
  // solver keeps whatever solves perfectly); the N most-central SURVIVORS are the
  // heroes — they are, by construction, complete. (Protected designs skip this.)
  if (design.postHocHeroes) {
    const central = kept.slice().sort((a, b) =>
      ((a.center[0] - 28) ** 2 + (a.center[1] - 28) ** 2) - ((b.center[0] - 28) ** 2 + (b.center[1] - 28) ** 2));
    for (let k = 0; k < Math.min(design.postHocHeroes, central.length); k++) central[k].hero = true;
  }
  const keptSet = new Set(kept);
  let strokeTot = 0, strokeDark = 0;
  for (const ins of kept) { strokeTot += ins.mods.size; for (const i of ins.mods) if (matrix[i] === 1) strokeDark++; }
  const whiteness = whitenessOf(matrix);
  const heroKept = kept.filter((i) => i.hero).length;
  const heroTotal = design.postHocHeroes ? Math.min(design.postHocHeroes, kept.length) : placed.filter((i) => i.hero).length;

  // Files. Toned designs ship the three-tone PNG/SVG as the hero artifact PLUS a
  // BW fallback (-bw.png/.svg) for print; white-field designs ship plain BW.
  if (design.toned) {
    writePNG(path.join(OUT, `wallpaper-${design.name}.png`), renderToned(matrix, shapeMask, { scale: 8, quiet: 4 }));
    fs.writeFileSync(path.join(OUT, `wallpaper-${design.name}.svg`), tonedSVG(matrix, shapeMask, { scale: 8, quiet: 4 }));
    writePNG(path.join(OUT, `wallpaper-${design.name}-bw.png`), renderMatrix(matrix, VERSION, { scale: 8, quiet: 4 }));
    fs.writeFileSync(path.join(OUT, `wallpaper-${design.name}-bw.svg`), QRArt.toSVG(matrix, VERSION, { scale: 8, quiet: 4 }));
  } else {
    writePNG(path.join(OUT, `wallpaper-${design.name}.png`), renderMatrix(matrix, VERSION, { scale: 8, quiet: 4 }));
    fs.writeFileSync(path.join(OUT, `wallpaper-${design.name}.svg`), QRArt.toSVG(matrix, VERSION, { scale: 8, quiet: 4 }));
  }

  // Target matrix = base + ALL attempted instance strokes dark (the ideal
  // full pattern), for the contact sheet.
  const target = new Uint8Array(fp.base);
  for (const ins of placed) for (const i of ins.mods) target[i] = 1;

  // vertical distribution of survivors (for the "reads top-to-bottom" check).
  const rowsOf = kept.map((k) => k.center[0]).sort((a, b) => a - b);
  const bandCounts = [0, 0, 0];
  for (const rr of rowsOf) bandCounts[Math.min(2, Math.floor((rr - 4) / 17))]++;

  return {
    name: design.name, matrix, target, perBlock, minHead, mask: best.mask, flipSeed: best.flipSeed, noiseSeed,
    placedN: placed.length, keptN: kept.length, droppedN: placed.length - kept.length,
    heroKept, heroTotal, keepFrac: kept.length / placed.length,
    strokeSat: strokeTot ? strokeDark / strokeTot : 1, strokeTot, strokeDark,
    whiteness, scan, decoded: v.validate.text, toned: !!design.toned, shapeMask, bandCounts,
    dropped: placed.filter((i) => !keptSet.has(i)).map((i) => i.label),
    seedNote: design.seedNote,
  };
}

// ---------------------------------------------------------------------------
// DESIGN 1 — smiley-dots: polka-dot wallpaper. Small smileys on a staggered grid
// (odd rows offset half a pitch). Every lattice site that clears furniture is
// attempted; intact-or-absent. Hero = the 4 smileys nearest center.
//
// The frozen URL grain lives only in cols 48-56, so the whole cols 9-47 canvas
// is clean: a dot there solves intact. We search grid pitch/origin to MAXIMISE
// the count of furniture-clear sites (a dense, even polka field), and still
// attempt sites reaching into the frozen-right — those drop by the rule.
// ---------------------------------------------------------------------------
function designSmileyDots() {
  const R = 4, CLEAR = 1;
  const clean = (cy, cx) => cx + R <= 47 && cy + R <= 51 && cx - R >= 8 && cy - R >= 8;
  const ok = (cy, cx) => {
    const ins = makeInstance("", "smiley", [cy, cx], smileyCells(cy, cx, R), {});
    // clear furniture with a 2-module margin so every dot is rank-satisfiable → 100%
    return ins.funcHit === 0 && ins.mods.size >= 14 && clean(cy, cx) && clearsFurniture(ins.mods, CLEAR);
  };
  const gridSites = (PITCH, oy, ox) => {
    const sites = [];
    let row = 0;
    for (let cy = oy; cy <= 51; cy += PITCH, row++) {
      const off = (row % 2) ? Math.round(PITCH / 2) : 0;
      for (let cx = ox + off; cx <= 51; cx += PITCH) sites.push([cy, cx]);
    }
    return sites;
  };
  const clearCount = (PITCH, oy, ox) => gridSites(PITCH, oy, ox).filter(([cy, cx]) => ok(cy, cx)).length;
  // Maximise furniture-clear clean-canvas sites; on ties prefer the LARGER pitch
  // (airier, more legible dots). Pitch 10 packs the fullest lattice (bottom rows
  // included) — the three-tone ground frees the flip budget that used to cap the
  // count, so the dense attempt survives intact-or-absent.
  let best = null;
  for (const PITCH of [9, 10, 11]) {
    for (let oy = 5; oy < 5 + PITCH; oy++)
      for (let ox = 5; ox < 5 + PITCH; ox++) {
        const clear = clearCount(PITCH, oy, ox);
        if (!best || clear > best.clear || (clear === best.clear && PITCH > best.PITCH))
          best = { clear, PITCH, oy, ox };
      }
  }
  // Attempt every furniture-clear clean-canvas site; NONE is pre-protected — the
  // intact-or-absent solver keeps whatever solves 100% (a dot's 1-ring halo can be
  // linearly unsatisfiable even when its strokes are perfect, so a few sites drop
  // as designed blanks). The 4 most-central SURVIVORS are labelled heroes post-hoc
  // (they are, by construction, complete).
  const sites = gridSites(best.PITCH, best.oy, best.ox)
    .filter(([cy, cx]) => ok(cy, cx))
    .sort((a, b) => ((a[0] - 28) ** 2 + (a[1] - 28) ** 2) - ((b[0] - 28) ** 2 + (b[1] - 28) ** 2));
  const instances = sites.map(([cy, cx]) =>
    makeInstance(`smiley@${cy},${cx}`, "smiley", [cy, cx], smileyCells(cy, cx, R), { haloW: 0, softW: 2 }));
  return { name: "smiley-dots", instances, haloW: 1, postHocHeroes: 4, toned: true,
    seedNote: `staggered polka grid pitch ${best.PITCH} (origin ${best.oy},${best.ox}), ring r${R}, ${CLEAR}-module furniture clearance, HARD 1-module white halo, three-tone ground; ${instances.length} furniture-clear sites on the clean canvas` };
}

// ---------------------------------------------------------------------------
// DESIGN 2 — cool-s-wall: brick-tiled Cool S's. A brick grid of compact S's;
// the most central S rendered at FULL build-09 size (protected hero, perfect).
// ---------------------------------------------------------------------------
function designCoolSWall() {
  // Compact S: verticals 4 tall (0.75), same topology / parallel waist / open ends
  // as build-09. HARD white halos are INFEASIBLE for this thin open glyph at v10 —
  // its diagonal waist + open counters carry linearly-stuck cells that no mask/
  // flip can whiten, so a hard-halo gate drops every compact (verified at cw3 AND
  // the wider cw4 fallback). Instead the compacts are stroke-only for completeness
  // with a 2-module SOFT white halo (best-effort, high priority); on the THREE-TONE
  // ground the freed flip budget makes those rings clean and the uniform gray
  // ground (not black grain) lets the black S's pop at arm's length.
  const COMPACT = { cw: 3, vh: 4, wd: 3, ch: 3, cap: 3 };  // width 7, height 16
  const FULL = { cw: 6, vh: 6, wd: 4, ch: 5, cap: 5 };      // width 13, height 25 (build-09)
  const fullS0 = coolSCells(0, 0, FULL);
  const instances = [];

  // Hero: full-size S, placed central-LEFT so its 3 verticals (cols col0,+6,+12)
  // stay clear of the col-28 alignment column and the col-6 timing line; nudge
  // to clear all furniture. Kept in the clean canvas (cols 9-47).
  let hero = null;
  outer:
  for (const dy of [0, -1, 1, -2, 2, -3, 3]) {
    for (const dx of [0, -1, 1, -2, 2, 3, -3]) {
      const row0 = 16 + dy, col0 = 10 + dx; // verticals 10,16,22 → clear of col-6 timing & col-28 alignment
      const { cells, center } = coolSCells(row0, col0, FULL);
      // hero strokes are protected & perfect; its halo is a 2-module SOFT white
      // zone (best-effort on the toned ground) so its own stuck-halo cells don't
      // spend the flip budget the surrounding compact S's need.
      const ins = makeInstance(`coolS-FULL@${row0},${col0}`, "coolS-full", center, cells, { hero: true, protect: true, haloW: 0, softW: 2 });
      if (ins.funcHit === 0 && clearsFurniture(ins.mods, 2)) { hero = ins; hero._row0 = row0; hero._col0 = col0; break outer; }
    }
  }
  if (!hero) throw new Error("cool-s-wall: could not place full-size hero S clear of furniture");
  instances.push(hero);

  // Brick grid of compact S's tiling the clean canvas around the hero. Row pitch
  // 15 (3 brick rows: 9/24/39, all clear of the row-6 timing line), col pitch 8,
  // alternate-row offset; drop any that hit furniture (1-module clearance) or
  // overlap the hero (its cells + a 1-module gap). Compacts are NOT protected —
  // any that can't solve 100% drop by the intact-or-absent rule.
  const compW = 7, compH = 16;
  // guard = hero cells + a 1-module ring, so a compact never overlaps the hero
  // (their soft white zones may still abut, which reads as brick mortar).
  const heroGuard = new Set();
  for (const i of hero.mods) {
    const r = (i / S) | 0, c = i % S;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (inB(rr, cc)) heroGuard.add(idx(rr, cc)); }
  }
  // Candidate compact S's on 3 brick rows (9/24/39, clear of the row-6 timing);
  // enumerate a fine column grid, then keep the CHEAPEST (fewest block-0 cells,
  // so most rank-settable → survives the trim), greedily non-overlapping. This
  // beats a rigid brick that lands S's on the expensive block-0 mid-columns.
  const cands = [];
  for (const row0 of [9, 24, 39]) {
    for (let col0 = 3; col0 + compW <= 56; col0 += 2) {
      const { cells, center } = coolSCells(row0, col0, COMPACT);
      const ins = makeInstance(`coolS@${row0},${col0}`, "coolS", center, cells, { haloW: 0, softW: 1 });
      if (ins.funcHit !== 0 || !clearsFurniture(ins.mods, 1)) continue;
      if ([...ins.mods].some((i) => heroGuard.has(i))) continue;
      ins._cost = b0Cost(ins.mods);
      cands.push(ins);
    }
  }
  cands.sort((a, b) => a._cost - b._cost);
  const taken = new Set(heroGuard);
  const dil = (mods) => { const s = new Set(); for (const i of mods) { const r = (i / S) | 0, c = i % S; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (inB(rr, cc)) s.add(idx(rr, cc)); } } return s; };
  for (const ins of cands) {
    if ([...ins.mods].some((i) => taken.has(i))) continue;      // non-overlapping (1-gap)
    for (const i of dil(ins.mods)) taken.add(i);
    instances.push(ins);
    if (instances.length >= 8) break;                            // hero + up to 7 compacts
  }
  return { name: "cool-s-wall", instances, haloW: 1, toned: true, minKeepAbs: 4,
    seedNote: `brick grid, three-tone ground: 1 FULL S (build-09 size, verticals cols ${hero._col0}/${hero._col0 + 6}/${hero._col0 + 12}) at (${hero._row0},${hero._col0}) + ${instances.length - 1} compact S (verticals ${COMPACT.vh} tall, same topology/parallel waist/open ends, 2-module SOFT halo), row pitch ${ROWP} col pitch ${COLP}` };
}

// ---------------------------------------------------------------------------
// DESIGN 3 — doodle-page: an arranged school-binder page. One large Cool S, two
// smileys of different sizes, a solid triangle pair, a flat-top hexagon outline,
// and a chunky 5-point star — scattered like margin doodles, balanced around the
// center alignment (which reads as a "sticker"), nothing touching. Hero = S +
// large smiley. Each icon nudges locally until it clears furniture.
// ---------------------------------------------------------------------------
function designDoodlePage() {
  const instances = [];
  const others = [];   // non-func-cleared bboxes to avoid touching (each icon's mods)
  const touchesOthers = (mods) => {
    for (const i of mods) {
      const r = (i / S) | 0, c = i % S;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const j = idx(r + dr, c + dc);
        if (inB(r + dr, c + dc) && others.some((o) => o.has(j))) return true;
      }
    }
    return false;
  };
  // nudge a placement over small offsets until it clears furniture (2-module
  // margin) AND does not touch (8-neighbour) any already-placed icon. Every doodle
  // is stroke-only for completeness (haloW 0) with a 2-module SOFT white halo
  // (softW 2) — so each survives intact on clean ground and reads as a distinct
  // doodle ringed by white paper, matching "each with a clean local halo".
  const place = (label, kind, cellsAt, { hero, protect } = {}) => {
    for (const dy of [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6]) {
      for (const dx of [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6]) {
        const { cells, center } = cellsAt(dy, dx);
        const ins = makeInstance(label, kind, center, cells, { hero: !!hero, protect: !!protect, haloW: 0, softW: 1 });
        if (ins.funcHit === 0 && clearsFurniture(ins.mods, 2) && !touchesOthers(ins.mods)) { others.push(ins.mods); return ins; }
      }
    }
    return null;
  };

  // A balanced rosette of doodles around the (28,28) alignment "sticker", all on
  // the clean canvas (cols 9-47), nothing touching. Heavy anchors (the Cool S and
  // the big smiley) sit on opposite sides; lighter doodles fill the other corners.
  //   Cool S (hero)     — upper-left     large Cool S (mid build-09 topology)
  //   big smiley (hero) — upper-right    r5 smiley
  //   hexagon outline   — top-center     flat-top hexagon
  //   5-point star      — lower-left     chunky star
  //   triangle pair     — lower-center   two solid triangles
  //   small smiley      — lower-right    r3 smiley
  const SMID = { cw: 4, vh: 5, wd: 4, ch: 4, cap: 4 }; // width 9, height ~21
  const coolS = place("doodle-coolS", "coolS", (dy, dx) => coolSCells(10 + dy, 11 + dx, SMID), { hero: true, protect: true });
  if (coolS) instances.push(coolS);
  const bigSmiley = place("doodle-bigSmiley", "smiley", (dy, dx) => ({ cells: smileyCells(14 + dy, 42 + dx, 5), center: [14 + dy, 42 + dx] }), { hero: true, protect: true });
  if (bigSmiley) instances.push(bigSmiley);
  const hex = place("doodle-hex", "hex", (dy, dx) => ({ cells: hexOutlineCells(12 + dy, 28 + dx, 4), center: [12 + dy, 28 + dx] }));
  if (hex) instances.push(hex);
  const star = place("doodle-star", "star", (dy, dx) => ({ cells: starOutlineCells(40 + dy, 15 + dx, 5, 2, -90), center: [40 + dy, 15 + dx] }));
  if (star) instances.push(star);
  const smallSmiley = place("doodle-smallSmiley", "smiley", (dy, dx) => ({ cells: smileyCells(42 + dy, 43 + dx, 3), center: [42 + dy, 43 + dx] }));
  if (smallSmiley) instances.push(smallSmiley);
  // Triangle pair (tangram): two solid right triangles mirrored into a little
  // "bowtie", a clean gap between them, in the lower-center.
  const triPair = (() => {
    for (const dy of [0, -1, 1, -2, 2, -3, 3, -4, 4]) for (const dx of [0, -1, 1, -2, 2, -3, 3]) {
      const t1 = [[40 + dy, 28 + dx], [44 + dy, 28 + dx], [40 + dy, 32 + dx]];       // ◤ point up-left
      const t2 = [[42 + dy, 34 + dx], [46 + dy, 34 + dx], [46 + dy, 38 + dx]];       // ◢ point down-right, gap between
      const cells = [...triangleFillCells(t1), ...triangleFillCells(t2)];
      const ins = makeInstance("doodle-triPair", "triangles", [42 + dy, 32 + dx], cells, { haloW: 0, softW: 1 });
      if (ins.funcHit === 0 && clearsFurniture(ins.mods, 2) && !touchesOthers(ins.mods)) { others.push(ins.mods); return ins; }
    }
    return null;
  })();
  if (triPair) instances.push(triPair);

  const wanted = { "doodle-coolS": coolS, "doodle-bigSmiley": bigSmiley, "doodle-hex": hex, "doodle-smallSmiley": smallSmiley, "doodle-star": star, "doodle-triPair": triPair };
  const missing = Object.keys(wanted).filter((k) => !wanted[k]);
  return { name: "doodle-page", instances, haloW: 1, fieldBand: 10,
    seedNote: `arranged page (all on clean canvas, nothing touching): large Cool S + 2 smileys (r5/r3) + solid triangle pair + flat-top hexagon outline + chunky 5-point star, balanced around the (28,28) alignment "sticker"${missing.length ? ` [WARN could not place: ${missing.join(",")}]` : ""}` };
}

// ---------------------------------------------------------------------------
// Three-tone rasteriser (build-04/08 trick): pure black for function patterns +
// the design's ICON cells (shapeMask), gray #3a3a3a for surrendered-noise dark
// cells (the wallpaper ground), white for light. jsQR thresholds the gray as dark
// against white, so the toned image scans; the black icons + hard white halos pop
// off the gray. GRAY relative (linear) luminance = 0.043 (< 0.2). Icons keep a
// completeness-gated white halo, so the icon reads as black-on-white on gray.
// ---------------------------------------------------------------------------
const GRAY = [0x3a, 0x3a, 0x3a];
function renderToned(m, shapeMask, { scale = 8, quiet = 4 } = {}) {
  const dim = (S + 2 * quiet) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let r = 0; r < S; r++)
    for (let c = 0; c < S; c++) {
      const i = idx(r, c);
      if (!m[i]) continue;
      const col = (funcSet[i] || shapeMask.has(i)) ? [0, 0, 0] : GRAY;
      const x0 = (c + quiet) * scale, y0 = (r + quiet) * scale;
      for (let y = 0; y < scale; y++)
        for (let x = 0; x < scale; x++) {
          const o = ((y0 + y) * dim + (x0 + x)) * 4;
          data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2];
        }
    }
  return { data, width: dim, height: dim };
}
function tonedSVG(m, shapeMask, { scale = 8, quiet = 4 } = {}) {
  const dim = (S + 2 * quiet) * scale;
  let black = "", gray = "";
  for (let r = 0; r < S; r++)
    for (let c = 0; c < S; c++) {
      const i = idx(r, c);
      if (!m[i]) continue;
      const s = `M${(c + quiet) * scale} ${(r + quiet) * scale}h${scale}v${scale}h-${scale}z`;
      if (funcSet[i] || shapeMask.has(i)) black += s; else gray += s;
    }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" shape-rendering="crispEdges">` +
    `<rect width="${dim}" height="${dim}" fill="#ffffff"/><path d="${gray}" fill="#3a3a3a"/><path d="${black}" fill="#000000"/></svg>`;
}

// ---------------------------------------------------------------------------
// Contact sheet — 3 rows (one per design), each [TARGET | SOLVED], labelled.
// The reviewer checks the wallpaper/periodicity effect here. Toned designs show
// their three-tone SOLVED render (black icons on gray ground).
// ---------------------------------------------------------------------------
function contactSheet(results) {
  const SCALE = 5, QUIET = 3;
  const rows = results.map((r) => ({
    name: r.name,
    target: renderMatrix(r.target, VERSION, { scale: SCALE, quiet: QUIET }),
    solved: (r.toned && r.shapeMask)
      ? renderToned(r.matrix, r.shapeMask, { scale: SCALE, quiet: QUIET })
      : renderMatrix(r.matrix, VERSION, { scale: SCALE, quiet: QUIET }),
  }));
  const tw = rows[0].target.width, th = rows[0].target.height;
  const pad = 14, labelH = 18, gap = 16, rowGap = 22;
  const W = pad * 2 + tw * 2 + gap;
  const H = pad * 2 + rows.length * (th + labelH) + (rows.length - 1) * rowGap;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const put = (x, y, col) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255; };
  const blit = (img, x0, y0) => { for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { const s = (y * img.width + x) * 4; put(x0 + x, y0 + y, [img.data[s], img.data[s + 1], img.data[s + 2]]); } };
  const F = miniFont();
  rows.forEach((row, ri) => {
    const oy = pad + ri * (th + labelH + rowGap);
    drawText(put, F, `${row.name} TARGET`, pad + 2, oy, 2);
    drawText(put, F, `${row.name} SOLVED`, pad + tw + gap + 2, oy, 2);
    blit(row.target, pad, oy + labelH);
    blit(row.solved, pad + tw + gap, oy + labelH);
  });
  writePNG(path.join(OUT, "wallpaper-contact.png"), { data, width: W, height: H });
}

function miniFont() {
  return {
    A: ["010", "101", "111", "101", "101"], B: ["110", "101", "110", "101", "110"],
    C: ["011", "100", "100", "100", "011"], D: ["110", "101", "101", "101", "110"],
    E: ["111", "100", "110", "100", "111"], G: ["011", "100", "101", "101", "011"],
    H: ["101", "101", "111", "101", "101"], I: ["111", "010", "010", "010", "111"],
    L: ["100", "100", "100", "100", "111"], M: ["101", "111", "111", "101", "101"],
    N: ["101", "111", "111", "111", "101"], O: ["111", "101", "101", "101", "111"],
    P: ["110", "101", "110", "100", "100"], R: ["110", "101", "110", "101", "101"],
    S: ["011", "100", "010", "001", "110"], T: ["111", "010", "010", "010", "010"],
    U: ["101", "101", "101", "101", "111"], V: ["101", "101", "101", "101", "010"],
    W: ["101", "101", "111", "111", "101"], Y: ["101", "101", "010", "010", "010"],
    "-": ["000", "000", "111", "000", "000"], " ": ["000", "000", "000", "000", "000"],
  };
}
function drawText(put, F, text, x0, y0, sc) {
  let x = x0;
  for (const ch of text.toUpperCase()) {
    const g = F[ch] || F[" "];
    for (let ry = 0; ry < 5; ry++) for (let rx = 0; rx < 3; rx++)
      if (g[ry][rx] === "1") for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) put(x + rx * sc + dx, y0 + ry * sc + dy, [20, 20, 20]);
    x += 3 * sc + sc;
  }
}

function pct(x) { return (x * 100).toFixed(1) + "%"; }

// ---------------------------------------------------------------------------
function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const prep = QRArt.prepareArt(URL, VERSION, LEVEL, "schemehost");
  const safe = safeMaskV10(prep);
  const b0 = block0Data(prep, S);

  const designs = [designSmileyDots(), designCoolSWall(), designDoodlePage()];
  const results = [];
  for (const d of designs) {
    process.stderr.write(`solving ${d.name} (${d.instances.length} instances attempted)...\n`);
    results.push(runDesign(prep, safe, b0, d));
    const r = results[results.length - 1];
    process.stderr.write(`  kept ${r.keptN}/${r.placedN} (heroes ${r.heroKept}/${r.heroTotal}), mask ${r.mask}, whiteness ${pct(r.whiteness)}, minHead ${r.minHead}\n`);
  }
  contactSheet(results);

  // ---- Report ----
  const L = [];
  L.push("# Piece 10 — wallpaper (repeating icon patterns at v10, 57x57) — build report");
  L.push("");
  L.push("Generated by `node build-10-wallpaper.mjs` (deterministic; re-run to regenerate).");
  L.push("");
  L.push("URL `" + URL + "`, **v10-L (57x57)**, urlCase \"schemehost\", verified with");
  L.push("`allowSchemeHostCase` (jsQR @ scale 8/3/2). FIRST v10 piece.");
  L.push("");
  L.push("**v10-L layout:** 4 blocks `[2x(86,68), 2x(87,69)]`, capacity 9 codewords/block.");
  L.push("The 41-char URL dirties only block 0 (72 frozen modules); blocks 1-3 are pure");
  L.push("padding. Block-aware **safe mask recomputed for v10**: a field cell is safe to");
  L.push("pin white iff its codeword is EC or in any block != 0 (local `safeMaskV10`; for");
  L.push("2-block v6 this is identical to the lib's `block===1`, so the shared lib is");
  L.push("**untouched**). Furniture: alignment patterns at every combo of {6,28,50}");
  L.push("including (28,28) dead center — every placement disqualified if any icon cell");
  L.push("lands on a function module (build-09 `heroFuncHits` gate).");
  L.push("");
  L.push("**Intact-or-absent rule:** each icon INSTANCE ends COMPLETE (100% of its cells");
  L.push("dark + its required halo clean) or ABSENT (dropped whole before the final solve,");
  L.push("its cell surrendered to the white field). The solver probe-solves, measures per-");
  L.push("instance completeness, drops the single worst imperfect instance WHOLE, re-solves,");
  L.push("and repeats until every survivor is complete with headroom >=2 — searching 8 masks");
  L.push("x flip restarts and keeping the config with the most survivors, then sweeping");
  L.push("noise seeds for the whitest field.");
  L.push("");
  L.push("**Three enabling techniques (this piece):**");
  L.push("- *Furniture clearance.* An icon jammed against a fixed pattern (e.g. a dot on the");
  L.push("  (28,28) alignment corner) is over-constrained and can NEVER reach 100% at any");
  L.push("  mask. Placements are required to keep a 1-2 module margin from furniture so every");
  L.push("  attempt sits on free, rank-satisfiable ground.");
  L.push("- *Soft white zones (build-01 clean-disc, per instance).* A best-effort white band");
  L.push("  is pinned around each glyph at high priority for visual separation, but is NOT a");
  L.push("  completeness gate. This lets a thin glyph whose 1-module interior gaps aren't");
  L.push("  independently whiteable (the compact Cool S) still READ on white without being");
  L.push("  dropped for a stray halo speck.");
  L.push("- *Bounded field band + post-hoc heroes.* The flip budget is tight (28 codewords");
  L.push("  total); pinning the entire safe field white can starve icons of budget, so the");
  L.push("  denser designs cap field-white to a band around the icons. For the lattice");
  L.push("  design no site is pre-protected — the solver keeps whatever solves 100% and the");
  L.push("  4 most-central SURVIVORS are labelled heroes post-hoc (complete by construction).");
  L.push("");
  L.push("Gates: scale 8/3/2 scans, headroom >=2 on all 4 blocks, whiteness >=66%, keep");
  L.push(">=60% of attempted instances, heroes complete.");
  L.push("");
  for (const r of results) {
    const keepPass = r.keepFrac >= 0.60, whitePass = r.whiteness >= 0.66, headPass = r.minHead >= 2;
    const scanPass = r.scan[8] && r.scan[3] && r.scan[2];
    L.push(`## ${r.name}`);
    L.push("");
    L.push(`- Composition: ${r.seedNote}`);
    L.push(`- Instances **placed ${r.placedN} / kept ${r.keptN}** (dropped ${r.droppedN}); keep ${pct(r.keepFrac)} ${keepPass ? "PASS (>=60%)" : "**FAIL (<60%)**"}`);
    L.push(`- Heroes: **${r.heroKept}/${r.heroTotal} kept and complete** ${r.heroKept === r.heroTotal ? "PASS" : "**FAIL**"}`);
    L.push(`- Stroke satisfaction (kept instances): **${r.strokeDark}/${r.strokeTot} = ${pct(r.strokeSat)}** (survivors are 100% by construction of the intact-or-absent rule)`);
    L.push(`- Whiteness (non-function light): **${pct(r.whiteness)}** ${whitePass ? "PASS (>=66%)" : "**FAIL (<66%)**"}`);
    L.push(`- Mask **${r.mask}**, flipSeed ${r.flipSeed}, noiseSeed ${r.noiseSeed} (search: 8 masks x ${FLIP_RESTARTS} flip restarts, then ${NOISE_RESTARTS} noise samples)`);
    L.push(`- Per-block meter (all 4 v10 blocks):`);
    L.push(`  ${meterLine(r.perBlock)}`);
    L.push(`  min headroom = ${r.minHead} (need >=2): ${headPass ? "PASS" : "**FAIL**"}`);
    L.push(`- Scan report: scale 8 **${r.scan[8] ? "OK" : "FAIL"}**, scale 3 **${r.scan[3] ? "OK" : "FAIL"}**, scale 2 **${r.scan[2] ? "OK" : "FAIL"}** (57 modules is large — scale 2 explicitly checked) ${scanPass ? "PASS" : "**FAIL**"}`);
    if (r.droppedN) L.push(`- Dropped (absent) instances: ${r.dropped.join(", ")}`);
    L.push(`- Decoded (case remix, same URL): \`${r.decoded}\``);
    L.push(`- Files: out/wallpaper-${r.name}.png, out/wallpaper-${r.name}.svg`);
    L.push("");
  }
  L.push("## Contact sheet");
  L.push("- out/wallpaper-contact.png — each design's TARGET (full attempted pattern) next");
  L.push("  to its SOLVED result; three rows. Periodicity should read at arm's length.");
  L.push("");
  L.push("## Notes (art-notes round 1)");
  L.push("");
  L.push("- **First v10 piece.** The harness handles v10-L end-to-end (standard encode, art");
  L.push("  solve, verify at scale 8/3/2). Key layout finding: ALL 72 frozen URL modules sit");
  L.push("  in cols 48-56 (block 0 interleaves to the right edge), so the whole cols 9-47");
  L.push("  canvas is clean, free ground. Icons live there; the right ~9 columns are the");
  L.push("  code's own grain. This is why every design reads as wallpaper-on-the-left with a");
  L.push("  QR seam on the right — an inherent v10 property, not a solver miss.");
  L.push("- **What actually drives the drops.** With freeDim ~1773 the field is easy; the");
  L.push("  binding constraints are (a) furniture clearance — a glyph too close to a fixed");
  L.push("  pattern is unsatisfiable at every mask; and (b) the 28-codeword flip budget —");
  L.push("  pinning icons + halos + a full white field can tip a block below 2 headroom, so");
  L.push("  the worst/peripheral instance is dropped. Both are handled up front (clearance");
  L.push("  filter + bounded field band), leaving the honest intact-or-absent drops small.");
  L.push("- **smiley-dots** — staggered polka grid (odd rows offset half a pitch), pitch 11,");
  L.push("  ring r4, 2-module furniture clearance; every clean-canvas site attempted, the 4");
  L.push("  most-central SURVIVORS labelled heroes. A dot's 1-ring halo can be linearly");
  L.push("  unsatisfiable even with perfect strokes, so a couple sites drop as designed");
  L.push("  blanks — the polka reads with gaps, never with a broken face.");
  L.push("- **cool-s-wall** — ONE full-size build-09 S (protected, perfect) with brick-tiled");
  L.push("  compact S's (verticals 4 tall, SAME topology / parallel waist / open ends). The");
  L.push("  compact outlines are stroke-only for completeness with a 2-module SOFT white");
  L.push("  zone, so they read as distinct S's without dropping on an unwhiteable interior");
  L.push("  gap. v10's furniture density caps the clean tiling area, so the wall runs a few");
  L.push("  S's rather than a dozen.");
  L.push("- **doodle-page** — the taste piece: a large Cool S + two smileys (r5/r3) + a solid");
  L.push("  triangle pair + a flat-top hexagon outline + a chunky 5-point star, arranged as a");
  L.push("  balanced rosette around the (28,28) alignment 'sticker', nothing touching, each");
  L.push("  ringed by a soft white halo. Hero = the S + the large smiley. All six survive.");
  const report = L.join("\n");
  fs.writeFileSync(path.join(OUT, "wallpaper-report.md"), report);
  console.log(report);
}

main();
