// Goomba Glider's level editor.
//
// The point of it is one sentence long: this game's physics reliably disproves
// the designer's intuition, so the loop from "an idea about a shape" to "the
// sim's verdict on that shape" should be as short as it can be made. Drag a
// ledge, and before your hand is off the mouse the bare run has been re-scored,
// the solution re-checked, every band re-tested for whether it is load-bearing,
// and a pool of workers has gone back to hunting for the one-band win that
// would make the whole level a lie.
//
// Everything it simulates with is the shipped code (see sim.js). Everything it
// saves is a link (see store.ts). Everything it claims is re-checkable on the
// bench with `node verify.mjs`, which remains the gate — the editor is the fast
// loop, not the authority.
import { GOOMBA_LEVELS, MAX_BANDS, decodeLevel, makeRun, stepRun } from "@escape-cats/shared";
import { BAND_MAX, RUN_MAX, SUB, bandLen, cloneLevel, prepare, runTrace, toBands } from "./sim.js";
import { verdicts } from "./verdict.js";
import { createHunter } from "./hunter.js";
import { toTypeScript } from "./emit.js";
import { draw, fitCam, makeCam, toWorld } from "./view.js";
import { bootLevel, readTray, removeFromTray, saveDraft, saveToTray, shareLink, trayFile } from "./store";

const $ = (id) => document.getElementById(id);
const cv = $("c"),
  ctx = cv.getContext("2d");

/** A skeleton with a ramp, a floor and a plant: enough that the very first
 * verdict is a real one ("bare run fails — FAIL", because she just rolls in),
 * which is the lesson the whole tool exists to teach. */
const STARTER = () => ({
  name: "untitled",
  start: [-12, 9],
  terrain: [
    [[-14, 10], [30, 17]],
    [[-20, 150], [40, 162], [90, 150]],
  ],
  goal: [40, 159],
  cans: [],
  cushions: [],
  pops: [],
  bumpers: [],
  solution: [],
});

// ---------- state ----------
let level = STARTER();
let init = prepare(level);
let cam = makeCam();
let W = 0,
  H = 0;
let tool = "select";
let selection = null;
let hover = null;
let drag = null;
let pan = null;
let pending = null; // polyline being drawn, point list so far
let trace = null; // last run's path, drawn under everything
let runner = null; // { st, path } — a run being animated right now
let cheat = null; // the shortcut the hunter found, shown on demand
let snapping = true;
const undo = [];

const TOOLS = [
  ["select", "select / drag", "V"],
  ["line", "terrain line", "L"],
  ["can", "watering can", "C"],
  ["popper", "party popper", "P"],
  ["cushion", "cushion", "U"],
  ["bumper", "piñata bumper", "B"],
  ["band", "solution band", "S"],
  ["erase", "erase", "X"],
];

// ---------- level plumbing ----------
/** Snapshot for undo. The save format doubles as the undo format — a level is
 * a few hundred bytes, so a hundred of them is nothing, and there is exactly
 * one serialiser to keep correct. */
function pushUndo() {
  try {
    undo.push(JSON.stringify(level));
    if (undo.length > 120) undo.shift();
  } catch {
    /* ignore */
  }
}

/** Every mutation ends here: re-derive the simulable level, re-grade it, save
 * the draft, and send the hunter back to work. */
function changed({ rehunt = true } = {}) {
  init = prepare(level);
  trace = null;
  runner = null;
  cheat = null;
  // The last run's result described a level that no longer exists. Clearing it
  // matters more than it looks: a stale "win @ 4.1s" sitting under an edit is
  // exactly the false confidence this whole tool exists to remove.
  $("runstat").textContent = "";
  saveDraft(level);
  renderVerdicts();
  if (rehunt) hunter.schedule(level);
  syncSelection();
}

function loadLevel(next, { fit = true } = {}) {
  pushUndo();
  level = cloneLevel(next);
  level.cans ??= [];
  level.cushions ??= [];
  level.pops ??= [];
  level.bumpers ??= [];
  level.solution ??= [];
  selection = null;
  pending = null;
  $("name").value = level.name ?? "";
  init = prepare(level);
  if (fit) fitCam(cam, init, W, H);
  changed();
}

// ---------- geometry helpers ----------
const snap = (v) => (snapping ? Math.round(v * 2) / 2 : Math.round(v * 10) / 10);
const px2world = (px) => px / cam.s;
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

function distToSeg(px, py, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (!l2) return Math.hypot(px - a[0], py - a[1]);
  let t = ((px - a[0]) * dx + (py - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

const popTip = (pp) => {
  const a = (pp.deg * Math.PI) / 180;
  const arm = 5 + pp.spd / 14;
  return [pp.x + Math.cos(a) * arm, pp.y + Math.sin(a) * arm];
};

/**
 * What is under this world point. Ordered smallest-and-most-specific first —
 * a popper's aim handle beats its body, a vertex beats the line it belongs to
 * — because the fiddly thing is always the one you meant to grab.
 */
function hitTest(w) {
  const grab = px2world(9); // a consistent finger's worth, at any zoom
  const g2 = grab * grab;

  const sol = level.solution ?? [];
  for (let i = 0; i < sol.length; i++)
    for (let j = 0; j < 2; j++)
      if (dist2(w.x, w.y, sol[i][j][0], sol[i][j][1]) < g2) return { kind: "bandEnd", i, j };

  for (let i = 0; i < level.terrain.length; i++)
    for (let j = 0; j < level.terrain[i].length; j++)
      if (dist2(w.x, w.y, level.terrain[i][j][0], level.terrain[i][j][1]) < g2)
        return { kind: "vertex", i, j };

  const pops = level.pops ?? [];
  for (let i = 0; i < pops.length; i++) {
    const tip = popTip(pops[i]);
    if (dist2(w.x, w.y, tip[0], tip[1]) < g2) return { kind: "popAim", i };
  }
  for (let i = 0; i < pops.length; i++)
    if (dist2(w.x, w.y, pops[i].x, pops[i].y) < g2) return { kind: "pop", i };

  const cans = level.cans ?? [];
  for (let i = 0; i < cans.length; i++)
    if (dist2(w.x, w.y, cans[i][0], cans[i][1]) < Math.max(g2, 16)) return { kind: "can", i };

  const bumps = level.bumpers ?? [];
  for (let i = 0; i < bumps.length; i++)
    if (dist2(w.x, w.y, bumps[i].x, bumps[i].y) < Math.max(g2, 30)) return { kind: "bumper", i };

  if (dist2(w.x, w.y, level.goal[0], level.goal[1]) < Math.max(g2, 16)) return { kind: "goal" };
  if (dist2(w.x, w.y, level.start[0], level.start[1]) < Math.max(g2, 16)) return { kind: "start" };

  const cush = level.cushions ?? [];
  for (let i = 0; i < cush.length; i++) {
    const c = cush[i];
    if (w.x >= c.x - grab && w.x <= c.x + c.w + grab && w.y >= c.y - grab && w.y <= c.y + 3 + grab)
      return { kind: "cushion", i };
  }

  for (let i = 0; i < level.terrain.length; i++) {
    const poly = level.terrain[i];
    for (let j = 0; j + 1 < poly.length; j++)
      if (distToSeg(w.x, w.y, poly[j], poly[j + 1]) < grab) return { kind: "poly", i, seg: j };
  }
  return null;
}

/** Move whatever is selected by a world delta — one place, so dragging a
 * popper and nudging it with an arrow key can never disagree. */
function moveHit(h, dx, dy) {
  const poly = level.terrain[h.i];
  switch (h.kind) {
    case "vertex":
      poly[h.j][0] = snap(poly[h.j][0] + dx);
      poly[h.j][1] = snap(poly[h.j][1] + dy);
      break;
    case "poly":
      for (const p of poly) {
        p[0] = snap(p[0] + dx);
        p[1] = snap(p[1] + dy);
      }
      break;
    case "bandEnd": {
      const end = level.solution[h.i][h.j];
      end[0] = snap(end[0] + dx);
      end[1] = snap(end[1] + dy);
      break;
    }
    case "can":
      level.cans[h.i][0] = snap(level.cans[h.i][0] + dx);
      level.cans[h.i][1] = snap(level.cans[h.i][1] + dy);
      break;
    case "pop":
      level.pops[h.i].x = snap(level.pops[h.i].x + dx);
      level.pops[h.i].y = snap(level.pops[h.i].y + dy);
      break;
    case "popAim": {
      // The aim handle sets the angle from wherever it is dragged to; speed
      // keeps its own field, because a handle that set both at once made every
      // re-aim a re-tune.
      const pp = level.pops[h.i];
      const tip = popTip(pp);
      const nx = tip[0] + dx,
        ny = tip[1] + dy;
      pp.deg = Math.round((Math.atan2(ny - pp.y, nx - pp.x) * 180) / Math.PI);
      break;
    }
    case "bumper":
      level.bumpers[h.i].x = snap(level.bumpers[h.i].x + dx);
      level.bumpers[h.i].y = snap(level.bumpers[h.i].y + dy);
      break;
    case "cushion":
      level.cushions[h.i].x = snap(level.cushions[h.i].x + dx);
      level.cushions[h.i].y = snap(level.cushions[h.i].y + dy);
      break;
    case "start":
      level.start[0] = snap(level.start[0] + dx);
      level.start[1] = snap(level.start[1] + dy);
      break;
    case "goal":
      level.goal[0] = snap(level.goal[0] + dx);
      level.goal[1] = snap(level.goal[1] + dy);
      break;
  }
}

function deleteHit(h) {
  if (!h) return false;
  pushUndo();
  switch (h.kind) {
    case "vertex": {
      const poly = level.terrain[h.i];
      poly.splice(h.j, 1);
      // A polyline of one point is not terrain; drop the husk rather than
      // leaving an invisible thing that still moves the level's bounds.
      if (poly.length < 2) level.terrain.splice(h.i, 1);
      break;
    }
    case "poly":
      level.terrain.splice(h.i, 1);
      break;
    case "bandEnd":
      level.solution.splice(h.i, 1);
      break;
    case "can":
      level.cans.splice(h.i, 1);
      break;
    case "pop":
    case "popAim":
      level.pops.splice(h.i, 1);
      break;
    case "bumper":
      level.bumpers.splice(h.i, 1);
      break;
    case "cushion":
      level.cushions.splice(h.i, 1);
      break;
    default:
      undo.pop(); // start and goal cannot be deleted; take the snapshot back
      return false;
  }
  selection = null;
  changed();
  return true;
}

// ---------- canvas ----------
function resize() {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = r.width;
  H = r.height;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resize).observe(cv);

function frame() {
  // Animate a run if one is playing: the sim is stepped at its own fixed
  // substep and the frame just shows where she got to, so what you watch is
  // the run that was scored rather than a re-timing of it.
  if (runner) {
    const budget = 1 / 60; // one frame of sim per frame of screen: real time
    let acc = 0;
    while (acc < budget && !runner.st.result && runner.st.t < RUN_MAX + 1) {
      stepRun(runner.st, SUB);
      acc += SUB;
      runner.path.push([runner.st.p.x, runner.st.p.y, runner.st.grounded ? 1 : 0]);
    }
    trace = { path: runner.path, events: runner.st.events };
    if (runner.st.result || runner.st.t >= RUN_MAX + 1) {
      showRunStat(runner.st.result ?? "timeout", runner.st.t, runner.label);
      runner = null;
    }
  }

  // A drawn-in-progress polyline previews as part of the level, so the shape
  // reads while it is being made rather than only after it is finished.
  const shown = pending ? { ...level, terrain: [...level.terrain, pending.pts] } : level;
  draw(ctx, {
    cam, W, H,
    level: shown,
    init,
    trace,
    runner: runner ? runner.st.p : null,
    cheat,
    hover,
    selection,
    showGrid: true,
  });
  requestAnimationFrame(frame);
}

// ---------- input ----------
const evWorld = (e) => {
  const r = cv.getBoundingClientRect();
  return toWorld(cam, W, H, e.clientX - r.left, e.clientY - r.top);
};

cv.addEventListener("pointerdown", (e) => {
  cv.setPointerCapture(e.pointerId);
  const w = evWorld(e);
  // Middle button, right button and space-drag all pan — whichever the
  // designer's hands already know.
  if (e.button === 1 || e.button === 2 || spaceDown) {
    pan = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
    cv.classList.add("panning");
    return;
  }
  if (e.button !== 0) return;

  if (tool === "line") {
    if (!pending) pending = { pts: [] };
    pending.pts.push([snap(w.x), snap(w.y)]);
    return;
  }
  if (tool === "erase") {
    deleteHit(hitTest(w));
    return;
  }
  if (tool === "band") {
    if ((level.solution?.length ?? 0) >= MAX_BANDS) {
      banner(`the party rule locks a level to ${MAX_BANDS} bands — take one back first`);
      return;
    }
    pushUndo();
    level.solution.push([[snap(w.x), snap(w.y)], [snap(w.x), snap(w.y)]]);
    drag = { hit: { kind: "bandEnd", i: level.solution.length - 1, j: 1 }, last: w, fresh: true };
    return;
  }
  if (tool === "can" || tool === "popper" || tool === "cushion" || tool === "bumper") {
    pushUndo();
    if (tool === "can") level.cans.push([snap(w.x), snap(w.y)]);
    if (tool === "popper") level.pops.push({ x: snap(w.x), y: snap(w.y), deg: 0, spd: 76 });
    if (tool === "cushion") level.cushions.push({ x: snap(w.x), y: snap(w.y), w: 24 });
    if (tool === "bumper") level.bumpers.push({ x: snap(w.x), y: snap(w.y) });
    selection =
      tool === "can" ? { kind: "can", i: level.cans.length - 1 }
      : tool === "popper" ? { kind: "pop", i: level.pops.length - 1 }
      : tool === "cushion" ? { kind: "cushion", i: level.cushions.length - 1 }
      : { kind: "bumper", i: level.bumpers.length - 1 };
    setTool("select");
    changed();
    return;
  }

  const hit = hitTest(w);
  if (hit) {
    // Shift-click a segment to give it a new vertex there: the cheapest way to
    // turn a straight ledge into the shape a level actually needs.
    if (e.shiftKey && hit.kind === "poly") {
      pushUndo();
      level.terrain[hit.i].splice(hit.seg + 1, 0, [snap(w.x), snap(w.y)]);
      selection = { kind: "vertex", i: hit.i, j: hit.seg + 1 };
      drag = { hit: selection, last: w };
      cv.classList.add("grabbing");
      return;
    }
    pushUndo();
    selection = hit.kind === "bandEnd" ? { kind: "band", i: hit.i } : hit;
    drag = { hit, last: w };
    cv.classList.add("grabbing");
    syncSelection();
    return;
  }
  selection = null;
  syncSelection();
  pan = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
  cv.classList.add("panning");
});

cv.addEventListener("pointermove", (e) => {
  const w = evWorld(e);
  $("readout").textContent =
    `${w.x.toFixed(1)}, ${w.y.toFixed(1)}` +
    (drag?.hit.kind === "bandEnd"
      ? ` · band ${bandLen(level.solution[drag.hit.i]).toFixed(1)}u / ${BAND_MAX}`
      : pending?.pts.length
        ? ` · ${pending.pts.length} point${pending.pts.length > 1 ? "s" : ""} · Enter to finish`
        : snapping ? " · ½u grid (Alt: free)" : " · free (Alt off: ½u)");

  if (pan) {
    cam.x = pan.cx - (e.clientX - pan.x) / cam.s;
    cam.y = pan.cy - (e.clientY - pan.y) / cam.s;
    return;
  }
  if (drag) {
    moveHit(drag.hit, w.x - drag.last.x, w.y - drag.last.y);
    drag.last = w;
    drag.moved = true;
    // Re-derive as we go: the bounds move with the geometry, and a verdict
    // that lagged a drag by one gesture would be worse than none.
    init = prepare(level);
    return;
  }
  hover = hitTest(w);
});

const endPointer = () => {
  if (pan) {
    pan = null;
    cv.classList.remove("panning");
  }
  if (drag) {
    const wasFresh = drag.fresh;
    const moved = drag.moved;
    drag = null;
    cv.classList.remove("grabbing");
    // A band the designer clicked without dragging is zero-length and illegal;
    // drop it rather than leaving an invisible band in a solution slot.
    if (wasFresh && !moved) level.solution.pop();
    if (!moved && !wasFresh) undo.pop(); // a click that selected but moved nothing
    changed();
  }
};
cv.addEventListener("pointerup", endPointer);
cv.addEventListener("pointercancel", endPointer);
cv.addEventListener("contextmenu", (e) => e.preventDefault());

cv.addEventListener("dblclick", () => finishPending());

cv.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    const before = toWorld(cam, W, H, e.clientX - r.left, e.clientY - r.top);
    cam.s = Math.max(0.5, Math.min(40, cam.s * Math.exp(-e.deltaY * 0.0015)));
    const after = toWorld(cam, W, H, e.clientX - r.left, e.clientY - r.top);
    cam.x += before.x - after.x; // zoom toward the cursor, not the centre
    cam.y += before.y - after.y;
  },
  { passive: false },
);

let spaceDown = false;
addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === "Space") {
    spaceDown = true;
    e.preventDefault();
    return;
  }
  if (e.key === "Alt") snapping = false;
  const k = e.key.toLowerCase();
  const byKey = TOOLS.find((t) => t[2].toLowerCase() === k);
  if (byKey && !e.metaKey && !e.ctrlKey) return setTool(byKey[0]);
  if (k === "z" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    const prev = undo.pop();
    if (prev) {
      level = JSON.parse(prev);
      selection = null;
      $("name").value = level.name ?? "";
      changed();
    }
    return;
  }
  if (e.key === "Enter") return finishPending();
  if (e.key === "Escape") {
    pending = null;
    selection = null;
    cheat = null;
    syncSelection();
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    deleteHit(selection?.kind === "band" ? { kind: "bandEnd", i: selection.i } : selection);
    return;
  }
  if (e.key === "f") return fitCam(cam, init, W, H);
  const nudge = { ArrowLeft: [-0.5, 0], ArrowRight: [0.5, 0], ArrowUp: [0, -0.5], ArrowDown: [0, 0.5] }[e.key];
  if (nudge && selection) {
    e.preventDefault();
    pushUndo();
    moveHit(selection.kind === "band" ? { kind: "bandEnd", i: selection.i, j: 0 } : selection, nudge[0], nudge[1]);
    if (selection.kind === "band") moveHit({ kind: "bandEnd", i: selection.i, j: 1 }, nudge[0], nudge[1]);
    changed();
  }
});
addEventListener("keyup", (e) => {
  if (e.code === "Space") spaceDown = false;
  if (e.key === "Alt") snapping = true;
});

function finishPending() {
  if (!pending) return;
  if (pending.pts.length >= 2) {
    pushUndo();
    level.terrain.push(pending.pts);
    pending = null;
    setTool("select");
    changed();
  } else {
    pending = null;
  }
}

// ---------- tools ----------
function setTool(next) {
  if (next !== "line") finishPending();
  tool = next;
  for (const b of $("tools").children) b.classList.toggle("on", b.dataset.tool === tool);
}
for (const [id, label, key] of TOOLS) {
  const b = document.createElement("button");
  b.dataset.tool = id;
  b.innerHTML = `${label}<kbd>${key}</kbd>`;
  b.onclick = () => setTool(id);
  $("tools").append(b);
}

// ---------- the run ----------
function play(bare) {
  const pairs = bare ? [] : (level.solution ?? []);
  cheat = null;
  runner = {
    st: makeRun(init, toBands(init, pairs)),
    path: [],
    label: bare ? "bare" : `${pairs.length}-band`,
  };
  $("runstat").textContent = `${runner.label} run…`;
}
function showRunStat(result, t, label) {
  const r = runTrace(init, label === "bare" ? [] : (level.solution ?? []));
  $("runstat").textContent =
    `${label}: ${result} @ ${t.toFixed(2)}s · ${r.airPct}% airborne · cans ${r.cans}/${init.cans.length}`;
  $("runstat").style.color = result === "win" ? "var(--ok)" : "var(--bad)";
}
$("play").onclick = () => play(false);
$("bare").onclick = () => play(true);

// ---------- verdicts ----------
function renderVerdicts() {
  const rows = verdicts(init);
  $("verdicts").innerHTML = rows
    .map(
      (r) =>
        `<div class="v ${r.state}"><span class="mark">${r.state === "ok" ? "✓" : r.state === "fail" ? "✗" : "·"}</span>` +
        `<span class="what">${esc(r.name)}<br><span class="detail">${esc(r.detail)}</span></span></div>`,
    )
    .join("");
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------- the shortcut hunt ----------
let lastHunt = null; // the cheat the pool found, kept so it can be shown on demand
const hunter = createHunter((s) => {
  lastHunt = s?.found ?? null;
  const bar = $("huntbar").firstElementChild,
    msg = $("huntmsg");
  $("huntShow").style.display = s?.found ? "" : "none";
  if (!s) {
    bar.style.width = "0%";
    msg.className = "";
    msg.textContent = "—";
    return;
  }
  if (s.pending) {
    bar.style.width = "0%";
    msg.className = "";
    msg.textContent = "waiting for the edits to settle…";
    return;
  }
  if (s.found) {
    bar.style.width = "100%";
    msg.className = "bad";
    // "at least": the pool stops at the FIRST win it finds, and shards run
    // independently, so a level that also has a 1-band win can report a 2-band
    // one first. Either way the party rule is broken and the fix is geometry.
    msg.textContent =
      `BROKEN: at least one ${s.found.bands.length}-band set wins this level — ` +
      `${MAX_BANDS - s.found.bands.length} of four players would have nothing to do.`;
    return;
  }
  const pct = s.total ? Math.min(100, Math.round((100 * s.checked) / s.total)) : 0;
  bar.style.width = `${pct}%`;
  msg.className = "";
  msg.textContent = s.running
    ? `hunting on ${s.pool} workers — ${s.checked.toLocaleString()} placements tried (${pct}%)`
    : `no ≤3-band win found: exhaustive over ${s.legal.toLocaleString()} single bands, ` +
      `then ${(hunter.samples[2] + hunter.samples[3]).toLocaleString()} sampled 2- and 3-band sets.`;
});
$("huntShow").onclick = () => {
  // Put the cheat on the canvas rather than describing it. Seeing the one band
  // that skips three of your gates is the moment the level gets fixed.
  if (lastHunt) cheat = lastHunt;
};

// ---------- selection inspector ----------
const FIELDS = {
  vertex: (h) => [["x", () => level.terrain[h.i][h.j][0], (v) => (level.terrain[h.i][h.j][0] = v)],
                  ["y", () => level.terrain[h.i][h.j][1], (v) => (level.terrain[h.i][h.j][1] = v)]],
  can: (h) => [["x", () => level.cans[h.i][0], (v) => (level.cans[h.i][0] = v)],
               ["y", () => level.cans[h.i][1], (v) => (level.cans[h.i][1] = v)]],
  pop: (h) => [["x", () => level.pops[h.i].x, (v) => (level.pops[h.i].x = v)],
               ["y", () => level.pops[h.i].y, (v) => (level.pops[h.i].y = v)],
               ["deg", () => level.pops[h.i].deg, (v) => (level.pops[h.i].deg = v)],
               ["spd", () => level.pops[h.i].spd, (v) => (level.pops[h.i].spd = v)]],
  bumper: (h) => [["x", () => level.bumpers[h.i].x, (v) => (level.bumpers[h.i].x = v)],
                  ["y", () => level.bumpers[h.i].y, (v) => (level.bumpers[h.i].y = v)]],
  cushion: (h) => [["x", () => level.cushions[h.i].x, (v) => (level.cushions[h.i].x = v)],
                   ["y", () => level.cushions[h.i].y, (v) => (level.cushions[h.i].y = v)],
                   ["w", () => level.cushions[h.i].w, (v) => (level.cushions[h.i].w = v)]],
  start: () => [["x", () => level.start[0], (v) => (level.start[0] = v)],
                ["y", () => level.start[1], (v) => (level.start[1] = v)]],
  goal: () => [["x", () => level.goal[0], (v) => (level.goal[0] = v)],
               ["y", () => level.goal[1], (v) => (level.goal[1] = v)]],
  band: (h) => [["ax", () => level.solution[h.i][0][0], (v) => (level.solution[h.i][0][0] = v)],
                ["ay", () => level.solution[h.i][0][1], (v) => (level.solution[h.i][0][1] = v)],
                ["bx", () => level.solution[h.i][1][0], (v) => (level.solution[h.i][1][0] = v)],
                ["by", () => level.solution[h.i][1][1], (v) => (level.solution[h.i][1][1] = v)]],
};

function syncSelection() {
  const box = $("selFields");
  box.innerHTML = "";
  const s = selection;
  const kind = s?.kind === "poly" ? "poly" : s?.kind;
  const make = kind && FIELDS[kind];
  $("selTitle").textContent = s
    ? `Selection · ${kind}${s.kind === "band" ? ` ${s.i + 1} · ${bandLen(level.solution[s.i]).toFixed(1)}u` : ""}`
    : "Selection · nothing";
  $("selDelete").style.display = s && kind !== "start" && kind !== "goal" ? "" : "none";
  if (!make) return;
  for (const [label, get, set] of make(s)) {
    const l = document.createElement("label");
    l.textContent = label;
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = "0.5";
    inp.value = String(get());
    inp.onchange = () => {
      const v = Number(inp.value);
      if (!Number.isFinite(v)) return;
      pushUndo();
      set(v);
      changed();
    };
    box.append(l, inp);
  }
}
$("selDelete").onclick = () =>
  deleteHit(selection?.kind === "band" ? { kind: "bandEnd", i: selection.i } : selection);

// ---------- panel: name, starters ----------
$("name").oninput = () => {
  level.name = $("name").value;
  saveDraft(level);
};

const starter = $("starter");
for (const [i, L] of GOOMBA_LEVELS.entries()) {
  const o = document.createElement("option");
  o.value = String(i);
  o.textContent = `${L.name}`;
  starter.append(o);
}
{
  const o = document.createElement("option");
  o.value = "empty";
  o.textContent = "— empty skeleton —";
  starter.append(o);
}
starter.onchange = () => {
  const v = starter.value;
  if (!v) return;
  // Remixing a level that already passes the gate is a far better on-ramp than
  // a blank page: the structure that makes four bands necessary is the hard
  // part, and it is easier to move than to invent.
  const next = v === "empty" ? STARTER() : GOOMBA_LEVELS[Number(v)];
  loadLevel(next);
  banner(v === "empty" ? "" : `copied from ${next.name} — rename it before sharing`);
  starter.value = "";
};

let bannerTimer = null;
function banner(msg) {
  $("banner").textContent = msg;
  clearTimeout(bannerTimer);
  if (msg) bannerTimer = setTimeout(() => ($("banner").textContent = ""), 6000);
}

// ---------- panel: save & share ----------
async function copy(text, btn, done) {
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = done;
  } catch {
    btn.textContent = "clipboard blocked";
  }
  setTimeout(() => (btn.textContent = label), 1600);
}
$("copyLink").onclick = (e) => {
  const url = shareLink(level);
  // Put it in the address bar as well as the clipboard: if the clipboard is
  // blocked the designer can still select it by hand, and a reload now keeps
  // the level rather than falling back to the draft.
  try {
    history.replaceState(null, "", "#" + url.slice(url.indexOf("#") + 1));
  } catch {
    /* ignore */
  }
  copy(url, e.currentTarget, `✓ copied · ${url.length} chars`);
};
$("pasteLink").onclick = () => {
  const text = prompt("Paste a level link (or just the part after the #):");
  if (!text) return;
  const next = decodeLevel(text.trim());
  if (!next) return banner("that is not a level link — check it copied whole");
  loadLevel(next);
  banner(`loaded “${next.name}”`);
};
$("copyTs").onclick = (e) => copy(toTypeScript(level) + "\n", e.currentTarget, "✓ copied — paste into levels.ts");

// ---------- panel: the tray ----------
function renderTray(entries = readTray()) {
  $("trayList").innerHTML = "";
  for (const t of entries) {
    const row = document.createElement("div");
    row.className = "item";
    const name = document.createElement("span");
    name.textContent = t.name;
    name.title = "open this level";
    name.onclick = () => {
      const next = decodeLevel(t.hash);
      if (next) {
        loadLevel(next);
        banner(`opened “${t.name}” from the tray`);
      }
    };
    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "remove from tray";
    del.onclick = () => renderTray(removeFromTray(t.id));
    row.append(name, del);
    $("trayList").append(row);
  }
  if (!entries.length) $("trayList").innerHTML = `<div class="note">empty</div>`;
}
$("trayAdd").onclick = () => {
  renderTray(saveToTray(level));
  banner(`“${level.name || "untitled"}” saved to the tray`);
};
$("trayFile").onclick = () => {
  const entries = readTray();
  if (!entries.length) return banner("the tray is empty");
  const blob = new Blob([trayFile(entries)], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "goomba-levels.links";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

/**
 * A link arriving in the address bar of a tab that is already open. Pasting a
 * URL into the bar of a running editor changes the fragment without reloading
 * anything, so without this the level silently does not arrive — which looks
 * exactly like a broken link to the person who sent it.
 */
addEventListener("hashchange", () => {
  if (location.hash.length <= 1) return;
  const next = decodeLevel(location.hash.slice(1));
  if (!next) return banner("that link did not decode — check it copied whole");
  loadLevel(next);
  banner(`opened from a link — “${next.name}”`);
});

// ---------- boot ----------
resize();
{
  const boot = bootLevel();
  if (boot.level) {
    loadLevel(boot.level);
    banner(
      boot.from === "link"
        ? `opened from a shared link — “${boot.level.name}”`
        : `picked up your last draft — “${boot.level.name}”`,
    );
  } else {
    // A hash that failed to decode is worth saying so about: a truncated paste
    // looks exactly like a fresh page otherwise.
    if (location.hash.length > 1) banner("that link did not decode — starting from the skeleton");
    loadLevel(STARTER());
  }
}
setTool("select");
renderTray();
requestAnimationFrame(frame);
