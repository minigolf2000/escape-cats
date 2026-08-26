// Input: three ways to lay a band, one way to take it back.
//
// A band is just two world points, so nothing forces one gesture on everyone:
//   · tap, then tap again — the anchor waits between them (calmest on a phone)
//   · one finger down, drag, release
//   · two fingers stretched apart (the original)
// Tapping a placed band takes it back; tapping an open anchor cancels it.
//
// There is no panning or zooming — the edit camera shows the whole level — so a
// tap always means "this point", never "scroll". While the levels grid is up
// every gesture belongs to it instead, and is forwarded straight through.

import { BAND_MIN, BAND_MAX, MAX_BANDS, snapBand, bandPoints } from "@escape-cats/shared";
import { transport } from "./net";
import { cv } from "./dom";
import { S, L, bands, bandsOut, iMayPlace, toast } from "./state";
import { W, H, cam, ANCHOR_TTL } from "./render";
import {
  labPointerDown, labPointerMove, labPointerUp, openSelector,
} from "./selector";

export const toWorld = (px, py) => ({ x: (px - W / 2) / cam.s + cam.x, y: (py - H / 2) / cam.s + cam.y });
const touches = new Map();
let mouseDrag = null;
let down = null;   // the single finger that's down: where it started, in both spaces
let mode = null;   // null | "tap" | "drag" | "stretch" — what this gesture became
const DRAG_SLOP = 10;    // px of travel that turns a press into a drag
const ANCHOR_BEAT_MS = 1200; // re-send it this often; the room forgets ghosts at 3s

const canEdit = () => S.snap && S.snap.phase === "edit";

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
export function splashTap() {
  if (S.labOpen || !S.snap || S.snap.phase !== "splash") return false;
  openSelector();
  return true;
}

/** The open anchor, or null once it has timed out. Anything that reads the
 * anchor goes through here so a forgotten tap can't place a band minutes
 * later. */
export function liveAnchor() {
  if (S.anchor && performance.now() - S.anchor.at > ANCHOR_TTL) closeAnchor();
  return S.anchor;
}
/** Teammates see the waiting tap as a degenerate preview — both ends on the
 * one point — which the wire already carries and everyone already draws
 * (see GoombaBandPreview). Re-sent on a heartbeat because the room expires a
 * ghost after 3s and an anchor may wait for 8. */
export function streamAnchor() {
  if (!S.anchor) return;
  S.anchor.sentAt = performance.now();
  transport.preview({ ax: S.anchor.x, ay: S.anchor.y, bx: S.anchor.x, by: S.anchor.y });
}
/** Keep an open anchor alive on every teammate's phone: the room expires a ghost
 * after 3s and an anchor may wait for 8. Called from the frame that draws it. */
export function heartbeatAnchor(a) {
  if (performance.now() - a.sentAt > ANCHOR_BEAT_MS) streamAnchor();
}
/** The anchor goes away and so does everything drawn from it, here and on
 * every teammate's phone. */
function closeAnchor() {
  if (!S.anchor) return;
  S.anchor = null; S.preview = null;
  transport.preview(null);
}
/** Drop every in-flight gesture (phase change, level change, cancelled touch). */
export function resetInput() {
  if (S.preview || S.anchor) transport.preview(null);
  touches.clear();
  S.preview = null; S.anchor = null; down = null; mode = null; mouseDrag = null;
}

function previewFrom(a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  S.preview = snapBand(L(), { ax: a.x, ay: a.y, bx: b.x, by: b.y });
  S.preview.ok = len >= BAND_MIN && len <= BAND_MAX && iMayPlace();
  S.preview.len = len;
  // Teammates watch the stretch live — send what I'm seeing (snapped).
  transport.preview({ ax: S.preview.ax, ay: S.preview.ay, bx: S.preview.bx, by: S.preview.by });
}
function previewFromTouches() {
  const [p, q] = [...touches.values()];
  previewFrom(toWorld(p.cx, p.cy), toWorld(q.cx, q.cy));
}
function placePreview() {
  if (S.preview && S.preview.ok) {
    // The server snaps again (authoritatively); the ghost bridges the gap.
    // Placing also clears my streamed preview server-side, so no extra send.
    // The ghost goes up BEFORE the send: ?solo answers synchronously, and a
    // ghost set afterwards would outlive the snapshot that should retire it —
    // which is what used to eat the 4th band in the lab.
    S.pending = { ax: S.preview.ax, ay: S.preview.ay, bx: S.preview.bx, by: S.preview.by };
    transport.send({ type: "place", ax: S.preview.ax, ay: S.preview.ay, bx: S.preview.bx, by: S.preview.by });
  } else {
    // Say why nothing landed — a tap-tap that silently does nothing reads as
    // a broken screen. (Too SHORT stays quiet: that's the cancel gesture.)
    if (S.preview && S.preview.len > BAND_MAX) toast("too stretchy! 🫨", 900);
    else if (S.preview && bandsOut() >= MAX_BANDS)
      toast("all 4 bands are out! 🫰 tap one to take it back", 1300);
    transport.preview(null); // gesture ended without a placement
  }
  S.preview = null;
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
    S.anchor = null; // the preview + place below supersede the marker, no clear
    previewFrom(a, w);
    placePreview();
    return;
  }
  if (tryDelete(w)) return;
  S.anchor = { x: w.x, y: w.y, at: performance.now(), sentAt: 0 };
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
  if (S.labOpen) { const t = e.changedTouches[0]; labPointerDown(t.clientX, t.clientY); return; }
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
    mode = "stretch"; down = null; S.anchor = null;
    previewFromTouches();
  }
}, { passive: false });
cv.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (S.labOpen) { const t = e.changedTouches[0]; labPointerMove(t.clientX, t.clientY); return; }
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
    mode = "drag"; S.anchor = null; // dragging supersedes a half-finished tap-tap
  }
  if (mode === "drag") previewFrom(down.w, toWorld(t.cx, t.cy));
}, { passive: false });
cv.addEventListener("touchend", (e) => {
  e.preventDefault();
  if (S.labOpen) { const t = e.changedTouches[0]; labPointerUp(t.clientX, t.clientY); return; }
  for (const t of e.changedTouches) touches.delete(t.identifier);
  if (splashTap()) return;
  if (!canEdit()) { resetInput(); return; }
  // A stretch places on the FIRST finger up; a drag places on its only one.
  if (S.preview && touches.size < 2) placePreview();
  if (mode === "tap" && touches.size === 0 && down) tapAt(down.w);
  if (touches.size === 0) { mode = null; down = null; }
}, { passive: false });
cv.addEventListener("touchcancel", resetInput);

// Mouse (desktop + the design bench): click-drag stretches, click-click does
// the same tap-tap as a finger, with a live rubber line in between.
cv.addEventListener("mousedown", (e) => {
  if (S.labOpen) { labPointerDown(e.clientX, e.clientY); return; }
  if (!canEdit()) return;
  mouseDrag = { a: toWorld(e.clientX, e.clientY), px: e.clientX, py: e.clientY, dragging: false };
});
window.addEventListener("mousemove", (e) => {
  if (S.labOpen) { labPointerMove(e.clientX, e.clientY); return; }
  if (!canEdit()) return;
  if (mouseDrag) {
    if (Math.hypot(e.clientX - mouseDrag.px, e.clientY - mouseDrag.py) > DRAG_SLOP) {
      mouseDrag.dragging = true; S.anchor = null;
    }
    if (mouseDrag.dragging) previewFrom(mouseDrag.a, toWorld(e.clientX, e.clientY));
    return;
  }
  const a = liveAnchor();
  if (a) previewFrom(a, toWorld(e.clientX, e.clientY)); // band follows the cursor
  else if (S.preview) { S.preview = null; transport.preview(null); } // anchor expired
});
window.addEventListener("mouseup", (e) => {
  if (S.labOpen) { labPointerUp(e.clientX, e.clientY); return; }
  if (splashTap()) return;
  if (!mouseDrag) return;
  const drag = mouseDrag;
  mouseDrag = null;
  if (!canEdit()) { S.preview = null; return; }
  if (drag.dragging) placePreview();
  else tapAt(toWorld(e.clientX, e.clientY));
});
