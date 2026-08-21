// Figma's NATIVE clipboard -> GoombaLevel. Plain Ctrl+C in Figma, Ctrl+V here.
//
// This is the good path, and the reason is that it reads the same numbers the
// Figma file holds rather than the ones its SVG exporter prints:
//
//   * layer names always survive (SVG only carries them when the `id` attribute
//     is switched on, and that flag is unreachable from Copy as SVG);
//   * a Line arrives as x 180, y 220, width 356.93 — its stored geometry — so
//     the half-stroke correction figma-svg.js has to make simply does not exist;
//   * an instance carries its own transform and size, so its centre is exact
//     and the `anchor` dots are not needed at all.
//
// HOW THE PAYLOAD IS SHAPED
// Ctrl+C puts HTML on the clipboard holding two comment-wrapped base64 blobs:
//   <span data-metadata="<!--(figmeta)…-->"></span>
//   <span data-buffer="<!--(figma)…-->"></span>
// The second decodes to a `fig-kiwi` container:
//   "fig-kiwi" magic (8 bytes) | uint32 version | then repeated:
//   uint32 byteLength | that many bytes of RAW DEFLATE
// Block 0 is a binary Kiwi SCHEMA, block 1 is the message. Because the schema
// travels with the data, `kiwi-schema` can decode the message generically —
// there is no hand-rolled varint or float reader in here, and no private
// schema to keep in step with Figma.
//
// It is still an undocumented format. Everything below fails loudly rather than
// guessing, and a pasted level is still only proposed until `verify.mjs --hash`
// has had it.
import { decodeBinarySchema, compileSchema } from "kiwi-schema";

const S = 10; // px per world unit
const ROUND = (v) => Math.round(v * 10) / 10; // tenths: the codec's precision

/** Does this clipboard HTML hold a Figma payload at all? */
export const hasFigmaBuffer = (html) =>
  typeof html === "string" && html.includes("data-buffer") && html.includes("(figma)");

/**
 * Pull the base64 payload out of the clipboard HTML.
 *
 * Do NOT regex this out of the raw markup. The attribute is HTML, so how its
 * `<!--` and `-->` survive depends on who serialised it, and a real Figma copy
 * showed up with a buffer this could not read even though the marker was right
 * there. So: let a parser decode the attribute, then slice between the two
 * `(figma)` sentinels rather than trying to match the wrapper, and accept
 * base64url as well as standard base64 — `-` and `_` never appear in standard
 * base64, so translating them is safe once the `--` of the comment wrapper is
 * already gone.
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

  const a = raw.indexOf("(figma)");
  const b = raw.lastIndexOf("(figma)");
  if (a < 0 || b <= a)
    throw new Error(
      `found the Figma buffer but not its (figma) markers — it began "${raw.slice(0, 40)}"`,
    );
  const inner = raw.slice(a + "(figma)".length, b);
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

async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Split the fig-kiwi container into its deflate blocks. */
async function blocks(buf) {
  const magic = String.fromCharCode(...buf.slice(0, 8));
  if (magic !== "fig-kiwi") throw new Error(`not a fig-kiwi payload (magic "${magic}")`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let at = 12; // 8 magic + uint32 version
  const out = [];
  while (at + 4 <= buf.byteLength) {
    const len = dv.getUint32(at, true);
    at += 4;
    if (!len || at + len > buf.byteLength) break;
    out.push(await inflateRaw(buf.subarray(at, at + len)));
    at += len;
  }
  if (out.length < 2) throw new Error("the Figma payload had no schema+message pair");
  return out;
}

const gid = (g) => (g ? `${g.sessionID}:${g.localID}` : null);

/**
 * Compose a node's parent-relative matrix chain into LEVEL coordinates.
 *
 * The copy root's own transform is deliberately dropped. When you copy a level
 * frame, that frame is in the payload carrying its position on the Figma canvas
 * — 20000, 400 for the frames this repo generated — and that is where the frame
 * sits in the file, not where anything sits in the level. Composing it made
 * every coordinate come out ~2000 units adrift.
 *
 * "Copy root" is the outermost ancestor whose own parent is not in the payload.
 * A loose selection with no frame around it has each node as its own root, so
 * the chain is length 1 and nothing is dropped.
 */
function absoluteMatrix(node, byGuid) {
  let m = [1, 0, 0, 0, 1, 0]; // a b tx / c d ty
  const chain = [];
  for (let n = node, guard = 0; n && guard < 64; guard++) {
    chain.push(n);
    const p = n.parentIndex && gid(n.parentIndex.guid);
    n = p ? byGuid.get(p) : null;
    if (n && /^(CANVAS|DOCUMENT)$/.test(n.type || "")) break;
  }
  if (chain.length > 1) {
    const outer = chain[chain.length - 1];
    const outerParent = outer.parentIndex && gid(outer.parentIndex.guid);
    if (!outerParent || !byGuid.has(outerParent)) chain.pop();
  }
  // Root-most first, so each step multiplies on the right.
  for (const n of chain.reverse()) {
    const t = n.transform;
    if (!t) continue;
    const b = [t.m00 ?? 1, t.m01 ?? 0, t.m02 ?? 0, t.m10 ?? 0, t.m11 ?? 1, t.m12 ?? 0];
    m = [
      m[0] * b[0] + m[1] * b[3], m[0] * b[1] + m[1] * b[4], m[0] * b[2] + m[1] * b[5] + m[2],
      m[3] * b[0] + m[4] * b[3], m[3] * b[1] + m[4] * b[4], m[3] * b[2] + m[4] * b[5] + m[5],
    ];
  }
  return m;
}
const apply = (m, x, y) => ({ x: m[0] * x + m[1] * y + m[2], y: m[3] * x + m[4] * y + m[5] });
const degOf = (m) => (Math.atan2(m[3], m[0]) * 180) / Math.PI;

const stripDup = (s) => String(s || "").replace(/_\d+$/, "").trim();
const KINDS = /^(watering-can|party-popper|start|goal|bumper|cushion|band|can|pop|t)\s*-?\s*(\d+)?$/i;
function classify(name) {
  const n = stripDup(name);
  if (!n || n.startsWith("_") || n.startsWith("//")) return null;
  const m = KINDS.exec(n);
  if (!m) return null;
  let kind = m[1].toLowerCase();
  if (kind === "watering-can") kind = "can";
  if (kind === "party-popper") kind = "pop";
  return { kind, num: m[2] ? Number(m[2]) : null };
}
function levelName(name) {
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
  // The one thing the offline test cannot cover is whether Figma still calls
  // these fields what this reader expects. If it does not, say exactly what
  // arrived instead — that turns a single paste into the whole bug report,
  // rather than a level that reads as mysteriously empty.
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
  // A matrix whose components are not called m00… would compose as identity and
  // pile every prop onto the origin — a wrong level rather than an error. Refuse
  // instead, and name what the matrix actually holds.
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
  const terrain = [], bands = [], cans = [], bumpers = [], cushions = [], pops = [];
  let start = null, goal = null, name = null, maxSpeed = null;

  for (const n of changes) {
    const asLevel = levelName(n.name);
    if (asLevel && !name) {
      // "L: My Level @145" raises the speed cap, the one level field Figma has
      // nowhere else to put.
      const at = /\s*@\s*(\d+)\s*$/.exec(asLevel);
      name = at ? asLevel.slice(0, at.index).trim() : asLevel;
      if (at) maxSpeed = Number(at[1]);
    }
  }

  // Sort by sibling position so `band` order matches the four player colours.
  const ordered = [...changes].sort((a, b) => {
    const pa = a.parentIndex?.position ?? "", pb = b.parentIndex?.position ?? "";
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });

  for (const n of ordered) {
    const hit = classify(n.name);
    if (!hit) continue;
    const { kind, num } = hit;
    const m = absoluteMatrix(n, byGuid);
    const w = n.size?.x ?? 0, h = n.size?.y ?? 0;
    const W = (v) => ROUND(v / S);

    if (kind === "t" || kind === "band") {
      // A Figma line is a zero-height node: local (0,0)-(width,0) IS the
      // segment, so its stored geometry needs no correction of any kind.
      const a = apply(m, 0, 0), b = apply(m, w, 0);
      (kind === "t" ? terrain : bands).push([[W(a.x), W(a.y)], [W(b.x), W(b.y)]]);
      continue;
    }
    const c = apply(m, w / 2, h / 2); // instance centre
    if (kind === "start") start = [W(c.x), W(c.y)];
    else if (kind === "goal") goal = [W(c.x), W(c.y)];
    else if (kind === "can") cans.push([W(c.x), W(c.y)]);
    else if (kind === "bumper") bumpers.push({ x: W(c.x), y: W(c.y) });
    else if (kind === "pop") pops.push({ x: W(c.x), y: W(c.y), deg: ROUND(degOf(m)), spd: num ?? 76 });
    else if (kind === "cushion") {
      const left = apply(m, 0, h / 2);
      cushions.push({ x: W(left.x), y: W(left.y), w: ROUND(w / S) });
    }
  }

  const found = terrain.length + bands.length + cans.length + bumpers.length +
    cushions.length + pops.length + (start ? 1 : 0) + (goal ? 1 : 0);
  if (!found)
    throw new Error(
      "read the Figma clipboard, but nothing in it is named for a level. " +
      "Terrain must be Lines named `t`; toys are instances of the kit.",
    );
  if (!start) throw new Error("no layer named `start` — the level has no spawn");
  if (!goal) throw new Error("no layer named `goal` — the level has no cake");
  if (!terrain.length) warnings.push("no terrain: nothing named `t`. She will just fall.");

  const level = {
    name: name || "pasted from Figma",
    budget: 4,
    start, goal, terrain, cans, cushions, pops, bumpers,
    solution: bands,
  };
  if (maxSpeed) level.maxSpeed = maxSpeed;
  return { level, warnings };
}
