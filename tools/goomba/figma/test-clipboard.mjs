#!/usr/bin/env node
// Proof for the native-clipboard reader: build a fig-kiwi payload the same way
// Figma builds one, hand it to apps/goomba-glider/src/figma/clipboard.js, and
// check the level that comes out against the numbers that went in.
//
//   node test-clipboard.mjs
//
// Why this exists rather than a captured real payload: a Figma copy only lands
// on the clipboard from a genuine user gesture, so no automation here can
// produce one. What this DOES cover is everything after the clipboard — the
// base64, the fig-kiwi container framing, raw-deflate blocks, the travelling
// Kiwi schema, matrix composition, rotation recovery, the name contract and the
// world-unit conversion. What it CANNOT cover is whether Figma's real field
// names match the ones assumed here (`nodeChanges`, `guid`, `parentIndex`,
// `transform.m00…`, `size.x`). One real paste settles that, and the reader is
// written to fail loudly rather than silently mis-read if they ever differ.
import { deflateRawSync } from "node:zlib";
import { parseSchema, encodeBinarySchema, compileSchema } from "kiwi-schema";
import { levelFromFigmaClipboard } from "../../../apps/goomba-glider/src/figma/clipboard.js";

// Figma's schema is far larger than this; these are exactly the fields the game
// needs, in the shapes Figma uses for them.
const SCHEMA_TEXT = `
struct GUID { uint sessionID; uint localID; }
struct Vector { float x; float y; }
struct Matrix { float m00; float m01; float m02; float m10; float m11; float m12; }
struct ParentIndex { GUID guid; string position; }
message NodeChange {
  GUID guid = 1;
  ParentIndex parentIndex = 2;
  string name = 3;
  string type = 4;
  Matrix transform = 5;
  Vector size = 6;
}
message Message {
  NodeChange[] nodeChanges = 1;
}
`;

const schema = parseSchema(SCHEMA_TEXT);
const codec = compileSchema(schema);

const FRAME = { sessionID: 1, localID: 1 };
let next = 2;
const nodes = [];
/** A node parented to the copied frame, at 10 px per world unit. */
function node(name, type, x, y, w, h, degrees = 0, pos = "!") {
  const a = (degrees * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  nodes.push({
    guid: { sessionID: 1, localID: next++ },
    parentIndex: { guid: FRAME, position: pos },
    name, type,
    // Rotation about the node's own centre, which is how the frames were built.
    transform: {
      m00: co, m01: -si, m02: x - (co * w / 2 - si * h / 2),
      m10: si, m11: co, m12: y - (si * w / 2 + co * h / 2),
    },
    size: { x: w, y: h },
  });
}
/** A Line: zero height, local (0,0)-(width,0) is the segment itself. */
function line(name, x1, y1, x2, y2, pos) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const a = Math.atan2(y2 - y1, x2 - x1);
  nodes.push({
    guid: { sessionID: 1, localID: next++ },
    parentIndex: { guid: FRAME, position: pos },
    name, type: "LINE",
    transform: { m00: Math.cos(a), m01: -Math.sin(a), m02: x1, m10: Math.sin(a), m11: Math.cos(a), m12: y1 },
    size: { x: len, y: 0 },
  });
}

nodes.push({
  guid: FRAME,
  parentIndex: { guid: { sessionID: 0, localID: 0 }, position: "!" },
  name: "L: Clipboard Test @145",
  type: "FRAME",
  transform: { m00: 1, m01: 0, m02: 20000, m10: 0, m11: 1, m12: 400 },
  size: { x: 800, y: 600 },
});

// The same layout the SVG fixture uses, so the two readers are comparable.
line("t", 100, 100, 400, 160, "a");
line("t", 400, 160, 700, 140, "b");
line("band", 150, 300, 500, 320, "c"); // a leftover from the old answer-key layer — must be ignored
node("start", "INSTANCE", 120, 80, 110, 110, 0, "d");
node("goal", "INSTANCE", 650, 500, 200, 210, 0, "e");
node("watering-can", "INSTANCE", 300, 250, 180, 140, 0, "f");
node("bumper", "INSTANCE", 500, 400, 180, 180, 0, "g");
node("party-popper 137", "INSTANCE", 200, 450, 140, 140, -37, "h");
node("cushion", "INSTANCE", 350 + 100, 520, 200, 56, 0, "i"); // x is its CENTRE
node("_gauge", "INSTANCE", 10, 10, 20, 20, 0, "j"); // must be ignored

const message = codec.encodeMessage({ nodeChanges: nodes });
const schemaBin = encodeBinarySchema(schema);

// The container: "fig-kiwi", version, then length-prefixed raw-deflate blocks.
const block = (bytes) => {
  const z = deflateRawSync(Buffer.from(bytes));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(z.length, 0);
  return Buffer.concat([len, z]);
};
const version = Buffer.alloc(4);
version.writeUInt32LE(1, 0);
const container = Buffer.concat([
  Buffer.from("fig-kiwi", "ascii"), version, block(schemaBin), block(message),
]);
// Shaped like a real copy: the metadata and buffer comments CLOSE with
// `(/figmeta)` / `(/figma)`, which is what a live paste turned out to carry.
const html =
  `<meta charset="utf-8"><span data-metadata="<!--(figmeta)eyJmaWxlS2V5IjoidGVzdCJ9(/figmeta)-->"></span>` +
  `<span data-buffer="<!--(figma)${container.toString("base64")}(/figma)-->"></span>`;

// Also drop the payload where the browser can fetch it, so the same bytes can
// be run through the shipped bundle (DecompressionStream, atob, kiwi) rather
// than only through node.
const { writeFileSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");
// A synthetic-but-valid Figma copy, kept beside the fixtures so the paste path
// can be exercised without Figma open. (It used to be written into the editor
// app's public/ dir; that app is gone — the game's level selector is the paste
// target now.)
const outDir = fileURLToPath(new URL("./fixtures/", import.meta.url));
writeFileSync(outDir + "sample-figma-clipboard.html", html);

const { level, warnings } = await levelFromFigmaClipboard(html);

const TRUTH = {
  name: "L: Clipboard Test",
  maxSpeed: 145,
  // Two Figma Lines sharing (40,16): `stitchTerrain` chains them into one
  // polyline, so the game strokes a lineJoin there rather than two round caps
  // overhanging the shared vertex. Same surface either way — `segsFor` splits
  // polylines back into segments before collision.
  terrain: [[[10, 10], [40, 16], [70, 14]]],
  // No `solution`: the frame's `band` layer is consumed and dropped, so a level
  // arrives as geometry only. `undefined` is the assertion — a level that came
  // back with a baked answer key would fail here.
  solution: undefined,
  start: [12, 8],
  goal: [65, 50],
  cans: [[30, 25]],
  bumpers: [{ x: 50, y: 40 }],
  pops: [{ x: 20, y: 45, deg: -37, spd: 137 }],
  cushions: [{ x: 35, y: 52, w: 20 }],
};
// The frame name carries "@145"; the level name drops the suffix and the L:.
TRUTH.name = "Clipboard Test";

let bad = 0;
const check = (key, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${key}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
};
console.log("native Figma clipboard -> GoombaLevel");
for (const k of Object.keys(TRUTH)) check(k, level[k], TRUTH[k]);
check("no stray props (_gauge ignored)", level.cans.length + level.bumpers.length + level.pops.length, 3);
check("the `band` layer is warned about, not read", warnings.filter((w) => w.includes("`band`")).length, 1);
if (warnings.length) console.log("  warnings:", warnings.join(" · "));
// --- the wrapper, every way it might survive ------------------------------
// A real Figma copy reached the page with the (figma) marker present but the
// buffer unreadable, so how that attribute is escaped is not something to
// assume. Each of these must produce exactly the level the plain form did.
const b64 = container.toString("base64");
const wrap = (inner, quote = '"') => `<span data-buffer=${quote}${inner}${quote}></span>`;
const VARIANTS = {
  "real shape, (/figma) close": wrap(`<!--(figma)${b64}(/figma)-->`),
  "legacy (figma) close": wrap(`<!--(figma)${b64}(figma)-->`),
  "no closing sentinel at all": wrap(`<!--(figma)${b64}-->`),
  "entity-escaped &lt;!--": wrap(`&lt;!--(figma)${b64}(/figma)--&gt;`),
  "single-quoted attribute": wrap(`<!--(figma)${b64}(/figma)-->`, "'"),
  "newlines inside the base64": wrap(
    `<!--(figma)\n${b64.replace(/(.{60})/g, "$1\n")}\n(figma)-->`),
  "base64url (- and _)": wrap(
    `<!--(figma)${b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}(/figma)-->`),
  "Windows HTML Format wrapper":
    "Version:0.9\r\nStartHTML:00000097\r\n<html><body><!--StartFragment-->" +
    wrap(`<!--(figma)${b64}(/figma)-->`) + "<!--EndFragment--></body></html>",
};
console.log("\nclipboard wrapper variants");
for (const [label, markup] of Object.entries(VARIANTS)) {
  try {
    const r = await levelFromFigmaClipboard(markup);
    const same = JSON.stringify(r.level) === JSON.stringify(level);
    if (!same) bad++;
    console.log(`  ${same ? "ok  " : "FAIL"} ${label}${same ? "" : " — decoded to a DIFFERENT level"}`);
  } catch (err) {
    bad++;
    console.log(`  FAIL ${label} — ${err.message}`);
  }
}

console.log(bad ? `\n→ FAIL ✗ (${bad} check(s))` : "\n→ PASS ✓");
process.exit(bad ? 1 : 0);
