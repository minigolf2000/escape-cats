# Piece 9 — icon pair: the smiley and the Cool S

Two more nearly-blank designs by user request. Same shared rules and gates
as spec 08 rounds 1–2 (v6-L, urlCase schemehost, scale 8+3 scans, headroom
≥2, stroke ≥88%, hero 100%, whiteness ≥68%, dashes-not-nibbles, clean-disc
technique from nearly-blank-lib.mjs). New standalone generator
build-09-icons.mjs importing nearly-blank-lib.mjs — do NOT touch build-08
or its outputs. Outputs: out/icon-smiley.*, out/icon-cool-s.*,
out/icons-contact.png, out/icons-report.md.

## Design 1 — smiley 🙂

- Face: 1-module circle outline, radius ~9, centered near (19,15)
  (controllable left; nudge ±2).
- Eyes: solid 2×2 dots at roughly (15,11.5) and (15,18.5) (upper third,
  symmetric about the face center column).
- Smile: 1-module arc — the lower part of a radius-5 circle concentric with
  the face, spanning ~120° (from ~8 o'clock to ~4 o'clock), NO endpoints
  curling up past horizontal.
- Clean disc over the full face interior (build-01 technique). Hero: eyes +
  smile + disc speckle 0. Field: pinned white per the block-aware split,
  grain to margins.

## Design 2 — the Cool S (the '90s graffiti S)

Exact stroke set, in a local grid 25 rows × 13 cols (r,c offsets; place the
whole glyph near rows 8–32, cols 6–19, nudge ±2). All strokes 1 module:

- Top-rank verticals: (5..10, 0), (5..10, 6), (5..10, 12)
- Bottom-rank verticals: (14..19, 0), (14..19, 6), (14..19, 12)
- Crown (pointed top): line (5,0)→(0,6), line (0,6)→(5,12)
- Waist (the S slant): two PARALLEL diagonals, line (10,0)→(14,6) and
  line (10,6)→(14,12). The bottom of the top-right vertical (10,12) and the
  top of the bottom-left vertical (14,0) remain OPEN ENDS — this is
  characteristic of the authentic Cool S; do not join them.
- Bottom point: line (19,0)→(24,6), line (24,6)→(19,12)

Diagonal lines rasterize as uniform staircases (Bresenham); keep the two
waist diagonals exactly parallel (same row/col deltas). Hero: the ENTIRE
glyph at 100% — it's iconic, a single break kills it; if the solve can't
reach 100% at the default placement, nudge/shrink (2 modules off each
vertical's height is acceptable) before sacrificing any stroke. 2-module
white halo band around the whole glyph, clean (speckle 0). Field: white per
block-aware split.

## Review artifacts

Include in the contact sheet a PRE-SOLVE target render of each design next
to its solved result — the orchestrator checks glyph fidelity before
anything else (especially the S: it must be instantly recognizable to
anyone who went to school in the '90s).
