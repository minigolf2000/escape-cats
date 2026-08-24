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

import { R, bandPoints } from "@escape-cats/shared";
import { S, REDUCED } from "./state";
import {
  gateEl, gateCloseEl, helpEl, hudEl, scGoalEl, scBandsEl, scTitleEl, titleH1El,
} from "./dom";
import {
  ctx, cam, tGlobal, sxp, syp, drawScene,
  drawTerrain, drawCan, drawGoalPlant, drawBand, drawTeammatePreview, drawGoomba,
  advanceClock,
} from "./render";

/** A scene: only the fields the draw functions actually read. Nothing here is
 * simulated, verified or playable — `bounds` is just the box to frame. */
const GOAL_SCENE = {
  // The floor RUNS DOWNHILL, and steepens before it flattens out under the
  // plant. It used to be a flat shelf, which left the picture with no engine in
  // it: a cat at rest on a level floor with three cans strung above her says
  // nothing about why she would ever move. Gravity is the only motor in this
  // game — the players never push her, they only put things in her way — so the
  // hill is the sentence, and every other mark here descends with it: the cans
  // are strung 2.7-2.9 clear of the surface as it drops away from under her
  // (she leaves the ground where it steepens and flies the rest), and each one
  // sits LOWER than the last so the whole ride reads as one fall.
  terrain: [[[0, 10.2], [24, 12.7], [48, 16.3], [72, 20.3]]],
  cans: [[19, 7], [37, 9.4], [55, 12.4]],
  goal: [65, 18.7],
  startX: 7,   // ...her seat on the slope is derived from it, see seatOn
  // Framed off what the DRAW functions reach, not off the coordinates above:
  // the plant's glow is 8.8 wide of its goal and a can's is 4.6 of its middle,
  // so a box drawn to the objects' own points clips both. The canvas is far
  // wider than it is tall, so the WIDTH is what sets the scale here and these
  // two y's do nothing but centre the picture: their midpoint is the middle of
  // everything drawn, from the top of the first can's glow (3.4) to the bottom
  // of the plant's (23.6).
  bounds: { x0: -3, x1: 77, y0: 4.0, y1: 23.1 },
};

/** Her seat on a scene's terrain at `x`: the surface angle there, and her
 * centre R clear of it along the surface NORMAL — the same two numbers the sim
 * keeps for a body resting on the ground, and the same trick the band picture
 * plays off the band. Derived rather than written down, because a hand-typed
 * start next to a slope is one edit away from leaving her hanging in the air. */
function seatOn(poly, x) {
  let i = 0;
  while (i < poly.length - 2 && poly[i + 1][0] < x) i++;
  const [ax, ay] = poly[i], [bx, by] = poly[i + 1];
  const a = Math.atan2(by - ay, bx - ax);
  const y = ay + (by - ay) * ((x - ax) / (bx - ax));
  return { x: x + Math.sin(a) * R, y: y - Math.cos(a) * R, a };
}
const GOAL_SEAT = seatOn(GOAL_SCENE.terrain[0], GOAL_SCENE.startX);

// Her ride, through the cans and into the plant. The one mark in either
// picture that is not a game object, because "she goes THIS way, through those"
// is the sentence the picture is replacing, and no arrangement of the objects
// themselves says it. It only ever goes DOWN now — a dashed line that climbs
// over the cans and drops onto the plant is a picture of a throw, and nothing
// here throws her.
const RIDE_PATH = [[11.5, 8.6], ...GOAL_SCENE.cans, [60, 14.6]];

const BAND_SCENE = {
  terrain: [[[0, 9], [18, 9.6]], [[48, 17], [72, 16.4]]],
  cans: [[68, 7.5]],
  band: { ax: 18, ay: 9.6, bx: 48, by: 17 },      // laid across the gap, ridden
  ghost: { ax: 53, ay: 16.8, bx: 68, by: 11.5 },  // ...and one going down now
  bounds: { x0: -3, x1: 76, y0: 2.5, y1: 19.5 },
};


/** The dashed ride-line, with an arrow on its nose. Marching dashes, so it
 * reads as travel rather than as a rope she is hanging from. */
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
  const end = path[path.length - 1], prev = path[path.length - 2];
  ctx.lineTo(sxp(end[0]), syp(end[1]));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.translate(sxp(end[0]), syp(end[1]));
  ctx.rotate(Math.atan2(end[1] - prev[1], end[0] - prev[0]));
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
  drawGoomba(GOAL_SEAT.x, GOAL_SEAT.y, GOAL_SEAT.a, 1, true, false, true);
}

/** Picture two — the bands. A gap she cannot cross, one band laid across it
 * with her riding it, and a second going down ahead of her (drawTeammatePreview's
 * marching dashes are the game's own "someone is placing this"), pointed at the
 * can that is the reason for any of it. Both in the team's ink, which with no
 * team yet is the unsorted colour a waiting phone is already wearing. */
function drawBandScene() {
  drawTerrain(BAND_SCENE);
  BAND_SCENE.cans.forEach((c, i) => drawCan(c[0], c[1], false, i));
  drawBand(BAND_SCENE.band, 0.12, false);
  drawTeammatePreview(BAND_SCENE.ghost);
  const pts = bandPoints(BAND_SCENE.band);
  const [mx, my] = pts[4];
  const a = Math.atan2(pts[5][1] - pts[3][1], pts[5][0] - pts[3][0]);
  // her riding height, off the band's own normal — the same R the sim keeps
  // between her centre and whatever she is standing on
  drawGoomba(mx + Math.sin(a) * R, my - Math.cos(a) * R, a, 1, true, false, false);
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

export function drawSheet() {
  const tb = titleFrame(scTitleEl, titleH1El);
  drawScene(scTitleEl, tb, () => drawTitleScene(tb));
  drawScene(scGoalEl, GOAL_SCENE.bounds, drawGoalScene);
  drawScene(scBandsEl, BAND_SCENE.bounds, drawBandScene);
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

/** Make the sheet dismissible, with `label` as the line saying so. */
export function armSheet(label) {
  sheetOpen = true; sheetTap = true;
  gateEl.classList.add("ready"); gateEl.classList.remove("hidden");
  hudEl.classList.add("sheet");
  gateCloseEl.textContent = label;
  drawSheet();   // the frame it appears on is already the picture, never a blank box
}
function openHelp() { armSheet("tap anywhere to close"); }
export function closeSheet() {
  sheetOpen = false; sheetTap = false;
  gateEl.classList.add("hidden"); gateEl.classList.remove("ready");
  hudEl.classList.remove("sheet");
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
