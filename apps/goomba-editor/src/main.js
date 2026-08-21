// Goomba Glider — the Figma paste target.
//
// This page used to be a level editor. It is not one any more: every bit of
// authoring lives in Figma now, so what is left is the smallest thing that can
// turn a pasted frame into a run you can watch —
//
//   paste  ->  figma-svg.js reads the layer names  ->  the SHIPPED sim plays it
//
// No tools, no selection, no drag handles, no undo, no tray. If the level is
// wrong, fix it in Figma and paste again. The one thing that leaves this page is
// a level link, because `node verify.mjs --hash <link>` is what actually proves
// a level, and this page deliberately does not pretend to.
import { RUN_MAX, SUB, encodeLevel, decodeLevel, makeRun, stepRun } from "@escape-cats/shared";
import { prepare, toBands } from "./sim.js";
import { draw, fitCam, makeCam, toWorld } from "./view.js";
import { levelFromFigmaSvg } from "./figma-svg.js";
import { hasFigmaBuffer, levelFromFigmaClipboard } from "./figma-clipboard.js";

const $ = (id) => document.getElementById(id);
const cv = $("c");
const ctx = cv.getContext("2d");

// ---------- state ----------
let level = null; // the pasted level, or null before anything arrives
let init = null; // …prepared: bounds, popper aim vectors, start angle
let cam = makeCam();
let W = 0, H = 0;
let trace = null; // the last run's path, drawn under everything
let runner = null; // a run being animated right now
let pan = null;

// ---------- canvas ----------
function resize() {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  W = r.width; H = r.height;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener("resize", resize);
resize();

function frame() {
  if (runner) {
    const budget = 1 / 60; // one second of sim per second of screen: real time
    let acc = 0;
    while (acc < budget && !runner.st.result && runner.st.t < RUN_MAX + 1) {
      const wasGround = runner.st.grounded;
      stepRun(runner.st, SUB);
      acc += SUB;
      if (!wasGround) runner.air += SUB;
      runner.acc += SUB;
      if (runner.acc >= 1 / 60) {
        runner.acc = 0;
        runner.path.push([runner.st.p.x, runner.st.p.y, runner.st.grounded ? 1 : 0]);
      }
    }
    trace = { path: runner.path, events: runner.st.events };
    if (runner.st.result || runner.st.t >= RUN_MAX + 1) {
      report(runner);
      runner = null;
      syncButtons();
    }
  }
  if (level) {
    draw(ctx, {
      cam, W, H,
      level,
      trace,
      runner: runner ? runner.st.p : null,
      cheat: null,
      hover: null,
      selection: null,
      showGrid: true,
    });
  } else {
    ctx.fillStyle = "#150a2a";
    ctx.fillRect(0, 0, W, H);
  }
  requestAnimationFrame(frame);
}

// ---------- view only: pan and zoom, because looking is not editing ----------
cv.addEventListener("pointerdown", (e) => {
  if (!level) return;
  pan = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
  cv.setPointerCapture(e.pointerId);
  cv.classList.add("panning");
});
cv.addEventListener("pointermove", (e) => {
  if (!pan) return;
  cam.x = pan.cx - (e.clientX - pan.x) / cam.s;
  cam.y = pan.cy - (e.clientY - pan.y) / cam.s;
});
const endPan = () => { pan = null; cv.classList.remove("panning"); };
cv.addEventListener("pointerup", endPan);
cv.addEventListener("pointercancel", endPan);
cv.addEventListener(
  "wheel",
  (e) => {
    if (!level) return;
    e.preventDefault();
    const before = toWorld(cam, W, H, e.offsetX, e.offsetY);
    cam.s = Math.max(0.6, Math.min(24, cam.s * Math.exp(-e.deltaY * 0.0016)));
    const after = toWorld(cam, W, H, e.offsetX, e.offsetY);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
  },
  { passive: false },
);

// ---------- the run ----------
function play(bare) {
  if (!init) return;
  const pairs = bare ? [] : (level.solution ?? []);
  runner = {
    st: makeRun(init, toBands(init, pairs)),
    path: [],
    acc: 0,
    air: 0,
    label: bare ? "bare" : `${pairs.length}-band`,
  };
  $("runstat").textContent = `${runner.label} run…`;
  $("runstat").style.color = "var(--dim)";
  syncButtons();
}
/** The run just animated IS the run reported — no second simulation. */
function report({ st, air, label }) {
  const result = st.result ?? "timeout";
  const airPct = Math.round((100 * air) / Math.max(st.t, 0.01));
  $("runstat").textContent =
    `${label}: ${result} @ ${st.t.toFixed(2)}s · ${airPct}% airborne · cans ${st.gotN}/${init.cans.length}`;
  $("runstat").style.color = result === "win" ? "var(--ok)" : "var(--bad)";
}
$("play").onclick = () => (runner ? stop() : play(false));
$("bare").onclick = () => play(true);
function stop() {
  runner = null;
  trace = null;
  $("runstat").textContent = "";
  syncButtons();
}
function syncButtons() {
  const has = !!level;
  $("bare").disabled = !has;
  $("link").disabled = !has;
  $("play").disabled = !has;
  $("play").textContent = runner ? "■ stop" : "▶ play";
}

$("link").onclick = async () => {
  try {
    const url = location.origin + location.pathname + "#" + encodeLevel(level);
    await navigator.clipboard.writeText(url);
    banner(`link copied · ${url.length} chars · verify it with: node verify.mjs --hash <link>`);
  } catch (err) {
    banner(String(err.message || err), true);
  }
};

// ---------- banner ----------
let bannerTimer = null;
function banner(msg, bad) {
  const el = $("banner");
  el.textContent = msg || "";
  el.classList.toggle("on", !!msg);
  el.classList.toggle("bad", !!bad);
  clearTimeout(bannerTimer);
  if (msg) bannerTimer = setTimeout(() => el.classList.remove("on"), 7000);
}

// ---------- taking a level in: the only input this page has ----------
function loadLevel(next, note) {
  level = next;
  init = prepare(next);
  level = init; // draw() and the sim want the prepared copy
  trace = null;
  runner = null;
  cam = makeCam();
  fitCam(cam, init, W, H);
  $("hint").classList.add("gone");
  cv.classList.remove("empty");
  $("title").textContent = init.name;
  $("meta").textContent =
    `${init.terrain.length} terrain · ${init.cans.length} cans · ${init.pops.length} poppers · ` +
    `${init.bumpers.length} bumpers · ${init.cushions.length} cushions · ${(init.solution ?? []).length} bands`;
  $("runstat").textContent = "";
  syncButtons();
  if (note) banner(note);
}

/** Text on the clipboard is either an SVG or one of our own level links. */
function takeText(text) {
  const s = text.trim();
  if (!s) return false;
  if (/^<(\?xml|svg)/i.test(s) || s.includes("<svg")) {
    const { level: next, warnings } = levelFromFigmaSvg(s);
    loadLevel(next, warnings.length ? warnings.join(" · ") : `read “${next.name}” from Figma`);
    return true;
  }
  const hash = s.startsWith("#") ? s.slice(1) : s.slice(s.indexOf("#") + 1);
  const decoded = decodeLevel(hash || s);
  if (decoded) {
    loadLevel(decoded, `loaded “${decoded.name}” from a link`);
    return true;
  }
  return false;
}

addEventListener("paste", (e) => {
  const dt = e.clipboardData;
  if (!dt) return;
  e.preventDefault();
  const file = [...(dt.files || [])].find((f) => /svg/i.test(f.type) || /\.svg$/i.test(f.name));
  if (file) return void readFile(file);

  // A plain Ctrl+C in Figma is the best input there is: real layer names and
  // stored geometry, so it needs none of the SVG path's corrections. Try it
  // first and only fall back if the clipboard is not Figma's.
  const html = dt.getData("text/html") || "";
  if (hasFigmaBuffer(html)) {
    levelFromFigmaClipboard(html)
      .then(({ level: next, warnings }) =>
        loadLevel(next, warnings.length ? warnings.join(" · ") : `read “${next.name}” from Figma`))
      .catch((err) => banner(String(err.message || err), true));
    return;
  }

  const text = dt.getData("text/plain") || html;
  try {
    if (!takeText(text)) {
      banner("that clipboard is not a Figma copy, an SVG, or a level link. In Figma just select the frame and press Ctrl+C.", true);
    }
  } catch (err) {
    banner(String(err.message || err), true);
  }
});

function readFile(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      if (!takeText(String(fr.result))) banner(`${file.name} did not parse as a Figma SVG`, true);
    } catch (err) {
      banner(String(err.message || err), true);
    }
  };
  fr.readAsText(file);
}

addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => {
  e.preventDefault();
  const file = [...(e.dataTransfer?.files || [])][0];
  if (file) readFile(file);
});

// A link in the address bar still opens, so a shared level survives a reload.
function fromHash() {
  if (location.hash.length <= 1) return false;
  const decoded = decodeLevel(location.hash.slice(1));
  if (!decoded) return false;
  loadLevel(decoded, `loaded “${decoded.name}” from the link in the address bar`);
  return true;
}
addEventListener("hashchange", fromHash);

// Testing hook: the browser-driven checks paste through this rather than
// synthesising clipboard events, which no automation can do reliably.
window.__paste = (text) => takeText(text);
window.__pasteHtml = (html) =>
  levelFromFigmaClipboard(html).then(({ level: next, warnings }) => {
    loadLevel(next, warnings.join(" · "));
    return { name: next.name, warnings };
  });
window.__level = () => level;

// ---------- boot ----------
fromHash();
syncButtons();
frame();
