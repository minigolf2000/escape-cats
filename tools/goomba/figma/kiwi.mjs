// A level -> Figma's OWN clipboard format, so a paste lands as real nodes.
//
// This is the direction the bridge never had. `levels-to-svg.mjs` can hand
// Figma a picture, but Figma's SVG import keeps the NAME and throws the node
// TYPE away — measured with `figma.createNodeFromSvg`, every `<line>`, `<rect>`
// and `<ellipse>` arrives as a VECTOR — and the reader refuses a vector `t` on
// purpose. So an SVG paste is a tracing template and can never be a round trip.
// Only two carriers can set a node's type: the plugin API, and this.
//
// WHAT A PASTE ACTUALLY IS
// The clipboard holds `<span data-buffer="<!--(figma)…(/figma)-->">` around a
// base64 `fig-kiwi` container: "fig-kiwi" magic, a uint32 version, then
// length-prefixed compressed blocks. Block 0 is a binary Kiwi SCHEMA, block 1
// is the message it describes. `clipboard.js` reads that; this writes it.
//
// THE SCHEMA IS BORROWED, NOT WRITTEN. `kiwi-schema` compiles a schema into a
// codec that encodes as well as decodes, and the schema travels inside the
// payload — so the honest move is to ship the exact bytes out of the real
// Ctrl+C we already keep as a fixture, verbatim, and encode against the codec
// they compile to. Nothing here knows what a Figma field means; it knows what
// one real copy contained.
//
// WHAT THAT COSTS, stated plainly:
//   * The format is undocumented and this pins a snapshot of ONE Figma version
//     (container 106). It is meant to be disposable.
//   * `pasteFileKey` names the file, so a payload pastes into that file and
//     no other. That is deliberate — component instances are the whole point,
//     and a `symbolID` only means anything in the file that holds the symbol.
//   * `derivedSymbolData` and the 111 geometry `blobs` a real copy carries are
//     omitted on the theory that "derived" means Figma rebuilds them. If
//     instances come through blank, that theory is what was wrong.
import { readFileSync } from "node:fs";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeBinarySchema, compileSchema } from "kiwi-schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const S = 10;                    // px per world unit, as everywhere else
const CONTAINER_VERSION = 106;

/** The Figma file this pastes into, and the kit inside it. */
export const FILE_KEY = "vRN6Q44ReIaESP5wv8M2dI";
/** Component guids, read out of that file. A symbolID means nothing anywhere else. */
export const KIT = {
  start: [45, 73, 110, 110],
  "party-popper": [45, 80, 140, 140],
  bumper: [45, 92, 180, 180],
  "watering-can": [45, 105, 180, 140],
  cushion: [45, 113, 240, 56],
  goal: [46, 45, 200, 210],
};

/** Split the fixture's container back into its two raw blocks. */
function fixtureBlocks() {
  const b64 = readFileSync(join(HERE, "fixtures", "real-figma-copy.b64"), "utf8").trim();
  const buf = Buffer.from(b64, "base64");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let at = 12;
  const out = [];
  while (at + 4 <= buf.byteLength) {
    const len = dv.getUint32(at, true);
    at += 4;
    if (!len || at + len > buf.byteLength) break;
    out.push(buf.subarray(at, at + len));
    at += len;
  }
  return out;
}

let cached = null;
function codecAndSchemaBlock() {
  if (cached) return cached;
  const [schemaBlock] = fixtureBlocks();
  const codec = compileSchema(decodeBinarySchema(inflateRawSync(schemaBlock)));
  return (cached = { schemaBlock, codec });
}

/**
 * A child's sort key under its parent.
 *
 * Figma orders siblings by a string compared lexicographically. Fixed-width
 * base-94 over printable ASCII gives an order that matches the numeric one
 * without needing to know how Figma mints its own — a paste only has to be
 * internally consistent, it is not editing an existing sequence.
 */
const position = (i) => {
  const D = 94, A = 33;
  return String.fromCharCode(A + Math.floor(i / D) % D) + String.fromCharCode(A + (i % D));
};

/** Figma's 2x3, laid out as the schema names it. `deg` is the game's, clockwise. */
const xf = (x, y, deg = 0) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { m00: c, m01: -s, m02: x, m10: s, m11: c, m12: y };
};

const SOLID = (r, g, b) => ({
  type: "SOLID", color: { r, g, b, a: 1 }, opacity: 1, visible: true, blendMode: "NORMAL",
});

/**
 * Turn a level into clipboard HTML.
 *
 * Coordinates: world units x10, with the level's own frame (or its padded
 * bounds) becoming the artboard, exactly as `levels-to-svg.mjs` lays one out —
 * so the frame's origin is world (0,0) and what you paste is what the reader
 * will read back.
 */
export function figmaClipboardHtml(L, { at: canvasAt = [22000, 2000], pad = 4 } = {}) {
  const { schemaBlock, codec } = codecAndSchemaBlock();
  const b = L.frame ?? {
    x0: (L.bounds?.x0 ?? 0) - pad, y0: (L.bounds?.y0 ?? 0) - pad,
    x1: (L.bounds?.x1 ?? 0) + pad, y1: (L.bounds?.y1 ?? 0) + pad,
  };
  const X = (v) => (v - b.x0) * S, Y = (v) => (v - b.y0) * S;

  const SESSION = 900;
  let next = 1;
  const guid = () => ({ sessionID: SESSION, localID: next++ });
  const nodes = [];
  const CANVAS = { sessionID: 0, localID: 1 };

  // The Document and Page a real copy ships, so the tree is well formed.
  nodes.push({
    guid: { sessionID: 0, localID: 0 }, phase: "CREATED", type: "DOCUMENT",
    name: "Document", visible: true, opacity: 1, transform: xf(0, 0),
  });
  nodes.push({
    guid: CANVAS, phase: "CREATED",
    parentIndex: { guid: { sessionID: 0, localID: 0 }, position: "!" },
    type: "CANVAS", name: "Page 1", visible: true, opacity: 1, transform: xf(0, 0),
    backgroundOpacity: 1, backgroundEnabled: true,
  });

  const frameGuid = guid();
  nodes.push({
    guid: frameGuid, phase: "CREATED",
    parentIndex: { guid: CANVAS, position: "!" },
    type: "FRAME", name: `L: ${L.name}`, visible: true, opacity: 1,
    size: { x: (b.x1 - b.x0) * S, y: (b.y1 - b.y0) * S },
    transform: xf(canvasAt[0], canvasAt[1]),
    strokeWeight: 1, strokeAlign: "INSIDE", strokeJoin: "MITER",
    fillPaints: [SOLID(0.0824, 0.0392, 0.1647)],   // the app's #150a2a
    clipsContent: false,
  });

  let kid = 0;
  const child = () => ({ guid: frameGuid, position: position(kid++) });

  // Terrain: ONE LINE PER SEGMENT, which is what the contract asks for and what
  // `stitchTerrain` chains back on the way in.
  for (const poly of L.terrain || [])
    for (let i = 1; i < poly.length; i++) {
      const [x1, y1] = poly[i - 1], [x2, y2] = poly[i];
      const dx = X(x2) - X(x1), dy = Y(y2) - Y(y1);
      const len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      nodes.push({
        guid: guid(), phase: "CREATED", parentIndex: child(),
        type: "LINE", name: "t", visible: true, opacity: 1,
        size: { x: len, y: 0 },
        transform: { m00: dx / len, m01: -dy / len, m02: X(x1), m10: dy / len, m11: dx / len, m12: Y(y1) },
        strokeWeight: 15, strokeAlign: "CENTER", strokeCap: "ROUND", strokeJoin: "MITER",
        strokePaints: [SOLID(0.9529, 0.9137, 0.8392)],
      });
    }

  /** An instance of a kit component, anchored on its bbox CENTRE. */
  const toy = (kind, cx, cy, deg = 0) => {
    const [sess, local, w, h] = KIT[kind];
    // The transform maps local (0,0); the anchor is the centre, so back it out.
    const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const ox = c * (w / 2) - s * (h / 2), oy = s * (w / 2) + c * (h / 2);
    nodes.push({
      guid: guid(), phase: "CREATED", parentIndex: child(),
      type: "INSTANCE", name: kind, visible: true, opacity: 1,
      symbolData: { symbolID: { sessionID: sess, localID: local }, symbolOverrides: [], uniformScaleFactor: 1 },
      size: { x: w, y: h },
      transform: xf(X(cx) - ox, Y(cy) - oy, deg),
      strokeWeight: 1, strokeAlign: "INSIDE", strokeJoin: "MITER",
      frameMaskDisabled: true, derivedSymbolDataLayoutVersion: 3,
    });
  };

  if (L.start) toy("start", L.start[0], L.start[1]);
  if (L.goal) toy("goal", L.goal[0], L.goal[1]);
  for (const c of L.cans || []) toy("watering-can", c[0], c[1]);
  for (const m of L.bumpers || []) toy("bumper", m.x, m.y);
  // NOT negated, and this is the one place the contract misleads. The README's
  // `deg = -rotation` is about Figma's rotation PROPERTY, which counts
  // counter-clockwise; the raw transform does not. The reader takes the game's
  // deg straight off `atan2(m10, m00)`, so that is what goes back in. Negating
  // here produces a level that looks right and plays mirrored — which is
  // exactly what `test-kiwi.mjs` caught on the first run.
  for (const p of L.pops || []) toy("party-popper", p.x, p.y, p.deg);
  for (const cu of L.cushions || []) toy("cushion", cu.x + cu.w / 2, cu.y);

  const message = codec.encodeMessage({
    type: "NODE_CHANGES",
    sessionID: 0,
    ackID: 0,
    pasteID: 1808339941,
    pasteFileKey: FILE_KEY,
    pasteIsPartiallyOutsideEnclosingFrame: false,
    isCut: false,
    pasteEditorType: "DESIGN",
    pasteAssetType: "UNKNOWN",
    nodeChangeOrder: "GUID",
    publishedAssetGuids: [],
    clipboardSelectionRegions: [{
      parent: CANVAS, nodes: [frameGuid],
      pasteIsPartiallyOutsideEnclosingFrame: false, focusType: "NONE",
    }],
    blobs: [],
    nodeChanges: nodes,
  });

  // Both blocks raw deflate. A real copy zstd's the message, but the reader
  // picks by MAGIC rather than by position — ours does, and Figma's has to, or
  // it could not read its own older payloads.
  const blocks = [schemaBlock, deflateRawSync(Buffer.from(message))];
  const head = Buffer.alloc(12);
  head.write("fig-kiwi", 0, "latin1");
  head.writeUInt32LE(CONTAINER_VERSION, 8);
  const parts = [head];
  for (const blk of blocks) {
    const len = Buffer.alloc(4);
    len.writeUInt32LE(blk.length, 0);
    parts.push(len, Buffer.from(blk));
  }
  const b64 = Buffer.concat(parts).toString("base64");
  return {
    html: `<meta charset="utf-8"><span data-metadata="<!--(figmeta)e30=(/figmeta)-->"></span>` +
      `<span data-buffer="<!--(figma)${b64}(/figma)-->"></span>`,
    nodes: nodes.length,
    bytes: b64.length,
  };
}
