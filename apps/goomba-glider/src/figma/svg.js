// Figma SVG -> GoombaLevel. The whole import side of the Figma bridge.
//
// You select a level frame in Figma, copy it as SVG (or export it), paste here,
// and this turns it into the same plain data `levels.ts` holds. Nothing else in
// this app authors anything — the design surface is Figma.
//
// It reads the SVG through the BROWSER's own SVG engine rather than parsing
// geometry by hand: the document is attached off-screen, then `getBBox()` and
// `getCTM()` do the bounding boxes and the accumulated transforms. That is why
// nested groups, clip paths and rotations all come out right for free.
//
// The naming contract lives in tools/goomba/figma/README.md. In one line: layer
// NAMES carry the meaning, positions come from the nodes, and anything named
// with a leading `_` is ignored.

import { stitchTerrain } from "./stitch.js";

const S = 10; // px per world unit — the scale the whole kit is built at
const ROUND = (v) => Math.round(v * 10) / 10; // tenths: the codec's precision

/**
 * Figma's SVG exporter writes ids as UTF-8 bytes reinterpreted as latin-1, so a
 * level called "1 · The Long Way Down" arrives as "1 Â· The Long Way Down".
 * Only touch strings showing that signature, or a genuinely accented name would
 * get mangled instead of repaired.
 */
function fixMojibake(s) {
  if (!/[ÂÃ]/.test(s)) return s;
  try {
    const bytes = Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return s; // not actually mojibake; leave it alone
  }
}

/** Figma disambiguates repeated layer names with `_2`, `_3`, … */
const stripDup = (s) => s.replace(/_\d+$/, "");

const KINDS = /^(watering-can|party-popper|start|goal|bumper|cushion|band|can|pop|t)\s*-?\s*(\d+)?$/i;

/**
 * A layer name -> what it means, or null for "not ours, keep looking inside".
 * Longest names first in the alternation so `watering-can` never reads as `can`.
 */
function classify(rawId) {
  if (!rawId) return null;
  const name = stripDup(fixMojibake(rawId)).trim();
  if (!name || name.startsWith("_") || name.startsWith("//")) return null;
  const m = KINDS.exec(name);
  if (!m) return null;
  let kind = m[1].toLowerCase();
  if (kind === "watering-can") kind = "can";
  if (kind === "party-popper") kind = "pop";
  return { kind, num: m[2] ? Number(m[2]) : null };
}

/** Is this the level frame itself? `L: My Level` or `L--My-Level`. */
function levelName(rawId) {
  if (!rawId) return null;
  const name = fixMojibake(rawId).trim();
  const m = /^L\s*(?::|--)\s*(.+)$/.exec(name);
  if (!m) return null;
  const title = m[1].trim();
  // A generated frame slugs spaces to hyphens; a hand-typed one keeps them.
  return title.includes(" ") ? title : title.replace(/-/g, " ");
}

/**
 * Undo the SVG exporter's half-stroke shift.
 *
 * Figma stores a Line exactly — the file for the first terrain segment of level
 * 1 holds x 180, y 220, width 356.93 — but its SVG exporter emits that same line
 * INSET by half the stroke at each end and shifted half a stroke perpendicular.
 * Measured against the file, the inverse below returns the stored endpoints to
 * four decimal places, and it is derived from the `stroke-width` sitting on the
 * same element rather than hardcoded.
 *
 * If a future Figma changes this, terrain drifts by half a stroke and nothing
 * throws — so a pasted level is still only *proposed*. `verify.mjs --hash` on
 * the copied link is what proves it.
 */
function unshiftStroke(p1, p2, w) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (!len || !w) return [p1, p2];
  const h = w / 2;
  const ux = dx / len, uy = dy / len;      // along the line
  const px = -uy, py = ux;                 // perpendicular, +90 deg in y-down
  return [
    { x: p1.x - h * ux + h * px, y: p1.y - h * uy + h * py },
    { x: p2.x + h * ux + h * px, y: p2.y + h * uy + h * py },
  ];
}

/**
 * Read the pasted SVG. Returns { level, warnings } — or throws with something
 * a designer can act on.
 */
export function levelFromFigmaSvg(svgText) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("that is not valid SVG");
  const root = doc.documentElement;
  if (root.localName !== "svg") throw new Error("no <svg> in what you pasted");

  // getBBox/getCTM need the node in a rendered tree, so park it off-screen.
  const host = document.createElement("div");
  host.setAttribute("style", "position:fixed;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;");
  const live = document.importNode(root, true);
  host.appendChild(live);
  document.body.appendChild(host);

  const warnings = [];
  try {
    const terrain = [], cans = [], bumpers = [], cushions = [], pops = [];
    let start = null, goal = null, name = null;
    // Old frames still carry `band` layers from when a level shipped its own
    // answer key. Counted and dropped; see clipboard.js.
    let droppedBands = 0;

    const rootCTM = live.getScreenCTM();
    const toRoot = (el, x, y) => {
      const m = el.getCTM();
      const p = live.createSVGPoint();
      p.x = x; p.y = y;
      return m ? p.matrixTransform(m) : p;
    };
    /** The anchor dot each kit component carries, in root coordinates, plus the
     * rotation baked into its transform. */
    const anchorOf = (el) => {
      const a = el.querySelector('[id^="anchor"]');
      const target = a || el;
      if (!a) warnings.push(`no anchor dot inside "${el.getAttribute("id")}" — used its bounding box instead, which can be off by a unit`);
      const b = target.getBBox();
      const c = toRoot(target, b.x + b.width / 2, b.y + b.height / 2);
      const m = target.getCTM();
      const deg = m ? (Math.atan2(m.b, m.a) * 180) / Math.PI : 0;
      return { x: c.x, y: c.y, deg };
    };
    const W = (v) => ROUND(v / S);

    (function walk(el) {
      for (const child of el.children) {
        const id = child.getAttribute("id");
        if (name === null) {
          const n = levelName(id);
          if (n) { name = n; walk(child); continue; }
        }
        const hit = classify(id);
        if (!hit) { walk(child); continue; } // not ours: look inside

        const { kind, num } = hit;
        if (kind === "band") { droppedBands++; continue; }
        if (kind === "t") {
          if (child.localName !== "line") {
            warnings.push(`"${id}" is a ${child.localName}, not a Line — skipped. Draw terrain with the Line tool (L).`);
            continue;
          }
          const a = toRoot(child, child.x1.baseVal.value, child.y1.baseVal.value);
          const b = toRoot(child, child.x2.baseVal.value, child.y2.baseVal.value);
          const w = parseFloat(child.getAttribute("stroke-width")) || 0;
          const [p, q] = unshiftStroke(a, b, w);
          terrain.push([[W(p.x), W(p.y)], [W(q.x), W(q.y)]]);
          continue;
        }

        const at = anchorOf(child);
        if (kind === "start") start = [W(at.x), W(at.y)];
        else if (kind === "goal") goal = [W(at.x), W(at.y)];
        else if (kind === "can") cans.push([W(at.x), W(at.y)]);
        else if (kind === "bumper") bumpers.push({ x: W(at.x), y: W(at.y) });
        else if (kind === "pop") {
          pops.push({
            x: W(at.x), y: W(at.y),
            deg: ROUND(at.deg),
            spd: num ?? 76, // bare name means the common popper
          });
        } else if (kind === "cushion") {
          // The one asymmetric anchor: left end of the collision line. Width runs
          // from there to the art's right edge, so the anchor dot's own 1.5px
          // overhang on the left cannot inflate it.
          const b = child.getBBox();
          const right = toRoot(child, b.x + b.width, b.y);
          cushions.push({ x: W(at.x), y: W(at.y), w: ROUND((right.x - at.x) / S) });
        }
      }
    })(live);

    // The failure that actually happens in practice, and it looks nothing like
    // a broken level: Figma's SVG output only carries layer names when the
    // `id` attribute is switched on, and it is OFF by default. "Copy as SVG"
    // gives you no way to switch it on, so that route arrives with every name
    // stripped — same frame, 111 ids with the option, 3 without. Say so
    // instead of reporting a missing `start`, which sends people to look at
    // their level.
    const named = terrain.length + cans.length + bumpers.length +
      cushions.length + pops.length + (start ? 1 : 0) + (goal ? 1 : 0);
    if (!named) {
      throw new Error(
        "this SVG has no layer names, so there is nothing to read. Figma only " +
        "writes them when the `id` attribute is on, and Copy as SVG cannot turn " +
        "it on — use the frame's Export → SVG with “Include id attribute” " +
        "ticked, then drop that file here.",
      );
    }
    if (!start) throw new Error("no layer named `start` — the level has no spawn");
    if (!goal) throw new Error("no layer named `goal` — the level has no cake");
    if (!terrain.length) warnings.push("no terrain: nothing named `t`. She will just fall.");
    if (droppedBands)
      warnings.push(
        `ignored ${droppedBands} \`band\` layer(s): a level no longer carries a ` +
        `baked solution. Delete them from the frame.`,
      );

    return {
      level: {
        name: name || "pasted from Figma",
        budget: 4,
        start, goal,
        // Chains of Lines back into polylines; see stitch.js.
        terrain: stitchTerrain(terrain),
        cans,
        cushions,
        pops,
        bumpers,
      },
      warnings,
    };
  } finally {
    host.remove();
  }
}
