#!/usr/bin/env node
// THE DRAFT BENCH — the loop every level thread was rebuilding by hand.
//
// A level in progress is not a `levels.ts` entry yet; it is a pile of numbers
// you are still sweeping. So it lives in a **params module** under `draft/`
// that exports `P` (one object of tunables) and `buildLevel(p, extra)`, and
// this command drives it:
//
//   node draft.mjs new <name>          scaffold draft/<name>.mjs from a template
//   node draft.mjs ls                  which drafts exist, which is installed
//   node draft.mjs run [bands]         the run, as a POLAR route (r / theta)
//   node draft.mjs audit               the draft's own geometry invariants
//   node draft.mjs from <x,y,vx,vy>    ...starting mid-level, one stage alone
//   node draft.mjs sweep <key> <a..b>  one param across a range (add --from to
//                                      sweep an injected stage, not the bare run)
//   node draft.mjs card [bands]        an SVG ride card you can look at
//   node draft.mjs link                a ?solo#hash URL — play the draft for
//                                      real, on prod, on a phone
//   node draft.mjs figma [--copy]      a TRACING TEMPLATE as SVG (names and
//                                      positions right, node types lost)
//   node draft.mjs figma --kiwi        the real thing: Figma's own clipboard
//                                      format, pasting as Lines and INSTANCES
//   node draft.mjs install [bands]     splice into SEED_LEVELS so the
//                                      index-only tools can see it
//   node draft.mjs off                 take it back out again
//
// `--draft <name>` picks the module (default: the only one, or `draft/lvl.mjs`).
// `--set key=value` overrides one of the draft's params for this run only, so a
// candidate can be inspected without editing the file and forgetting to put it
// back.
// `bands` is JSON: '[[[ax,ay],[bx,by]], ...]', or `sol` for the draft's own.
//
// WHY THIS EXISTS, in the order the pain arrives:
//
//   1. NOTHING here grades a level (see DESIGNING.md), so the only real verdict
//      is playing it — which is what `link` is for, and why it is the command
//      you should be reaching for most. `install` / `off` put a draft into
//      `SEED_LEVELS` so `seed.mjs --push` can put it in front of real players;
//      it is idempotent, sits between markers, and leaves the file's CRLF alone.
//   2. Every placement question is answered by SWEEPING, and every
//      hand-derived answer has been wrong. `sweep` is one line instead of a
//      throwaway script.
//   3. A broken stage 3 hides behind a broken stage 1. `from` drops her into
//      the middle of the level with a velocity, so one leg can be judged alone
//      — that is what caught a 4-popper carousel that was really an up-column
//      trap.
//   4. A traced picture is worth more than any table of numbers, and `card`
//      writes one as plain SVG — no rasteriser, so it runs anywhere and drops
//      straight into a PR.
//
// See DESIGNING.md for what the numbers MEAN; this is only the loop.
import { readdirSync, writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeRun, stepRun, snapBand, SUB, RUN_MAX, initLevel, encodeLevel, decodeLevel } from "./draft/_sim.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRAFTS = join(HERE, "draft");
const LEVELS_TS = join(HERE, "..", "..", "packages", "shared", "src", "goomba", "levels.ts");
const OPEN = "  // >>> DRAFT", CLOSE = "  // <<< DRAFT";
/**
 * The ONE origin (CLAUDE.md's "One origin" rule). Named once, here, because a
 * link printed against a retired host does not fail — it 404s at Vercel's edge,
 * looking exactly like a broken level.
 *
 * `cat-games-tau.vercel.app` was that host until the project was renamed, and
 * renaming a Vercel project RELEASES the old `.vercel.app` name rather than
 * redirecting it. Anything printed carrying it is dead; reprint it.
 */
const ORIGIN = "https://escape-cats.vercel.app";

const argv = process.argv.slice(2);
let draftName = null;
for (let i = 0; i < argv.length; i++)
  if (argv[i] === "--draft") { draftName = argv[i + 1]; argv.splice(i, 2); i--; }
const cmd = argv[0] || "run";
const rest = argv.slice(1);

const die = (msg) => { console.error(msg); process.exit(2); };

/**
 * Put text on the system clipboard.
 *
 * The KIWI payload has to land as **text/html**, because it is HTML — the
 * buffer lives in a `data-buffer` attribute and Figma looks for it there. On
 * Windows `clip` only does plain text, so this goes through PowerShell's
 * `Set-Clipboard -AsHtml`, which writes the CF_HTML flavour Figma reads.
 */
function copyToClipboard(text, mime) {
  const tmp = join(HERE, ".clip.tmp");
  try {
    writeFileSync(tmp, text, "utf8");
    if (process.platform === "win32") {
      const ps = mime === "text/html"
        ? `Set-Clipboard -AsHtml -Value (Get-Content -Raw -Encoding UTF8 '${tmp}')`
        : `Set-Clipboard -Value (Get-Content -Raw -Encoding UTF8 '${tmp}')`;
      execFileSync("powershell", ["-NoProfile", "-Command", ps]);
    } else if (process.platform === "darwin") {
      execFileSync("pbcopy", [], { input: text });
    } else {
      execFileSync("xclip", ["-selection", "clipboard", "-t", mime], { input: text });
    }
    return true;
  } catch { return false; }
  finally { try { unlinkSync(tmp); } catch {} }
}
const modules = () =>
  existsSync(DRAFTS)
    ? readdirSync(DRAFTS).filter((f) => f.endsWith(".mjs") && !f.startsWith("_"))
    : [];

function pick() {
  const all = modules();
  if (draftName) {
    const f = all.find((m) => m === draftName || m === `${draftName}.mjs`);
    return f || die(`no draft "${draftName}" in ${DRAFTS} (have: ${all.join(", ") || "none"})`);
  }
  const named = all.filter((m) => m !== "lvl.mjs");
  if (all.includes("lvl.mjs") && !named.length) return "lvl.mjs";
  if (named.length === 1) return named[0];
  if (all.includes("lvl.mjs")) return "lvl.mjs";
  return die(all.length
    ? `several drafts — pass --draft <name>: ${all.join(", ")}`
    : `no drafts yet. \`node draft.mjs new <name>\` writes one.`);
}

/**
 * `--set key=value`, pulled out of the argv before anything else reads it.
 * Shared by run/from and sweep: a mode is as sweepable as a number, and the
 * point of both is to try a candidate without editing the file and then
 * forgetting to put it back.
 */
function overrides(mod) {
  const over = {};
  for (let i = rest.indexOf("--set"); i >= 0; i = rest.indexOf("--set")) {
    const [k, v] = String(rest[i + 1] || "").split("=");
    if (!(k in (mod.P || {}))) die(`no param "${k}" to --set`);
    // A param can be a MODE as well as a number, so only coerce what coerces.
    over[k] = v !== "" && Number.isFinite(Number(v)) ? Number(v) : v;
    rest.splice(i, 2);
  }
  return over;
}

const load = async () => {
  const file = pick();
  const mod = await import(pathToFileURL(join(DRAFTS, file)).href);
  if (typeof mod.buildLevel !== "function")
    die(`draft/${file} exports no buildLevel(p, extra)`);
  return { file, mod };
};

/** Snap a JSON band list against the level, as the room does at placement. */
const snapAll = (L, raw) =>
  raw.map(([a, b]) => snapBand(L, { ax: a[0], ay: a[1], bx: b[0], by: b[1] }));

function bandsFrom(arg, L) {
  if (!arg || arg === "bare") return [];
  if (arg === "sol") return snapAll(L, L.solution || []);
  try { return snapAll(L, JSON.parse(arg)); }
  catch { return die(`bands must be JSON like '[[[10,20],[30,40]]]' (or \`sol\`, or \`bare\`)`); }
}

/** Run to completion, collecting events and an optional coarse trace. */
function simulate(L, bands, { trace = 0, from = null } = {}) {
  const st = makeRun(L, bands);
  if (from) {
    st.p.x = from[0]; st.p.y = from[1];
    st.v.x = from[2] ?? 0; st.v.y = from[3] ?? 0;
    st.snap = { x: st.p.x, y: st.p.y, t: 0 };
  }
  const path = [], marks = [];
  let seen = 0, nextT = 0, n = 0;
  while (!st.result && st.t < RUN_MAX + 1) {
    stepRun(st, SUB);
    while (st.events.length > seen) {
      const [k, x, y, t] = st.events[seen++];
      marks.push({ k, x, y, t });
    }
    if (trace && st.t >= nextT) { marks.push({ k: ".", x: st.p.x, y: st.p.y, t: st.t, v: Math.hypot(st.v.x, st.v.y), g: st.grounded }); nextT += trace; }
    if (n++ % 8 === 0) path.push([st.p.x, st.p.y]);
  }
  return { st, path, marks };
}

/**
 * Where she is, in the level's own terms.
 *
 * A draft usually has a centre things are arranged around — a ring, a column, a
 * bowl — and on one of those "x 52, y 28" says nothing while "r 43 at -105"
 * says everything. So a draft may export `POLAR = [cx, cy]`; without one this
 * prints plain coordinates.
 */
const placer = (mod) => {
  const c = mod.POLAR || (mod.P && mod.P.cx !== undefined ? [mod.P.cx, mod.P.cy] : null);
  if (!c) return (x, y) => `(${x.toFixed(1)},${y.toFixed(1)})`;
  return (x, y) => {
    const dx = x - c[0], dy = y - c[1];
    return `(${x.toFixed(1)},${y.toFixed(1)}) r${Math.hypot(dx, dy).toFixed(1)} @${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(0)}`;
  };
};

const verdict = (st, L, bands) =>
  `=> ${st.result ?? "timeout"} @${st.t.toFixed(2)}s  cans ${st.gotN}/${L.cans.length}  bands ${bands.length}`;

// ── the level entry, as levels.ts would hold it ───────────────────────────────
const fmtPt = (p) => `[${p[0]}, ${p[1]}]`;
function emit(L) {
  const t = L.terrain.map((poly) => `      [${poly.map(fmtPt).join(", ")}]`).join(",\n");
  const p = (L.pops || []).map((q) => `      { x: ${q.x}, y: ${q.y}, deg: ${q.deg}, spd: ${q.spd} }`).join(",\n");
  return `  { name: ${JSON.stringify(L.name)}, budget: ${L.budget ?? 4},
    start: ${fmtPt(L.start)},
    goal: ${fmtPt(L.goal)},
    terrain: [
${t},
    ],
    cans: [${(L.cans || []).map(fmtPt).join(", ")}],${p ? `
    pops: [
${p},
    ],` : ""}
    solution: [${(L.solution || []).map(([a, b]) => `[${fmtPt(a)}, ${fmtPt(b)}]`).join(", ")}] },`;
}

/** Splice (or remove) the draft between the markers, preserving line endings. */
function splice(entry) {
  const src = readFileSync(LEVELS_TS, "utf8");
  const nl = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(/\r?\n/);
  const o = lines.indexOf(OPEN), c = lines.indexOf(CLOSE);
  if (o >= 0 && c > o) lines.splice(o, c - o + 1);
  if (entry) lines.splice(lines.lastIndexOf("];"), 0, OPEN, ...entry.split("\n"), CLOSE);
  writeFileSync(LEVELS_TS, lines.join(nl), "utf8");
}

const TEMPLATE = (name) => `// ${name} — a Goomba Glider level in progress.
//
// Everything tunable lives in P; buildLevel turns P into a level. Keep it that
// way: \`node draft.mjs sweep <key> <lo> <hi> <step>\` only works on a number
// that has a name here, and a hand-typed array cannot be swept at all.
export const P = {
  start: [10, 10],
  goal: [80, 60],
  // ...your numbers
};

/** Optional: a centre for draft.mjs to report positions relative to. */
// export const POLAR = [0, 0];

export function buildLevel(p = P, extra = {}) {
  return {
    name: ${JSON.stringify(name)},
    budget: 4,
    start: [...p.start],
    goal: [...p.goal],
    terrain: [[[0, 20], [40, 24]]],
    cans: [],
    pops: [],
    solution: extra.solution || [],
  };
}
`;

// ── commands ─────────────────────────────────────────────────────────────────
switch (cmd) {
  case "new": {
    const name = rest[0] || die("node draft.mjs new <name>");
    const file = join(DRAFTS, `${name.replace(/\.mjs$/, "")}.mjs`);
    if (existsSync(file)) die(`${file} already exists`);
    mkdirSync(DRAFTS, { recursive: true });
    writeFileSync(file, TEMPLATE(name), "utf8");
    console.log(`wrote ${file}\nnow: node draft.mjs --draft ${name} run`);
    break;
  }
  case "ls": {
    const installed = readFileSync(LEVELS_TS, "utf8").includes(OPEN);
    const all = modules();
    console.log(all.length ? all.map((m) => `  draft/${m}`).join("\n") : "  (no drafts)");
    console.log(installed
      ? `\na draft IS installed in SEED_LEVELS (index ${
          readFileSync(LEVELS_TS, "utf8").split(OPEN)[0].split(/^\s*\{ name:/m).length - 1
        }) — \`node draft.mjs off\` removes it`
      : "\nnothing installed in SEED_LEVELS");
    break;
  }
  case "off": {
    splice(null);
    console.log("draft removed from SEED_LEVELS");
    break;
  }
  case "install": {
    const { file, mod } = await load();
    const probe = initLevel(mod.buildLevel());
    const L = mod.buildLevel(undefined, { solution: bandsFrom(rest[0], probe).map((b) => [[b.ax, b.ay], [b.bx, b.by]]) });
    splice(emit(L));
    const idx = readFileSync(LEVELS_TS, "utf8").split(OPEN)[0].split(/^\s*\{ name:/m).length - 1;
    console.log(`installed draft/${file} as "${L.name}" at index ${idx} — ` +
      `${L.terrain.length} polylines, ${(L.pops || []).length} poppers, ${(L.solution || []).length} bands\n` +
      `  node seed.mjs --push   puts the whole pack in front of a live event`);
    break;
  }
  case "audit": {
    // A draft may export `audit(p)` -> [{name, rule, clear, ok}]: the geometry
    // facts the sim will NOT tell you, because they are about what CANNOT
    // happen. A popper's 8.2 reach ignores terrain, so "these two rings are
    // separate rooms" is arithmetic, and a run that never happens to be in the
    // wrong place looks exactly like a level where it is impossible.
    const { file, mod } = await load();
    if (typeof mod.audit !== "function") die(`draft/${file} exports no audit(p)`);
    let bad = 0;
    for (const r of mod.audit()) {
      if (!r.ok) bad++;
      console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.name.padEnd(36)} clearance ${String(r.clear).padStart(6)}   (${r.rule})`);
    }
    console.log("");
    console.log(bad ? bad + " invariant(s) violated" : "geometry is sound");
    process.exit(bad ? 1 : 0);
  }
  case "run":
  case "from": {
    const { mod } = await load();
    const fromArg = cmd === "from" ? (rest.shift() || die("node draft.mjs from <x,y,vx,vy>")) : null;
    const over = overrides(mod);
    const L = initLevel(mod.buildLevel({ ...mod.P, ...over }));
    let trace = 0;
    const ti = rest.indexOf("--trace");
    if (ti >= 0) { trace = Number(rest[ti + 1]) || 0.2; rest.splice(ti, 2); }
    const bands = bandsFrom(rest[0], L);
    const where = placer(mod);
    const { st, marks } = simulate(L, bands, {
      trace, from: fromArg ? fromArg.split(",").map(Number) : null,
    });
    for (const m of marks)
      console.log(`  ${m.t.toFixed(2)}s ${m.k.padEnd(4)} ${where(m.x, m.y)}` +
        (m.v === undefined ? "" : ` v${m.v.toFixed(0)}${m.g ? " grounded" : ""}`));
    console.log(verdict(st, L, bands));
    break;
  }
  case "sweep": {
    const { mod } = await load();
    const key = rest[0] || die("node draft.mjs sweep <key> <lo> <hi> [step]");
    const [lo, hi] = [Number(rest[1]), Number(rest[2])];
    const step = Number(rest[3]) || (hi - lo) / 10 || 1;
    if (!(mod.P && key in mod.P)) die(`draft has no param "${key}" (have: ${Object.keys(mod.P || {}).join(", ")})`);
    // `--from` sweeps ONE STAGE instead of the whole run. A parameter that only
    // governs, say, the conveyor tells you nothing through a bare drop that
    // never touches it — the bare outcome sits flat while the thing you are
    // tuning breaks silently underneath.
    const over = overrides(mod);
    let from = null;
    const fi = rest.indexOf("--from");
    if (fi >= 0) { from = rest[fi + 1].split(",").map(Number); rest.splice(fi, 2); }
    const bandsArg = rest[4];
    console.log(`${key.padEnd(10)} outcome`);
    for (let v = lo; v <= hi + 1e-9; v += step) {
      const L = initLevel(mod.buildLevel({ ...mod.P, ...over, [key]: +v.toFixed(4) }));
      const { st } = simulate(L, bandsFrom(bandsArg, L), { from });
      const pops = st.events.filter((e) => e[0] === "pop").length;
      console.log(`${String(+v.toFixed(4)).padEnd(10)} ${(st.result ?? "t/o").padEnd(8)}` +
        `${st.t.toFixed(2)}s  cans ${st.gotN}/${L.cans.length}  pops ${String(pops).padStart(2)}  ` +
        `end (${st.p.x.toFixed(0)},${st.p.y.toFixed(0)})`);
    }
    break;
  }
  case "link": {
    // A level SAVES by being a URL, and `?solo` runs the shipped sim in-page
    // with no server and no room — so a draft that has never been near
    // `levels.ts` is one link away from a real playtest on a real phone.
    // `adoptHashLevel` reads the fragment ONCE, at boot: navigating from
    // `#A` to `#B` changes nothing on screen, so always open a fresh tab.
    const { mod } = await load();
    const over = overrides(mod);
    const P = { ...mod.P, ...over };
    const L = mod.buildLevel(P, { solution: bandsFrom(rest[0], initLevel(mod.buildLevel(P))).map((b) => [[b.ax, b.ay], [b.bx, b.by]]) });
    const hash = encodeLevel(L);
    if (!decodeLevel(hash)) die("the level encoded to something the codec will not read back");
    const pts = L.terrain.reduce((n, p) => n + p.length, 0);
    console.log(`${ORIGIN}/g00mBa/?solo#${hash}`);
    console.log(`http://localhost:5178/?solo#${hash}`);
    console.log(`
  "${L.name}" — ${L.terrain.length} polylines / ${pts} points, ` +
      `${(L.pops || []).length} poppers, ${hash.length} chars
` +
      `  nothing grades this — the link IS the verdict. Play it.`);
    break;
  }
  case "figma": {
    // OUT to Figma, which is the direction the bridge did not have.
    //
    // A level's source is supposed to be a Figma frame — but a draft's geometry
    // is COMPUTED (a ring of stations, an arc), which is the one kind nobody
    // wants to draw by hand. So compute it here, hand it over as a frame, and
    // let Figma own it from then on. `figma/levels-to-svg.mjs` already renders a
    // pack as one artboard each in the naming vocabulary the reader expects, and
    // a PACK IS A LIST OF LINKS — so one link is a one-level pack and this
    // shells out to that generator rather than growing a second renderer that
    // would agree with it only on the day it was written.
    const { mod } = await load();
    const over = overrides(mod);
    const P = { ...mod.P, ...over };
    const hash = encodeLevel(mod.buildLevel(P));
    if (!decodeLevel(hash)) die("the level encoded to something the codec will not read back");
    const figDir = join(HERE, "figma");
    if (rest.includes("--kiwi")) {
      // Figma's OWN clipboard format, so terrain arrives as LINE nodes and toys
      // as INSTANCES of the kit — the thing SVG cannot do, because its import
      // flattens every shape to a VECTOR and the reader refuses those.
      const { figmaClipboardHtml, FILE_KEY } = await import(pathToFileURL(join(figDir, "kiwi.mjs")).href);
      const { html, nodes, bytes } = figmaClipboardHtml(initLevel(mod.buildLevel(P)));
      const ok = copyToClipboard(html, "text/html");
      console.log(`  ${nodes} nodes, ${bytes} base64 chars, for file ${FILE_KEY}`);
      console.log(ok
        ? "  on the clipboard — Ctrl+V in THAT Figma file (and no other)"
        : "  could not reach the clipboard");
      break;
    }
    const tmp = join(figDir, ".draft-pack.json");
    writeFileSync(tmp, JSON.stringify([hash]), "utf8");
    try {
      execFileSync("node", [join(figDir, "levels-to-svg.mjs"), "--pack", tmp], { stdio: "inherit" });
    } finally { unlinkSync(tmp); }
    const svgPath = join(figDir, "figma-levels.svg");
    if (rest.includes("--copy")) {
      const svg = readFileSync(svgPath, "utf8");
      const ok = copyToClipboard(svg, "text/plain");
      console.log(ok ? `  ${svg.length} chars on the clipboard — Ctrl+V in Figma`
                     : "  could not reach the clipboard; open the file instead");
    }
    console.log(`  ${svgPath}
  drag it onto a Figma canvas, or --copy and paste`);
    break;
  }
  case "card": {
    const { file, mod } = await load();
    const over = overrides(mod);
    const L = initLevel(mod.buildLevel({ ...mod.P, ...over }));
    const bands = bandsFrom(rest[0], L);
    const out = rest[1] || join(DRAFTS, `${file.replace(/\.mjs$/, "")}.svg`);
    const { st, path } = simulate(L, bands);
    writeFileSync(out, card(L, bands, path, st), "utf8");
    console.log(`${out}  ${st.result ?? "timeout"} @${st.t.toFixed(2)}s cans ${st.gotN}/${L.cans.length}`);
    break;
  }
  default:
    die(readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("\n").filter((l) => l.startsWith("//")).slice(0, 20).map((l) => l.slice(3)).join("\n"));
}

/**
 * The ride card, as plain SVG.
 *
 * Nothing here needs a rasteriser: an SVG opens in a browser, drops into a PR,
 * and is what gets reviewed. It is also the only thing in this file that shows
 * you the SHAPE of a ride rather than a number about it.
 */
function card(L, bands, path, st) {
  const b = L.bounds, S = 5, PAD = 10;
  const X = (x) => ((x - b.x0) * S + PAD).toFixed(1), Y = (y) => ((y - b.y0) * S + PAD).toFixed(1);
  const W = (b.x1 - b.x0) * S + PAD * 2, H = (b.y1 - b.y0) * S + PAD * 2;
  const e = [`<rect width="${W}" height="${H}" fill="#150a2a"/>`];
  for (const poly of L.terrain)
    e.push(`<polyline points="${poly.map((p) => X(p[0]) + "," + Y(p[1])).join(" ")}" fill="none" stroke="#f3e6d0" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const p of L.pops || []) {
    const a = (p.deg * Math.PI) / 180;
    e.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${6 * S}" fill="none" stroke="#ffb3d9" stroke-width="2" stroke-dasharray="6 5"/>`);
    e.push(`<line x1="${X(p.x)}" y1="${Y(p.y)}" x2="${X(p.x + Math.cos(a) * 9)}" y2="${Y(p.y + Math.sin(a) * 9)}" stroke="#ff5db1" stroke-width="4"/>`);
  }
  for (const c of L.cans || []) {
    e.push(`<circle cx="${X(c[0])}" cy="${Y(c[1])}" r="${7.5 * S}" fill="none" stroke="#7ce6c0" stroke-width="2" stroke-dasharray="5 5"/>`);
    e.push(`<circle cx="${X(c[0])}" cy="${Y(c[1])}" r="7" fill="#7ce6c0"/>`);
  }
  for (const m of L.bumpers || [])
    e.push(`<circle cx="${X(m.x)}" cy="${Y(m.y)}" r="${5.5 * S}" fill="#b18bff" opacity="0.5"/>`);
  e.push(`<circle cx="${X(L.goal[0])}" cy="${Y(L.goal[1])}" r="${9 * S}" fill="#ffe9a8" opacity="0.18"/>`);
  e.push(`<circle cx="${X(L.goal[0])}" cy="${Y(L.goal[1])}" r="10" fill="#ffe9a8"/>`);
  e.push(`<circle cx="${X(L.start[0])}" cy="${Y(L.start[1])}" r="10" fill="#ffa257"/>`);
  for (const d of bands)
    e.push(`<line x1="${X(d.ax)}" y1="${Y(d.ay)}" x2="${X(d.bx)}" y2="${Y(d.by)}" stroke="#ff5db1" stroke-width="5" stroke-dasharray="10 6"/>`);
  e.push(`<polyline points="${path.map((p) => X(p[0]) + "," + Y(p[1])).join(" ")}" fill="none" stroke="#3dff7a" stroke-width="3" opacity="0.9"/>`);
  e.push(`<text x="14" y="${H - 14}" fill="#fff" font-family="monospace" font-size="18">${L.name} — ${st.result ?? "timeout"} @${st.t.toFixed(2)}s, cans ${st.gotN}/${(L.cans || []).length}, ${bands.length} band(s)</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${e.join("")}</svg>`;
}
