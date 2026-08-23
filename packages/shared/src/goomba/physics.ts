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
  groundE,
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
  /** pid of whoever laid it. A note, not a claim: no rule reads it (any player
   * may take any band back), and it no longer picks the band's colour — every
   * band on the board wears the TEAM's colour now. */
  pid: string;
}

const SNAP = 5; // a dragged endpoint this close to terrain lands ON it

// A snapped endpoint lands FLUSH — exactly on the vertex or the face, offset in
// neither direction. It used to be buried 0.8 below ("slightly buried, so no
// tip-bonk"), and that burial is what made a snapped band feel like it ends in a
// kerb. Bury an endpoint by d and the ledge's own vertex sits d ABOVE the band's
// riding surface; Goomba's centre rides R above that surface, so it runs into the
// vertex's collision circle sqrt(R² - (R-d)²) EARLY, on a normal whose sine off
// vertical is sqrt(1 - ((R-d)/R)²) — that fraction of her along-band speed drives
// straight into the ground's near-dead restitution (0.02) and dies there. At
// d=0.8 against R=2.2 it is 1.70 units early and 77% of her speed: on level 1's
// bridge she rode in at 39 u/s and came off the V's lip at 10.6 horizontal,
// launched upward. Flush is measurably free at both ends (8 junction shapes,
// arriving and departing, plus every shipped solution). Do not "fix" a bonk by
// lifting the endpoint instead — that just moves the same kerb to the departure
// end, where the band's own tip becomes the thing she trips over on her way on.
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
        // Terrain restitution depends on how steep the surface is — see
        // groundE: walls give a little back, floors stay dead. Bands and
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
      // A popper OVERWRITES velocity — grabbed to the centre, fired at its own
      // aim and its own speed, whatever she arrived with. It used to carry her
      // arrival speed through when that beat the fire speed (`max(arrive, …)`),
      // on the argument that erasing it would erase what the players did
      // upstream. Measured across every shipped solution, it never did that:
      // the floor bound 15 of 25 pops, and all 10 carries were one popper
      // feeding the next — gravity's few units on the hop between them, not a
      // band. What the `max` did cost was the property the levels are built on
      // (DESIGNING.md, "poppers are the antidote"): a popper erases state, so
      // nothing upstream changes what happens downstream, so each stage needs
      // its own band. A speed that leaks across is a hole in exactly that, and
      // the documented "extend the start ramp" shortcut is what fits through
      // it. Constant is also the only version a player can aim: the speed she
      // leaves at is a property of the POPPER, not of how she got there, so the
      // same popper hit slow and hit fast throws the same arc.
      st.p.x = pp.x;
      st.p.y = pp.y;
      // 0.82 is folded in here rather than into `spd` on purpose: `spd` is
      // level DATA, encoded into every share link and every pack a lobby is
      // already holding, so rescaling it would silently re-tune levels this
      // repo has never seen.
      const sp2 = Math.min(MAX_SPEED, pp.spd * 0.82);
      st.v.x = pp.ux * sp2;
      st.v.y = pp.uy * sp2;
      st.popT[i] = st.t;
      st.events.push(["pop", pp.x, pp.y, st.t]);
    }
  }

  const sp = Math.hypot(st.v.x, st.v.y);
  if (Math.abs(st.v.x) > 1) st.face = st.v.x >= 0 ? 1 : -1;
  if (st.grounded && sp < 12) st.v.x += st.face * 10 * dt; // tiny snowboard pump
  // Board angle: follow the ground, else follow the flight. `boardA` is the
  // angle in HER OWN frame, which is mirrored when she travels left — the
  // renderer draws her as rotate(boardA * face) then scale(face, 1), so a
  // screen angle A costs boardA = A for face 1 and boardA = pi - A for face -1.
  // Both branches therefore measure against `v.x * face` / `tanX * face`, the
  // forward axis after the mirror, and never against raw +x. Feeding a screen
  // angle straight in (what `atan2(tanY, tanX)` did) draws her UPSIDE DOWN and
  // nose-backwards the moment she rides a slope leftward: it is off by
  // pi - 2A, which is ~127 degrees on a 30-degree descent, and it reads as her
  // sinking through the terrain because the rotation puts her body below the
  // centre the sim is keeping R clear of the surface.
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
  // The pack is live data now — it can be emptied or shortened by an editor
  // mid-session — so "there is no such level" is a state this has to have an
  // answer for rather than a crash. Nothing to run is not a win.
  if (!L) return { result: "timeout", t: 0 };
  const st = makeRun(L, bands);
  while (!st.result && st.t < RUN_MAX + 1) stepRun(st, SUB);
  return { result: st.result ?? "timeout", t: +st.t.toFixed(3) };
}
