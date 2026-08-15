// Goomba Rider, multiplayer client. The rendering and input are the
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
  scoreRun,
} from "@escape-cats/shared";
import { connectRoom, watchTeam, transport, playerId } from "./net";
import { debugFromUrl, soloFromUrl, startDebug } from "./debug";

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
const BAND_COLORS = ["#ff5db1", "#57e6c9", "#ffd166", "#b18bff"];
const BAND_DARK = ["#c23a85", "#2fae95", "#d0a53e", "#7f5ad9"];
const EZ = 1.15, RZ = 1.9; // edit/run zoom (the prototype's tuned defaults)

const DEBUG = debugFromUrl(); // debug menu on (?debug = in your room, ?solo = local)
const SOLO = soloFromUrl();   // serverless backend for the same menu
let labOpen = false;        // lab grid showing? (?debug only)
// A card tap is a wire intent, so the room answers a round trip later. Closing
// the lab on the tap would uncover the OLD level for that gap and then swap it
// under the player — so the tap only LATCHES, and the lab stays up until the
// authority's snapshot lands on the chosen level. The timeout is the escape
// hatch for an intent the room never echoes (dropped socket, proctor seat).
let labJump = null;         // { level, timer } — tapped, awaiting the authority
const LAB_JUMP_MS = 1500;
function setLab(open) {
  labOpen = open;
  document.getElementById("hud").classList.toggle("lab", open);
  if (!open) clearLabJump();
}
function clearLabJump() {
  if (labJump) clearTimeout(labJump.timer);
  labJump = null;
}
let labCells = [];          // hit targets for the lab's cards
const labVerdicts = new Map(); // level idx -> {bare, sol, ok} from the real sim

let snap = null;            // latest GoombaSnapshot — the authority's word
let serverOffset = 0;       // serverTime - Date.now(), from the last snapshot
let shownPhase = "edit";    // what the presentation last acted on (edge detection)
let shownLevel = -1;
let shownRunId = 0;

let anim = null;            // { key, st } — the local replay of the scored run
let winFx = false;          // confetti fired for the current win
let preview = null;         // band being stretched right now, local only
let pending = null;         // optimistic ghost: sent to the server, not yet echoed
let tGlobal = 0, toastT = 0, shake = 0;
let cam = { x: 0, y: 0, s: 10 }, pan = { x: 0, y: 0 }, panning = false;
let parts = [], confetti = [], cushAnim = [], popPrev = null;

const $ = (id) => document.getElementById(id);
const lvlEl = $("lvl"), hintEl = $("hint"), dotsEl = $("dots"), invEl = $("inv"),
  teamEl = $("team"), playBtn = $("play"), clearBtn = $("clear"), toastEl = $("toast"),
  gateEl = $("gate"), gateStatusEl = $("gateStatus"), gateErrEl = $("gateErr"),
  connEl = $("conn");

const level = () => (snap ? snap.level : 0);
const L = () => GOOMBA_LEVELS[level()];
const bands = () => (snap ? snap.bands : []);
const now = () => Date.now() + serverOffset; // the room's shared clock

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
  if (first || wasReset || levelChanged) {
    // Fresh footing: recenter the camera, drop run debris.
    const b = L().bounds;
    pan = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    Object.assign(cam, clampCam(pan.x, pan.y, fitScale(L()) * EZ, b));
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
  const lv = L();
  lvlEl.textContent = lv.name;
  const done = s.completed.filter(Boolean).length;
  // Levels carry a title and nothing else — the only line here is the win
  // banner; editing and running say nothing.
  hintEl.textContent =
    s.phase === "win"
      ? (done === s.levelCount ? "ALL LEVELS CLEAR! 🎉🎂" : "LEVEL CLEAR! 🎉")
      : "";

  dotsEl.innerHTML = "";
  s.completed.forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "dot" + (i === s.level ? " cur" : c ? " done" : "");
    if (DEBUG) d.onclick = () => { if (s.phase !== "run") transport.send({ type: "goto", level: i }); };
    dotsEl.appendChild(d);
  });

  // The 4 band slots — the locked team budget. Filled slots wear the OWNER's
  // colour, so the row doubles as "who has placed".
  invEl.innerHTML = "";
  for (let i = 0; i < MAX_BANDS; i++) {
    const el = document.createElement("div");
    const bd = s.bands[i];
    el.className = "band" + (bd ? " used" : "");
    if (bd) {
      el.style.borderColor = BAND_COLORS[bd.slot % 4];
      el.style.background = BAND_COLORS[bd.slot % 4] + "33";
    }
    invEl.appendChild(el);
  }

  // Roster line: teammates in slot colours; my own name bold.
  const pid = playerId();
  teamEl.innerHTML = s.players
    .map((p, i) => {
      const name = escapeHtml(p.name);
      const col = BAND_COLORS[i % 4];
      const body = p.id === pid ? `<b>${name}</b>` : name;
      return `<span class="${p.connected ? "" : "off"}" style="color:${col}">${body}</span>`;
    })
    .join(" · ");

  playBtn.textContent =
    s.phase === "run" ? "■ STOP" :
    s.phase === "win" ? (done === s.levelCount ? "↺ AGAIN" : "NEXT ▸") : "▶ PLAY";
  playBtn.className = s.phase === "run" ? "stop" : s.phase === "win" ? "next" : "";
  clearBtn.style.display = s.phase === "edit" && s.bands.length ? "" : "none";
}
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

playBtn.onclick = () => {
  if (!snap) return;
  if (snap.phase === "edit") transport.send({ type: "play" });
  else if (snap.phase === "run") transport.send({ type: "stop" });
  else if (snap.phase === "win") transport.send({ type: "next" });
};
clearBtn.onclick = () => transport.send({ type: "clear" });
const labBtn = $("lab");
labBtn.onclick = () => {
  if (!DEBUG) return;
  if (snap && snap.phase === "run") transport.send({ type: "stop" });
  setLab(true);
};
window.addEventListener("keydown", (e) => {
  if (e.key === " ") { e.preventDefault(); playBtn.onclick(); }
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
      c: BAND_COLORS[i % 4], r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 10,
      life: 2.2 + Math.random(),
    });
    toast(s.completed.filter(Boolean).length === s.levelCount ? "ALL LEVELS CLEAR! 🎉🎂" : "LEVEL CLEAR! 🎉", 1800);
  }
  return st;
}

// ---------- input: two fingers stretch a band; one finger pans ----------
const toWorld = (px, py) => ({ x: (px - W / 2) / cam.s + cam.x, y: (py - H / 2) / cam.s + cam.y });
const touches = new Map();
let mouseDrag = null, tapInfo = null;

const canEdit = () => snap && snap.phase === "edit";

function previewFrom(a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  preview = snapBand(L(), { ax: a.x, ay: a.y, bx: b.x, by: b.y });
  preview.ok = len >= BAND_MIN && len <= BAND_MAX &&
    bands().length + (pending ? 1 : 0) < MAX_BANDS;
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
    transport.send({ type: "place", ax: preview.ax, ay: preview.ay, bx: preview.bx, by: preview.by });
    pending = { ax: preview.ax, ay: preview.ay, bx: preview.bx, by: preview.by };
  } else {
    if (preview && preview.len > BAND_MAX) toast("too stretchy! 🫨", 900);
    transport.preview(null); // drag ended without a placement
  }
  preview = null;
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
  if (labOpen) { const t = e.changedTouches[0]; labTap(t.clientX, t.clientY); return; }
  if (!canEdit()) return;
  for (const t of e.changedTouches) touches.set(t.identifier, { cx: t.clientX, cy: t.clientY });
  if (touches.size === 1) {
    const t = e.changedTouches[0];
    tapInfo = { x: t.clientX, y: t.clientY, t: performance.now() };
    panning = false;
  }
  if (touches.size === 2) { tapInfo = null; panning = false; previewFromTouches(); }
}, { passive: false });
cv.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (!canEdit()) return;
  for (const t of e.changedTouches) {
    const rec = touches.get(t.identifier);
    if (!rec) continue;
    if (touches.size === 1) {
      if (tapInfo && Math.hypot(t.clientX - tapInfo.x, t.clientY - tapInfo.y) > 10)
        { panning = true; tapInfo = null; }
      if (panning) {
        pan.x -= (t.clientX - rec.cx) / cam.s;
        pan.y -= (t.clientY - rec.cy) / cam.s;
      }
    }
    rec.cx = t.clientX; rec.cy = t.clientY;
  }
  if (touches.size === 2) previewFromTouches();
}, { passive: false });
cv.addEventListener("touchend", (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) touches.delete(t.identifier);
  if (!canEdit()) { touches.clear(); return; }
  if (preview && touches.size < 2) placePreview();
  if (tapInfo && touches.size === 0) {
    const t = e.changedTouches[0];
    if (performance.now() - tapInfo.t < 300 && Math.hypot(t.clientX - tapInfo.x, t.clientY - tapInfo.y) < 12)
      tryDelete(toWorld(t.clientX, t.clientY));
    tapInfo = null;
  }
  if (touches.size === 0) panning = false;
}, { passive: false });
cv.addEventListener("touchcancel", () => {
  if (preview) transport.preview(null);
  touches.clear(); preview = null; tapInfo = null; panning = false;
});

cv.addEventListener("mousedown", (e) => {
  if (labOpen) { labTap(e.clientX, e.clientY); return; }
  if (!canEdit()) return;
  mouseDrag = { a: toWorld(e.clientX, e.clientY), px: e.clientX, py: e.clientY, t: performance.now() };
});
window.addEventListener("mousemove", (e) => {
  if (!mouseDrag || !canEdit()) return;
  if (Math.hypot(e.clientX - mouseDrag.px, e.clientY - mouseDrag.py) > 10)
    previewFrom(mouseDrag.a, toWorld(e.clientX, e.clientY));
});
window.addEventListener("mouseup", (e) => {
  if (!mouseDrag) return;
  if (canEdit()) {
    if (preview) placePreview();
    else if (performance.now() - mouseDrag.t < 350) tryDelete(toWorld(e.clientX, e.clientY));
  }
  mouseDrag = null; preview = null;
});
cv.addEventListener("wheel", (e) => {
  if (!canEdit()) return;
  e.preventDefault();
  pan.x += e.deltaX / cam.s; pan.y += e.deltaY / cam.s;
}, { passive: false });

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
  c: BAND_COLORS[i % 4], vy: 6 + Math.random() * 12, sway: Math.random() * 6.28,
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
      const c = BAND_COLORS[(i + row) % 4];
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

function drawBand(bd, colorIdx, excite, ghost) {
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
  ctx.strokeStyle = bad ? "#ff4a4a" : BAND_DARK[colorIdx];
  if (ghost) ctx.setLineDash(bad ? [6, 6] : []);
  ctx.lineWidth = 1.5 * cam.s; path(); ctx.stroke();
  ctx.strokeStyle = bad ? "#ff8f8f" : BAND_COLORS[colorIdx];
  ctx.lineWidth = 0.8 * cam.s; path(); ctx.stroke();
  ctx.setLineDash([]);
  for (const [x, y] of [pts[0], pts[8]]) {
    ctx.fillStyle = BAND_COLORS[colorIdx];
    ctx.beginPath(); ctx.arc(sxp(x), syp(y), 0.9 * cam.s, 0, 6.28); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath(); ctx.arc(sxp(x) - 0.25 * cam.s, syp(y) - 0.25 * cam.s, 0.3 * cam.s, 0, 6.28); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** A teammate's band-in-progress: same sagging shape as a real band, but
 * translucent with marching dashes and hollow endpoint rings — reads as
 * "being dragged", never as "placed". */
function drawTeammatePreview(p) {
  const pts = bandPoints(p);
  const col = BAND_COLORS[p.slot % 4];
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

function drawPlant(mx, my, taken, i) {
  if (taken) return;
  const u = Math.max(cam.s, 2.2), x = sxp(mx), y = syp(my);
  const sway = Math.sin(tGlobal * 2.2 + i * 1.7) * 0.08;
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = "rgba(87,230,201,0.13)";
  ctx.beginPath(); ctx.arc(0, -1.2 * u, 4.6 * u, 0, 6.28); ctx.fill();
  ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 0.4 * u; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-1.5 * u, 1.0 * u); ctx.lineTo(-1.1 * u, 2.6 * u);
  ctx.lineTo(1.1 * u, 2.6 * u); ctx.lineTo(1.5 * u, 1.0 * u); ctx.closePath(); ctx.stroke();
  ctx.strokeStyle = "#57e6c9"; ctx.lineWidth = 0.42 * u;
  ctx.rotate(sway);
  for (const [bx, h, lean] of [[-1.0, 3.4, -0.55], [-0.35, 4.6, -0.15], [0.3, 4.0, 0.3], [0.95, 3.0, 0.6]]) {
    ctx.beginPath();
    ctx.moveTo(bx * u, 1.0 * u);
    ctx.quadraticCurveTo((bx + lean * 0.4) * u, (1.0 - h * 0.6) * u, (bx + lean) * u, (1.0 - h) * u);
    ctx.stroke();
  }
  ctx.restore();
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

function drawCake(lv, st) {
  const x = sxp(lv.goal[0]), y = syp(lv.goal[1]), u = Math.max(cam.s, 2.6);
  const pulse = 1 + Math.sin(tGlobal * 3) * 0.05;
  ctx.save(); ctx.translate(x, y + 2 * u); ctx.scale(pulse, pulse);
  ctx.fillStyle = "rgba(255,209,102,0.12)";
  ctx.beginPath(); ctx.arc(0, -2 * u, 7.5 * u, 0, 6.28); ctx.fill();
  ctx.fillStyle = "#cfc4ec"; ctx.beginPath(); ctx.ellipse(0, 0.4 * u, 4.6 * u, 0.8 * u, 0, 0, 6.28); ctx.fill();
  ctx.fillStyle = "#ff9dce"; ctx.beginPath(); ctx.roundRect(-3.6 * u, -2.6 * u, 7.2 * u, 3 * u, 0.8 * u); ctx.fill();
  ctx.fillStyle = "#ffd166"; ctx.beginPath(); ctx.roundRect(-2.4 * u, -4.6 * u, 4.8 * u, 2.2 * u, 0.7 * u); ctx.fill();
  ctx.fillStyle = "#fff";
  for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.arc(i * u, -2.6 * u, 0.55 * u, 0, 6.28); ctx.fill(); }
  ctx.fillStyle = "#57e6c9"; ctx.fillRect(-0.3 * u, -6.2 * u, 0.6 * u, 1.6 * u);
  const fl = 1 + Math.sin(tGlobal * 11) * 0.25;
  ctx.fillStyle = "#ffb54a";
  ctx.beginPath(); ctx.ellipse(0, -6.8 * u, 0.45 * u * fl, 0.8 * u * fl, 0, 0, 6.28); ctx.fill();
  ctx.restore();
  const left = lv.plants.length - (st ? st.gotN : 0);
  if (left > 0) {
    ctx.save(); ctx.translate(x, y - 9.5 * u);
    ctx.fillStyle = "rgba(20,10,45,0.85)";
    ctx.beginPath(); ctx.roundRect(-3.4 * u, -1.6 * u, 6.8 * u, 3.2 * u, 1.2 * u); ctx.fill();
    ctx.strokeStyle = "#57e6c9"; ctx.lineWidth = 0.28 * u; ctx.stroke();
    ctx.fillStyle = "#57e6c9";
    ctx.font = `700 ${2.3 * u}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🌱" + left, 0, 0.1 * u);
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

// ---------- the LEVELS menu (?debug) ----------
// The deleted prototype's lab view, on the shipped sim: every level as a card
// with live verdicts (bare must NOT win, the solution must) — tap one to play
// it locally. Design triage on any phone, straight from the deployed site.
function labVerdict(i) {
  if (!labVerdicts.has(i)) {
    const lv = GOOMBA_LEVELS[i];
    const bare = scoreRun(i, []).result;
    const sol = lv.solution && lv.solution.length
      ? scoreRun(i, lv.solution.map(([a, b]) => snapBand(lv, { ax: a[0], ay: a[1], bx: b[0], by: b[1] }))).result
      : null;
    labVerdicts.set(i, { bare, sol, ok: bare !== "win" && sol === "win" });
  }
  return labVerdicts.get(i);
}
/** Ellipsise `s` to at most `maxW` px in the current ctx font. */
function fitText(s, maxW) {
  if (ctx.measureText(s).width <= maxW) return s;
  let n = s.length;
  while (n > 1 && ctx.measureText(s.slice(0, n) + "…").width > maxW) n--;
  return s.slice(0, n) + "…";
}
function labTap(px, py) {
  for (const c of labCells) {
    if (px < c.x || px > c.x + c.w || py < c.y || py > c.y + c.h) continue;
    // Latch BEFORE sending: the ?solo backend answers inside send(), and that
    // synchronous snapshot is what closes the lab. Tapping again retargets.
    clearLabJump();
    labJump = {
      level: c.i,
      timer: setTimeout(() => { labJump = null; setLab(false); }, LAB_JUMP_MS),
    };
    transport.send({ type: "goto", level: c.i });
    return;
  }
}
function drawLab() {
  ctx.fillStyle = "#100722"; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.font = "700 15px ui-rounded, system-ui, sans-serif";
  ctx.fillStyle = "#f2ecff";
  ctx.fillText("Levels", 16, 30);
  ctx.font = "12px ui-rounded, system-ui, sans-serif";
  ctx.fillStyle = "#8a80b0";
  ctx.fillText(SOLO ? "tap a card to play it locally — no server, no room"
                    : "tap a card to jump the whole room there", 16, 48);

  const cols = W > H ? 3 : 2;
  const rows = Math.ceil(GOOMBA_LEVELS.length / cols);
  const padX = 12, top = 62, bottom = 24;
  const cw = (W - padX * (cols + 1)) / cols;
  const ch = Math.min((H - top - bottom - 12 * (rows - 1)) / rows, cw * 1.5);
  labCells = [];
  const savedCam = { ...cam };
  GOOMBA_LEVELS.forEach((lv, i) => {
    const c = i % cols, r = (i / cols) | 0;
    const x = padX + c * (cw + padX), y = top + r * (ch + 12);
    labCells.push({ i, x, y, w: cw, h: ch });
    const v = labVerdict(i);
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
    lv.plants.forEach((m, k) => drawPlant(m[0], m[1], false, k));
    drawCake(lv, null);
    (lv.solution || []).forEach((sol, k) => drawBand(
      snapBand(lv, { ax: sol[0][0], ay: sol[0][1], bx: sol[1][0], by: sol[1][1] }), k % 4, 0, false));
    camOX = camOY = 0;
    ctx.restore();
    // frame + labels
    const jumping = labJump !== null && i === labJump.level;
    const current = snap !== null && i === snap.level;
    ctx.strokeStyle = jumping ? "#57e6c9" : current ? "#ffd166" : "rgba(201,189,240,0.22)";
    ctx.lineWidth = jumping || current ? 2.5 : 1.5;
    ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 12); ctx.stroke();
    ctx.font = "700 12px ui-rounded, system-ui, sans-serif";
    ctx.fillStyle = "#f2ecff";
    // The title is all a card says, so trim to the card's real width rather
    // than a guessed character count.
    ctx.fillText(fitText(lv.name, cw - 18), x + 9, y + ch - 8);
    ctx.font = "10px ui-rounded, system-ui, sans-serif";
    ctx.fillStyle = v.ok ? "#57e6c9" : "#ff8f8f";
    ctx.fillText(`${v.ok ? "✓" : "✗"} bare:${v.bare} · sol:${v.sol ?? "none"}`, x + 9, y + 16);
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
  });
  Object.assign(cam, savedCam);
}

// ---------- main loop ----------
const bandExcite = new Map(); // band index -> 0..1 wobble

function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (nowMs - (frame.last || nowMs)) / 1000); frame.last = nowMs;
  tGlobal += dt;
  if (!snap) return;
  if (labOpen) { drawLab(); return; }
  const lv = L();
  const st = syncAnim();
  const riding = st && snap.phase === "run";

  // Ride effects, driven off the local replay exactly as the prototype drove
  // them off its local run.
  if (st) {
    if (riding && st.onBand >= 0 && Math.random() < 0.5) {
      const bd = bands()[st.onBand];
      parts.push({ x: st.p.x, y: st.p.y + R, vx: -st.v.x * 0.15, vy: -12,
                   c: BAND_COLORS[bd ? bd.slot % 4 : 0], life: 0.5 });
    }
    st.cushHits.forEach((h, i) => { if (h) { cushAnim[i] = 1; st.cushHits[i] = 0; } });
    st.popT.forEach((t, i) => {
      if (popPrev && t !== popPrev[i]) {
        const pp = lv.pops[i];
        for (let k = 0; k < 22; k++) confetti.push({
          x: pp.x, y: pp.y,
          vx: pp.vx * 0.25 + (Math.random() - 0.5) * 40, vy: pp.vy * 0.25 - Math.random() * 20,
          c: BAND_COLORS[k % 4], r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 12,
          life: 0.8 + Math.random() * 0.5,
        });
      }
    });
    popPrev = st.popT.slice();
    st.bandHits.forEach((h, i) => { if (h) bandExcite.set(i, 1); });
  }
  for (const [i, v] of bandExcite) bandExcite.set(i, Math.max(0, v - dt * 1.6));
  cushAnim = cushAnim.map((v) => Math.max(0, v - dt * 2.2));

  // camera: pannable zoomed edit view; chase cam during runs
  const fs = fitScale(lv), b = lv.bounds;
  let target;
  if (riding && st) {
    target = clampCam(st.p.x + st.face * 8, st.p.y, fs * RZ, b);
  } else {
    target = clampCam(pan.x, pan.y, fs * EZ, b);
    pan.x = target.x; pan.y = target.y;
  }
  const k = Math.min(1, (panning ? 14 : 5) * dt);
  cam.x += (target.x - cam.x) * k; cam.y += (target.y - cam.y) * k; cam.s += (target.s - cam.s) * k;

  drawBackground(dt);
  ctx.save();
  if (shake > 0) { shake = Math.max(0, shake - dt * 3); ctx.translate((Math.random() - 0.5) * 10 * shake, (Math.random() - 0.5) * 10 * shake); }

  drawTerrain(lv);
  lv.cushions.forEach((c, i) => drawCushion(c, cushAnim[i] || 0));
  lv.pops.forEach((pp, i) => drawPopper(pp, i));
  lv.bumpers.forEach((bp, i) => drawBumper(bp, st ? Math.max(0, 1 - (st.t - st.bumpT[i]) * 4) : 0));
  lv.plants.forEach((m, i) => drawPlant(m[0], m[1], st ? st.got[i] : false, i));
  drawCake(lv, st);
  bands().forEach((bd, i) => drawBand(bd, bd.slot % 4, bandExcite.get(i) || 0, false));
  if (snap.phase === "edit") {
    // Teammates' bands-in-progress: unmistakably in motion (marching dashes,
    // pulsing alpha) so nobody confuses a drag with a placed band.
    const pid = playerId();
    for (const p of snap.previews ?? []) {
      if (p.pid === pid) continue;
      if (now() - p.at > 2500) continue; // stale ghost from a dead drag
      drawTeammatePreview(p);
    }
  }
  if (pending && snap.phase === "edit") drawBand(snapBand(lv, pending), mySlot() % 4, 0, true);
  if (preview && snap.phase === "edit") drawBand(preview, mySlot() % 4, 0, true);
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

function mySlot() {
  if (!snap) return 0;
  const pid = playerId();
  const i = snap.players.findIndex((p) => p.id === pid);
  return i < 0 ? 0 : i;
}

// ---------- boot — no menu, same contract as hex ----------
const NAME_KEY = "escape-cats-name";

function boot() {
  if (DEBUG) {
    document.getElementById("hud").classList.add("debug");
    labBtn.style.display = "";
  }
  if (SOLO) {
    // Serverless: the shared sim in-page, opening on the lab grid.
    setLab(true);
    startDebug({ onSnapshot });
    return;
  }
  // ?debug without ?solo joins the real room like any player — the menu's
  // card taps send a room-wide `goto`, so the whole team jumps together.
  const name = localStorage.getItem(NAME_KEY) ?? "Cat";
  gateStatusEl.textContent =
    "Waiting for your team — the proctor sorts you in, nothing to do here.";
  watchTeam({
    name,
    onTeam: (team, lobbyName) => {
      localStorage.setItem(NAME_KEY, lobbyName);
      gateStatusEl.textContent = "Joining your team…";
      connectRoom({
        room: team,
        name: lobbyName,
        onSnapshot,
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
