# wild-qr harness — headless QR-art API

The QR-art engine from `hex/qr-studio.html`, extracted verbatim into
`engine.mjs` as an ESM module, plus PNG I/O and real jsQR scan verification.
Everything here runs in plain Node (`type: module`); no DOM, no browser globals.

```js
import { QRArt } from "./engine.mjs";
import { renderMatrix, writePNG, readPNG } from "./png.mjs";
import { verifyMatrix } from "./verify.mjs";
```

A **matrix** everywhere below is a `Uint8Array(size*size)`, row-major, value
`1` = dark module, `0` = light. `size = QRArt.sizeOf(version)` (v6 → 41). A
**module index** is `r * size + c`.

`npm test` runs `smoke.test.mjs` (standard encode, art solve, determinism) and
writes `smoke-standard.png` / `smoke-art.png`, both re-scanned with jsQR at
scale 8 and scale 3.

---

## Two entry paths

### Standard (no art) — `QRArt.encodeStandard(text, opts)`

```js
const std = QRArt.encodeStandard("https://…", { version: 6, level: "L" });
// opts: { version?, level="M", mask? }
//   version : omit to auto-pick via minVersionFor(text, level)
//   mask    : omit to search all 8 masks (lowest ISO penalty wins)
// returns { matrix, size, mask, version, level, lay }
```

`QRArt.minVersionFor(text, level, extraFreeBytes=0)` → smallest version (1–10)
that fits; throws `"payload too long for versions 1-10"` otherwise.

### Art — `prepareArt` then `solveArt`

Two stages so the expensive basis construction is cached per `(text, version,
level, urlCase)` and reused across many solves (different masks / paint).

#### `QRArt.prepareArt(text, version, level, urlCase = "schemehost")`

```js
const prep = QRArt.prepareArt("https://…", 6, "L", "none");
// returns { text, version, level, urlCase, built, lay, bases }
```

- `urlCase`:
  - `"schemehost"` (default) — the scheme+host letters (before the first `/`
    after `://`) are treated as **case-insensitive** (RFC 3986), so their case
    bits become extra free solver variables. **Caveat:** the decoded string
    then comes back with remixed capitalization (e.g. `HtTps://GITHub.cOm/…`).
    It is the *same URL* and still scans, but is **not byte-identical** to the
    input — so exact-string checks (like `verifyMatrix`) fail. Use it only when
    you compare case-insensitively.
  - `"none"` — reproduce the URL exactly (no case bits). Use this whenever the
    decoded text must equal the input verbatim.
- Throws if the payload does not fit at that version/level (studio catches this
  to mean "URL too long for this level").
- `prep.bases` is the list of free bit-vectors (pad codeword bits + optional
  case bits); `prep.lay` is the interleave/layout; `prep.built.bytes` is the
  baseline data codeword stream.

#### `QRArt.solveArt(prep, opts)`

```js
const res = QRArt.solveArt(prep, {
  order,                 // required: int[] of painted module indices, priority order
  target,                // required: Uint8Array(size*size), value AT each order index
  seq,                   // optional: Int32Array paint-stamp per module (flip tie-break)
  mask,                  // required: 0..7, the mask to solve under
  margin: 0.5,           // soft per-block flip budget = floor(capacity * margin)
  marginCap: 0.8,        // hard per-block cap    = floor(capacity * min(1,marginCap))
  noiseRng: null,        // optional () => [0,1) rng; randomizes the free noise field only
  flipSeed: 0,           // optional; >0 rotates WHICH pixels drop within equal-gain ties
});
```

**Target encoding.** `target` is a full `size*size` array, but only the indices
listed in `order` are consulted. For each `mi` in `order`:

- `target[mi] === 1` → that module is **pinned dark**.
- `target[mi] === 0` → that module is **pinned light**.
- Any module **not** in `order` is **free** (noise) — its `target` value is
  ignored. (Build `target` as zero-filled and set `1` only on pinned-dark
  cells, exactly as the studio does.)

**Priority order.** `order` is processed front-to-back. Earlier entries pin
first via incremental Gauss-Jordan and are **never disturbed** by later ones;
when the free-bit rank runs out, remaining pins are left to the flip pass. The
studio sorts by paint stamp (oldest paint first = highest priority). **Never
put function-pattern modules in `order`** — filter with
`QRArt.functionPatterns(version).func[mi]` (see below).

**Flip budget.** After exact solving, still-mismatched pinned modules are
grouped per Reed-Solomon codeword and deliberately flipped (RS absorbs them),
spending at most `floor(capacity*margin)` codewords/block on a first pass, then
up to `floor(capacity*marginCap)` on a second. `capacity = ecLen/2`
codewords/block. `seq` (or `flipSeed>0`) only decides *which* equal-value
codewords drop, not how many.

**Returns:**

```js
{
  matrix,        // Uint8Array(size*size) — the solved code
  bytes,         // solved data codeword stream
  flips,         // int[] module indices deliberately flipped
  pinned,        // # modules pinned exactly by the solver (pre-flip)
  blockUsed,     // int[] flip codewords spent per block
  allowance,     // int[] soft budget per block
  capacity,      // int[] ecLen/2 per block (max correctable codewords)
  unsatisfied,   // int[] pinned module indices STILL wrong after flips
  headroom,      // min over blocks of (capacity - blockUsed)  [solver-side estimate]
  mask, level, lay,
  freeDim,       // noise degrees of freedom → 2^freeDim distinct valid fields
}
```

`order.length - unsatisfied.length` = pins honored. `freeDim` is the null-space
dimension; XOR-ing null-space vectors (what `noiseRng` does) changes only free
modules, so pins/art are invariant to the noise seed.

`QRArt.functionPatterns(version)` → `{ size, func, base }`. `func` is a
`Uint8Array(size*size)`, `1` where the module is a finder/timing/alignment/
format cell (immovable — exclude from `order`); `base` is the pre-seeded matrix.

---

## Validation — `QRArt.validate(matrix, version, opts = {})`

Independent decode (reads format info, unmasks, de-interleaves,
Berlekamp-Massey per block) — the honest "will it scan" check.

```js
const v = QRArt.validate(matrix, 6);
// success: { ok:true, text, level, mask, formatDamage,
//            perBlock:[{errors, capacity}], marginLeft }
// failure: { ok:false, reason, ... }  (perBlock present on "block unrecoverable")
```

`perBlock[i].errors` = RS errors consumed in block `i`; `capacity` = `ecLen/2`.
**Headroom per block = `capacity - errors`; keep ≥ 2** for print safety.
`marginLeft` = worst fractional headroom across blocks. `text` is the decoded
payload (case-remixed if the solve used `urlCase:"schemehost"`).

---

## Rendering & PNG — `png.mjs`

```js
renderMatrix(matrix, version, { scale = 8, quiet = 4, dark, light })
//   → { data: Uint8ClampedArray (RGBA), width, height }
//   wraps QRArt.toRGBA; `quiet` modules of light border on each side.
//   dark/light are optional [r,g,b] (default black on white).
writePNG(path, { data, width, height })   // → path (writes PNG via pngjs)
readPNG(path)                             // → { data:Uint8ClampedArray RGBA, width, height }
```

Engine renderers are also exported: `QRArt.toRGBA(matrix, version, opts)`,
`QRArt.toSVG(...)`, `QRArt.ascii(matrix, version)`.

## Scan verification — `verify.mjs`

```js
verifyMatrix(matrix, version, expectedText)
//   Renders at scale 8/quiet 4 AND scale 3/quiet 4, runs jsQR on both, and
//   asserts BOTH decode === expectedText. Also runs validate() and asserts
//   ok && text === expectedText. THROWS a descriptive Error on any mismatch.
//   Returns { decoded, scales:[{scale,quiet,decoded}], validate, perBlock }
//   where perBlock[i] = { errorsUsed, capacity }.
scanRGBA({ data, width, height })  // → decoded string | null  (raw jsQR)
```

CLI: `node verify.mjs <file.png> <expectedText>` — reads the PNG, scans with
jsQR, prints `OK`/`FAIL`, exits nonzero on mismatch or undecodable.

> Because `verifyMatrix` demands an exact string match, pair it with
> `urlCase:"none"` on the art path. `"schemehost"` gives the solver more
> freedom but returns a case-variant string that fails exact comparison.

---

## Worked example — the smoke-test art solve

Pin a 7×7 solid dark square centered at module (20,20) and a 2-module light
ring around it, solve at v6/L, verify, and check headroom. (Full source in
`smoke.test.mjs`.)

```js
import { QRArt } from "./engine.mjs";
import { renderMatrix, writePNG } from "./png.mjs";
import { verifyMatrix } from "./verify.mjs";

const URL = "https://github.com/minigolf2000/cat-games";
const VERSION = 6, LEVEL = "L";
const S = QRArt.sizeOf(VERSION);                 // 41
const fp = QRArt.functionPatterns(VERSION);

// Build a tone map (0 noise / 1 dark / 2 light) with a paint stamp, the way
// the studio's buildOrderTarget does.
const tone = new Int8Array(S * S);
const seq  = new Int32Array(S * S).fill(-1);
let counter = 0;
const paint = (r, c, t) => {
  const i = r * S + c;
  if (r < 0 || c < 0 || r >= S || c >= S || fp.func[i] || tone[i] === t) return;
  tone[i] = t; seq[i] = counter++;
};
const CX = 20, CY = 20;
for (let r = CY-3; r <= CY+3; r++) for (let c = CX-3; c <= CX+3; c++) paint(r, c, 1); // dark 7×7
for (let r = CY-5; r <= CY+5; r++) for (let c = CX-5; c <= CX+5; c++)                  // light ring
  if (!(r>=CY-3 && r<=CY+3 && c>=CX-3 && c<=CX+3)) paint(r, c, 2);

// Derive { order, target }: painted, non-function cells, oldest paint first.
const order = [];
for (let i = 0; i < S*S; i++) if (tone[i] > 0 && !fp.func[i]) order.push(i);
order.sort((a, b) => seq[a] - seq[b]);
const target = new Uint8Array(S * S);
for (const i of order) target[i] = tone[i] === 1 ? 1 : 0;   // 1 dark, 0 light

// Prepare once, solve under a chosen mask (deterministic with fixed seeds).
const prep = QRArt.prepareArt(URL, VERSION, LEVEL, "none");
const res = QRArt.solveArt(prep, {
  order, target, seq, mask: 0,
  margin: 0.5, marginCap: 0.8,
  noiseRng: QRArt.mulberry32(12345), flipSeed: 777,
});

const honored = order.length - res.unsatisfied.length;      // pins satisfied
verifyMatrix(res.matrix, VERSION, URL);                     // throws if it won't scan
writePNG("./smoke-art.png", renderMatrix(res.matrix, VERSION, { scale: 8, quiet: 4 }));
```

Observed result (deterministic): **121/121 pins satisfied (100%)**, 15 flips,
`freeDim` 653, jsQR decodes at both scale 8 and 3. Per-block meter from
`validate()`:

```
blk0: 6/9 used (3 headroom)
blk1: 0/9 used (9 headroom)
```

Both blocks keep ≥ 2 codewords of headroom.

## Case-play verification (orchestrator addition)

`verifyMatrix(matrix, version, expected, {allowSchemeHostCase: true})` accepts
RFC-3986-equivalent case remixes of scheme+host, so art solves SHOULD use
`urlCase: "schemehost"` (≈30 extra basis bits, all inside the frozen URL
region) and verify with that option. The CLI compares with the same
equivalence. `sameURL(a, b)` is exported for custom checks.
