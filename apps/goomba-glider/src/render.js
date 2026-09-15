// The drawing surface, and everything drawn on it. The surface globals
// (`ctx`, `W`, `H`, the camera offset) are exported as LIVE BINDINGS: only this
// file assigns them, which lets `drawScene` point the whole renderer at a
// sheet canvas and back without a "which canvas?" parameter.

import {
  R,
  POP_R,
  BUMP_R,
  BAND_MIN,
  BAND_MAX,
  bandPoints,
} from "@escape-cats/shared";
import { cv, topEl } from "./dom";
import { S, bandInk, bandInkDark, PARTY_COLORS } from "./state";

/** The camera. A const alias onto the one in `S`: it is mutated in place
 * (`Object.assign`, `cam.x +=`), never rebound, so both names are one object. */
export const cam = S.cam;

/** `?flat` — the game with its AURAS off (the 4.4-unit terrain halo and the
 * soft discs behind can, bumper and plant), nothing else changed. A DIAGNOSTIC
 * to tell "soft pixels" from "soft art" (`?pixels` measures the first). Its
 * own flag, never folded into `?debug`, which means one thing only. */
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


/** The page scale the canvas is being stretched by, never below 1. Asked two
 * ways (`visualViewport.scale`, and the layout/visual WIDTH ratio — width,
 * never height, since a soft keyboard shortens the visual viewport); the
 * larger wins. THE FLOOR AT 1 IS LOAD-BEARING: WebKit relays out a page at
 * initial-scale=2 (scale reads 0.5 while the canvas is already right), so
 * letting it through halves the backing store. Only scaling UP is ever needed. */
function pageScale() {
  const vv = window.visualViewport;
  if (!vv) return 1;
  const byWidth = vv.width > 0 ? window.innerWidth / vv.width : 1;
  return Math.max(1, vv.scale || 1, byWidth);
}

/** Device pixels per CSS pixel: dpr × page scale, capped on the PRODUCT.
 * dpr alone misses a pinch or an in-app browser's scale — layout does not
 * change, the compositor stretches the bitmap (PLAY sharp, game soft). Engines
 * disagree on whether dpr already folds the scale in, so the product may
 * double-count; over-asking under a cap is the cheap failure, under-asking is
 * the blur. Never cap dpr first — that throws away resolution a folded-in
 * scale reported. */
const MAX_BACKING = 4;
/** iOS's ~16.7 MP canvas ceiling fails SILENTLY (valid context, every draw a
 * no-op, blank screen), so the AREA binds too, with margin. Charged only to
 * touch-capable machines, and UNKNOWN COUNTS AS TOUCH: guessing desktop wrong
 * is a blank screen at a party, guessing touch wrong costs sharpness on a
 * display nobody carries to one. Not a runtime allocation probe, because an
 * iOS allocation failure cannot be tested here. `finePointer` in state.js asks
 * a different question (a CURSOR) and is not reused. */
const MAX_AREA_TOUCH = 14e6;
/** Covers every real display at rest (a Pro Display XDR at dpr 2 is 20.4 MP)
 * while refusing an 8K panel's 132 MP. */
const MAX_AREA_DESKTOP = 64e6;
/** Read live, never latched. */
const maxArea = () =>
  ((navigator.maxTouchPoints ?? 1) > 0 || "ontouchstart" in window)
    ? MAX_AREA_TOUCH : MAX_AREA_DESKTOP;
function backingScale() {
  let s = Math.min((window.devicePixelRatio || 1) * pageScale(), MAX_BACKING);
  const area = window.innerWidth * window.innerHeight * s * s;
  const cap = maxArea();
  if (area > cap) s *= Math.sqrt(cap / area);
  // Quantised UP to eighths: `resize` keys its idempotence on this number and
  // a pinch reports a fractionally different scale every frame. UP so
  // quantisation can never under-ask; eighths because every real dpr is
  // already an exact multiple.
  return Math.ceil(s * 8) / 8;
}

// Idempotent: visualViewport's `scroll` fires continuously through a pinch,
// and reallocating the backing store is expensive and resets the 2D context.
let sizeKey = "";
export function resize() {
  const s = backingScale();
  const key = window.innerWidth + "x" + window.innerHeight + "@" + s;
  if (key === sizeKey) return;
  sizeKey = key;
  // The backing store is whole pixels, so IT is exact and the CSS box derives
  // from it — the other way round leaves a box a fraction wider than the
  // bitmap (iOS `innerWidth` is not always an integer) and the browser
  // resamples the whole canvas to close the gap.
  const bw = Math.round(window.innerWidth * s), bh = Math.round(window.innerHeight * s);
  cv.width = bw; cv.height = bh;
  W = bw / s; H = bh / s;
  cv.style.width = W + "px"; cv.style.height = H + "px";
  // W/H stay in CSS px, so every sxp/syp/cam.s number downstream is unchanged.
  ctx.setTransform(s, 0, 0, s, 0, 0);
  measureBunting();
}

/** Where the bunting hangs from: `#top`'s MEASURED bottom edge, never a
 * constant — the notch moves the bar, and the strings ride HIGHEST at the
 * edges, exactly where the plates are. Under the bar there are 24px before
 * `#hint` and the first string needs 22 (see `#hint` in styles.css). Two
 * triggers, both needed: the ResizeObserver for the bar's SIZE (it grows when
 * `syncHud` fills `#inv`, after boot), `resize()` for its POSITION (the inset
 * swapping on rotation, which an observer cannot see). */
let buntingTop = 66;
function measureBunting() {
  const r = topEl.getBoundingClientRect();
  if (r.height > 0) buntingTop = r.bottom;
}
new ResizeObserver(measureBunting).observe(topEl);

/** The self-heal, on a slow timer from frame(): asks the canvas how big it
 * actually is and re-sizes on disagreement, catching every viewport change
 * that fires no event (bfcache restore, an in-app browser settling). */
export function checkFit() {
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return;   // display:none — nothing to fit to
  // Compare against box AND scale: the scale can move under a fixed box (a
  // window dragged to a 1x monitor). Tolerance over one device pixel, or
  // layout's half-pixel snap re-allocates the store once a second forever.
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

/** CANDIDATE FIX for the blurry-on-some-loads phone: detach `#c` and put it
 * back, two rAFs after `load`. Comes OUT if the phone stays blurry, never gets
 * tuned. Measured on a blurry load: the buffer round-trips TRUE (selftest 2px)
 * while the in-canvas 4px block collapses — the layer's contentsScale is
 * decided per LOAD from a transient mid-boot state and never revisited.
 * Reassigning cv.width post-load and flipping position fixed→absolute both
 * FAILED to re-roll it; do not try them again. Reattaching rebuilds renderer,
 * layer and backing from scratch: the bitmap survives a reparent, both ops in
 * one task, back in the same place so #hud keeps painting above. */
window.addEventListener("load", () => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const parent = cv.parentNode;
    if (!parent) return;
    const next = cv.nextSibling;
    cv.remove();
    parent.insertBefore(cv, next);
  }));
});

/** Called by main.js at the END of every frame(). A hook, not its own rAF
 * loop: two self-re-arming loops have two stable interleavings, and the rack
 * lost that race on the phone (erased every frame, counter still climbing). */
export let postFrame = null;

if (new URLSearchParams(location.search).has("pixels")) {
  import("./pixelprobe.js").then((m) => m.startPixelProbe(cv, (f) => { postFrame = f; }));
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

/** Draw a scene into one of the sheet's canvases, framed to its bounds. The
 * renderer's globals ARE the parameters; the restore is in a finally because a
 * throw that left `ctx` on a sheet canvas would take the game's rendering. */
export function drawScene(el, b, body) {
  // getBoundingClientRect, not clientWidth: these boxes land on fractions of a
  // pixel, and a backing store sized off the rounded number is resampled.
  const rect = el.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  if (!w || !h) return;              // the sheet is hidden: nothing to draw into
  const dpr = backingScale();
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (el.width !== bw || el.height !== bh) { el.width = bw; el.height = bh; }
  const g = el.getContext("2d");
  // The scale the bitmap ACTUALLY has against its box: `bw` was rounded, so
  // drawing at `dpr` would shift everything against the box.
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
    const y0 = buntingTop + row * 34, sagg = 22 + row * 8, x0 = -20, x1 = W + 20;
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
    // Explicit offset: the marching-ants drawings leave one on the context,
    // and terrain that inherits it crawls.
    ctx.setLineDash([2 * cam.s, 7 * cam.s]); ctx.lineDashOffset = 0;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** One band, in the TEAM's colour — every band on the board is the same. */
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

/** A teammate's band-in-progress: translucent, marching dashes, hollow rings
 * — reads as "being dragged", never "placed". Team colour; the motion is what
 * makes it theirs, no name anywhere on this screen. */
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
  // the offset goes back with the pattern: it is context state
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  for (const [x, y] of [pts[0], pts[8]]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = 0.45 * cam.s;
    ctx.beginPath(); ctx.arc(sxp(x), syp(y), 0.9 * cam.s, 0, 6.28); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** How long an open anchor waits before it gives up. `input.js` enforces it;
 * this file draws the countdown, so the one number lives here. */
export const ANCHOR_TTL = 8000;

/** The waiting end of a tap-tap band: a pulsing ring with the instruction
 * under it, fading over its last second so a timeout is seen, not found. */
export function drawAnchor(a) {
  // Screen units, not world: a fingertip is the same size on every level.
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

/** The same waiting point from a teammate's phone: a ring alone, no
 * instruction, no name. Drawn for any preview too short to be a band
 * (GoombaBandPreview). */
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

/** The watering can. `ping` (0..1) is the locked-goal flare's ring: she
 * touched the plant and this can is why nothing happened. Gold like the can
 * and the 💧N badge — one colour saying one thing — and drawn from the RESTING
 * centre, outside the bob, so a row reads as a set. */
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

// The goal: the spider plant. Thirsty, the blades hang limp and dull; with the
// last can in, the fountain arches up bright — the badge only re-tells that.
// [dir, reach, rise, drop, width] per blade; drop + is BELOW the crown (the
// outer blades spill over the rim).
const SPIDER_BLADES = [
  [-1, 5.2, 2.4, 3.6, 0.7], [1, 5.4, 2.2, 3.9, 0.7],
  [-1, 4.4, 4.2, 1.7, 0.78], [1, 4.6, 4.0, 2.0, 0.78],
  [-1, 3.2, 6.0, -0.4, 0.85], [1, 3.4, 5.7, -0.2, 0.85],
  [-1, 1.6, 7.4, -3.4, 0.7], [1, 1.9, 7.0, -3.0, 0.7],
  [1, 0.5, 5.8, -5.4, 0.6],
];
const CROWN_Y = -3.4;   // the crown sits just ABOVE the pot rim, so the blades
                        // drape in front of it instead of being sliced by it
// `goal` is the point the sim tests; the pot is drawn POT_DROP below it and
// the glow is centred GLOW_Y above the pot's origin.
const POT_DROP = 2, GLOW_Y = -3.5;
/** The middle of the plant's INK, in world units — nowhere near `goal`.
 * Exported so the how-to sheet aims its arrow at it without a second copy. */
export const goalMid = (lv) => [lv.goal[0], lv.goal[1] + POT_DROP + GLOW_Y];

// The badge's two inks: mint at rest, gold at the top of a flare. Interpolated,
// because a hard swap reads as a different badge.
const BADGE_MINT = [87, 230, 201], BADGE_GOLD = [255, 209, 102];
const badgeInk = (k) =>
  `rgb(${BADGE_MINT.map((v, i) => Math.round(v + (BADGE_GOLD[i] - v) * k)).join(",")})`;

/** `fx` (0..1) is the locked-goal flare (in the goal circle, cans still out):
 * the plant shivers and droops further, the 💧N badge pops and warms to gold —
 * accents of what it was already saying. The rings off the cans are drawCan's. */
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
// THE FINALE, and the end of the game: clearing the last level lands the room
// here (`GoombaSim.resolve`) on the frame Goomba reaches the plant, and nothing
// takes it back. No control, no tap, no key — the ways off are a proctor reset
// and a pack edit, both of them the room's, not this screen's. So the screen is
// two things and no instruction: the PICTURE, and the CODE WORD the party
// carries out of the game and reads to the proctor.
//
// The picture is this app's ONE image asset — `public/art/goomba-splash.webp`,
// reached through BASE_URL like hex's splash, which is right in dev and in the
// built bundle both. It FILLS the screen — scaled on whichever axis leaves it
// short and cropped on the other, so the finale is the picture and nothing
// else. The crop is spent OFF THE RIGHT: the fridge, the plant and the cat
// with its cucumber all live in the left two thirds, and the right is the far
// end of the window and a jug. See `artBox`.
//
// The wash behind it is still the picture's own edge rows, and still the thing
// that makes a missing file a warm dark screen rather than a blank one — but
// on a phone it is only ever seen through the fade-in, because the picture
// covers it. Replace the file and both come with it.

const SPLASH_ART = "art/goomba-splash.webp";
/** The two things this screen says, in this order. The code word is the one
 * string this screen exists for.
 *
 * The cheer used to read "All levels cleared!" and that stopped being true the
 * day there were POST-CREDITS levels behind the ending — five of them, all
 * untouched, at the moment it pops on. It says the GAME is over, which is what
 * it always meant. One string, true with a bonus section or without. */
const CHEER = "You beat the game!";
const CODE_WORD = "vegetaricat";
const CODE_LABEL = "CODE WORD";

let splashImg = null;
/** The picture's own edge, sampled top to bottom. The fallback is a warm dark
 * that reads as "kitchen at dinnertime" rather than as a missing asset. */
let splashWash = ["#2b1a10", "#17100c"];

/**
 * Ask for the picture ONCE, at an idle moment during the party. It cannot be
 * on screen until the room clears the game, but when that lands it lands with
 * no warning — a run ends and the finale is already up — so it may not be
 * fetched then. Idle-time preload is hex's trick, for the same reason.
 */
export function preloadSplashArt() {
  if (splashImg) return;
  const load = () => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => { splashWash = washStops(img); };
    img.src = import.meta.env.BASE_URL + SPLASH_ART;
    splashImg = img;
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(load, { timeout: 5000 });
  else setTimeout(load, 1000);
}

/** The art's own SIDE EDGE, sampled down its height into n colours — the
 * backdrop to continue the picture with in every direction. This is hex's
 * `skyStops` (phase.js) doing hex's job here; the two clients share rules
 * through `packages/shared`, never drawing, so it is copied rather than
 * imported. The EDGE strip, not a full row (the middle of the picture is a
 * cat), and each stop is one exact row, so the first and last are the
 * picture's true top and bottom. Under a cover fit this is the fade-in's
 * backdrop and the missing-file screen, not a band around the art. */
const WASH_STOPS = 24;
function washStops(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return splashWash;
  const c = document.createElement("canvas");
  c.width = 2; c.height = WASH_STOPS;
  const g = c.getContext("2d", { willReadFrequently: true });
  const edge = Math.max(1, Math.round(w * 0.02)); // wide enough to average the grain out
  for (let i = 0; i < WASH_STOPS; i++) {
    const y = Math.round((i / (WASH_STOPS - 1)) * (h - 1));
    g.drawImage(img, 0, y, edge, 1, 0, i, 1, 1);
    g.drawImage(img, w - edge, y, edge, 1, 1, i, 1, 1);
  }
  const d = g.getImageData(0, 0, 2, WASH_STOPS).data;
  const mid = (a, b) => (d[a] + d[b]) >> 1; // the two sides, averaged into one ramp
  return Array.from({ length: WASH_STOPS }, (_, i) => {
    const l = i * 8, r = l + 4;
    return `rgb(${mid(l, r)},${mid(l + 1, r + 1)},${mid(l + 2, r + 2)})`;
  });
}

// The finale's choreography, in seconds off the splash's own clock (`t`,
// stamped in main.js when the phase lands — never tGlobal, or a phone that
// joins a finished room would arrive mid-animation). THE ORDER IS THE POINT:
// the picture, then WELL DONE, and only then the thing they have to carry out
// of the room. A party that gets the code word first stops looking at the rest.
const ART_IN = 0.45;     // the picture washing in over the backdrop
const CHEER_AT = 0.55;   // the cheer, popped on at the top
const CHEER_IN = 0.4;
const WORD_AT = 1.5;     // ...and the code word, a beat later, at the bottom
const WORD_RISE = 0.55;
/** LAST, and only when there are post-credits levels: the way out. Late on
 * purpose — the word has been up for over a second by now, so this cannot be
 * the thing anyone reads first, and a tap cannot dismiss the word before it
 * has been read (`splashMoreReady` gates the tap on the same clock). */
const MORE_AT = 3.2;
const MORE_IN = 0.5;

/** Is the finale's way-out showing yet? The tap that opens the levels grid
 * asks this, so the screen and the gesture agree to the frame. */
export const splashMoreReady = (t) => t >= MORE_AT;

/**
 * Where the picture sits: FILLING the screen, pinned to its LEFT edge. Null
 * until there is a picture to place.
 *
 * `Math.max` is the cover fit — the axis that would leave slack sets the
 * scale, and the other one overflows. Every phone is narrower than the art's
 * 0.695, so height binds there and the whole overflow is horizontal; a
 * landscape screen binds the other way and loses top and bottom instead.
 *
 * `x` is 0, not centred, and that is the point: the overflow comes off the
 * RIGHT, where the picture keeps the least. `y` stays centred — there is no
 * side of the art worth saving over the other one vertically.
 */
function artBox() {
  const img = splashImg;
  if (!img || !img.complete || !img.naturalWidth) return null;
  const fit = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const w = img.naturalWidth * fit, h = img.naturalHeight * fit;
  return { img, x: 0, y: (H - h) / 2, w, h };
}

/** The whole finale: backdrop, picture, code word. `t` is seconds since the
 * room landed on the splash. */
export function drawSplash(t, more) {
  const box = artBox();
  // The ramp spans the PICTURE, not the screen, so every stop lines up with
  // the row it was taken from — including when the picture runs off the top
  // and bottom, where a canvas gradient simply clamps.
  const y0 = box ? box.y : 0, y1 = box ? box.y + box.h : H;
  const wash = ctx.createLinearGradient(0, y0, 0, Math.max(y0 + 1, y1));
  const n = splashWash.length;
  splashWash.forEach((c, i) => wash.addColorStop(i / (n - 1), c));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
  drawSplashArt(box, t);
  drawCheer(t);
  const wordTop = drawCodeWord(t);
  if (more) drawMore(t, wordTop);
}

/**
 * "There is more" — a quiet line resting just above the code word's plate.
 *
 * No plate of its own: the two plates are the finale's voice and this is an
 * aside. It sits ABOVE the word rather than below because the word's plate
 * rests one margin off the bottom edge and there is nothing under it; the
 * reading order is carried by TIME instead (MORE_AT), which holds even for a
 * phone that loads straight onto the splash, since the beats replay from zero
 * on every boot.
 */
function drawMore(t, wordTop) {
  const p = clamp01((t - MORE_AT) / MORE_IN);
  if (p <= 0 || wordTop === null) return;
  const px = Math.max(11, Math.min(15, Math.min(W - 32, 460) * 0.036));
  const label = "tap for more levels";
  ctx.save();
  ctx.globalAlpha = p;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${px}px ui-rounded, system-ui, sans-serif`;
  // On its own PILL. Bare text was unreadable: the picture behind it is a
  // bright kitchen, and the splash's ink is the plates' pale lilac, which only
  // works on the plates' dark ground. Smaller and unstroked so it still reads
  // as an aside rather than a third plate.
  const padX = px * 0.85, padY = px * 0.5;
  const boxW = ctx.measureText(label).width + padX * 2;
  const boxH = px + padY * 2;
  const y = wordTop - px * 0.8 - boxH;
  ctx.shadowColor = "rgba(0,0,0,.45)";
  ctx.shadowBlur = 16; ctx.shadowOffsetY = 5;
  ctx.fillStyle = "rgba(20,10,45,.88)";
  ctx.beginPath(); ctx.roundRect((W - boxW) / 2, y, boxW, boxH, boxH / 2); ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.fillStyle = "#c9bdf0";
  ctx.fillText(label, W / 2, y + padY + px * 0.82);
  ctx.restore();
}

/** The picture, arriving with a short fade and a push-in — the run cuts to
 * this on one frame, and a hard cut reads as a glitch. */
function drawSplashArt(box, t) {
  if (!box) return;
  const p = clamp01(t / ART_IN);
  const e = p * p * (3 - 2 * p);                        // smoothstep
  const push = 1 + 0.045 * (1 - e);
  const w = box.w * push, h = box.h * push;
  ctx.save();
  ctx.globalAlpha = e;
  // The push grows about the SAME anchor `artBox` settles on — left edge,
  // vertical centre — or the picture would slide sideways as it lands.
  ctx.drawImage(box.img, box.x, box.y - (h - box.h) / 2, w, h);
  ctx.restore();
}

/**
 * WELL DONE, first: the one line that says the game is over, on the same plate
 * family as the code word so the two read as one voice. It POPS rather than
 * rises — the toast's own arrival (`#toast.show` in styles.css), because this
 * is the game talking about what just happened, not a thing being handed over.
 */
function drawCheer(t) {
  const p = clamp01((t - CHEER_AT) / CHEER_IN);
  if (p <= 0) return;
  // Overshoot and settle: the same shape as the toast's scale(.9) → scale(1).
  const e = 1 - Math.pow(1 - p, 3);
  const scale = 0.9 + 0.1 * e + Math.sin(Math.PI * e) * 0.05;

  const px = Math.max(16, Math.min(30, Math.min(W - 40, 460) * 0.085));
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 ${px}px ui-rounded, system-ui, sans-serif`;
  const w = Math.min(W - 24, ctx.measureText(CHEER).width + px * 1.8);
  const h = px * 2.2;
  const y = Math.max(20, H * 0.05);
  ctx.globalAlpha = Math.min(1, p * 1.8);
  // Scaled about its own centre, so the pop does not walk across the screen.
  ctx.translate(W / 2, y + h / 2);
  ctx.scale(scale, scale);
  ctx.translate(-W / 2, -(y + h / 2));
  plate(-1, (W - w) / 2, y, w, h);
  ctx.fillStyle = "#ffe9b3";
  ctx.fillText(CHEER, W / 2, y + h / 2 + px * 0.36);
  ctx.restore();
}

/**
 * The code word, on a plate that RISES into the bottom of the picture once the
 * picture is there. The plate is the toast's chrome (#toast in styles.css) —
 * the one plate this app already uses to say something out loud — so the word
 * reads as the game talking, not as part of the illustration.
 */
/** Draws the code word and returns the TOP of its plate, so the way-out line
 * can rest above it without a second copy of this geometry. Null before it
 * starts to rise. */
function drawCodeWord(t) {
  const p = clamp01((t - WORD_AT) / WORD_RISE);
  if (p <= 0) return null;
  const e = 1 - Math.pow(1 - p, 3);   // out-cubic: up quickly, land softly

  const room = Math.min(W - 32, 460);
  const wordPx = Math.max(16, Math.min(34, room * 0.095));
  const labelPx = Math.max(10, wordPx * 0.4);
  const face = (weight, px) => `${weight} ${px}px ui-rounded, system-ui, sans-serif`;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = face(800, labelPx);
  const labelW = ctx.measureText(CODE_LABEL).width;
  ctx.font = face(800, wordPx);
  const wordW = ctx.measureText(CODE_WORD).width;

  const padX = wordPx * 0.9, padY = wordPx * 0.62, gap = wordPx * 0.5;
  const boxW = Math.min(W - 24, Math.max(labelW, wordW) + padX * 2);
  const boxH = padY * 2 + labelPx + gap + wordPx;
  const x = (W - boxW) / 2;
  // It comes to rest one margin above the bottom edge, and starts a box-height
  // below that — off the bottom of the screen on any size.
  const restY = H - Math.max(24, H * 0.06) - boxH;
  const y = restY + (1 - e) * (boxH + Math.max(24, H * 0.06));

  ctx.globalAlpha = Math.min(1, p * 1.6);
  plate(-1, x, y, boxW, boxH);

  ctx.fillStyle = "#c9bdf0";
  ctx.font = face(800, labelPx);
  ctx.fillText(CODE_LABEL, W / 2, y + padY + labelPx);
  ctx.fillStyle = "#ffe9b3";
  ctx.font = face(800, wordPx);
  ctx.fillText(CODE_WORD, W / 2, y + padY + labelPx + gap + wordPx * 0.82);
  ctx.restore();
  return y;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The finale's plate — the toast's chrome (#toast in styles.css), which is
 * this app's one way of saying something out loud. `r` < 0 rounds by height.
 * Leaves the shadow off again, and the alpha alone: the caller is mid-fade. */
function plate(r, x, y, w, h) {
  const rad = r < 0 ? Math.min(18, h * 0.28) : r;
  ctx.shadowColor = "rgba(0,0,0,.5)";
  ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
  ctx.fillStyle = "rgba(20,10,45,.92)";
  ctx.beginPath(); ctx.roundRect(x, y, w, h, rad); ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, rad); ctx.stroke();
}
