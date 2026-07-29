# Piece 12 — the snake · FEASIBILITY REPORT

One unbroken 1-module dark line snaking through the whole symbol.
Payload `https://hexxygon.com` (20 chars), urlCase `schemehost`.

**Round scope: feasibility study.** Hard gates only — single 4-connected
component, exactly 2 endpoints, 100% of line cells dark on the SOLVED
matrix, jsQR decode at scale 8, >=2 codewords headroom per block. Halo
quality, coverage, speck counts and endpoint art are reported but were
NOT iterated on.

## How the route is built

The route lives on a **coarse lattice** of spacing `pitch`: nodes at fine
cells `(r0+pitch*i, c0+pitch*j)`, edges = the straight run of fine cells
between lattice-adjacent nodes. Any *simple path in the lattice graph*
lifts to an *induced path in the fine grid* (proof in the file header), so
the no-self-touch rule is structural rather than patched in afterwards.
Finding the route is then a DFS for a long simple path on a ~12x12 graph,
and the move-ordering policy IS the artistic variant.

**Timing bridges.** Row 6 and column 6 are function modules all the way
across the symbol, so a line that may not occupy function cells simply
*cannot reach* rows 0-5 or columns 0-5 — they are cut off, capping row
coverage near 88%. The way through is that the timing pattern alternates:
`(6,c)` is already dark for even `c`. The snake crosses at an even column,
using the timing module itself as a bridge it never has to pin, and the two
flanking timing cells are odd hence light, so the crossing keeps its white
halo for free. Bridge cells count as line cells for connectivity and are
asserted dark on the solved matrix.

## Feasibility map

| variant | ver | pitch | route? | line mods | reroutes | 100%-line configs | flips | headroom | scan@8 | scan@3 | halo | specks | rows | cols | gate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| serpentine-rows | v10 | 4 | yes | 570 (563+7br) | 2 | 3/32 | 30 | 2 | yes | yes | 98.8% | 13 | 100.0% | 93.0% | PASS |
| serpentine-rows | v10 | 5 | yes | 439 (436+3br) | 5 | 2/32 | 20 | 2 | yes | yes | 98.8% | 11 | 98.2% | 96.5% | PASS |
| serpentine-rows | v10 | 6 | yes | 399 (394+5br) | 5 | 2/32 | 25 | 2 | yes | yes | 99.1% | 7 | 93.0% | 96.5% | PASS |
| serpentine-cols | v10 | 4 | yes | 594 | 6 | 0 | - | - | NO | NO | - | - | - | - | **FAIL: no config reached 100% line** |
| serpentine-cols | v10 | 5 | yes | 449 (446+3br) | 4 | 1/32 | 23 | 2 | yes | yes | 98.0% | 17 | 98.2% | 96.5% | PASS |
| serpentine-cols | v10 | 6 | yes | 394 (389+5br) | 3 | 7/32 | 20 | 2 | yes | yes | 98.8% | 10 | 93.0% | 96.5% | PASS |
| spiral | v10 | 4 | yes | 517 (510+7br) | 5 | 32/32 | 18 | 3 | yes | yes | 100.0% | 0 | 100.0% | 71.9% | PASS |
| spiral | v10 | 5 | yes | 428 (427+1br) | 3 | 4/32 | 24 | 2 | yes | yes | 98.6% | 12 | 80.7% | 96.5% | PASS |
| spiral | v10 | 6 | yes | 429 (422+7br) | 1 | 8/32 | 16 | 2 | yes | yes | 99.1% | 7 | 100.0% | 96.5% | PASS |
| hybrid | v10 | 4 | yes | 517 (510+7br) | 4 | 32/32 | 18 | 3 | yes | yes | 100.0% | 0 | 100.0% | 71.9% | PASS |
| hybrid | v10 | 5 | yes | 418 (417+1br) | 5 | 5/32 | 23 | 2 | yes | yes | 98.6% | 12 | 80.7% | 96.5% | PASS |
| hybrid | v10 | 6 | yes | 429 (422+7br) | 1 | 8/32 | 16 | 2 | yes | yes | 99.1% | 7 | 100.0% | 96.5% | PASS |
| serpentine-rows | v6 | 5 | yes | 253 (250+3br) | 6 | 3/32 | 18 | 2 | yes | yes | 98.7% | 6 | 100.0% | 95.1% | PASS |
| serpentine-rows | v6 | 6 | yes | 249 (244+5br) | 2 | 4/32 | 26 | 2 | yes | yes | 98.0% | 9 | 100.0% | 100.0% | PASS |
| serpentine-rows | v6 | 7 | yes | 165 (162+3br) | 1 | 30/32 | 14 | 3 | yes | yes | 100.0% | 0 | 100.0% | 100.0% | PASS |
| serpentine-cols | v6 | 5 | yes | 234 (231+3br) | 5 | 32/32 | 21 | 3 | yes | yes | 100.0% | 0 | 100.0% | 97.6% | PASS |
| serpentine-cols | v6 | 6 | yes | 243 (238+5br) | 3 | 1/32 | 27 | 2 | yes | yes | 97.1% | 13 | 100.0% | 90.2% | PASS |
| serpentine-cols | v6 | 7 | yes | 191 (189+2br) | 1 | 1/32 | 24 | 2 | yes | yes | 96.8% | 12 | 97.6% | 97.6% | PASS |
| spiral | v6 | 5 | yes | 264 (261+3br) | 1 | 2/32 | 26 | 2 | yes | yes | 97.9% | 10 | 100.0% | 97.6% | PASS |
| spiral | v6 | 6 | yes | 249 (244+5br) | 2 | 4/32 | 26 | 2 | yes | yes | 97.7% | 10 | 100.0% | 100.0% | PASS |
| spiral | v6 | 7 | yes | 191 (189+2br) | 1 | 2/32 | 24 | 2 | yes | yes | 96.8% | 12 | 97.6% | 97.6% | PASS |
| hybrid | v6 | 5 | yes | 264 (261+3br) | 1 | 2/32 | 26 | 2 | yes | yes | 97.9% | 10 | 100.0% | 97.6% | PASS |
| hybrid | v6 | 6 | yes | 249 (244+5br) | 2 | 4/32 | 26 | 2 | yes | yes | 97.7% | 10 | 100.0% | 100.0% | PASS |
| hybrid | v6 | 7 | yes | 191 (189+2br) | 1 | 2/32 | 24 | 2 | yes | yes | 96.8% | 12 | 97.6% | 97.6% | PASS |

`100%-line configs` = how many of the 32 solver configurations tried
(8 masks x 4 flip-seed rotations) delivered every single line cell dark
with >=2 headroom. `flips` = deliberately-wrong modules Reed-Solomon
absorbed. `gate` = connectivity + endpoint-degree assertion on the SOLVED
matrix (single 4-connected component, exactly 2 degree-1 cells, no
degree-3+ cell, no isolated cell).

## What this tells us

* 23/24 sweep cells solved end to end.
* Every solved cell needed **6 reroute(s) at most** — the first route off the lattice usually solves, so route feasibility is not the bottleneck.
* Between 1 and 32 of 32 solver configs hit 100% line, i.e. the line is comfortably inside the free-bit budget, not scraping it.
* Headroom landed at 2-3 codewords per block. `marginCap 0.8` of a 9-codeword capacity makes >=2 structural.
* Halo satisfaction ran 96.8%-100.0% with **zero** effort spent on it. That is the constraint most affordable to buy back next round.

## Recommended hero

**serpentine-rows, v10-L, pitch 4** — `out/snake-v10.png` / `.svg` / `-bw.png`.

```
route        570 modules (563 pinned + 7 timing bridges), lattice offset (0,2)
line dark    100.0%   (assert: all pinned line cells dark = true, all bridges dark = true)
connectivity single component = true, endpoints = 2, branch cells = 0, isolated = 0
halo         98.8% of 1048 cells, 13 specks
coverage     rows 100.0%, cols 93.0%
solver       mask 1, flipSeed 0, 1524 exact pins, 30 flips, freeDim 500
scans        toned@8 true  toned@3 true  bw@8 true  bw@3 true
decoded      HtTPS://HExxygon.COM

  blk0: 7/9 used (2 headroom)
  blk1: 0/9 used (9 headroom)
  blk2: 0/9 used (9 headroom)
  blk3: 0/9 used (9 headroom)
```

## v6-L (coarser, poster-grade)

**spiral, v6-L, pitch 5** — `out/snake-v6.png`. 264 modules, line 100.0%, halo 97.9%, headroom 2, rows 100.0% / cols 97.6%, scans toned@8 true / @3 true.

```
  blk0: 7/9 used (2 headroom)
  blk1: 0/9 used (9 headroom)
```

## Deliverables

* `out/snake-contact.png` — one solved cell per variant (best pitch), v10 then v6.
* `out/snake-contact-routes.png` — the same variants as route-only diagrams
  (pale pink = clearance-blocked, gray = function modules, red = timing bridges).
* `out/snake-<variant>-v<V>-p<P>.png` — every solved sweep cell.
* `out/snake-route-<variant>-v<V>-p<P>.png` — its route-only diagram.
* `out/snake-v10.png` / `.svg` / `-bw.png` — the hero.
* `out/snake-v6.png` / `.svg` / `-bw.png` — the coarse cut.
* `out/snake-feasibility.json` — the machine-readable map.

## Deviations from the spec

* **Endpoint flares skipped.** A 2x2 dot makes every one of its four cells
  degree-2 and the cell before it degree-3, which fails both the
  no-self-touch rule and the spec's own "exactly 2 endpoints, all others
  degree 2" gate. The two rules are mutually exclusive; the gate won.
* **Row coverage is capped by geometry, not by effort.** Rows 0-5 and
  columns 0-5 are only reachable through a timing bridge, and only the
  lattice lines that happen to land there get covered. Without bridges the
  ceiling would be ~88%.
* **Detour style** is realised as the DFS row-advance direction rather than
  a hand-written hug/wide obstacle-following rule — on the lattice a detour
  is just backtracking, so the two styles differ in which way the line peels
  off a blockage.
* Halo, specks and coverage were left un-iterated per the revised scope.


## Orchestrator judgment (art-notes round)

Feasibility confirmed: 23/24 cells solved; route existence is not the
bottleneck; halo quality is nearly free. Two heroes shipped:
- **snake-v10.png** (builder's pick: serpentine-rows p4) — the "scan-line"
  reading, one line sweeping the full width.
- **snake-spiral-v10-p4.png** (orchestrator's pick) — the labyrinth: the
  single most solvable design of the batch (32/32 configs, halo 100%,
  0 specks, headroom 3) and the strongest visual metaphor.
Constraints affordable next round, per the map: strict no-self-touch,
endpoint pen-dots, and concept upgrades (a fair maze whose solution path
is the line; a one-line drawing that forms a shape).
