// Figma's NATIVE clipboard -> GoombaLevel. Plain Ctrl+C in Figma, Ctrl+V here.
// The ONLY reader: it reads the numbers the Figma file holds (layer names
// always survive, a Line's stored geometry IS the segment, an instance carries
// its own transform), where an exporter's SVG loses names and shifts strokes.
//
// HOW THE PAYLOAD IS SHAPED
// Ctrl+C puts HTML on the clipboard holding two comment-wrapped base64 blobs:
//   <span data-metadata="<!--(figmeta)…-->"></span>
//   <span data-buffer="<!--(figma)…-->"></span>
// The second decodes to a `fig-kiwi` container:
//   "fig-kiwi" magic (8 bytes) | uint32 version | then repeated:
//   uint32 byteLength | that many bytes, compressed (see `decompress`)
// Block 0 is a binary Kiwi SCHEMA, block 1 is the message; the schema travels
// with the data, so `kiwi-schema` decodes the message generically.
//
// It is an undocumented format. Everything below fails LOUDLY rather than
// guessing — a level that decodes wrong is a level nobody can see is wrong.
import { decodeBinarySchema, compileSchema } from "kiwi-schema";
import { stitchTerrain } from "./stitch.js";
import { rectPoly, ellipsePoly, cutTester, applyCuts } from "./shapes.js";

const S = 10; // px per world unit
const ROUND = (v) => Math.round(v * 10) / 10; // tenths: the codec's precision

/** Does this clipboard HTML hold a Figma payload at all? */
export const hasFigmaBuffer = (html) =>
  typeof html === "string" && html.includes("data-buffer") && html.includes("(figma)");

/**
 * Pull the base64 payload out of the clipboard HTML. Do NOT regex the raw
 * markup: how the comment wrapper is serialised varies, so let a parser decode
 * the attribute, then slice between the `(figma)` sentinels. Accepts base64url
 * as well as standard base64.
 */
function extractBuffer(html) {
  let raw = null;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const el = doc.querySelector("[data-buffer]");
    if (el) raw = el.getAttribute("data-buffer");
  } catch {
    /* fall through to the text scan */
  }
  if (!raw) {
    const m = /data-buffer\s*=\s*"([^"]*)"/.exec(html) || /data-buffer\s*=\s*'([^']*)'/.exec(html);
    if (m) raw = m[1];
  }
  if (!raw) throw new Error("this clipboard mentions a Figma buffer but carries no data-buffer attribute");

  const open = raw.indexOf("(figma)");
  if (open < 0)
    throw new Error(
      `found the Figma buffer but not its opening (figma) marker — it began "${raw.slice(0, 40)}"`,
    );
  // The payload closes with `(/figma)`. Accept either form; with neither, trim
  // the comment tail so the sanitiser below cannot fold "figma" into the base64.
  const rest = raw.slice(open + "(figma)".length);
  const close = rest.search(/\(\/?figma\)/);
  const inner = close >= 0 ? rest.slice(0, close) : rest.replace(/--\s*(?:>|&gt;)\s*$/, "");
  const b64 = inner.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/=]/g, "");
  if (b64.length < 32)
    throw new Error(`the Figma buffer decoded to only ${b64.length} base64 chars`);
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch (err) {
    throw new Error(`the Figma buffer is not valid base64 (${b64.length} chars): ${err.message}`);
  }
}

/**
 * The two blocks are NOT compressed alike: the schema is raw deflate, the
 * message is ZSTANDARD (magic `28 b5 2f fd`). Pick by magic, never by position.
 * Chrome has no `DecompressionStream("zstd")`, hence fzstd.
 */
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const isZstd = (b) => ZSTD_MAGIC.every((v, i) => b[i] === v);

async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompress(bytes, which) {
  if (isZstd(bytes)) {
    const { decompress: unzstd } = await import("fzstd");
    return unzstd(bytes);
  }
  try {
    return await inflateRaw(bytes);
  } catch (err) {
    throw new Error(
      `could not decompress the ${which} block — it is neither zstd nor raw deflate ` +
      `(begins ${[...bytes.slice(0, 4)].map((v) => v.toString(16).padStart(2, "0")).join(" ")}): ${err.message}`,
    );
  }
}

/** Split the fig-kiwi container into its blocks, each decompressed by magic. */
async function blocks(buf) {
  const magic = String.fromCharCode(...buf.slice(0, 8));
  if (magic !== "fig-kiwi") throw new Error(`not a fig-kiwi payload (magic "${magic}")`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let at = 12; // 8 magic + uint32 version
  const raw = [];
  while (at + 4 <= buf.byteLength) {
    const len = dv.getUint32(at, true);
    at += 4;
    if (!len || at + len > buf.byteLength) break;
    raw.push(buf.subarray(at, at + len));
    at += len;
  }
  if (raw.length < 2) throw new Error("the Figma payload had no schema+message pair");
  return [
    await decompress(raw[0], "schema"),
    await decompress(raw[1], "message"),
  ];
}

const gid = (g) => (g ? `${g.sessionID}:${g.localID}` : null);

/** 2x3 affine, laid out [a b tx / c d ty] — Figma's Matrix is m00…m12. */
const IDENT = [1, 0, 0, 0, 1, 0];
function mul(m, t) {
  const b = [t.m00 ?? 1, t.m01 ?? 0, t.m02 ?? 0, t.m10 ?? 0, t.m11 ?? 1, t.m12 ?? 0];
  return [
    m[0] * b[0] + m[1] * b[3], m[0] * b[1] + m[1] * b[4], m[0] * b[2] + m[1] * b[5] + m[2],
    m[3] * b[0] + m[4] * b[3], m[3] * b[1] + m[4] * b[4], m[3] * b[2] + m[4] * b[5] + m[5],
  ];
}
const apply = (m, x, y) => ({ x: m[0] * x + m[1] * y + m[2], y: m[3] * x + m[4] * y + m[5] });
const degOf = (m) => (Math.atan2(m[3], m[0]) * 180) / Math.PI;


/**
 * What KIND of thing is this node? A toy is an INSTANCE and its identity is
 * the SYMBOL it points at (`symbolData.symbolID`), never its own name. Only
 * `t` (terrain) and `cut` go by name, matched loosely (trailing digits and a
 * `-42` suffix ignored).
 *
 * Exported because `tools/goomba/figma/read-frame.mjs` reads the same names
 * from a different carrier — one copy, never a second regex. A caller holding
 * INSTANCE nodes must resolve the symbol before calling this.
 */
export const stripDup = (s) => String(s || "").replace(/[\s-]*\d+$/, "").replace(/_\d+$/, "").trim();
export const KINDS = /^(watering-can|party-popper|start|goal|bumper|cushion|band|can|pop|cut|t)$/i;
export function classify(name) {
  const n = stripDup(name);
  if (!n || n.startsWith("_") || n.startsWith("//")) return null;
  const m = KINDS.exec(n);
  if (!m) return null;
  let kind = m[1].toLowerCase();
  if (kind === "watering-can") kind = "can";
  if (kind === "party-popper") kind = "pop";
  return { kind };
}
export function levelName(name) {
  const m = /^L\s*(?::|--)\s*(.+)$/.exec(String(name || "").trim());
  if (!m) return null;
  const t = m[1].trim();
  return t.includes(" ") ? t : t.replace(/-/g, " ");
}

/**
 * Turn clipboard HTML into { level, warnings }. Throws with something a
 * designer can act on.
 */
export async function levelFromFigmaClipboard(html) {
  const raw = extractBuffer(html);
  const [schemaBytes, messageBytes] = await blocks(raw);
  const codec = compileSchema(decodeBinarySchema(schemaBytes));
  if (typeof codec.decodeMessage !== "function")
    throw new Error("this Figma payload's schema has no Message type");
  const msg = codec.decodeMessage(messageBytes);
  const changes = msg.nodeChanges || [];
  // If Figma has renamed these fields, say exactly what arrived instead — one
  // paste is then the whole bug report.
  if (!changes.length) {
    throw new Error(
      "decoded the Figma clipboard but found no `nodeChanges`. Top-level fields " +
      `were: ${Object.keys(msg).join(", ") || "(none)"}. Figma's schema may have moved.`,
    );
  }
  const shaped = changes.find((n) => n && n.transform && n.size);
  if (!shaped) {
    throw new Error(
      `decoded ${changes.length} node(s), but none carry both \`transform\` and \`size\`. ` +
      `The first node's fields were: ${Object.keys(changes[0] || {}).join(", ") || "(none)"}.`,
    );
  }
  // A matrix not called m00… would compose as identity and pile every prop on
  // the origin — a wrong level rather than an error. Refuse.
  if (typeof shaped.transform.m00 !== "number") {
    throw new Error(
      "Figma's transform is not shaped the way this reader expects: it holds " +
      `${Object.keys(shaped.transform).join(", ") || "(nothing)"} instead of m00…m12.`,
    );
  }

  const byGuid = new Map();
  for (const n of changes) {
    const k = gid(n.guid);
    if (k) byGuid.set(k, n);
  }

  const warnings = [];
  const terrain = [], cans = [], bumpers = [], cushions = [], pops = [];
  // `band` layers are consumed and counted, never read: a level carries no
  // solution (no codec field for one), but old frames still have them.
  let droppedBands = 0;
  let start = null, goal = null, name = null;
  const shapes = [], cuts = [];

  // Children by parent, in sibling order, so repeated toys land in the order
  // they sit on the canvas.
  const kids = new Map();
  for (const n of changes) {
    const p = n.parentIndex && gid(n.parentIndex.guid);
    if (!p) continue;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(n);
  }
  for (const list of kids.values()) {
    list.sort((a, b) => {
      const pa = a.parentIndex?.position ?? "", pb = b.parentIndex?.position ?? "";
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
  }

  // A copy carries the Document, the Page and the COMPONENT DEFINITIONS behind
  // every instance, named exactly like the instances — so walk DOWN from the
  // level frame instead of scanning every node, and stop at anything that
  // matches. The frame's title IS the level's name, nothing folded into it.
  const frameNode = changes.find((n) => levelName(n.name));
  if (frameNode) name = levelName(frameNode.name);
  const roots = frameNode
    ? [frameNode]
    // No frame in the selection: take everything sitting directly on the page.
    : changes.filter((n) => {
        const p = n.parentIndex && gid(n.parentIndex.guid);
        const parent = p && byGuid.get(p);
        return parent && /^(CANVAS|DOCUMENT)$/.test(parent.type || "");
      });
  if (!roots.length) throw new Error("could not find a level frame or any pasted nodes");

  const W = (v) => ROUND(v / S);
  /**
   * The name to classify a node BY. For an instance that is its component's
   * name, looked up through `symbolData.symbolID` — the instance's own name is
   * never consulted, so renaming one in the layers panel cannot break a level.
   * Everything else answers to its own name, which is only `t` and `cut`.
   */
  const identity = (n) => {
    if (n.type === "INSTANCE") {
      const sym = n.symbolData && byGuid.get(gid(n.symbolData.symbolID));
      // The instance's own name only when the component is not in the
      // payload (a detached copy, or a synthetic fixture).
      if (sym) return sym.name;
    }
    return n.name;
  };
  const emit = (n, m) => {
    const hit = classify(identity(n));
    if (!hit) return false;
    const { kind } = hit;
    const w = n.size?.x ?? 0, h = n.size?.y ?? 0;
    const radius = n.cornerRadius ?? n.rectangleTopLeftCornerRadius ?? 0;
    if (kind === "band") { droppedBands++; return true; }
    if (kind === "cut") {
      // A shape that SUBTRACTS. Applied after stitching: a cut through the
      // middle of a chain has to split the chain.
      const isEllipse = n.type === "ELLIPSE";
      const t = (isEllipse || /RECT/.test(n.type || ""))
        ? cutTester(isEllipse ? "ellipse" : "rect", m, w, h, radius)
        : null;
      if (t) cuts.push(t);
      else warnings.push(
        `"${n.name}" is a ${n.type || "shape"} — a \`cut\` must be a Rectangle or ` +
        `an Ellipse, so nothing was taken away.`);
      return true;
    }
    if (kind === "t") {
      // A Figma Line is a zero-height node: local (0,0)-(width,0) IS the
      // segment. A pen path named `t` is REFUSED, not read: its bbox top edge
      // would arrive as a plausible straight segment that silently changes
      // whether the level is winnable. A missing layer is a bug someone can SEE.
      if (n.type === "ELLIPSE") { shapes.push(ellipsePoly(m, w, h)); return true; }
      if (/RECT/.test(n.type || "")) { shapes.push(rectPoly(m, w, h, radius)); return true; }
      if (n.type !== "LINE" || Math.abs(h) > 0.01) {
        warnings.push(
          `"${n.name}" is a ${n.type || "shape"} — skipped. Terrain is a Line, a ` +
          `Rectangle or an Ellipse; a pen path has no readable outline.`,
        );
        return true;
      }
      const a = apply(m, 0, 0), b = apply(m, w, 0);
      terrain.push([[W(a.x), W(a.y)], [W(b.x), W(b.y)]]);
      return true;
    }
    const c = apply(m, w / 2, h / 2); // instance centre
    if (kind === "start") start = [W(c.x), W(c.y)];
    else if (kind === "goal") goal = [W(c.x), W(c.y)];
    else if (kind === "can") cans.push([W(c.x), W(c.y)]);
    else if (kind === "bumper") bumpers.push({ x: W(c.x), y: W(c.y) });
    // No speed: there is ONE (POP_SPD in shared), and `initLevel` stamps it.
    // A frame could never have carried a per-popper number anyway — Figma
    // numbers duplicate layers, so `party-popper 138`…`149` would be twelve
    // speeds nobody chose.
    else if (kind === "pop") pops.push({ x: W(c.x), y: W(c.y), deg: ROUND(degOf(m)) });
    else if (kind === "cushion") {
      const left = apply(m, 0, h / 2);
      cushions.push({ x: W(left.x), y: W(left.y), w: ROUND(w / S) });
    }
    return true;
  };

  const walk = (node, m, depth) => {
    if (depth > 32) return;
    for (const child of kids.get(gid(node.guid)) || []) {
      const cm = child.transform ? mul(m, child.transform) : m;
      // Stop at anything that matched: a component's inner art repeats the
      // component's own name, so descending would count every toy twice.
      if (!emit(child, cm)) walk(child, cm, depth + 1);
    }
  };
  // The frame's own SIZE is the world (its POSITION on the Figma canvas is
  // not part of the level, so the box is frame-local). This is padding a
  // designer draws on purpose; `initLevel` unions it into bounds.
  let frame;
  if (frameNode && frameNode.size) {
    const fw = frameNode.size.x ?? 0, fh = frameNode.size.y ?? 0;
    if (fw > 0 && fh > 0) frame = { x0: 0, y0: 0, x1: W(fw), y1: W(fh) };
  }

  for (const r of roots) {
    if (frameNode) {
      // The frame IS the coordinate space: the walk starts from identity.
      walk(r, IDENT, 0);
    } else {
      const rm = r.transform ? mul(IDENT, r.transform) : IDENT;
      if (!emit(r, rm)) walk(r, rm, 0);
    }
  }

  const found = terrain.length + shapes.length + cans.length + bumpers.length +
    cushions.length + pops.length + (start ? 1 : 0) + (goal ? 1 : 0);
  if (!found)
    throw new Error(
      "read the Figma clipboard, but nothing in it is named for a level. " +
      "Terrain is Lines, Rectangles or Ellipses named `t`; toys are instances " +
      "of the kit, whatever their layers are called.",
    );
  if (!start) throw new Error("no layer named `start` — the level has no spawn");
  if (!goal) throw new Error("no layer named `goal` — the level has no plant");
  if (!terrain.length && !shapes.length)
    warnings.push("no terrain: nothing named `t`. She will just fall.");

  const level = {
    name: name || "pasted from Figma",
    start, goal,
    ...(frame ? { frame } : {}),
    // One Figma Line per segment; chains of them are one surface (stitch.js).
    // Rect and ellipse outlines arrive whole and skip stitching. Then every
    // `cut` shape is subtracted from the lot (shapes.js).
    terrain: applyCuts([...stitchTerrain(terrain), ...shapes], cuts),
    cans, cushions, pops, bumpers,
  };
  if (droppedBands)
    warnings.push(
      `ignored ${droppedBands} \`band\` layer(s): a level does not carry a ` +
      `solution — there is no field for one. Delete them from the frame; the ` +
      `players find the bands.`,
    );
  return { level, warnings };
}
