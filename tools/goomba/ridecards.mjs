// Render one "ride card" PNG per level: the level plus her actual traced
// trajectory. The shape of the ride is the fun, so these are what get reviewed.
// Geometry is drawn as SVG from the shared sim's data (the game's canvas art
// went with the prototype); Chromium only rasterises the SVG.
// Usage: node ridecards.mjs [outDir] [levelIdx...]   (default: every level)
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { LEVELS, bandPoints, rideTrace } from "./lib.mjs";

const outDir = process.argv[2] || ".";
const only = process.argv.slice(3).map(Number);
const idxs = only.length ? only : LEVELS.map((_, i) => i);

const COLORS = ["#ff5db1", "#57e6c9", "#ffd166", "#b18bff"];
const CARD_W = 460, CARD_H = 760;

function svgCard(li) {
  const r = rideTrace(li);
  const L = r.L, b = L.bounds;
  const pad = 24, top = 56;
  const s = Math.min((CARD_W - pad * 2) / (b.x1 - b.x0), (CARD_H - top - pad) / (b.y1 - b.y0));
  const X = (x) => ((x - (b.x0 + b.x1) / 2) * s + CARD_W / 2).toFixed(1);
  const Y = (y) => ((y - (b.y0 + b.y1) / 2) * s + (CARD_H + top) / 2).toFixed(1);
  const poly = (pts) => pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ");
  const el = [];

  for (const p of L.terrain)
    el.push(`<polyline points="${poly(p)}" fill="none" stroke="#f3e9d6" stroke-width="${(1.5 * s).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const c of L.cushions)
    el.push(`<rect x="${X(c.x)}" y="${Y(c.y)}" width="${(c.w * s).toFixed(1)}" height="${(3 * s).toFixed(1)}" rx="${(1.4 * s).toFixed(1)}" fill="#ff9dce"/>`);
  for (const pp of L.pops) {
    const a = (pp.deg * Math.PI) / 180;
    el.push(`<circle cx="${X(pp.x)}" cy="${Y(pp.y)}" r="${(6 * s).toFixed(1)}" fill="none" stroke="#ffd16688" stroke-dasharray="4 4"/>`);
    el.push(`<line x1="${X(pp.x)}" y1="${Y(pp.y)}" x2="${X(pp.x + Math.cos(a) * 5)}" y2="${Y(pp.y + Math.sin(a) * 5)}" stroke="#ff5db1" stroke-width="3" stroke-linecap="round"/>`);
  }
  for (const bp of L.bumpers)
    el.push(`<circle cx="${X(bp.x)}" cy="${Y(bp.y)}" r="${(5.5 * s).toFixed(1)}" fill="#ff5db1" stroke="#ffd166"/>`);
  for (const m of L.cans)
    el.push(`<circle cx="${X(m[0])}" cy="${Y(m[1])}" r="${(3 * s).toFixed(1)}" fill="none" stroke="#57e6c9" stroke-width="2"/>`);
  el.push(`<text x="${X(L.goal[0])}" y="${Y(L.goal[1])}" font-size="${(6 * s).toFixed(0)}" text-anchor="middle">🪴</text>`);
  r.bands.forEach((bd, i) =>
    el.push(`<polyline points="${poly(bandPoints(bd))}" fill="none" stroke="${COLORS[i % 4]}" stroke-width="${(1.2 * s).toFixed(1)}" stroke-linecap="round"/>`));

  // the traced path: bright where airborne, dim where riding a surface
  for (const air of [0, 1]) {
    let d = "", pen = false;
    for (const [px, py, g] of r.path) {
      if ((g ? 0 : 1) !== air) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${X(px)} ${Y(py)}`;
      pen = true;
    }
    el.push(`<path d="${d}" fill="none" stroke="rgba(255,255,255,${air ? 0.92 : 0.3})" stroke-width="${air ? 2.6 : 1.6}" stroke-linecap="round"/>`);
  }
  for (const [kind, ex, ey] of r.events)
    el.push(`<circle cx="${X(ex)}" cy="${Y(ey)}" r="9" fill="none" stroke="${kind === "pop" ? "#ffd166" : kind === "bump" ? "#ff5db1" : "#57e6c9"}" stroke-width="2"/>`);
  el.push(`<circle cx="${X(r.end.x)}" cy="${Y(r.end.y)}" r="4" fill="#fff"/>`);

  const stats = `${r.result} · ${r.t.toFixed(1)}s · ${r.airPct}% airborne · top speed ${r.topSpeed}` +
    ` · bands ${r.bands.length}` + (L.cans.length ? ` · cans ${r.cans}` : "");
  return {
    stats: { level: li + 1, result: r.result, t: r.t, airPct: r.airPct, topSpeed: r.topSpeed, events: r.events.length, cans: r.cans },
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">
<rect width="100%" height="100%" fill="#150a2a"/>
<text x="14" y="26" fill="#f2ecff" font-family="system-ui,sans-serif" font-weight="700" font-size="15">${li + 1} · ${L.name}</text>
<text x="14" y="44" fill="${r.result === "win" ? "#57e6c9" : "#ff8f8f"}" font-family="system-ui,sans-serif" font-size="11">${stats}</text>
${el.join("\n")}
</svg>`,
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: CARD_W, height: CARD_H } });
const all = [];
for (const i of idxs) {
  const { svg, stats } = svgCard(i);
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  await page.screenshot({ path: `${outDir}/ride-L${i + 1}.png` });
  all.push(stats);
}
console.log(JSON.stringify(all, null, 1));
await browser.close();
