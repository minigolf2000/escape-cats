// The room's word, plus the local presentation that hangs off it. `S.snap` is
// the authority's latest snapshot; everything else is derived or local. Nothing
// here draws. `S` is one mutable object because several modules assign into it
// and an `export let` is read-only to importers.

import {
  GOOMBA_LEVELS,
  canPlaceBand,
  goombaCleared,
  initLevel,
} from "@escape-cats/shared";
import { debugFromUrl } from "./debug";
import { hudEl, toastEl } from "./dom";

export const S = {
  snap: null,          // latest GoombaSnapshot — the authority's word
  inited: false,       // has the first snapshot landed?
  preview: null,       // band being stretched right now, local only
  pending: null,       // optimistic ghost: sent to the server, not yet echoed
  anchor: null,        // first tap of a tap-tap placement, awaiting its end
  cam: { x: 0, y: 0, s: 10 },
  labOpen: false,      // levels grid showing?
  unlocked: false,     // `\` opened the door to the selector this session
  selected: null,      // the selected card; null = the trailing dashed slot
};

export const level = () => (S.snap ? S.snap.level : 0);
export const bands = () => (S.snap ? S.snap.bands : []);
export const now = () => Date.now(); // one tab, one clock

/**
 * A level to draw when the pack is EMPTY (not arrived yet, or the last one
 * deleted): keeps bounds, fitScale and the camera clamp finite.
 */
const NO_LEVELS = initLevel({
  name: "no levels yet — press \\ and paste one from Figma",
  start: [20, 20],
  goal: [80, 20],
  terrain: [[[0, 30], [100, 30]]],
  cans: [], cushions: [], pops: [], bumpers: [],
});
export const L = () => GOOMBA_LEVELS[level()] ?? NO_LEVELS;

// ---------- surfaces and modes ----------
/** `?debug` opens the level grid without having earned it — the power user's
 * way in, and nothing else. (`?solo` is gone: there is no other kind of game
 * to be the opposite of.) */
export const DEBUG = debugFromUrl();

/**
 * LAPTOP OR PHONE — one switch, two level grids (a phone taps to play; a
 * laptop selects, double-clicks, drags, pastes). Read LIVE, not latched at
 * boot: a tablet can gain a trackpad mid-party.
 */
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
export const DESKTOP = () => finePointer.matches;
/** Read the same way and for the same reason: a phone can change this while the
 * sheet is up. It stops the one piece of motion that TRAVELS. */
const calmMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
export const REDUCED = () => calmMotion.matches;

/**
 * WHO GETS THE LEVEL SELECTOR: a team that has CLEARED the game (room state,
 * so all phones unlock together and a reset takes it back). `?debug` and
 * `unlocked` (`\`) are local overrides of this one gate — a DOOR, not a mode:
 * never what the selector looks like once open.
 */
export const levelSelect = () =>
  DEBUG || S.unlocked || (S.snap !== null && goombaCleared(S.snap));

/**
 * Are the editing CONTROLS showing? (Not `canEdit` in input.js, which is the
 * run phase.) The SURFACE answers and NOTHING else does: a laptop always has
 * them, a phone never (it has no Ctrl+V to follow a delete with). No mode to
 * be in the wrong one of. Read LIVE, like DESKTOP.
 */
export const editorOn = () => DESKTOP();

// ---------- the band's colour ----------
// Every band wears ONE colour. It used to be the TEAM's, picked out of
// TEAM_EARS to match the proctor's board and the cat-ear headbands; with one
// player there is no team to be, so the old no-team pink is simply the colour.
// Kept as functions, not constants, because every caller already asks.
const BAND_INK = "#ff5db1";
const BAND_INK_DARK = "#b8437f"; // the same ink at 0.72, worked out once
export const bandInk = () => BAND_INK;
/** The darker under-stroke. */
export const bandInkDark = () => BAND_INK_DARK;

// The party palette: confetti, the ambient drift, the bunting. DECOR only —
// a band wears the team colour.
export const PARTY_COLORS = ["#ff5db1", "#57e6c9", "#ffd166", "#b18bff"];

// ---------- the 4 bands ----------
// Four bands for the room, no per-player share. Asked with the authority's own
// predicate so a gesture is refused BEFORE it goes on the wire. `pending`
// counts as placed, or a fast double-tap on the last free band shows a band
// that then vanishes.
export const bandsOut = () => bands().length + (S.pending ? 1 : 0);
export const iMayPlace = () =>
  canPlaceBand(S.pending ? [...bands(), S.pending] : bands());

// ---------- talking to the player ----------
let toastT = 0;
export function toast(msg, ms) {
  toastEl.textContent = msg; toastEl.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove("show"), ms || 1400);
}

/**
 * The one question this app asks, on the BROWSER's own `confirm()`: a delete,
 * and a paste whose name differs from what it lands on. Native because a paste
 * can land with the grid SHUT, and a canvas dialog needs a grid to draw on.
 */
export function askConfirm(title, body, onYes) {
  if (window.confirm(body ? `${title}\n\n${body}` : title)) onYes();
}

/* Why a run ended, on the toast — which is ONE `nowrap` line with no width
 * cap, so a line much past 300px runs off both edges of a phone. Short for
 * that reason and because this is a PUZZLE: naming the fault is the toast's
 * job, and working out the fix is the player's. */
export const FAIL_MSG = {
  fall: "Goomba fell! 🙀", left: "she rolled away! 🙀", flew: "overshot the party! 🙀",
  stall: "ran out of zoom… 😿", loop: "she’s stuck! 😹",
  timeout: "she’s stuck! 😹",
};
