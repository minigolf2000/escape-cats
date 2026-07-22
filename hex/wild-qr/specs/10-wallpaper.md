# Piece 10 — wallpaper: repeating icon patterns at v10 (57×57)

User goal: maximum wow. The thesis: periodicity reads as *designed print*
(gift wrap, notebook doodles), the polar opposite of QR randomness — a code
that looks like wallpaper is a stronger brain-bend than any single icon.

## Symbol

- v10-L (57×57), URL `https://github.com/minigolf2000/cat-games`, urlCase
  schemehost. v10-L blocks: [2×(86,68), 2×(87,69)] — the URL dirties only
  block 0; blocks 1–3 are pure padding. Recompute the block-aware safe mask
  for v10 (do not assume v6's split). Beware furniture: v10 has alignment
  patterns at combos of centers {6,28,50} including (28,28) dead center —
  icons must not overlap any function cells (use the hard `heroFuncHits`
  disqualifier from build-09 for every icon placement).
- Same base gates as spec 09: scale 8+3 scans (also verify scale 2 — 57
  modules is big; report it), headroom ≥2/block, whiteness ≥66%,
  dashes-not-nibbles for non-icon strokes.

## The intact-or-absent rule (new, replaces per-stroke dashing for icons)

Wallpaper dies if icons are half-damaged. Each icon instance must end
either COMPLETE (100% of its strokes + its local halo clean) or ABSENT
(dropped entirely before the final solve, its cell left to field/grain).
Probe-solve, rank instances by satisfaction, drop the worst until every
survivor is perfect. Report placed/kept counts per design. Keep ≥60% of
attempted instances or shrink the icon variant.

## Designs (generator build-10-wallpaper.mjs, reuse nearly-blank-lib)

1. **smiley-dots** — polka-dot wallpaper: small smileys (ring r4–5, 2 eye
   dots, 3–5-module smile arc) on a staggered grid (odd rows offset by half
   pitch), pitch ~12–13. Attempt every lattice site that clears furniture;
   intact-or-absent. Hero: the 4 most central smileys.
2. **cool-s-wall** — the notebook-margin classic, tiled: the build-09 Cool S
   glyph (may shrink to ~0.75 scale: verticals 4 tall, same topology,
   parallel waist, open ends) in a brick layout (rows offset), ~6–10
   instances. Hero: the most central S at FULL build-09 size, perfect;
   smaller S's around it intact-or-absent.
3. **doodle-page** — the charm piece: an arranged school-binder page — one
   large Cool S, two smileys of different sizes, one tangram-style solid
   triangle pair, one small flat-top hexagon outline, one 5-point star
   outline (chunky, ~9 modules), scattered at varied angles like margin
   doodles, each with a clean local halo. Composition: no two icons
   touching, visual weight balanced around the center alignment pattern
   (which may read as a "sticker"). Hero: the S + the large smiley.

## Deliverables

out/wallpaper-{smiley-dots,cool-s-wall,doodle-page}.{png,svg},
out/wallpaper-contact.png (targets AND solved, all three),
out/wallpaper-report.md (per design: instances placed/kept, stroke %,
whiteness, per-block meter, mask/seeds, scale-2 scan result). One round of
art notes expected.
