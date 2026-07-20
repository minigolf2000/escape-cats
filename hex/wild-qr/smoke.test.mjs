// smoke.test.mjs — end-to-end proof the headless engine works and its output
// genuinely re-scans with jsQR. Run via `npm test`.
//
//   a. Standard encode  -> verifyMatrix passes
//   b. Art solve (pinned black square + white ring) -> >=95% pins honored,
//      verifyMatrix passes, validate() shows >=2 codewords headroom/block
//   c. Determinism: same inputs + same seed -> identical matrix
import assert from "node:assert/strict";
import { QRArt } from "./engine.mjs";
import { renderMatrix, writePNG } from "./png.mjs";
import { verifyMatrix } from "./verify.mjs";

const URL = "https://github.com/minigolf2000/cat-games";
const VERSION = 6;
const LEVEL = "L";
const NOISE_SEED = 12345;
const FLIP_SEED = 777;

function meter(perBlock) {
  return perBlock
    .map((b, i) => `blk${i}: ${b.errorsUsed ?? b.errors}/${b.capacity} used (${b.capacity - (b.errorsUsed ?? b.errors)} headroom)`)
    .join("\n  ");
}

// Build a paint target the way the studio's buildOrderTarget does: a tone map
// (0 noise, 1 dark, 2 light) + a seq stamp (paint order), then derive
// {order, target}. order = painted non-function cells, oldest paint first.
function buildTarget(version) {
  const S = QRArt.sizeOf(version);
  const fp = QRArt.functionPatterns(version);
  const tone = new Int8Array(S * S);
  const seq = new Int32Array(S * S).fill(-1);
  let counter = 0;
  const paint = (r, c, t) => {
    if (r < 0 || c < 0 || r >= S || c >= S) return;
    const i = r * S + c;
    if (fp.func[i]) return; // never constrain function patterns
    if (tone[i] === t) return;
    tone[i] = t;
    seq[i] = counter++;
  };
  const CX = 20, CY = 20; // center module
  // 7x7 solid black square centered at (20,20): rows/cols 17..23, pinned dark.
  for (let r = CY - 3; r <= CY + 3; r++)
    for (let c = CX - 3; c <= CX + 3; c++) paint(r, c, 1);
  // 2-module white ring around it: the 11x11 block rows/cols 15..25 minus the
  // inner 7x7 -> pinned light.
  for (let r = CY - 5; r <= CY + 5; r++)
    for (let c = CX - 5; c <= CX + 5; c++) {
      const inSquare = r >= CY - 3 && r <= CY + 3 && c >= CX - 3 && c <= CX + 3;
      if (!inSquare) paint(r, c, 2);
    }

  const cells = [];
  for (let i = 0; i < S * S; i++) if (tone[i] > 0 && !fp.func[i]) cells.push(i);
  cells.sort((a, b) => seq[a] - seq[b]);
  const target = new Uint8Array(S * S);
  for (const i of cells) target[i] = tone[i] === 1 ? 1 : 0;
  return { order: cells, target, seq, size: S };
}

let failures = 0;
function step(name, fn) {
  try {
    fn();
    console.log(`\n[PASS] ${name}`);
  } catch (e) {
    failures++;
    console.error(`\n[FAIL] ${name}\n  ${e.message}`);
  }
}

// ---- a. Standard path ----
step("a. standard encode + jsQR verify", () => {
  const std = QRArt.encodeStandard(URL, { version: VERSION, level: LEVEL });
  assert.equal(std.version, VERSION);
  assert.equal(std.level, LEVEL);
  const v = verifyMatrix(std.matrix, VERSION, URL);
  console.log("  jsQR OK at scales:", v.scales.map((s) => `${s.scale}x`).join(", "));
  console.log("  meter:\n  " + meter(v.perBlock));
  writePNG("./smoke-standard.png", renderMatrix(std.matrix, VERSION, { scale: 8, quiet: 4 }));
  console.log("  wrote smoke-standard.png");
});

// ---- b. Art path ----
let artMatrixA = null;
step("b. art solve (square+ring) + jsQR verify + headroom", () => {
  const prep = QRArt.prepareArt(URL, VERSION, LEVEL, "none");
  const { order, target, seq } = buildTarget(VERSION);
  const res = QRArt.solveArt(prep, {
    order,
    target,
    seq,
    mask: 0,
    margin: 0.5,
    marginCap: 0.8,
    noiseRng: QRArt.mulberry32(NOISE_SEED),
    flipSeed: FLIP_SEED,
  });
  artMatrixA = res.matrix;

  const pinnedTotal = order.length;
  const satisfied = pinnedTotal - res.unsatisfied.length;
  const pct = (satisfied / pinnedTotal) * 100;
  console.log(`  pinned modules: ${satisfied}/${pinnedTotal} satisfied (${pct.toFixed(1)}%)`);
  console.log(`  flips: ${res.flips.length}, solver headroom (min cap-used): ${res.headroom}, freeDim: ${res.freeDim}`);
  assert.ok(pct >= 95, `only ${pct.toFixed(1)}% of pinned modules satisfied (need >=95%)`);

  const v = verifyMatrix(res.matrix, VERSION, URL);
  console.log("  jsQR OK at scales:", v.scales.map((s) => `${s.scale}x`).join(", "));
  console.log("  meter:\n  " + meter(v.perBlock));

  for (const b of v.perBlock) {
    const head = b.capacity - b.errorsUsed;
    assert.ok(head >= 2, `block headroom ${head} < 2 codewords (used ${b.errorsUsed}/${b.capacity})`);
  }
  writePNG("./smoke-art.png", renderMatrix(res.matrix, VERSION, { scale: 8, quiet: 4 }));
  console.log("  wrote smoke-art.png");
});

// ---- c. Determinism ----
step("c. determinism (same inputs + seed -> identical matrix)", () => {
  const prep = QRArt.prepareArt(URL, VERSION, LEVEL, "none");
  const { order, target, seq } = buildTarget(VERSION);
  const res = QRArt.solveArt(prep, {
    order,
    target,
    seq,
    mask: 0,
    margin: 0.5,
    marginCap: 0.8,
    noiseRng: QRArt.mulberry32(NOISE_SEED),
    flipSeed: FLIP_SEED,
  });
  assert.ok(artMatrixA, "art matrix A missing (step b failed)");
  assert.equal(res.matrix.length, artMatrixA.length);
  let diffs = 0;
  for (let i = 0; i < res.matrix.length; i++) if (res.matrix[i] !== artMatrixA[i]) diffs++;
  console.log(`  matrix diffs vs step b: ${diffs}`);
  assert.equal(diffs, 0, `${diffs} modules differ across identical-seed solves`);
});

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
