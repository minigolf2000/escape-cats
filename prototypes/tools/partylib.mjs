// Shared harness for the party-level pipeline: inject candidate levels into the
// real game (same trick as the other tools — never a duplicated engine), then
// solve / verify / measure them. Used by partygen.mjs & partycheck.mjs.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const GAME = new URL('../goomba-rider.html', import.meta.url).href;

// Mirror of the game's initLevel() for injected levels (bounds, popper aim
// vectors, start-pad angle). Runs in the page. Keep in sync with the game.
const INIT_SRC = `(function initLevel(L) {
  const BUMP_R = 5.5;
  L.cushions = L.cushions || []; L.pops = L.pops || [];
  L.plants = L.plants || []; L.updrafts = L.updrafts || []; L.bumpers = L.bumpers || [];
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const eat = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const poly of L.terrain) for (const [x, y] of poly) eat(x, y);
  for (const c of L.cushions) { eat(c.x, c.y); eat(c.x + c.w, c.y); }
  for (const pp of L.pops) { eat(pp.x - 6, pp.y - 6); eat(pp.x + 6, pp.y + 6); }
  for (const m of L.plants) eat(m[0], m[1]);
  for (const u of L.updrafts) { eat(u.x, u.y); eat(u.x + u.w, u.y + u.h); }
  for (const bp of L.bumpers) { eat(bp.x - BUMP_R, bp.y - BUMP_R); eat(bp.x + BUMP_R, bp.y + BUMP_R); }
  eat(L.goal[0], L.goal[1]); eat(L.start[0], L.start[1]);
  L.bounds = { x0: x0 - 8, y0: y0 - 16, x1: x1 + 8, y1: y1 + 8 };
  for (const pp of L.pops) {
    const rad = pp.deg * Math.PI / 180;
    pp.ux = Math.cos(rad); pp.uy = Math.sin(rad);
    pp.vx = pp.ux * pp.spd; pp.vy = pp.uy * pp.spd;
  }
  L.startAngle = 0;
  for (const poly of L.terrain) for (let i = 0; i + 1 < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[i + 1];
    if (L.start[0] >= Math.min(ax, bx) && L.start[0] <= Math.max(ax, bx) && Math.abs(bx - ax) > 1)
      { L.startAngle = Math.atan2(by - ay, bx - ax); break; }
  }
  return L;
})`;

export async function openGame() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
  page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
  await page.goto(GAME);
  await page.waitForFunction(() => window.__gr);
  return { browser, page };
}

// Replace any previously injected levels with this set; returns index of first.
export async function injectLevels(page, levels) {
  return page.evaluate(({ levels, initSrc }) => {
    const gr = window.__gr;
    const init = eval(initSrc);
    if (gr.__partyBase === undefined) gr.__partyBase = gr.LEVELS.length;
    gr.LEVELS.length = gr.__partyBase;
    for (const L of levels) gr.LEVELS.push(init(JSON.parse(JSON.stringify(L))));
    return gr.__partyBase;
  }, { levels, initSrc: INIT_SRC });
}

// Greedy beam search for a winning band set (same idea as solve.mjs, but works
// on any level index and returns the set). seed makes runs reproducible.
export async function solve(page, li, budget, K = 3500, seed = 8675309, rounds = 1, prefix = null) {
  return page.evaluate(({ li, budget, K, seed, rounds, prefix }) => {
    const { simulate, LEVELS, BAND_MAX } = window.__gr;
    const L = LEVELS[li], b = L.bounds;
    let s = seed;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    // interesting fixed targets a band might want to reach toward
    const targets = [...L.plants, ...L.bumpers.map(o => [o.x, o.y]),
                     ...L.pops.map(o => [o.x, o.y]), L.goal];
    const trajPt = traj => {
      const t = rnd() < 0.5 ? rnd() : 1 - rnd() * rnd() * 0.35;   // bias to the END
      return traj[Math.min(traj.length - 1, (t * traj.length) | 0)];
    };
    const inBounds = (ax, ay, bx, by) =>
      !(Math.min(ax, bx) < b.x0 - 6 || Math.max(ax, bx) > b.x1 + 6 ||
        Math.min(ay, by) < b.y0 - 6 || Math.max(ay, by) > b.y1 + 6);
    const mk = (ax, ay, bx, by) => {
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 8 || len > BAND_MAX || !inBounds(ax, ay, bx, by)) return null;
      return [[+ax.toFixed(1), +ay.toFixed(1)], [+bx.toFixed(1), +by.toFixed(1)]];
    };
    const randBand = traj => {
      for (let tries = 0; tries < 40; tries++) {
        const roll = rnd();
        const J = () => (rnd() * 2 - 1) * 8;
        if (roll < 0.12 && traj && traj.length > 4) {
          // RAIL: both endpoints near the path — long shallow ramps the pure
          // point-cloud sampler almost never produces
          const p = trajPt(traj), q = trajPt(traj);
          const nb = mk(p[0] + J(), p[1] + J(), q[0] + J(), q[1] + J());
          if (nb) return nb;
          continue;
        }
        if (roll < 0.26 && traj && traj.length && targets.length) {
          // CONNECTOR: from the path toward a plant/piñata/popper/goal
          const p = trajPt(traj), m = targets[(rnd() * targets.length) | 0];
          const t = 0.3 + rnd() * 0.7;
          const nb = mk(p[0] + J(), p[1] + J(),
                        p[0] + (m[0] - p[0]) * t + J(), p[1] + (m[1] - p[1]) * t + J());
          if (nb) return nb;
          continue;
        }
        let cx, cy;
        if (roll < 0.68 && traj && traj.length) {
          const p = trajPt(traj);
          cx = p[0] + (rnd() * 2 - 1) * 18; cy = p[1] + (rnd() * 2 - 1) * 18;
        } else if (roll < 0.88 && targets.length) {
          const m = targets[(rnd() * targets.length) | 0];
          cx = m[0] + (rnd() * 2 - 1) * 26; cy = m[1] + (rnd() * 2 - 1) * 26;
        } else {
          cx = b.x0 + rnd() * (b.x1 - b.x0); cy = b.y0 + rnd() * (b.y1 - b.y0);
        }
        const ang = rnd() * 6.283, len = 8 + rnd() * (BAND_MAX - 10);
        const nb = mk(cx - Math.cos(ang) * len / 2, cy - Math.sin(ang) * len / 2,
                      cx + Math.cos(ang) * len / 2, cy + Math.sin(ang) * len / 2);
        if (nb) return nb;
      }
      return null;
    };
    const score = set => {
      const r = simulate(li, set);
      let best = 1e9, plants = 0;
      const got = L.plants.map(() => false);
      const pd = L.plants.map(() => 1e9);            // closest approach per plant
      for (const p of r.traj) {
        const d = Math.hypot(p[0] - L.goal[0], p[1] - L.goal[1]);
        if (d < best) best = d;
        L.plants.forEach((m, i) => {
          const dm = Math.hypot(p[0] - m[0], p[1] - m[1]);
          if (dm < pd[i]) pd[i] = dm;
          if (!got[i] && dm < 8) { got[i] = true; plants++; }
        });
      }
      // gradient toward uncollected plants: a rail that ALMOST reaches a
      // pocket must outrank one that ignores it, or the beam random-walks
      let lure = 0;
      pd.forEach((d, i) => { if (!got[i]) lure += Math.max(0, 60 - d) * 6; });
      return { s: (r.result === 'win' ? 1e6 : 0) + plants * 1000 + lure - best,
               r: r.result, plants, near: +best.toFixed(1), traj: r.traj };
    };
    let bestOut = null;
    for (let round = 0; round < rounds; round++) {
      // stacked families repeat one stage geometry, so the (N-1)-player
      // solution is a valid prefix for the N-player level — search only on top
      const seedSet = prefix || [];
      let beam = [{ set: seedSet, ...score(seedSet) }];
      for (let stage = seedSet.length + 1; stage <= budget; stage++) {
        const cands = [];
        for (const entry of beam) {
          for (let k = 0; k < Math.ceil(K / beam.length); k++) {
            const nb = randBand(entry.traj);
            if (!nb) continue;
            const set = entry.set.concat([nb]);
            const sc = score(set);
            if (sc.s > entry.s - 40) cands.push({ set, ...sc });
          }
        }
        cands.sort((p, q) => q.s - p.s);
        const uniq = [], seen = new Map();
        for (const c of cands) {
          const key = c.plants + ':' + Math.round(c.near / 12);
          if ((seen.get(key) || 0) >= 2) continue;
          seen.set(key, (seen.get(key) || 0) + 1);
          uniq.push(c);
          if (uniq.length >= 10) break;
        }
        if (!uniq.length) break;
        beam = uniq;
        if (beam[0].r === 'win') break;
      }
      const top = beam[0];
      if (!bestOut || top.s > bestOut.s) bestOut = top;
      if (bestOut.r === 'win') break;
    }
    return { found: bestOut.r === 'win', result: bestOut.r, near: bestOut.near,
             plants: bestOut.plants, set: bestOut.set };
  }, { li, budget, K, seed, rounds, prefix });
}

// Verify one level: bare fails, solution wins, minimum band count is honest.
// For k < budget: exhaustive on a grid at k=1, random sampling + beam-search
// cheat hunt for k=2..budget-1. Returns everything partycheck needs to report.
export async function verifyLevel(page, li, opts = {}) {
  const { gridStep = 10, samples2 = 12000, samples3 = 9000, cheatK = 2500, cheatSeeds = [1, 2, 3] } = opts;
  const base = await page.evaluate(({ li, gridStep, samples2, samples3 }) => {
    const { simulate, LEVELS, BAND_MAX } = window.__gr;
    const L = LEVELS[li], b = L.bounds;
    const budget = Math.min(4, L.budget || 4);
    const out = { name: L.name, budget, k: {} };
    out.bare = simulate(li, []);
    out.bare.traj = undefined;
    out.solution = L.solution && L.solution.length
      ? { n: L.solution.length, ...simulate(li, L.solution), traj: undefined,
          lens: L.solution.map(([a, c]) => +Math.hypot(c[0] - a[0], c[1] - a[1]).toFixed(1)) }
      : null;
    const pts = [];
    for (let x = b.x0; x <= b.x1; x += gridStep)
      for (let y = b.y0; y <= b.y1; y += gridStep) pts.push([x, y]);
    const legal = [];
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const len = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
        if (len >= 6 && len <= BAND_MAX) legal.push([pts[i], pts[j]]);
      }
    let seed = 20260808;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = () => legal[(rnd() * legal.length) | 0];
    // k=1 exhaustive on the grid
    let w1 = 0, eg1 = null;
    for (const bd of legal) if (simulate(li, [bd]).result === 'win') { w1++; eg1 = eg1 || bd; }
    out.k[1] = { win: w1, of: legal.length, exhaustive: true, eg: eg1 };
    // random sampling for k = 2 .. budget-1
    for (const [k, N] of [[2, samples2], [3, samples3]]) {
      if (k >= budget) break;
      let w = 0, eg = null;
      for (let t = 0; t < N; t++) {
        const set = []; for (let m = 0; m < k; m++) set.push(pick());
        if (simulate(li, set).result === 'win') { w++; eg = eg || set; }
      }
      out.k[k] = { win: w, of: N, exhaustive: false, eg };
    }
    return out;
  }, { li, gridStep, samples2, samples3 });

  // beam-search cheat hunt at every under-budget band count — random sampling
  // misses coordinated multi-band cheats, a directed search does not.
  base.cheats = {};
  for (let k = Math.max(2, 1); k < base.budget; k++) {
    for (const seed of cheatSeeds) {
      const r = await solve(page, li, k, cheatK, seed * 7919 + k);
      if (r.found) { base.cheats[k] = r.set; break; }
    }
  }
  return base;
}

// Finger-slop tolerance: jitter every solution endpoint ±slop, count wins.
export async function robustness(page, li, trials = 60, slop = 3) {
  return page.evaluate(({ li, trials, slop }) => {
    const { simulate, LEVELS } = window.__gr;
    const sol = LEVELS[li].solution || [];
    if (!sol.length) return null;
    let seed = 424242;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let wins = 0;
    for (let t = 0; t < trials; t++) {
      const jit = sol.map(([a, b]) => [
        [a[0] + (rnd() * 2 - 1) * slop, a[1] + (rnd() * 2 - 1) * slop],
        [b[0] + (rnd() * 2 - 1) * slop, b[1] + (rnd() * 2 - 1) * slop]]);
      if (simulate(li, jit).result === 'win') wins++;
    }
    return { wins, trials, pct: +((100 * wins) / trials).toFixed(0) };
  }, { li, trials, slop });
}

// Ride card telemetry + PNG screenshot of the traced run.
export async function rideCard(page, li, pngPath, label) {
  const card = await page.evaluate(({ li, label }) => {
    const st = window.__gr.rideCard(li, undefined, label);
    return st;
  }, { li, label });
  if (pngPath) await page.screenshot({ path: pngPath });
  await page.evaluate(() => window.__gr.closeCard());
  return card;
}
