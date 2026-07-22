# Piece 11 — evolved tiny-cat & paw wallpaper (aesthetic GA)

An aesthetic genetic algorithm evolved the *placement* of tiny cat-face and
paw-print icons across a v10 (57×57) QR code, judged for "wow" by viewing the
rendered image each generation.

## The GA

- **Genome** (low-dimensional lattice, not an explicit icon list — so every
  gene meaningfully changes the pattern): `pitch, stagger, jitterAmp,
  jitterSeed, typeMix (cats vs paws), scaleBias, originR, originC`.
- **Phenotype**: `expand(genome)` tiles the icons across the clean canvas
  (cols 9–46; the URL freezes cols 48–56 into grain), skipping the three
  finder corners. `evolve-cat.mjs render` then solves it to a scannable v10-L
  code (intact-or-absent per icon, three-tone gray ground) and reports a meta.
- **Fitness**: the rendered PNG viewed and scored for wow — pattern rhythm,
  density, surprise, and how crisply the tiny faces/paws read — hard-gated on
  "actually scans" (jsQR at scale 8 and 3) and penalized for sparseness.
- **Operators**: elitism (top 2 carried), tournament selection, per-gene
  crossover, per-gene mutation. Generation 0 was *seeded* with two curated
  layouts so evolution could only improve on a good start.
- **Deterministic**: all randomness from a seeded PRNG (mulberry32); every
  genome renders byte-identically.

This is *interactive / aesthetic evolutionary computation* — the lineage of
Karl Sims' evolved images and Dawkins' biomorphs: evolution steered by a judge
of appearance rather than a numeric objective.

## Trajectory (see evolve-montage.png)

| gen | what won | icons | note |
| --- | --- | --- | --- |
| 0 | `polka` (staggered small faces) | 10 | seeded; rhythm beat jitter & big-scale |
| 1 | `ultratight` (pitch 7 grid) | 16 | density jumped — the key mutation |
| 2 | `champcat` / `champpaws` | 16 / 13 | refined the pitch-7 grid; locked champions |

The decisive gene was **pitch**: dropping it to 7 (faces 6 wide → 1-module
gaps) packed 16 recognizable cat faces into a near-regular grid — the point
where the code stops looking like a code and starts looking like gift wrap.

## Champions

- **evolve-champion-cats.png** — the pure result: ~16 tiny cat faces in a
  dense grid. jsQR-verified at scale 8, 3, and re-scan.
- **evolve-champion-cats-paws.png** — the cats-*and*-paws sheet: cat faces
  interspersed with paw prints (surrounding faces prime the eye, so the paws
  read as paws). jsQR-verified.

Both encode `https://github.com/minigolf2000/cat-games` (scheme+host case
remix), v10-L, three-tone gray ground, ≥2 codewords of RS headroom per block.
Reproduce: `node evolve-cat.mjs render out/evolve-ga/g2-champcat.json <out>`.

## Generations 3–4: the representation restart

Gen 2 had plateaued (best fitness ~86, improvements down to cosmetic
shuffles) — the classic sign that the *genome*, not the search, was the
ceiling: 8 lattice genes can only describe uniform grids. Instead of more
generations, the genome was enriched with four new genes: `typePattern`
(random | row stripes | cat/paw checkerboard), `shear` (diagonal lattice
flow), `scalePattern` (size rhythm), and `focal` (one 1.5× cat the lattice
flows around).

- **Gen 3** explored the new axes. Diagonal flow scored ~80 immediately;
  the focal gene FAILED for a diagnosable reason — the big cat's footprint
  overlapped the (28,28) alignment pattern and was furniture-skipped.
  (Aesthetic-GA lesson: inspect failures; they're often placement bugs, not
  bad genes.)
- **Gen 4** recombined winners: `focalfix` (focal moved to furniture-clear
  (14,16)) scored ~88 — the "mama cat & kittens" composition, hierarchy
  instead of pure texture — and `diagdense` (~85) delivered dense diagonal
  drift. The plateau broke: 75 → 85 → 86 → 86 → 88, with the last jump
  coming from *representation*, not iteration.

Stopped at gen 4: improvement per generation fell back to +2 and the two
champions occupy distinct aesthetic niches (composition vs texture) —
plateau + diminishing returns + niche coverage is the stopping rule.

Final champions (both jsQR-verified):
- **evolve-champion-mama-cat.png** — big focal cat, small faces flowing
  around it (`out/evolve-ga/g4-focalfix.json`)
- **evolve-champion-diagonal.png** — dense diagonal-drift face field
  (`out/evolve-ga/g4-diagdense.json`)
