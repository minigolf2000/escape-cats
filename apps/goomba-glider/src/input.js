// Input: three ways to lay a band, one way to take it back.
//
// A band is just two world points, so nothing forces one gesture on everyone:
//   · tap, then tap again — the anchor waits between them (calmest on a phone)
//   · one finger down, drag, release
//   · two fingers stretched apart
// Tapping a placed band takes it back; tapping an open anchor cancels it.
//
// There is no panning or zooming — the edit camera shows the whole level — so a
// tap always means "this point", never "scroll". While the levels grid is up
// every gesture belongs to it instead, and is forwarded straight through.
//
// `canEdit()` is the whole rule for laying a band, and the splash is not an
// edit phase, so no gesture here reaches the finale. Its own way out — a tap
// that opens the levels grid, once there are post-credits levels to reach — is
// wired in main.js, on the canvas, ahead of this.
//
// Nothing STREAMS any more. A half-drawn band used to go on the wire at 10Hz
// so teammates could watch the stretch (`transport.preview`, deleted with the
// room); `S.preview` and `S.anchor` are local, the renderer reads them off
// `S`, and there is nobody else to tell.

import { BAND_MIN, BAND_MAX, MAX_BANDS, snapBand, bandPoints } from "@escape-cats/shared";
import { transport } from "./transport";
import { cv } from "./dom";
import { S, L, bands, bandsOut, iMayPlace, toast } from "./state";
import { W, H, cam, ANCHOR_TTL } from "./render";
import {
  labPointerDown, labPointerMove, labPointerUp,
} from "./selector";

export const toWorld = (px, py) => ({ x: (px - W / 2) / cam.s + cam.x, y: (py - H / 2) / cam.s + cam.y });
const touches = new Map();
let mouseDrag = null;
let down = null;   // the single finger that's down: where it started, in both spaces
let mode = null;   // null | "tap" | "drag" | "stretch" — what this gesture became
const DRAG_SLOP = 10;    // px of travel that turns a press into a drag

const canEdit = () => S.snap && S.snap.phase === "edit";

/** The open anchor, or null once it has timed out. Anything that reads the
 * anchor goes through here so a forgotten tap can't place a band minutes
 * later. */
export function liveAnchor() {
  if (S.anchor && performance.now() - S.anchor.at > ANCHOR_TTL) closeAnchor();
  return S.anchor;
}
/** The anchor goes away, and so does everything drawn from it. */
function closeAnchor() {
  if (!S.anchor) return;
  S.anchor = null; S.preview = null;
}
/** Drop every in-flight gesture (phase change, level change, cancelled touch). */
export function resetInput() {
  touches.clear();
  S.preview = null; S.anchor = null; down = null; mode = null; mouseDrag = null;
}

function previewFrom(a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  S.preview = snapBand(L(), { ax: a.x, ay: a.y, bx: b.x, by: b.y });
  S.preview.ok = len >= BAND_MIN && len <= BAND_MAX && iMayPlace();
  S.preview.len = len;
}
function previewFromTouches() {
  const [p, q] = [...touches.values()];
  previewFrom(toWorld(p.cx, p.cy), toWorld(q.cx, q.cy));
}
function placePreview() {
  if (S.preview && S.preview.ok) {
    transport.send({ type: "place", ax: S.preview.ax, ay: S.preview.ay, bx: S.preview.bx, by: S.preview.by });
  } else {
    // Say why nothing landed — a tap-tap that silently does nothing reads as
    // a broken screen. (Too SHORT stays quiet: that's the cancel gesture.)
    if (S.preview && S.preview.len > BAND_MAX) toast("too stretchy! 🫨", 900);
    else if (S.preview && bandsOut() >= MAX_BANDS)
      // Short enough to fit a phone (#toast is one `nowrap` line). The way out
      // — tap a band to take it back — is the sheet's fourth picture, not this.
      toast("all 4 bands used! 😿", 1300);
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
  S.anchor = { x: w.x, y: w.y, at: performance.now() };
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
  if (!canEdit()) { resetInput(); return; }
  // A stretch places on the FIRST finger up; a drag places on its only one.
  if (S.preview && touches.size < 2) placePreview();
  if (mode === "tap" && touches.size === 0 && down) tapAt(down.w);
  if (touches.size === 0) { mode = null; down = null; }
}, { passive: false });
cv.addEventListener("touchcancel", resetInput);

// Mouse: click-drag stretches, click-click does the same tap-tap as a finger,
// with a live rubber line in between.
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
  else if (S.preview) S.preview = null; // anchor expired
});
window.addEventListener("mouseup", (e) => {
  if (S.labOpen) { labPointerUp(e.clientX, e.clientY); return; }
  if (!mouseDrag) return;
  const drag = mouseDrag;
  mouseDrag = null;
  if (!canEdit()) { S.preview = null; return; }
  if (drag.dragging) placePreview();
  else tapAt(toWorld(e.clientX, e.clientY));
});
