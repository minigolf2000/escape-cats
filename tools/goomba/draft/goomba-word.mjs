// GOOMBA — the word IS the level. Six letters drawn as monoline terrain on one
// baseline, floating in space, and she rides them left to right: down into the
// G's bowl, a full lap inside each O, into the M's valley, over the B's
// shoulder, and down the A's open apex onto the crossbar the plant sits on.
// Nothing else is drawn, so what the camera fits at the start of a run is the
// word, and the gaps BETWEEN the letters are the void — a run that comes off
// the word falls out of the world.
//
// It plays the same from its FRAME as from its link: the drawing carries
// everything the level is, because the one thing a frame cannot carry — a
// popper's speed — is not a thing any level carries any more.
//
// This is a SHOWCASE board and it wins on PLAY, with NO BANDS: every letter
// with a room in it catches her and sends her on. Three of those rooms hold a
// POPPER (the G's bowl, both O counters) and two hold a BUMPER — a bouncy ball
// in the M's valley, and one in the crook between the B and the A. The room's
// four bands are still there to play with; nothing needs them. Nothing here
// grades it either — `draft.mjs link`, played, does that.
//
// Everything is a stroke font with ANCHORS: `letters(p)` returns the polylines
// and the named points the choreography aims at, so every popper is aimed at a
// PLACE on the next letter (`aimAt` solves the arc) rather than at a hand-typed
// angle. Move a letter, retype a width, and the throws follow it.
//
//   node draft.mjs --draft goomba-word card      the ride, as a picture
//   node draft.mjs --draft goomba-word run       ...and as a route
//   node draft.mjs --draft goomba-word audit     the geometry invariants
//
// Four facts about the physics shape every letter here:
//   * Bands cannot lift. Height comes from a popper or a bumper, so the ride
//     is a chain of them and the letters are what she rides in between.
//   * A popper OVERWRITES her velocity, so each letter is independent: the
//     arc out of the G is the same arc however she got to the bottom of it.
//   * A BUMPER IS A MIRROR at 1.18 on the normal. It cannot aim — it can only
//     send her back the way she came, faster. So a ball only works where she
//     ARRIVES TRAVELLING THE WAY SHE MUST NOT LEAVE, which is why the second O
//     throws her over the M's valley onto its FAR arm (she slides back down
//     into the ball moving left, and leaves moving right), and why the B's
//     ball sits where her carom off the A's own leg drops her.
//   * There is ONE popper speed, everywhere: POP_SPD x POP_FIRE = 106.6 u/s
//     (packages/shared/src/goomba/levels.ts). It is not a per-level number and
//     a Figma frame could never have carried one, so this board is SIZED to
//     it — cap height 45 with both launch seats halfway up their letter, which
//     is what a 106.6 throw crosses a letter pitch and still drops into the
//     next mouth. `audit` reports what each throw needs of the 106.6 there is.
//     That is also why the frame and the link play identically.

import { POP_SPD, POP_FIRE, MAX_SPEED } from "./_sim.mjs";

/** What every popper on this board fires at. There is no other. */
const FIRE = Math.min(MAX_SPEED, POP_SPD * POP_FIRE);

const D = Math.PI / 180;
const r2 = (v) => +v.toFixed(2);

export const P = {
  // ── the word, as type ──────────────────────────────────────────────────
  yT: 40,          // cap line
  ch: 45,          // cap height (baseline = yT + ch)
  seg: 3.0,        // arc chord: the facet length every curve is cut into
  // Letter boxes: left edge, then widths. The 10 u of LEAD between boxes is
  // the void she can fall through, and it must stay well over 4.4 (2 x her
  // radius) or a fall between two letters wedges instead of killing.
  lead: 8,
  // ...except before the A, which is kerned in: an A's diagonal leaves a hole
  // under the B that reads as a word break. `audit` is what says how far this
  // can go — the two letters must stay more than 4.4 apart.
  kernA: 7,
  x0: 8,
  wG: 36, wO: 36, wM: 41, wB: 34, wA: 39,
  // Frame padding. The 40 above the cap line is not decoration: the throws
  // between letters are lofted and their apexes have to be inside the world,
  // or she leaves the camera on every hop.
  padX: 7, padTop: 30, padBot: 16,

  // G: the aperture, in degrees about the letter's centre (y-down, 0 = east).
  gLo: 14,         // the lower terminal, where the crossbar hangs
  gHi: -62,        // the upper lip. The aperture has to pass a LOFTED throw —
                   // the arc out of the bowl leaves at about 75 degrees
  gBar: 2,         // crossbar inner end, as x from the letter's centre. It is
                   // a LONG bar: it has to catch the drop, and a G reads
                   // better for it. Nothing throws from under it any more.
  // O: the mouth is a gap centred on the top, half-width in degrees. She drops
  // in over its right half and is thrown back out through it, so the mouth has
  // to be wide enough to enter steeply and leave steeply.
  oGap: 26,
  // M: the middle vertex, as a fraction of cap height, and the flat welded into
  // its bottom (a sharp V is a wedge, not a basin).
  mMid: 0.80, mFlat: 3.5,
  // B: the two lobes, as fractions of the letter's width. They meet the stem at
  // DIFFERENT heights — a B whose lobes join tangentially puts two surfaces
  // 0.2 u apart, which is a wedge she never leaves. `bWaist` is the clear stem
  // between them; `bPopOut`/`bPopDown` seat the popper against the crown.
  bTop: 0.84, bBot: 0.94, bWaist: 7, bPopOut: 2, bPopDown: 6,
  // Where on the top lobe the M's throw lands, as a fraction of its width.
  // Land her HIGH on the lobe and she settles onto it and rides the curve down
  // into the crown's popper; land her near the crown and she skips over it
  // airborne, which is a catch that holds only for the exact geometry it was
  // tuned at. 0.35 wins across every letter spacing tried.
  bBrow: 0.35,
  // A: the crossbar's height as a fraction of cap height, and the APEX GAP.
  // The last stage does not thread that gap in flight — the ball under the B
  // fires her UP THE A'S OWN LEFT LEG, she crests the tip at a walking pace
  // and tips through the gap into the counter, onto the bar the plant is on.
  aBar: 0.85, aApex: 9,

  // ── the ride ───────────────────────────────────────────────────────────
  // She starts INSIDE the G's counter, above its crossbar. START_VX is 20 and
  // unconditional, so she drifts right as she falls and lands ON the bar: the
  // drop is the level saying hello, and the popper it lands on is the first
  // throw. Move the start and check she still clears the ring's left wall.
  startDX: -8, startDY: -18,
  // Every throw is aimed at a PLACE, never at a speed: there is one popper
  // speed (POP_SPD, 106.6 u/s off the muzzle) and this board is built inside
  // it. The G's throw is aimed a little BELOW O1's mouth — at the roof it is
  // out of range, and out of range is what makes `aimAt` give up and point
  // straight at the target, which lands her in O1's own popper.
  gAimDX: 0, gAimDY: 6,
  oPopA: 180,      // where that popper sits on the ring (deg, y-down)
  oLoft: 1,        // LOFTED: the flat arc out of a ring is the ring itself
  o1AimDX: 0, o1AimDY: 6,    // O1 throws at O2's mouth
  o2AimT: 0.45,       // where on the M's FAR slope the second O lands her
  o2AimDX: 0, o2AimDY: 0,
  // THE DEVICE IN EACH ROOM. Every `*Dev` flips between "bump" (a ball) and
  // "pop", so which rooms can hold a ball is a question you can answer here
  // rather than argue about:
  //   * the M and the B CAN, and do. Both are places she arrives travelling
  //     the way she must not leave, which is the only thing a mirror can fix.
  //   * the G cannot (`--set gDev=bump`): she rattles round the counter and
  //     never leaves it. She drops in at about 109 and a mirror gives back
  //     1.18 of that at best — 128 against the 135 the hop to O1 needs.
  //   * an O cannot (`--set oDev=bump`): no seat anywhere on the ring gets her
  //     out, because a mirror can only send her back the way she came, and the
  //     way she came is round the ring — she rides back up it and leaves the
  //     mouth pointing at the letter she just left.
  // Both ball positions are TUNED TO THESE LETTERFORMS, and a mirror multiplies
  // error: about 1 u either way is the whole window (`mBallOff` 2.5-3.5, the
  // B's ball dx 3.5-4 by dy 4-7). Move a letter and re-run the search with
  // `draft.mjs sweep` rather than nudging them by eye.
  gDev: "pop", gBallDX: 0, gBallDY: 0,
  oDev: "pop", oBallA: 150, oBallIn: 2.6,
  mDev: "bump", mBallT: 0.3, mBallOff: 3.5,
  bDev: "bump", bBumpDX: 1.25, bBumpDY: 5,
  mAimDX: 0, mAimDY: 0,      // ...aimed at the B's brow
  bAimDX: 0, bAimDY: 0,      // ...aimed at the middle of the A's chimney
  goalDX: 5,       // the plant, right of centre on the A's crossbar
  canA: 55,        // where on the first O's lap the can hangs (deg, y-down)
  canIn: 8,        // ...and how far inboard of the ring
};

/** Points along an ellipse arc, a0 -> a1 in degrees, y-down. */
function ell(cx, cy, rx, ry, a0, a1, seg) {
  const n = Math.max(3, Math.ceil((Math.abs(a1 - a0) * D * (rx + ry)) / 2 / seg));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (a0 + ((a1 - a0) * i) / n) * D;
    pts.push([r2(cx + rx * Math.cos(t)), r2(cy + ry * Math.sin(t))]);
  }
  return pts;
}
const on = (cx, cy, rx, ry, a) => [r2(cx + rx * Math.cos(a * D)), r2(cy + ry * Math.sin(a * D))];

/**
 * The word. Returns the polylines, `A` (the anchors the ride is aimed at) and
 * the baseline. One entry in `A` per letter, holding only the points something
 * downstream actually aims at.
 */
export function letters(p = P) {
  const polys = [], A = {};
  const yB = p.yT + p.ch;
  const boxes = [];
  let x = p.x0;
  for (const [k, w] of [["G", p.wG], ["O1", p.wO], ["O2", p.wO], ["M", p.wM], ["B", p.wB], ["A", p.wA]]) {
    if (k === "A") x -= p.kernA;
    boxes.push({ k, x, w });
    x += w + p.lead;
  }
  A.right = x - p.lead;

  for (const box of boxes) {
    const { k, x: x0, w } = box;
    box.from = polys.length;   // which polylines this letter owns, for `audit`
    const cx = x0 + w / 2, cy = p.yT + p.ch / 2, rx = w / 2, ry = p.ch / 2;
    if (k === "G") {
      // A ring open at the upper right, with the crossbar hanging off the lower
      // terminal. Inside it, a bowl: the level's first room.
      const term = on(cx, cy, rx, ry, p.gLo);
      polys.push(ell(cx, cy, rx, ry, p.gLo, p.gHi + 360, p.seg));
      polys.push([[r2(cx + p.gBar), term[1]], term]);
      A.G = {
        // ON THE CROSSBAR, which is where the drop into the counter ends: the
        // bar is long enough to catch her, and landing halfway up the letter
        // instead of on its floor is what brings the throw to O1 inside the
        // one fire speed there is. A drop lands perpendicular and terrain
        // gives back 2%, so what she lands on has to hold a popper either way.
        bowl: [r2(cx + p.gBar + 2), r2(term[1] - 2.4)],
        ball: [r2(cx + p.gBallDX), r2(cy + ry - 5.5 + p.gBallDY)],
        start: [r2(cx + p.startDX), r2(cy + p.startDY)],
      };
    } else if (k[0] === "O") {
      // A ring with one mouth at the top: in through it, a lap round the
      // inside, and out through it again carrying a popper's speed instead of
      // whatever the last letter left her with.
      polys.push(ell(cx, cy, rx, ry, -90 + p.oGap, 270 - p.oGap, p.seg));
      A[k] = {
        mouth: [cx, r2(cy - ry)],
        lipL: on(cx, cy, rx, ry, -90 - p.oGap),
        lipR: on(cx, cy, rx, ry, -90 + p.oGap),
        // Halfway up the ring's LEFT wall: the end of her lap, and as high as
        // she can still reliably climb to. Every unit of height here is a unit
        // the throw to the next letter does not have to buy, which is what
        // fits these hops inside one fire speed. Up-and-right from here is
        // INWARD, the only direction a popper standing on a ring may fire.
        pop: on(cx, cy, rx - 2.6, ry - 2.6, p.oPopA),
        ball: on(cx, cy, rx - p.oBallIn, ry - p.oBallIn, p.oBallA),
        can: on(cx, cy, rx - p.canIn, ry - p.canIn, p.canA),
      };
    } else if (k === "M") {
      const mid = p.yT + p.ch * p.mMid;
      polys.push([
        [x0, yB], [x0, p.yT],
        [r2(cx - p.mFlat), r2(mid)], [r2(cx + p.mFlat), r2(mid)],
        [r2(x0 + w), p.yT], [r2(x0 + w), yB],
      ]);
      A.M = {
        peakL: [x0, p.yT], peakR: [r2(x0 + w), p.yT], vee: [cx, r2(mid)],
        // The valley floor. Everything that comes off the second O lands here
        // — she arrives steeply, lands perpendicular, and terrain gives back
        // 2%, so the valley is a room with one exit and the exit is a popper.
        floor: [cx, r2(mid - 4.6)],
        // The ball sits ON the M's far arm, not in the crook of the V: she
        // lands higher up that arm, slides down INTO it, and a near head-on
        // mirror sends her straight back up the way she came and off the peak.
        // A ball at the bottom of a 46-deep V just rattles her between the two
        // walls instead.
        ball: (() => {
          const a = [cx + p.mFlat, mid], b = [x0 + w, p.yT];
          const ux = b[0] - a[0], uy = b[1] - a[1], L = Math.hypot(ux, uy);
          // +mBallOff is OFF the arm on the side she rides (up and left).
          return [r2(a[0] + ux * p.mBallT + (uy / L) * p.mBallOff),
                  r2(a[1] + uy * p.mBallT - (ux / L) * p.mBallOff)];
        })(),
      };
    } else if (k === "B") {
      // Stem, then two lobes hung off it. Her road is the OUTSIDE of the top
      // lobe; the counters stay shut, which is what keeps a B a B.
      polys.push([[x0, p.yT], [x0, yB]]);
      const mid = p.yT + p.ch / 2, hw = p.bWaist / 2;
      const ryT = (mid - hw - p.yT) / 2, ryB = (yB - mid - hw) / 2;
      polys.push(ell(x0, r2(p.yT + ryT), r2(w * p.bTop), r2(ryT), -90, 90, p.seg));
      polys.push(ell(x0, r2(yB - ryB), r2(w * p.bBot), r2(ryB), -90, 90, p.seg));
      A.B = {
        top: [x0, p.yT],
        // A landing on the top lobe's upper face, half way out: she comes down
        // onto the B and rides the lobe's outside to the crown from there.
        brow: [r2(x0 + w * p.bTop * p.bBrow),
               r2(p.yT + ryT - ryT * Math.sqrt(1 - p.bBrow * p.bBrow))],
        // Off the crown of the top lobe and tucked DOWN into its curve, on the
        // line she leaves the letter by. Two things decide this spot: a popper
        // sitting exactly on a tight convex vertex fires her into the facets
        // either side of it, and one parked out in the B-to-A gap reads as a
        // stray mark on the only silhouette this level has.
        shoulder: [r2(x0 + w * p.bTop + p.bPopOut), r2(p.yT + ryT + p.bPopDown)],
        // The belly: the crown of the LOWER lobe, where a ball sits in the
        // widest part of the letter and she has the whole height of the top
        // lobe to fall onto it from.
        ball: [r2(x0 + w * p.bBot + p.bBumpDX), r2(yB - ryB + p.bBumpDY)],
      };
    } else {
      // A, with its apex snipped open: the chimney the last throw drops down.
      const apex = cx, half = p.aApex / 2;
      const tL = [r2(apex - half), r2(p.yT + (p.aApex / w) * p.ch)];
      const tR = [r2(apex + half), tL[1]];
      polys.push([[x0, yB], tL]);
      polys.push([[r2(x0 + w), yB], tR]);
      const byY = p.yT + p.ch * p.aBar;
      const f = (byY - tL[1]) / (yB - tL[1]);
      polys.push([
        [r2(tL[0] + (x0 - tL[0]) * f), r2(byY)],
        [r2(tR[0] + (x0 + w - tR[0]) * f), r2(byY)],
      ]);
      A.A = { apex: [apex, tL[1]], gap: p.aApex, bar: [cx, r2(byY)] };
    }
    box.to = polys.length;
  }
  return { polys, A, yB, boxes };
}

/**
 * Aim a popper from `from` at `to`. `spd * 0.82` is an ASSIGNMENT (physics.ts),
 * so a throw is clean ballistics with two solutions: the FLAT one gets there
 * under a ceiling, the LOFTED one climbs over a lip in the way (the G's own
 * crossbar, an O's ring) and arrives descending, which is the only way into a
 * mouth or a chimney. Degrees, y-down.
 */
function aimAt(from, to, loft = false) {
  const v = FIRE, g = 140;
  const dx = to[0] - from[0], dy = to[1] - from[1];
  if (Math.abs(dx) < 1e-6) return dy > 0 ? 90 : -90;
  // dy = dx·tan + k(1 + tan²)  =>  k·tan² + dx·tan + (k − dy) = 0.
  const k = (g * dx * dx) / (2 * v * v);
  const disc = dx * dx - 4 * k * (k - dy);
  // Out of range at this speed: point straight at it and let the run say so.
  if (disc < 0) return r2(Math.atan2(dy, dx) / D);
  const t = (-dx + (loft ? -1 : 1) * Math.sqrt(disc)) / (2 * k);
  return r2(Math.atan(t) / D + (dx < 0 ? 180 : 0));
}

export function buildLevel(p = P, extra = {}) {
  const { polys, A, yB } = letters(p);
  const pops = [], bumpers = [];
  const pop = (at, target, loft) =>
    pops.push({ x: at[0], y: at[1], deg: aimAt(at, target, loft) });

  // G: the bowl's popper throws her out through the aperture into O1's mouth.
  // Lofted, because the flat arc out of the bowl is the one the crossbar eats.
  if (p.gDev === "bump") bumpers.push({ x: A.G.ball[0], y: A.G.ball[1] });
  else pop(A.G.bowl, [A.O1.mouth[0] + p.gAimDX, A.O1.mouth[1] + p.gAimDY], true);
  // Each O: she rides the inside all the way round to the popper on the left
  // wall, which fires her back out through the same mouth at the next letter.
  if (p.oDev === "bump") bumpers.push({ x: A.O1.ball[0], y: A.O1.ball[1] });
  else pop(A.O1.pop, [A.O2.mouth[0] + p.o1AimDX, A.O2.mouth[1] + p.o1AimDY], !!p.oLoft);
  // O2 throws OVER the M's valley and onto its FAR slope, because what waits
  // at the bottom is a mirror: she has to arrive travelling the way she must
  // not leave. `o2AimT` slides that landing up and down the right slope.
  const land = [r2(A.M.vee[0] + (A.M.peakR[0] - A.M.vee[0]) * p.o2AimT),
                r2(A.M.vee[1] + (A.M.peakR[1] - A.M.vee[1]) * p.o2AimT)];
  pop(A.O2.pop, [land[0] + p.o2AimDX, land[1] + p.o2AimDY], !!p.oLoft);
  // M: she comes off the second O steeply and lands in the valley. A ball
  // seated in it turns that drop into a launch back out over the M's own
  // right peak; a popper there does the same job by assignment.
  if (p.mDev === "bump") bumpers.push({ x: A.M.ball[0], y: A.M.ball[1] });
  else pop(A.M.floor, [A.B.brow[0] + p.mAimDX, A.B.brow[1] + p.mAimDY], true);
  // B: the shoulder, aimed at the middle of the A's CHIMNEY rather than at the
  // plant under it — what the last throw has to survive is the gap between the
  // A's two tips, and everything below that is the counter catching her.
  if (p.bDev === "bump") bumpers.push({ x: A.B.ball[0], y: A.B.ball[1] });
  else pop(A.B.shoulder, [A.A.apex[0] + p.bAimDX, A.A.apex[1] + p.bAimDY], true);

  // One can, inside the first O on the line she laps it: a collectible in a
  // counter is the one place a prop can sit without touching a letter's
  // silhouette, which on this board is the whole point.
  const cans = [A.O1.can];

  // NO BANDS. Every letter with a room in it catches her and throws her on, so
  // the board wins on PLAY alone: the word is the ride, and the four bands the
  // room still holds are there to be played with, not spent.
  const solution = [];

  return {
    name: "GOOMBA",
    start: [...A.G.start],
    // Off the middle of the bar: the plant's glow disc is 18 wide and a plant
    // parked dead centre hides the crossbar that makes the A an A.
    goal: [r2(A.A.bar[0] + p.goalDX), r2(A.A.bar[1] - 4)],
    terrain: polys,
    cans,
    pops,
    bumpers,
    frame: {
      x0: p.x0 - p.padX, y0: p.yT - p.padTop,
      x1: r2(A.right + p.padX), y1: r2(yB + p.padBot),
    },
    solution: extra.solution || solution,
  };
}

/** Distance from point c to segment ab. */
function segD(c, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const l2 = abx * abx + aby * aby || 1e-9;
  let t = ((c[0] - a[0]) * abx + (c[1] - a[1]) * aby) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(c[0] - (a[0] + abx * t), c[1] - (a[1] + aby * t));
}
/** Closest approach between two polylines, sampled point-to-segment both ways. */
function polyGap(P1, P2) {
  let m = Infinity;
  for (const [X, Y] of [[P1, P2], [P2, P1]])
    for (const p of X) for (let i = 0; i + 1 < Y.length; i++) m = Math.min(m, segD(p, Y[i], Y[i + 1]));
  return m;
}

/**
 * The geometry facts a RUN cannot show, because they are about what must stay
 * impossible. Letter spacing is the big one: this level's hazard is the void
 * between letters, and a void narrower than she is turns a death into a wedge
 * she sits in until the stuck detector fires.
 */
export function audit(p = P) {
  const { polys, A, boxes } = letters(p);
  const L = buildLevel(p);
  const out = [];
  const say = (name, rule, clear, ok) => out.push({ name, rule, clear: r2(clear), ok });

  // 1. Every gap between adjacent letters is a fall, not a wedge. This board's
  //    hazard IS the void between letters; a void narrower than she is turns a
  //    death into something she sits in until the stuck detector fires.
  for (let i = 0; i + 1 < boxes.length; i++) {
    let m = Infinity;
    for (let a = boxes[i].from; a < boxes[i].to; a++)
      for (let b = boxes[i + 1].from; b < boxes[i + 1].to; b++) m = Math.min(m, polyGap(polys[a], polys[b]));
    say(`gap ${boxes[i].k} -> ${boxes[i + 1].k}`, "> 4.4, she wedges", m, m > 4.4);
  }
  // 2. Every popper hop still REACHES, at the ONE speed there is. The minimum
  //    launch speed for a target is v² = g(rise + hypot(run, rise)); measured
  //    against FIRE, this is the headroom the whole ride runs on. Widen a
  //    letter or the lead and this is what goes red first.
  const need = (from, to) => {
    const dx = Math.abs(to[0] - from[0]), rise = from[1] - to[1];
    return Math.sqrt(140 * (rise + Math.hypot(dx, rise)));
  };
  // Measured to the point each throw is actually AIMED at, offsets and all —
  // aiming below a mouth is how a hop that cannot reach the roof still gets
  // in, so measuring to the roof would report a board that plays as broken.
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const hops = [
    ["G -> O1", A.G.bowl, [A.O1.mouth[0] + p.gAimDX, A.O1.mouth[1] + p.gAimDY], p.gDev],
    ["O1 -> O2", A.O1.pop, [A.O2.mouth[0] + p.o1AimDX, A.O2.mouth[1] + p.o1AimDY], "pop"],
    ["O2 -> M's far arm", A.O2.pop,
     (([x, y]) => [x + p.o2AimDX, y + p.o2AimDY])(lerp(A.M.vee, A.M.peakR, p.o2AimT)), "pop"],
    ["M -> B", A.M.floor, A.B.brow, p.mDev],
    ["B -> A", A.B.shoulder, A.A.apex, p.bDev]];
  for (const [n, from, to, dev] of hops) {
    if (dev === "bump") continue;   // a mirror is not aimed; it has no range
    const v = need(from, to);
    say(`throw: ${n}`, `needs ${v.toFixed(0)} of ${FIRE.toFixed(1)}`, FIRE - v, v < FIRE);
  }
  // 3. No ball may stand a POCKET away from terrain. She is caught at 7.7 from
  //    a ball's centre, so terrain between 7.7 and 7.7 + 4.4 of it leaves a
  //    slot she fits into and cannot leave: the bumper holds her out, the wall
  //    holds her in. Overlapping the terrain (gap <= 0) is fine, and is how
  //    both of these sit: they lean on the letter they belong to.
  for (const [n, b] of (L.bumpers || []).map((b, i) => [["M's valley", "B/A crook"][i] || `ball ${i}`, b])) {
    let d = Infinity;
    for (const poly of polys) d = Math.min(d, polyGap([[b.x, b.y]], poly));
    const slot = d - 7.7;
    say(`ball, ${n}`, "no 0..4.4 slot beside it", slot, slot <= 0 || slot >= 4.4);
  }
  // 4. The A's chimney passes a 4.4 u cat: she crests the apex at a walking
  //    pace and tips into the counter through this gap.
  say("A's chimney", "> 4.4 wide", A.A.gap, A.A.gap > 4.4);
  // 5. An O's popper must not grab her as she drops in: she enters over the
  //    mouth's right half, and a popper within 8.2 of that would fire her
  //    straight back out instead of letting her ride the ring.
  const d = Math.hypot(A.O1.lipR[0] - A.O1.pop[0], A.O1.lipR[1] - A.O1.pop[1]);
  say("O: entry lip to popper", "> 8.2, the pop reach", d, d > 8.2);
  // 6. The M's valley floor is a basin she can land flat in, not a wedge.
  say("M's valley floor", "> 4.4 across", 2 * p.mFlat, 2 * p.mFlat > 4.4);
  return out;
}
