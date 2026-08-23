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
  PACK_MAX,
} from "@escape-cats/shared";
import { connectRoom, watchTeam, transport, playerId } from "./net";
import { adoptHashLevel, debugFromUrl, soloFromUrl, startDebug } from "./debug";
import { levelFromPaste } from "./figma/paste.js";

const cv = document.getElementById("c");
const ctx = cv.getContext("2d");
let W = 0, H = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.width = W + "px"; cv.style.height = H + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();
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
 * handed a `⧉ ◀ ▶ ⌫` row it has no keyboard to follow up on is not rescued
 * from anything — it is just a menu with buttons that lead nowhere.
 */
const editorOn = () => DESKTOP() && (editing || GOOMBA_LEVELS.length === 0);

// ---------- selection: the laptop's half of the grid ----------
// One card is selected at a time, the way a file browser does it, and that
// selection is what a paste lands on: an index REPLACES that level, `null`
// means the trailing dashed slot and APPENDS. It used to take a button (`⧉`)
// to aim a paste; a selection is the same aim with no button and no second
// idea of "current" on the screen — which is why `⧉` is now a real copy.
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
    gateEl.classList.add("hidden");
    requestAnimationFrame(frame);
  }
  if (s.phase !== "edit") resetInput(); // a run kills any half-drawn band

  if (first || wasReset || levelChanged || splashEdge) {
    // Fresh footing: recenter the camera, drop run debris.
    const b = L().bounds;
    Object.assign(cam, clampCam((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, fitScale(L()), b));
    resetInput();
    anim = null; winFx = false; parts = []; confetti = [];
    cushAnim = L().cushions.map(() => 0); popPrev = null;
    shownRunId = s.runId; shownLevel = s.level; shownPhase = s.phase;
    if (wasReset && !first) toast("fresh start! 🧽", 1400);
    else if (levelChanged && !first) toast(L().name, 1400);
    syncHud();
    return;
  }

  // Phase edges. The run→edit edge is a scored FAIL (wins go run→win).
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
labEl.onclick = () => {
  if (!levelSelect()) return; // an indicator until the team clears the game
  if (snap && snap.phase === "run") transport.send({ type: "stop" });
  setLab(true);
};
window.addEventListener("keydown", (e) => {
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
/** Keep the local animation in step with the room's shared clock. Returns the
 * RunState to draw, or null when nobody is riding. */
function syncAnim() {
  const s = snap;
  if (!s || s.runAt === null || (s.phase !== "run" && s.phase !== "win")) return null;
  const key = `${s.runId}:${s.level}:${s.runAt}`;
  if (!anim || anim.key !== key) {
    anim = { key, st: makeRun(L(), s.bands) };
    popPrev = anim.st.popT.slice();
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
    ctx.setLineDash([2 * cam.s, 7 * cam.s]);
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
  ctx.setLineDash([]);
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
  ctx.setLineDash([]);
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
  ctx.setLineDash([]);
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
function drawCan(mx, my, taken, i) {
  if (taken) return;
  const u = Math.max(cam.s, 2.2), x = sxp(mx), y = syp(my);
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

function drawGoalPlant(lv, st) {
  const x = sxp(lv.goal[0]), y = syp(lv.goal[1]), u = Math.max(cam.s, 2.6);
  const left = lv.cans.length - (st ? st.gotN : 0), ready = left === 0;
  const pulse = 1 + Math.sin(tGlobal * 3) * 0.05;
  ctx.save(); ctx.translate(x, y + 2 * u); ctx.scale(pulse, pulse);
  ctx.fillStyle = ready ? "rgba(87,230,201,0.2)" : "rgba(255,209,102,0.12)";
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

  ctx.save(); ctx.rotate(Math.sin(tGlobal * 1.7) * (ready ? 0.05 : 0.02));
  const leaf = ready ? "#57e6c9" : "#49a08f";
  // the runner: a wiry stolon out past the rim with a baby plantlet on its end
  const swing = Math.sin(tGlobal * 1.9) * (ready ? 0.55 : 0.15) * u;
  const rx = 6.0 * u + swing, ry = (ready ? -1.2 : 0.2) * u;
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
  const lift = ready ? 1 : 0.62, sag = ready ? 0 : 1.6, spread = ready ? 1 : 0.88;
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
    ctx.save(); ctx.translate(x, y - 12.5 * u);
    ctx.fillStyle = "rgba(20,10,45,0.85)";
    ctx.beginPath(); ctx.roundRect(-3.4 * u, -1.6 * u, 6.8 * u, 3.2 * u, 1.2 * u); ctx.fill();
    ctx.strokeStyle = "#57e6c9"; ctx.lineWidth = 0.28 * u; ctx.stroke();
    ctx.fillStyle = "#57e6c9";
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
// then the bare run's — and both are gone: grading is `verify.mjs`'s job, which
// searches for a solution instead of being told one and reports far more than
// one word will hold. A card is a picture of the level and its name, which is
// what a grid is read for. The sim work went with the text, so opening the menu
// no longer runs every level to label it.

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
    // COPY — the level, onto the clipboard, as the link it already knows how
    // to be. That is the same string `verify.mjs --hash` grades and the same
    // string this grid's own Ctrl+V reads, so one button covers "grade this",
    // "send this to someone" and "duplicate this" (copy, select the dashed
    // slot, paste) without inventing a second format for any of them.
    case "copy": {
      if (!lv) return;
      const write = navigator.clipboard && navigator.clipboard.writeText(encodeLevel(lv));
      if (!write) return editSay("this browser won't hand over the clipboard here (needs https)");
      write.then(
        () => editSay(`copied level ${b.i + 1} — Ctrl+V it onto a card, or grade it with verify.mjs --hash`),
        () => editSay("the browser refused the clipboard — click the page once, then try again"),
      );
      return;
    }
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
  ctx.fillText(editorOn() ? "Levels — editing" : "Levels", 16, 30);
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
   * Two buttons, not four: ◀ ▶ went to the drag, and `⧉` stopped meaning "aim
   * the next paste here" (the selection says that now) and became a real copy.
   * Both of the survivors act on the card they sit on whatever is selected —
   * a button on a card is a sentence about that card. */
  const cardButtons = (i, x, y) => {
    if (!editorOn()) return;
    const B = 22, G = 4;
    const kinds = [["copy", "⧉"], ["del", "⌫"]];
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
    ctx.fillText(fitText(lv.name, cw - 18), x + 9, y + ch - 8);
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
// old victory lap: one full-screen picture, and the level selector's strip over
// it. Nothing else — no HUD, no PLAY (index.html hides them on #hud.splash).
//
// DROP-IN ART: replace public/art/splash.webp and nothing here changes. The
// file is a stand-in shared with hex-clicker's win screen until Goomba's own
// splash is drawn (hex has its own copy, at art/hex-splash.webp — one picture
// today, two pictures the moment either game wants its own).
const splashImg = new Image();
let splashReady = false;
let splashSky = null; // the art's own edge colours, top to bottom — see below
splashImg.onload = () => {
  splashReady = true;
  splashSky = skyStops(splashImg, SKY_STOPS);
};
// BASE_URL, not a bare path: this app is served from /g00mBa/ and dev serves it
// from /, so the one absolute path that works in both is Vite's own.
splashImg.src = import.meta.env.BASE_URL + "art/splash.webp";

/** The art's own SIDE EDGE, sampled down its height into n colours — the sky to
 * continue past the picture with, in every direction, and the reason no colour
 * is picked by hand here or survives the art being replaced.
 *
 * The EDGE strip rather than the full row, because the sampled colour has to
 * meet the picture at its left and right sides, where the sky is; a full-row
 * average is the artist's sky mixed with whatever the picture has in the middle
 * of it, which at these heights is a moon. Two stops used to be enough when the
 * only slack was above and below, where the end rows ARE sky all the way
 * across. A ramp down the side has to follow the sky's own turns (this one
 * lightens into a horizon band low down), so it gets more than its endpoints.
 *
 * Each stop is one exact row squeezed to a pixel, so the ends of the ramp are
 * the picture's true first and last rows and the flat bands can share them. */
const SKY_STOPS = 24;
function skyStops(img, n) {
  const c = document.createElement("canvas");
  c.width = 2; c.height = n;
  const g = c.getContext("2d");
  const edge = Math.max(1, Math.round(img.width * 0.02)); // wide enough to average the grain out
  for (let i = 0; i < n; i++) {
    const y = Math.round((i / (n - 1)) * (img.height - 1));
    g.drawImage(img, 0, y, edge, 1, 0, i, 1, 1);
    g.drawImage(img, img.width - edge, y, edge, 1, 1, i, 1, 1);
  }
  const d = g.getImageData(0, 0, 2, n).data;
  const mid = (a, b) => (d[a] + d[b]) >> 1; // the two sides, averaged into one ramp
  return Array.from({ length: n }, (_, i) => {
    const l = i * 8, r = l + 4;
    return `rgb(${mid(l, r)},${mid(l + 1, r + 1)},${mid(l + 2, r + 2)})`;
  });
}

function drawSplash() {
  ctx.fillStyle = "#150a2a"; // until the art lands: the page's own background
  ctx.fillRect(0, 0, W, H);
  if (!splashReady) return;
  // The WHOLE picture, never cropped on either axis — whichever one binds. A
  // phone is much narrower than this picture is tall, so the width binds there
  // and the slack is above and below; a laptop is wider than the picture is
  // proportionally tall, so fitting the width would overflow the screen and eat
  // the top of the art, which is where the cat is. Height binds there instead.
  const s = Math.min(W / splashImg.width, H / splashImg.height);
  const w = splashImg.width * s, h = splashImg.height * s;
  const x = (W - w) / 2, y = (H - h) / 2;
  // The sky, continued into whichever slack there is, in ONE fill: the art's own
  // side edge as a ramp, pinned to the picture's top and bottom. Canvas clamps a
  // gradient past its ends, so the area above y comes out flat in the picture's
  // first row and below y + h flat in its last (the phone case), while the area
  // beside the art gets the ramp itself (the laptop case) — no branch, and the
  // two cases cannot disagree at the corners where they meet.
  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  splashSky.forEach((c, i) => sky.addColorStop(i / (splashSky.length - 1), c));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(splashImg, x, y, w, h);
}

// ---------- main loop ----------
const bandExcite = new Map(); // band index -> 0..1 wobble

function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (nowMs - (frame.last || nowMs)) / 1000); frame.last = nowMs;
  tGlobal += dt;
  if (editMsgT > 0) editMsgT = Math.max(0, editMsgT - dt);
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
  lv.cans.forEach((m, i) => drawCan(m[0], m[1], st ? st.got[i] : false, i));
  drawGoalPlant(lv, st);
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

// ---------- boot — no menu, same contract as hex ----------
const NAME_KEY = "escape-cats-name";

function boot() {
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
  gateStatusEl.textContent =
    "Waiting for your team — the proctor sorts you in, nothing to do here.";
  watchTeam({
    name,
    onTeam: (team, lobbyName) => {
      localStorage.setItem(NAME_KEY, lobbyName);
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
          }
        },
      });
    },
    onStatus: (up) => {
      gateErrEl.textContent = up ? "" : "Can't reach the server — check wifi?";
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
