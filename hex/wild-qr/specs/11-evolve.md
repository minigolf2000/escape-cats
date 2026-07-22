# Piece 11 — evolved tiny-cat & paw-print wallpaper

An aesthetic evolutionary algorithm: a population of icon-placement genomes,
scored by adversarial "wow" judges, bred over generations. This spec covers
the **genome harness** (`evolve-cat.mjs`) — the phenotype/fitness plumbing.
The GA loop itself runs as a separate Workflow that calls this harness.

## Glyphs (tiny — this is the point)

Two icon types, drawn procedurally at integer `scale` (base = scale 1).
Return `{dark:Set<[dr,dc]>, halo:Set<[dr,dc]>, w, h}` in local offsets.

- **paw** (base ~6w × 6t): a main pad (rounded blob ~3 wide × 2 tall at
  bottom-center) + 4 toe beans (1×1 or 2×1) in a shallow arc above it, the
  outer two set slightly lower. Must read as a paw at base scale on a 6-module
  footprint. Provide scale 1 and 1.5 (round to grid).
- **cat** (base ~6w × 7t): a SITTING SILHOUETTE — body trapezoid, round head,
  two ear triangles breaking the head's top, a tail curving up one side. Solid
  fill (blob economics: pin edge+halo hard, interior cheap). Reads as a cat in
  ~6×7 modules. Provide scale 1 and 1.5.

Both: a 1-module hard white halo band is part of the glyph (`halo` set).

## Genome schema (JSON)

```
{ "seed": <int>, "version": 10, "level": "L",
  "ground": "gray" | "white",          // gray => three-tone #3a3a3a noise ground
  "mask": <0-7 | "auto">,
  "icons": [ { "type":"cat"|"paw", "r":<int>, "c":<int>, "scale":<1|1.5> }, ... ] }
```

## `node evolve-cat.mjs render <genome.json> <out.png>`

1. Rasterize every icon to absolute module cells (dark + halo).
2. **Furniture guard**: reject (skip) any icon whose dark OR halo cells hit a
   function pattern (reuse build-09's heroFuncHits idea) BEFORE solving.
3. **Intact-or-absent**: probe-solve; rank surviving icons by
   dark+halo satisfaction; drop the worst whole icon; re-solve; repeat until
   every kept icon is 100% dark AND its halo clean. (Reuse nearly-blank-lib +
   the block-aware safe mask; recompute for v10 — 4 blocks, URL dirties only
   block 0 in cols 48-56.)
4. Ground: white => pin field white on safe (block!==0 || EC) cells, grain to
   margins. gray => surrender ground, render noise as #3a3a3a (three-tone),
   icons pure black, halos pure white.
5. Render PNG (scale 8, quiet 4) and verify with jsQR (allowSchemeHostCase) at
   scales 8 AND 3 — a genome that does not scan is INVALID.
6. Also write `<out>.meta.json`:
   `{ valid, scans:{s8,s3}, placed, kept, dropped, whiteness, minHeadroom,
      iconCounts:{cat,paw}, mask, seed }`.

Determinism: identical genome → identical PNG + meta. No Date.now/Math.random
(seed the noise RNG from genome.seed via mulberry32).

## Also: `node evolve-cat.mjs contact <png,png,...> <out.png> [labels]`
Grid contact sheet for a generation (for judges / review).

## Constraints
- New files only: `evolve-cat.mjs`, `out/evolve-*`. Do NOT modify existing
  builds, the shared lib (import it read-only), verify/png/engine, or any
  running piece's files. No new npm deps.
- Smoke test at the end: a hand-authored genome with ~10 icons renders, scans
  at both scales, meta shows kept≥6 and minHeadroom≥2. Print its meta.
