# qr-art/lab 🧬

A headless bench for [`../../qr-studio.html`](../../qr-studio.html), and a
genetic algorithm that drives it. The studio is where a person paints a QR
code; this is where a few thousand designs get painted overnight and scored.

**It is not a second engine.** `engine.mjs` slices the studio's own `<script>`
out of the HTML and evaluates it, so a lab run and a browser session are the
same solver byte for byte. Change the studio and the lab changes with it;
there is nothing here to keep in sync.

```sh
node evolve.mjs --mode both --seed 11 --pop 72 --gens 70 --out runs/both-11
node review.mjs runs review 3      # gather the winners, render, re-verify
JSQR_PATH=/tmp/qrverify/node_modules/jsqr node scan-check.mjs runs/both-11
```

## The pieces

| File | What it is |
| --- | --- |
| `engine.mjs` | Loads the studio's engine out of `qr-studio.html`. No fork, no copy. |
| `design.mjs` | Genome → paint. Bitmap fonts, hexagon geometry, and the tier map. |
| `solve.mjs` | Paint → score. Runs the solver, sculpts the ground, measures the result. |
| `evolve.mjs` | The GA: tournament selection, uniform crossover, per-gene mutation, a repair pass. |
| `review.mjs` | Best-of-every-lineage into one folder, re-rendered and re-verified. |
| `scan-check.mjs` | Second opinion from jsQR over the rendered pixels. |
| `check-link.mjs` | Does the URL in the code actually resolve? |
| `polish.mjs` | Coordinate descent on how a finished design is *drawn*. |
| `export.mjs` | Chosen designs out to `../` as artwork plus the recipe that made them. |
| `png.mjs` | A PNG writer, because node has zlib and that is the whole dependency list. |

`runs/` and `review/` are gitignored: thousands of candidate renders,
regenerable from the seed recorded in each manifest. The artwork that gets
chosen is committed to [`../`](../), not here.

## What the lab learned that the studio did not know

**The free noise is a drawable surface.** A finished solve leaves a null space
of several hundred dimensions, and every vector in it touches only *unpainted*
modules. XOR any subset into the matrix and the drawing, the pins and the
decode all survive. So the "random" QR texture costs nothing to draw on — no
pins, no error budget. `solveArt` now returns that basis (`noiseBasis`), and
`solveExact` is exported so a caller can spend it the same way it spends
paint: a second exact pass, in ground priority order.

**That is what makes a silhouette read.** A rolled noise field sits at ~50%
dark and a white shape dissolves into it. Pinned — rim first, then outward —
the ground reaches ~68% and the shape snaps out of the field. This is the
three-tone trick from [`../../qr-art-notes.md`](../../qr-art-notes.md) done
deliberately instead of hopefully.

**Order is the whole game.** Pinning the ground in distance order spends every
dimension of rank near the shape and leaves the far corners raw, which reads
as a quadrant where the silhouette stops existing. Rim first, then round-robin
across tiles, and the field comes out even. Nothing about the objective
changed — only the order the solver walks it in.

**Score relationships, not elements.** Mean darkness hides a 45% corner behind
an 85% top. A count of edge defects cannot tell one nick from a five-module
hole. Both had to become their own metrics (`groundSpread`, `edgeRun`) before
the search could see the defect a person sees first.

**A letterform is not a free parameter.** The search happily swapped in a
narrower X to buy two modules of hexagon, and the narrow X is a one-module
diagonal: at 41 modules it renders as five *disconnected* squares, so the word
reads "HE·" and, worse, the loose squares look like QR noise that leaked into
the white field. The score could not see it — every module was exactly where
it was asked to be. Glyphs whose strokes touch are the ones that survive
module resolution; that is the same lesson as bold ink translating and
engraving not, one level further down.

**Fitness has to be multiplicative.** Ambition (how much shape and how much
letter a design dares to ask for) times quality (how much of it the code
actually granted). Additive scoring converges on a small perfect boring
design every time.

## The gates

Nothing is scored unless it scans. `validate()` — the engine's honest decode
path: read format info, unmask, de-interleave, Berlekamp-Massey per block —
must return the URL, and at least two codewords of error headroom must be
left in the worst block. The URL comparison is case-insensitive on scheme and
host only (RFC 3986), because the solver spends host case bits as free
variables; the path is compared exactly, since a flipped path character is a
different video.

`scan-check.mjs` adds a second opinion from jsQR over the rendered pixels at
four scales and two quiet zones. jsQR is a dev-only dependency and is
deliberately not in `package.json`:

```sh
mkdir -p /tmp/qrverify && cd /tmp/qrverify && npm i jsqr
```

**And neither of them checks the thing that actually broke.** A wrong video id
sailed through both decoders, an adversarial review and a commit, because
every check in this lab was asking "does it decode to the string we meant?"
and none was asking "does that string go anywhere?" `check-link.mjs` asks the
second question, and `export.mjs` refuses to write artwork for a URL that does
not resolve (`QR_SKIP_LINK_CHECK=1` to override). A code that scans perfectly
and lands on a 404 is a broken code, and it is the cheapest failure here to
test for.

**Neither is a substitute for a phone.** Print adds its own damage; the notes'
advice to keep ≥2 codewords of headroom and test on real hardware before
printing still stands.
