// The drawing surface, and everything drawn on it.
//
// Ported from the deleted prototype nearly verbatim. The surface globals
// (`ctx`, `W`, `H`, the camera offset) are exported as LIVE BINDINGS: only this
// file assigns them, and every importer sees the current value. That is what
// lets `drawScene` point the whole renderer at a 340px canvas and back without
// any draw function growing a "which canvas?" parameter.

import {
  R,
  POP_R,
  BUMP_R,
  BAND_MIN,
  BAND_MAX,
  bandPoints,
} from "@escape-cats/shared";
import { cv } from "./dom";
import { S, bandInk, bandInkDark, PARTY_COLORS } from "./state";

/** The camera. A const alias onto the one in `S`: it is mutated in place
 * (`Object.assign`, `cam.x +=`), never rebound, so both names are one object. */
export const cam = S.cam;

/** `?flat` — draw the game with its AURAS off, and nothing else changed.
 *
 * Four shapes in this file are wide, low-alpha fills sitting under the thing
 * they belong to: the 4.4-unit cream stroke under every terrain polyline (the
 * wedge rule, 2 x her radius, made visible), and the soft discs behind a can, a
 * bumper and the goal plant. Every one has hard edges and every one is painted
 * at full resolution — but a 13%-alpha disc 9 units wide reads as a GLOW, and a
 * glow around everything reads as a blurry screen.
 *
 * So this exists to answer one question a screenshot cannot: when someone says
 * the game looks soft, do they mean the pixels or do they mean the art? `?pixels`
 * measures the first and has come back clean on every machine we have pointed it
 * at; this flips the second off so the two can be told apart by looking. It is a
 * DIAGNOSTIC, not a setting — nobody plays with it, and if the answer turns out
 * to be the art then the fix is to change the art, not to ship this.
 *
 * Its own flag, never folded into `?debug`: that one means exactly one thing
 * (this phone is in the cleared-room state) and nothing else may hide behind
 * it. Boot-time const rather than a live read, because unlike a pointer type a
 * URL cannot change without a reload. */
const FLAT = new URLSearchParams(location.search).has("flat");

export let ctx = cv.getContext("2d");
export let W = 0, H = 0;
/** The lab draws levels into grid cells by offsetting the camera. */
export let camOX = 0, camOY = 0;
/** The animation clock, in seconds. Advanced by whichever loop is running. */
export let tGlobal = 0;
export const advanceClock = (dt) => { tGlobal += dt; };
/** Only the lab sets this, once per card. */
export const setCamOffset = (ox, oy) => { camOX = ox; camOY = oy; };


/** The page scale the canvas is being stretched by — and never a number below 1.
 *
 * Asked for twice. `visualViewport.scale` is the direct answer and the one to
 * believe; the WIDTH ratio is the same question from the other side, since
 * `innerWidth` is the layout viewport and the visual viewport is the part of it
 * you can currently see, so their quotient IS the zoom. Width, never height — a
 * soft keyboard shortens the visual viewport without zooming anything. The
 * larger wins, for the reason in `backingScale` below.
 *
 * **The floor at 1 is not tidiness, it is the safety of the whole fix.**
 * Measured in WebKit: a page at `width=780, initial-scale=2` is RELAID OUT
 * rather than composited — innerWidth 780, devicePixelRatio 1.5, and the same
 * 1170 device pixels are still 1170 device pixels, so the canvas was already
 * exactly right while `visualViewport.scale` reads 0.5. Letting that 0.5 through
 * would halve the backing store and turn this fix into the blur it was written
 * to remove. Scaling UP is the only direction that can ever be needed: the thing
 * being corrected for is a compositor stretching a bitmap we already painted,
 * which by definition no relayout told us about. */
function pageScale() {
  const vv = window.visualViewport;
  if (!vv) return 1;
  const byWidth = vv.width > 0 ? window.innerWidth / vv.width : 1;
  return Math.max(1, vv.scale || 1, byWidth);
}

/** Device pixels per CSS pixel — how many real pixels this canvas gets to paint
 *  each CSS pixel with, and the one number this whole section exists to get
 *  right.
 *
 * `devicePixelRatio` alone is not it. It reports how dense the panel is, and a
 * page SCALE multiplies that — a pinch (which iOS Safari allows whatever
 * `user-scalable=no` says), or an in-app browser that lands at a scale other
 * than 1. Layout does not change, so the canvas is never asked to resize; the
 * compositor just stretches the bitmap it has. DOM text re-rasterises at the
 * new scale and stays crisp while the canvas does not, which is the exact shape
 * of the report this came from: PLAY sharp, the game soft.
 *
 * The awkward part, measured rather than assumed: **engines disagree about
 * whether dpr already contains the scale.** Playwright's WebKit port at
 * `width=260, initial-scale=1.5` reports dpr 4.5 — 3 x 1.5, folded in — AND
 * `visualViewport.scale` 1.5, both at once; Chromium under a compositor page
 * scale leaves dpr alone and moves only `visualViewport`; a live iOS pinch is
 * believed to move only `visualViewport.scale` with dpr fixed, but no
 * instrument here can perform one, so that is the one unmeasured case.
 * Nothing readable from JS says which convention is in force, so the product
 * can DOUBLE-COUNT (WebKit above: 4.5 x 1.5 = 6.75 asked, 4.5 true) — the cap
 * below is what bounds that, and over-asking under a cap is the cheap failure.
 *
 * So take the product and let it over-ask. Over-asking costs memory and is
 * bounded below; under-asking is the blur. That is also why the cap moved to
 * the PRODUCT: capping dpr at 3 first threw away exactly the resolution a
 * folded-in scale had just told us about (WebKit's 4.5 became 3, a third of the
 * pixels gone) — the old cap was doing the damage it was meant to prevent. At
 * rest on every iPhone and iPad this is byte-for-byte what shipped before: dpr
 * 3 or 2, scale 1, product unchanged. It only ever rises now on a phone denser
 * than 4x or a page that is genuinely zoomed. */
const MAX_BACKING = 4;
/** The ratio cap is not a memory guard, because screens are not the same size.
 * 4x on an iPhone 13 is 4.1 megapixels; 4x on an iPad Pro 12.9 is 22.4 — past
 * iOS's ~16.7-megapixel canvas ceiling, where allocation fails SILENTLY: the
 * context stays valid, every draw is a no-op, and the game is a blank screen.
 * A soft game beats no game, so the AREA binds too, with margin under the
 * ceiling.
 *
 * **That ceiling is iOS's, and it used to be charged to everyone.** One
 * constant for all platforms meant a desktop paid an iOS tax it does not owe:
 * measured in WebKit, a 6K-class viewport (3008x1692 at dpr 2 — a Pro Display
 * XDR) wants 20.4 MP, got clamped to 1.75x, and read SHARPNESS 0.875 SITTING
 * STILL, un-zoomed, on a machine with gigabytes to spare. Desktop Safari,
 * Chrome and Firefox are all documented at 2^28 px or memory-bound; none of
 * them is anywhere near 2^24. So the ceiling now asks which machine it is on.
 *
 * The question it asks is "can this thing be touched at all", not "is this a
 * phone", and it is deliberately biased: **unknown counts as touch.** Guessing
 * desktop wrong is the blank screen above — the worst thing this file can do,
 * at a party, on someone else's phone, where nobody can debug it. Guessing
 * touch wrong only costs sharpness on a display nobody carries to a party.
 * That asymmetry is the whole design, and it is why this is not the runtime
 * allocation probe that would be cleaner: nothing here can test a real iOS
 * allocation failure, and an untestable probe trades a soft game for a blank
 * one. `finePointer` in `state.js` asks a different question (is there a
 * CURSOR) for a different reason, so it is not reused here.
 *
 * On every iPhone and iPad this is byte-for-byte what shipped before. */
const MAX_AREA_TOUCH = 14e6;
/** Covers every real display at rest — the largest, a Pro Display XDR at dpr 2,
 * is 20.4 MP — while still refusing an absurd allocation (an 8K panel at dpr 2
 * would ask 132 MP / ~530 MB). Nothing between those two is a party game. */
const MAX_AREA_DESKTOP = 64e6;
/** Read live, never latched: `maxTouchPoints` is the one signal here, and a
 * boot-time snapshot is how the pointer-type bug in the selector got written. */
const maxArea = () =>
  ((navigator.maxTouchPoints ?? 1) > 0 || "ontouchstart" in window)
    ? MAX_AREA_TOUCH : MAX_AREA_DESKTOP;
function backingScale() {
  let s = Math.min((window.devicePixelRatio || 1) * pageScale(), MAX_BACKING);
  const area = window.innerWidth * window.innerHeight * s * s;
  const cap = maxArea();
  if (area > cap) s *= Math.sqrt(cap / area);
  // Quantised UP to eighths. A pinch reports its scale every frame, each
  // fractionally different, and `resize` keys its idempotence on this number —
  // measured unquantised, one two-finger zoom reallocated the backing store 40
  // times. Steps make almost all of those the same answer (a real gesture now
  // costs a handful), UP so quantisation can never be the thing that
  // under-asks, and eighths because every real dpr (1, 1.25, 1.5, 2, 2.25, 3)
  // is already an exact multiple: at rest this rounds nothing.
  return Math.ceil(s * 8) / 8;
}

// Idempotent, because the listeners below include visualViewport's `scroll`,
// which fires continuously through a pinch — and reallocating the backing
// store is the one genuinely expensive thing in this file (it also resets the
// whole 2D context state). Same geometry in, nothing done.
let sizeKey = "";
export function resize() {
  const s = backingScale();
  const key = window.innerWidth + "x" + window.innerHeight + "@" + s;
  if (key === sizeKey) return;
  sizeKey = key;
  // The backing store has to be a whole number of pixels, so let IT be the
  // exact thing and derive the CSS box from it. Sizing the other way round —
  // box from `innerWidth`, backing rounded off it — leaves a box that is a
  // fraction of a pixel wider than the bitmap covering it, and the browser
  // resamples the whole canvas to close the gap. That is a real gap on iOS,
  // where `innerWidth` is not always an integer. The box moves by under half a
  // device pixel, which no layout here can feel.
  const bw = Math.round(window.innerWidth * s), bh = Math.round(window.innerHeight * s);
  cv.width = bw; cv.height = bh;
  W = bw / s; H = bh / s;
  cv.style.width = W + "px"; cv.style.height = H + "px";
  // W/H stay in CSS px, so every sxp/syp/cam.s number downstream is unchanged.
  ctx.setTransform(s, 0, 0, s, 0, 0);
}

/** The self-heal, called on a slow timer from frame().
 *
 * Every listener below is a guess about WHEN the viewport changes. This one
 * does not have to guess: it asks the canvas how big it actually is and
 * re-sizes if that disagrees with what we sized it for. A viewport change that
 * fires no event we listen to, a bfcache restore, an in-app browser settling
 * after its presentation animation — they all land here. The failure it
 * insures against is silent, and a blurry game nobody can explain is a worse
 * trade than one getBoundingClientRect a second. */
export function checkFit() {
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return;   // display:none — nothing to fit to
  // Compare what the canvas HAS against what this moment's box and scale say
  // it should have. Checking only the box misses the change where the box
  // stays put and the scale moves under it — dragging the window to a 1x
  // monitor, desktop zoom with the window size unchanged — which fires no
  // event this file listens to. Tolerance is device pixels, and more than one,
  // because layout snaps the box to the device grid and a half-pixel of snap
  // must not re-allocate the store once a second forever.
  const s = backingScale();
  if (Math.abs(cv.width - r.width * s) > 1.5 || Math.abs(cv.height - r.height * s) > 1.5) {
    sizeKey = "";   // the world moved under us: re-apply even if inner* agrees
    resize();
  }
}

// `resize` is not the only way the picture changes size. orientationchange can
// land before window.resize on iOS, visualViewport is the only one that
// reports a pinch at all (and reports it as scroll as often as resize), and
// pageshow is the bfcache restore.
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", resize);
window.addEventListener("pageshow", resize);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", resize);
  window.visualViewport.addEventListener("scroll", resize);
}
resize();
if (new URLSearchParams(location.search).has("pixels")) {
  import("./pixelprobe.js").then((m) => m.startPixelProbe(cv));
}

if (!ctx.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r); this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r); this.closePath();
  };
}

export const sxp = (x) => (x - cam.x) * cam.s + W / 2 + camOX;
export const syp = (y) => (y - cam.y) * cam.s + H / 2 + camOY;

export function fitScale(lv) {
  const b = lv.bounds;
  return Math.min(W / (b.x1 - b.x0), (H - 120) / (b.y1 - b.y0)) * 0.96;
}
export function clampCam(x, y, s, b) {
  const hw = W / 2 / s, hh = H / 2 / s;
  return {
    x: (b.x1 - b.x0) < 2 * hw ? (b.x0 + b.x1) / 2 : Math.max(b.x0 + hw, Math.min(b.x1 - hw, x)),
    y: (b.y1 - b.y0) < 2 * hh ? (b.y0 + b.y1) / 2 : Math.max(b.y0 + hh, Math.min(b.y1 - hh, y)),
    s,
  };
}

/** Draw a scene into one of the sheet's canvases, framed to its bounds.
 *
 * The renderer's globals ARE the parameters here: point `ctx` at the little
 * canvas, tell it how big it is, put the camera on the scene, draw, and hand
 * all of it back. The restore is in a finally because a throw mid-picture that
 * left `ctx` on a 340px canvas would take the whole game's rendering with it. */
export function drawScene(el, b, body) {
  // getBoundingClientRect, not clientWidth: these boxes are laid out by CSS
  // (a percentage width, a height in `em`) and land on fractions of a pixel,
  // and clientWidth rounds that away. Sizing the backing store off the rounded
  // number leaves up to a whole CSS pixel of stretch across the canvas — a
  // resample of everything in it, on the sheet that is the first screen a
  // phone sees. #scTitle measured 381.19 CSS px wide in Safari.
  const rect = el.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  if (!w || !h) return;              // the sheet is hidden: nothing to draw into
  const dpr = backingScale();
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (el.width !== bw || el.height !== bh) { el.width = bw; el.height = bh; }
  const g = el.getContext("2d");
  // The scale the bitmap ACTUALLY has against its box, not the one we asked
  // for: `bw` was rounded to a whole pixel, so `bw / w` is a hair off `dpr`,
  // and drawing at `dpr` would leave the last fraction of a pixel unpainted
  // and shift everything against the box it is stretched into.
  g.setTransform(bw / w, 0, 0, bh / h, 0, 0);
  g.clearRect(0, 0, w, h);
  const savedCtx = ctx, savedW = W, savedH = H, savedCam = { ...cam },
    savedOX = camOX, savedOY = camOY;
  ctx = g; W = w; H = h; camOX = camOY = 0;
  cam.s = Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0));
  cam.x = (b.x0 + b.x1) / 2; cam.y = (b.y0 + b.y1) / 2;
  try {
    body();
  } finally {
    ctx = savedCtx; W = savedW; H = savedH;
    Object.assign(cam, savedCam); camOX = savedOX; camOY = savedOY;
  }
}

const ambient = [];
for (let i = 0; i < 34; i++) ambient.push({
  x: Math.random(), y: Math.random(), s: 2 + Math.random() * 3,
  c: PARTY_COLORS[i % 4], vy: 6 + Math.random() * 12, sway: Math.random() * 6.28,
});

export function drawBackground(dt) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#241245"); g.addColorStop(0.6, "#170b30"); g.addColorStop(1, "#12081f");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (let row = 0; row < 2; row++) {
    const y0 = 26 + row * 34, sagg = 22 + row * 8, x0 = -20, x1 = W + 20;
    ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(W / 2, y0 + sagg * 2, x1, y0); ctx.stroke();
    const n = Math.floor(W / 54);
    for (let i = 1; i < n; i++) {
      const t = i / n, u = 1 - t;
      const bx = u * u * x0 + 2 * u * t * (W / 2) + t * t * x1;
      const by = u * u * y0 + 2 * u * t * (y0 + sagg * 2) + t * t * y0;
      const c = PARTY_COLORS[(i + row) % 4];
      const tw = 0.55 + 0.45 * Math.sin(tGlobal * 2.2 + i * 1.7 + row);
      ctx.fillStyle = c; ctx.globalAlpha = 0.35 + 0.5 * tw;
      ctx.beginPath(); ctx.arc(bx, by + 4, 3, 0, 6.28); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  for (const a of ambient) {
    a.y += a.vy * dt / H; a.sway += dt * 2;
    if (a.y > 1.05) { a.y = -0.05; a.x = Math.random(); }
    ctx.save();
    ctx.translate(a.x * W + Math.sin(a.sway) * 14, a.y * H);
    ctx.rotate(a.sway);
    ctx.fillStyle = a.c; ctx.globalAlpha = 0.35;
    ctx.fillRect(-a.s / 2, -a.s / 4, a.s, a.s / 2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

export function drawTerrain(lv) {
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (const poly of lv.terrain) {
    ctx.beginPath();
    poly.forEach(([x, y], i) => i ? ctx.lineTo(sxp(x), syp(y)) : ctx.moveTo(sxp(x), syp(y)));
    if (!FLAT) {
      ctx.strokeStyle = "rgba(243,233,214,0.14)"; ctx.lineWidth = 4.4 * cam.s;
      ctx.stroke();
    }
    ctx.strokeStyle = "#f3e9d6"; ctx.lineWidth = 1.5 * cam.s;
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,93,177,0.55)"; ctx.lineWidth = 0.5 * cam.s;
    // The pink ticks are PAINT on the floor: they mark it, they do not travel
    // along it. Hence the explicit offset — the marching-ants drawings below
    // leave one on the context, and terrain that inherits it crawls.
    ctx.setLineDash([2 * cam.s, 7 * cam.s]); ctx.lineDashOffset = 0;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** One band, in the TEAM's colour — every band on the board is the same one,
 * because none of them belongs to a player any more. */
export function drawBand(bd, excite, ghost) {
  const pts = bandPoints(bd);
  const jig = excite * Math.sin(tGlobal * 32) * 1.2;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const path = () => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const wob = i > 0 && i < pts.length - 1 ? jig * Math.sin(i * 1.3) : 0;
      i ? ctx.lineTo(sxp(x), syp(y + wob)) : ctx.moveTo(sxp(x), syp(y + wob));
    });
  };
  const bad = ghost && S.preview && !S.preview.ok;
  ctx.globalAlpha = ghost ? 0.75 : 1;
  const ink = bandInk();
  ctx.strokeStyle = bad ? "#ff4a4a" : bandInkDark();
  if (ghost) ctx.setLineDash(bad ? [6, 6] : []);
  ctx.lineWidth = 1.5 * cam.s; path(); ctx.stroke();
  ctx.strokeStyle = bad ? "#ff8f8f" : ink;
  ctx.lineWidth = 0.8 * cam.s; path(); ctx.stroke();
  ctx.setLineDash([]);
  for (const [x, y] of [pts[0], pts[8]]) {
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.arc(sxp(x), syp(y), 0.9 * cam.s, 0, 6.28); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath(); ctx.arc(sxp(x) - 0.25 * cam.s, syp(y) - 0.25 * cam.s, 0.3 * cam.s, 0, 6.28); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** A teammate's band-in-progress: same sagging shape as a real band, but
 * translucent with marching dashes and hollow endpoint rings — reads as
 * "being dragged", never as "placed". The team's colour like every other band;
 * what makes it theirs rather than mine is the motion — no name, here or
 * anywhere else on this screen. */
export function drawTeammatePreview(p) {
  const pts = bandPoints(p);
  const col = bandInk();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.globalAlpha = 0.5 + 0.15 * Math.sin(tGlobal * 6);
  ctx.strokeStyle = col;
  ctx.setLineDash([1.6 * cam.s, 1.6 * cam.s]);
  ctx.lineDashOffset = -tGlobal * 8 * cam.s; // marching ants: motion at a glance
  ctx.lineWidth = 1.0 * cam.s;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(sxp(x), syp(y)) : ctx.moveTo(sxp(x), syp(y))));
  ctx.stroke();
  // the offset goes back with the pattern: it is context state, and everything
  // dashed drawn after this one — the terrain on the next frame included —
  // inherits whatever is left on it
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  for (const [x, y] of [pts[0], pts[8]]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = 0.45 * cam.s;
    ctx.beginPath(); ctx.arc(sxp(x), syp(y), 0.9 * cam.s, 0, 6.28); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** The waiting end of a tap-tap band: a pulsing ring where the first tap
 * landed, with the instruction right under it. It fades out over its last
 * second so an anchor that times out is seen dying, not found missing. */
/** How long an open anchor waits before it gives up. `input.js` enforces it;
 * this file draws the countdown, so the one number lives here and is imported
 * there rather than declared twice. */
export const ANCHOR_TTL = 8000;

export function drawAnchor(a) {
  // Screen units, not world: the edit camera is whatever fits the level, and
  // a fingertip is the same size on every one of them.
  const x = sxp(a.x), y = syp(a.y);
  const col = bandInk();
  const left = ANCHOR_TTL - (performance.now() - a.at);
  ctx.globalAlpha = Math.max(0, Math.min(1, left / 900));
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]); ctx.lineDashOffset = -tGlobal * 22;
  ctx.beginPath(); ctx.arc(x, y, 15 + 2 * Math.sin(tGlobal * 5), 0, 6.28); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(x, y, 4, 0, 6.28); ctx.fill();
  // Caption on a dark pill — it has to be readable over terrain and confetti.
  ctx.font = "600 11px ui-rounded, system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const label = "tap the other end", w = ctx.measureText(label).width + 14;
  ctx.fillStyle = "rgba(20,10,45,0.82)";
  ctx.beginPath(); ctx.roundRect(x - w / 2, y + 21, w, 18, 9); ctx.fill();
  ctx.fillStyle = col;
  ctx.fillText(label, x, y + 30.5);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 1;
}

/** The same waiting point, seen from a teammate's phone: a ring alone — no
 * instruction (it isn't your tap to finish) and no name (nothing in this game
 * draws one; the four of them are in the same room). Drawn for any preview too
 * short to be a band — see GoombaBandPreview. */
export function drawTeammateAnchor(p) {
  const x = sxp(p.ax), y = syp(p.ay);
  const col = bandInk();
  ctx.globalAlpha = 0.55 + 0.25 * Math.sin(tGlobal * 4);
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]); ctx.lineDashOffset = -tGlobal * 22;
  ctx.beginPath(); ctx.arc(x, y, 13, 0, 6.28); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 6.28); ctx.stroke();
}

export function drawCushion(c, squish) {
  const u = Math.max(cam.s, 2.2);
  const x = sxp(c.x + c.w / 2), y = syp(c.y), w = c.w * cam.s;
  const sy = 1 - 0.3 * squish, sx = 1 + 0.25 * squish;
  ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy);
  ctx.fillStyle = "#ff9dce";
  ctx.beginPath(); ctx.roundRect(-w / 2, -0.6 * u, w, 3.4 * u, 1.7 * u); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath(); ctx.roundRect(-w / 2 + 0.8 * u, -0.1 * u, w - 1.6 * u, 0.7 * u, 0.35 * u); ctx.fill();
  ctx.fillStyle = "#e074ae"; // button dimples
  const nb = Math.max(2, Math.round(c.w / 14));
  for (let i = 1; i <= nb; i++) {
    ctx.beginPath(); ctx.arc(-w / 2 + (w * i) / (nb + 1), 1.5 * u, 0.35 * u, 0, 6.28); ctx.fill();
  }
  ctx.restore();
}

export function drawPopper(pp, i) {
  const u = Math.max(cam.s, 2.2);
  const x = sxp(pp.x), y = syp(pp.y);
  const rad = Math.atan2(pp.vy, pp.vx);
  const pulse = 0.8 + 0.2 * Math.sin(tGlobal * 4 + i * 2);
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = "rgba(255,209,102,0.55)"; ctx.lineWidth = 0.35 * u;
  ctx.setLineDash([1.2 * u, 1.4 * u]); ctx.lineDashOffset = -tGlobal * 6 * u;
  ctx.beginPath(); ctx.arc(0, 0, POP_R * cam.s * pulse, 0, 6.28); ctx.stroke();
  ctx.setLineDash([]);
  ctx.rotate(rad);
  const grad = ctx.createLinearGradient(-3 * u, 0, 1.5 * u, 0);
  grad.addColorStop(0, "#ffd166"); grad.addColorStop(0.5, "#ff5db1"); grad.addColorStop(1, "#b18bff");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-3.2 * u, -0.5 * u); ctx.lineTo(1.6 * u, -1.7 * u);
  ctx.lineTo(1.6 * u, 1.7 * u); ctx.lineTo(-3.2 * u, 0.5 * u);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.ellipse(1.6 * u, 0, 0.5 * u, 1.7 * u, 0, 0, 6.28); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 0.35 * u; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(2.6 * u, 0); ctx.lineTo(5.2 * u, 0);
  ctx.moveTo(4.4 * u, -0.8 * u); ctx.lineTo(5.2 * u, 0); ctx.lineTo(4.4 * u, 0.8 * u); ctx.stroke();
  ctx.restore();
}

// The collectible: a watering can, mid-pour and dripping.
/** `ping` (0..1) is the locked-goal flare's ring: she touched the plant and
 * this is one of the cans that is why nothing happened. Gold, because that is
 * the can's own colour and the badge's number counts these — the ring, the can
 * and the 💧N are deliberately one colour saying one thing. It is drawn from
 * the can's RESTING centre, outside the bob, so a row of them reads as a set. */
export function drawCan(mx, my, taken, i, ping = 0) {
  if (taken) return;
  const u = Math.max(cam.s, 2.2), x = sxp(mx), y = syp(my);
  if (ping > 0) {
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = `rgba(255,209,102,${(0.75 * ping).toFixed(3)})`;
    ctx.lineWidth = (0.55 + 0.35 * ping) * u;
    ctx.beginPath(); ctx.arc(0, 0, (4.6 + (1 - ping) * 4.2) * u, 0, 6.28); ctx.stroke();
    ctx.restore();
  }
  ctx.save(); ctx.translate(x, y + Math.sin(tGlobal * 2.2 + i * 1.7) * 0.3 * u); ctx.rotate(-0.16);
  if (!FLAT) {
    ctx.fillStyle = "rgba(87,230,201,0.13)";
    ctx.beginPath(); ctx.arc(0, 0, 4.6 * u, 0, 6.28); ctx.fill();
  }
  ctx.strokeStyle = "#ffd166"; ctx.lineCap = "round"; ctx.lineWidth = 0.42 * u;
  ctx.beginPath(); ctx.arc(0.1 * u, -1.1 * u, 1.5 * u, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  ctx.lineWidth = 0.75 * u;                                            // spout, out to the left and up
  ctx.beginPath(); ctx.moveTo(-1.2 * u, 0.4 * u); ctx.lineTo(-3.2 * u, -1.1 * u); ctx.stroke();
  ctx.fillStyle = "#ffd166";                                           // sprinkler rose, then the body
  ctx.beginPath(); ctx.ellipse(-3.4 * u, -1.25 * u, 0.8 * u, 0.5 * u, -0.65, 0, 6.28); ctx.fill();
  ctx.beginPath(); ctx.roundRect(-1.5 * u, -1.2 * u, 3.4 * u, 3.2 * u, 0.7 * u); ctx.fill();
  ctx.fillStyle = "#57e6c9";                                           // the water inside
  ctx.beginPath(); ctx.roundRect(-1.1 * u, 0.1 * u, 2.6 * u, 1.75 * u, 0.5 * u); ctx.fill();
  for (let d = 0; d < 3; d++) {   // drops off the rose, each on its own loop
    const ph = (tGlobal * 0.85 + d * 0.34 + i * 0.19) % 1;
    ctx.globalAlpha = 1 - ph;
    ctx.beginPath(); ctx.arc((-3.5 - ph * 0.5) * u, (-0.8 + ph * 3.2) * u, 0.34 * u, 0, 6.28); ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.restore();
}

export function drawBumper(bp, hot) {
  const u = Math.max(cam.s, 2.2), x = sxp(bp.x), y = syp(bp.y);
  const pop = 1 + hot * 0.35;
  ctx.save(); ctx.translate(x, y); ctx.scale(pop, pop);
  if (!FLAT) {
    ctx.fillStyle = "rgba(255,93,177,0.15)";
    ctx.beginPath(); ctx.arc(0, 0, (BUMP_R + 2.5) * cam.s, 0, 6.28); ctx.fill();
  }
  const g = ctx.createRadialGradient(-BUMP_R * u * 0.3, -BUMP_R * u * 0.3, BUMP_R * u * 0.15, 0, 0, BUMP_R * u);
  g.addColorStop(0, "#ffd166"); g.addColorStop(0.55, "#ff5db1"); g.addColorStop(1, "#c23a85");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, BUMP_R * cam.s, 0, 6.28); ctx.fill();
  ctx.strokeStyle = hot > 0.05 ? "#fff" : "rgba(255,255,255,0.55)";
  ctx.lineWidth = (0.5 + hot) * u;
  ctx.beginPath(); ctx.arc(0, 0, BUMP_R * cam.s, 0, 6.28); ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 0.35 * u;
  for (let i = 0; i < 6; i++) {
    const a = i * 1.047 + tGlobal * 0.5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * BUMP_R * cam.s * 0.45, Math.sin(a) * BUMP_R * cam.s * 0.45);
    ctx.lineTo(Math.cos(a) * BUMP_R * cam.s * 0.85, Math.sin(a) * BUMP_R * cam.s * 0.85);
    ctx.stroke();
  }
  ctx.restore();
}

// The goal: the spider plant Goomba is watering. Thirsty, its blades barely
// lift out of the crown and hang limp, dulled, and the plantlet on its runner
// droops; with the last can in the whole fountain arches up bright and the
// baby swings — so the badge is a second telling of a state the plant itself
// already shows.
//
// [dir, reach, rise, drop, width] per blade: dir/reach set which way and how
// far it fans, rise how hard it arches on the way out, drop where the tip
// lands relative to the crown (+ is BELOW it — the outer blades spill over
// the rim, which is what makes it read as a spider plant and not a spike).
const SPIDER_BLADES = [
  [-1, 5.2, 2.4, 3.6, 0.7], [1, 5.4, 2.2, 3.9, 0.7],
  [-1, 4.4, 4.2, 1.7, 0.78], [1, 4.6, 4.0, 2.0, 0.78],
  [-1, 3.2, 6.0, -0.4, 0.85], [1, 3.4, 5.7, -0.2, 0.85],
  [-1, 1.6, 7.4, -3.4, 0.7], [1, 1.9, 7.0, -3.0, 0.7],
  [1, 0.5, 5.8, -5.4, 0.6],
];
const CROWN_Y = -3.4;   // the crown sits just ABOVE the pot rim, so the blades
                        // drape in front of it instead of being sliced by it
// Where the plant hangs off `goal`, and where its ink CENTRES. `goal` is the
// point the sim tests her against; the pot is drawn POT_DROP below it (see
// drawGoalPlant), and the glow — an ellipse about the whole plant, pot and
// blades together — sits GLOW_Y above the pot's origin. So `goalMid` is the
// middle of the plant as a player sees it, a little over the rim where the
// blades leave the crown, and nowhere near `goal` itself.
const POT_DROP = 2, GLOW_Y = -3.5;
/** The middle of the plant's INK, in world units. Exported because the how-to
 * sheet aims its ride-line arrow at it: a second copy of these two offsets
 * would drift the first time the pot moves inside its glow. */
export const goalMid = (lv) => [lv.goal[0], lv.goal[1] + POT_DROP + GLOW_Y];

// The badge's two inks: mint at rest, the can's own gold at the top of a flare.
// Interpolated rather than switched, because the whole point of a 0.4s accent
// is that it goes away again and a hard swap reads as a different badge.
const BADGE_MINT = [87, 230, 201], BADGE_GOLD = [255, 209, 102];
const badgeInk = (k) =>
  `rgb(${BADGE_MINT.map((v, i) => Math.round(v + (BADGE_GOLD[i] - v) * k)).join(",")})`;

/** `fx` (0..1) is the locked-goal flare — she is in the goal circle with cans
 * still out. Two of its three parts live here: the plant shivers and droops
 * that bit further (the same `lift`/`sag`/rotate knobs that already draw
 * thirsty, pushed for a moment), and the 💧N badge pops and warms to gold. Both
 * are accents of what the plant was already saying, not new vocabulary — the
 * third part, the ring off each can she still needs, is drawCan's. */
export function drawGoalPlant(lv, st, fx = 0) {
  const x = sxp(lv.goal[0]), y = syp(lv.goal[1]), u = Math.max(cam.s, 2.6);
  const left = lv.cans.length - (st ? st.gotN : 0), ready = left === 0;
  const pulse = 1 + Math.sin(tGlobal * 3) * 0.05;
  ctx.save(); ctx.translate(x, y + POT_DROP * u); ctx.scale(pulse, pulse);
  if (!FLAT) {
    ctx.fillStyle = ready
      ? "rgba(87,230,201,0.2)"
      : `rgba(255,209,102,${(0.12 + 0.16 * fx).toFixed(3)})`;
    ctx.beginPath(); ctx.ellipse(0, GLOW_Y * u, 8.8 * u, 7.5 * u, 0, 0, 6.28); ctx.fill();
  }
  // pot first — saucer, tapered body, rim: a spider plant's blades hang OVER
  // the rim, so every one of them rides in front of the pot, not behind it
  ctx.fillStyle = "#cfc4ec";
  ctx.beginPath(); ctx.ellipse(0, 0.8 * u, 4.2 * u, 0.8 * u, 0, 0, 6.28); ctx.fill();
  ctx.fillStyle = "#ff9dce";
  ctx.beginPath(); ctx.moveTo(-3.1 * u, -2.4 * u); ctx.lineTo(3.1 * u, -2.4 * u);
  ctx.lineTo(2.3 * u, 0.8 * u); ctx.lineTo(-2.3 * u, 0.8 * u); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ffd166";
  ctx.beginPath(); ctx.roundRect(-3.5 * u, -3.2 * u, 7 * u, 1.3 * u, 0.6 * u); ctx.fill();

  ctx.save();
  ctx.rotate(Math.sin(tGlobal * 1.7) * (ready ? 0.05 : 0.02)   // the idle sway…
    + Math.sin(tGlobal * 46) * 0.055 * fx);                    // …and the shiver
  const leaf = ready ? "#57e6c9" : "#49a08f";
  // the runner: a wiry stolon out past the rim with a baby plantlet on its end
  const swing = Math.sin(tGlobal * 1.9) * (ready ? 0.55 : 0.15) * u;
  const rx = 6.0 * u + swing, ry = (ready ? -1.2 : 0.2 + 0.5 * fx) * u;
  ctx.strokeStyle = ready ? "#8fe3c4" : "#5f8f7f";
  ctx.lineWidth = 0.22 * u; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(0.4 * u, CROWN_Y * u);
  ctx.quadraticCurveTo(3.4 * u, (CROWN_Y - 2.6) * u, rx, ry); ctx.stroke();
  ctx.fillStyle = leaf;
  for (const [ax, ay] of [[-1.7, 0.4], [-1.1, 1.2], [0, 1.5], [1.1, 1.1], [1.7, 0.3]]) {
    ctx.beginPath(); ctx.moveTo(rx, ry);
    ctx.quadraticCurveTo(rx + ax * 0.65 * u, ry + ay * 0.35 * u, rx + ax * u, ry + ay * u);
    ctx.quadraticCurveTo(rx + ax * 0.3 * u, ry + ay * 0.7 * u, rx, ry);
    ctx.fill();
  }
  // the blades, each a tapered arc with the cream stripe down its middle
  const lift = (ready ? 1 : 0.62) - 0.07 * fx, sag = (ready ? 0 : 1.6) + 1.3 * fx,
    spread = ready ? 1 : 0.88;
  for (const [dir, reach, rise, drop, w] of SPIDER_BLADES) {
    const tx = dir * reach * spread * u, ty = (CROWN_Y + drop + sag) * u;
    const cx = dir * reach * 0.42 * u, cy = (CROWN_Y - rise * lift) * u;
    const by = CROWN_Y * u;
    const len = Math.hypot(tx, ty - by) || 1;         // blade normal, for the taper
    const nx = (ty - by) / len * w * u, ny = -tx / len * w * u;
    ctx.fillStyle = leaf;
    ctx.strokeStyle = "rgba(255,209,102,0.7)"; ctx.lineWidth = 0.18 * u;
    ctx.beginPath(); ctx.moveTo(0, by);
    ctx.quadraticCurveTo(cx + nx, cy + ny, tx, ty);
    ctx.quadraticCurveTo(cx - nx, cy - ny, 0, by);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = ready ? "rgba(240,255,248,0.8)" : "rgba(214,236,228,0.35)";
    ctx.lineWidth = w * 0.22 * u;
    ctx.beginPath(); ctx.moveTo(0, by); ctx.quadraticCurveTo(cx, cy, tx, ty); ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
  if (left > 0) {
    const ink = badgeInk(fx);
    ctx.save(); ctx.translate(x, y - 12.5 * u);
    ctx.scale(1 + 0.38 * fx, 1 + 0.38 * fx);
    ctx.fillStyle = "rgba(20,10,45,0.85)";
    ctx.beginPath(); ctx.roundRect(-3.4 * u, -1.6 * u, 6.8 * u, 3.2 * u, 1.2 * u); ctx.fill();
    ctx.strokeStyle = ink; ctx.lineWidth = (0.28 + 0.18 * fx) * u; ctx.stroke();
    ctx.fillStyle = ink;
    ctx.font = `700 ${2.3 * u}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("💧" + left, 0, 0.1 * u);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.restore();
  }
}

export function drawGoomba(px, py, angle, face, grounded, airborne, idle) {
  const u = Math.max(cam.s, 2.4);
  ctx.save();
  ctx.translate(sxp(px), syp(py));
  ctx.rotate(angle);
  ctx.scale(face, 1);
  const crouch = grounded ? 1 : 0.88;
  const bob = idle ? Math.sin(tGlobal * 2.4) * 0.14 * u : 0;
  ctx.fillStyle = "#8f6cf0";
  ctx.beginPath(); ctx.roundRect(-4.2 * u, R * u * 0.72, 8.4 * u, 0.85 * u, 0.5 * u); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath(); ctx.roundRect(-3.4 * u, R * u * 0.72 + 0.15 * u, 2.4 * u, 0.25 * u, 0.15 * u); ctx.fill();
  ctx.strokeStyle = "#e8853d"; ctx.lineWidth = 1.0 * u; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-1.8 * u, 0.3 * u + bob);
  ctx.quadraticCurveTo(-3.6 * u, -0.4 * u + bob,
    -3.9 * u, (airborne ? -2.6 : -1.9) * u + Math.sin(tGlobal * 6) * 0.4 * u + bob);
  ctx.stroke();
  ctx.fillStyle = "#e8853d";
  ctx.beginPath(); ctx.ellipse(-0.3 * u, (-0.4 + bob / u) * u, 2.3 * u, 1.9 * u * crouch, 0, 0, 6.28); ctx.fill();
  ctx.strokeStyle = "#c96a24"; ctx.lineWidth = 0.32 * u;
  ctx.beginPath();
  ctx.moveTo(-1.6 * u, -1.7 * u * crouch + bob); ctx.lineTo(-1.3 * u, -0.9 * u + bob);
  ctx.moveTo(-0.6 * u, -2.0 * u * crouch + bob); ctx.lineTo(-0.4 * u, -1.1 * u + bob);
  ctx.stroke();
  ctx.fillStyle = "#e8853d";
  ctx.beginPath(); ctx.arc(1.7 * u, (-1.6 + bob / u) * u, 1.5 * u, 0, 6.28); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.7 * u, -2.6 * u + bob); ctx.lineTo(0.9 * u, -3.9 * u + bob); ctx.lineTo(1.7 * u, -2.9 * u + bob);
  ctx.moveTo(2.1 * u, -3.0 * u + bob); ctx.lineTo(2.7 * u, -4.0 * u + bob); ctx.lineTo(3.0 * u, -2.7 * u + bob);
  ctx.fill();
  ctx.strokeStyle = "#c96a24"; ctx.lineWidth = 0.28 * u;
  ctx.beginPath(); ctx.moveTo(1.0 * u, -3.4 * u + bob); ctx.lineTo(1.15 * u, -2.95 * u + bob); ctx.stroke();
  ctx.strokeStyle = "#ff5db1"; ctx.lineWidth = 0.55 * u;
  ctx.beginPath();
  ctx.moveTo(1.1 * u, -0.6 * u + bob);
  ctx.quadraticCurveTo(0 * u, -0.2 * u + bob,
    (-1.4 - (airborne ? 0.8 : 0.2)) * u, (-0.1 + Math.sin(tGlobal * 9) * 0.25) * u + bob);
  ctx.stroke();
  const wide = airborne ? 1.5 : 1;
  ctx.fillStyle = "#4d3319";
  ctx.beginPath();
  ctx.arc(1.45 * u, -1.8 * u + bob, 0.19 * u * wide, 0, 6.28);
  ctx.arc(2.45 * u, -1.8 * u + bob, 0.19 * u * wide, 0, 6.28);
  ctx.fill();
  ctx.strokeStyle = "#4d3319"; ctx.lineWidth = 0.14 * u;
  ctx.beginPath();
  ctx.moveTo(1.75 * u, -1.35 * u + bob); ctx.lineTo(1.95 * u, -1.2 * u + bob); ctx.lineTo(2.15 * u, -1.35 * u + bob);
  ctx.stroke();
  ctx.restore();
}

export function drawStartPad(lv) {
  const u = cam.s, x = sxp(lv.start[0]), y = syp(lv.start[1] + R + 0.5);
  ctx.strokeStyle = "rgba(87,230,201,0.5)"; ctx.lineWidth = 0.4 * u;
  ctx.setLineDash([1.2 * u, 1.2 * u]);
  ctx.beginPath(); ctx.arc(x, y - R * u, (R + 1.6) * u + Math.sin(tGlobal * 2.5) * 0.4 * u, 0, 6.28); ctx.stroke();
  ctx.setLineDash([]);
}
// ---------- the splash (phase "splash") ----------
// Where a cleared room lands when it takes NEXT off the finale, instead of the
// old victory lap: the congratulations screen. BLACK, the words on it
// (`drawSplashWords`), and the level selector's strip up top. Nothing else — no
// HUD, no PLAY (index.html hides them on #hud.splash) — and the one way on is
// the selector: the strip, or a tap anywhere on the screen (`splashTap`), which
// is the same `openSelector` either way.
//
// There is no PICTURE here any more, and with it went the only loaded asset
// this app had (public/art/splash.webp) and the sampler that continued its sky
// past the ends of a tall phone. Black needs neither: it fits every screen, it
// cannot load late, and it is the same on a phone and a laptop. hex-clicker's
// win screen still has its own picture at art/hex-splash.webp — the two were
// separate files precisely so either game could change without the other.
export function drawSplash() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  drawSplashWords();
}

/** The congratulations, and the one instruction the screen carries: touching it
 * anywhere opens the levels grid (`splashTap`).
 *
 * BOILERPLATE on purpose, and now the whole screen — the picture it used to sit
 * over is gone, so the block CENTRES rather than hugging the bottom, which was
 * only ever a way of staying clear of the art's subject.
 *
 * Everything is measured off W/H — a phone is ~390 CSS px across and a laptop
 * ~1400 — so one set of numbers serves both surfaces. */
function drawSplashWords() {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  /** Set the font to `px`, or to whatever smaller size makes `text` fit across
   * the screen with a margin. Every line here goes through it: these are three
   * centred one-liners on a canvas, which has no wrapping and no ellipsis of
   * its own, so a phone narrower than the one this was written on would
   * silently run the words off both sides (it did — the second line, at 390). */
  const fit = (text, weight, px) => {
    const face = (n) => `${weight} ${n}px ui-rounded, system-ui, sans-serif`;
    ctx.font = face(px);
    const room = W - 44, wide = ctx.measureText(text).width;
    if (wide > room) ctx.font = face(Math.max(11, px * (room / wide)));
  };

  // The middle of the screen, with the title's own line sitting just above it —
  // the three baselines below hang off this one.
  const mid = H / 2;

  ctx.fillStyle = "#ffd166";
  fit("CONGRATULATIONS!", 800, Math.min(46, W * 0.1));
  ctx.fillText("CONGRATULATIONS!", W / 2, mid - 8);

  ctx.fillStyle = "#f2ecff";
  fit("every level cleared — the plant is watered", 700, 15);
  ctx.fillText("every level cleared — the plant is watered", W / 2, mid + 24);

  // The prompt breathes, because it is the only thing to do on a screen that is
  // otherwise completely still — the same tell the band anchors use while they
  // wait to be finished.
  ctx.fillStyle = "#c9bdf0";
  ctx.globalAlpha = 0.6 + 0.4 * Math.sin(tGlobal * 2.2);
  fit("tap anywhere to pick a level", 400, 13);
  ctx.fillText("tap anywhere to pick a level", W / 2, mid + 62);
  ctx.restore();
}
