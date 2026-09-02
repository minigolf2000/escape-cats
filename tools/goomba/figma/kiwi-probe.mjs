// What is actually IN a Figma clipboard copy — the reference for kiwi.mjs.
//
//   node kiwi-probe.mjs
//
// Not a test. When a paste stops working, capture a fresh copy into fixtures/,
// run this, and diff its envelope, DOCUMENT/CANVAS roots, one LINE and one
// INSTANCE against what kiwi.mjs emits.
import { readFileSync } from "node:fs";
import { decodeBinarySchema, compileSchema } from "kiwi-schema";
import { decompress as unzstd } from "fzstd";
import { inflateRawSync } from "node:zlib";
const buf = Buffer.from(readFileSync("fixtures/real-figma-copy.b64", "utf8").trim(), "base64");
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let at = 12; const raw = [];
while (at + 4 <= buf.byteLength) { const len = dv.getUint32(at, true); at += 4; if (!len || at+len > buf.byteLength) break; raw.push(buf.subarray(at, at+len)); at += len; }
const de = (b) => (b[0]===0x28&&b[1]===0xb5 ? Buffer.from(unzstd(b)) : inflateRawSync(b));
const codec = compileSchema(decodeBinarySchema(de(raw[0])));
const msg = codec.decodeMessage(de(raw[1]));

const scal = {};
for (const [k, v] of Object.entries(msg)) if (typeof v !== "object" || v === null) scal[k] = v;
console.log("--- message envelope (scalars) ---");
console.log(JSON.stringify(scal, null, 1));
console.log("blobs:", Array.isArray(msg.blobs) ? msg.blobs.length + " entries, keys " + Object.keys(msg.blobs[0] || {}) : typeof msg.blobs);
console.log("nodeChangeOrder:", JSON.stringify(msg.nodeChangeOrder).slice(0, 160));
console.log("clipboardSelectionRegions:", JSON.stringify(msg.clipboardSelectionRegions).slice(0, 160));
console.log("publishedAssetGuids:", JSON.stringify(msg.publishedAssetGuids).slice(0, 120));
console.log("--- the level FRAME ---");
console.log(JSON.stringify(msg.nodeChanges.find((n) => /^L: /.test(n.name || "")), null, 1).slice(0, 1700));
const inst = msg.nodeChanges.find((n) => n.type === "INSTANCE");
const slim = { ...inst }; delete slim.derivedSymbolData; delete slim.symbolDescription;
console.log("--- an INSTANCE (minus derived/description) ---");
console.log(JSON.stringify(slim, null, 1));
console.log("--- DOCUMENT ---");
console.log(JSON.stringify(msg.nodeChanges.find((n) => n.type === "DOCUMENT"), null, 1).slice(0, 400));
console.log("--- CANVAS ---");
console.log(JSON.stringify(msg.nodeChanges.find((n) => n.type === "CANVAS"), null, 1).slice(0, 400));
