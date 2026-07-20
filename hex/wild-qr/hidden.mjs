// hidden.mjs — the smuggler's extraction tool (piece 7).
//
// A phone/jsQR shows only the URL. This CLI runs the engine's HONEST read path
// on a rendered symbol — readFormat -> unmask -> de-interleave -> Reed-Solomon
// correct per block — then dumps BOTH the URL segment AND the raw pad region.
// Standard QR padding after the terminator is the alternating 0xEC 0x11 byte
// pattern; anything else there is a deliberate payload. Piece 7 hides ASCII in
// exactly that spot, so a raw-bitstream reader finds a second message woven
// through the picture that no scanner ever surfaces.
//
//   node hidden.mjs <png>            # scale-8 PNG (quiet 4), any v1-10 symbol
//
// Dependency-light: pngjs (via png.mjs) + engine.mjs only. No jsQR needed —
// we re-read the module matrix straight from the pixels.
import { QRArt } from "./engine.mjs";
import { readPNG } from "./png.mjs";

// --- recover the module matrix from a rendered PNG --------------------------
// The harness renders at scale S with a `quiet`-module light border, so module
// (r,c) is a solid S×S block whose center pixel we sample. Version/scale are
// inferred from the image dimension for the common quiet=4 render.
export function matrixFromPNG(path, opts = {}) {
  const { data, width, height } = readPNG(path);
  const quiet = opts.quiet ?? 4;
  let scale = opts.scale, version = opts.version;
  if (!scale || !version) {
    // width = (size + 2*quiet) * scale, size = 17 + 4*version. Try scales that
    // divide the dimension and yield an integer version in 1..10.
    for (const s of [8, 16, 4, 12, 24, 3, 6, 10, 2, 1]) {
      if (width % s !== 0) continue;
      const size = width / s - 2 * quiet;
      const v = (size - 17) / 4;
      if (Number.isInteger(v) && v >= 1 && v <= 10) { scale = s; version = v; break; }
    }
  }
  if (!scale || !version) throw new Error(`cannot infer version/scale from ${width}×${height} PNG`);
  const size = QRArt.sizeOf(version);
  const m = new Uint8Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const x = Math.floor((c + quiet) * scale + scale / 2);
      const y = Math.floor((r + quiet) * scale + scale / 2);
      const o = (y * width + x) * 4;
      const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      m[r * size + c] = lum < 128 ? 1 : 0;
    }
  }
  return { matrix: m, version, size, scale, quiet };
}

// --- the honest decode: matrix -> RS-corrected sequential data stream -------
// Mirrors QRArt.validate()'s pipeline but returns the fully corrected byte
// stream (validate parses segments and discards it). Throws if a block is
// unrecoverable.
export function readStream(matrix, version) {
  const size = QRArt.sizeOf(version);
  const fmt = QRArt.readFormat(matrix, size);
  if (!fmt) throw new Error("format info unreadable");
  const lay = QRArt.layout(version, fmt.level);
  const maskFn = QRArt.MASKS[fmt.mask];
  // unmask into interleaved codewords
  const cw = new Uint8Array(lay.totalCw);
  for (let bit = 0; bit < lay.totalCw * 8; bit++) {
    const mi = lay.bitToModule[bit];
    if (mi < 0) continue;
    const r = (mi / size) | 0, c = mi % size;
    let v = matrix[mi];
    if (maskFn(r, c)) v ^= 1;
    if (v) cw[bit >> 3] |= 0x80 >> (bit & 7);
  }
  // de-interleave into per-block codewords
  const blockCw = lay.blocks.map((b) => new Uint8Array(b.total));
  lay.inter.forEach((c, ci) => {
    blockCw[c.block][c.isEC ? lay.blocks[c.block].dataLen + c.index : c.index] = cw[ci];
  });
  // RS-correct each block
  const perBlock = [];
  for (let b = 0; b < lay.blocks.length; b++) {
    const res = QRArt.rsCorrect(blockCw[b], lay.blocks[b].ecLen);
    if (!res) throw new Error(`block ${b} unrecoverable`);
    perBlock.push({ errors: res.errors, capacity: lay.blocks[b].ecLen >> 1 });
  }
  // concatenate data codewords -> sequential stream
  const stream = new Uint8Array(lay.totalData);
  let off = 0;
  for (let b = 0; b < lay.blocks.length; b++) {
    stream.set(blockCw[b].slice(0, lay.blocks[b].dataLen), off);
    off += lay.blocks[b].dataLen;
  }
  return { stream, lay, fmt, perBlock, version };
}

// --- parse a byte-mode payload: URL segment + pad region --------------------
export function parsePayload(stream, version) {
  let bp = 0;
  const readBits = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) { v = (v << 1) | ((stream[bp >> 3] >> (7 - (bp & 7))) & 1); bp++; }
    return v;
  };
  const countBits = version < 10 ? 8 : 16;
  const mode = readBits(4);
  if (mode !== 4) throw new Error(`expected byte mode (4), got ${mode}`);
  const n = readBits(countBits);
  const urlBytes = [];
  for (let i = 0; i < n; i++) urlBytes.push(readBits(8));
  const url = Buffer.from(urlBytes).toString("utf8");
  // terminator (4 bits) then pad to byte boundary
  const padStart = Math.ceil((4 + countBits + n * 8 + 4) / 8);
  const pad = stream.slice(padStart);
  return { url, padStart, pad };
}

function dotted(bytes) {
  let s = "";
  for (const b of bytes) s += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
  return s;
}

// --- CLI --------------------------------------------------------------------
function main() {
  const file = process.argv[2];
  if (!file) { console.error("usage: node hidden.mjs <png>"); process.exit(2); }
  const { matrix, version } = matrixFromPNG(file);
  const { stream, perBlock } = readStream(matrix, version);
  const { url, padStart, pad } = parsePayload(stream, version);

  const meter = perBlock.map((b, i) => `blk${i}: ${b.errors}/${b.capacity} used (${b.capacity - b.errors} headroom)`).join("  |  ");

  console.log(`file            : ${file}  (v${version})`);
  console.log(`RS meter        : ${meter}`);
  console.log("");
  console.log(`URL segment     : ${url}`);
  console.log("");
  console.log(`pad region      : ${pad.length} bytes, sequential data stream offset ${padStart}`);
  console.log(`pad (ASCII)     : ${dotted(pad)}`);
  console.log(`pad (hex head)  : ${[...pad.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join(" ")} ...`);
  console.log("");
  // Standard QR padding after the terminator is the alternating 0xEC 0x11
  // filler. Readable ASCII there is the smuggled easter egg.
  const isStd = pad.every((b, i) => b === (i % 2 === 0 ? 0xec : 0x11));
  if (isStd) {
    console.log("padding is the standard alternating 0xEC 0x11 filler — nothing hidden.");
    return;
  }
  console.log("padding is NOT the standard 0xEC 0x11 filler — a message is smuggled here.");
  // The smuggled text is the leading printable-ASCII run at the pad boundary;
  // the art-solved pad bytes that follow are (mostly non-printable) noise.
  let run = 0;
  while (run < pad.length && pad[run] >= 0x20 && pad[run] <= 0x7e) run++;
  console.log(`>>> smuggled ASCII @ stream offset ${padStart}: ${Buffer.from(pad.slice(0, run)).toString("ascii")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
