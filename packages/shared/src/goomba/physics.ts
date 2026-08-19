// The Goomba Glider physics, ported verbatim from the prototype
// (prototypes/goomba-rider.html). Deterministic and side-effect free: the room
// server scores a run with it the instant PLAY lands, and every phone animates
// the same run with it in real time — both walk the identical 240Hz substeps,
// so the animation ends exactly where the server said it would.
//
// If you change a number here, change it in the prototype too (and vice
// versa) — the design tools in prototypes/tools/ drive the prototype's copy.

import {
  GOOMBA_LEVELS,
  type GoombaLevelInit,
  type Pt,
  G,
  R,
  START_VX,
  MAX_SPEED,
  SUB,
  RUN_MAX,
  KIND_GROUND,
  KIND_BAND,
  KIND_CUSH,
  E_KIND,
  FR_KIND,
  POP_R2,
  POP_COOLDOWN,
  CAN_R,
  BUMP_R,
  BUMP_E,
  BUMP_MIN,
} from "./levels";

/** A placed band: two endpoints, already snapped, plus who owns it. */
export interface GoombaBand {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Roster slot of the player who placed it — drives its colour, and lets
   * the room say "that was YOUR band" when it mattered. */
  slot: number;
  /** pid of the placer, so a phone can tell its own bands from teammates'. */
  pid: string;
}

const SNAP = 5; // endpoints near terrain snap onto it (slightly buried, so no tip-bonk)

function snapEnd(L: GoombaLevelInit, x: number, y: number): Pt {
  // lips and ledge corners are vertices — players aim for those, so vertices win
  let best: Pt | null = null,
    bestD2 = SNAP * SNAP;
  for (const poly of L.terrain)
    for (const [vx, vy] of poly) {
      const d2 = (x - vx) * (x - vx) + (y - vy) * (y - vy);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = [vx, vy + 0.8];
      }
    }
  if (best) return best;
  bestD2 = SNAP * SNAP;
  for (const poly of L.terrain)
    for (let i = 0; i + 1 < poly.length; i++) {
      const ax = poly[i][0],
        ay = poly[i][1],
        bx = poly[i + 1][0],
        by = poly[i + 1][1];
      const abx = bx - ax,
        aby = by - ay,
        l2 = abx * abx + aby * aby || 1e-6;
      let t = ((x - ax) * abx + (y - ay) * aby) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + abx * t,
        qy = ay + aby * t;
      const d2 = (x - qx) * (x - qx) + (y - qy) * (y - qy);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = [qx, qy + 0.8];
      }
    }
  return best || [x, y];
}

export function snapBand<T extends { ax: number; ay: number; bx: number; by: number }>(
  L: GoombaLevelInit,
  bd: T,
): T {
  const a = snapEnd(L, bd.ax, bd.ay),
    b = snapEnd(L, bd.bx, bd.by);
  return { ...bd, ax: a[0], ay: a[1], bx: b[0], by: b[1] };
}

/** A placed band sags a little, like real rubber. */
export function bandPoints(bd: {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}): Pt[] {
  const dx = bd.bx - bd.ax,
    dy = bd.by - bd.ay,
    len = Math.hypot(dx, dy);
  const sag = Math.min(3.5, len * 0.05);
  const cx = (bd.ax + bd.bx) / 2,
    cy = (bd.ay + bd.by) / 2 + sag;
  const pts: Pt[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8,
      u = 1 - t;
    pts.push([
      u * u * bd.ax + 2 * u * t * cx + t * t * bd.bx,
      u * u * bd.ay + 2 * u * t * cy + t * t * bd.by,
    ]);
  }
  return pts;
}

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  kind: number;
  band: number;
  cush: number;
}

function segsFor(
  L: GoombaLevelInit,
  bands: readonly { ax: number; ay: number; bx: number; by: number }[],
): Seg[] {
  const segs: Seg[] = [];
  for (const poly of L.terrain)
    for (let i = 0; i + 1 < poly.length; i++)
      segs.push({
        ax: poly[i][0],
        ay: poly[i][1],
        bx: poly[i + 1][0],
        by: poly[i + 1][1],
        kind: KIND_GROUND,
        band: -1,
        cush: -1,
      });
  L.cushions.forEach((c, ci) =>
    segs.push({ ax: c.x, ay: c.y, bx: c.x + c.w, by: c.y, kind: KIND_CUSH, band: -1, cush: ci }),
  );
  bands.forEach((bd, bi) => {
    const pts = bandPoints(bd);
    for (let i = 0; i + 1 < pts.length; i++)
      segs.push({
        ax: pts[i][0],
        ay: pts[i][1],
        bx: pts[i + 1][0],
        by: pts[i + 1][1],
        kind: KIND_BAND,
        band: bi,
        cush: -1,
      });
  });
  return segs;
}

export type RunResult = "win" | "fall" | "left" | "flew" | "stall" | "loop" | "timeout";

export type RunEvent = [kind: "bump" | "can" | "pop", x: number, y: number, t: number];

export interface RunState {
  L: GoombaLevelInit;
  segs: Seg[];
  p: { x: number; y: number };
  v: { x: number; y: number };
  face: number;
  boardA: number;
  grounded: boolean;
  onBand: number;
  t: number;
  slowT: number;
  result: RunResult | null;
  snap: { x: number; y: number; t: number };
  bandHits: number[];
  cushHits: number[];
  popT: number[];
  got: boolean[];
  gotN: number;
  bumpT: number[];
  events: RunEvent[];
}

export function makeRun(
  L: GoombaLevelInit,
  bands: readonly { ax: number; ay: number; bx: number; by: number }[],
): RunState {
  return {
    L,
    segs: segsFor(L, bands),
    p: { x: L.start[0], y: L.start[1] },
    v: { x: START_VX, y: 0 },
    face: 1,
    boardA: L.startAngle,
    grounded: false,
    onBand: -1,
    t: 0,
    slowT: 0,
    result: null,
    snap: { x: L.start[0], y: L.start[1], t: 0 },
    bandHits: bands.map(() => 0),
    cushHits: L.cushions.map(() => 0),
    popT: L.pops.map(() => -9),
    got: L.cans.map(() => false),
    gotN: 0,
    bumpT: L.bumpers.map(() => -9),
    events: [],
  };
}

export function stepRun(st: RunState, dt: number): void {
  if (st.result) return;
  st.t += dt;
  st.v.y += G * dt;
  const cap = st.L.maxSpeed || MAX_SPEED; // later levels run hotter
  const sp0 = Math.hypot(st.v.x, st.v.y);
  if (sp0 > cap) {
    st.v.x *= cap / sp0;
    st.v.y *= cap / sp0;
  }
  st.p.x += st.v.x * dt;
  st.p.y += st.v.y * dt;

  st.grounded = false;
  st.onBand = -1;
  let tanX = 0,
    tanY = 0;
  for (const s of st.segs) {
    const abx = s.bx - s.ax,
      aby = s.by - s.ay,
      l2 = abx * abx + aby * aby || 1e-6;
    let t = ((st.p.x - s.ax) * abx + (st.p.y - s.ay) * aby) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = s.ax + abx * t,
      qy = s.ay + aby * t;
    let nx = st.p.x - qx,
      ny = st.p.y - qy;
    const d = Math.hypot(nx, ny);
    if (d < R && d > 1e-9) {
      nx /= d;
      ny /= d;
      st.p.x = qx + nx * R;
      st.p.y = qy + ny * R;
      const vn = st.v.x * nx + st.v.y * ny;
      if (vn < 0) {
        st.v.x -= (1 + E_KIND[s.kind]) * vn * nx;
        st.v.y -= (1 + E_KIND[s.kind]) * vn * ny;
        if (s.band >= 0) st.bandHits[s.band] = 1;
        if (s.cush >= 0) st.cushHits[s.cush] = 1;
      }
      const fr = FR_KIND[s.kind] * dt;
      const tx = -ny,
        ty = nx,
        vt = st.v.x * tx + st.v.y * ty;
      st.v.x -= vt * fr * tx;
      st.v.y -= vt * fr * ty;
      st.grounded = true;
      tanX = abx;
      tanY = aby;
      if (s.band >= 0) st.onBand = s.band;
    }
  }

  const L = st.L;
  // piñata bumpers: pinball-style radial kick, adds energy
  for (let i = 0; i < L.bumpers.length; i++) {
    const bp = L.bumpers[i];
    let nx = st.p.x - bp.x,
      ny = st.p.y - bp.y;
    const d = Math.hypot(nx, ny);
    if (d < BUMP_R + R && d > 1e-9) {
      nx /= d;
      ny /= d;
      st.p.x = bp.x + nx * (BUMP_R + R);
      st.p.y = bp.y + ny * (BUMP_R + R);
      const vn = st.v.x * nx + st.v.y * ny;
      st.v.x -= (1 + BUMP_E) * vn * nx;
      st.v.y -= (1 + BUMP_E) * vn * ny;
      const sp2 = Math.hypot(st.v.x, st.v.y);
      if (sp2 < BUMP_MIN) {
        st.v.x = nx * BUMP_MIN;
        st.v.y = ny * BUMP_MIN;
      }
      st.bumpT[i] = st.t;
      st.events.push(["bump", st.p.x, st.p.y, st.t]);
    }
  }
  // neon watering cans: collect every one before the spider plant unlocks
  for (let i = 0; i < L.cans.length; i++) {
    if (st.got[i]) continue;
    const dx = st.p.x - L.cans[i][0],
      dy = st.p.y - L.cans[i][1];
    if (dx * dx + dy * dy < (CAN_R + R) * (CAN_R + R)) {
      st.got[i] = true;
      st.gotN++;
      st.events.push(["can", L.cans[i][0], L.cans[i][1], st.t]);
    }
  }
  // party poppers: fly close and she gets re-launched along the popper's aim
  for (let i = 0; i < L.pops.length; i++) {
    if (st.t - st.popT[i] < POP_COOLDOWN) continue;
    const pp = L.pops[i];
    const dx = st.p.x - pp.x,
      dy = st.p.y - pp.y;
    if (dx * dx + dy * dy < POP_R2) {
      // A popper redirects rather than overwrites: it sets DIRECTION, but
      // carries her arrival speed through (with pp.spd as a floor). Replacing
      // velocity outright would erase everything the players did upstream —
      // and in a 4-player run the whole point is "that was MY band."
      st.p.x = pp.x;
      st.p.y = pp.y;
      const arrive = Math.hypot(st.v.x, st.v.y);
      const sp2 = Math.min(st.L.maxSpeed || MAX_SPEED, Math.max(arrive, pp.spd * 0.82));
      st.v.x = pp.ux * sp2;
      st.v.y = pp.uy * sp2;
      st.popT[i] = st.t;
      st.events.push(["pop", pp.x, pp.y, st.t]);
    }
  }

  const sp = Math.hypot(st.v.x, st.v.y);
  if (Math.abs(st.v.x) > 1) st.face = st.v.x >= 0 ? 1 : -1;
  if (st.grounded && sp < 12) st.v.x += st.face * 10 * dt; // tiny snowboard pump
  // board angle: follow the ground, else follow the flight
  let target: number;
  if (st.grounded && (tanX || tanY)) {
    if (tanX * st.face < 0) {
      tanX = -tanX;
      tanY = -tanY;
    }
    target = Math.atan2(tanY, tanX);
  } else target = Math.atan2(st.v.y, st.v.x * st.face) * 0.35 * st.face;
  let da = target - st.boardA;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  st.boardA += da * Math.min(1, 14 * dt);

  // outcomes
  const b = L.bounds;
  if (sp < 3.5) st.slowT += dt;
  else st.slowT = 0;
  const gdx = st.p.x - L.goal[0],
    gdy = st.p.y - L.goal[1];
  if (gdx * gdx + gdy * gdy < 81 && st.gotN === L.cans.length) {
    st.result = "win";
    return;
  }
  if (st.p.y > b.y1 + 25) st.result = "fall";
  else if (st.p.x < b.x0 - 12) st.result = "left";
  else if (st.p.x > b.x1 + 30) st.result = "flew";
  else if (st.slowT > 1.4) st.result = "stall";
  else if (st.t > RUN_MAX) st.result = "loop";
  else if (st.t - st.snap.t > 3.5) {
    // trapped in a bowl/corner, or boinging in place
    const sdx = st.p.x - st.snap.x,
      sdy = st.p.y - st.snap.y;
    if (sdx * sdx + sdy * sdy < 64 || Math.abs(sdx) < 6) st.result = "loop";
    else st.snap = { x: st.p.x, y: st.p.y, t: st.t };
  }
}

/** Score a whole run instantly — what the server does the moment PLAY lands.
 * `bands` must already be snapped (the room snaps at placement time). */
export function scoreRun(
  levelIdx: number,
  bands: readonly { ax: number; ay: number; bx: number; by: number }[],
): { result: RunResult; t: number } {
  const L = GOOMBA_LEVELS[levelIdx];
  const st = makeRun(L, bands);
  while (!st.result && st.t < RUN_MAX + 1) stepRun(st, SUB);
  return { result: st.result ?? "timeout", t: +st.t.toFixed(3) };
}
