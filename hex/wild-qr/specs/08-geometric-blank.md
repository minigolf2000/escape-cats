# Piece 8 — the nearly-blank geometric series

Follow-up to piece 1 by user request: more nearly-blank designs, now with
geometric patterns instead of (or alongside) the cat. Same core bend — a QR
that reads as a sparse pen drawing on paper.

## Shared rules (inherited from piece 1 — read build-01-nearly-blank.mjs)

- URL `https://github.com/minigolf2000/cat-games`, v6-L, urlCase
  "schemehost", verify with allowSchemeHostCase at scale 8 + 3.
- All strokes 1 module wide unless a design says otherwise.
- Reuse piece 1's block-aware budget insight: the URL freezes ~29 block-0
  codewords; spend block-0 flips only inside each design's "hero zone", and
  pin the outer field white only on block-1/EC-owned cells. COPY the helpers
  you need from build-01 into a shared file the new builds import
  (nearly-blank-lib.mjs) — but do NOT modify build-01 or its outputs.
- Headroom ≥2 codewords per block. Deterministic seeds.
- Gates per design: stroke satisfaction ≥88% overall AND 100% inside the
  design's declared hero zone; whiteness ≥68%; where rank runs out, misses
  must land as *shortened/dashed strokes*, not random nibble-holes — if a
  design can't achieve that, shrink or clip its pattern and say so.

## The designs (build all five; generator build-08-geometric.mjs)

1. **rings** — thin concentric circles centered on the (34,34) alignment
   pattern (it becomes the bullseye), 3-module radial pitch, expanding until
   clipped by the finders. Hero zone: the three innermost rings.
2. **waves** — Joy-Division horizontal wavelines, 3-module vertical pitch,
   flat at the edges and rising into a peaked "mountain" centered around
   column 15 (the controllable territory). Hero zone: the central peak
   region rows 12–30 × cols 8–24.
3. **spiral** — one Archimedean spiral opening from center (20,17), pitch 3
   modules, terminating before the finder margins. Hero zone: the inner 2.5
   turns.
4. **lattice** — isometric cube/rhombille tessellation of thin lines, cell
   height ~8 modules, drawn across the full data area, dashed degradation
   allowed outside the hero zone (center 21×21).
5. **target-cat** — one geometric piece keeps a cat: piece 1's face
   simplified to pure geometry (circle head, triangle ears, dot eyes) at
   center-left, orbited by two thin concentric arcs. Hero zone: the cat and
   inner arc.

## Round-3 additions (user request: hexagon / triangle blobs)

Solid blobs, not outlines — the Disney-poster move (solid masses + white
cutouts are codeword-cheap; only edges and halos need exact pinning). Both
designs keep the shared rules and gates, except whiteness ≥60% (solid
masses are darker by nature) and a new gate: every blob's EDGE band (its
outline modules) 100%, interiors may eat invisible misses.

6. **honeycomb** — 5–7 flat-top solid hexagons, side 4–6 modules, mixed
   sizes, clustered center-left with 1–2 rendered as outline-with-white-
   center for contrast; 2-module white halos; toward the frozen right the
   cluster dissolves into partial dashed hex outlines (solveDashed). Hero:
   the three largest hexes (edge band 100%, interior ≥90%).
7. **tangram** — solid triangles of varied size/rotation tumbling
   diagonally across the symbol like confetti, plus 2–3 white cutout
   triangles punched into the surrendered-noise ground between them
   (three-tone: black shapes, white shapes, gray noise — noise stays
   surrendered, unlike the white-field designs). Hero: the four largest
   dark triangles + all white cutouts.

## Deliverables

- out/geometric-<name>.png + .svg per design (scale 8, quiet 4)
- out/geometric-contact.png — all five side by side for review
- out/geometric-report.md — per-design: stroke %, hero-zone %, whiteness,
  meter, and where the dashes fell. Expect one round of art notes.
