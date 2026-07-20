# Piece 2 — the diamond cat (finder patterns as eyes)

**The bend:** QR decoders recover orientation from the finder patterns, so a
code hangs at 45° just fine. Hung as a diamond, the upright symbol's TL finder
lands at the TOP corner, TR lands RIGHT, BL lands LEFT — and the two
side finders become the cat's eyes. The "scanner furniture" becomes anatomy.

## Payload & symbol

- URL: `https://github.com/minigolf2000/cat-games`
- Version 5, level L (37×37) — chunky poster grade. v5's alignment pattern at
  (30,30) sits in the BR quadrant, which is the BOTTOM corner of the diamond:
  use it as the cat's NOSE (it's already a dark 5×5 ring with a dark center —
  perfect). Nothing to solve there; it's free anatomy.

## In-symbol art (drawn in upright module coordinates)

- Muzzle: white cutout field in the BR quadrant surrounding the alignment
  pattern — a rounded diamond of pinned-white, ~13 modules across, so the
  nose floats on clean white.
- Mouth: "ω" curve of dark modules just BR-ward of the alignment pattern
  (appears *below the nose* in diamond orientation).
- Whiskers: three dark strokes per side leaving the muzzle white-field,
  running perpendicular to the TL→BR diagonal so they read horizontal when
  hung. Give each a 1-module white halo.
- Iris hint: pinned-white eyebrow arcs hugging the outer edge of the TR and
  BL finder separators (2-module white bands widening the existing separator
  toward the center) so the eye-finders pop off the noise ground.
- Everything else: surrendered noise (the fur). Optionally bias mask choice
  toward the most fur-like texture per the studio's art scoring.

## Poster composition (SVG, outside the symbol — no solver cost)

- Green field (#175338-ish, from hex-poster.svg), white rounded card rotated
  45° with the symbol; card padding = quiet zone (≥4 modules on all sides).
- Two black ear triangles OUTSIDE the card flanking the TOP corner (the TL
  finder between them reads as a forehead blaze).
- White whisker strokes continuing on the green field from where the
  in-symbol whiskers exit.
- Recolor for the print: the 3×3 dark centers of the TR and BL finders render
  dark emerald (#0d3b2a) as irises; every other dark module stays near-black.
  Scanners only need low luminance — keep contrast honest (relative luminance
  of any recolored dark < 0.2).
- Small caption on the field: "escape cats" (any tasteful pixel/mono type).

## Acceptance

- Upright symbol alone: verifyMatrix passes at scale 8 and 3.
- Composed poster: rasterize the SVG to PNG (any pure-JS or CLI path
  available; if rasterizing the full SVG is painful, compose the poster
  directly as a PNG in code — the SVG is still the deliverable for print),
  then jsQR must decode it BOTH upright and rotated 45° (rotate the raster,
  or rasterize the rotated composition) at full and half resolution.
- validate(): ≥2 codewords headroom per block.
- Deliver: `out/diamond-cat.svg` (composed poster, diamond orientation),
  `out/diamond-cat.png` (rasterized poster), `out/diamond-cat-symbol.png`
  (upright bare symbol, scale 8), `out/diamond-cat-report.md` (meter, scan
  matrix of orientation×scale results). Expect one round of art notes.
