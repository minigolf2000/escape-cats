// The room's word, plus the local presentation that hangs off it.
//
// The server (or the ?solo sim) is authoritative: `S.snap` is the latest
// snapshot and everything else here is either derived from it or is this
// phone's own business. Nothing in this file draws.
//
// `S` is a mutable object rather than a set of `let`s because more than one
// module assigns these — input.js owns the in-flight band, main.js owns the
// snapshot — and an `export let` is read-only to whoever imports it.

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
 * A level to draw when the pack is EMPTY.
 *
 * The pack lives in the lobby and arrives over the room socket, so "we have not
 * been told any levels yet" and "someone deleted the last one" are both real
 * states this screen has to paint. A flat floor with the start on it keeps every
 * measurement finite (bounds, fitScale, the camera clamp) instead of scattering
 * null checks through the renderer.
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
 * LAPTOP OR PHONE — one switch, two different level grids.
 *
 * A phone taps a card and the whole room jumps there, and that is the whole
 * screen. A laptop gets a file browser: click selects, double-click plays, drag
 * reorders, Ctrl+V lands on the selection. Read LIVE rather than latched at
 * boot, so a tablet that gains a trackpad mid-party gets the editor with no
 * reload.
 */
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
export const DESKTOP = () => finePointer.matches;
/** Read the same way and for the same reason: a phone can change this while the
 * sheet is up. It stops the one piece of motion that TRAVELS. */
const calmMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
export const REDUCED = () => calmMotion.matches;

/**
 * WHO GETS THE LEVEL SELECTOR: a team that has CLEARED the game. That is room
 * state off the snapshot, so all four phones unlock on the same message and a
 * proctor reset takes it back. `?debug` is nothing more than a local override of
 * this one gate, and `unlocked` is the other one — that is the whole of what
 * `\` does. It is a DOOR, not a mode: it decides whether you are looking at the
 * selector, never what the selector looks like once you are.
 */
export const levelSelect = () =>
  DEBUG || S.unlocked || (S.snap !== null && goombaCleared(S.snap));

/**
 * Are the editing CONTROLS showing? (Not `canEdit` in input.js, which is about
 * the run phase.) The SURFACE answers, and nothing else does: a laptop always
 * has them, a phone never does. There is no mode here to be in the wrong one
 * of, which is the point — the grid a machine shows is the only grid it shows,
 * so the person who typed `\` and the person who cleared the game are looking
 * at the same screen, and neither can end up on a laptop grid with the ⌫ and
 * the drag quietly missing.
 *
 * A phone is out because the controls are unusable there, not because it is
 * untrusted: a delete wants a Ctrl+V to follow it up with, and a phone has no
 * Ctrl+V. Read LIVE, like DESKTOP itself, so a tablet that gains a trackpad
 * mid-party gets them with no reload.
 */
export const editorOn = () => DESKTOP();

// ---------- the team's colour ----------
// A band belongs to the ROOM, not to whoever laid it, so every band wears one
// colour: the TEAM's — the same ink as the proctor's board and the cat-ear
// headband on the table (TEAM_EARS in shared/ears.ts).
/** The testing room (t0) is not a team and ?solo has no lobby; both fall back to
 * the pink bands wore when a band's colour meant a roster slot. */
const NO_TEAM_INK = "#ff5db1";
export const bandInk = () => earsFor(S.myTeam)?.ink ?? NO_TEAM_INK;
/** The darker under-stroke. Derived rather than tabled: a second hand-picked
 * shade per team is a thing to keep in sync for no gain. 0.72 is where the old
 * hand-picked pairs sat (#ff5db1 → #c23a85 and friends). */
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

// The party palette: confetti, the ambient drift, the bunting. DECOR, and
// nothing else — it used to double as "one colour per roster slot", which is
// the job the team colour has taken over.
export const PARTY_COLORS = ["#ff5db1", "#57e6c9", "#ffd166", "#b18bff"];

// ---------- the 4 bands ----------
// Four bands for the room and no per-player share of them: anyone may lay any of
// the four and take any back. So the only question is whether one is free, asked
// with the authority's own predicate so a gesture is refused BEFORE it goes on
// the wire — a tap that silently does nothing reads as a broken screen.
//
// `pending` counts as placed: without it a fast double-tap on the last free band
// sends a second one the room throws away, and the phone shows a band that then
// vanishes.
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
 * The one question this app asks, and it is the BROWSER's. It guards the two
 * edits that cannot be taken back — a delete, and a paste over a level it does
 * not look like.
 *
 * Native rather than the canvas dialog it used to be, precisely because a paste
 * can now land with the grid SHUT, and a canvas-drawn question needs a grid to
 * be drawn on. `confirm()` also blocks, so nothing has to hold a callback open
 * across frames.
 */
export function askConfirm(title, body, onYes) {
  if (window.confirm(body ? `${title}\n\n${body}` : title)) onYes();
}

export const FAIL_MSG = {
  fall: "Goomba fell! 🙀", left: "she rolled away! 🙀", flew: "overshot the party! 🙀",
  stall: "ran out of zoom… 😿", loop: "she’s stuck! try different bands 😹",
  timeout: "she’s stuck! try different bands 😹",
};
