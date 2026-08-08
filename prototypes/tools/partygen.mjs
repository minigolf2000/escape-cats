// Goomba Rider party-level generator.
//
// Emits the 2/3/4-player puzzle suite: 5 nonstandard mechanics (cushion,
// updraft, bumper, popper, snake plants) × 3 escalating difficulty tiers,
// each parametric in player count N (= band budget = bands genuinely needed).
//
// The structural trick that makes "min bands == players" possible (the open
// problem in ../goomba-rider-levels.md) is VELOCITY NORMALIZATION between
// stages: every stage ends in a passage where a wall kills her horizontal
// speed and a short drop re-verticalizes her. Whatever the players did
// upstream, she enters the next stage in the same state — so every stage
// needs its own band, and every player owns a visible piece of the ride.
//
// Usage as CLI:  node partygen.mjs               (prints the suite as JSON)
// Usage as lib:  import { generateSuite } from './partygen.mjs'
//
// Solutions are found by partysolve.mjs (beam search against the real sim)
// and baked into ../goomba-party-levels.json by partybuild.mjs.

const seg = (...pts) => pts.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]);

// Standard entry: a small shelf slides her off into a chute whose far wall
// kills the start push, so she drops into stage 0 dead vertical (at x≈17.8).
function entry(terrain, bottomY) {
  terrain.push(seg([-6, 0], [10, 5]));
  terrain.push(seg([20, -8], [20, bottomY]));
  return [4, 2];
}

// Dead-end V floor (fail pocket) spanning [x0,x1], dipping `dip` at cx.
const vfloor = (x0, x1, y, cx, dip = 9) => seg([x0, y], [cx, y + dip], [x1, y]);
// Deep-dish floor: gentle shoulders, steep 32-wide dip at cx. She settles in
// ~2s instead of surfing a shallow bowl for 14 — fails must read FAST.
const dishFloor = (x0, x1, y, cx, dip = 13) =>
  seg([x0, y], [cx - 16, y + 3], [cx, y + dip], [cx + 16, y + 3], [x1, y]);

// ------------------------------------------------- CUSHION · bounce chambers
// Sealed chambers with a bouncy-pillow floor. Bare run = vertical boing (loop
// fail). One slanted band per chamber flings her through the floor gap; the
// drop chute under the gap kills her speed before the next stage.
// tier 2 adds a fin at the gap the fling must arc over.
function bounceChambers(N, { gap = 18, fin = 0 } = {}) {
  const W = 104, Hc = 60, chute = 20, top = 26;
  const terrain = [];
  const cushions = [];
  const start = entry(terrain, top);
  const bY = top + N * (Hc + chute) + 16;
  terrain.push(seg([0, -8], [0, bY]));
  terrain.push(seg([W, top], [W, bY]));
  let cx = 0;
  for (let k = 0; k < N; k++) {
    const ceilY = top + k * (Hc + chute);
    const floorY = ceilY + Hc;
    const gapRight = k % 2 === 0;                    // enter left, exit right, alternate
    const gx0 = gapRight ? W - gap : 0, gx1 = gapRight ? W : gap;
    cx = (gx0 + gx1) / 2;
    if (k === 0) terrain.push(seg([20, ceilY], [W, ceilY]));
    else terrain.push(gapRight ? seg([gap, ceilY], [W, ceilY])       // entered from left chute
                               : seg([0, ceilY], [W - gap, ceilY])); // entered from right chute
    if (gapRight) {
      terrain.push(seg([0, floorY], [gx0, floorY]));
      terrain.push(seg([gx0, floorY + chute], [gx0, floorY - fin])); // chute wall (+fin)
      cushions.push({ x: 2, y: floorY - 4, w: gx0 - 4 });
    } else {
      terrain.push(seg([gx1, floorY], [W, floorY]));
      terrain.push(seg([gx1, floorY + chute], [gx1, floorY - fin]));
      cushions.push({ x: gx1 + 2, y: floorY - 4, w: W - gx1 - 4 });
    }
  }
  terrain.push(dishFloor(0, W, bY, cx));
  return { budget: N, start, goal: [cx, bY + 10], terrain, cushions };
}

// tier 3 · NEEDLE THREADER — the gap moves to the floor CENTER, guarded by
// twin fins, with a stalactite hanging over it: the flick must thread the
// window between fin-tops and stalactite, then drop clean into the slot.
// The chute below jogs her to the left wall, so every chamber starts alike.
function needleChambers(N) {
  const W = 104, Hc = 64, drop = 32, top = 26;
  const g0 = 44, g1 = 58, finH = 18, stal = 26;
  const terrain = [];
  const cushions = [];
  const start = entry(terrain, top);
  const bY = top + N * (Hc + drop);
  terrain.push(seg([0, -8], [0, bY]));
  terrain.push(seg([W, top], [W, bY]));
  for (let k = 0; k < N; k++) {
    const ceilY = top + k * (Hc + drop);
    const floorY = ceilY + Hc;
    if (k === 0) terrain.push(seg([20, ceilY], [W, ceilY]));
    else terrain.push(seg([8, ceilY], [W, ceilY]));
    terrain.push(seg([(g0 + g1) / 2, ceilY], [(g0 + g1) / 2, ceilY + stal]));  // stalactite
    terrain.push(seg([0, floorY], [g0, floorY]));                    // floor L
    terrain.push(seg([g0, floorY], [g0, floorY - finH]));            // fin L
    terrain.push(seg([g1, floorY], [g1, floorY - finH]));            // fin R
    terrain.push(seg([g1, floorY], [W, floorY]));                    // floor R
    cushions.push({ x: 2, y: floorY - 4, w: g0 - 4 });
    cushions.push({ x: g1 + 2, y: floorY - 4, w: W - g1 - 4 });
    // chute below the slot + jog kicker to the left wall
    terrain.push(seg([g0, floorY], [g0, floorY + 16]));
    terrain.push(seg([g1, floorY], [g1, floorY + 18]));
    terrain.push(seg([g1, floorY + 18], [4, floorY + 28]));          // kicker
  }
  terrain.push(dishFloor(0, W, bY, 51));
  return { budget: N, start, goal: [51, bY + 10], terrain, cushions };
}

// ------------------------------------------------- UPDRAFT · lift rooms
// PHYSICS: inside a room-filling lift she rises ONCE (monotone, net +65 up)
// and pins to the ceiling forever — so each room is a one-shot interception:
// a band-rail across her rise diagonal flings her through the mid-wall
// window. The window feeds a sealed drop duct (wall kills speed, kicker at
// the bottom slides her into the next room) — stage state is normalized and
// no line of sight exists between windows, so every room needs its own band.
// tier 2: taller rooms (faster pin), higher windows with sill fins.
// tier 3 (Air Pockets): the lift is SPLIT by a dead-air gap — the rail must
// throw her across the gap into the second lift, which carries her up to the
// window. Sink, swoop, rise.
function liftRooms(N, { Hr = 62, winH = 14, winUp = 40, sill = 0, split = false } = {}) {
  const W = 104, duct = 14, top = 22;
  const terrain = [];
  const updrafts = [];
  const iL = duct, iR = W - duct;                    // interior walls
  // start: shelf over the left duct; she falls to room 0's kicker
  terrain.push(seg([-6, 0], [8, 4]));
  terrain.push(seg([0, -8], [0, top + N * Hr]));     // outer left wall
  terrain.push(seg([W, top], [W, top + N * Hr]));    // outer right wall
  terrain.push(seg([iL, top], [W, top]));            // roof over interior+right duct
  let gy = 0, gRight = true;
  for (let k = 0; k < N; k++) {
    const ceilY = top + k * Hr, floorY = ceilY + Hr;
    const enterL = k % 2 === 0;                      // room 0 entered bottom-left
    const [eIn, eOut] = enterL ? [iL, 0] : [iR, W];  // entry duct walls
    const [xIn, xOut] = enterL ? [iR, W] : [iL, 0];  // exit side walls
    const wy = ceilY + winUp;                        // window center
    // entry-side interior wall: solid from ceiling down to the kicker mouth
    terrain.push(seg([eIn, ceilY], [eIn, floorY - 16]));
    // kicker in the entry duct: slides her into the room along the floor
    terrain.push(seg([eOut, floorY - 14], [eIn, floorY - 2]));
    // exit-side interior wall with the window hole
    terrain.push(seg([xIn, ceilY], [xIn, wy - winH / 2]));
    terrain.push(seg([xIn, wy + winH / 2], [xIn, floorY]));
    if (sill) terrain.push(seg(enterL ? [xIn - sill, wy + winH / 2] : [xIn + sill, wy + winH / 2],
                               [xIn, wy + winH / 2]));
    // room floor (slab, doubles as next room's ceiling)
    terrain.push(seg([iL, floorY], [iR, floorY]));
    if (split) {                                     // dead-air gap mid-room
      const g0 = enterL ? 46 : 34, g1 = enterL ? 70 : 58;
      updrafts.push({ x: iL + 1, y: ceilY + 2, w: (enterL ? g0 : g1) - iL - 2, h: Hr - 4 });
      updrafts.push({ x: enterL ? g1 : g0 + 1, y: ceilY + 2, w: enterL ? iR - g1 - 1 : iR - g0 - 2, h: Hr - 4 });
      terrain.push(seg([g0, floorY], [(g0 + g1) / 2, floorY + 0.1], [g1, floorY]));
    } else {
      updrafts.push({ x: iL + 1, y: ceilY + 2, w: iR - iL - 2, h: Hr - 4 });
    }
    gy = floorY; gRight = !enterL;
  }
  // last window's duct bottoms out on the cake
  const cakeX = gRight ? (iR + W) / 2 : duct / 2;
  terrain.push(seg([0, top + N * Hr], [W, top + N * Hr + (gRight ? 6 : -6)]).map(p => p));
  terrain[terrain.length - 1] = gRight
    ? seg([0, gy], [iR, gy], [cakeX, gy + 10], [W, gy])
    : seg([0, gy], [cakeX, gy + 10], [iL, gy], [W, gy]);
  return { budget: N, start: [2, 1], goal: [cakeX, gy + 6], terrain, updrafts };
}
// -------------------------------------------------- BUMPER · piñata chambers
// The kick is a REVERSAL: a radial bounce throws her back the way she came,
// with energy added (min exit 58, up to full speed). So each chamber reads:
// band ramps her right across the room onto the piñata — the piñata slams
// her BACK up-left over the tall fin — she drops into the slot behind it.
// Hit it hard: weak arrivals get weak kicks and die in the right-hand dish.
// A jog kicker under the slot walls her speed off, so chambers are identical.
// tier 2 hangs a ceiling fin mid-room (the kick must fly back LOW);
// tier 3 adds a second piñata squatting in the return path (dodge it).
function pinataChambers(N, { gap = 16, fin = 34, lowCeil = false, dodge = false } = {}) {
  const W = 104, Hc = 86, drop = 30, top = 28;
  const g0 = 14, g1 = g0 + gap;
  const terrain = [];
  const bumpers = [];
  // entry: shelf, then a kicker slab walls her onto the left wall
  terrain.push(seg([-6, 0], [10, 5]));
  terrain.push(seg([34, 16], [4, 26]));
  const start = [4, 2];
  const bY = top + N * (Hc + drop);
  terrain.push(seg([0, -8], [0, bY]));
  terrain.push(seg([W, top], [W, bY]));
  for (let k = 0; k < N; k++) {
    const ceilY = top + k * (Hc + drop);
    const floorY = ceilY + Hc;
    terrain.push(seg([8, ceilY], [W, ceilY]));
    bumpers.push({ x: 72, y: ceilY + 56 });
    if (dodge) bumpers.push({ x: 38, y: ceilY + 24 });
    if (lowCeil) terrain.push(seg([52, ceilY], [52, ceilY + 30]));
    terrain.push(seg([0, floorY], [7, floorY + 10], [g0, floorY]));  // fail pocket
    terrain.push(seg([g1, floorY], [g1, floorY - fin]));             // fin + chute wall
    terrain.push(dishFloor(g1, W, floorY, 70, 12));                  // right dish
    // slot chute + jog kicker back to the left wall
    terrain.push(seg([g0, floorY], [g0, floorY + 16]));
    terrain.push(seg([g1, floorY + 18], [4, floorY + 28]));          // kicker
  }
  terrain.push(dishFloor(0, W, bY, 51));
  return { budget: N, start, goal: [51, bY + 10], terrain, bumpers };
}

// -------------------------------------------------- POPPER · cannon relay
// A popper at each stage entry auto-fires her across the chamber; the bare
// arc dies on the saggy dead floor. One band per stage reshapes the arc into
// the far gap. tier 2 adds a fin at the gap; tier 3 hangs a ceiling fin
// mid-arc so the shot must thread a window at speed.
function cannonRelay(N, { gap = 16, fin = 0, spd = 104, thread = false } = {}) {
  const W = 130, Hc = 74, chute = 18, top = 26;
  const terrain = [];
  const pops = [];
  const start = entry(terrain, top);
  const bY = top + N * (Hc + chute) + 16;
  terrain.push(seg([0, -8], [0, bY]));
  terrain.push(seg([W, top], [W, bY]));
  let cx = 0;
  for (let k = 0; k < N; k++) {
    const ceilY = top + k * (Hc + chute);
    const floorY = ceilY + Hc;
    const rightward = k % 2 === 0;
    const px = k === 0 ? 14 : rightward ? 6 : W - 6;
    pops.push({ x: px, y: ceilY + 22, deg: rightward ? -52 : -128, spd });
    if (k === 0) terrain.push(seg([20, ceilY], [W, ceilY]));
    else terrain.push(rightward ? seg([gap, ceilY], [W, ceilY])
                                : seg([0, ceilY], [W - gap, ceilY]));
    const gx0 = rightward ? W - gap : 0, gx1 = rightward ? W : gap;
    cx = (gx0 + gx1) / 2;
    if (rightward) {
      terrain.push(dishFloor(0, gx0, floorY, 54, 12));
      terrain.push(seg([gx0, floorY + chute], [gx0, floorY - Math.max(fin, 6)]));
      if (thread) terrain.push(seg([70, ceilY], [70, ceilY + 26]));
    } else {
      terrain.push(dishFloor(gx1, W, floorY, W - 54, 12));
      terrain.push(seg([gx1, floorY + chute], [gx1, floorY - Math.max(fin, 6)]));
      if (thread) terrain.push(seg([W - 70, ceilY], [W - 70, ceilY + 26]));
    }
  }
  terrain.push(dishFloor(0, W, bY, cx));
  return { budget: N, start, goal: [cx, bY + 10], terrain, pops };
}

// -------------------------------------------------- PLANTS · pocket slalom
// One tall shaft; every snake plant hides in a wall pocket with a tilted
// floor (she rolls back out into the shaft). Each pocket visit needs its own
// deflection. tier 2 puts every pocket on the SAME wall (S-curve routing);
// tier 3 adds guard fins over the mouths and a roofed cake pocket.
function pocketSlalom(N, { pitch = 54, depth = 24, mouth = 26, sameSide = false,
                           guards = false, cakePocket = false } = {}) {
  const W = 80, top = 24;                             // narrow shaft: rails reach across
  const terrain = [];
  const plants = [];
  const start = entry(terrain, top);
  const H = top + 30 + N * pitch + (cakePocket ? 36 : 22);
  terrain.push(seg([0, -8], [0, H]));
  terrain.push(seg([W, top], [W, H]));
  terrain.push(seg([20, top], [W, top]));
  for (let k = 0; k < N; k++) {
    const y = top + 50 + k * pitch;
    const left = sameSide ? false : k % 2 === 1;
    const x0 = left ? 0 : W - depth, x1 = left ? depth : W;
    terrain.push(seg([x0, y - mouth], [x1, y - mouth]));                       // roof
    terrain.push(left ? seg([x0, y - 5], [x1, y]) : seg([x0, y], [x1, y - 5])); // tilted floor
    if (guards)                                       // fin over the mouth
      terrain.push(left ? seg([x1, y - mouth], [x1 + 10, y - mouth - 12])
                        : seg([x0, y - mouth], [x0 - 10, y - mouth - 12]));
    plants.push([left ? x0 + 7 : x1 - 7, y - 10]);
  }
  if (cakePocket) {
    const y = H - 6;
    terrain.push(seg([W - 26, y - 18], [W, y - 18]));  // roof
    terrain.push(seg([W - 26, y - 2], [W, y + 2]));    // floor tilts to the cake
    terrain.push(dishFloor(0, W, H, 30, 12));
    return { budget: N, start, goal: [W - 7, y - 4], terrain, plants };
  }
  terrain.push(dishFloor(0, W, H, W / 2 + (N % 2 ? -12 : 12), 12));
  return { budget: N, start, goal: [W / 2 + (N % 2 ? -12 : 12), H + 9], terrain, plants };
}

// ---------------------------------------------------------------- assembly
export const FAMILIES = [
  { id: 'cushion-1', mechanic: 'cushion', tier: 1, name: 'Bounce House',
    hint: 'she boings in place — tilt each bounce out through the floor gap',
    hint2: 'one slanted band per room, aimed at the gap',
    build: N => bounceChambers(N, { gap: 18 }) },
  { id: 'cushion-2', mechanic: 'cushion', tier: 2, name: 'Pillow Parkour',
    hint: 'same rooms, but now a fin guards every gap — arc over it',
    hint2: 'place the band lower and steeper: she needs height, not speed',
    build: N => bounceChambers(N, { gap: 14, fin: 14 }) },
  { id: 'cushion-3', mechanic: 'cushion', tier: 3, name: 'Needle Threader',
    hint: 'the slot is dead center, fenced, with a stalactite over it — thread it',
    hint2: 'flick from the far pillow: the arc has to peak BESIDE the stalactite',
    build: N => needleChambers(N) },

  { id: 'updraft-1', mechanic: 'updraft', tier: 1, name: 'Balloon Bellows',
    hint: 'she gets ONE ride up, then sticks to the ceiling — catch her on the way',
    hint2: 'lay a rail across her climb; she rides its underside out the window',
    build: N => liftRooms(N, { Hr: 62, winH: 14, winUp: 40 }) },
  { id: 'updraft-2', mechanic: 'updraft', tier: 2, name: 'Organ Pipes',
    hint: 'taller pipes, higher windows, and a sill in the way — aim above it',
    hint2: 'intercept her climb EARLY and send her up-and-over the sill',
    build: N => liftRooms(N, { Hr: 76, winH: 12, winUp: 30, sill: 10 }) },
  { id: 'updraft-3', mechanic: 'updraft', tier: 3, name: 'Air Pockets',
    hint: 'the lift has a hole in the middle — throw her across the dead air',
    hint2: 'the far lift finishes the job; your rail just has to bridge the gap',
    build: N => liftRooms(N, { Hr: 66, winH: 14, winUp: 28, split: true }) },

  { id: 'bumper-1', mechanic: 'bumper', tier: 1, name: 'Piñata Practice',
    hint: 'piñatas hit BACK — ramp her in hard and ride the counterpunch home',
    hint2: 'the kick mirrors the hit: fast and low in means high and far back',
    build: N => pinataChambers(N, { gap: 16, fin: 34 }) },
  { id: 'bumper-2', mechanic: 'bumper', tier: 2, name: 'Low Blow',
    hint: 'a curtain hangs mid-room: the kick has to come back UNDER it',
    hint2: 'clip the piñata near its equator — glancing hits fly flatter',
    build: N => pinataChambers(N, { gap: 14, fin: 30, lowCeil: true }) },
  { id: 'bumper-3', mechanic: 'bumper', tier: 3, name: 'Party Foul',
    hint: 'a second piñata squats in the flight path home — thread around it',
    hint2: 'clip it and it counter-kicks: sometimes a foul is a shortcut…',
    build: N => pinataChambers(N, { gap: 13, fin: 38, dodge: true }) },

  { id: 'popper-1', mechanic: 'popper', tier: 1, name: 'Confetti Relay',
    hint: 'the cannons do the flying — your band reshapes each arc into the gap',
    hint2: 'a shallow ramp late in the arc stretches it; a wall drops it short',
    build: N => cannonRelay(N, { gap: 16, spd: 104 }) },
  { id: 'popper-2', mechanic: 'popper', tier: 2, name: 'Return to Sender',
    hint: 'hotter cannons, finned gaps — the arc has to come down STEEP',
    hint2: 'bounce her off the far wall: walls eat sideways speed, then she drops in',
    build: N => cannonRelay(N, { gap: 13, fin: 12, spd: 118 }) },
  { id: 'popper-3', mechanic: 'popper', tier: 3, name: 'Grand Salute',
    hint: 'a fin hangs mid-arc: thread the window, then still hit the gap',
    hint2: 'lift the arc early so she clears the fin, then kill it at the wall',
    build: N => cannonRelay(N, { gap: 12, fin: 12, spd: 118, thread: true }) },

  { id: 'plants-1', mechanic: 'plants', tier: 1, name: 'Window Boxes',
    hint: 'every snake plant hides in a wall pocket — dip into each on the way down',
    hint2: 'she rolls back out of pockets; catch her fall and tilt it into the mouth',
    build: N => pocketSlalom(N, { pitch: 54, depth: 24, mouth: 26 }) },
  { id: 'plants-2', mechanic: 'plants', tier: 2, name: 'Ivy Wall',
    hint: 'all the pockets are on ONE wall — swing her out and back, out and back',
    hint2: 'after each pocket she falls away from the wall; curl her back with the next band',
    build: N => pocketSlalom(N, { pitch: 58, depth: 24, mouth: 22, sameSide: true }) },
  { id: 'plants-3', mechanic: 'plants', tier: 3, name: 'Jungle Gym',
    hint: 'guard fins over every mouth, and the cake wants a flat approach',
    hint2: 'enter pockets from below the fin; save some fall for the cake pocket',
    build: N => pocketSlalom(N, { pitch: 60, depth: 24, mouth: 20, guards: true, cakePocket: true }) },
];

export function generateSuite(only) {
  const suite = [];
  for (const fam of FAMILIES) {
    if (only && !fam.id.startsWith(only)) continue;
    for (const N of [2, 3, 4]) {
      const L = fam.build(N);
      L.name = `${fam.name} · ${N}P`;
      L.hint = fam.hint; L.hint2 = fam.hint2;
      L.meta = { id: `${fam.id}-${N}p`, mechanic: fam.mechanic, tier: fam.tier, players: N };
      suite.push(L);
    }
  }
  return suite;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()))
  console.log(JSON.stringify(generateSuite(process.argv[2]), null, 1));
