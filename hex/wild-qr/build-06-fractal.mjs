// build-06-fractal.mjs — Piece 6 of the QR-art project: the fractal code.
//
// From across the room it reads as ONE v6-L QR pointing at the repo. Up close,
// every dark parent module is itself a tiny scannable v1-L QR carrying a
// fragment of a serial micro-story about Hex and Goomba escaping a room.
//
// Two reading distances, hundreds of payloads:
//   - Parent: STANDARD encode (no art solve — the fractal texture IS the art;
//     we want maximum decode margin), best-ISO-penalty mask.
//   - Tiles: every dark parent module -> an INVERTED v1-L QR (light-on-dark).
//     Inversion (swap dark/light at render time) keeps each cell dark-dominant,
//     which preserves the parent's contrast at a distance. The tile's own quiet
//     zone is rendered in the DARK background colour (an inverted code's quiet
//     zone is dark). Light parent modules render as plain white.
//
// jsQR reads inverted codes with inversionAttempts:"attemptBoth"; phone cameras
// handle inversion too.
//
// Reproducible: pure standard encodes, no RNG. Run `node build-06-fractal.mjs`.
// Outputs to ./out/: fractal.png, fractal-preview.png, fractal-detail.png,
// fractal-story.txt, fractal-report.md.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jsQR from "jsqr";
import { QRArt } from "./engine.mjs";
import { writePNG } from "./png.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const URL = "https://github.com/minigolf2000/cat-games";
const P_VERSION = 6, P_LEVEL = "L";     // parent
const T_VERSION = 1, T_LEVEL = "L";     // tiles
const PS = QRArt.sizeOf(P_VERSION);     // 41
const TS = QRArt.sizeOf(T_VERSION);     // 21

// --- Tile geometry (px) — the numbers tuned so both acceptance tests pass. ---
const MM = 2;                 // micro-module size (>=2 required)
const SYM = TS * MM;          // v1 symbol side = 42px
const MARGIN = 6;             // dark quiet-zone/padding ring each side (= 3 micro-modules)
const CELL = SYM + 2 * MARGIN; // parent-module cell side = 54px
const QZ_MODULES = 4;         // parent quiet zone, in parent modules (white)
const QZ = QZ_MODULES * CELL; // parent quiet zone in px

const DARK = [0, 0, 0];
const LIGHT = [255, 255, 255];

// ---------------------------------------------------------------------------
// 1. The micro-story — a loopable ~40-fragment serial about Hex & Goomba.
//    Each fragment <= 17 bytes (v1-L byte-mode capacity) INCLUDING its serial.
//    Tile #000 (first dark module, raster order) is the key: "START HERE. MEOW."
//    The rest carry a compact "#NN " serial so scanning a few feels collectible.
// ---------------------------------------------------------------------------
const STORY = [
  "START HERE. MEOW.", // #000 — the key
  "#01 CATS AWAKE.",
  "#02 DOOR IS SHUT",
  "#03 HEX SMELLS IT",
  "#04 A RED DOT!",
  "#05 GOOMBA LEAPS",
  "#06 MISS. THUD.",
  "#07 A KEY GLINTS",
  "#08 ON THE SHELF",
  "#09 TOO HIGH UP",
  "#10 HEX CLIMBS",
  "#11 KNOCKS A JAR",
  "#12 CRASH! TREATS",
  "#13 SNACK BREAK",
  "#14 FOCUS, CATS!",
  "#15 KEY IN PAW",
  "#16 WRONG LOCK",
  "#17 HISS. TRY TWO",
  "#18 CLICK! OPEN?",
  "#19 A NEW ROOM",
  "#20 MORE RED DOTS",
  "#21 A TRAP! RUN",
  "#22 GOOMBA HIDES",
  "#23 IN A BOX.",
  "#24 HEX WAITS",
  "#25 PAW UNDER MAT",
  "#26 A MAP! CLUES",
  "#27 FOLLOW STRING",
  "#28 IT MOVES!",
  "#29 CHASE! CHASE!",
  "#30 TANGLED UP",
  "#31 PURR. REST.",
  "#32 LAST DOOR",
  "#33 NEEDS 2 PAWS",
  "#34 PUSH TOGETHER",
  "#35 CREEEAK...",
  "#36 SUNLIGHT!",
  "#37 FREE CATS!",
  "#38 THEY ESCAPE",
  "#39 LOOP: MEOW",
];
// Hard byte-limit guard (v1-L holds 17 bytes).
for (const f of STORY) {
  const n = Buffer.byteLength(f, "utf8");
  if (n > 17) throw new Error(`fragment over 17 bytes (${n}): ${JSON.stringify(f)}`);
}

// ---------------------------------------------------------------------------
// 2. Encode parent + per-fragment tile matrices (cached by fragment).
// ---------------------------------------------------------------------------
const parent = QRArt.encodeStandard(URL, { version: P_VERSION, level: P_LEVEL });
const P = parent.matrix; // 1 = dark, 0 = light

const tileCache = new Map();
function tileMatrix(fragment) {
  let m = tileCache.get(fragment);
  if (!m) {
    m = QRArt.encodeStandard(fragment, { version: T_VERSION, level: T_LEVEL }).matrix;
    tileCache.set(fragment, m);
  }
  return m;
}

// Assign a fragment to each dark parent module, in raster order (cycling).
const darkModules = []; // {r, c, idx, fragment}
{
  let counter = 0;
  for (let r = 0; r < PS; r++)
    for (let c = 0; c < PS; c++)
      if (P[r * PS + c] === 1) {
        const fragment = STORY[counter % STORY.length];
        darkModules.push({ r, c, idx: counter, fragment });
        counter++;
      }
}

// ---------------------------------------------------------------------------
// 3. Rasterise the full fractal.
//    - white parent quiet zone border (QZ px)
//    - light parent module  -> solid white cell
//    - dark  parent module  -> dark cell with a centred INVERTED v1 symbol
//      (micro dark module -> LIGHT pixel; micro light module -> DARK pixel)
// ---------------------------------------------------------------------------
const CORE = PS * CELL;
const W = CORE + 2 * QZ;
const H = W;
const data = new Uint8ClampedArray(W * H * 4);

// fill everything white (covers quiet zone + light cells)
for (let i = 0; i < W * H; i++) {
  data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
}
function px(x, y, col) {
  const o = (y * W + x) * 4;
  data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255;
}
function fillRect(x0, y0, w, h, col) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(x, y, col);
}

// Render one dark cell at parent (r,c): dark background + centred inverted v1.
function renderTile(r, c, fragment) {
  const cellX = QZ + c * CELL, cellY = QZ + r * CELL;
  fillRect(cellX, cellY, CELL, CELL, DARK); // dark ground = inverted quiet zone
  const m = tileMatrix(fragment);
  const symX = cellX + MARGIN, symY = cellY + MARGIN;
  for (let mr = 0; mr < TS; mr++)
    for (let mc = 0; mc < TS; mc++) {
      // INVERSION: dark micro module -> light pixel, light -> dark pixel.
      const col = m[mr * TS + mc] === 1 ? LIGHT : DARK;
      fillRect(symX + mc * MM, symY + mr * MM, MM, MM, col);
    }
}
for (const d of darkModules) renderTile(d.r, d.c, d.fragment);

const full = { data, width: W, height: H };
writePNG(path.join(OUT, "fractal.png"), full);

// ---------------------------------------------------------------------------
// 4. Box-filter downsample to an arbitrary target size (area averaging).
// ---------------------------------------------------------------------------
function boxDownsample(src, target) {
  const { data: s, width: sw, height: sh } = src;
  const tw = target, th = target;
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy0 = Math.floor((y * sh) / th), sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * sh) / th));
    for (let x = 0; x < tw; x++) {
      const sx0 = Math.floor((x * sw) / tw), sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * sw) / tw));
      let rr = 0, gg = 0, bb = 0, n = 0;
      for (let yy = sy0; yy < sy1; yy++)
        for (let xx = sx0; xx < sx1; xx++) {
          const o = (yy * sw + xx) * 4;
          rr += s[o]; gg += s[o + 1]; bb += s[o + 2]; n++;
        }
      const o = (y * tw + x) * 4;
      out[o] = rr / n; out[o + 1] = gg / n; out[o + 2] = bb / n; out[o + 3] = 255;
    }
  }
  return { data: out, width: tw, height: th };
}

function scan(img, opts) {
  const buf = img.data instanceof Uint8ClampedArray ? img.data : new Uint8ClampedArray(img.data);
  const res = jsQR(buf, img.width, img.height, opts);
  return res ? res.data : null;
}

// Distance test: downsample the full raster to 410px and 205px, decode parent.
const preview = boxDownsample(full, 410);
const tiny = boxDownsample(full, 205);
writePNG(path.join(OUT, "fractal-preview.png"), preview);
const decode410 = scan(preview);
const decode205 = scan(tiny);

// ---------------------------------------------------------------------------
// 5. Close test: crop sampled tiles at full resolution + decode attemptBoth.
//    Crop the cell and pad with the tile's own DARK quiet colour so jsQR sees a
//    clean quiet zone (the inverted tile's quiet zone is dark, so padding with
//    dark is consistent with an isolated-tile scan).
// ---------------------------------------------------------------------------
function cropTile(r, c, padModules = 4) {
  const pad = padModules * MM;
  const cellX = QZ + c * CELL, cellY = QZ + r * CELL;
  const cw = CELL + 2 * pad, ch = CELL + 2 * pad;
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const sx = cellX - pad + x, sy = cellY - pad + y;
      const o = (y * cw + x) * 4;
      let col = DARK; // default: extend the dark quiet zone
      if (sx >= 0 && sy >= 0 && sx < W && sy < H) {
        const so = (sy * W + sx) * 4;
        col = [data[so], data[so + 1], data[so + 2]];
      }
      out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = 255;
    }
  return { data: out, width: cw, height: ch };
}

function decodeTile(d) {
  const img = cropTile(d.r, d.c);
  const got = scan(img, { inversionAttempts: "attemptBoth" });
  return { ...d, got, ok: got === d.fragment };
}

// Deterministic "random" sample of >=24 tiles (fixed stride) + 4 extreme corners.
const sampleIdx = [];
{
  const N = darkModules.length;
  const want = 28;
  const stride = Math.max(1, Math.floor(N / want));
  for (let i = 0; i < N && sampleIdx.length < want; i += stride) sampleIdx.push(i);
}
// 4 extreme corner tiles: dark module nearest each raster corner (Chebyshev).
const corners = [
  { name: "TL", tr: 0, tc: 0 },
  { name: "TR", tr: 0, tc: PS - 1 },
  { name: "BL", tr: PS - 1, tc: 0 },
  { name: "BR", tr: PS - 1, tc: PS - 1 },
];
const cornerTiles = corners.map((cn) => {
  let best = null;
  for (const d of darkModules) {
    const dist = Math.max(Math.abs(d.r - cn.tr), Math.abs(d.c - cn.tc));
    if (!best || dist < best.dist) best = { d, dist };
  }
  return { name: cn.name, ...best };
});

const sampled = sampleIdx.map((i) => decodeTile(darkModules[i]));
const cornerResults = cornerTiles.map((ct) => ({ name: ct.name, ...decodeTile(ct.d) }));

// ---------------------------------------------------------------------------
// 6. Contrast report: mean luminance of dark cells vs light cells.
//    Luminance = Rec.601 (0.299R + 0.587G + 0.114B), normalised to white=1.0.
// ---------------------------------------------------------------------------
function cellMeanLum(r, c) {
  const cellX = QZ + c * CELL, cellY = QZ + r * CELL;
  let sum = 0, n = 0;
  for (let y = cellY; y < cellY + CELL; y++)
    for (let x = cellX; x < cellX + CELL; x++) {
      const o = (y * W + x) * 4;
      sum += 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      n++;
    }
  return sum / n / 255;
}
let darkSum = 0, darkN = 0, darkMax = -Infinity;
for (const d of darkModules) {
  const l = cellMeanLum(d.r, d.c);
  darkSum += l; darkN++; if (l > darkMax) darkMax = l;
}
const darkMeanLum = darkSum / darkN;
// light cells are pure white by construction
const lightMeanLum = 1.0;

// ---------------------------------------------------------------------------
// 7. Detail crop: a 4x4 parent-module region showing tiles (upscaled 6x, NN).
// ---------------------------------------------------------------------------
function detailCrop(r0, c0, n, upscale) {
  const cx = QZ + c0 * CELL, cy = QZ + r0 * CELL, side = n * CELL;
  const ow = side * upscale, oh = side * upscale;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      const sx = cx + Math.floor(x / upscale), sy = cy + Math.floor(y / upscale);
      const so = (sy * W + sx) * 4, o = (y * ow + x) * 4;
      out[o] = data[so]; out[o + 1] = data[so + 1]; out[o + 2] = data[so + 2]; out[o + 3] = 255;
    }
  return { data: out, width: ow, height: oh };
}
// Pick a 4x4 region rich in dark tiles near the TL finder's lower edge.
const detail = detailCrop(8, 0, 4, 6);
writePNG(path.join(OUT, "fractal-detail.png"), detail);

// ---------------------------------------------------------------------------
// 8. Story file
// ---------------------------------------------------------------------------
const storyTxt =
  "Piece 6 — the fractal code — micro-story (loopable, one fragment per dark tile, raster order)\n" +
  "Tile #000 = the key.\n\n" +
  STORY.map((f, i) => `${String(i).padStart(3, "0")}  ${f}  (${Buffer.byteLength(f)}b)`).join("\n") +
  "\n";
fs.writeFileSync(path.join(OUT, "fractal-story.txt"), storyTxt);

// ---------------------------------------------------------------------------
// 9. Report + console summary
// ---------------------------------------------------------------------------
const sampledPass = sampled.filter((s) => s.ok).length;
const cornerPass = cornerResults.filter((s) => s.ok).length;
const allTilePass = sampledPass === sampled.length && cornerPass === cornerResults.length;
const distancePass = decode410 === URL && decode205 === URL;
const contrastPass = darkMeanLum < 0.45;

const report = `# Piece 6 — fractal code (a QR made of QRs) — build report

Generated by \`build-06-fractal.mjs\` (reproducible; standard encodes only, no RNG).

## Structure
- Parent: v${P_VERSION}-${P_LEVEL} (${PS}x${PS}), STANDARD encode, mask ${parent.mask} (lowest ISO penalty).
  Payload: \`${URL}\`
- Dark parent modules: ${darkModules.length} (each rendered as an inverted v${T_VERSION}-${T_LEVEL} tile).
- Unique fragment tiles encoded: ${tileCache.size} (story cycles every ${STORY.length}).

## Final geometry
- Micro-module: ${MM}px  |  v1 symbol: ${SYM}px (${TS} modules)
- Dark padding/quiet ring: ${MARGIN}px each side (${MARGIN / MM} micro-modules)
- Parent-module cell: ${CELL}x${CELL}px  |  parent quiet zone: ${QZ_MODULES} modules (${QZ}px)
- Full raster: ${W}x${H}px  |  preview: 410px  |  tiny: 205px
- Tile crop for close test: cell + 4-module dark quiet-zone pad.

## Distance test (box-filtered downsample -> jsQR parent decode)
| target | decoded | result |
| --- | --- | --- |
| 410px | ${JSON.stringify(decode410)} | ${decode410 === URL ? "PASS" : "FAIL"} |
| 205px | ${JSON.stringify(decode205)} | ${decode205 === URL ? "PASS" : "FAIL"} |

## Close test (full-res crop, jsQR inversionAttempts "attemptBoth")
Sampled tiles: ${sampledPass}/${sampled.length} decoded to the assigned fragment.
Corner tiles: ${cornerPass}/${cornerResults.length}.

| tile (r,c) | # | expected | decoded | ok |
| --- | --- | --- | --- | --- |
${[...cornerResults.map((s) => ({ ...s, tag: "corner " + s.name })), ...sampled.map((s) => ({ ...s, tag: "sample" }))]
  .map((s) => `| ${s.tag} (${s.r},${s.c}) | ${s.idx % STORY.length} | ${JSON.stringify(s.fragment)} | ${JSON.stringify(s.got)} | ${s.ok ? "PASS" : "FAIL"} |`)
  .join("\n")}

## Contrast report (Rec.601 luminance, white = 1.0)
- Dark-cell mean luminance: ${darkMeanLum.toFixed(3)} (gate: < 0.45) -> ${contrastPass ? "PASS" : "FAIL"}
- Dark-cell max (worst tile): ${darkMax.toFixed(3)}
- Light-cell mean luminance: ${lightMeanLum.toFixed(3)}
- Dark/light contrast ratio: ${(darkMeanLum / lightMeanLum).toFixed(3)}

## Acceptance
- Distance decodes: ${distancePass ? "PASS" : "FAIL"}
- Tile decodes: ${allTilePass ? "PASS" : "FAIL"}
- Contrast gate: ${contrastPass ? "PASS" : "FAIL"}
- Overall: ${distancePass && allTilePass && contrastPass ? "PASS" : "FAIL"}

## Deliverables
- out/fractal.png — full ${W}px raster (the piece)
- out/fractal-preview.png — 410px distance view
- out/fractal-detail.png — 4x4-module crop (${detail.width}px, 6x upscale) showing tiles
- out/fractal-story.txt — the ${STORY.length} fragments in order
- out/fractal-report.md — this file
`;
fs.writeFileSync(path.join(OUT, "fractal-report.md"), report);

console.log(`parent v${P_VERSION}-${P_LEVEL} mask ${parent.mask}, dark modules ${darkModules.length}, unique tiles ${tileCache.size}`);
console.log(`geometry: MM=${MM} SYM=${SYM} MARGIN=${MARGIN} CELL=${CELL} QZ=${QZ_MODULES}mod raster=${W}px`);
console.log(`distance: 410 ${decode410 === URL ? "PASS" : "FAIL"} | 205 ${decode205 === URL ? "PASS" : "FAIL"}`);
console.log(`tiles: sampled ${sampledPass}/${sampled.length}, corners ${cornerPass}/${cornerResults.length}`);
console.log(`contrast: dark-cell mean ${darkMeanLum.toFixed(3)} (max ${darkMax.toFixed(3)}) gate<0.45 ${contrastPass ? "PASS" : "FAIL"}`);
console.log(`OVERALL ${distancePass && allTilePass && contrastPass ? "PASS" : "FAIL"}`);
if (!allTilePass) {
  for (const s of [...cornerResults, ...sampled]) if (!s.ok) console.log(`  FAIL tile (${s.r},${s.c}) exp ${JSON.stringify(s.fragment)} got ${JSON.stringify(s.got)}`);
}
