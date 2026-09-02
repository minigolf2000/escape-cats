// The room's word, plus the local presentation that hangs off it. `S.snap` is
// the authority's latest snapshot; everything else is derived or local. Nothing
// here draws. `S` is one mutable object because several modules assign into it
// and an `export let` is read-only to importers.

import {
  GOOMBA_LEVELS,
  canPlaceBand,
  earsFor,
  goombaCleared,
  initLevel,
} from "@escape-cats/shared";
import { debugFromUrl, soloFromUrl } from "./debug";
import { hudEl, toastEl } from "./dom";

export const S = {
  snap: null,          // latest GoombaSnapshot — the authority's word
  serverOffset: 0,     // serverTime - Date.now(), from the last snapshot
  inited: false,       // has the first snapshot landed?
  myTeam: null,        // a team id doubles as its room id; set before the first snapshot
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
export const now = () => Date.now() + S.serverOffset; // the room's shared clock

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
export const DEBUG = debugFromUrl(); // selector override (?debug = your room)
export const SOLO = soloFromUrl();   // serverless backend for the same menu

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

// ---------- the team's colour ----------
// Every band wears ONE colour, the TEAM's — the same ink as the proctor's board
// and the cat-ear headband (TEAM_EARS in shared/ears.ts).
/** The testing room (t0) is not a team and ?solo has no lobby. */
const NO_TEAM_INK = "#ff5db1";
export const bandInk = () => earsFor(S.myTeam)?.ink ?? NO_TEAM_INK;
/** The darker under-stroke, derived rather than tabled per team. */
const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
  return "#" + ch.map((v) => v.toString(16).padStart(2, "0")).join("");
};
let inkShade = { ink: null, dark: NO_TEAM_INK };
export const bandInkDark = () => {
  const ink = bandInk();
  if (inkShade.ink !== ink) inkShade = { ink, dark: shade(ink, 0.72) };
  return inkShade.dark;
};

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

export const FAIL_MSG = {
  fall: "Goomba fell! 🙀", left: "she rolled away! 🙀", flew: "overshot the party! 🙀",
  stall: "ran out of zoom… 😿", loop: "she’s stuck! try different bands 😹",
  timeout: "she’s stuck! try different bands 😹",
};
