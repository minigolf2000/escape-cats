// Goomba Glider, multiplayer client. The rendering and input are the
// prototype's (prototypes/goomba-rider.html), ported nearly verbatim; what
// changed is who owns the state. The room server owns the bands, the level,
// the phase and the score; this file renders snapshots and sends intents —
// the same seam hex-clicker has.
//
// A run is animated LOCALLY: the server scores it the instant PLAY lands
// (deterministic physics), and every phone steps the same shared sim against
// the server's runAt timestamp — so all four screens watch the same ride, and
// the ending the animation reaches is the ending the server already banked.

import {
  GOOMBA_LEVELS,
  MAX_BANDS,
  BAND_MIN,
  BAND_MAX,
  R,
  SUB,
  POP_R,
  BUMP_R,
  makeRun,
  stepRun,
  snapBand,
  bandPoints,
  canPlaceBand,
  earsFor,
  goombaCleared,
  nextLeadsToSplash,
  applyPack,
  encodeLevel,
  initLevel,
  levelLabel,
  PACK_MAX,
} from "@escape-cats/shared";
import { connectRoom, watchTeam, transport, playerId } from "./net";
import { adoptHashLevel, debugFromUrl, soloFromUrl, startDebug } from "./debug";
import { levelFromPaste } from "./figma/paste.js";

const cv = document.getElementById("c");
// `let`, not `const`: every draw below reaches for this one context and this
// one W/H, which is exactly what lets the how-to-play sheet borrow the whole
// renderer for its little canvases (drawScene, near boot) without any of it
// growing a "which canvas?" parameter. Swapped synchronously and put back in a
// finally, so nothing else can ever observe it pointed elsewhere.
let ctx = cv.getContext("2d");
let W = 0, H = 0;

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
 * ceiling. It only ever bites zoomed-in on the biggest screens; at rest the
 * largest board (iPad 12.9 at dpr 2) is 5.6 MP, nowhere near it. */
const MAX_AREA = 14e6;
function backingScale() {
  let s = Math.min((window.devicePixelRatio || 1) * pageScale(), MAX_BACKING);
  const area = window.innerWidth * window.innerHeight * s * s;
  if (area > MAX_AREA) s *= Math.sqrt(MAX_AREA / area);
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
function resize() {
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
function checkFit() {
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

// Kiosk lockdown, same as hex: no long-press menu, no browser pan under a
// finger. Buttons opt out via the selector.
window.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener(
  "touchstart",
  (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest("button, a")) return;
    e.preventDefault();
  },
  { capture: true, passive: false },
);

// ---------- state: the snapshot mirror + local presentation ----------
// The party palette: confetti, the ambient drift, the bunting across the top.
// DECOR, and nothing else — it used to double as "one colour per roster slot",
// which is the job the team colour has taken over (see bandInk below).
const PARTY_COLORS = ["#ff5db1", "#57e6c9", "#ffd166", "#b18bff"];

// ---------- the team's colour ----------
// A band belongs to the ROOM, not to whoever laid it, so every band on the
// board wears one colour: the TEAM's. That is the same ink the proctor's board
// paints a team's box in and the same ink as the cat-ear headband on the table
// (TEAM_EARS in shared/ears.ts) — so "we're the teal team" is one fact a player
// can read off their own screen, the proctor's screen, and their own head.
//
// A team id doubles as its room id, so `onTeam` below already knows it.
let myTeam = null;
/** The testing room (t0) is not a team and has no headband — `earsFor` says so
 * by returning null — and ?solo has no lobby at all. Both fall back to the pink
 * the bands wore back when a band's colour meant a roster slot. */
const NO_TEAM_INK = "#ff5db1";
const bandInk = () => earsFor(myTeam)?.ink ?? NO_TEAM_INK;
/** The darker under-stroke a band is drawn with. Derived rather than tabled:
 * the ears carry one ink per team, and a second hand-picked shade per team is
 * a thing to keep in sync for no gain. 0.72 is where the old hand-picked pairs
 * sat (#ff5db1 → #c23a85 and friends). */
const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
  return "#" + ch.map((v) => v.toString(16).padStart(2, "0")).join("");
};
let inkShade = { ink: null, dark: NO_TEAM_INK };
const bandInkDark = () => {
  const ink = bandInk();
  if (inkShade.ink !== ink) inkShade = { ink, dark: shade(ink, 0.72) };
  return inkShade.dark;
};
// Run zoom only: the edit view sits at fitScale so the WHOLE level is on
// screen. Nothing pans any more, so every point a band can reach has to be
// reachable by a finger without moving the camera.
const RZ = 1.9;

const DEBUG = debugFromUrl(); // selector override (?debug = your room, ?solo = local)
const SOLO = soloFromUrl();   // serverless backend for the same menu
// LAPTOP OR PHONE — one switch, two different level grids.
//
// The grid is two surfaces wearing one screen, and they want opposite things
// from a tap. On a phone it is the free-play menu a cleared team earned: one
// tap, the whole room goes there, and nothing else is on it — four people at a
// party are not reordering a pack with their thumbs, and the controls that
// would let them are the size of the cards they sit on. On a laptop it is a
// file browser, because that is the machine a pack is actually edited from
// (Ctrl+V needs a keyboard): click selects, double-click plays, drag reorders.
//
// `(hover: hover) and (pointer: fine)` is the standard reading of "there is a
// real cursor here", and it is read LIVE rather than latched at boot, so a
// tablet that gains a trackpad mid-party gets the editor without a reload.
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
const DESKTOP = () => finePointer.matches;
// Read the same way, and for the same reason: a phone can change this setting
// while the sheet is on the screen. It stops the one piece of motion here that
// TRAVELS — Goomba crossing the title — and leaves the rest of the sheet alone.
const calmMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const REDUCED = () => calmMotion.matches;
// WHO GETS THE LEVEL SELECTOR: a team that has CLEARED the game. That is room
// state off the snapshot (goombaCleared = every level done), so all four phones
// unlock on the same message and a proctor reset takes it back with everything
// else. `?debug` is nothing more than a local override of this one gate — it
// puts a tester in the state a cleared room is already in, instead of being a
// second way in with its own rules.
// `editing` is in here because that is what "\ turns on debug mode" MEANS:
// the one thing ?debug does is override this gate, so the key that opens the
// editor gets the same override rather than a second switch beside it.
const levelSelect = () => DEBUG || editing || (snap !== null && goombaCleared(snap));
let labOpen = false;        // levels grid showing?
// A card tap is a wire intent, so the room answers a round trip later. Closing
// the lab on the tap would uncover the OLD level for that gap and then swap it
// under the player — so the tap only LATCHES, and the lab stays up until the
// authority's snapshot lands on the chosen level. The timeout is the escape
// hatch for an intent the room never echoes (dropped socket, proctor seat).
let labJump = null;         // { level, timer } — tapped, awaiting the authority
const LAB_JUMP_MS = 1500;
function setLab(open) {
  labOpen = open;
  hudEl.classList.toggle("lab", open);
  // Everything the grid was in the middle of goes with it: a latched card tap
  // can pull the grid out from under a drag, and a drag with no cards under it
  // has nothing left to mean.
  if (!open) { clearLabJump(); labDrag = null; }
}
function clearLabJump() {
  if (labJump) clearTimeout(labJump.timer);
  labJump = null;
}
let labCells = [];          // hit targets for the lab's cards
let labBtns = [];           // hit targets for the per-card editor buttons

// ---------- the selector IS the editor ----------
// There is no separate editor page any more. The levels grid a cleared team
// earns is the same screen that edits the event's pack — because everything
// either surface ever wanted to show is the same thing: every level as a card.
// `\` is the way in and the way back out, and it turns the selector on the way
// a cleared room already has it (see `levelSelect`), so one key gets a laptop
// from playing to editing and back.
//
// The EDITING controls are the only part that is laptop-only: pasting needs a
// keyboard, and reordering a pack is nobody's phone job during a party. Phones
// see exactly the grid they saw before — see DESKTOP above.
let editing = false;
/**
 * Are the editing controls showing? (Not to be confused with `canEdit` further
 * down, which is about the run PHASE — whether a band may be placed right now.)
 *
 * `\` turns them on — but an EMPTY pack turns them on too, because a grid with
 * no levels and no way to add one is a dead end, and "there are no levels" is
 * exactly the moment someone needs to paste one. It is also the only way back
 * from a pack that was emptied by accident, without a redeploy.
 *
 * Both clauses are under DESKTOP, the empty one included: the dead end it
 * rescues is a dead end for the machine that can actually paste, and a phone
 * handed a `⌫` it has no keyboard to follow up on is not rescued from
 * anything — it is just a menu with a button that leads nowhere.
 */
const editorOn = () => DESKTOP() && (editing || GOOMBA_LEVELS.length === 0);

// ---------- selection: the laptop's half of the grid ----------
// One card is selected at a time, the way a file browser does it, and that
// selection is what a paste lands on: an index REPLACES that level, `null`
// means the trailing dashed slot and APPENDS. It used to take a button (`⧉`)
// to aim a paste; a selection is the same aim with no button and no second
// idea of "current" on the screen. That button is gone entirely now.
let selected = null;
/** A card being dragged to a new slot. `gap` is an insertion point (0..n), not
 * a card index — "between these two" is what a drop actually means. */
let labDrag = null;
/** The press was consumed by a dialog or a button, so its release must not
 * also count as a click on the card underneath. */
let labDownHandled = false;
/** Hand-rolled double-click, because a tap-to-play on a touchscreen laptop
 * never gets a synthesised `dblclick` — touchstart is preventDefault'd here. */
let lastLabClick = { i: -1, t: 0 };
const DBL_MS = 420;
/**
 * The one question this file asks, and it is the BROWSER's. It guards the two
 * edits that cannot be taken back — a delete, and a paste over a level it does
 * not look like.
 *
 * It used to be drawn on the canvas, with hand-laid buttons, its own Enter/Esc
 * branch in the keydown handler and its own swallow-everything branch in the
 * grid's hit test. That was a dialog only the grid could ask, and a paste now
 * lands while the grid is SHUT (see the paste handler) — so the question has
 * to be askable when there is no grid to draw it on. `confirm()` is that, for
 * free, and it blocks: the answer is back before this returns, so nothing here
 * has to hold a callback open across frames.
 */
function askConfirm(title, body, onYes) {
  if (window.confirm(body ? `${title}\n\n${body}` : title)) onYes();
}
let editMsg = "", editMsgT = 0;
function editSay(msg) { editMsg = msg; editMsgT = 4; }
/**
 * Everything a paste has to say. `editSay` is the line under the grid's title,
 * which is no use to a paste that landed while the grid was shut — so when it
 * is, the game's own toast carries the same words. Without it, a paste over
 * the level you are playing is silent unless the geometry happens to move
 * somewhere you were looking, and "did that work?" is the one thing this loop
 * must never make you guess.
 */
function pasteSay(msg) {
  editSay(msg);
  if (!labOpen) toast(msg, 2600);
}

/** Re-frame the camera on the current level. Called when the level changes and
 * whenever the PACK changes under us, since a new level has new bounds. */
function refit() {
  const b = L().bounds;
  Object.assign(cam, clampCam((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, fitScale(L()), b));
}

/**
 * The event's levels arrived (on connect, and again after any edit).
 *
 * `applyPack` writes into the same `GOOMBA_LEVELS` array every rule already
 * reads, so nothing downstream has to know the levels can change. What DOES
 * have to know is this file's one cache: the camera, which is framed on a level
 * whose geometry may have just been replaced under it.
 */
function onPack(pack) {
  applyPack(pack);
  if (selected !== null && selected >= GOOMBA_LEVELS.length) selected = null;
  // A drag names a SLOT, and the pack just renumbered its slots — including,
  // quite possibly, by the very edit it was about to make. It cannot be
  // re-aimed honestly, so it is dropped.
  labDrag = null;
  anim = null; // a replay of geometry that may no longer exist
  if (snap) { refit(); syncHud(); }
}

let snap = null;            // latest GoombaSnapshot — the authority's word
let serverOffset = 0;       // serverTime - Date.now(), from the last snapshot
let shownPhase = "edit";    // what the presentation last acted on (edge detection)
let shownLevel = -1;
let shownRunId = 0;

let anim = null;            // { key, st } — the local replay of the scored run
let winFx = false;          // confetti fired for the current win
// The locked-goal flare: when she reaches the plant with cans still out, the
// state the plant is ALREADY wearing gets accented for four tenths of a second.
// Only two numbers of state, and both are local presentation — nothing here is
// on the wire and nothing here is in physics.ts, because passing over the goal
// on the way to somewhere else is legitimate level design — so this may never
// block, bounce or delay her, only say something while she goes by.
let lockT = -9;             // st.t of the last crossing into the goal circle
let lockArmed = false;      // inside it now? — so one pass fires once
let preview = null;         // band being stretched right now, local only
let pending = null;         // optimistic ghost: sent to the server, not yet echoed
let anchor = null;          // first tap of a tap-tap placement, awaiting its end
let tGlobal = 0, toastT = 0, shake = 0;
let cam = { x: 0, y: 0, s: 10 };
let parts = [], confetti = [], cushAnim = [], popPrev = null;

const $ = (id) => document.getElementById(id);
const hudEl = $("hud");
const hintEl = $("hint"), dotsEl = $("dots"), invEl = $("inv"),
  playBtn = $("play"), clearBtn = $("clear"), toastEl = $("toast"),
  labEl = $("lab"),
  gateEl = $("gate"), gateStatusEl = $("gateStatus"), gateErrEl = $("gateErr"),
  gateCloseEl = $("gateClose"),
  helpEl = $("help"), scGoalEl = $("scGoal"),
  scTitleEl = $("scTitle"), scDragEl = $("scDrag"), scLiftEl = $("scLift"),
  titleH1El = document.querySelector("#gate h1"),
  connEl = $("conn");

const level = () => (snap ? snap.level : 0);
/**
 * A level to draw when the pack is EMPTY.
 *
 * There are no built-in levels any more — the pack lives in the lobby and
 * arrives over the room socket — so "we have not been told any levels yet" and
 * "someone deleted the last one" are both real states this screen has to be
 * able to paint. A flat floor with the start on it keeps every measurement in
 * here finite (bounds, fitScale, the camera clamp) instead of scattering
 * null checks through the renderer.
 */
const NO_LEVELS = initLevel({
  name: "no levels yet — press \ and paste one from Figma",
  budget: 4,
  start: [20, 20],
  goal: [80, 20],
  terrain: [[[0, 30], [100, 30]]],
  cans: [], cushions: [], pops: [], bumpers: [],
});
const L = () => GOOMBA_LEVELS[level()] ?? NO_LEVELS;
const bands = () => (snap ? snap.bands : []);
const now = () => Date.now() + serverOffset; // the room's shared clock

// ---------- the 4 bands ----------
// Four bands for the room, and no per-player share of them any more: anyone may
// lay any of the four and take any of them back. So the only question left is
// whether one is free, and it is asked with the authority's own predicate so
// the gesture is refused BEFORE it goes on the wire — a tap that silently does
// nothing reads as a broken screen.
//
// `pending` (my optimistic ghost, already sent) counts as placed: without it a
// fast double-tap on the last free band sends a second one that the room throws
// away, and the phone shows a band that then vanishes.
const bandsOut = () => bands().length + (pending ? 1 : 0);
const iMayPlace = () => canPlaceBand(pending ? [...bands(), pending] : bands());

const FAIL_MSG = {
  fall: "Goomba fell! 🙀", left: "she rolled away! 🙀", flew: "overshot the party! 🙀",
  stall: "ran out of zoom… 😿", loop: "she’s stuck! try different bands 😹",
  timeout: "she’s stuck! try different bands 😹",
};

function toast(msg, ms) {
  toastEl.textContent = msg; toastEl.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("show"), ms || 1400);
}

// ---------- snapshot wiring ----------
let inited = false;

function onSnapshot(s) {
  serverOffset = s.serverTime - Date.now();
  const first = !inited;
  const levelChanged = s.level !== shownLevel;
  const wasReset = s.runId !== shownRunId;
  // Crossing into or out of the splash is fresh footing as much as a level
  // change is: leaving it via a `goto` can land on the SAME level it was
  // covering (the finale), which no other signal here would notice — and that
  // would leave the finale's confetti and its finished run replay on screen.
  const splashEdge = (s.phase === "splash") !== (shownPhase === "splash");
  snap = s;
  pending = null; // whatever we sent, the authority has now spoken

  // The latched card tap resolves here — on the goto's exact signature (that
  // level, fresh edit phase, no bands), so a snapshot merely in flight when we
  // tapped doesn't drop the grid early. Closing now, in the same handler that
  // recenters the camera below, means the first frame without the lab is
  // already the new level, framed: no gap for the old one to show through.
  if (labJump && s.level === labJump.level && s.phase === "edit" && !s.bands.length)
    setLab(false);

  if (first) {
    inited = true;
    // The room is live, so the sheet stops waiting and starts asking: it is
    // now dismissible, and the player is the one who dismisses it. Unless the
    // GRID is already open — `?solo` and a pasted level both land there — in
    // which case the sheet has nowhere to sit: `#hud.lab > *` hides it, so
    // arming it would only leave an invisible sheet swallowing the next key.
    if (labOpen) closeSheet(false);
    else armSheet();
    requestAnimationFrame(frame);
  }
  if (s.phase !== "edit") resetInput(); // a run kills any half-drawn band

  if (first || wasReset || levelChanged || splashEdge) {
    // Fresh footing: recenter the camera, drop run debris.
    const b = L().bounds;
    Object.assign(cam, clampCam((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, fitScale(L()), b));
    resetInput();
    anim = null; winFx = false; parts = []; confetti = [];
    lockT = -9; lockArmed = false;
    cushAnim = L().cushions.map(() => 0); popPrev = null;
    shownRunId = s.runId; shownLevel = s.level; shownPhase = s.phase;
    if (wasReset && !first) toast("fresh start! 🧽", 1400);
    else if (levelChanged && !first) toast(levelLabel(s.level, L().name), 1400);
    syncHud();
    return;
  }

  // Phase edges. run→edit is a scored FAIL (wins go run→win) — but only when
  // `runResult` survived the edge. STOP takes the same edge and clears it,
  // because an abort is nobody's failure and has nothing to shake or say.
  if (shownPhase === "run" && s.phase === "edit" && s.runResult) {
    shake = 1;
    toast(FAIL_MSG[s.runResult] || "try again!");
    anim = null;
  }
  if (s.phase !== "run" && s.phase !== "win") anim = anim && null;
  shownPhase = s.phase;
  syncHud();
}

function syncHud() {
  const s = snap; if (!s) return;
  const done = s.completed.filter(Boolean).length;
  // The level's own name is deliberately off the HUD now — only the win
  // banner ever occupies this line; editing and running say nothing.
  hintEl.textContent =
    s.phase === "win"
      ? (done === s.levelCount ? "ALL LEVELS CLEAR! 🎉🪴" : "LEVEL CLEAR! 🎉")
      : "";

  // Both of these are room state, so they are re-read every snapshot: the
  // selector arrives when the team clears the game and leaves on a reset, and
  // the splash is a phase like any other.
  hudEl.classList.toggle("cleared", levelSelect());
  hudEl.classList.toggle("splash", s.phase === "splash");
  // `editing` is JS-only state (set by the `\` key, the paste handler, and an
  // empty pack via editorOn) with no snapshot behind it, so it needs its own
  // sync point rather than riding this function's `s`-driven toggles above —
  // this is just the one place already re-run on every UI-relevant change.
  hudEl.classList.toggle("editing", editorOn());

  dotsEl.innerHTML = "";
  s.completed.forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "dot" + (i === s.level ? " cur" : c ? " done" : "");
    dotsEl.appendChild(d);
  });

  // The 4 band slots — the room's whole budget, in the team's colour. Every
  // one of them is the same colour now, because every one of them is anybody's
  // to lay: the row says "two of the four are out", which is the only thing
  // left to say about them. An empty slot during edit is lit rather than faded,
  // since an empty slot is one I may fill — there is no share of them to be
  // outside of any more.
  const ink = bandInk();
  invEl.innerHTML = "";
  for (let i = 0; i < MAX_BANDS; i++) {
    const el = document.createElement("div");
    const bd = s.bands[i];
    const open = !bd && s.phase === "edit";
    el.className = "band" + (bd ? " used" : open ? " open" : "");
    // Inline, because only the client knows which team it is on. A slot that is
    // neither filled nor fillable (mid-run) keeps the faded dashes from CSS.
    if (bd || open) el.style.borderColor = ink;
    if (bd) el.style.background = ink + "33";
    invEl.appendChild(el);
  }

  // On the finale of a cleared room NEXT is the curtain call, not another
  // level — nextLeadsToSplash is the sim's own predicate for that transition,
  // so the label cannot disagree with where the button actually goes.
  playBtn.textContent =
    s.phase === "run" ? "■ STOP" :
    s.phase === "win" ? (nextLeadsToSplash(s) ? "FINISH ▸" : "NEXT ▸") : "▶ PLAY";
  playBtn.className = s.phase === "run" ? "stop" : s.phase === "win" ? "next" : "";
  // CLEAR only turns invisible, never `display:none` — the same discipline the
  // band slots keep. Nothing depends on its box (it is absolute, on its own
  // line under the slots), but a control that flickered in and out of the flow
  // is the kind of thing this row has been burned by.
  clearBtn.classList.toggle("hide", !(s.phase === "edit" && s.bands.length));
}

playBtn.onclick = () => {
  if (!snap) return;
  if (snap.phase === "edit") transport.send({ type: "play" });
  else if (snap.phase === "run") transport.send({ type: "stop" });
  else if (snap.phase === "win") transport.send({ type: "next" });
};
// One tap wipes, no confirm — and it wipes the ROOM's bands, teammates'
// included (`clear` in goomba/sim.ts), from the corner of the screen a thumb
// has to stretch for. That is a deliberate trade: the four players are in one
// living room, so a clear nobody wanted is answered out loud in a second and
// the bands go back down, whereas a confirm step would tax every deliberate
// tap to insure against the rare stray one. No toast either: four bands
// vanishing off the board IS the feedback, and the only phone a local toast
// could reach is the one that already knows.
clearBtn.onclick = () => { resetInput(); transport.send({ type: "clear" }); };
/** Open the levels grid. Two things reach it — the dot strip's plate, and a tap
 * anywhere on the congratulations screen (`splashTap`) — so the gate and the
 * "stop whatever is running first" live in one place and cannot disagree. */
function openSelector() {
  if (!levelSelect()) return; // an indicator until the team clears the game
  if (snap && snap.phase === "run") transport.send({ type: "stop" });
  setLab(true);
}
labEl.onclick = openSelector;
window.addEventListener("keydown", (e) => {
  // The help sheet owns the keyboard while it is up: Space behind it would
  // launch a run nobody on this screen can see. Any key dismisses it — there is
  // nothing else to answer.
  if (sheetTap) {
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
    e.preventDefault(); closeSheet(); return;
  }
  if (e.key === " ") { e.preventDefault(); playBtn.onclick(); }
  // `\` — the whole editor, on one key. Swapping between the game and the
  // level pack has to be instant or nobody uses it mid-party: this is the same
  // screen either way, so there is nothing to load and nothing to leave.
  if (e.key === "\\") {
    e.preventDefault();
    if (labOpen && editing) { editing = false; setLab(false); syncHud(); return; }
    editing = true;
    if (snap && snap.phase === "run") transport.send({ type: "stop" });
    setLab(true);
    syncHud();
  }
  if (e.key === "Escape" && labOpen && editing) {
    editing = false; setLab(false); syncHud();
  }
});

// ---------- pasting a level in ----------
// Ctrl+V anywhere on the page. Where it LANDS is the one question, and the
// answer is simply which screen you were looking at:
//
//   · the GRID is up — the selection. A card replaces that level, the trailing
//     dashed slot appends. That is the whole reason the laptop grid grew a
//     selection: "which level does this overwrite" is a question about a place
//     on the screen, and now the answer is the place that is lit.
//   · you are PLAYING — the level in front of you. Pasting over the level you
//     are looking at is the editor's tightest loop (tweak the frame in Figma,
//     Ctrl+C, Ctrl+V, watch the same level redraw under you), and it used to
//     cost a bounce out to the grid and back for no reason: the paste already
//     said which level it meant.
//
// The only paste that still opens the grid is the one with nowhere to land: an
// EMPTY pack has no level in front of you and no card to select, so the first
// one in is an append, and the grid is where you watch it arrive.
window.addEventListener("paste", (e) => {
  // Laptop only, like every other editing gesture. A phone reaching here would
  // have had to grow a Ctrl+V first, and if one ever does, it gets the grid the
  // rest of this file gives it — not a hidden second way to rewrite the pack.
  if (!DESKTOP()) return;
  e.preventDefault();
  // No zoop: this is a laptop editing gesture, and the grid it is usually
  // about to open hides `#help` with the rest of the HUD.
  if (sheetTap) closeSheet(false);   // the grid must not open behind the sheet
  // Read the screen NOW, not when the clipboard resolves: this is about what
  // the person was looking at when they pressed the key.
  const onGrid = labOpen;
  const toGrid = !onGrid && GOOMBA_LEVELS.length === 0;
  if (onGrid || toGrid) {
    // Always `editing`, not just when the grid was shut: pasting IS editing,
    // and the first paste into an EMPTY pack used to hand the controls back
    // the moment it succeeded — editorOn() had been true only because there
    // were no levels, so landing one turned the buttons off under the person
    // using them.
    editing = true;
    if (!labOpen) { selected = null; setLab(true); }
    syncHud();
  }
  pasteSay("reading the clipboard…");
  levelFromPaste(e.clipboardData).then(
    ({ level: lv, warnings }) => {
      // `selected` on the grid (null = the dashed slot, so append); playing,
      // the level on screen — which is never an append, and never null, since
      // an empty pack took the grid branch above.
      const target = onGrid || toGrid ? selected : level();
      if (target === null && GOOMBA_LEVELS.length >= PACK_MAX) {
        return pasteSay(`the pack is full at ${PACK_MAX} levels`);
      }
      const land = () => {
        // Re-read the pack on the way in: a confirm is answered by a person,
        // and a teammate's edit can land on this socket while they think.
        if (target !== null && target >= GOOMBA_LEVELS.length)
          return pasteSay("that slot is gone — select another card and paste again");
        // The pack is a list of level LINKS, so a paste becomes one here and
        // the authority stores exactly what it validated.
        transport.send({ type: "packSet", index: target, hash: encodeLevel(lv) });
        const where = target === null ? "as a new level" : `over level ${target + 1}`;
        pasteSay(warnings.length
          ? `${lv.name} ${where} · ${warnings.join(" · ")}`
          : `${lv.name} — in, ${where}`);
      };
      const over = target === null ? null : GOOMBA_LEVELS[target];
      // A paste whose NAME matches the card it lands on is a redraw: the Figma
      // frame it came from is the frame that card was made from, and stopping
      // to ask would tax the loop the editor exists for (tweak in Figma, copy,
      // paste, re-read the verdict) on every single lap. A DIFFERENT name is a
      // different level, and "I meant to add this, not to overwrite level 3"
      // is worth one click to catch — nothing on this grid is undoable. That
      // holds just as much when the paste landed on the level you are playing:
      // same rule, same question, no grid required to ask it.
      if (over && over.name !== lv.name)
        askConfirm(
          `Replace level ${target + 1}?`,
          `“${over.name}” → “${lv.name}”`,
          land,
        );
      else land();
    },
    (err) => pasteSay(String(err.message || err)),
  );
});

// ---------- the run replay ----------
// The flare's shape: snap up, fall away. It is clocked off the RUN's own
// seconds rather than off wall-clock dt, which is what makes it survive the
// fast-forward — a phone that joins late walks the missed substeps in one
// frame, and reading `st.t - lockT` lands it at the right point of the
// envelope instead of starting a fresh 0.4s that nobody else is seeing.
const LOCK_ATTACK = 0.06, LOCK_RELEASE = 0.34;
const lockFlare = (dt) =>
  dt < 0 ? 0
    : dt < LOCK_ATTACK ? dt / LOCK_ATTACK
    : Math.max(0, 1 - (dt - LOCK_ATTACK) / LOCK_RELEASE);
/** Keep the local animation in step with the room's shared clock. Returns the
 * RunState to draw, or null when nobody is riding. */
function syncAnim() {
  const s = snap;
  if (!s || s.runAt === null || (s.phase !== "run" && s.phase !== "win")) return null;
  const key = `${s.runId}:${s.level}:${s.runAt}`;
  if (!anim || anim.key !== key) {
    anim = { key, st: makeRun(L(), s.bands) };
    popPrev = anim.st.popT.slice();
    lockT = -9; lockArmed = false;
  }
  // Step to the shared timeline. A phone that joins late fast-forwards through
  // the missed part in one frame — same substeps, same ending.
  const target = Math.min((now() - s.runAt) / 1000, s.runT ?? 0);
  const st = anim.st;
  while (!st.result && st.t < target) stepRun(st, SUB);
  // The scored win, celebrated exactly when the replay reaches it.
  if (s.phase === "win" && st.result === "win" && !winFx) {
    winFx = true;
    const lv = L();
    for (let i = 0; i < 90; i++) confetti.push({
      x: lv.goal[0], y: lv.goal[1] - 4,
      vx: (Math.random() - 0.5) * 70, vy: -Math.random() * 70 - 15,
      c: PARTY_COLORS[i % 4], r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 10,
      life: 2.2 + Math.random(),
    });
    toast(s.completed.filter(Boolean).length === s.levelCount ? "ALL LEVELS CLEAR! 🎉🪴" : "LEVEL CLEAR! 🎉", 1800);
  }
  return st;
}

// ---------- input: three ways to lay a band, one way to take it back ----------
// A band is just two world points, so nothing forces one gesture on everyone:
//   · tap, then tap again — the anchor waits between them (calmest on a phone)
//   · one finger down, drag, release
//   · two fingers stretched apart (the original)
// Tapping a placed band takes it back; tapping an open anchor cancels it.
// There is no panning or zooming — the edit camera shows the whole level, so
// a tap always means "this point", never "scroll".
const toWorld = (px, py) => ({ x: (px - W / 2) / cam.s + cam.x, y: (py - H / 2) / cam.s + cam.y });
const touches = new Map();
let mouseDrag = null;
let down = null;   // the single finger that's down: where it started, in both spaces
let mode = null;   // null | "tap" | "drag" | "stretch" — what this gesture became
const DRAG_SLOP = 10;    // px of travel that turns a press into a drag
const ANCHOR_TTL = 8000;     // ms an open anchor waits before it gives up
const ANCHOR_BEAT_MS = 1200; // re-send it this often; the room forgets ghosts at 3s

const canEdit = () => snap && snap.phase === "edit";

/** The congratulations screen is one big button: the only thing anyone can do
 * from it is pick a level, so a press anywhere on the picture opens the grid
 * rather than making a thumb find the dot strip in the corner (which still
 * works — it is the same `openSelector`).
 *
 * Called from the RELEASE, not the press, so the grid never inherits the tail
 * of the gesture that opened it: the same finger's touchend would otherwise
 * land on whatever card the grid had just drawn under it. Nothing else on this
 * screen wants the gesture — `canEdit()` is false in the splash phase, so the
 * band handlers have already bowed out by the time this is asked. */
function splashTap() {
  if (labOpen || !snap || snap.phase !== "splash") return false;
  openSelector();
  return true;
}

/** The open anchor, or null once it has timed out. Anything that reads the
 * anchor goes through here so a forgotten tap can't place a band minutes
 * later. */
function liveAnchor() {
  if (anchor && performance.now() - anchor.at > ANCHOR_TTL) closeAnchor();
  return anchor;
}
/** Teammates see the waiting tap as a degenerate preview — both ends on the
 * one point — which the wire already carries and everyone already draws
 * (see GoombaBandPreview). Re-sent on a heartbeat because the room expires a
 * ghost after 3s and an anchor may wait for 8. */
function streamAnchor() {
  if (!anchor) return;
  anchor.sentAt = performance.now();
  transport.preview({ ax: anchor.x, ay: anchor.y, bx: anchor.x, by: anchor.y });
}
/** The anchor goes away and so does everything drawn from it, here and on
 * every teammate's phone. */
function closeAnchor() {
  if (!anchor) return;
  anchor = null; preview = null;
  transport.preview(null);
}
/** Drop every in-flight gesture (phase change, level change, cancelled touch). */
function resetInput() {
  if (preview || anchor) transport.preview(null);
  touches.clear();
  preview = null; anchor = null; down = null; mode = null; mouseDrag = null;
}

function previewFrom(a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  preview = snapBand(L(), { ax: a.x, ay: a.y, bx: b.x, by: b.y });
  preview.ok = len >= BAND_MIN && len <= BAND_MAX && iMayPlace();
  preview.len = len;
  // Teammates watch the stretch live — send what I'm seeing (snapped).
  transport.preview({ ax: preview.ax, ay: preview.ay, bx: preview.bx, by: preview.by });
}
function previewFromTouches() {
  const [p, q] = [...touches.values()];
  previewFrom(toWorld(p.cx, p.cy), toWorld(q.cx, q.cy));
}
function placePreview() {
  if (preview && preview.ok) {
    // The server snaps again (authoritatively); the ghost bridges the gap.
    // Placing also clears my streamed preview server-side, so no extra send.
    // The ghost goes up BEFORE the send: ?solo answers synchronously, and a
    // ghost set afterwards would outlive the snapshot that should retire it —
    // which is what used to eat the 4th band in the lab.
    pending = { ax: preview.ax, ay: preview.ay, bx: preview.bx, by: preview.by };
    transport.send({ type: "place", ax: preview.ax, ay: preview.ay, bx: preview.bx, by: preview.by });
  } else {
    // Say why nothing landed — a tap-tap that silently does nothing reads as
    // a broken screen. (Too SHORT stays quiet: that's the cancel gesture.)
    if (preview && preview.len > BAND_MAX) toast("too stretchy! 🫨", 900);
    else if (preview && bandsOut() >= MAX_BANDS)
      toast("all 4 bands are out! 🫰 tap one to take it back", 1300);
    transport.preview(null); // gesture ended without a placement
  }
  preview = null;
}
/** One finger, one point, no travel: take a band back, close an open anchor,
 * or open one. This is the whole tap-tap placement. */
function tapAt(w) {
  const a = liveAnchor();
  if (a) {
    if (Math.hypot(w.x - a.x, w.y - a.y) < BAND_MIN) {
      // Tapped (near) the anchor again — that band was never going to be
      // legal, so read it as "never mind".
      closeAnchor();
      return;
    }
    anchor = null; // the preview + place below supersede the marker, no clear
    previewFrom(a, w);
    placePreview();
    return;
  }
  if (tryDelete(w)) return;
  anchor = { x: w.x, y: w.y, at: performance.now(), sentAt: 0 };
  streamAnchor();
}
function tryDelete(w) {
  const bs = bands();
  for (let i = bs.length - 1; i >= 0; i--) {
    const pts = bandPoints(bs[i]);
    for (let j = 0; j + 1 < pts.length; j++) {
      const ax = pts[j][0], ay = pts[j][1], bx = pts[j + 1][0], by = pts[j + 1][1];
      const abx = bx - ax, aby = by - ay, l2 = abx * abx + aby * aby || 1e-6;
      let t = ((w.x - ax) * abx + (w.y - ay) * aby) / l2; t = Math.max(0, Math.min(1, t));
      const dx = w.x - ax - abx * t, dy = w.y - ay - aby * t;
      if (dx * dx + dy * dy < 16) { transport.send({ type: "remove", index: i }); return true; }
    }
  }
  return false;
}

cv.addEventListener("touchstart", (e) => {
  e.preventDefault();
  if (labOpen) { const t = e.changedTouches[0]; labPointerDown(t.clientX, t.clientY); return; }
  if (!canEdit()) return;
  for (const t of e.changedTouches) touches.set(t.identifier, { cx: t.clientX, cy: t.clientY });
  if (touches.size === 1 && mode === null) {
    const t = e.changedTouches[0];
    // Undecided yet: this is a tap until the finger travels.
    down = { sx: t.clientX, sy: t.clientY, w: toWorld(t.clientX, t.clientY) };
    mode = "tap";
  }
  if (touches.size === 2) {
    // Second finger down: the stretch wins over whatever the first was doing.
    mode = "stretch"; down = null; anchor = null;
    previewFromTouches();
  }
}, { passive: false });
cv.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (labOpen) { const t = e.changedTouches[0]; labPointerMove(t.clientX, t.clientY); return; }
  if (!canEdit()) return;
  for (const t of e.changedTouches) {
    const rec = touches.get(t.identifier);
    if (rec) { rec.cx = t.clientX; rec.cy = t.clientY; }
  }
  if (mode === "stretch") {
    if (touches.size === 2) previewFromTouches();
    return; // a lone leftover finger from a stretch never starts a drag
  }
  if (touches.size !== 1 || !down) return;
  const t = [...touches.values()][0];
  if (mode === "tap" && Math.hypot(t.cx - down.sx, t.cy - down.sy) > DRAG_SLOP) {
    mode = "drag"; anchor = null; // dragging supersedes a half-finished tap-tap
  }
  if (mode === "drag") previewFrom(down.w, toWorld(t.cx, t.cy));
}, { passive: false });
cv.addEventListener("touchend", (e) => {
  e.preventDefault();
  if (labOpen) { const t = e.changedTouches[0]; labPointerUp(t.clientX, t.clientY); return; }
  for (const t of e.changedTouches) touches.delete(t.identifier);
  if (splashTap()) return;
  if (!canEdit()) { resetInput(); return; }
  // A stretch places on the FIRST finger up; a drag places on its only one.
  if (preview && touches.size < 2) placePreview();
  if (mode === "tap" && touches.size === 0 && down) tapAt(down.w);
  if (touches.size === 0) { mode = null; down = null; }
}, { passive: false });
cv.addEventListener("touchcancel", resetInput);

// Mouse (desktop + the design bench): click-drag stretches, click-click does
// the same tap-tap as a finger, with a live rubber line in between.
cv.addEventListener("mousedown", (e) => {
  if (labOpen) { labPointerDown(e.clientX, e.clientY); return; }
  if (!canEdit()) return;
  mouseDrag = { a: toWorld(e.clientX, e.clientY), px: e.clientX, py: e.clientY, dragging: false };
});
window.addEventListener("mousemove", (e) => {
  if (labOpen) { labPointerMove(e.clientX, e.clientY); return; }
  if (!canEdit()) return;
  if (mouseDrag) {
    if (Math.hypot(e.clientX - mouseDrag.px, e.clientY - mouseDrag.py) > DRAG_SLOP) {
      mouseDrag.dragging = true; anchor = null;
    }
    if (mouseDrag.dragging) previewFrom(mouseDrag.a, toWorld(e.clientX, e.clientY));
    return;
  }
  const a = liveAnchor();
  if (a) previewFrom(a, toWorld(e.clientX, e.clientY)); // band follows the cursor
  else if (preview) { preview = null; transport.preview(null); } // anchor expired
});
window.addEventListener("mouseup", (e) => {
  if (labOpen) { labPointerUp(e.clientX, e.clientY); return; }
  if (splashTap()) return;
  if (!mouseDrag) return;
  const drag = mouseDrag;
  mouseDrag = null;
  if (!canEdit()) { preview = null; return; }
  if (drag.dragging) placePreview();
  else tapAt(toWorld(e.clientX, e.clientY));
});

// ---------- rendering (ported from the prototype) ----------
let camOX = 0, camOY = 0; // the lab draws levels into grid cells by offsetting the camera
const sxp = (x) => (x - cam.x) * cam.s + W / 2 + camOX;
const syp = (y) => (y - cam.y) * cam.s + H / 2 + camOY;

function fitScale(lv) {
  const b = lv.bounds;
  return Math.min(W / (b.x1 - b.x0), (H - 120) / (b.y1 - b.y0)) * 0.96;
}
function clampCam(x, y, s, b) {
  const hw = W / 2 / s, hh = H / 2 / s;
  return {
    x: (b.x1 - b.x0) < 2 * hw ? (b.x0 + b.x1) / 2 : Math.max(b.x0 + hw, Math.min(b.x1 - hw, x)),
    y: (b.y1 - b.y0) < 2 * hh ? (b.y0 + b.y1) / 2 : Math.max(b.y0 + hh, Math.min(b.y1 - hh, y)),
    s,
  };
}

const ambient = [];
for (let i = 0; i < 34; i++) ambient.push({
  x: Math.random(), y: Math.random(), s: 2 + Math.random() * 3,
  c: PARTY_COLORS[i % 4], vy: 6 + Math.random() * 12, sway: Math.random() * 6.28,
});

function drawBackground(dt) {
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

function drawTerrain(lv) {
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (const poly of lv.terrain) {
    ctx.strokeStyle = "rgba(243,233,214,0.14)"; ctx.lineWidth = 4.4 * cam.s;
    ctx.beginPath();
    poly.forEach(([x, y], i) => i ? ctx.lineTo(sxp(x), syp(y)) : ctx.moveTo(sxp(x), syp(y)));
    ctx.stroke();
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
function drawBand(bd, excite, ghost) {
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
  const bad = ghost && preview && !preview.ok;
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
function drawTeammatePreview(p) {
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
function drawAnchor(a) {
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
function drawTeammateAnchor(p) {
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

function drawCushion(c, squish) {
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

function drawPopper(pp, i) {
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
function drawCan(mx, my, taken, i, ping = 0) {
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
  ctx.fillStyle = "rgba(87,230,201,0.13)";
  ctx.beginPath(); ctx.arc(0, 0, 4.6 * u, 0, 6.28); ctx.fill();
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

function drawBumper(bp, hot) {
  const u = Math.max(cam.s, 2.2), x = sxp(bp.x), y = syp(bp.y);
  const pop = 1 + hot * 0.35;
  ctx.save(); ctx.translate(x, y); ctx.scale(pop, pop);
  ctx.fillStyle = "rgba(255,93,177,0.15)";
  ctx.beginPath(); ctx.arc(0, 0, (BUMP_R + 2.5) * cam.s, 0, 6.28); ctx.fill();
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
function drawGoalPlant(lv, st, fx = 0) {
  const x = sxp(lv.goal[0]), y = syp(lv.goal[1]), u = Math.max(cam.s, 2.6);
  const left = lv.cans.length - (st ? st.gotN : 0), ready = left === 0;
  const pulse = 1 + Math.sin(tGlobal * 3) * 0.05;
  ctx.save(); ctx.translate(x, y + 2 * u); ctx.scale(pulse, pulse);
  ctx.fillStyle = ready
    ? "rgba(87,230,201,0.2)"
    : `rgba(255,209,102,${(0.12 + 0.16 * fx).toFixed(3)})`;
  ctx.beginPath(); ctx.ellipse(0, -3.5 * u, 8.8 * u, 7.5 * u, 0, 0, 6.28); ctx.fill();
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

function drawGoomba(px, py, angle, face, grounded, airborne, idle) {
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

function drawStartPad(lv) {
  const u = cam.s, x = sxp(lv.start[0]), y = syp(lv.start[1] + R + 0.5);
  ctx.strokeStyle = "rgba(87,230,201,0.5)"; ctx.lineWidth = 0.4 * u;
  ctx.setLineDash([1.2 * u, 1.2 * u]);
  ctx.beginPath(); ctx.arc(x, y - R * u, (R + 1.6) * u + Math.sin(tGlobal * 2.5) * 0.4 * u, 0, 6.28); ctx.stroke();
  ctx.setLineDash([]);
}

// ---------- the LEVELS menu (the level selector) ----------
// The deleted prototype's lab view, on the shipped sim: every level as a card
// drawn from its own geometry — tap one to send the whole room there. Design
// triage on any phone straight from the deployed site, and, for a team that has
// cleared the game, its free-play menu. Who may open it is `levelSelect()`
// above; this draws the same grid either way.
//
// A card carries NO verdict. It held two once — a baked solution's result, and
// then the bare run's — and both are gone. So is the node bench that used to
// grade a level properly: nothing evaluates a level now except people playing
// it, so there is no true word to put on a card. A card is a picture of the
// level and its name, which is what a grid is read for. The sim work went with
// the text, so opening the menu no longer runs every level to label it.

/** Ellipsise `s` to at most `maxW` px in the current ctx font. */
function fitText(s, maxW) {
  if (ctx.measureText(s).width <= maxW) return s;
  let n = s.length;
  while (n > 1 && ctx.measureText(s.slice(0, n) + "…").width > maxW) n--;
  return s.slice(0, n) + "…";
}
/** The card under a point, or -1. */
function labCardAt(px, py) {
  for (const c of labCells)
    if (px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h) return c.i;
  return -1;
}
/** The editor button under a point, or null. */
function labButtonAt(px, py) {
  for (const b of labBtns)
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b;
  return null;
}
/**
 * Where a dragged card would land: an insertion GAP (0..n), read off the
 * nearest card as "left of its middle = before it, right = after it".
 *
 * Nearest CARD rather than a rect hit, because the pointer spends a drag in
 * the gutters between cards and at the ragged end of the last row, and a drop
 * there still has an obvious answer — the alternative is a drag that goes
 * dead in the space it is aiming at.
 */
function labGapAt(px, py) {
  let best = null, bestD = Infinity;
  for (const c of labCells) {
    const dx = px - (c.x + c.w / 2), dy = py - (c.y + c.h / 2);
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = c; }
  }
  if (!best) return 0;
  return px > best.x + best.w / 2 ? best.i + 1 : best.i;
}
/** Send the whole room to a level — the one thing a card tap has always done.
 * Latches BEFORE sending: the ?solo backend answers inside send(), and that
 * synchronous snapshot is what closes the lab. */
function labJumpTo(i) {
  if (i < 0 || i >= GOOMBA_LEVELS.length) return;
  clearLabJump();
  labJump = {
    level: i,
    timer: setTimeout(() => { labJump = null; setLab(false); }, LAB_JUMP_MS),
  };
  transport.send({ type: "goto", level: i });
}
/** A per-card editor button, pressed. */
function labButtonHit(b) {
  const lv = GOOMBA_LEVELS[b.i];
  switch (b.kind) {
    // DELETE — behind a confirm, because it is the one control here that
    // destroys a level rather than moving it, and the pack is the only copy.
    case "del":
      askConfirm(`Delete level ${b.i + 1}?`, lv ? lv.name : "", () => {
        // Follow the selection across the hole this leaves, or it silently
        // re-aims at whatever slides up into the slot.
        if (selected === b.i) selected = null;
        else if (selected !== null && selected > b.i) selected -= 1;
        transport.send({ type: "packDelete", index: b.i });
        editSay(`deleted level ${b.i + 1}`);
      });
      return;
    case "new":
      selected = null;
      editSay("next paste adds a new level — Ctrl+V a Figma frame");
      return;
  }
}
/**
 * A press on the grid. This is where the two surfaces part company: a phone
 * plays the card it touched, a laptop selects it and holds the press open in
 * case it becomes a drag.
 */
function labPointerDown(px, py) {
  labDownHandled = false;
  labDrag = null;
  // Editor buttons next. They sit ON the cards, so hit-testing them after the
  // card would make ⌫ ask about a level AND select it under the question.
  const btn = labButtonAt(px, py);
  if (btn) { labDownHandled = true; labButtonHit(btn); return; }
  const i = labCardAt(px, py);
  // THE PHONE: a tap plays. There is nothing to select on a phone — no paste
  // to aim, no drag to make — so a select-then-play would be a toll on the one
  // gesture that means anything.
  if (!DESKTOP()) { labDownHandled = true; labJumpTo(i); return; }
  // THE LAPTOP: select on the press, like every file browser. Clicking off the
  // cards clears the selection back to the trailing slot, which is what "the
  // next paste adds a level" looks like.
  selected = i < 0 ? null : i;
  if (editorOn() && i >= 0)
    labDrag = { i, sx: px, sy: py, x: px, y: py, moved: false, gap: i };
}
function labPointerMove(px, py) {
  if (!labDrag) return;
  labDrag.x = px; labDrag.y = py;
  if (!labDrag.moved && Math.hypot(px - labDrag.sx, py - labDrag.sy) > DRAG_SLOP)
    labDrag.moved = true;
  if (labDrag.moved) labDrag.gap = labGapAt(px, py);
}
function labPointerUp(px, py) {
  const d = labDrag;
  labDrag = null;
  if (labDownHandled) { labDownHandled = false; return; }
  if (d && d.moved) {
    // packMove's `to` is an index in the list with the dragged level already
    // pulled OUT, so a gap to its right has shifted back by one.
    const to = d.gap > d.i ? d.gap - 1 : d.gap;
    if (to !== d.i && to >= 0 && to < GOOMBA_LEVELS.length) {
      selected = to; // the selection is the level, not the slot it was in
      transport.send({ type: "packMove", from: d.i, to });
      editSay(`moved level ${d.i + 1} to slot ${to + 1}`);
    }
    return;
  }
  // Not a drag, so the press already selected — and a SECOND press on the same
  // card inside the double-click window is what plays it. Hand-rolled rather
  // than left to the `dblclick` event because touchstart is preventDefault'd
  // here (the kiosk lockdown), which is exactly what stops a browser
  // synthesising that event on a laptop with a touchscreen.
  const i = labCardAt(px, py);
  if (i < 0) { lastLabClick = { i: -1, t: 0 }; return; }
  const t = performance.now();
  if (lastLabClick.i === i && t - lastLabClick.t < DBL_MS) {
    lastLabClick = { i: -1, t: 0 };
    labJumpTo(i);
    return;
  }
  lastLabClick = { i, t };
}
/**
 * The one line under the title. It has to describe a DIFFERENT screen on each
 * surface, because the gestures are different: on a phone a tap plays, on a
 * laptop a tap selects and the second one plays.
 */
function labHelp() {
  if (editorOn() && editMsgT > 0 && editMsg) return editMsg;
  if (GOOMBA_LEVELS.length === 0)
    return DESKTOP()
      ? "no levels yet — copy a frame in Figma and press Ctrl+V"
      : "no levels yet — a laptop pastes them in from Figma";
  const play = SOLO ? "plays it locally — no server, no room" : "jumps the whole room there";
  if (!DESKTOP()) return `tap a card — it ${play}`;
  if (!editorOn()) return `click selects · double-click ${play}`;
  return "click selects · double-click plays · drag reorders · Ctrl+V lands on the selection";
}
function drawLab() {
  ctx.fillStyle = "#100722"; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.font = "700 15px ui-rounded, system-ui, sans-serif";
  ctx.fillStyle = "#f2ecff";
  ctx.fillText("Levels", 16, 30);
  ctx.font = "12px ui-rounded, system-ui, sans-serif";
  ctx.fillStyle = editorOn() && editMsgT > 0 ? "#ffd166" : "#8a80b0";
  ctx.fillText(fitText(labHelp(), W - 32), 16, 48);

  // One extra slot while editing: the dashed "paste a new level here" card,
  // which is what `selected === null` looks like on screen.
  const slots = GOOMBA_LEVELS.length + (editorOn() ? 1 : 0);
  const cols = W > H ? 3 : 2;
  const rows = Math.max(1, Math.ceil(slots / cols));
  const padX = 12, top = 62, bottom = 24;
  const cw = (W - padX * (cols + 1)) / cols;
  const ch = Math.min((H - top - bottom - 12 * (rows - 1)) / rows, cw * 1.5);
  labCells = [];
  labBtns = [];
  const savedCam = { ...cam };

  /** The per-card editor controls. Drawn last so they sit over the level, and
   * hit-tested BEFORE the card, so pressing ⌫ never also selects it.
   *
   * ONE button, down from four: ◀ ▶ went to the drag, and `⧉` copy went too.
   * Copy existed to get a level back OUT as a link — to duplicate it, to send
   * it, or to grade it on the bench. Duplicating and sending are Figma's now
   * (the frame is the source, and Ctrl+C there is the way in), and grading is
   * nobody's — the bench is deleted, and a level is judged by being played.
   * `seed.mjs --pull` reads a live event's whole pack off the lobby, which beat
   * copying one card at a time even when there was something to grade with. It acts on the card it sits on whatever is
   * selected — a button on a card is a sentence about that card. */
  const cardButtons = (i, x, y) => {
    if (!editorOn()) return;
    const B = 22, G = 4;
    const kinds = [["del", "⌫"]];
    let bx = x + cw - 8 - (B * kinds.length + G * (kinds.length - 1));
    for (const [kind, glyph] of kinds) {
      const by = y + 8;
      labBtns.push({ i, kind, x: bx, y: by, w: B, h: B });
      ctx.beginPath();
      ctx.roundRect(bx, by, B, B, 6);
      ctx.fillStyle = "rgba(16,7,34,0.8)";
      ctx.fill();
      ctx.strokeStyle = "rgba(201,189,240,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#f2ecff";
      ctx.font = "600 11px ui-rounded, system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(glyph, bx + B / 2, by + B / 2 + 0.5);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      bx += B + G;
    }
  };
  GOOMBA_LEVELS.forEach((lv, i) => {
    const c = i % cols, r = (i / cols) | 0;
    const x = padX + c * (cw + padX), y = top + r * (ch + 12);
    labCells.push({ i, x, y, w: cw, h: ch });
    // The card being dragged fades where it came from, so the gap it is about
    // to leave reads as a gap rather than as a duplicate.
    if (labDrag && labDrag.moved && labDrag.i === i) ctx.globalAlpha = 0.35;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 12); ctx.clip();
    ctx.fillStyle = "#180d31"; ctx.fillRect(x, y, cw, ch);
    // the level itself, fitted into the card
    const b = lv.bounds, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    const inner = 16;
    cam.s = Math.min((cw - inner) / bw, (ch - inner - 22) / bh);
    cam.x = (b.x0 + b.x1) / 2; cam.y = (b.y0 + b.y1) / 2;
    camOX = x + cw / 2 - W / 2; camOY = y + (ch - 22) / 2 + 11 - H / 2;
    drawTerrain(lv);
    lv.cushions.forEach((cu) => drawCushion(cu, 0));
    lv.pops.forEach((pp, k) => drawPopper(pp, k));
    lv.bumpers.forEach((bp) => drawBumper(bp, 0));
    lv.cans.forEach((m, k) => drawCan(m[0], m[1], false, k));
    drawGoalPlant(lv, null);
    // Her spawn, drawn as herself. A card is read at a glance and every other
    // thing on it is a picture of the thing it is; `start` was the one piece of
    // the level with nothing standing where it says. Idle, so the grid has her
    // waiting on all of them at once.
    drawGoomba(lv.start[0], lv.start[1], lv.startAngle, 1, true, false, true);
    camOX = camOY = 0;
    ctx.restore();
    // frame + labels
    const jumping = labJump !== null && i === labJump.level;
    const current = snap !== null && i === snap.level;
    ctx.strokeStyle = jumping ? "#57e6c9" : current ? "#ffd166" : "rgba(201,189,240,0.22)";
    ctx.lineWidth = jumping || current ? 2.5 : 1.5;
    if (lv.pasted) ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 12); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "700 12px ui-rounded, system-ui, sans-serif";
    ctx.fillStyle = "#f2ecff";
    // The title is all a card says, so trim to the card's real width rather
    // than a guessed character count.
    //
    // The number comes from the card's PLACE, not from the level — see
    // `levelLabel`. A hash-adopted level is the one card that gets no number:
    // it is appended to this array locally and is not in the pack at all, so
    // numbering it would claim a position in a pack it never joined, which is
    // the opposite of what the rest of the card says about itself.
    const title = lv.pasted ? lv.name : levelLabel(i, lv.name);
    ctx.fillText(fitText(title, cw - 18), x + 9, y + ch - 8);
    // A level adopted from the URL hash (?solo#…) is the one kind that is NOT
    // in the event's pack: it plays identically — same sim, same bands, same
    // scoring — but nobody else can see it and no room has to clear it. It
    // takes the top-left corner the bare verdict used to hold.
    if (lv.pasted) {
      ctx.font = "700 9px ui-rounded, system-ui, sans-serif";
      ctx.fillStyle = "#ffd166";
      ctx.fillText("FROM A LINK — not in the pack", x + 9, y + 16);
    }
    // The round trip, made visible: the tap landed, the room is coming with us.
    if (jumping) {
      ctx.save();
      ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 12); ctx.clip();
      ctx.fillStyle = "rgba(16,7,34,0.55)"; ctx.fillRect(x, y, cw, ch);
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(tGlobal * 6);
      ctx.fillStyle = "#57e6c9";
      ctx.font = "700 13px ui-rounded, system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("jumping…", x + cw / 2, y + ch / 2);
      ctx.restore();
    }
    // SELECTION, drawn outside the card's own frame so it can coexist with
    // the amber "this is the level the room is on" — they are different facts
    // and a card is often both.
    if (DESKTOP() && selected === i) {
      ctx.strokeStyle = "#f2ecff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(x - 4, y - 4, cw + 8, ch + 8, 15); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    cardButtons(i, x, y);
  });

  // Where a drop would land: a bar in the GAP, not a highlight on a card,
  // because "between 2 and 3" is what a reorder actually chooses.
  if (labDrag && labDrag.moved) {
    const g = labDrag.gap;
    const gx = padX + (g % cols) * (cw + padX) - 6;
    const gy = top + ((g / cols) | 0) * (ch + 12);
    ctx.fillStyle = "#57e6c9";
    ctx.beginPath(); ctx.roundRect(gx - 1.5, gy, 3, ch, 2); ctx.fill();
  }

  // The trailing slot: where a paste lands when it is not replacing anything.
  // Drawn as a card rather than explained in a line of help, because "the next
  // paste goes HERE" is a place, and a place is easier to point at than a rule.
  if (editorOn()) {
    const i = GOOMBA_LEVELS.length;
    const c = i % cols, r = (i / cols) | 0;
    const x = padX + c * (cw + padX), y = top + r * (ch + 12);
    labBtns.push({ i, kind: "new", x, y, w: cw, h: ch });
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = selected === null ? "#ffd166" : "rgba(201,189,240,0.3)";
    ctx.lineWidth = selected === null ? 2.5 : 1.5;
    ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 12); ctx.stroke();
    ctx.restore();
    // The empty slot is selectable like any card — "nothing is selected" and
    // "the new-level slot is selected" are one state, and this is its face.
    if (selected === null) {
      ctx.strokeStyle = "#f2ecff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(x - 4, y - 4, cw + 8, ch + 8, 15); ctx.stroke();
    }
    ctx.fillStyle = selected === null ? "#ffd166" : "#8a80b0";
    ctx.font = "700 12px ui-rounded, system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("+ Ctrl+V", x + cw / 2, y + ch / 2 - 8);
    ctx.font = "10px ui-rounded, system-ui, sans-serif";
    ctx.fillText("a Figma frame", x + cw / 2, y + ch / 2 + 10);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }
  Object.assign(cam, savedCam);
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
function drawSplash() {
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

// ---------- main loop ----------
const bandExcite = new Map(); // band index -> 0..1 wobble

let lastFitCheck = 0;

function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (nowMs - (frame.last || nowMs)) / 1000); frame.last = nowMs;
  tGlobal += dt;
  if (tGlobal - lastFitCheck > 1) { lastFitCheck = tGlobal; checkFit(); }
  if (editMsgT > 0) editMsgT = Math.max(0, editMsgT - dt);
  if (sheetOpen) drawSheet();   // `?` mid-party: the pictures keep moving
  if (!snap) return;
  if (labOpen) { drawLab(); return; }
  if (snap.phase === "splash") { drawSplash(); return; }
  const lv = L();
  const st = syncAnim();
  const riding = st && snap.phase === "run";

  // Ride effects, driven off the local replay exactly as the prototype drove
  // them off its local run.
  if (st) {
    if (riding && st.onBand >= 0 && Math.random() < 0.5) {
      const bd = bands()[st.onBand];
      parts.push({ x: st.p.x, y: st.p.y + R, vx: -st.v.x * 0.15, vy: -12,
                   c: bandInk(), life: 0.5 });
    }
    st.cushHits.forEach((h, i) => { if (h) { cushAnim[i] = 1; st.cushHits[i] = 0; } });
    st.popT.forEach((t, i) => {
      if (popPrev && t !== popPrev[i]) {
        const pp = lv.pops[i];
        for (let k = 0; k < 22; k++) confetti.push({
          x: pp.x, y: pp.y,
          vx: pp.vx * 0.25 + (Math.random() - 0.5) * 40, vy: pp.vy * 0.25 - Math.random() * 20,
          c: PARTY_COLORS[k % 4], r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 12,
          life: 0.8 + Math.random() * 0.5,
        });
      }
    });
    popPrev = st.popT.slice();
    st.bandHits.forEach((h, i) => { if (h) bandExcite.set(i, 1); });
    // She reached the plant with cans still out. The 81 is the sim's own win
    // circle (r=9, `stepRun`'s last test in physics.ts) read back rather than
    // re-guessed: the flare has to fire on exactly the pass that WOULD have
    // won, or it is telling the player about a line that was never there.
    // Armed on the way in and re-armed on the way out, so a level that threads
    // her over the goal three times reads as three taps, not one stuck alarm.
    const gdx = st.p.x - lv.goal[0], gdy = st.p.y - lv.goal[1];
    const inGoal = gdx * gdx + gdy * gdy < 81 && st.gotN < lv.cans.length;
    if (inGoal && !lockArmed) lockT = st.t;
    lockArmed = inGoal;
  }
  for (const [i, v] of bandExcite) bandExcite.set(i, Math.max(0, v - dt * 1.6));
  cushAnim = cushAnim.map((v) => Math.max(0, v - dt * 2.2));

  // camera: the whole level while editing (nothing pans), chase cam on a run
  const fs = fitScale(lv), b = lv.bounds;
  const target = riding && st
    ? clampCam(st.p.x + st.face * 8, st.p.y, fs * RZ, b)
    : clampCam((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, fs, b);
  const k = Math.min(1, 5 * dt);
  cam.x += (target.x - cam.x) * k; cam.y += (target.y - cam.y) * k; cam.s += (target.s - cam.s) * k;

  drawBackground(dt);
  ctx.save();
  if (shake > 0) { shake = Math.max(0, shake - dt * 3); ctx.translate((Math.random() - 0.5) * 10 * shake, (Math.random() - 0.5) * 10 * shake); }

  drawTerrain(lv);
  lv.cushions.forEach((c, i) => drawCushion(c, cushAnim[i] || 0));
  lv.pops.forEach((pp, i) => drawPopper(pp, i));
  lv.bumpers.forEach((bp, i) => drawBumper(bp, st ? Math.max(0, 1 - (st.t - st.bumpT[i]) * 4) : 0));
  // The flare, and the rings it throws off the cans she still needs. They
  // stagger in the order they are stored, which is the order a designer laid
  // them out, so a handful of cans arrives as a list rather than a flashbulb —
  // capped, because a twelve-can level should not still be pinging a second
  // later.
  const lockFx = st ? lockFlare(st.t - lockT) : 0;
  let nth = 0;
  lv.cans.forEach((m, i) => {
    const taken = st ? st.got[i] : false;
    // ...and each ring is read off its OWN envelope, not gated on the plant's:
    // a staggered one is still fading when the plant has finished, and cutting
    // it there is a ring that vanishes mid-fade.
    const ping = !taken && st ? lockFlare(st.t - lockT - Math.min(nth, 5) * 0.06) : 0;
    if (!taken) nth++;
    drawCan(m[0], m[1], taken, i, ping);
  });
  drawGoalPlant(lv, st, lockFx);
  bands().forEach((bd, i) => drawBand(bd, bandExcite.get(i) || 0, false));
  if (snap.phase === "edit") {
    // Teammates' bands-in-progress: unmistakably in motion (marching dashes,
    // pulsing alpha) so nobody confuses a drag with a placed band.
    const pid = playerId();
    for (const p of snap.previews ?? []) {
      if (p.pid === pid) continue;
      if (now() - p.at > 2500) continue; // stale ghost from a dead drag
      if (Math.hypot(p.bx - p.ax, p.by - p.ay) < BAND_MIN) drawTeammateAnchor(p);
      else drawTeammatePreview(p);
    }
  }
  if (pending && snap.phase === "edit") drawBand(snapBand(lv, pending), 0, true);
  if (preview && snap.phase === "edit") drawBand(preview, 0, true);
  if (snap.phase === "edit") {
    const a = liveAnchor();
    if (a && !preview) {
      drawAnchor(a);
      if (performance.now() - a.sentAt > ANCHOR_BEAT_MS) streamAnchor(); // keep it alive
    }
  }
  if (snap.phase !== "run") drawStartPad(lv);

  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    ctx.fillStyle = p.c; ctx.globalAlpha = Math.min(1, p.life * 2.5);
    ctx.beginPath(); ctx.arc(sxp(p.x), syp(p.y), 0.4 * cam.s, 0, 6.28); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (let i = confetti.length - 1; i >= 0; i--) {
    const p = confetti[i]; p.life -= dt;
    if (p.life <= 0) { confetti.splice(i, 1); continue; }
    p.vy += 60 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
    ctx.save(); ctx.translate(sxp(p.x), syp(p.y)); ctx.rotate(p.r);
    ctx.fillStyle = p.c; ctx.globalAlpha = Math.min(1, p.life);
    ctx.fillRect(-0.6 * cam.s, -0.3 * cam.s, 1.2 * cam.s, 0.6 * cam.s);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  if (st) drawGoomba(st.p.x, st.p.y, st.boardA * st.face, st.face, st.grounded, !st.grounded, false);
  else drawGoomba(lv.start[0], lv.start[1], lv.startAngle, 1, true, false, true);

  ctx.restore();
}

// ---------- how to play: pictures, drawn by the game ----------
// The waiting room used to explain this game in four sentences. Nobody reads
// four sentences at a party, and worse, nothing ever showed them again: the
// gate is the one screen a player passes through exactly once, so every word
// on it was spent on the thirty seconds before they could do anything.
//
// It is pictures now — WHERE she is going (past every can, home to the plant),
// and the two gestures that put a band in her way — and `?` bottom-left brings
// them back mid-party, which is the half that was actually missing.
//
// There WAS a middle picture, a band laid across a gap with her riding it,
// captioned "using your 4 bands". It is gone: the goal above it and the hands
// below it say the same thing between them, and a sheet is read in the seconds
// before somebody taps it, so the third of three that only restated the other
// two was the one costing that reading.
//
// They are drawn by the RENDERER, not by hand: a scene below is a level-shaped
// literal, and drawTerrain/drawCan/drawGoalPlant/drawBand/drawGoomba paint it
// exactly as they paint a real level, into the sheet's little canvases instead
// of the game's big one. That is the whole point — a picture of a watering can
// that is not the watering can drifts the first time either one is touched,
// and a second set of drawing code is a second thing to keep true. It is the
// same trick the level cards play (drawLab): borrow the camera, draw the
// world, put the camera back. One more canvas rides the TITLE (drawTitleScene,
// below) — no caption, nothing to read: she is the same sprite the pictures
// under her use, gliding across the words the game is named after.

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
  // Up in the air, where they belong: 4.5-7 clear of a floor that is falling
  // away faster than she is. The last one hangs over the GAP, which has no
  // floor under it for its glow to sit on at all.
  cans: [[17, 7.2], [32, 9], [46, 11.6]],
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

// ...and the last two points are not cans: one is her RIDING HEIGHT over the
// band's middle (R above where it hangs), the other is past its far end, on the
// platform the band delivers her to. Without them the line flew over the gap
// and the band was decoration again.
const RIDE_PATH = [[11, 8.8], ...GOAL_SCENE.cans, [54, 16.6], [63, 19.2]];

/** Draw a scene into one of the sheet's canvases, framed to its bounds.
 *
 * The renderer's globals ARE the parameters here: point `ctx` at the little
 * canvas, tell it how big it is, put the camera on the scene, draw, and hand
 * all of it back. The restore is in a finally because a throw mid-picture that
 * left `ctx` on a 340px canvas would take the whole game's rendering with it. */
function drawScene(el, b, body) {
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

/** The two gestures, side by side on one stage.
 *
 * The picture above says where she is going and nothing said how a band gets
 * into her way. These are a PAIR: the same two ledges and the same band in
 * both, so the difference between the panels is only what the hand does —
 * laying it on the left, taking it back on the right. One stage twice is why they can be
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
  // box: 35% ink against the ~70% the picture above it carries.
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

function drawSheet() {
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

/** Make the sheet dismissible. `label` is the line saying so, and the first
 * arm passes none: a player who has never dismissed this sheet is not waiting
 * to be told how to, they are reading the pictures, and the one line of chrome
 * under them was the only thing on the screen that was not the game. What is
 * left is what a phone answers to anyway — a tap — and `?` says where the
 * sheet went on the way out. */
function armSheet(label = "") {
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
/** The clock, read off the CSS so the flight and the landing cannot drift. */
function zoopMs() {
  const v = parseFloat(getComputedStyle(hudEl).getPropertyValue("--zoop-ms"));
  return Number.isFinite(v) && v > 0 ? v : 460;
}
/**
 * @param animate false where there is nothing to watch — the grid is already
 *   up over the sheet (`?solo`, a pasted level), so `#help` is hidden with the
 *   rest of the HUD and the sheet would be flying at a button nobody can see.
 */
function closeSheet(animate = true) {
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
function sheetFrame(nowMs) {
  if (inited) return;
  requestAnimationFrame(sheetFrame);
  const dt = Math.min(0.05, (nowMs - (sheetFrame.last || nowMs)) / 1000);
  sheetFrame.last = nowMs;
  tGlobal += dt;
  drawSheet();
}

// ---------- boot — no menu, same contract as hex ----------
const NAME_KEY = "escape-cats-name";
// THE CONNECTION LINES, AND WHY ALMOST NOBODY SEES THEM.
//
// They are held invisible until this phone has been disconnected for STALL_MS
// WITHOUT A BREAK, and they go back the instant it reconnects. Time since boot
// would have been the wrong clock: a phone the proctor has not sorted yet has
// no room to join and waits here indefinitely — connected, healthy, and by far
// the commonest thing on this screen at the start of a party — so a plain timer
// would put "Loading…" under the pictures for everyone. Being unable to REACH
// anything is the only state worth a word.
//
// 1.5s because under a second is not a wait anyone perceives (a line there is
// noise about something that already worked), because two of the three gaps
// this covers — the first socket, and the one between being sorted and the room
// answering — are normally a couple of hundred milliseconds, and because a
// player who has been stuck this long is still wondering rather than long past
// caring. It is a floor on complaining, not a timeout: nothing is given up on
// at 1.5s, the words merely stop being withheld.
const STALL_MS = 1500;
let stallTimer = null;
/** Connected or not; the lines follow, after the delay when the answer is no. */
function netQuiet(up) {
  clearTimeout(stallTimer); stallTimer = null;
  if (up) gateEl.classList.add("quiet");
  else stallTimer = setTimeout(() => gateEl.classList.remove("quiet"), STALL_MS);
}

function boot() {
  requestAnimationFrame(sheetFrame);   // the gate is up: animate it until frame() exists
  // ?debug adds no chrome of its own any more — the roster line it used to
  // hide is gone from every phone. The SELECTOR rides `.cleared`, which syncHud
  // toggles off the room's snapshot, and ?debug simply forces that predicate
  // true (see levelSelect).
  if (SOLO) {
    // Serverless: the shared sim in-page. A level pasted in via the hash opens
    // ON that level; otherwise we land on the grid as before.
    const pasted = adoptHashLevel();
    setLab(pasted === null);
    startDebug({ onSnapshot, level: pasted ?? undefined });
    return;
  }
  // Everything else joins the real room like any player, ?debug or not — the
  // selector's card taps send a room-wide `goto`, so the whole team jumps
  // together, and a ?debug phone differs only in getting at the selector
  // before the team has earned it.
  const name = localStorage.getItem(NAME_KEY) ?? "Cat";
  gateStatusEl.textContent = "Loading…";
  netQuiet(false);   // nothing is connected yet: the clock starts here
  let sorted = false;   // a team is known, so the ROOM socket is the live wire
  watchTeam({
    name,
    onTeam: (team, lobbyName) => {
      localStorage.setItem(NAME_KEY, lobbyName);
      // The lobby socket is deliberately closed the moment a real team lands,
      // and that close is a `false` on onStatus below. From here the room
      // socket is the only connection this phone has an opinion about.
      sorted = true;
      netQuiet(false);   // ...and it is not open yet, so the clock restarts
      // A team id doubles as its room id, so this is also the colour every band
      // on this phone is about to be drawn in (bandInk). Set before the first
      // snapshot can arrive, so nothing is ever painted in the fallback pink
      // and then swapped.
      myTeam = team;
      gateStatusEl.textContent = "Joining your team…";
      connectRoom({
        room: team,
        name: lobbyName,
        onSnapshot,
        onPack,
        onConnection: (up) => {
          connEl.classList.toggle("on", !up && inited);
          if (!inited) {
            gateErrEl.textContent = up ? "" : "Can't reach the room — hang tight, retrying…";
            netQuiet(up);
          }
        },
      });
    },
    onStatus: (up) => {
      // Silent once sorted, TEXT included: the lobby socket is closed on
      // purpose at that point, and letting its "check wifi?" land would leave
      // the wrong sentence sitting there for a slow room join to reveal.
      if (sorted) return;
      gateErrEl.textContent = up ? "" : "Can't reach the server — check wifi?";
      netQuiet(up);
    },
  });
}

boot();

// Console/test handle, like window.__hex — the server validates everything.
window.__goomba = {
  state: () => snap,
  send: (msg) => transport.send(msg),
  preview: (bd) => transport.preview(bd),
  LEVELS: GOOMBA_LEVELS,
};
