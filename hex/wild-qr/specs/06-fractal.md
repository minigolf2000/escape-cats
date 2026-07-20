# Piece 6 — the fractal code (a QR made of QRs)

**The bend:** from across the room it's one code; up close, every dark module
is itself a tiny scannable QR. Two reading distances, hundreds of payloads.

## Structure

- Parent: `https://github.com/minigolf2000/cat-games`, version 6, level L,
  STANDARD encode (no art solve — the fractal texture is the art; we want
  maximum decode margin). Choose the mask by lowest ISO penalty as usual.
- Tiles: every dark parent module is rendered as an INVERTED v1-L QR
  (light-on-dark) — inversion keeps the cell dark-dominant (~60% dark plus
  padding ring ≈ 70%+), which preserves the parent's contrast. jsQR reads
  inverted codes via `inversionAttempts: "attemptBoth"`, and phone cameras
  handle inversion too. Light parent modules: plain white.
- Tile geometry: parent module cell of 48×48 px = 2px dark padding ring +
  a 21-module v1 symbol at 2px/module + its own 1-module quiet zone rendered
  in the DARK background color (an inverted code's quiet zone is dark).
  Measure and adjust: the constraint that matters is the downsample test
  below, plus every tile having ≥2px effective module size.

## Tile payloads

v1-L holds 17 bytes. The dark modules, read in raster order, carry a hidden
serial story — one fragment per tile, e.g. `#017 HEX SAW THE RED DOT` — write
a ~40-fragment loopable micro-story about Hex and Goomba (cat mischief,
escape-room flavored; keep each ≤17 bytes hard limit) and cycle it. Tile #000
(first dark module) is the key: `START HERE. MEOW.` Every tile string unique
enough that scanning a few feels like collecting.

## Acceptance

- Distance test: downsample the full raster to 410px and to 205px
  (box filter), jsQR decodes the parent URL at both.
- Close test: crop and decode ≥24 randomly sampled tiles + the 4 extreme
  corner tiles at full resolution with inversionAttempts both — all pass, and
  decoded text matches the assigned fragment.
- Contrast report: mean luminance of dark cells vs light cells; dark-cell
  mean must stay < 0.45 of white.
- Deliver: `out/fractal.png` (full ~2100px raster), `out/fractal-preview.png`
  (410px, the "distance view"), `out/fractal-detail.png` (a 4×4-module crop
  showing tiles), `out/fractal-story.txt` (the fragment list in order),
  `out/fractal-report.md` (all test results).
