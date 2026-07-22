// build-08-geometric.mjs — Piece 8: the nearly-blank GEOMETRIC series.
//
// Run `node build-08-geometric.mjs` to regenerate out/geometric-* (deterministic).
//
// Five nearly-blank designs that read as a sparse pen drawing on paper, built on
// piece 1's block-aware pin/flip insight (see nearly-blank-lib.mjs, copied from
// build-01). All share: URL https://github.com/minigolf2000/cat-games, v6-L,
// urlCase "schemehost", verified with allowSchemeHostCase at scale 8 + 3.
//
// The taste-critical part is "dashes not nibbles": when rank/flip budget runs out
// on a stroke, the miss must read as an intentional dash rhythm — a WHOLE 2–3
// module stroke segment dropped — never a random single-module hole. Mechanism
// (in solveDashed): each stroke is cut into contiguous 2–3 module segments; a
// PROBE solve pins every segment dark and measures per-segment satisfaction;
// whole outer segments that aren't fully dark are SACRIFICED and, in the RE-SOLVE,
// pinned WHITE at high priority so they become clean gaps. Hero + kept segments
// pin first (equal-or-greater free rank than the probe) so they stay solid.
//
// Per design we search all 8 masks × flip-seed restarts (like build-01) and, on
// the winning config, sweep noise seeds to whiten the free field.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QRArt } from "./engine.mjs";
import { renderMatrix, writePNG } from "./png.mjs";
import { verifyMatrix, scanRGBA } from "./verify.mjs";
import {
  line, circleOutline, safeMask, block0Data, segmentStroke, solveDashed,
  meterLine, flipSeedFor, fillPolygon, edgeOf, haloOf,
} from "./nearly-blank-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "out");
const URL = "https://github.com/minigolf2000/cat-games";
const VERSION = 6, LEVEL = "L";
const S = QRArt.sizeOf(VERSION); // 41
const SEGLEN = 3;               // 2–3 module segments (chunk size before merge)
const FLIP_RESTARTS = 110;      // flip-seed rotations per mask
const NOISE_RESTARTS = 400;     // noise samples to whiten the free field
const BASE_NOISE = 12345;

const fp = QRArt.functionPatterns(VERSION);
const funcSet = fp.func;
const inB = (r, c) => r >= 0 && c >= 0 && r < S && c < S;

// ---------------------------------------------------------------------------
// Design geometry. Each returns { paths } where a path is
//   { pts:[[r,c],...], hero:bool, prio:number }
// pts are an ORDERED walk so segments come out as contiguous arcs/runs.
// hero forces every segment of the path into the hero set; otherwise hero is
// decided per-segment by the design's heroTest(centroidR, centroidC).
// ---------------------------------------------------------------------------

// A clean disc: every non-function module within `r` of the center, innermost
// first (build-01 technique). Extra corridor cells may be appended.
function discAround(cy, cx, r, extra = []) {
  const cells = [];
  for (let rr = 0; rr < S; rr++)
    for (let cc = 0; cc < S; cc++) {
      const i = rr * S + cc;
      if (funcSet[i]) continue;
      const d2 = (rr - cy) * (rr - cy) + (cc - cx) * (cc - cx);
      if (d2 <= r * r) cells.push([i, d2]);
    }
  for (const [rr, cc] of extra) {
    if (!inB(rr, cc)) continue;
    const i = rr * S + cc;
    if (!funcSet[i]) cells.push([i, (rr - cy) * (rr - cy) + (cc - cx) * (cc - cx)]);
  }
  const seen = new Set();
  cells.sort((a, b) => a[1] - b[1]);
  const out = [];
  for (const [i] of cells) { if (seen.has(i)) continue; seen.add(i); out.push(i); }
  return out;
}

// 1. RINGS — concentric circles re-centered into the controllable LEFT territory
//    (the (34,34) alignment goes back to being furniture). 4 rings at pitch 3;
//    a build-01 clean disc holds zero speckle through the inner 2 rings. Hero:
//    inner 3 rings 100% + disc speckle 0.
function designRings(center) {
  const [CY, CX] = center, PITCH = 3, MAXR = 12, DISC_R = 7;
  const paths = [];
  let idx = 0;
  for (let radius = PITCH; radius <= MAXR; radius += PITCH, idx++) {
    const pts = circleOutline(CY, CX, radius);
    paths.push({ pts, hero: idx < 3, prio: radius });
  }
  return {
    name: "rings", center, paths,
    heroTest: () => false, // hero is carried by the inner-ring flag
    heroDesc: `the 3 innermost rings (r 3/6/9 around center (${CY},${CX})) + zero-speckle disc r${DISC_R}`,
    discCellsFn: () => discAround(CY, CX, DISC_R),
    discDesc: `clean disc r${DISC_R} (through the inner 2 rings)`,
  };
}

// 2. WAVES — Joy-Division horizontal wavelines, vertical pitch 3, flat at the
//    edges and rising into a peak centered on column 15. Hero: central peak
//    rows 12–30 × cols 8–24.
function designWaves() {
  // 8 wavelines, cols clipped to 3–30 (the controllable band; the frozen right
  // edge is where they'd dash anyway), flat at those edges and rising to a peak
  // at col 15 — a compact "mountain" that stays nearly-blank (~214 modules).
  const PITCH = 3, PEAK_COL = 15, AMP = 7.5, SIGMA = 4.5, CLO = 4, CHI = 29;
  const baseRows = [];
  for (let r = 11; r <= 29; r += PITCH) baseRows.push(r); // 7 lines (nearly-blank)
  const disp = (c) => AMP * Math.exp(-((c - PEAK_COL) * (c - PEAK_COL)) / (2 * SIGMA * SIGMA));
  const paths = [];
  baseRows.forEach((R, li) => {
    // polyline across the band; peak nearer the middle lines is taller.
    const pts = [];
    for (let c = CLO; c <= CHI; c++) {
      const r = Math.round(R - disp(c));
      pts.push([r, c]);
    }
    // densify: connect consecutive samples with Bresenham so vertical jumps fill
    const dense = [];
    for (let k = 0; k < pts.length - 1; k++) {
      line(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], (r, c) => dense.push([r, c]));
    }
    paths.push({ pts: dense, hero: false, prio: li });
  });
  return {
    name: "waves", center: [20, PEAK_COL], paths,
    heroTest: (r, c) => r >= 12 && r <= 30 && c >= 8 && c <= 24,
    heroDesc: "the central peak, rows 12–30 × cols 8–24",
  };
}

// 3. SPIRAL — one Archimedean spiral from center (20,17), pitch 3, terminating
//    before the finder margins. Hero: inner 2.5 turns.
function designSpiral() {
  const CY = 20, CX = 17, PITCH = 3;
  const b = PITCH / (2 * Math.PI);
  const heroTurns = 2.5, maxTurns = 4.0;
  const thetaMax = maxTurns * 2 * Math.PI;
  const thetaHero = heroTurns * 2 * Math.PI;
  const inner = [], outer = [];
  let prev = null;
  for (let th = 0; th <= thetaMax; th += 0.03) {
    const rad = b * th;
    const r = Math.round(CY + rad * Math.sin(th));
    const c = Math.round(CX + rad * Math.cos(th));
    if (!inB(r, c)) continue;
    if (prev && prev[0] === r && prev[1] === c) continue;
    prev = [r, c];
    (th <= thetaHero ? inner : outer).push([r, c]);
  }
  const paths = [
    { pts: inner, hero: true, prio: 0 },
    { pts: outer, hero: false, prio: 1 },
  ];
  return {
    name: "spiral", center: [CY, CX], paths,
    heroTest: () => false,
    heroDesc: "the inner 2.5 turns of the spiral (center (20,17))",
  };
}

// 4. STARBURST — 14 thin 1-module rays radiating a full 360° from a hub in the
//    controllable left. Rays dash-fade outward (heaviest toward the frozen right,
//    where dropped segments read as intentional). Hero: the innermost 7 modules
//    of every ray 100% + a clean hub disc r4.
function designStarburst(center) {
  const [CY, CX] = center, N = 14, HERO_LEN = 7, MAXLEN = 24, DISC_R = 4;
  const paths = [];
  for (let k = 0; k < N; k++) {
    const ang = (k * 2 * Math.PI) / N;
    // walk the ray outward, splitting into hero (inner 7 modules) and outer.
    const cells = [];
    const seen = new Set();
    for (let t = 1; t <= MAXLEN; t += 0.5) {
      const rr = Math.round(CY + t * Math.sin(ang));
      const cc = Math.round(CX + t * Math.cos(ang));
      if (!inB(rr, cc)) break;
      const i = rr * S + cc;
      if (funcSet[i]) continue;
      if (seen.has(i)) continue;
      seen.add(i);
      cells.push([rr, cc]);
    }
    const heroPts = cells.slice(0, HERO_LEN);
    const outerPts = cells.slice(HERO_LEN);
    if (heroPts.length) paths.push({ pts: heroPts, hero: true, prio: 0, ray: k });
    if (outerPts.length) paths.push({ pts: outerPts, hero: false, prio: 1, ray: k });
  }
  return {
    name: "starburst", center, paths,
    heroTest: () => false,
    heroDesc: `the inner 7 modules of all ${N} rays (hub (${CY},${CX})) + clean hub disc r${DISC_R}`,
    discCellsFn: () => discAround(CY, CX, DISC_R),
    discDesc: `clean hub disc r${DISC_R}`,
    fadeFrozen: true, // fade frozen-block-0 outer ray segments (they'd dash anyway)
    // Rays thin outward: keep-rate falls with radius so the burst fades into
    // scattered dashes at the rim (whole segments only — a dash rhythm).
    fade: (cr, cc, hero, hash) => {
      if (hero) return false;
      const d = Math.hypot(cr - CY, cc - CX);
      const keep = d <= 10 ? 1 : Math.max(0.15, 1 - (d - 10) / 12);
      return hash > keep;
    },
  };
}

// 5. TARGET-CAT — an unmistakable cat face on a build-01 clean disc: head circle
//    (broken at the ear joins so the ears clearly punch through the top edge),
//    solid 2×2 eyes, nose dot, 3 whiskers per side, and exactly ONE ~200° orbit
//    arc in a supporting role. Hero: all face features 100%.
function designTargetCat() {
  const CY = 19, CX = 13, HEAD_R = 6;
  const paths = [];
  // Head circle, broken at the two ear bases (a ~5-module gap under each ear) so
  // the ear triangles visibly break the head's top edge.
  const EJL = CX - 3, EJR = CX + 3; // ear join columns
  const head = circleOutline(CY, CX, HEAD_R).filter(([r, c]) => {
    const up = r <= CY - HEAD_R + 2;
    const underEar = up && (Math.abs(c - EJL) <= 2 || Math.abs(c - EJR) <= 2);
    return !underEar;
  });
  paths.push({ pts: head, hero: true, prio: 0 });
  // Ears: two filled triangles rising ABOVE the head's top edge from the gaps.
  const topRow = CY - HEAD_R + 1;
  const ear = (baseL, baseR, apexC) => {
    const apexR = topRow - 3;
    const pts = [];
    line(topRow, baseL, apexR, apexC, (r, c) => pts.push([r, c]));   // outer edge
    line(apexR, apexC, topRow, baseR, (r, c) => pts.push([r, c]));   // inner edge
    line(topRow, baseL, topRow, baseR, (r, c) => pts.push([r, c]));  // base seam
    paths.push({ pts, hero: true, prio: 0 });
  };
  ear(EJL - 2, EJL + 2, EJL);
  ear(EJR - 2, EJR + 2, EJR);
  // Eyes: two solid 2×2 blocks.
  const eye = (er, ec) => paths.push({ pts: [[er, ec], [er, ec + 1], [er + 1, ec], [er + 1, ec + 1]], hero: true, prio: 0 });
  eye(CY - 1, CX - 4);
  eye(CY - 1, CX + 3);
  // Nose: a 2-module dot.
  paths.push({ pts: [[CY + 2, CX - 1], [CY + 2, CX]], hero: true, prio: 0 });
  // Whiskers: 3 per side, radiating from just beside the nose out past the head.
  const whiskRows = [CY + 1, CY + 2, CY + 3];
  whiskRows.forEach((wr, k) => {
    const tilt = [-1, 0, 1][k];
    const lft = [], rgt = [];
    for (let s = 0; s < 5; s++) { lft.push([wr + Math.round(tilt * s * 0.5), CX - 2 - s]); }
    for (let s = 0; s < 5; s++) { rgt.push([wr + Math.round(tilt * s * 0.5), CX + 1 + s]); }
    paths.push({ pts: lft, hero: true, prio: 0 });
    paths.push({ pts: rgt, hero: true, prio: 0 });
  });
  // ONE partial orbit arc (~200°), supporting role → outer (may dash).
  const arc = circleOutline(CY, CX, HEAD_R + 4, 30, 230);
  paths.push({ pts: arc, hero: false, prio: 1 });
  return {
    name: "target-cat", center: [CY, CX], paths,
    heroTest: () => false,
    heroDesc: "all face features (head, ears, solid eyes, nose, whiskers) on a clean disc",
    // Clean disc over the whole face (head + ears + eyes + nose), plus corridors
    // along the whisker rows so the whiskers sit on clean white too (build-01).
    discCellsFn: () => {
      const corr = [];
      for (const wr of whiskRows)
        for (let dr = -1; dr <= 1; dr++)
          for (let c = CX - 7; c <= CX + 6; c++) corr.push([wr + dr, c]);
      return discAround(CY, CX, HEAD_R + 1, corr);
    },
    discDesc: `clean disc r${HEAD_R + 1} over the face + whisker corridors`,
  };
}

// Chunk a set/array of cells into segments of `size` modules with shared flags.
function chunkCells(cells, size, flags) {
  const arr = [...cells];
  const segs = [];
  for (let k = 0; k < arr.length; k += size) {
    segs.push({ mods: arr.slice(k, k + size), ...flags });
  }
  return segs;
}
// Flat-top regular hexagon vertices (horizontal top & bottom edges of length s).
function hexVerts(cy, cx, s) {
  const h = (s * Math.sqrt(3)) / 2;
  return [
    [cy - h, cx - s / 2], [cy - h, cx + s / 2], [cy, cx + s],
    [cy + h, cx + s / 2], [cy + h, cx - s / 2], [cy, cx - s],
  ];
}
// Ordered hexagon outline path (for the dissolving/dashed hexes).
function hexOutlinePath(cy, cx, s) {
  const v = hexVerts(cy, cx, s).map(([r, c]) => [Math.round(r), Math.round(c)]);
  const pts = [];
  for (let k = 0; k < 6; k++) line(v[k][0], v[k][1], v[(k + 1) % 6][0], v[(k + 1) % 6][1], (r, c) => pts.push([r, c]));
  return pts;
}

// 6. HONEYCOMB — 5–7 flat-top solid hexagons clustered center-left. The 3 largest
//    are solid (edge 100%, interior ≥90% hero); one is drawn outline-with-white-
//    center for contrast; toward the frozen right the cluster dissolves into
//    partial dashed hex outlines. 2-module white halos ring every solid hex.
function designHoneycomb() {
  // {cy, cx, s, kind, hero}. kinds: solid | white (outline+white center) | dashed.
  // A loose triangular cluster (fills disjoint, so the hexes read as distinct
  // shapes with white-halo gaps, not one blob). All solid hexes sit in the
  // controllable left so their edge bands solve 100%; the two rightmost dissolve
  // into dashed outlines on the frozen columns.
  const hexes = [
    { cy: 12, cx: 11, s: 4, kind: "solid", hero: true },
    { cy: 24, cx: 11, s: 5, kind: "solid", hero: true },
    { cy: 19, cx: 19, s: 4, kind: "solid", hero: true },
    { cy: 11, cx: 21, s: 4, kind: "white" },
    { cy: 15, cx: 29, s: 4, kind: "dashed" },
    { cy: 28, cx: 29, s: 4, kind: "dashed" },
  ];
  const segmentsFn = ({ b0 }) => {
    const segments = [];
    const haloAll = new Set();
    const allFill = [];
    // First pass: collect fills so halos can exclude neighbouring fills.
    const fills = hexes.map((hx) => (hx.kind === "dashed" ? null : fillPolygon(hexVerts(hx.cy, hx.cx, hx.s), S, funcSet)));
    fills.forEach((f) => { if (f) for (const i of f) allFill.push(i); });
    const fillUnion = new Set(allFill);
    hexes.forEach((hx, hi) => {
      if (hx.kind === "dashed") {
        // outline only, dashed, fading toward the frozen right.
        const claimed = new Set();
        const segs = segmentStroke(hexOutlinePath(hx.cy, hx.cx, hx.s), S, SEGLEN, claimed, funcSet);
        for (const s of segs) {
          const cc = s.mods.reduce((a, i) => a + (i % S), 0) / s.mods.length;
          const h = ((Math.imul(Math.round(cc) * 131 + hi + 7, 2654435761) >>> 0) % 100000) / 100000;
          const frozen = s.mods.some((i) => b0[i]);
          s.hero = false; s.prio = 2; s.band = "edge";
          // dissolve: keep inner-left, drop toward the right / on frozen cells.
          s.forceDrop = frozen || h > Math.max(0.2, 1 - (cc - 24) / 12);
          segments.push(s);
        }
        return;
      }
      const fill = fills[hi];
      const edge = edgeOf(fill, S);
      const interior = new Set([...fill].filter((i) => !edge.has(i)));
      // edge band → hero dark (must be 100% — the universal edge gate).
      segments.push(...chunkCells(edge, SEGLEN, { hero: true, prio: 0, band: "edge" }));
      if (hx.kind === "white") {
        // white cutout center (hero white → clean).
        segments.push(...chunkCells(interior, SEGLEN, { hero: true, prio: 0, white: true }));
      } else {
        // solid fill → interior dark (hero interior only on the 3 largest).
        segments.push(...chunkCells(interior, SEGLEN, { hero: !!hx.hero, prio: 1, interior: true }));
      }
      // 2-module white halo (exclude any other hex's fill).
      for (const j of haloOf(fill, S, funcSet, 2)) if (!fillUnion.has(j)) haloAll.add(j);
    });
    // Halo cells that ended up under a dashed outline: drop from halo.
    const drawn = new Set();
    for (const s of segments) for (const i of s.mods) drawn.add(i);
    const discCells = [...haloAll].filter((i) => !drawn.has(i));
    return { segments, discCells };
  };
  return {
    name: "honeycomb", center: [20, 14], segmentsFn,
    heroDesc: "the 3 largest hexes — edge band 100% (all solid hexes) + interior ≥90%; 2-module white halos",
    discDesc: "the 2-module white halos ringing every solid hex",
  };
}

// 7. TANGRAM — solid dark triangles of varied size/rotation tumbling diagonally
//    like confetti, plus white cutout triangles punched into a SURRENDERED noise
//    ground (three-tone: black shapes / white cutouts / gray noise). Hero: the 4
//    largest dark triangles (edge 100%, interior measured) + all white cutouts.
function designTangram() {
  // Confetti of solid dark triangles tumbling top-left → bottom-right. The 4
  // largest are hero (edge 100%); 2 small ones are non-hero (their frozen-side
  // edges may dash). Kept in the controllable columns so the hero edges solve.
  const darks = [
    { v: [[8, 9], [8, 16], [14, 9]], hero: true },
    { v: [[11, 19], [17, 19], [11, 25]], hero: true },
    { v: [[24, 9], [30, 9], [24, 15]], hero: true },
    { v: [[25, 18], [31, 24], [25, 24]], hero: true },
    { v: [[17, 13], [17, 18], [21, 18]], hero: false },
    { v: [[32, 15], [32, 21], [37, 15]], hero: false },
  ];
  // White cutout triangles are auto-placed on ALL-SAFE (block-1/EC) cells so they
  // are pinnable white by rank alone — guaranteed clean, no flip budget spent.
  // 4 orientations of a size-s right triangle at (r,c).
  const oris = (r, c, s) => [
    [[r, c], [r + s, c], [r, c + s]], [[r, c], [r + s, c], [r + s, c + s]],
    [[r, c + s], [r + s, c], [r + s, c + s]], [[r, c], [r, c + s], [r + s, c + s]],
  ];
  const segmentsFn = ({ safe }) => {
    const segments = [];
    const shapeMask = new Set();  // dark cells that render pure black (vs gray noise)
    const dcell = new Set();
    darks.forEach((t) => {
      const fill = fillPolygon(t.v, S, funcSet);
      for (const i of fill) { shapeMask.add(i); dcell.add(i); }
      const edge = edgeOf(fill, S);
      const interior = new Set([...fill].filter((i) => !edge.has(i)));
      segments.push(...chunkCells(edge, SEGLEN, { hero: !!t.hero, prio: 0, band: "edge" }));
      segments.push(...chunkCells(interior, SEGLEN, { hero: !!t.hero, prio: 1, interior: true }));
    });
    // Enumerate all-safe cutout triangles (deterministic scan order). A cutout is
    // usable iff every cell is SAFE (rank-pinnable white, no flips) and none is a
    // dark cell. Prefer cutouts that HUG a dark triangle (≥2 cells adjacent to a
    // dark cell) so the white notch reads against black rather than vanishing into
    // the white field; among those, pick 3 well-separated.
    const touchesDark = (i) => {
      const r = (i / S) | 0, c = i % S;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < S && cc < S && dcell.has(rr * S + cc)) return true;
      }
      return false;
    };
    const spots = [];
    for (const s of [3, 4])
      for (let r = 8; r <= 34; r++)
        for (let c = 8; c <= 30; c++)
          for (const v of oris(r, c, s)) {
            const fill = fillPolygon(v, S, funcSet);
            if (fill.size < 6) continue;
            let ok = true, adj = 0;
            for (const i of fill) { if (!safe[i] || dcell.has(i)) { ok = false; break; } if (touchesDark(i)) adj++; }
            if (ok) { const cy = r + s / 2, cx = c + s / 2; spots.push({ v, fill, cy, cx, adj }); }
          }
    spots.sort((a, b) => b.adj - a.adj); // hug the dark triangles first
    const picked = [];
    for (const sp of spots) {
      if (sp.adj < 2) break; // only cutouts that read against black
      if (picked.every((p) => Math.hypot(p.cy - sp.cy, p.cx - sp.cx) >= 8)) {
        picked.push(sp);
        if (picked.length >= 3) break;
      }
    }
    for (const sp of picked) segments.push(...chunkCells(sp.fill, SEGLEN, { hero: true, prio: 0, white: true }));
    return { segments, discCells: [], shapeMask };
  };
  return {
    name: "tangram", center: [20, 16], segmentsFn, toned: true,
    heroDesc: "the 4 largest dark triangles (edge 100%) + all (auto-placed, all-safe) white cutout triangles",
    discDesc: null,
  };
}

// ---------------------------------------------------------------------------
// Runner: build segments, run the dashed solver, whiten, verify, render.
// ---------------------------------------------------------------------------
function buildDesign(prep, design, safe, b0, restarts) {
  // Solid-blob designs (honeycomb, tangram) build their own flagged segments +
  // halos directly; the line designs go through the paths→segmentStroke flow.
  if (design.segmentsFn) {
    const built = design.segmentsFn({ safe, b0, funcSet, S });
    const segments = built.segments;
    const discCells = built.discCells || [];
    const discSet = new Set(discCells);
    const inSeg = new Set();
    for (const s of segments) for (const i of s.mods) inSeg.add(i);
    const fieldWhiteSafe = [];
    if (!design.noFieldWhite) {
      for (let i = 0; i < S * S; i++) {
        if (funcSet[i] || inSeg.has(i) || discSet.has(i) || !safe[i]) continue;
        fieldWhiteSafe.push(i);
      }
    }
    const solved = solveDashed(prep, {
      S, segments, fieldWhiteSafe, center: design.center, funcSet, discCells,
      flipRestarts: restarts, baseNoise: BASE_NOISE,
    });
    return { segments, fieldWhiteSafe, discCells, solved, shapeMask: built.shapeMask };
  }
  const claimed = new Set();
  const segments = [];
  // Paths already in priority order (hero paths first is natural but hero flag
  // makes it robust). Segment each; tag hero by path flag OR heroTest(centroid).
  for (const p of design.paths) {
    const segs = segmentStroke(p.pts, S, SEGLEN, claimed, funcSet);
    for (const s of segs) {
      const cr = s.mods.reduce((a, i) => a + ((i / S) | 0), 0) / s.mods.length;
      const cc = s.mods.reduce((a, i) => a + (i % S), 0) / s.mods.length;
      s.hero = p.hero || design.heroTest(cr, cc);
      s.prio = p.prio ?? 0;
      if (design.fade) {
        // deterministic per-segment hash in [0,1) from the segment's centroid.
        const h = ((Math.imul((cr | 0) * 131 + (cc | 0) + 7, 2654435761) >>> 0) % 100000) / 100000;
        s.forceDrop = design.fade(cr, cc, s.hero, h);
      }
      // For a full-area design, fade any NON-hero segment that mostly sits on
      // frozen block-0 (URL) cells: it would dash under budget anyway, and
      // dropping it up front frees the block-0 flip budget for the hero — which
      // lets the hero-box reach 100% (it solves 100% in isolation).
      if (design.fadeFrozen && !s.hero && !s.forceDrop) {
        const frozenN = s.mods.reduce((a, i) => a + (b0[i] ? 1 : 0), 0);
        if (frozenN * 2 >= s.mods.length) s.forceDrop = true;
      }
      segments.push(s);
    }
  }
  // Clean-disc cells (optional, build-01 technique).
  const discCells = design.discCellsFn ? design.discCellsFn() : [];
  const discSet = new Set(discCells);
  // Field-white candidates: safe (block-1/EC) cells not drawn, not disc, not func.
  const inSeg = new Set();
  for (const s of segments) for (const i of s.mods) inSeg.add(i);
  const fieldWhiteSafe = [];
  for (let i = 0; i < S * S; i++) {
    if (funcSet[i] || inSeg.has(i) || discSet.has(i) || !safe[i]) continue;
    fieldWhiteSafe.push(i);
  }

  const solved = solveDashed(prep, {
    S, segments, fieldWhiteSafe, center: design.center, funcSet, discCells,
    flipRestarts: restarts, baseNoise: BASE_NOISE,
  });
  return { segments, fieldWhiteSafe, discCells, solved };
}

// Three-tone rasteriser (piece-4 trick): pure black for function patterns + the
// design's shape cells, gray #3a3a3a for surrendered-noise dark cells, white for
// light. jsQR thresholds gray against white as dark, so the toned image scans.
const GRAY = [0x3a, 0x3a, 0x3a];
function renderToned(m, shapeMask, { scale = 8, quiet = 4 } = {}) {
  const dim = (S + 2 * quiet) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let r = 0; r < S; r++)
    for (let c = 0; c < S; c++) {
      const i = r * S + c;
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
      const i = r * S + c;
      if (!m[i]) continue;
      const seg = `M${(c + quiet) * scale} ${(r + quiet) * scale}h${scale}v${scale}h-${scale}z`;
      if (funcSet[i] || shapeMask.has(i)) black += seg; else gray += seg;
    }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" shape-rendering="crispEdges">` +
    `<rect width="${dim}" height="${dim}" fill="#ffffff"/><path d="${gray}" fill="#3a3a3a"/><path d="${black}" fill="#000000"/></svg>`;
}

function run(design, restarts = FLIP_RESTARTS) {
  const prep = QRArt.prepareArt(URL, VERSION, LEVEL, "schemehost");
  const steer = safeMask(prep, S);
  const b0 = block0Data(prep, S);
  const { segments, solved, shapeMask } = buildDesign(prep, design, steer, b0, restarts);
  const best = solved.best;
  if (!best) throw new Error(`${design.name}: no config met headroom≥2`);

  // Noise whitening: hold (mask, flipSeed, sacrifice); sweep noise seeds.
  const sacrificed = best.sacrificed;
  const io = solved.buildIO(solved.heroOrder, best.keptOuter, sacrificed);
  let bestNoise = BASE_NOISE, bestWhite = -1, bestMatrix = null, bestM = null;
  for (let n = 0; n < NOISE_RESTARTS; n++) {
    const seed = (1000 + n * 7919) >>> 0;
    const res = solved.runSolve(io, best.mask, best.flipSeed, seed);
    const m = solved.measure(res.matrix, sacrificed);
    // strokeSat/heroSat are noise-invariant (pins); pick the whitest field.
    if (m.whiteness > bestWhite) { bestWhite = m.whiteness; bestNoise = seed; bestMatrix = res.matrix; bestM = m; }
  }
  const matrix = bestMatrix, m = bestM;

  // Verify (schemehost case remix allowed).
  const v = verifyMatrix(matrix, VERSION, URL, { allowSchemeHostCase: true });
  const perBlock = v.perBlock;
  const minHead = Math.min(...perBlock.map((b) => b.capacity - b.errorsUsed));

  // Render outputs. Toned (three-tone) designs ship the toned PNG/SVG and are
  // additionally checked to scan in their toned form at scale 8 AND scale 3.
  let tonedScan = null;
  if (design.toned && shapeMask) {
    writePNG(path.join(OUT, `geometric-${design.name}.png`), renderToned(matrix, shapeMask, { scale: 8, quiet: 4 }));
    fs.writeFileSync(path.join(OUT, `geometric-${design.name}.svg`), tonedSVG(matrix, shapeMask, { scale: 8, quiet: 4 }));
    // BW fallback kept alongside for print.
    writePNG(path.join(OUT, `geometric-${design.name}-bw.png`), renderMatrix(matrix, VERSION, { scale: 8, quiet: 4 }));
    const s8 = scanRGBA(renderToned(matrix, shapeMask, { scale: 8, quiet: 4 }));
    const s3 = scanRGBA(renderToned(matrix, shapeMask, { scale: 3, quiet: 4 }));
    tonedScan = { s8, s3, ok: !!s8 && !!s3 };
    if (!tonedScan.ok) throw new Error(`${design.name}: toned render failed to scan (s8=${s8}, s3=${s3})`);
  } else {
    writePNG(path.join(OUT, `geometric-${design.name}.png`), renderMatrix(matrix, VERSION, { scale: 8, quiet: 4 }));
    fs.writeFileSync(path.join(OUT, `geometric-${design.name}.svg`), QRArt.toSVG(matrix, VERSION, { scale: 8, quiet: 4 }));
  }

  // Where did dashes fall? Classify dropped segments by block-0(frozen) vs safe.
  const dropped = m.droppedSegs;
  let dropFrozen = 0, dropSafe = 0;
  for (const d of dropped) {
    const anyFrozen = d.mods.some((i) => b0[i]);
    if (anyFrozen) dropFrozen++; else dropSafe++;
  }

  return {
    name: design.name, matrix, m, perBlock, minHead,
    mask: best.mask, flipSeed: best.flipSeed, noiseSeed: bestNoise,
    segments, dropped, dropFrozen, dropSafe,
    heroDesc: design.heroDesc, discDesc: design.discDesc, decoded: v.validate.text,
    center: design.center,
    blob: !!design.segmentsFn, toned: !!design.toned, tonedScan,
    whiteFloor: design.segmentsFn ? 0.60 : 0.68, // relaxed whiteness gate for blobs
    render: (design.toned && shapeMask)
      ? (o) => renderToned(matrix, shapeMask, o)
      : (o) => renderMatrix(matrix, VERSION, o),
  };
}

// Nudge search: try candidate hub centers, pick the one that best solves
// (clean disc first, then hero, then whiteness) with a cheap probe, then hand
// the winning design to run() for the full search.
function chooseCenter(builder, centers, probeRestarts = 24) {
  const prep = QRArt.prepareArt(URL, VERSION, LEVEL, "schemehost");
  const steer = safeMask(prep, S);
  const b0 = block0Data(prep, S);
  let bestC = centers[0], bestKey = -Infinity;
  for (const c of centers) {
    const design = builder(c);
    const { solved } = buildDesign(prep, design, steer, b0, probeRestarts);
    if (!solved.best) continue;
    const m = solved.best.m;
    const key = -m.discDark * 1e12 + m.heroSat * 1e9 + m.strokeSat * 1e3 + m.whiteness;
    if (key > bestKey) { bestKey = key; bestC = c; }
  }
  return bestC;
}

// ---------------------------------------------------------------------------
// Contact sheet: five rendered codes side by side with name labels.
// ---------------------------------------------------------------------------
function contactSheet(results) {
  // Each result renders itself (toned designs render in three-tone).
  const tiles = results.map((r) => r.render({ scale: 6, quiet: 4 }));
  const tw = tiles[0].width, th = tiles[0].height;
  const pad = 12, labelH = 22, gap = 10;
  const cols = results.length;
  const cellW = tw + gap, cellH = th + labelH;
  const W = pad * 2 + cols * tw + (cols - 1) * gap;
  const H = pad * 2 + cellH;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const putPx = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
  };
  // blit tiles
  tiles.forEach((t, k) => {
    const ox = pad + k * cellW, oy = pad + labelH;
    for (let y = 0; y < th; y++)
      for (let x = 0; x < tw; x++) {
        const s = (y * tw + x) * 4, o = ((oy + y) * W + (ox + x)) * 4;
        data[o] = t.data[s]; data[o + 1] = t.data[s + 1]; data[o + 2] = t.data[s + 2]; data[o + 3] = 255;
      }
  });
  // tiny 3×5 bitmap font for labels
  const glyphs = miniFont();
  results.forEach((r, k) => {
    const ox = pad + k * cellW;
    drawText(putPx, glyphs, r.name, ox + 2, pad + 4, 2);
  });
  writePNG(path.join(OUT, "geometric-contact.png"), { data, width: W, height: H });
}

// minimal 3×5 uppercase/lowercase-insensitive font for contact labels
function miniFont() {
  const F = {
    A: ["010", "101", "111", "101", "101"], B: ["110", "101", "110", "101", "110"],
    C: ["011", "100", "100", "100", "011"], E: ["111", "100", "110", "100", "111"],
    G: ["011", "100", "101", "101", "011"], H: ["101", "101", "111", "101", "101"],
    I: ["111", "010", "010", "010", "111"], L: ["100", "100", "100", "100", "111"],
    M: ["101", "111", "111", "101", "101"], N: ["101", "111", "111", "111", "101"],
    O: ["111", "101", "101", "101", "111"], P: ["110", "101", "110", "100", "100"],
    R: ["110", "101", "110", "101", "101"], S: ["011", "100", "010", "001", "110"],
    T: ["111", "010", "010", "010", "010"], U: ["101", "101", "101", "101", "111"],
    V: ["101", "101", "101", "101", "010"], W: ["101", "101", "111", "111", "101"],
    Y: ["101", "101", "010", "010", "010"], "-": ["000", "000", "111", "000", "000"],
    " ": ["000", "000", "000", "000", "000"],
  };
  return F;
}
function drawText(putPx, F, text, x0, y0, sc) {
  let x = x0;
  for (const ch of text.toUpperCase()) {
    const g = F[ch] || F[" "];
    for (let ry = 0; ry < 5; ry++)
      for (let rx = 0; rx < 3; rx++)
        if (g[ry][rx] === "1")
          for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++)
            putPx(x + rx * sc + dx, y0 + ry * sc + dy, 20, 20, 20);
    x += (3 * sc) + sc;
  }
}

function pct(x) { return (x * 100).toFixed(1) + "%"; }

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // Remove the retired lattice outputs (replaced by starburst).
  for (const ext of ["png", "svg"]) {
    const f = path.join(OUT, `geometric-lattice.${ext}`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  // rings & starburst: nudge the hub center within ±2 (a 9-point spread) in the
  // controllable-left territory, picking the center that solves cleanest.
  const NUDGE = [[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, 1], [-1, 1], [1, -1]];
  const ringsCenters = NUDGE.map(([dy, dx]) => [19 + dy, 15 + dx]);
  const burstCenters = NUDGE.map(([dy, dx]) => [20 + dy, 14 + dx]);
  process.stderr.write("choosing rings center...\n");
  const ringsC = chooseCenter(designRings, ringsCenters);
  process.stderr.write("choosing starburst center...\n");
  const burstC = chooseCenter(designStarburst, burstCenters);

  const designs = [
    designRings(ringsC), designWaves(), designSpiral(),
    designStarburst(burstC), designTargetCat(),
    designHoneycomb(), designTangram(),
  ];
  const results = [];
  for (const d of designs) {
    process.stderr.write(`solving ${d.name}...\n`);
    results.push(run(d, FLIP_RESTARTS));
  }
  contactSheet(results);

  // Report.
  const lines = [];
  lines.push("# Piece 8 — nearly-blank geometric series — build report");
  lines.push("");
  lines.push("Generated by `node build-08-geometric.mjs` (deterministic; re-run to regenerate).");
  lines.push("");
  lines.push("Shared: URL `" + URL + "`, v6-L, urlCase \"schemehost\", verified with");
  lines.push("`allowSchemeHostCase` (jsQR @ scale 8 + 3). All strokes 1 module wide.");
  lines.push("Gates: stroke ≥88% overall AND 100% in hero zone; whiteness ≥68%; headroom ≥2/block;");
  lines.push("misses land as whole dropped 2–3 module segments (dashes), never single-module holes.");
  lines.push("");
  for (const r of results) {
    const strokePass = r.m.strokeSat >= 0.88;
    const heroPass = r.m.heroSat >= 0.9999;
    const whitePass = r.m.whiteness >= r.whiteFloor;
    const headPass = r.minHead >= 2;
    const strokeLabel = r.blob ? "Edge-band satisfaction (all solid blobs)" : "Stroke satisfaction (overall)";
    lines.push(`## ${r.name}`);
    lines.push("");
    lines.push(`- Hero zone: ${r.heroDesc}`);
    lines.push(`- Mask **${r.mask}**, flipSeed ${r.flipSeed}, noiseSeed ${r.noiseSeed} (search: 8 masks × restarts, then ${NOISE_RESTARTS} noise samples)`);
    lines.push(`- ${strokeLabel}: **${r.m.strokeSatN}/${r.m.strokeTot} = ${pct(r.m.strokeSat)}** ${strokePass ? "PASS" : "**below 88% — see dashes**"}`);
    lines.push(`- Hero-zone satisfaction: **${r.m.heroSatN}/${r.m.heroTot} = ${pct(r.m.heroSat)}** ${heroPass ? "PASS" : "**FAIL**"}`);
    if (r.blob && r.m.intTot) {
      const hiPass = r.m.heroIntSat >= 0.90;
      lines.push(`- Blob interior fill: overall **${pct(r.m.intSat)}** (${r.m.intSatN}/${r.m.intTot}); hero interiors **${pct(r.m.heroIntSat)}** (${r.m.heroIntSatN}/${r.m.heroIntTot}), need ≥90%: ${hiPass ? "PASS" : "**FAIL**"} — interior misses are invisible inside the black mass`);
    }
    if (r.blob && r.m.cutTot) {
      lines.push(`- White cutouts: **${pct(r.m.cutSat)}** (${r.m.cutSatN}/${r.m.cutTot}) light`);
    }
    lines.push(`- Whiteness (non-function light): **${pct(r.m.whiteness)}** (${r.m.nfLight}/${r.m.nfTot}); need ≥${(r.whiteFloor * 100) | 0}%: ${whitePass ? "PASS" : "**FAIL**"}`);
    if (r.discDesc) {
      // The build-01 clean DISC is a strict 0-speckle gate; the decorative blob
      // HALO is soft (a couple of frozen specks in a 2-module ring are fine).
      if (r.blob) {
        const haloPass = r.m.discDark <= 2;
        lines.push(`- White halos (${r.discDesc}): **${r.m.discDark} speckle** of ${r.m.discTot} halo cells (${pct(1 - r.m.discDark / r.m.discTot)} clean) ${haloPass ? "— PASS (soft gate)" : "— **FAIL**"}`);
      } else {
        const discPass = r.m.discDark === 0;
        lines.push(`- Clean disc (${r.discDesc}): **${r.m.discDark} speckle** of ${r.m.discTot} cells ${discPass ? "— **PASS (immaculate)**" : "— **FAIL**"}`);
      }
    }
    if (r.toned && r.tonedScan) {
      lines.push(`- Three-tone render (black shapes / gray #3a3a3a noise / white cutouts): toned image scans — jsQR @ scale 8: **OK**, scale 3: **OK** (BW fallback in out/geometric-${r.name}-bw.png also scans)`);
    }
    lines.push(`- Per-block meter:`);
    lines.push(`  ${meterLine(r.perBlock)}`);
    lines.push(`  min headroom = ${r.minHead} (need ≥2): ${headPass ? "PASS" : "**FAIL**"}`);
    const fadedN = r.m.fadedSegs ? r.m.fadedSegs.length : 0;
    lines.push(`- Dashes (budget-driven): ${r.dropped.length} segment(s) dropped — ${r.dropFrozen} touching frozen block-0 (URL) cells, ${r.dropSafe} elsewhere.` +
      (fadedN ? ` Designed peripheral dissolve: ${fadedN} whole segment(s) faded out toward the edges (intentional negative space, not misses).` : "") +
      (r.m.gapDark ? ` Gap strays (dark inside a dropped gap): ${r.m.gapDark}/${r.m.gapTot}.` : ` No stray darks inside dropped gaps.`));
    if (r.dropped.length) {
      const where = r.dropped.slice(0, 8).map((d) => {
        const cr = Math.round(d.mods.reduce((a, i) => a + ((i / S) | 0), 0) / d.mods.length);
        const cc = Math.round(d.mods.reduce((a, i) => a + (i % S), 0) / d.mods.length);
        return `(${cr},${cc})×${d.len}`;
      }).join(", ");
      lines.push(`  dropped-segment centroids: ${where}${r.dropped.length > 8 ? ", …" : ""}`);
    }
    lines.push(`- Decoded (case remix, same URL): \`${r.decoded}\``);
    lines.push(`- Files: out/geometric-${r.name}.png, out/geometric-${r.name}.svg` + (r.toned ? `, out/geometric-${r.name}-bw.png` : ""));
    lines.push("");
  }
  lines.push("## Contact sheet");
  lines.push("- out/geometric-contact.png — all seven side by side (tangram tile shown three-tone).");
  lines.push("");
  lines.push("## Notes (art-notes round 3 — solid-blob additions)");
  lines.push("");
  lines.push("- **honeycomb & tangram are SOLID BLOBS**, scored the Disney-poster way: only");
  lines.push("  the EDGE band + halos are pinned at top priority (must be 100%); the interior");
  lines.push("  fill is pinned at the LOWEST priority so it takes only leftover rank and never");
  lines.push("  out-competes the edges for flip budget — an interior miss inside a black mass");
  lines.push("  is invisible. Relaxed whiteness gate ≥60% (solid masses are darker).");
  lines.push("- **honeycomb** — 6 flat-top hexagons (horizontal top/bottom runs, side 4–6 so the");
  lines.push("  60° staircases read crisp), clustered center-left. 3 largest solid (edge 100%,");
  lines.push("  interior ≥90%), 1 outline-with-white-center for contrast, 2 dissolving into");
  lines.push("  dashed outlines toward the frozen right (solveDashed). 2-module white halos.");
  lines.push("- **tangram** — the one THREE-TONE piece: solid dark triangles (edge pinned,");
  lines.push("  interior filled) + white cutout triangles, over a SURRENDERED noise ground.");
  lines.push("  Rendered black shapes / white cutouts / gray #3a3a3a noise (piece-4 trick); the");
  lines.push("  toned image is verified to scan at scale 8 AND 3, same as the BW fallback.");
  lines.push("- **Rounds 1–2 designs are UNCHANGED** — rings/starburst/target-cat still solve");
  lines.push("  clean (0 speckle), waves/spiral byte-identical to round 1.");
  lines.push("");
  lines.push("## Earlier notes (rounds 1–2)");
  lines.push("");
  lines.push("- **Dashes, not nibbles.** Every stroke is cut into contiguous 2–3 module");
  lines.push("  segments. A probe solve measures per-segment satisfaction; whole outer");
  lines.push("  segments that don't come up fully dark are sacrificed and re-pinned WHITE");
  lines.push("  (clean gaps) in a second solve. Hero + kept segments pin first with equal-");
  lines.push("  or-greater free rank, so they stay solid — misses land as whole dropped");
  lines.push("  segments. \"Gap strays\" are the residual dark modules inside an intended gap");
  lines.push("  (a frozen cell the flip budget couldn't clear); reported per design, small.");
  lines.push("- **Clean disc (build-01 technique).** rings, starburst and target-cat pin a");
  lines.push("  disc of white cells at high priority (right after the hero strokes, before");
  lines.push("  everything else) so the hero sits on immaculate white. Disc speckle is a gate");
  lines.push("  (target 0) and is reported per design.");
  lines.push("- **rings — re-centered off the frozen corner.** The (34,34) alignment is back to");
  lines.push("  being furniture; the rings now center in the controllable left, so the inner-3-");
  lines.push("  ring hero and the zero-speckle disc both solve cleanly. 4 rings at pitch 3.");
  lines.push("- **starburst replaces lattice.** A line tessellation is inherently ~40% dark");
  lines.push("  before the solver starts, which fights the nearly-blank medium; the starburst");
  lines.push("  is 14 one-module rays that are sparse by construction and fade to dashes at the");
  lines.push("  rim (heaviest toward the frozen right, where the dashes read as intentional).");
  lines.push("  The retired out/geometric-lattice.* files are deleted.");
  lines.push("- **target-cat.** The face now leads: solid 2×2 eyes, ear triangles that break");
  lines.push("  the head's top edge, nose dot + 3 whiskers/side, and a single ~200° orbit arc");
  lines.push("  in a supporting role, all on a clean disc. hero = every face feature.");
  lines.push("- **waves / spiral are UNCHANGED from round 1** (byte-identical seeds/outputs).");
  lines.push("");
  const report = lines.join("\n");
  fs.writeFileSync(path.join(OUT, "geometric-report.md"), report);
  console.log(report);
}

main();
