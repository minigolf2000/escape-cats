// How to play: pictures, drawn by the RENDERER — a scene is a level-shaped
// literal and `drawScene` points ctx/W/H/cam at the sheet's canvases and back,
// so a can in the picture cannot drift from a can in the game. The gate is the
// one screen a player passes through exactly once; `?` brings it back.

import { R } from "@escape-cats/shared";
import { S, REDUCED } from "./state";
import {
  gateEl, helpEl, hudEl, scGoalEl, scTitleEl, titleH1El,
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
  // The floor runs downhill and STOPS one gap short of the plant. The gap is
  // what a band is FOR (a band over solid ground is decoration), and it is at
  // the END so the cans stay up: a gap in the middle is crossed ON the band,
  // dragging her line and every can along it onto the floor. The band's ends
  // are the platform ends (where a real band snaps); the far side sits lower
  // so the band reads as a break, not a pink section of floor.
  terrain: [[[0, 10.2], [24, 12.7], [48, 16.3]], [[60, 20], [74, 22.4]]],
  band: { ax: 48, ay: 16.3, bx: 60, by: 20 },
  // ONE can, in the air: 4.5 clear of a floor falling away faster than she is.
  cans: [[33, 9.2]],
  startX: 7,   // ...her seat on the slope is derived from it, see seatOn
  // The plant's goal sits 3.6 ABOVE the floor, unlike a real level's:
  // drawGoalPlant anchors on the CROWN (saucer bottom 3.6 below `goal`), so a
  // goal on the surface buries the pot in the stroke. It rests on the cream
  // line's top edge (0.75 over the polyline), plus the extra a 4.2×0.8 saucer
  // needs on this 2.4/14 slope to touch on its uphill rim (≈1.1 total).
  goal: [67, 21.2 - 1.1 - 3.6],
  // Framed off what the DRAW functions reach (plant glow 8.8 wide, can glow
  // 4.6), not the points above. Width sets the scale; the y's only centre.
  bounds: { x0: -3, x1: 77, y0: 4.2, y1: 23 },
};


/** Her seat on a scene's terrain at `x`: surface angle, centre R clear along
 * the NORMAL — derived, so an edit to the slope cannot leave her in the air. */
function seatOn(poly, x) {
  let i = 0;
  while (i < poly.length - 2 && poly[i + 1][0] < x) i++;
  const [ax, ay] = poly[i], [bx, by] = poly[i + 1];
  const a = Math.atan2(by - ay, bx - ax);
  const y = ay + (by - ay) * ((x - ax) / (bx - ax));
  return { x: x + Math.sin(a) * R, y: y - Math.cos(a) * R, a };
}
const GOAL_SEAT = seatOn(GOAL_SCENE.terrain[0], GOAL_SCENE.startX);

// The ride-line is the SHAPE of her fall: one arc from pad to pot, drawn as
// though the band were not there (bent onto the band it became a kinked
// route). It ends at the plant's MIDDLE (`goalMid`, derived); the shaping point
// [53, 12.2] is the one number set by eye, against that endpoint — move the
// plant and look at it again.
const RIDE_PATH = [[11, 8.8], ...GOAL_SCENE.cans, [53, 12.2], goalMid(GOAL_SCENE)];
// World units from the plant's middle to the arrow's nose: under ~5 buries the
// nose in the blades, much over 6 backs it out of the glow.
const TIP_CLEAR = 5.6;

/** The dashed ride-line with an arrow. The path's last point is what the
 * arrow AIMS at, not where it is drawn: the nose stops TIP_CLEAR short along
 * the same line, so the bearing is true. */
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

/** Picture one — the goal. The plant is drawn READY (st.gotN = every can):
 * this is the ending, so it wears the ending's face. */
function drawGoalScene() {
  drawTerrain(GOAL_SCENE);
  drawRide(RIDE_PATH);
  GOAL_SCENE.cans.forEach((c, i) => drawCan(c[0], c[1], false, i));
  drawGoalPlant(GOAL_SCENE, { gotN: GOAL_SCENE.cans.length });
  // After the cans and the plant, as the game draws them: a can's glow would
  // swallow a band drawn underneath it.
  drawBand(GOAL_SCENE.band, 0, false);
  drawGoomba(GOAL_SEAT.x, GOAL_SEAT.y, GOAL_SEAT.a, 1, true, false, true);
}

/** Picture zero — her, gliding along the top of the words. Her canvas covers
 * the words as well as the air (#title #scTitle) so she is drawn OVER the
 * letters, never sliced at the line she rides. Nothing else is drawn into it.
 *
 * HER SIZE IS THE GOAL PICTURE'S (`goalScale`), not the title's: scale-in,
 * `ground`-out (`titleFrame`). Reverse it and she becomes a fraction of the
 * LOGO and drifts from the picture's cat. She crosses and wraps clear of both
 * ends (TITLE_RUNWAY ≥ her half-width, in WORLD units). */
const TITLE_CROSS = 9;     // seconds, one end of the words to the other
const TITLE_RUNWAY = 6;    // ...starting and ending this far outside the canvas

/** The title's CAP LINE, css px below the top of the h1's box: the line she
 * rides. A constant, because the mark is OUTLINES with one geometry — and it
 * is `--cap-em` in styles.css, not a literal here, because logo-outline.py
 * prints it with the svg's size and the two must agree. */
function capLine(h1) {
  const cs = getComputedStyle(h1);
  return parseFloat(cs.fontSize) * (parseFloat(cs.getPropertyValue("--cap-em")) || 0);
}

/** The scale the GOAL picture is drawn at, css px per world unit, with
 * drawScene's own formula — the min() written out so that if `#gate .scene`'s
 * aspect-ratio and GOAL_SCENE's frame ever drift apart, the cats still agree. */
function goalScale() {
  const r = scGoalEl.getBoundingClientRect(), b = GOAL_SCENE.bounds;
  return Math.min(r.width / (b.x1 - b.x0), r.height / (b.y1 - b.y0));
}

/** The world the title canvas frames: the canvas, at the GOAL picture's scale
 * on BOTH axes (so drawScene's min() cannot letterbox), with `ground` the
 * measured air in those units. Scale in, cap line out — never the reverse.
 * `|| 1`: with the gate unboxed `goalScale` is 0 and drawScene bails before the
 * body, so these need only be finite. `Math.max(air, 1)` keeps her ON the strip. */
function titleFrame(el, h1) {
  const w = el.clientWidth, h = el.clientHeight;
  const air = Math.max(h1.getBoundingClientRect().top
    - el.getBoundingClientRect().top + capLine(h1), 1);
  const s = goalScale() || 1;                  // css px per world unit
  return { x0: 0, x1: w / s, y0: 0, y1: h / s, ground: air / s };
}

function drawTitleScene(b) {
  const t = REDUCED() ? 0.5 : (tGlobal % TITLE_CROSS) / TITLE_CROSS;
  const x = b.x0 - TITLE_RUNWAY + (b.x1 - b.x0 + TITLE_RUNWAY * 2) * t;
  // A shallow glide path, nose on its slope. World y is down, so a positive
  // slope is a positive (clockwise) rotation, as the sim hands drawGoomba.
  const k = 0.26, amp = 0.4;
  const y = b.ground - R + Math.sin(x * k) * amp;
  // GROUNDED, not airborne: `airborne` blows her pupils up 1.5x, the game's
  // tell for nothing under her, and a title is no place to wear it.
  drawGoomba(x, y, Math.atan(amp * k * Math.cos(x * k)), 1, true, false, false);
}

/** Pictures three and four — the two gestures on ONE stage: the same ledges
 * and band in both, so the only difference is the hand (lay on the left, take
 * back on the right). Only drag and tap are shown; tap-tap and the stretch are
 * found by trying. NO X over the band being taken back, ever: drawBand already
 * paints an illegal placement red and dashed, so an X would teach "you cannot
 * put one there". The FINGERTIP is the one mark with no counterpart in the
 * game, on the same licence as the ride-line: a gesture cannot be drawn out of
 * the things it acts on. */
const GESTURE_SCENE = {
  terrain: [[[0, 8], [11, 8]], [[26, 15], [37, 15]]],
  band: { ax: 11, ay: 8, bx: 26, by: 15 },    // what the drag lays, end to end
  // A ledge down onto a lower one, so the band goes in on a slant and a
  // half-width panel uses its height. Same SCALE as the pictures above. Wide
  // enough for the terrain HALO (2.2 either side), hence -3 and 40.
  bounds: { x0: -3, x1: 40, y0: 5, y1: 18 },
};
// The beats of each loop, in seconds. Both run 3s.
const LAY_PRESS = 0.25, LAY_PULL = 1.55, LAY_LET = 1.75, LAY_HOLD = 2.75,
  LIFT_TAP = 0.75, LIFT_GONE = 1.35, LIFT_BACK = 2.05, LIFT_SOLID = 2.25,
  GESTURE_LOOP = 3;

/** A fingertip: a soft disc under a ring, `press` scaling both (1 = down on
 * the glass) and `a` fading them. White — the only white thing here. */
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

/** LEFT — laying one: press, pull the band out (the game's own drag ghost),
 * let go, hold. The rewind at the end happens with no finger near it, so the
 * placing panel never appears to remove. */
function drawLayScene() {
  const bd = GESTURE_SCENE.band;
  // Reduced motion: parked mid-pull, a band half-drawn under a finger.
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

/** RIGHT — taking it back: the finger comes down, the band goes, the ring
 * goes out after it. It steps back in through the ghost with the finger long
 * gone. */
function drawLiftScene() {
  const bd = GESTURE_SCENE.band, [mx, my] = bandMid(bd);
  drawTerrain(GESTURE_SCENE);
  if (REDUCED()) {
    // Reduced motion: one frame says "tapped, and going".
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
    // Both ends pulled into the tap, then the ring out after it — the
    // opposite motion to the panel beside it, where a band grows OUT.
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

// The sheet opens as the GATE and is the same element `?` reopens. `sheetOpen`
// is what the loops render off; `sheetTap` is "may this be dismissed". It is
// NEVER dismissed by anything but a tap or a key: the room going live only
// ARMS it (`armSheet`) — a sheet that vanishes by itself is a sheet nobody read.
let sheetOpen = true, sheetTap = false;
/** Is the sheet on screen (so the loop must keep drawing it)? */
export const sheetIsOpen = () => sheetOpen;
/** May a key or a tap dismiss it? Armed by the first snapshot, never by it. */
export const sheetIsArmed = () => sheetTap;

/** Make the sheet dismissible. `.ready` also raises `#gateTap` ("tap to
 * continue"), and never before this call: before it a tap does nothing and the
 * line would be a lie. */
export function armSheet() {
  sheetOpen = true; sheetTap = true;
  cancelZoop();   // re-opened mid-flight: the sheet is back, not still leaving
  gateEl.classList.add("ready"); gateEl.classList.remove("hidden");
  hudEl.classList.add("sheet");
  drawSheet();   // the frame it appears on is already the picture, never a blank box
}

// Dismissal ZOOPS the sheet into `#help`'s corner while the button pops to
// catch it (keyframes in styles.css, "THE ZOOP"). Both boxes are MEASURED,
// never written into the CSS: `#help` sits on a safe-area inset and a rotation
// moves it.
let zoopTimers = [];
/** Put the sheet away. `.ready` comes off HERE, not at the top of the close:
 * it is one of the two things keeping the connection lines invisible, and
 * dropping it early raises "Joining your team…" on a sheet already flying. */
function hideGate() {
  gateEl.classList.add("hidden"); gateEl.classList.remove("ready");
}
function cancelZoop() {
  zoopTimers.forEach(clearTimeout); zoopTimers = [];
  gateEl.classList.remove("zoop"); helpEl.classList.remove("pop");
}
/** The clock, read off the CSS so flight and landing cannot drift. UNIT-AWARE:
 * Vite's minifier rewrites `460ms` to `.46s`, and a bare parseFloat would
 * retire the sheet half a millisecond in. */
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
  // `hidden` the moment the flight ends; the pop runs on and is cleared after.
  zoopTimers.push(setTimeout(hideGate, ms));
  zoopTimers.push(setTimeout(cancelZoop, ms * 2));
}
helpEl.onclick = () => armSheet();
// POINTERDOWN, not click: the kiosk lockdown in main.js preventDefault()s
// touchstart, which kills the synthesised click — an `onclick` here works on a
// laptop and does nothing on a phone.
gateEl.addEventListener("pointerdown", (e) => {
  if (!sheetTap) return;
  e.preventDefault();
  closeSheet();
});

/** Before the first snapshot there is no game loop, so the sheet drives its
 * own clock and stands down when frame() takes over (which draws it too). */
export function sheetFrame(nowMs) {
  if (S.inited) return;
  requestAnimationFrame(sheetFrame);
  const dt = Math.min(0.05, (nowMs - (sheetFrame.last || nowMs)) / 1000);
  sheetFrame.last = nowMs;
  advanceClock(dt);
  drawSheet();
}
