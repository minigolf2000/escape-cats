# Piece 1 — the nearly-blank code

**The bend:** everyone's mental model of a QR is dense static. This one is a
mostly-white sheet with a thin line-drawn cat and three finder squares, and it
scans.

## Payload & symbol

- URL: `https://github.com/minigolf2000/cat-games` (case-play allowed,
  scheme+host, same as the cat preset)
- Version 6, level L (41×41). Level L maximizes solver rank, which is what a
  white-field piece needs. If measurements show L can't hold ≥2 codewords of
  flip headroom per block after speckle cleanup, try M and compare; report both.

## Art direction

A minimal one-stroke-weight cat face, centered slightly left-of-center
(keep clear of the v6 alignment pattern at (34,34) — it stays as "furniture").
All strokes exactly 1 module wide, drawn from these elements (procedural, not
a fixed bitmap — you may nudge ±2 modules for solver happiness, but keep the
proportions):

- Head: an open circle/arc outline, ~20 modules diameter, centered near
  (19, 18) (row, col). The arc may break naturally at the ear joins.
- Ears: two OUTLINE triangles (not filled) sitting on top of the head circle,
  ~6 modules tall.
- Eyes: two 2×2 dark dots inside the face, on the eye line, ~7 modules apart.
- Nose: single dark module or 3-module triangle at face center; mouth: a small
  "ω" — 5–7 modules of curve under the nose.
- Whiskers: three 4–6-module horizontal strokes per side, radiating slightly,
  extending OUTSIDE the head circle into the white field. Whiskers are the
  signature move — they only work if the field around them is clean white.

Everything else in the symbol: pinned WHITE, by priority (below). No noise
tone anywhere in the target — this piece surrenders nothing on purpose and
lets the solver tell us what it can't afford.

## Solve strategy

Pin priority (earlier = pinned first while rank lasts):
1. All black strokes.
2. A 2-module white halo around every stroke (this is what makes it read as
   *drawn on paper*).
3. White field, spiraling outward from the face center — so when rank runs
   out, the forced/unsatisfied modules (speckle) land at the symbol margins,
   reading as vignette/paper grain, not face damage.

Then spend the flip budget erasing residual dark speckle, nearest-to-face
first, per-codeword priced as the engine does, keeping ≥2 codewords headroom
per block. ≥48 restarts × all 8 masks; art score = weighted satisfied pins
(halo > field) + a whiteness bonus on the inner 29×29.

## Acceptance

- verifyMatrix passes (scale 8 and scale 3) with the exact URL.
- validate(): ≥2 codewords headroom per block.
- ≥78% of non-function modules are light; inner 29×29 (excluding strokes and
  furniture) ≥ 92% light. Report both numbers.
- Deliver: `out/nearly-blank.png` (scale 8, quiet 4), `out/nearly-blank.svg`,
  `out/nearly-blank-preview.txt` (engine ascii dump), and a short
  `out/nearly-blank-report.md` with the meter, whiteness stats, and chosen
  mask/level. The orchestrator reviews the preview before sign-off; expect one
  round of art notes.
