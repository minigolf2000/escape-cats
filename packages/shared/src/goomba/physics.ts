// The Goomba Glider physics — the ONLY copy. Deterministic and side-effect
// free: the server scores a run the instant PLAY lands and every phone animates
// it with the same 240Hz substeps, so the animation ends where the server said.
// A number changed here retunes every level in every event's pack.

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
  groundE,
  FR_KIND,
  POP_R2,
  POP_SPD,
  POP_FIRE,
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
  /** pid of whoever laid it. A note, not a rule: any player may take any band
   * back, and every band wears the TEAM's colour. */
  pid: string;
}

const SNAP = 5; // a dragged endpoint this close to terrain lands ON it

// A snapped endpoint lands FLUSH — on the vertex or the face, offset in
// neither direction. Bury it by d and the ledge vertex sits d above the band,
// so she hits its collision circle early on a near-dead surface and stops
// (0.8 cost 77% of her speed); lift it and the same kerb moves to the
// departure end. Never "fix" a bonk by offsetting an endpoint.
function snapEnd(L: GoombaLevelInit, x: number, y: number): Pt {
  // lips and ledge corners are vertices — players aim for those, so vertices win
  let best: Pt | null = null,
    bestD2 = SNAP * SNAP;
  for (const poly of L.terrain)
    for (const [vx, vy] of poly) {
      const d2 = (x - vx) * (x - vx) + (y - vy) * (y - vy);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = [vx, vy];
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
        best = [qx, qy];
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
  const sp0 = Math.hypot(st.v.x, st.v.y);
  if (sp0 > MAX_SPEED) {
    st.v.x *= MAX_SPEED / sp0;
    st.v.y *= MAX_SPEED / sp0;
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
        // Terrain restitution depends on steepness (groundE); bands and
        // cushions have one value each.
        const e = s.kind === KIND_GROUND ? groundE(nx) : E_KIND[s.kind];
        st.v.x -= (1 + e) * vn * nx;
        st.v.y -= (1 + e) * vn * ny;
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
  // watering cans: collect every one before the spider plant unlocks
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
      // A popper OVERWRITES velocity — grabbed to the centre, fired at its own
      // aim and speed, whatever she arrived with. That is the property the
      // levels are built on (DESIGNING.md, "poppers are the antidote"):
      // nothing upstream changes what happens downstream, so each stage needs
      // its own band, and the same popper throws the same arc however she
      // arrives. Never carry arrival speed through.
      st.p.x = pp.x;
      st.p.y = pp.y;
      // ONE speed for every popper in every level (POP_SPD), read from the
      // constant and not from the popper, so a level cannot carry another.
      const sp2 = Math.min(MAX_SPEED, POP_SPD * POP_FIRE);
      st.v.x = pp.ux * sp2;
      st.v.y = pp.uy * sp2;
      st.popT[i] = st.t;
      st.events.push(["pop", pp.x, pp.y, st.t]);
    }
  }

  const sp = Math.hypot(st.v.x, st.v.y);
  if (Math.abs(st.v.x) > 1) st.face = st.v.x >= 0 ? 1 : -1;
  if (st.grounded && sp < 12) st.v.x += st.face * 10 * dt; // tiny snowboard pump
  // Board angle: follow the ground, else the flight. `boardA` is in HER frame,
  // mirrored when she travels left (the renderer draws rotate(boardA * face)
  // then scale(face, 1)), so both branches measure against `v.x * face` /
  // `tanX * face`, never raw +x — a screen angle fed straight in draws her
  // upside down on a leftward slope.
  let target: number;
  if (st.grounded && (tanX || tanY)) {
    if (tanX * st.face < 0) {
      tanX = -tanX;
      tanY = -tanY;
    }
    target = Math.atan2(tanY, tanX * st.face);
  } else target = Math.atan2(st.v.y, st.v.x * st.face) * 0.35;
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
    // Stuck: still within 8 units of where she was 3.5s ago, in BOTH axes —
    // an |dx| test alone reads a straight drop as stuck. `st.snap` is a
    // ROLLING anchor (moved on every survived check) and a two-point sample,
    // so a round trip with a ~3.5s period can read as stuck; RUN_MAX is the
    // real backstop and STOP is a free abort, so under-calling costs nothing.
    const sdx = st.p.x - st.snap.x,
      sdy = st.p.y - st.snap.y;
    if (sdx * sdx + sdy * sdy < 64) st.result = "loop";
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
  // The pack can be emptied or shortened live. Nothing to run is not a win.
  if (!L) return { result: "timeout", t: 0 };
  const st = makeRun(L, bands);
  while (!st.result && st.t < RUN_MAX + 1) stepRun(st, SUB);
  return { result: st.result ?? "timeout", t: +st.t.toFixed(3) };
}
