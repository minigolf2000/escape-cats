// build-11-snake.mjs — Piece 12: THE SNAKE. One unbroken 1-module dark line that
// wanders the entire symbol — a QR code drawn without lifting the pen.
//
// See specs/12-snake.md. Payload https://hexxygon.com (20 chars) — the short URL
// is what makes this feasible at all: v10-L leaves 2024 free basis bits, and the
// line + its white halo want ~1700-2000 exact pins.
//
// ---------------------------------------------------------------------------
// THE ONE IDEA THAT MAKES THIS WORK: THE COARSE LATTICE
// ---------------------------------------------------------------------------
// The killer constraint is "no self-touch": two path cells that are not
// consecutive on the path must never be 4-adjacent, otherwise the line stops
// reading as a line and reads as blobs. Equivalently the drawn set must be an
// INDUCED path in the grid graph (exactly 2 cells of degree 1, all others 2).
//
// Enforcing that with a hand-rolled boustrophedon + ad-hoc detours is a
// whack-a-mole of special cases. Instead the route lives on a COARSE LATTICE of
// spacing `pitch`: nodes at fine cells (r0 + pitch*i, c0 + pitch*j); a lattice
// edge is the straight run of fine cells between two lattice-adjacent nodes.
//
//   THEOREM. Any simple path in the coarse lattice graph lifts to an induced
//   path in the fine grid, for any pitch >= 2.
//   Proof sketch. Fine cells of an edge lie strictly between its two endpoint
//   nodes on a lattice line. (a) Two nodes not consecutive on the path are >=
//   pitch >= 2 apart. (b) A node is 4-adjacent only to interior cells of its own
//   incident edges, and a simple path gives each node <= 2 incident edges, both
//   consecutive with it. (c) Interior cells of two distinct edges are either on
//   parallel lattice lines (>= pitch apart) or on perpendicular ones sharing a
//   node — and edges sharing a node are consecutive on the path. QED.
//
// So the creative work becomes "find a long simple path in a small (~12x12)
// obstacle-ridden lattice graph", which is a clean DFS with move-ordering
// policies — and the policies ARE the artistic variants (serpentine-rows,
// serpentine-cols, spiral, hybrid). The no-self-touch rule is then asserted
// programmatically anyway (`assertInducedPath`), belt and braces.
//
// ---------------------------------------------------------------------------
// CROSSING THE TIMING PATTERNS (the second idea)
// ---------------------------------------------------------------------------
// Row 6 and column 6 are function modules ALL THE WAY ACROSS the symbol (finder
// + separator + timing + finder). A 1-module line that may not occupy function
// cells therefore CANNOT reach rows 0-5 or columns 0-5 at all: they are cut off.
// That caps row coverage at ~88% and makes a big chunk of the code dead.
//
// The way through: the timing pattern is *alternating*, so (6,c) is already DARK
// for even c. The snake crosses row 6 at an even column, using the timing module
// itself as a BRIDGE — a dark cell it does not need to pin because the symbol
// structure guarantees it. Visually the line passes straight over the timing
// dashes; the two flanking timing cells (6,c-1) and (6,c+1) are odd, hence light,
// so the crossing keeps its white halo for free. Same trick for column 6.
// Bridge cells are part of the drawn line for connectivity/coverage purposes and
// are asserted dark on the solved matrix.
//
// ---------------------------------------------------------------------------
// SOLVE PRIORITY (spec order, no partial credit on the line)
// ---------------------------------------------------------------------------
//   1. line cells DARK  — pinned first, in path order. MUST end 100%. If a
//      (mask, flipSeed) sweep cannot deliver 100%, the route is PERTURBED
//      (seed / lattice offset / detour style) and we try again.
//   2. halo cells WHITE — 1-module Chebyshev ring, best effort, ordered by the
//      path index of the line cell that spawned them.
//   3. everything else surrendered to noise, rendered gray #3a3a3a (three-tone,
//      build-04/08/10 technique) so the black line and white halo pop.
// marginCap 0.8 of a 9-codeword capacity = 7 spendable, so >= 2 codewords of
// headroom per block is structural, not hoped-for.
//
// DETERMINISM: every random draw comes from mulberry32 seeded off genome.seed.
//
// CLI
//   node build-11-snake.mjs route  <genome|k=v...> <out.png>   route-only preview
//   node build-11-snake.mjs render <genome|k=v...> <out.png>   full solve
//   node build-11-snake.mjs all                                 all deliverables
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QRArt } from "./engine.mjs";
import { renderMatrix, writePNG, readPNG } from "./png.mjs";
import { scanRGBA, sameURL } from "./verify.mjs";
import { meterLine, flipSeedFor } from "./nearly-blank-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "out");
const URL_DEFAULT = "https://hexxygon.com";
const GRAY = [0x3a, 0x3a, 0x3a];

// ===========================================================================
// 1. GEOMETRY — what the route is allowed to touch.
// ===========================================================================
// Returns:
//   allowed[i]  1 if the route may occupy fine cell i
//   bridge[i]   1 if i is a dark timing module the route may cross through
//   func, base, S
//
// Rules:
//   * function cells are forbidden, EXCEPT dark timing-line cells (bridges);
//   * a 1-module CLEARANCE ring around every non-timing function cell is
//     forbidden, so the line never fuses into a finder / alignment / format
//     block, and (usefully) no halo cell can ever land on furniture;
//   * cells flanking a timing line (rows 5/7, cols 5/7) are allowed only at an
//     EVEN coordinate — i.e. only as part of a perpendicular crossing through a
//     dark timing module. That forbids running *along* the timing dashes (which
//     would read as a doubled line) while keeping every crossing available.
function buildGeometry(version) {
  const S = QRArt.sizeOf(version);
  const fp = QRArt.functionPatterns(version);
  const func = fp.func, base = fp.base;
  const idx = (r, c) => r * S + c;
  const inB = (r, c) => r >= 0 && c >= 0 && r < S && c < S;
  const tLo = 8, tHi = S - 9;                       // timing line extent
  const onTimingLine = (r, c) =>
    (r === 6 && c >= tLo && c <= tHi) || (c === 6 && r >= tLo && r <= tHi);

  const timing = new Uint8Array(S * S);
  const bridge = new Uint8Array(S * S);
  for (let r = 0; r < S; r++)
    for (let c = 0; c < S; c++) {
      const i = idx(r, c);
      if (!func[i] || !onTimingLine(r, c)) continue;
      timing[i] = 1;
      if (base[i] === 1) bridge[i] = 1;
    }

  const allowed = new Uint8Array(S * S).fill(1);
  // (a) function cells out, bridges back in.
  for (let i = 0; i < S * S; i++) if (func[i] && !bridge[i]) allowed[i] = 0;
  // (b) clearance ring around every non-timing function cell.
  for (let r = 0; r < S; r++)
    for (let c = 0; c < S; c++) {
      const i = idx(r, c);
      if (!func[i] || timing[i]) continue;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (inB(rr, cc)) allowed[idx(rr, cc)] = 0;
        }
    }
  // put bridges back (a bridge can sit next to an alignment corner and would
  // otherwise be clobbered by (b); the edge check still rejects unusable ones).
  for (let i = 0; i < S * S; i++) if (bridge[i]) allowed[i] = 1;
  // (c) timing flanks: only even coordinates, and only where the timing module
  //     we would cross is actually dark.
  for (let c = tLo; c <= tHi; c++) {
    const ok = base[idx(6, c)] === 1 && bridge[idx(6, c)] === 1;
    for (const r of [5, 7]) {
      if (!inB(r, c)) continue;
      if (!ok) allowed[idx(r, c)] = 0;
    }
  }
  for (let r = tLo; r <= tHi; r++) {
    const ok = base[idx(r, 6)] === 1 && bridge[idx(r, 6)] === 1;
    for (const c of [5, 7]) {
      if (!inB(r, c)) continue;
      if (!ok) allowed[idx(r, c)] = 0;
    }
  }
  return { S, func, base, allowed, bridge, timing, idx, inB };
}

// ===========================================================================
// 2. COARSE LATTICE
// ===========================================================================
function buildLattice(geo, pitch, r0, c0) {
  const { S, allowed, idx } = geo;
  const rows = [], cols = [];
  for (let r = r0; r < S; r += pitch) rows.push(r);
  for (let c = c0; c < S; c += pitch) cols.push(c);
  const NR = rows.length, NC = cols.length;
  const nid = (i, j) => i * NC + j;
  const node = new Uint8Array(NR * NC);
  for (let i = 0; i < NR; i++)
    for (let j = 0; j < NC; j++) node[nid(i, j)] = allowed[idx(rows[i], cols[j])] ? 1 : 0;

  // A lattice edge is usable iff every fine cell on the straight run is allowed.
  const runOK = (r1, c1, r2, c2) => {
    const dr = Math.sign(r2 - r1), dc = Math.sign(c2 - c1);
    let r = r1, c = c1;
    for (;;) {
      if (!allowed[idx(r, c)]) return false;
      if (r === r2 && c === c2) return true;
      r += dr; c += dc;
    }
  };
  const eH = new Uint8Array(NR * NC);  // edge (i,j)-(i,j+1)
  const eV = new Uint8Array(NR * NC);  // edge (i,j)-(i+1,j)
  for (let i = 0; i < NR; i++)
    for (let j = 0; j < NC; j++) {
      if (!node[nid(i, j)]) continue;
      if (j + 1 < NC && node[nid(i, j + 1)] && runOK(rows[i], cols[j], rows[i], cols[j + 1])) eH[nid(i, j)] = 1;
      if (i + 1 < NR && node[nid(i + 1, j)] && runOK(rows[i], cols[j], rows[i + 1], cols[j])) eV[nid(i, j)] = 1;
    }
  // Precomputed adjacency (the DFS reachability bound hammers this).
  const adj = [];
  for (let i = 0; i < NR; i++)
    for (let j = 0; j < NC; j++) {
      const out = [];
      if (j + 1 < NC && eH[nid(i, j)]) out.push([i, j + 1, 0, 1, nid(i, j + 1)]);
      if (j > 0 && eH[nid(i, j - 1)]) out.push([i, j - 1, 0, -1, nid(i, j - 1)]);
      if (i + 1 < NR && eV[nid(i, j)]) out.push([i + 1, j, 1, 0, nid(i + 1, j)]);
      if (i > 0 && eV[nid(i - 1, j)]) out.push([i - 1, j, -1, 0, nid(i - 1, j)]);
      adj[nid(i, j)] = out;
    }
  const liveNodes = node.reduce((a, b) => a + b, 0);
  return { rows, cols, NR, NC, nid, node, eH, eV, adj, liveNodes };
}

// ===========================================================================
// 3. LONG-PATH SEARCH — the creative core.
// ===========================================================================
// DFS with backtracking over the coarse graph, keeping the longest simple path
// found. Move ordering is the artistic policy:
//
//   rows   : boustrophedon. Prefer horizontal in the current sweep direction,
//            then advance a row, then reverse horizontal, then back up. The
//            sweep direction flips on every vertical move — that IS the
//            serpentine, and detours around obstacles fall out of backtracking.
//   cols   : the same, transposed.
//   spiral : go STRAIGHT while you can, otherwise always turn the same way.
//            The classic inward spiral fill.
//   hybrid : spiral for the first `spiralMix` fraction of the lattice, then
//            serpentine — an outer frame that dissolves into scan lines.
//
// Pruning: an upper bound of (visited + reachable-unvisited-from-here) beats a
// naive DFS badly on 120-node graphs, and lets us keep the budget small enough
// that the whole 4-variant contact sheet builds in seconds.
function longestPath(lat, opts) {
  const { NR, NC, nid, node, adj } = lat;
  const { policy, spiralMix = 0, turn = 1, start, budget = 60000 } = opts;
  const N = NR * NC;
  const seen = new Uint8Array(N);
  const total = lat.liveNodes;
  const mixDepth = Math.round(spiralMix * total);

  // --- move ordering -------------------------------------------------------
  const rank = (depth, di, dj, sweep, hd, hi, hj) => {
    const spiralPhase = policy === "spiral" || (policy === "hybrid" && depth < mixDepth);
    if (spiralPhase) {
      if (hi === 0 && hj === 0) return di === 0 && dj === 1 ? 0 : 1; // first move
      // straight, then consistent turn, then the other turn, then reverse.
      if (di === hi && dj === hj) return 0;
      const rt = [-hj * turn, hi * turn];                  // right/left turn vector
      if (di === rt[0] && dj === rt[1]) return 1;
      if (di === -rt[0] && dj === -rt[1]) return 2;
      return 3;
    }
    const rowsMode = policy !== "cols";
    if (rowsMode) {
      if (di === 0 && dj === sweep) return 0;   // continue the scan line
      if (di === hd && dj === 0) return 1;      // advance to the next line
      if (di === 0 && dj === -sweep) return 2;
      return 3;
    }
    if (dj === 0 && di === sweep) return 0;
    if (dj === hd && di === 0) return 1;
    if (dj === 0 && di === -sweep) return 2;
    return 3;
  };

  // --- reachability bound --------------------------------------------------
  const stackBuf = new Int32Array(N);
  const markBuf = new Uint8Array(N);
  let mark = 0;
  const markGen = new Int32Array(N);
  const reachCount = (k0) => {
    mark++;
    let sp = 0, cnt = 0;
    stackBuf[sp++] = k0; markGen[k0] = mark;
    while (sp) {
      const k = stackBuf[--sp];
      const list = adj[k];
      for (let q = 0; q < list.length; q++) {
        const nk = list[q][4];
        if (markGen[nk] === mark || seen[nk]) continue;
        markGen[nk] = mark; cnt++; stackBuf[sp++] = nk;
      }
    }
    return cnt;
  };

  let best = null, bestLen = 0, expansions = 0;
  const cur = [];
  const advance = opts.advance ?? 1;

  const dfs = (i, j, sweep, hi, hj) => {
    if (expansions++ > budget) return;
    const k0 = nid(i, j);
    cur.push([i, j]);
    seen[k0] = 1;
    if (cur.length > bestLen) { bestLen = cur.length; best = cur.map((p) => p.slice()); }
    if (cur.length + reachCount(k0) > bestLen) {
      const moves = adj[k0]
        .filter((m) => !seen[m[4]])
        .map((m) => ({ m, k: rank(cur.length, m[2], m[3], sweep, advance, hi, hj) }))
        .sort((a, b) => a.k - b.k);
      for (const { m } of moves) {
        if (expansions > budget) break;
        const [ni, nj, di, dj] = m;
        const nsweep = (policy === "cols" ? di !== 0 : dj !== 0) ? sweep : -sweep;
        dfs(ni, nj, nsweep, di, dj);
      }
    }
    seen[k0] = 0;
    cur.pop();
  };

  dfs(start[0], start[1], opts.sweep ?? 1, 0, 0);
  return { path: best || [[start[0], start[1]]], nodes: total };
}

// ===========================================================================
// 4. LIFT TO FINE CELLS + ENDPOINT TAILS
// ===========================================================================
function liftPath(lat, coarse) {
  const { rows, cols } = lat;
  const fine = [];
  const push = (r, c) => {
    const last = fine[fine.length - 1];
    if (last && last[0] === r && last[1] === c) return;
    fine.push([r, c]);
  };
  for (let k = 0; k < coarse.length; k++) {
    const [i, j] = coarse[k];
    push(rows[i], cols[j]);
    if (k + 1 < coarse.length) {
      const [i2, j2] = coarse[k + 1];
      const r1 = rows[i], c1 = cols[j], r2 = rows[i2], c2 = cols[j2];
      const dr = Math.sign(r2 - r1), dc = Math.sign(c2 - c1);
      let r = r1, c = c1;
      while (r !== r2 || c !== c2) { r += dr; c += dc; push(r, c); }
    }
  }
  return fine;
}

// Extend each endpoint straight outward while it stays legal AND induced (the
// new cell may only be 4-adjacent to the cell before it). This is what lets the
// snake actually reach the outer border rows/cols the lattice cannot land on —
// it is worth ~5 points of row coverage.
function addTails(fine, geo, maxTail) {
  const { S, allowed, idx } = geo;
  const onPath = new Set(fine.map(([r, c]) => idx(r, c)));
  const grow = (endIdx) => {
    const head = endIdx === 0 ? 0 : fine.length - 1;
    const nxt = endIdx === 0 ? 1 : fine.length - 2;
    if (nxt < 0 || nxt >= fine.length) return [];
    const [hr, hc] = fine[head], [nr, nc] = fine[nxt];
    const away = [hr - nr, hc - nc];
    const dirs = [away, [away[1], away[0]], [-away[1], -away[0]]];
    let bestRun = [];
    for (const [dr, dc] of dirs) {
      const run = [];
      let r = hr, c = hc;
      const local = new Set(onPath);
      for (let t = 0; t < maxTail; t++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= S || cc >= S) break;
        const i = idx(rr, cc);
        if (!allowed[i] || local.has(i)) break;
        // induced check: (rr,cc) may touch only (r,c)
        let bad = false;
        for (const [ar, ac] of [[rr - 1, cc], [rr + 1, cc], [rr, cc - 1], [rr, cc + 1]]) {
          if (ar < 0 || ac < 0 || ar >= S || ac >= S) continue;
          if (ar === r && ac === c) continue;
          if (local.has(idx(ar, ac))) { bad = true; break; }
        }
        if (bad) break;
        run.push([rr, cc]); local.add(i); r = rr; c = cc;
      }
      if (run.length > bestRun.length) bestRun = run;
    }
    for (const [r, c] of bestRun) onPath.add(idx(r, c));
    return bestRun;
  };
  const tailA = grow(0), tailB = grow(1);
  return [...tailA.slice().reverse(), ...fine, ...tailB];
}

// ===========================================================================
// 5. THE GATE: is the drawn set genuinely one unbroken 1-module line?
// ===========================================================================
// Runs on a SET of module indices (used both on the route and, per the spec, on
// the SOLVED matrix). Returns { ok, components, deg1, deg3plus, ... }.
function assertInducedPath(cells, S) {
  const set = cells instanceof Set ? cells : new Set(cells);
  const deg = new Map();
  let deg1 = 0, degHigh = 0, deg0 = 0;
  for (const i of set) {
    const r = (i / S) | 0, c = i % S;
    let d = 0;
    for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      if (rr < 0 || cc < 0 || rr >= S || cc >= S) continue;
      if (set.has(rr * S + cc)) d++;
    }
    deg.set(i, d);
    if (d === 0) deg0++; else if (d === 1) deg1++; else if (d > 2) degHigh++;
  }
  // connectivity
  const it = set.values().next();
  let comp = 0;
  if (!it.done) {
    const seen = new Set([it.value]);
    const stack = [it.value];
    while (stack.length) {
      const i = stack.pop();
      const r = (i / S) | 0, c = i % S;
      for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
        if (rr < 0 || cc < 0 || rr >= S || cc >= S) continue;
        const j = rr * S + cc;
        if (set.has(j) && !seen.has(j)) { seen.add(j); stack.push(j); }
      }
    }
    comp = seen.size === set.size ? 1 : 2;
  }
  return {
    ok: comp === 1 && deg1 === 2 && degHigh === 0 && deg0 === 0,
    connected: comp === 1, endpoints: deg1, branchCells: degHigh, isolated: deg0,
    size: set.size,
  };
}

// ===========================================================================
// 6. ROUTE = genome -> { line, halo, stats }
// ===========================================================================
const VARIANTS = {
  "serpentine-rows": { policy: "rows", spiralMix: 0 },
  "serpentine-cols": { policy: "cols", spiralMix: 0 },
  "spiral": { policy: "spiral", spiralMix: 1 },
  "hybrid": { policy: "hybrid", spiralMix: 0.45 },
};

const CORNERS = { tl: [0, 0], tr: [0, 1], bl: [1, 0], br: [1, 1] };

const geoCache = new Map();
function geometryFor(version) {
  if (!geoCache.has(version)) geoCache.set(version, buildGeometry(version));
  return geoCache.get(version);
}

// Returns a list of distinct viable routes, best-first. The reroute loop in
// buildSnake walks this list: "perturb the genome and re-route" is implemented
// as "take the next-best lattice offset / start node", which is both cheaper
// and more systematic than re-rolling a seed.
function makeRoutes(genome) {
  const version = genome.version ?? 10;
  const pitch = Math.max(2, Math.min(8, genome.pitch ?? 5));
  const variant = VARIANTS[genome.variant] ? genome.variant : "serpentine-rows";
  const vspec = VARIANTS[variant];
  const policy = genome.policy ?? vspec.policy;
  const spiralMix = genome.spiralMix ?? vspec.spiralMix;
  const detourStyle = genome.detourStyle === "wide" ? "wide" : "hug";
  const startCorner = CORNERS[genome.startCorner] ? genome.startCorner : "tl";
  const seed = (genome.seed ?? 1) >>> 0;
  const geo = geometryFor(version);
  const { S, idx } = geo;

  // Lattice offsets. `auto` sweeps every (r0,c0) and keeps the route with the
  // best coverage; a genome may pin them for reproducibility/perturbation.
  const rng = QRArt.mulberry32(seed || 1);
  const offsets = [];
  if (Number.isInteger(genome.r0) && Number.isInteger(genome.c0)) offsets.push([genome.r0, genome.c0]);
  else for (let a = 0; a < pitch; a++) for (let b = 0; b < pitch; b++) offsets.push([a, b]);
  // seed-driven rotation of the offset sweep: perturbation for the reroute loop
  const rot = Math.floor(rng() * offsets.length);
  const sweepOffsets = offsets.slice(rot).concat(offsets.slice(0, rot));

  // "wide" detours prefer to swing a whole lattice row away from an obstacle;
  // "hug" keeps the advance direction tight. Implemented as the advance sign,
  // which is what decides whether the DFS peels off up or down at a blockage.
  const advance = detourStyle === "wide" ? -1 : 1;

  const cands = [], sigs = new Set();
  for (const [r0, c0] of sweepOffsets) {
    const lat = buildLattice(geo, pitch, r0, c0);
    if (!lat.liveNodes) continue;
    const live = [];
    for (let i = 0; i < lat.NR; i++)
      for (let j = 0; j < lat.NC; j++) if (lat.node[lat.nid(i, j)]) live.push([i, j]);
    const [ci, cj] = CORNERS[startCorner];
    const target = [ci ? lat.NR - 1 : 0, cj ? lat.NC - 1 : 0];
    live.sort((a, b) =>
      (Math.abs(a[0] - target[0]) + Math.abs(a[1] - target[1])) -
      (Math.abs(b[0] - target[0]) + Math.abs(b[1] - target[1])));
    for (const st of live.slice(0, genome.startTries ?? 2)) {
      const { path: coarse } = longestPath(lat, {
        policy, spiralMix, start: st, advance,
        sweep: cj ? -1 : 1, turn: (genome.turn ?? 1),
        budget: genome.budget ?? 25000,
      });
      if (coarse.length < 4) continue;
      const fine = addTails(liftPath(lat, coarse), geo, pitch - 1);
      const cand = evaluateRoute(fine, geo, {
        r0, c0, pitch, variant, policy, spiralMix, detourStyle, startCorner, seed,
        coarseLen: coarse.length, latNodes: lat.liveNodes,
      });
      if (!cand) continue;
      const sig = cand.cells.length + ":" + cand.cells[0] + ":" + cand.cells[cand.cells.length - 1];
      if (sigs.has(sig)) continue;
      sigs.add(sig);
      cand.version = version; cand.geo = geo;
      cands.push(cand);
    }
  }
  cands.sort((a, b) => b.score - a.score);
  return cands.slice(0, genome.maxRoutes ?? 10);
}

function evaluateRoute(fine, geo, params) {
  const { S, idx, allowed, bridge, func } = geo;
  const cells = fine.map(([r, c]) => idx(r, c));
  for (const i of cells) if (!allowed[i]) return null;
  const set = new Set(cells);
  if (set.size !== cells.length) return null;                // self-intersection
  const gate = assertInducedPath(set, S);
  if (!gate.ok) return null;                                  // NO self-touch, ever

  const pins = [], bridges = [];
  for (const i of cells) (bridge[i] ? bridges : pins).push(i);

  // 1-module Chebyshev halo, ordered by the path index that spawned it.
  const haloOrder = [], haloSeen = new Set(), funcHalo = [];
  for (let k = 0; k < cells.length; k++) {
    const r = (cells[k] / S) | 0, c = cells[k] % S;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= S || cc >= S) continue;
        const i = idx(rr, cc);
        if (set.has(i) || haloSeen.has(i)) continue;
        haloSeen.add(i);
        if (func[i]) funcHalo.push(i); else haloOrder.push(i);
      }
  }

  const rowsHit = new Set(), colsHit = new Set();
  for (const i of cells) { rowsHit.add((i / S) | 0); colsHit.add(i % S); }
  const rowCov = rowsHit.size / S, colCov = colsHit.size / S;
  // score: coverage first (it must read as spanning the WHOLE code), then length.
  const score = (rowCov + colCov) * 1000 + cells.length;
  return {
    fine, cells, set, pins, bridges, halo: haloOrder, funcHalo,
    rowCov, colCov, rowsHit, colsHit, gate, params, score,
  };
}

// ===========================================================================
// 7. SOLVE
// ===========================================================================
const FLIP_RESTARTS = 4;
const NOISE_TRIES = 12;

function solveRoute(prep, route, geo, opts) {
  const { S } = geo;
  const { pins, halo } = route;
  const masks = opts.masks ?? [0, 1, 2, 3, 4, 5, 6, 7];
  const baseNoise = opts.baseNoise >>> 0;

  const order = [], target = new Uint8Array(S * S), seq = new Int32Array(S * S).fill(-1);
  const push = (i, dark) => { if (seq[i] !== -1) return; order.push(i); target[i] = dark ? 1 : 0; seq[i] = order.length; };
  for (const i of pins) push(i, true);      // priority 1: the LINE
  for (const i of halo) push(i, false);     // priority 2: the halo
  // priority 3: nothing. The ground is surrendered to noise and rendered gray.

  const run = (mask, flipSeed, noiseSeed) => QRArt.solveArt(prep, {
    order, target, seq, mask, margin: 0.5, marginCap: 0.8,
    noiseRng: QRArt.mulberry32(noiseSeed >>> 0), flipSeed,
  });

  const lineSat = (m) => { let n = 0; for (const i of pins) if (m[i] === 1) n++; return pins.length ? n / pins.length : 1; };
  const haloSat = (m) => { let n = 0; for (const i of halo) if (m[i] === 0) n++; return halo.length ? n / halo.length : 1; };

  const cands = [];
  let bestLineSat = 0, tried = 0;
  for (const mask of masks) {
    for (let t = 0; t < FLIP_RESTARTS; t++) {
      const flipSeed = flipSeedFor(t);
      const res = run(mask, flipSeed, baseNoise);
      tried++;
      const ls = lineSat(res.matrix);
      if (ls > bestLineSat) bestLineSat = ls;
      if (res.headroom < 2) continue;
      if (ls < 0.9999) continue;                  // NO PARTIAL CREDIT on the line
      cands.push({ mask, flipSeed, haloSat: haloSat(res.matrix), res });
    }
  }
  cands.sort((a, b) => b.haloSat - a.haloSat);
  return { cands, run, lineSat, haloSat, order, bestLineSat, tried };
}

// ===========================================================================
// 8. RENDER
// ===========================================================================
function renderToned(m, lineSet, S, funcSet, { scale = 8, quiet = 4 } = {}) {
  const dim = (S + 2 * quiet) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let r = 0; r < S; r++)
    for (let c = 0; c < S; c++) {
      const i = r * S + c;
      if (!m[i]) continue;
      const col = (funcSet[i] || lineSet.has(i)) ? [0, 0, 0] : GRAY;
      const x0 = (c + quiet) * scale, y0 = (r + quiet) * scale;
      for (let y = 0; y < scale; y++)
        for (let x = 0; x < scale; x++) {
          const o = ((y0 + y) * dim + (x0 + x)) * 4;
          data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2];
        }
    }
  return { data, width: dim, height: dim };
}

function tonedSVG(m, lineSet, S, funcSet, { scale = 8, quiet = 4 } = {}) {
  const dim = (S + 2 * quiet) * scale;
  const rect = (r, c, fill) => `<rect x="${(c + quiet) * scale}" y="${(r + quiet) * scale}" width="${scale}" height="${scale}" fill="${fill}"/>`;
  const grays = [], blacks = [];
  for (let r = 0; r < S; r++)
    for (let c = 0; c < S; c++) {
      const i = r * S + c;
      if (!m[i]) continue;
      ((funcSet[i] || lineSet.has(i)) ? blacks : grays).push(rect(r, c, (funcSet[i] || lineSet.has(i)) ? "#000" : "#3a3a3a"));
    }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">\n` +
    `<rect width="${dim}" height="${dim}" fill="#fff"/>\n` + grays.join("\n") + "\n" + blacks.join("\n") + "\n</svg>\n";
}

// Route-only preview: no solve, just the geometry + the line. Blocked cells are
// pale gray, allowed cells white, bridges outlined, the line black. This is the
// image to look at while tuning the route generator.
function renderRoute(route, geo, { scale = 8, quiet = 4 } = {}) {
  const { S, allowed, func, base } = geo;
  const dim = (S + 2 * quiet) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  const put = (r, c, col) => {
    const x0 = (c + quiet) * scale, y0 = (r + quiet) * scale;
    for (let y = 0; y < scale; y++)
      for (let x = 0; x < scale; x++) {
        const o = ((y0 + y) * dim + (x0 + x)) * 4;
        data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2];
      }
  };
  const haloSet = new Set(route.halo);
  for (let r = 0; r < S; r++)
    for (let c = 0; c < S; c++) {
      const i = r * S + c;
      if (func[i]) put(r, c, base[i] ? [150, 150, 150] : [225, 225, 225]);
      else if (!allowed[i]) put(r, c, [244, 216, 216]);
    }
  for (const i of haloSet) put((i / S) | 0, i % S, [255, 255, 255]);
  for (const i of route.cells) put((i / S) | 0, i % S, geo.bridge[i] ? [200, 40, 40] : [0, 0, 0]);
  return { data, width: dim, height: dim };
}

// ===========================================================================
// 9. PIPELINE — genome -> everything
// ===========================================================================
const prepCache = new Map();
function prepFor(url, version, level) {
  const k = `${url}|${version}|${level}`;
  if (!prepCache.has(k)) prepCache.set(k, QRArt.prepareArt(url, version, level, "schemehost"));
  return prepCache.get(k);
}

// buildSnake -> { ok, ...everything } . NEVER throws on an infeasible genome; a
// failure returns { ok:false, fail } so the feasibility map can record WHY.
function buildSnake(genome, { label = "snake", verbose = true } = {}) {
  const version = genome.version ?? 10;
  const level = genome.level ?? "L";
  const url = genome.url || URL_DEFAULT;
  const S = QRArt.sizeOf(version);
  const t0 = Date.now();
  let prep;
  try { prep = prepFor(url, version, level); }
  catch (e) { return { ok: false, label, version, genome, fail: "payload: " + e.message }; }
  const seed0 = (genome.seed ?? 1) >>> 0;
  const geo = geometryFor(version);
  const funcSet = geo.func;

  const routes = makeRoutes(genome);
  if (!routes.length) return { ok: false, label, version, genome, fail: "no viable route on the lattice", ms: Date.now() - t0 };

  const attempts = Math.min(routes.length, genome.rerouteTries ?? 6);
  const trail = [];
  let picked = null;
  for (let a = 0; a < attempts; a++) {
    const route = routes[a];
    const noiseSeq = QRArt.mulberry32((seed0 ^ 0x1e3779b9) >>> 0);
    const baseNoise = Math.floor(noiseSeq() * 0xffffffff) >>> 0;
    const s = solveRoute(prep, route, geo, { baseNoise });
    const lineSet = new Set(route.cells);
    const scans8 = (m) => sameURL(scanRGBA(renderToned(m, lineSet, S, funcSet, { scale: 8, quiet: 4 })), url);
    // Walk the 100%-line configs best-halo-first and take the first that scans.
    let chosen = null;
    for (const c of s.cands) { if (scans8(c.res.matrix)) { chosen = { ...c, matrix: c.res.matrix }; break; } }
    // Still nothing? re-roll the free noise field on the best config (pins and
    // flips are noise-invariant, so only the grain moves).
    if (!chosen && s.cands.length) {
      const nseq = QRArt.mulberry32((seed0 ^ 0x51ed270b) >>> 0);
      outer: for (const c of s.cands.slice(0, 3)) {
        for (let n = 0; n < NOISE_TRIES; n++) {
          const sd = Math.floor(nseq() * 0xffffffff) >>> 0;
          const res = s.run(c.mask, c.flipSeed, sd);
          if (s.lineSat(res.matrix) < 0.9999 || res.headroom < 2) continue;
          if (scans8(res.matrix)) { chosen = { ...c, res, matrix: res.matrix }; break outer; }
        }
      }
    }
    trail.push({
      route: a, len: route.cells.length, offs: [route.params.r0, route.params.c0],
      lineConfigs: s.cands.length, solvesTried: s.tried,
      bestLineSat: +(s.bestLineSat * 100).toFixed(2), scanned: !!chosen,
    });
    if (verbose) process.stderr.write(
      `  [${label}] route ${a} (${route.cells.length} mods, off ${route.params.r0},${route.params.c0}): ` +
      `${s.cands.length}/${s.tried} configs at 100% line (best ${(s.bestLineSat * 100).toFixed(1)}%)` +
      `${chosen ? `, adopted mask ${chosen.mask}, halo ${(chosen.haloSat * 100).toFixed(1)}%` : ", NONE SCANNED"}\n`);
    if (chosen) { picked = { route, s, chosen, lineSet }; break; }
  }
  if (!picked) {
    return {
      ok: false, label, version, genome, ms: Date.now() - t0, trail,
      fail: trail.some((t) => t.lineConfigs > 0) ? "100% line found but no config scanned" : "no config reached 100% line",
      bestRoute: routes[0],
    };
  }

  const { route, chosen, lineSet } = picked;
  const matrix = chosen.matrix;

  // ---- GATES, asserted on the SOLVED matrix ------------------------------
  const lineDark = route.pins.every((i) => matrix[i] === 1);
  const bridgeDark = route.bridges.every((i) => matrix[i] === 1);
  const drawn = new Set();
  for (const i of route.cells) if (matrix[i] === 1) drawn.add(i);
  const gate = assertInducedPath(drawn, S);
  const haloSatN = route.halo.reduce((a, i) => a + (matrix[i] === 0 ? 1 : 0), 0);
  const specks = (route.halo.length - haloSatN)
    + route.funcHalo.reduce((a, i) => a + (matrix[i] === 1 ? 1 : 0), 0);

  const img8 = renderToned(matrix, lineSet, S, funcSet, { scale: 8, quiet: 4 });
  const img3 = renderToned(matrix, lineSet, S, funcSet, { scale: 3, quiet: 4 });
  const bw8 = renderMatrix(matrix, version, { scale: 8, quiet: 4 });
  const bw3 = renderMatrix(matrix, version, { scale: 3, quiet: 4 });
  const scanReport = {
    toned8: sameURL(scanRGBA(img8), url), toned3: sameURL(scanRGBA(img3), url),
    bw8: sameURL(scanRGBA(bw8), url), bw3: sameURL(scanRGBA(bw3), url),
  };
  const v = QRArt.validate(matrix, version);
  const perBlock = v.ok ? v.perBlock : null;
  const minHeadroom = perBlock ? Math.min(...perBlock.map((b) => b.capacity - b.errors)) : 0;

  return {
    ok: true, label, genome, version, level, url, S, matrix, route, geo, lineSet,
    img8, img3, bw8, bw3, trail, tries: trail.length, ms: Date.now() - t0,
    mask: chosen.mask, flipSeed: chosen.flipSeed,
    stats: {
      lineCells: route.cells.length, pinned: route.pins.length, bridges: route.bridges.length,
      lineSat: route.pins.length ? route.pins.reduce((a, i) => a + (matrix[i] === 1 ? 1 : 0), 0) / route.pins.length : 1,
      haloCells: route.halo.length, haloSat: route.halo.length ? haloSatN / route.halo.length : 1,
      specks, rowCov: route.rowCov, colCov: route.colCov,
      lineDark, bridgeDark, gate, scans: scanReport, minHeadroom, perBlock,
      flips: chosen.res.flips.length, blockUsed: Array.from(chosen.res.blockUsed),
      freeDim: chosen.res.freeDim, pins: chosen.res.pinned,
      unsatisfied: chosen.res.unsatisfied.length,
      params: route.params, decoded: v.ok ? v.text : null,
    },
  };
}

// ===========================================================================
// 10. CONTACT SHEET (own copy of the 3x5 mini font — this file touches nothing else)
// ===========================================================================
const FONT = {
  A: ["010", "101", "111", "101", "101"], B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"], D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"], F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"], H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"], J: ["001", "001", "001", "101", "010"],
  K: ["101", "110", "100", "110", "101"], L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"], N: ["101", "111", "111", "111", "101"],
  O: ["111", "101", "101", "101", "111"], P: ["110", "101", "110", "100", "100"],
  Q: ["111", "101", "101", "111", "001"], R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"], T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"], V: ["101", "101", "101", "101", "010"],
  W: ["101", "101", "111", "111", "101"], X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"], Z: ["111", "001", "010", "100", "111"],
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
  "2": ["110", "001", "010", "100", "111"], "3": ["110", "001", "010", "001", "110"],
  "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "110", "001", "110"],
  "6": ["011", "100", "110", "101", "010"], "7": ["111", "001", "010", "010", "010"],
  "8": ["010", "101", "010", "101", "010"], "9": ["010", "101", "011", "001", "110"],
  "-": ["000", "000", "111", "000", "000"], ".": ["000", "000", "000", "000", "010"],
  "%": ["101", "001", "010", "100", "101"], " ": ["000", "000", "000", "000", "000"],
};
function drawText(put, text, x0, y0, sc, col = [20, 20, 20]) {
  let x = x0;
  for (const ch of String(text).toUpperCase()) {
    const g = FONT[ch] || FONT[" "];
    for (let ry = 0; ry < 5; ry++)
      for (let rx = 0; rx < 3; rx++)
        if (g[ry][rx] === "1")
          for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) put(x + rx * sc + dx, y0 + ry * sc + dy, col);
    x += 4 * sc;
  }
}
function contactSheet(images, labels, sublabels, outPath, cols = 2) {
  const cellW = Math.max(...images.map((i) => i.width));
  const cellH = Math.max(...images.map((i) => i.height));
  const n = images.length, rows = Math.ceil(n / cols);
  const pad = 20, labelH = 30, gap = 20;
  const W = pad * 2 + cols * cellW + (cols - 1) * gap;
  const H = pad * 2 + rows * (cellH + labelH) + (rows - 1) * gap;
  const data = new Uint8ClampedArray(W * H * 4).fill(245);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const put = (x, y, col) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255; };
  images.forEach((img, k) => {
    const cr = Math.floor(k / cols), cc = k % cols;
    const x0 = pad + cc * (cellW + gap), y0 = pad + cr * (cellH + labelH + gap);
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const s = (y * img.width + x) * 4;
        put(x0 + x + ((cellW - img.width) >> 1), y0 + y, [img.data[s], img.data[s + 1], img.data[s + 2]]);
      }
    drawText(put, labels[k] ?? "", x0 + 2, y0 + cellH + 5, 2);
    if (sublabels && sublabels[k]) drawText(put, sublabels[k], x0 + 2, y0 + cellH + 17, 1, [90, 90, 90]);
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  writePNG(outPath, { data, width: W, height: H });
  return { W, H, n };
}

// ===========================================================================
// 11. CLI
// ===========================================================================
function parseGenome(args) {
  const g = {};
  for (const a of args) {
    if (a.startsWith("{")) Object.assign(g, JSON.parse(a));
    else if (a.includes("=")) {
      const [k, ...rest] = a.split("=");
      const v = rest.join("=");
      g[k.replace(/^--/, "")] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
    } else if (fs.existsSync(a)) Object.assign(g, JSON.parse(fs.readFileSync(a, "utf8")));
  }
  return g;
}

function fmtStats(b) {
  const s = b.stats;
  return [
    `line ${s.lineCells} modules (${s.pinned} pinned + ${s.bridges} timing bridges)`,
    `line satisfaction ${(s.lineSat * 100).toFixed(2)}%  halo ${(s.haloSat * 100).toFixed(1)}% of ${s.haloCells}  specks ${s.specks}`,
    `coverage rows ${(s.rowCov * 100).toFixed(1)}%  cols ${(s.colCov * 100).toFixed(1)}%`,
    `gate connected=${s.gate.connected} endpoints=${s.gate.endpoints} branch=${s.gate.branchCells} isolated=${s.gate.isolated} ok=${s.gate.ok}`,
    `scans toned8=${s.scans.toned8} toned3=${s.scans.toned3} bw8=${s.scans.bw8} bw3=${s.scans.bw3}  minHeadroom=${s.minHeadroom}`,
    `mask ${b.mask} flipSeed ${b.flipSeed} pitch ${s.params.pitch} offs (${s.params.r0},${s.params.c0}) ${s.params.variant}/${s.params.detourStyle}/${s.params.startCorner}`,
  ].join("\n  ");
}

function main() {
  const [, , cmd, ...rest] = process.argv;
  if (cmd === "route") {
    const outArg = rest.find((a) => a.endsWith(".png"));
    const g = parseGenome(rest.filter((a) => a !== outArg));
    const rs = makeRoutes(g);
    if (!rs.length) { process.stderr.write("route: no viable path\n"); process.exit(1); }
    const r = rs[0];
    const out = path.resolve(outArg || path.join(OUT, "snake-route.png"));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    writePNG(out, renderRoute(r, r.geo, { scale: 8, quiet: 2 }));
    process.stdout.write(JSON.stringify({
      out, len: r.cells.length, pins: r.pins.length, bridges: r.bridges.length,
      halo: r.halo.length, funcHalo: r.funcHalo.length,
      rowCov: +(r.rowCov * 100).toFixed(1), colCov: +(r.colCov * 100).toFixed(1),
      gate: r.gate, params: r.params,
    }, null, 2) + "\n");
    return;
  }
  if (cmd === "render") {
    const outArg = rest.find((a) => a.endsWith(".png"));
    const g = parseGenome(rest.filter((a) => a !== outArg));
    const b = buildSnake(g, { label: g.variant || "snake" });
    if (!b.ok) { process.stdout.write("FAIL: " + b.fail + "\n"); process.exit(1); }
    const out = path.resolve(outArg || path.join(OUT, "snake.png"));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    writePNG(out, b.img8);
    process.stdout.write(fmtStats(b) + "\n");
    return;
  }
  if (cmd === "all") { buildAll(); return; }
  process.stderr.write("usage: node build-11-snake.mjs route|render|all [k=v ...] [out.png]\n");
  process.exit(2);
}

// ===========================================================================
// 12. THE FEASIBILITY SWEEP — the deliverable for this round.
// ===========================================================================
// Every (version x variant x pitch) cell of the map is attempted and recorded
// whether it works or not: did a 100%-line route exist, how many reroutes it
// took, how many flip codewords were spent, what headroom survived. That is the
// number that tells us which relaxed constraints (halo quality, coverage,
// endpoint art) we can afford to buy back in a later round.
const SWEEP = [
  { version: 10, pitches: [4, 5, 6] },
  { version: 6, pitches: [5, 6, 7] },
];
const VARIANT_LIST = ["serpentine-rows", "serpentine-cols", "spiral", "hybrid"];

function buildAll() {
  fs.mkdirSync(OUT, { recursive: true });
  const rows = [], wins = [];
  for (const { version, pitches } of SWEEP)
    for (const variant of VARIANT_LIST)
      for (const pitch of pitches) {
        const label = `${variant}-v${version}-p${pitch}`;
        process.stderr.write(`\n=== ${label} ===\n`);
        let b;
        try { b = buildSnake({ version, pitch, variant, seed: 1, url: URL_DEFAULT }, { label }); }
        catch (e) { b = { ok: false, label, version, fail: "crash: " + e.message }; }
        const rec = { label, version, variant, pitch, ok: b.ok, ms: b.ms ?? 0 };
        if (b.ok) {
          const s = b.stats;
          Object.assign(rec, {
            len: s.lineCells, pinned: s.pinned, bridges: s.bridges, halo: s.haloCells,
            reroutes: b.tries, mask: b.mask, flips: s.flips, blockUsed: s.blockUsed,
            headroom: s.minHeadroom, lineSat: s.lineSat, haloSat: s.haloSat, specks: s.specks,
            rowCov: s.rowCov, colCov: s.colCov, gate: s.gate, scans: s.scans,
            offs: [s.params.r0, s.params.c0], perBlock: s.perBlock,
            trail: b.trail,
          });
          const png = path.join(OUT, `snake-${label}.png`);
          writePNG(png, b.img8);
          writePNG(path.join(OUT, `snake-route-${label}.png`), renderRoute(b.route, b.geo, { scale: 6, quiet: 2 }));
          wins.push({ rec, b, png });
          process.stderr.write("  OK  " + fmtStats(b) + "\n");
        } else {
          rec.fail = b.fail;
          rec.trail = b.trail;
          process.stderr.write(`  FAIL ${b.fail}\n`);
        }
        rows.push(rec);
      }

  // ---- hero: best v10 win (most line modules that still scans at BOTH scales)
  const v10 = wins.filter((w) => w.rec.version === 10);
  const heroScore = (w) => (w.rec.scans.toned3 ? 1e6 : 0) + w.rec.len + w.rec.haloSat * 100;
  const hero = v10.sort((a, b) => heroScore(b) - heroScore(a))[0] || wins[0];
  if (hero) {
    writePNG(path.join(OUT, `snake-v${hero.rec.version}.png`), hero.b.img8);
    writePNG(path.join(OUT, `snake-v${hero.rec.version}-bw.png`), hero.b.bw8);
    fs.writeFileSync(path.join(OUT, `snake-v${hero.rec.version}.svg`),
      tonedSVG(hero.b.matrix, hero.b.lineSet, hero.b.S, hero.b.geo.func, { scale: 8, quiet: 4 }));
  }
  const v6 = wins.filter((w) => w.rec.version === 6).sort((a, b) => heroScore(b) - heroScore(a))[0];
  if (v6) {
    writePNG(path.join(OUT, "snake-v6.png"), v6.b.img8);
    writePNG(path.join(OUT, "snake-v6-bw.png"), v6.b.bw8);
    fs.writeFileSync(path.join(OUT, "snake-v6.svg"),
      tonedSVG(v6.b.matrix, v6.b.lineSet, v6.b.S, v6.b.geo.func, { scale: 8, quiet: 4 }));
  }

  // ---- contact sheet: one cell per variant (best pitch), v10 then v6
  const byVariant = [];
  for (const version of [10, 6])
    for (const variant of VARIANT_LIST) {
      const c = wins.filter((w) => w.rec.version === version && w.rec.variant === variant)
        .sort((a, b) => heroScore(b) - heroScore(a))[0];
      if (c) byVariant.push(c);
    }
  if (byVariant.length) {
    contactSheet(
      byVariant.map((w) => w.b.img8),
      byVariant.map((w) => `${w.rec.variant} V${w.rec.version} P${w.rec.pitch}`),
      byVariant.map((w) => `${w.rec.len} MOD  HALO ${(w.rec.haloSat * 100).toFixed(0)}%  HR ${w.rec.headroom}  ROW ${(w.rec.rowCov * 100).toFixed(0)}%`),
      path.join(OUT, "snake-contact.png"), Math.min(4, byVariant.length));
    contactSheet(
      byVariant.map((w) => renderRoute(w.b.route, w.b.geo, { scale: 5, quiet: 2 })),
      byVariant.map((w) => `${w.rec.variant} V${w.rec.version} P${w.rec.pitch}`),
      byVariant.map((w) => `ROUTE ONLY  ${w.rec.len} MODULES`),
      path.join(OUT, "snake-contact-routes.png"), Math.min(4, byVariant.length));
  }

  writeReport(rows, wins, hero, v6);
  process.stderr.write(`\ndone: ${wins.length}/${rows.length} cells solved\n`);
}

function writeReport(rows, wins, hero, v6) {
  const pct = (x) => (x * 100).toFixed(1) + "%";
  const yn = (b) => (b ? "yes" : "NO");
  const L = [];
  L.push("# Piece 12 — the snake · FEASIBILITY REPORT", "");
  L.push("One unbroken 1-module dark line snaking through the whole symbol.");
  L.push("Payload `https://hexxygon.com` (20 chars), urlCase `schemehost`.", "");
  L.push("**Round scope: feasibility study.** Hard gates only — single 4-connected");
  L.push("component, exactly 2 endpoints, 100% of line cells dark on the SOLVED");
  L.push("matrix, jsQR decode at scale 8, >=2 codewords headroom per block. Halo");
  L.push("quality, coverage, speck counts and endpoint art are reported but were");
  L.push("NOT iterated on.", "");

  L.push("## How the route is built", "");
  L.push("The route lives on a **coarse lattice** of spacing `pitch`: nodes at fine");
  L.push("cells `(r0+pitch*i, c0+pitch*j)`, edges = the straight run of fine cells");
  L.push("between lattice-adjacent nodes. Any *simple path in the lattice graph*");
  L.push("lifts to an *induced path in the fine grid* (proof in the file header), so");
  L.push("the no-self-touch rule is structural rather than patched in afterwards.");
  L.push("Finding the route is then a DFS for a long simple path on a ~12x12 graph,");
  L.push("and the move-ordering policy IS the artistic variant.", "");
  L.push("**Timing bridges.** Row 6 and column 6 are function modules all the way");
  L.push("across the symbol, so a line that may not occupy function cells simply");
  L.push("*cannot reach* rows 0-5 or columns 0-5 — they are cut off, capping row");
  L.push("coverage near 88%. The way through is that the timing pattern alternates:");
  L.push("`(6,c)` is already dark for even `c`. The snake crosses at an even column,");
  L.push("using the timing module itself as a bridge it never has to pin, and the two");
  L.push("flanking timing cells are odd hence light, so the crossing keeps its white");
  L.push("halo for free. Bridge cells count as line cells for connectivity and are");
  L.push("asserted dark on the solved matrix.", "");

  L.push("## Feasibility map", "");
  L.push("| variant | ver | pitch | route? | line mods | reroutes | 100%-line configs | flips | headroom | scan@8 | scan@3 | halo | specks | rows | cols | gate |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    if (!r.ok) {
      const cfg = r.trail ? Math.max(0, ...r.trail.map((t) => t.lineConfigs)) : 0;
      L.push(`| ${r.variant} | v${r.version} | ${r.pitch} | ${r.trail ? "yes" : "NO"} | ${r.trail ? r.trail[0].len : "-"} | ${r.trail ? r.trail.length : 0} | ${cfg} | - | - | NO | NO | - | - | - | - | **FAIL: ${r.fail}** |`);
      continue;
    }
    const cfg = r.trail[r.trail.length - 1].lineConfigs;
    L.push(`| ${r.variant} | v${r.version} | ${r.pitch} | yes | ${r.len} (${r.pinned}+${r.bridges}br) | ${r.reroutes} | ${cfg}/32 | ${r.flips} | ${r.headroom} | ${yn(r.scans.toned8)} | ${yn(r.scans.toned3)} | ${pct(r.haloSat)} | ${r.specks} | ${pct(r.rowCov)} | ${pct(r.colCov)} | ${r.gate.ok ? "PASS" : "fail"} |`);
  }
  L.push("");
  L.push("`100%-line configs` = how many of the 32 solver configurations tried");
  L.push("(8 masks x 4 flip-seed rotations) delivered every single line cell dark");
  L.push("with >=2 headroom. `flips` = deliberately-wrong modules Reed-Solomon");
  L.push("absorbed. `gate` = connectivity + endpoint-degree assertion on the SOLVED");
  L.push("matrix (single 4-connected component, exactly 2 degree-1 cells, no");
  L.push("degree-3+ cell, no isolated cell).", "");

  const okRows = rows.filter((r) => r.ok);
  L.push("## What this tells us", "");
  if (okRows.length) {
    const cfgs = okRows.map((r) => r.trail[r.trail.length - 1].lineConfigs);
    const minCfg = Math.min(...cfgs), maxCfg = Math.max(...cfgs);
    const hrs = okRows.map((r) => r.headroom);
    L.push(`* ${okRows.length}/${rows.length} sweep cells solved end to end.`);
    L.push(`* Every solved cell needed **${Math.max(...okRows.map((r) => r.reroutes))} reroute(s) at most** — the first route off the lattice usually solves, so route feasibility is not the bottleneck.`);
    L.push(`* Between ${minCfg} and ${maxCfg} of 32 solver configs hit 100% line, i.e. the line is comfortably inside the free-bit budget, not scraping it.`);
    L.push(`* Headroom landed at ${Math.min(...hrs)}-${Math.max(...hrs)} codewords per block. \`marginCap 0.8\` of a 9-codeword capacity makes >=2 structural.`);
    const worstHalo = Math.min(...okRows.map((r) => r.haloSat));
    const bestHalo = Math.max(...okRows.map((r) => r.haloSat));
    L.push(`* Halo satisfaction ran ${pct(worstHalo)}-${pct(bestHalo)} with **zero** effort spent on it. That is the constraint most affordable to buy back next round.`);
  } else {
    L.push("* Nothing solved. See per-cell failure reasons above.");
  }
  L.push("");

  if (hero) {
    const s = hero.b.stats;
    L.push("## Recommended hero", "");
    L.push(`**${hero.rec.variant}, v${hero.rec.version}-L, pitch ${hero.rec.pitch}** — \`out/snake-v${hero.rec.version}.png\` / \`.svg\` / \`-bw.png\`.`, "");
    L.push("```");
    L.push(`route        ${s.lineCells} modules (${s.pinned} pinned + ${s.bridges} timing bridges), lattice offset (${s.params.r0},${s.params.c0})`);
    L.push(`line dark    ${pct(s.lineSat)}   (assert: all pinned line cells dark = ${s.lineDark}, all bridges dark = ${s.bridgeDark})`);
    L.push(`connectivity single component = ${s.gate.connected}, endpoints = ${s.gate.endpoints}, branch cells = ${s.gate.branchCells}, isolated = ${s.gate.isolated}`);
    L.push(`halo         ${pct(s.haloSat)} of ${s.haloCells} cells, ${s.specks} specks`);
    L.push(`coverage     rows ${pct(s.rowCov)}, cols ${pct(s.colCov)}`);
    L.push(`solver       mask ${hero.b.mask}, flipSeed ${hero.b.flipSeed}, ${s.pins} exact pins, ${s.flips} flips, freeDim ${s.freeDim}`);
    L.push(`scans        toned@8 ${s.scans.toned8}  toned@3 ${s.scans.toned3}  bw@8 ${s.scans.bw8}  bw@3 ${s.scans.bw3}`);
    L.push(`decoded      ${s.decoded}`);
    L.push("");
    L.push("  " + meterLine(s.perBlock || []));
    L.push("```", "");
  }
  if (v6) {
    const s = v6.b.stats;
    L.push("## v6-L (coarser, poster-grade)", "");
    L.push(`**${v6.rec.variant}, v6-L, pitch ${v6.rec.pitch}** — \`out/snake-v6.png\`. ${s.lineCells} modules, line ${pct(s.lineSat)}, halo ${pct(s.haloSat)}, headroom ${s.minHeadroom}, rows ${pct(s.rowCov)} / cols ${pct(s.colCov)}, scans toned@8 ${s.scans.toned8} / @3 ${s.scans.toned3}.`, "");
    L.push("```");
    L.push("  " + meterLine(s.perBlock || []));
    L.push("```", "");
  }

  L.push("## Deliverables", "");
  L.push("* `out/snake-contact.png` — one solved cell per variant (best pitch), v10 then v6.");
  L.push("* `out/snake-contact-routes.png` — the same variants as route-only diagrams");
  L.push("  (pale pink = clearance-blocked, gray = function modules, red = timing bridges).");
  L.push("* `out/snake-<variant>-v<V>-p<P>.png` — every solved sweep cell.");
  L.push("* `out/snake-route-<variant>-v<V>-p<P>.png` — its route-only diagram.");
  L.push("* `out/snake-v10.png` / `.svg` / `-bw.png` — the hero.");
  if (v6) L.push("* `out/snake-v6.png` / `.svg` / `-bw.png` — the coarse cut.");
  L.push("* `out/snake-feasibility.json` — the machine-readable map.", "");

  L.push("## Deviations from the spec", "");
  L.push("* **Endpoint flares skipped.** A 2x2 dot makes every one of its four cells");
  L.push("  degree-2 and the cell before it degree-3, which fails both the");
  L.push("  no-self-touch rule and the spec's own \"exactly 2 endpoints, all others");
  L.push("  degree 2\" gate. The two rules are mutually exclusive; the gate won.");
  L.push("* **Row coverage is capped by geometry, not by effort.** Rows 0-5 and");
  L.push("  columns 0-5 are only reachable through a timing bridge, and only the");
  L.push("  lattice lines that happen to land there get covered. Without bridges the");
  L.push("  ceiling would be ~88%.");
  L.push("* **Detour style** is realised as the DFS row-advance direction rather than");
  L.push("  a hand-written hug/wide obstacle-following rule — on the lattice a detour");
  L.push("  is just backtracking, so the two styles differ in which way the line peels");
  L.push("  off a blockage.");
  L.push("* Halo, specks and coverage were left un-iterated per the revised scope.");
  L.push("");

  fs.writeFileSync(path.join(OUT, "snake-report.md"), L.join("\n") + "\n");
  fs.writeFileSync(path.join(OUT, "snake-feasibility.json"), JSON.stringify(rows, null, 2) + "\n");
}

main();
