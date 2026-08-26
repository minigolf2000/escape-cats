// How to play: two pictures, drawn by the game.
//
// The waiting room used to explain this in four sentences. Nobody reads four
// sentences at a party, and nothing ever showed them again: the gate is the one
// screen a player passes through exactly once. It says the same two things in
// pictures now — WHERE she is going (past every can, home to the plant) and WHAT
// the players do about it (lay bands in her way) — and `?` brings them back
// mid-party, which is the half that was actually missing.
//
// They are drawn by the RENDERER, not by hand: a scene is a level-shaped literal
// and `drawScene` points ctx/W/H/cam at the sheet's little canvases and back. A
// picture of a watering can that is not THE watering can drifts the first time
// either is touched.

import { R } from "@escape-cats/shared";
import { S, REDUCED } from "./state";
import {
  gateEl, gateCloseEl, helpEl, hudEl, scGoalEl, scTitleEl, titleH1El,
  scDragEl, scLiftEl,
} from "./dom";
import {
  ctx, cam, tGlobal, sxp, syp, drawScene,
  drawTerrain, drawCan, drawGoalPlant, goalMid, drawBand, drawGoomba,
  advanceClock,
} from "./render";

/** A scene: only the fields the draw functions actually read. Nothing here is
 * simulated, verified or playable — `bounds` is just the box to frame. */
const GOAL_SCENE = {
  // The floor RUNS DOWNHILL and then STOPS, one gap short of the plant. The
  // hill is the motor — gravity is the only one this game has, since the
  // players never push her, they only put things in her way — and the gap is
  // what the band is FOR: a band drawn over solid ground is decoration, and
  // this one is the last thing between her fall and the pot.
  //
  // The gap is at the END rather than in the middle because that is what lets
  // the cans stay UP. She leaves the ground where the hill steepens and flies
  // the rest, so her line runs high and clear across the picture; a gap in the
  // middle has to be crossed ON the band, which drags that line — and every can
  // strung along it — down onto the floor.
  //
  // The band's ends ARE the two platform ends, which is where a real band snaps
  // (a terrain vertex), so nothing here is a shape the game could not make. The
  // far side sits LOWER than the near side's line would reach, so the band
  // slants at twice the floor's grade: drawn level with it, it read as a pink
  // section OF the floor rather than as a break.
  terrain: [[[0, 10.2], [24, 12.7], [48, 16.3]], [[60, 20], [74, 22.4]]],
  band: { ax: 48, ay: 16.3, bx: 60, by: 20 },
  // ONE can, where the middle of three used to be. Three of them said "and
  // another, and another" about a number that is not the point — a level's cans
  // are however many its designer drew — while one reads as "collect this on
  // the way", which is the whole sentence. Up in the air where the three were:
  // 4.5 clear of a floor that is falling away faster than she is, so no part of
  // it sits on the floor.
  cans: [[33, 9.2]],
  startX: 7,   // ...her seat on the slope is derived from it, see seatOn
  // The plant SITS ON the far platform rather than standing in it.
  // drawGoalPlant anchors on the CROWN, not the base — its saucer lands 3.6
  // below `goal` — so a goal placed a few tenths above the surface, which is
  // where a level's own `goal` layer sits and where this one used to, buries
  // the pot in the terrain's 4.4-wide stroke. This one is that 3.6 measured off
  // the floor under it (21.2 at x=68), so the pot rests on the line.
  goal: [67, 21.2 - 3.6],
  // Framed off what the DRAW functions reach, not off the coordinates above:
  // the plant's glow is 8.8 wide of its goal and a can's is 4.6 of its middle,
  // so a box drawn to the objects' own points clips both. The canvas is far
  // wider than it is tall, so the WIDTH is what sets the scale here and these
  // two y's do nothing but centre the picture: their midpoint is the middle of
  // everything drawn, from the top of the first can's glow (2.4) to the bottom
  // of the far platform's stroke (24.3).
  bounds: { x0: -3, x1: 77, y0: 4.2, y1: 23 },
};


/** Her seat on a scene's terrain at `x`: the surface angle there, and her
 * centre R clear of it along the surface NORMAL — the same two numbers the sim
 * keeps for a body resting on the ground, and the same trick the gesture
 * pictures play off a band. Derived rather than written down, because a
 * hand-typed start next to a slope is one edit away from leaving her hanging in
 * the air. */
function seatOn(poly, x) {
  let i = 0;
  while (i < poly.length - 2 && poly[i + 1][0] < x) i++;
  const [ax, ay] = poly[i], [bx, by] = poly[i + 1];
  const a = Math.atan2(by - ay, bx - ax);
  const y = ay + (by - ay) * ((x - ax) / (bx - ax));
  return { x: x + Math.sin(a) * R, y: y - Math.cos(a) * R, a };
}
const GOAL_SEAT = seatOn(GOAL_SCENE.terrain[0], GOAL_SCENE.startX);

// ...and the trailing points are not cans, they are the SHAPE: one arc, from
// her pad to the pot, steepening the way a fall does. It is drawn as though the
// band were not there, and that is deliberate — bent down onto the band and
// back up it stopped being an arc and became a route, with a kink at every
// place the geometry underneath happened to be interesting. The band is what
// the floor needs, not what her line needs; the arc passes over the gap without
// ever asking what is under it.
//
// It ends at the PLANT'S MIDDLE — `goalMid`, derived rather than typed. An
// arrow is a sentence with a subject, and this one used to stop over the far
// ledge with its nose still on the fall's slope, which put its point on the
// floor a little short of the pot: it read as "down there somewhere" next to a
// plant it never named. `TIP_CLEAR` is what lets it aim AT the plant without
// landing on it — the tip stops that far short, outside the blades, and the aim
// carries the rest.
//
// The plant's middle sits 3.6 over the ledge (drawGoalPlant hangs the pot off
// `goal`, so the ink centres up by the crown), so a line that keeps falling
// cannot arrive at it: the tail is a shallower descent than it was, and the
// shaping point comes UP with it to keep the arc steepening the whole way. The
// alternative — dive to the ledge and lift into the pot — is the route with a
// kink in it that this arc already replaced once.
const RIDE_PATH = [[11, 8.8], ...GOAL_SCENE.cans, [53, 12.6], goalMid(GOAL_SCENE)];
// World units from the plant's middle to the arrow's nose. The blades fan ~5.4
// out of the crown, so anything under about 5 buries the nose in leaves; much
// over 6 and the nose backs out of the glow and stops looking aimed at all.
const TIP_CLEAR = 5.6;

/** The dashed ride-line, with an arrow on its nose. Marching dashes, so it
 * reads as travel rather than as a rope she is hanging from.
 *
 * The path's last point is what the arrow AIMS at, not where it is drawn: the
 * nose stops TIP_CLEAR short of it, along the same line, so the arrowhead's
 * rotation is the true bearing to that point rather than something eyeballed
 * against it. Move the plant and the arrow follows. */
function drawRide(path) {
  ctx.save();
  ctx.strokeStyle = "rgba(87,230,201,0.6)";
  ctx.lineWidth = 0.42 * cam.s; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.setLineDash([1.5 * cam.s, 1.9 * cam.s]);
  ctx.lineDashOffset = -tGlobal * 7 * cam.s;
  ctx.beginPath();
  ctx.moveTo(sxp(path[0][0]), syp(path[0][1]));
  for (let i = 1; i < path.length - 1; i++) {
    const [x, y] = path[i], [nx, ny] = path[i + 1];
    ctx.quadraticCurveTo(sxp(x), syp(y), sxp((x + nx) / 2), syp((y + ny) / 2));
  }
  const aim = path[path.length - 1], prev = path[path.length - 2];
  const dx = aim[0] - prev[0], dy = aim[1] - prev[1];
  const k = Math.max(0, 1 - TIP_CLEAR / (Math.hypot(dx, dy) || 1));
  const end = [prev[0] + dx * k, prev[1] + dy * k];
  ctx.lineTo(sxp(end[0]), syp(end[1]));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.translate(sxp(end[0]), syp(end[1]));
  ctx.rotate(Math.atan2(dy, dx));
  ctx.beginPath();
  ctx.moveTo(-1.7 * cam.s, -1.3 * cam.s); ctx.lineTo(0, 0); ctx.lineTo(-1.7 * cam.s, 1.3 * cam.s);
  ctx.stroke();
  ctx.restore();
}

/** Picture one — the goal. She is idle at the TOP of the slope, the cans are
 * strung down it, and the plant is drawn READY (st.gotN = every can):
 * this is the ending, not a snapshot mid-level, so it wears the face the
 * ending has. */
function drawGoalScene() {
  drawTerrain(GOAL_SCENE);
  drawRide(RIDE_PATH);
  GOAL_SCENE.cans.forEach((c, i) => drawCan(c[0], c[1], false, i));
  drawGoalPlant(GOAL_SCENE, { gotN: GOAL_SCENE.cans.length });
  // After the cans and the plant, exactly as the game draws them: a band is in
  // front of everything it is laid across, and a can's glow is 4.6 wide enough
  // to swallow one drawn underneath it.
  drawBand(GOAL_SCENE.band, 0, false);
  drawGoomba(GOAL_SEAT.x, GOAL_SEAT.y, GOAL_SEAT.a, 1, true, false, true);
}

/** Picture zero — her, gliding along the top of the words.
 *
 * The one scene with no level in it: the "terrain" she rides IS the title, and
 * that is DOM text. Her canvas covers the words as well as the air over them
 * (#title #scTitle), so she is never sliced off at the line she is riding, and
 * she is drawn OVER the letters wherever the two meet. Nothing else is drawn
 * into it — the title is already three colours and a dashed ride-line across it
 * would be noise — so the strip is sized off HER: TITLE_AIR world units of air
 * above the cap line against a sprite ~6.4 units tall from her board up, which
 * lands her at about the cap height of the words beside her.
 *
 * She crosses and comes round again rather than parking mid-word, because a cat
 * sitting on the O is a decal and a cat travelling is the game's verb; the wrap
 * happens with her clear of both ends (TITLE_RUNWAY ≥ her half-width), so the
 * jump is never on screen and the bob's phase at the seam does not matter. */
const TITLE_AIR = 8;       // world units of air over the cap line — her size
const TITLE_CROSS = 9;     // seconds, one end of the words to the other
const TITLE_RUNWAY = 6;    // ...starting and ending this far outside the canvas

/** The title's CAP LINE, in css px below the top of the h1's own box: the line
 * she rides, and the one number the stylesheet deliberately does not hold.
 *
 * MEASURED off the h1's computed font, because this sheet's font stack resolves
 * to a different face on every platform — SF Pro Rounded on a phone, Roboto,
 * whatever a laptop has — and each one seats its capitals somewhere else inside
 * the line box. An em that is right on the machine it was measured on is a cat
 * sunk into the letters on the next one. Memoised on the font and the line
 * height, which is all it depends on: this is read every frame the sheet is
 * up, and the answer only moves when one of those two does. */
let capMemo = { key: "", px: 0 };
function capLine(h1) {
  const cs = getComputedStyle(h1);
  const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const key = font + "|" + cs.lineHeight;
  if (key === capMemo.key) return capMemo.px;
  const g = capLine.g || (capLine.g = document.createElement("canvas").getContext("2d"));
  g.font = font;
  const m = g.measureText("H");
  // The LINE box, never the element's height: this title wraps to two lines on
  // a 320px phone, and an element measured there is two line boxes tall, which
  // buries her half a line into the letters. `normal` resolves to the font's
  // own ascent + descent with no leading either side of it.
  const line = parseFloat(cs.lineHeight)
    || m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
  // half-leading + the font's own ascent = the baseline; back off the height of
  // an actual capital to reach its top. Fall back to the .19em this measured on
  // a laptop if the metrics are missing rather than drawing her at the baseline.
  const px = m.fontBoundingBoxAscent
    ? (line - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2
      + m.fontBoundingBoxAscent - m.actualBoundingBoxAscent
    : parseFloat(cs.fontSize) * 0.19;
  capMemo = { key, px };
  return px;
}

/** The world the title canvas frames: exactly the canvas, at the scale that
 * makes the air above the cap line TITLE_AIR units. Both axes are handed the
 * same scale, so drawScene's min() cannot letterbox it and `ground` is the one
 * line in world coordinates she has to sit on. */
function titleFrame(el, h1) {
  const w = el.clientWidth, h = el.clientHeight;
  const air = h1.getBoundingClientRect().top - el.getBoundingClientRect().top
    + capLine(h1);
  const s = Math.max(air, 1) / TITLE_AIR;      // css px per world unit
  return { x0: 0, x1: w / s, y0: 0, y1: h / s, ground: TITLE_AIR };
}

function drawTitleScene(b) {
  const t = REDUCED() ? 0.5 : (tGlobal % TITLE_CROSS) / TITLE_CROSS;
  const x = b.x0 - TITLE_RUNWAY + (b.x1 - b.x0 + TITLE_RUNWAY * 2) * t;
  // A shallow glide path, and her nose on its slope. World y is down, so a
  // positive slope is a positive (clockwise) rotation — the same sign the sim
  // hands drawGoomba off a band's normal.
  const k = 0.26, amp = 0.4;
  const y = b.ground - R + Math.sin(x * k) * amp;
  // GROUNDED, not airborne: she is riding the words, the way she rides a band
  // in the picture below. `airborne` is not a pose here, it is a FACE — it
  // blows her pupils up 1.5x, which is the game's tell for being off the
  // ground with nothing under her, and a title is no place to wear it.
  drawGoomba(x, y, Math.atan(amp * k * Math.cos(x * k)), 1, true, false, false);
}

/** Pictures three and four — the two gestures, side by side on one stage.
 *
 * The two pictures above say what a band DOES and nothing said how one gets
 * there. These are a PAIR: the same two ledges and the same band in both, so
 * the only difference between the panels is what the hand does — laying it on
 * the left, taking it back on the right. One stage twice is why they can be
 * read together at a glance; two different stages would be two puzzles.
 *
 * Only these two gestures are here. A band can also be laid tap-then-tap or
 * stretched between two fingers (see "three ways to lay a band"), and a picture
 * showing all three would be a manual — the drag is the one a thumb finds by
 * itself, and the other two are found by anyone who tries them.
 *
 * There is no X over the band on the right, and there must not be: a mark
 * across a band already means something in this game — drawBand paints an
 * illegal placement RED and dashed — so an X here would teach "you cannot put
 * one there" in the one place that is teaching how to take one away. The hand
 * and the ring it leaves say it without borrowing that word.
 *
 * The FINGERTIP is the one mark in this sheet with no counterpart in the game,
 * the same licence the ride-line takes in picture one: a gesture cannot be
 * drawn out of the things it acts on. Everything under it is the game's own —
 * drawTerrain, and drawBand as a ghost and then solid, exactly as a live drag
 * and a placed band are drawn. */
const GESTURE_SCENE = {
  terrain: [[[0, 8], [11, 8]], [[26, 15], [37, 15]]],
  band: { ax: 11, ay: 8, bx: 26, by: 15 },    // what the drag lays, end to end
  // A ledge down onto a lower one, so the band goes in on the SLANT every band
  // in this game goes in on — and so a half-width panel still uses its height.
  // Drawn flat and level first, it was a rule across the middle of an empty
  // box: 35% ink against the ~70% the two pictures above it carry.
  // Half the width of those two, at the same SCALE as them (~4 px per world
  // unit at 340px), because four pictures at two scales look like two games.
  // Wide enough for the terrain's HALO, not just its line: the stroke runs 2.2
  // either side of a polyline, so ledges drawn to 0 and 37 need the frame out
  // at -3 and 40 or they are shaved off against the panel's edges.
  bounds: { x0: -3, x1: 40, y0: 5, y1: 18 },
};
// The beats of each loop, in seconds. Both run 3s, held long enough to read at
// a glance and short enough that a player looking up mid-caption sees it again.
const LAY_PRESS = 0.25, LAY_PULL = 1.55, LAY_LET = 1.75, LAY_HOLD = 2.75,
  LIFT_TAP = 0.75, LIFT_GONE = 1.35, LIFT_BACK = 2.05, LIFT_SOLID = 2.25,
  GESTURE_LOOP = 3;

/** A fingertip: a soft disc under a ring, `press` scaling both (1 = down on the
 * glass) and `a` fading them. White, because it is a hand rather than anything
 * in the world, and the only white thing on these two canvases. */
function drawTouch(x, y, press, a) {
  const r = 2.0 * cam.s * press;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath(); ctx.arc(sxp(x), syp(y), r, 0, 6.28); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 0.3 * cam.s;
  ctx.beginPath(); ctx.arc(sxp(x), syp(y), r, 0, 6.28); ctx.stroke();
  ctx.restore();
}

/** The ring a tap leaves behind, `u` running 0→1 as it goes out. */
function drawTapRing(x, y, u) {
  ctx.save();
  ctx.globalAlpha = 1 - u;
  ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 0.3 * cam.s;
  ctx.beginPath(); ctx.arc(sxp(x), syp(y), (2 + 4 * u) * cam.s, 0, 6.28); ctx.stroke();
  ctx.restore();
}

/** Where a tap lands on the band: its middle, plus the sag it hangs with. */
const bandMid = (bd) => [(bd.ax + bd.bx) / 2, (bd.ay + bd.by) / 2 + 0.85];

/** LEFT — laying one. Press, pull the band out under the finger (drawn as the
 * ghost the game puts under a live drag), let go, hold it there. The loop's
 * last beat drops the band back to a ghost and then to nothing: a rewind, and
 * one deliberately done with no finger anywhere near it, so that the panel
 * whose whole subject is placing never appears to remove. */
function drawLayScene() {
  const bd = GESTURE_SCENE.band;
  // Parked mid-pull when the phone asks for less motion: one frame has to carry
  // this, and the one that does is a band half-drawn under a finger.
  const t = REDUCED() ? 0.9 : tGlobal % GESTURE_LOOP;
  const smooth = (u) => u * u * (3 - 2 * u);
  drawTerrain(GESTURE_SCENE);
  if (t < LAY_LET) {
    const u = smooth(Math.max(0, Math.min(1, (t - LAY_PRESS) / (LAY_PULL - LAY_PRESS))));
    const bx = bd.ax + (bd.bx - bd.ax) * u, by = bd.ay + (bd.by - bd.ay) * u;
    if (u > 0) drawBand({ ax: bd.ax, ay: bd.ay, bx, by }, 0, true);
    drawTouch(bx, by, Math.min(1, t / LAY_PRESS), Math.min(1, (LAY_LET - t) / 0.2));
  } else if (t < LAY_HOLD) {
    drawBand(bd, 0, false);
  } else if (t < LAY_HOLD + 0.15) {
    drawBand(bd, 0, true);   // ...and out through the ghost it came in as
  }
}

/** RIGHT — taking it back. The band is already there; the finger comes down on
 * it, it goes, and the ring goes out after it. Then it steps back in through
 * the same ghost, which is the loop resetting rather than anything the hand
 * did — the finger is long gone by then. */
function drawLiftScene() {
  const bd = GESTURE_SCENE.band, [mx, my] = bandMid(bd);
  drawTerrain(GESTURE_SCENE);
  if (REDUCED()) {
    // No loop to watch, so one frame has to say "tapped, and going": the band
    // still there under the finger, with the ring already leaving.
    drawBand(bd, 0, true);
    drawTapRing(mx, my, 0.35);
    drawTouch(mx, my, 1, 1);
    return;
  }
  const t = tGlobal % GESTURE_LOOP;
  if (t < LIFT_GONE) {
    drawBand(bd, 0, false);
    if (t > LIFT_TAP) {
      const u = (t - LIFT_TAP) / (LIFT_GONE - LIFT_TAP);
      drawTouch(mx, my, 1.35 - 0.35 * u, u);
    }
  } else if (t < LIFT_BACK) {
    // It comes OFF: both ends pulled into the tap over a beat and a half, then
    // the ring out after it. A band that simply stopped being drawn read as a
    // cut in the film — and this way the panel's motion is the opposite of the
    // one beside it, where a band grows OUT of an anchor, instead of a second
    // picture of the same slanted line.
    const c = (t - LIFT_GONE) / 0.14;
    if (c < 1) drawBand({ ax: bd.ax + (mx - bd.ax) * c, ay: bd.ay + (my - bd.ay) * c,
      bx: bd.bx + (mx - bd.bx) * c, by: bd.by + (my - bd.by) * c }, 0, true);
    const u = (t - LIFT_GONE) / 0.4;
    if (u < 1) drawTapRing(mx, my, u);
  } else if (t < LIFT_SOLID) {
    drawBand(bd, 0, true);
  } else {
    drawBand(bd, 0, false);
  }
}

export function drawSheet() {
  const tb = titleFrame(scTitleEl, titleH1El);
  drawScene(scTitleEl, tb, () => drawTitleScene(tb));
  drawScene(scGoalEl, GOAL_SCENE.bounds, drawGoalScene);
  drawScene(scDragEl, GESTURE_SCENE.bounds, drawLayScene);
  drawScene(scLiftEl, GESTURE_SCENE.bounds, drawLiftScene);
}

// The sheet's two wearings. It opens as the GATE, carrying the connection
// status, and is the same element every time after, opened by `?`. `sheetOpen`
// is what the loops render off; `sheetTap` is only "may this be dismissed",
// which is the entire difference — and the sheet is NEVER dismissed by anything
// but a tap or a key. The room going live only ARMS it (`armSheet` below): a
// how-to-play sheet that vanishes by itself the moment the proctor sorts a
// phone in is a sheet nobody read, which is the whole failure the pictures
// replaced.
let sheetOpen = true, sheetTap = false;
/** Is the sheet on screen (so the loop must keep drawing it)? */
export const sheetIsOpen = () => sheetOpen;
/** May a key or a tap dismiss it? Armed by the first snapshot, never by it. */
export const sheetIsArmed = () => sheetTap;

/** Make the sheet dismissible. `label` is the line saying so, and the first
 * arm passes none: a player who has never dismissed this sheet is not waiting
 * to be told how to, they are reading the pictures, and the one line of chrome
 * under them was the only thing on the screen that was not the game. What is
 * left is what a phone answers to anyway — a tap — and `?` says where the
 * sheet went on the way out. */
export function armSheet(label = "") {
  sheetOpen = true; sheetTap = true;
  cancelZoop();   // re-opened mid-flight: the sheet is back, not still leaving
  gateEl.classList.add("ready"); gateEl.classList.remove("hidden");
  hudEl.classList.add("sheet");
  gateCloseEl.textContent = label;
  drawSheet();   // the frame it appears on is already the picture, never a blank box
}
function openHelp() { armSheet("tap anywhere to close"); }

// The dismissal is the one moment a player is looking straight at the sheet,
// and it is the only moment `#help` and the thing `#help` reopens are ever on
// screen together — so that is where the sheet is told to say where it went.
// It ZOOPS: the whole screen shrinks into the button's corner while the button
// pops up to catch it (the keyframes are in index.html, under "THE ZOOP").
//
// Both boxes are MEASURED here rather than written into the CSS, because
// `#help` sits on a safe-area inset and a rotation moves it — an animation
// aimed at a hardcoded corner would fly at yesterday's one. Everything else
// about the close is unchanged: `hidden` still lands, just a beat later.
let zoopTimers = [];
/** Put the sheet away. `.ready` comes off HERE rather than at the top of the
 * close: it is one of the two things keeping the connection lines invisible, so
 * dropping it early would raise "Joining your team…" on a sheet that is already
 * flying into the corner — its last visible word, and a lie. Nothing needs it
 * gone sooner; `sheetTap` is what says the sheet can no longer be dismissed. */
function hideGate() {
  gateEl.classList.add("hidden"); gateEl.classList.remove("ready");
}
function cancelZoop() {
  zoopTimers.forEach(clearTimeout); zoopTimers = [];
  gateEl.classList.remove("zoop"); helpEl.classList.remove("pop");
}
/** The clock, read off the CSS so the flight and the landing cannot drift.
 *
 * UNIT-AWARE, and it has to be: a CSS time is `460ms` or `0.46s` and both are
 * the same duration, but the value that comes back here is whichever one the
 * BUILD chose. Vite's CSS minifier rewrites `460ms` to `.46s` — so a bare
 * parseFloat reads 0.46, calls it milliseconds, and retires the sheet half a
 * millisecond in. Dev looked right and the deployed build skipped the whole
 * animation. */
function zoopMs() {
  const raw = getComputedStyle(hudEl).getPropertyValue("--zoop-ms").trim();
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v <= 0) return 460;
  return /ms\s*$/.test(raw) ? v : v * 1000;   // bare `s`, or a unitless fallback
}
/**
 * @param animate false where there is nothing to watch — the grid is already
 *   up over the sheet (`?solo`, a pasted level), so `#help` is hidden with the
 *   rest of the HUD and the sheet would be flying at a button nobody can see.
 */
export function closeSheet(animate = true) {
  sheetOpen = false; sheetTap = false;
  hudEl.classList.remove("sheet");   // before measuring: it is what unhides `#help`
  cancelZoop();
  const hidden = hudEl.classList.contains("lab") || hudEl.classList.contains("splash");
  if (!animate || hidden || REDUCED()) { hideGate(); return; }
  const g = gateEl.getBoundingClientRect(), h = helpEl.getBoundingClientRect();
  if (!g.width || !g.height || !h.width) { hideGate(); return; }
  gateEl.style.setProperty("--zoop-ox", `${h.left + h.width / 2 - g.left}px`);
  gateEl.style.setProperty("--zoop-oy", `${h.top + h.height / 2 - g.top}px`);
  gateEl.style.setProperty("--zoop-sx", `${h.width / g.width}`);
  gateEl.style.setProperty("--zoop-sy", `${h.height / g.height}`);
  gateEl.classList.add("zoop");
  helpEl.classList.add("pop");       // its own delay lands it as the sheet arrives
  const ms = zoopMs();
  // `hidden` the moment the flight ends — the pop and its ring run on past
  // that, over a game that is already playable, and are cleared after.
  zoopTimers.push(setTimeout(hideGate, ms));
  zoopTimers.push(setTimeout(cancelZoop, ms * 2));
}
helpEl.onclick = openHelp;
// POINTERDOWN, not click: the kiosk lockdown at the top of this file
// preventDefault()s touchstart on anything that is not a button or a link, and
// that is exactly what cancels the synthesised `click` a finger would otherwise
// produce — so an `onclick` here is a desktop-only dismiss. pointerdown is the
// one press both a finger and a mouse deliver. Nothing beneath can catch the
// rest of the gesture: the canvas draws bands off touchstart/mousedown, and
// those went to the gate.
gateEl.addEventListener("pointerdown", (e) => {
  if (!sheetTap) return;
  e.preventDefault();
  closeSheet();
});

/** Before the first snapshot there is no game loop — `frame` starts on it —
 * so the sheet drives its own clock until then, and stands down the moment
 * frame() takes over (which draws it too, for the `?` case mid-party). */
export function sheetFrame(nowMs) {
  if (S.inited) return;
  requestAnimationFrame(sheetFrame);
  const dt = Math.min(0.05, (nowMs - (sheetFrame.last || nowMs)) / 1000);
  sheetFrame.last = nowMs;
  advanceClock(dt);
  drawSheet();
}
