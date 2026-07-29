# Piece 13 — the hexagon and the word HEX · REPORT

One 1-module dark line with a white halo; everything else surrendered to
gray noise (piece-12 three-tone render). Payload `https://hexxygon.com`,
urlCase `schemehost`, v10-L primary and v6-L secondary.

Route generators are new; the solve -> gate -> render core is imported
verbatim from `build-11-snake.mjs` (new named exports; its CLI and
outputs are unchanged).

## Gate summary

| design | ver | line | halo | components | endpoints | branches | span | headroom | toned@8 | toned@3 | bw@8 | bw@3 | gate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| hexagon-hero | v10 | 100.0% of 176 | 99.2% of 658 | 1 | 0 | 0 | 53 (93.0%) | 2 | true | true | true | true | PASS |
| hexagon-v10 | v10 | 100.0% of 160 | 99.8% of 584 | 1 | 0 | 0 | 41 (71.9%) | 2 | true | true | true | true | PASS |
| hexagon-v6 | v6 | 100.0% of 88 | 100.0% of 341 | 1 | 0 | 0 | 25 (61.0%) | 3 | true | true | true | true | see below |
| hexword-v10 | v10 | 100.0% of 140 | 100.0% of 707 | 1 | 8 | 10 | 41 (71.9%) | 3 | true | true | true | true | PASS |
| hexword-v6 | v6 | 100.0% of 100 | 97.8% of 490 | 1 | 8 | 10 | 31 (75.6%) | 2 | true | true | true | true | PASS |
| hexword-in-hexagon-hero | v10 | 100.0% of 265 | 99.5% of 925 | 2 | 8 | 10 | 53 (93.0%) | 2 | true | true | true | true | PASS |
| hexword-in-hexagon | v10 | 100.0% of 255 | 99.8% of 865 | 2 | 8 | 10 | 41 (71.9%) | 2 | true | true | true | true | PASS |

**`hexagon-hero` (= `hexagon-v10-lobed`) is the hero.** `hexagon-v10` is
the purist variant of the same figure. Both ship; see the next section.

## A. The hexagon — geometry chosen, and why the detour is structural

**Uniform staircases.** A regular hexagon's 60 degree edges are slope
sqrt(3) = 1.732, which Bresenham renders as an irregular mix of 2- and
3-cell column runs — lumpy at 57 modules. The four slants therefore use
slope EXACTLY 2: the repeating unit is `[right, down, down]` and its three
reflections, so every column of every slant carries the same 3-cell run.
63.4 degrees instead of 60. Both right-hand slants are grown from the
right vertex and both left-hand ones from the left vertex, so the ideal
figure is exact under both mirrors before any repair.

**v10 geometry chosen: cr=cc=28, W (circumradius) = 22, d = 9, so
A = 13 and H = 18.** Silhouette 41 x 37 modules, aspect 0.90 against a
regular hexagon's 0.866. Centre offsets were searched and 0 wins: any
vertical offset that clears the side alignment patterns forces the top
flat into the (6,28) alignment's clearance and squashes the figure to
aspect ~0.5.

**Why W cannot be clean.** The alignment patterns (28,6) and (28,50)
straddle the horizontal centre line, and with piece 12's 1-module
clearance ring they block rows 25-31 of cols 3-9 and 47-53. A slope-2
vertex is a 5-cell vertical run centred on row 28, so it is inside that
band for any W >= 19. The widest DETOUR-FREE hexagon is W=18 -> 37 modules
= 64.9% span, which fails the spec's 70% gate. Nor can the figure escape
outward: a slanted edge can never cross the timing column, because a
timing crossing has to be a horizontal 3-cell run `(r,5),(r,6),(r,7)` at an
even `r`, and a staircase only ever offers 1-cell horizontal steps. So
everything lives right of column 6, and **>= 70% span REQUIRES a detour**.

**The detour actually taken (`tipStyle:"in"`).** Each blocked arc is
trimmed back one further cell on each side and reconnected by the shortest
path that keeps the union induced. Both sides trim 11 ideal cells and
insert 11: the vertex flattens to a 7-cell vertical at col 46 (mirror col
10) while the shoulders still reach col 48 / col 8, giving span 41 =
**71.9%**. The two obstacles are exact mirrors and the repair is
deterministic, so the two detours come out as exact mirrors of each other
— it reads as a chamfered vertex, not as a one-sided bite. **No timing
bridges were needed** for the shipped hexagon at either version.

### The two treatments, and which is the hero

`tipStyle:"out"` is the other way to satisfy the span gate: instead of
pulling the vertex in, run the outline AROUND each side alignment pattern
(trim 9 ideal cells, insert 17, crossing the timing column on two bridges
at rows 24 and 32 — both even, so both land on dark timing modules that
never have to be pinned). Span 93.0%.

**This is the hero, `out/hexagon-hero.png`.** The detour does not merely
dodge the alignment patterns, it ENCLOSES them: each one ends up inside a
vertex, so the two most rigid pieces of QR furniture in the symbol read as
decorative bosses set into the hexagon's left and right points. That is
the same move as the diamond-cat piece turning finder patterns into eyes —
function pattern becoming ornament — and it is the treatment that actually
answers "a hexagon that spans the code": 53 of 57 modules wide against the
chamfer's 41.

**`out/hexagon-v10.png` is kept as the purist variant**, unchanged: the
same slope-2 loop with the vertices chamfered inward instead, containing
nothing but hexagon, at 71.9% — the minimum the span gate allows. Both
pass every strict gate (1 component, 0 endpoints, 0 branches, 100% line,
headroom 2, jsQR at 8 and 3 in both tones).

### Correction to the first draft of this report

The first draft shipped the lobed hexagon as a REJECTED alternative and
described its vertices as "rectangular lugs" that stop the silhouette
reading as a hexagon. That undersold it: the lugs are not empty boxes, they
are frames around the alignment patterns, and the enclosure is what makes
them read as designed rather than as damage. Reframed above.

**v6 span is capped by geometry, not by effort.** At v6 the only
obstruction near the centre line is the timing column itself, and a
5-cell vertical vertex cannot sit on col 7 (a timing flank is usable only
at even rows). So the leftmost usable vertex column is 8, W <= 12, span
25/41 = **61.0% — the one FAILED gate in this round**. Pushing to W=13/14
with a bridge crossing produces a one-sided nub on the left against a
clean point on the right; it was built, looked at, and rejected. The v6
hexagon shipped is perfectly uniform with ZERO detours.

## B. The word — why it is not vertically centred

The centre alignment jewel blocks rows 25-31 x cols 25-31 and its two
siblings block cols 3-9 and 47-53 over the same rows. At the vertical
centre of a v10 symbol the usable strip is therefore just cols 10-24 and
cols 32-46 — two 15-column windows. H and E fit; X has nowhere to go.
**A vertically centred HEX is impossible at v10**, so the word is placed
in a 15-row band that is entirely clear (rows 32-46; rows 10-24 is the
mirror option and looks like a title rather than a signature). This is a
deliberate deviation from the spec's suggested rows 18-38.

Letters: H and E 10 columns, X 15 columns so its diagonals are exact 45
degree staircases. A 15x13 X needs slope 7/6 and Bresenham's two
double-steps visibly kink the arms — built, compared, rejected. Gaps are 3
columns; at 2 the H's right stem and the E's stem read as one glyph.

**Branch and endpoint accounting** (10 branches, 8 endpoints, both
measured on the solved matrix):

| source | branch cells | why |
|---|---|---|
| H | 2 | the crossbar's two T-junctions |
| E | 1 | the middle arm's T-junction |
| X | 6 | two 4-connected 45-degree staircases cross in a 2x3 overlap, not a point — a single degree-4 cell is unreachable in a 4-connected grid |
| join 1 | 1 | an arm end can only meet the E at its bottom-left corner, turning that corner from degree 2 into degree 3 |
| join 2 | 0 | end-to-end: E's bottom-arm tip to X's lower-left tip |

The spec's "target 2 endpoints" is not reachable without retracing: H, E
and X have 4 + 3 + 4 = 11 intrinsic stroke ends, and the two specified
travel segments can only consume 3 of them. 8 is the honest floor for
HEX drawn with two connectors.

## Legibility call (the hero gate)

**PASS, at both versions.** Each solved PNG was rendered, read back and
inspected at 8x and again downsampled to 50% (the spec's viewing
condition). H, E and X are each unambiguous in `hexword-v10.png` and
`hexword-v6.png`; no letter can be confused with another glyph.

Two things were changed *because of* this check, not because of numbers:

* **Halo width 3 for the word** (2 for the hexagon). Piece 12 used 1. Its
  report said halo quality was the cheapest constraint to buy back and it
  was right: these figures pin only 88-255 line cells against the snake's
  570, so a 3-module halo costs ~700 pins and still leaves >= 2 codewords
  of headroom. At halo 1 the letter counters fill with dark noise and the
  E in particular stops reading; at 3 the counters are clean white.
* **Inter-letter gaps widened from 2 to 3** and the letters narrowed from
  11 to 10 columns to pay for it.

The join style was also chosen on looks. Joining E's TOP arm to X's upper
tip (the spec's literal suggestion) makes the E's top arm run straight
into the X's arm as one long bar; putting both connectors on the baseline
instead turns them into a single ligature the word hangs from.

## hexagon-hero

```
line 176 modules (174 pinned + 2 bridges), halo 658
  line satisfaction 100.00%  halo 99.2%  specks 45
  topology components=1 endpoints=0 branch=0 (deg3 0, deg4 0) isolated=0
  span 53/57 = 93.0%  height 37  detours 2
  scans toned8=true toned3=true bw8=true bw3=true  headroom=2
  mask 3 flipSeed 0 flips 22 configs 19/32
  PASS connected (1 component) = 1
  PASS endpoints == 0 = 0
  PASS branch cells == 0 = 0
  PASS isolated == 0 = 0
  PASS span >= 70% of width = 93.0%
  PASS line satisfaction == 100% = 100.00%
  PASS headroom >= 2 codewords = 2
  PASS jsQR toned@8 + toned@3 + bw@8 + bw@3 = {"toned8":true,"toned3":true,"bw8":true,"bw3":true}

geometry     {"cr":28,"cc":28,"W":22,"A":13,"H":18,"d":9,"tipStyle":"out","R":22}
bbox         rows 10-46, cols 2-54
detour       trimmed 9 ideal cells between (24,49) and (32,49), inserted 17
detour       trimmed 9 ideal cells between (32,7) and (24,7), inserted 17
solver       mask 3, flipSeed 0, 766 exact pins, 22 flips, freeDim 1258
decoded      HttPS://hexXyGoN.cOM

  blk0: 7/9 used (2 headroom)
  blk1: 0/9 used (9 headroom)
  blk2: 0/9 used (9 headroom)
  blk3: 0/9 used (9 headroom)
```

## hexagon-v10

```
line 160 modules (160 pinned + 0 bridges), halo 584
  line satisfaction 100.00%  halo 99.8%  specks 35
  topology components=1 endpoints=0 branch=0 (deg3 0, deg4 0) isolated=0
  span 41/57 = 71.9%  height 37  detours 2
  scans toned8=true toned3=true bw8=true bw3=true  headroom=2
  mask 3 flipSeed 0 flips 21 configs 31/32
  PASS connected (1 component) = 1
  PASS endpoints == 0 = 0
  PASS branch cells == 0 = 0
  PASS isolated == 0 = 0
  PASS span >= 70% of width = 71.9%
  PASS line satisfaction == 100% = 100.00%
  PASS headroom >= 2 codewords = 2
  PASS jsQR toned@8 + toned@3 + bw@8 + bw@3 = {"toned8":true,"toned3":true,"bw8":true,"bw3":true}

geometry     {"cr":28,"cc":28,"W":22,"A":13,"H":18,"d":9,"tipStyle":"in","R":22}
bbox         rows 10-46, cols 8-48
detour       trimmed 11 ideal cells between (24,48) and (32,48), inserted 11
detour       trimmed 11 ideal cells between (32,8) and (24,8), inserted 11
solver       mask 3, flipSeed 0, 690 exact pins, 21 flips, freeDim 1334
decoded      HttPS://hExxygOn.cOM

  blk0: 7/9 used (2 headroom)
  blk1: 0/9 used (9 headroom)
  blk2: 0/9 used (9 headroom)
  blk3: 0/9 used (9 headroom)
```

## hexagon-v6

```
line 88 modules (88 pinned + 0 bridges), halo 341
  line satisfaction 100.00%  halo 100.0%  specks 5
  topology components=1 endpoints=0 branch=0 (deg3 0, deg4 0) isolated=0
  span 25/41 = 61.0%  height 21  detours 0
  scans toned8=true toned3=true bw8=true bw3=true  headroom=3
  mask 0 flipSeed 0 flips 19 configs 32/32
  PASS connected (1 component) = 1
  PASS endpoints == 0 = 0
  PASS branch cells == 0 = 0
  PASS isolated == 0 = 0
  FAIL span >= 70% of width = 61.0%
  PASS line satisfaction == 100% = 100.00%
  PASS headroom >= 2 codewords = 3
  PASS jsQR toned@8 + toned@3 + bw@8 + bw@3 = {"toned8":true,"toned3":true,"bw8":true,"bw3":true}

geometry     {"cr":20,"cc":20,"W":12,"A":7,"H":10,"d":5,"tipStyle":"in","R":12}
bbox         rows 10-30, cols 8-32
detour       none
solver       mask 0, flipSeed 0, 389 exact pins, 19 flips, freeDim 539
decoded      htTps://HexXYgon.coM

  blk0: 6/9 used (3 headroom)
  blk1: 0/9 used (9 headroom)
```

## hexword-v10

```
line 140 modules (140 pinned + 0 bridges), halo 707
  line satisfaction 100.00%  halo 100.0%  specks 40
  topology components=1 endpoints=8 branch=10 (deg3 10, deg4 0) isolated=0
  span 41/57 = 71.9%  height 15  detours 0
  scans toned8=true toned3=true bw8=true bw3=true  headroom=3
  mask 0 flipSeed 0 flips 18 configs 32/32
  PASS connected (1 component) = 1
  PASS isolated == 0 = 0
  PASS line satisfaction == 100% = 100.00%
  PASS headroom >= 2 codewords = 3
  PASS jsQR toned@8 + toned@3 + bw@8 + bw@3 = {"toned8":true,"toned3":true,"bw8":true,"bw3":true}

geometry     {"top":32,"bot":46,"h":15,"mid":39,"cH":8,"wH":10,"cE":21,"wE":10,"cX":34,"wX":15,"gap1":3,"gap2":3,"joinStyle":"base"}
bbox         rows 32-46, cols 8-48
detour       none
solver       mask 0, flipSeed 0, 810 exact pins, 18 flips, freeDim 1214
decoded      HtTps://HexxygoN.Com

  blk0: 6/9 used (3 headroom)
  blk1: 0/9 used (9 headroom)
  blk2: 0/9 used (9 headroom)
  blk3: 0/9 used (9 headroom)
```

## hexword-v6

```
line 100 modules (100 pinned + 0 bridges), halo 490
  line satisfaction 100.00%  halo 97.8%  specks 20
  topology components=1 endpoints=8 branch=10 (deg3 10, deg4 0) isolated=0
  span 31/41 = 75.6%  height 11  detours 0
  scans toned8=true toned3=true bw8=true bw3=true  headroom=2
  mask 7 flipSeed 0 flips 27 configs 18/32
  PASS connected (1 component) = 1
  PASS isolated == 0 = 0
  PASS line satisfaction == 100% = 100.00%
  PASS headroom >= 2 codewords = 2
  PASS jsQR toned@8 + toned@3 + bw@8 + bw@3 = {"toned8":true,"toned3":true,"bw8":true,"bw3":true}

geometry     {"top":13,"bot":23,"h":11,"mid":18,"cH":8,"wH":7,"cE":18,"wE":7,"cX":28,"wX":11,"gap1":3,"gap2":3,"joinStyle":"base"}
bbox         rows 13-23, cols 8-38
detour       none
solver       mask 7, flipSeed 0, 506 exact pins, 27 flips, freeDim 422
decoded      hTtpS://hEXxyGoN.CoM

  blk0: 7/9 used (2 headroom)
  blk1: 0/9 used (9 headroom)
```

## hexword-in-hexagon-hero

```
line 265 modules (263 pinned + 2 bridges), halo 925
  line satisfaction 100.00%  halo 99.5%  specks 45
  topology components=2 endpoints=8 branch=10 (deg3 10, deg4 0) isolated=0
  span 53/57 = 93.0%  height 37  detours 2
  scans toned8=true toned3=true bw8=true bw3=true  headroom=2
  mask 3 flipSeed 0 flips 23 configs 19/32
  PASS components <= 2 = 2
  PASS isolated == 0 = 0
  PASS line satisfaction == 100% = 100.00%
  PASS headroom >= 2 codewords = 2
  PASS jsQR toned@8 + toned@3 + bw@8 + bw@3 = {"toned8":true,"toned3":true,"bw8":true,"bw3":true}

geometry     {"hex":{"cr":28,"cc":28,"W":22,"A":13,"H":18,"d":9,"tipStyle":"out","R":22},"word":{"top":33,"bot":42,"h":10,"mid":37,"cH":15,"wH":6,"cE":24,"wE":6,"cX":32,"wX":10,"gap1":3,"gap2":2,"joinStyle":"base"}}
bbox         rows 10-46, cols 2-54
detour       trimmed 9 ideal cells between (24,49) and (32,49), inserted 17
detour       trimmed 9 ideal cells between (32,7) and (24,7), inserted 17
solver       mask 3, flipSeed 0, 1121 exact pins, 23 flips, freeDim 903
decoded      HttPS://hExXyGoN.cOM

  blk0: 7/9 used (2 headroom)
  blk1: 0/9 used (9 headroom)
  blk2: 0/9 used (9 headroom)
  blk3: 0/9 used (9 headroom)
```

## hexword-in-hexagon

```
line 255 modules (255 pinned + 0 bridges), halo 865
  line satisfaction 100.00%  halo 99.8%  specks 41
  topology components=2 endpoints=8 branch=10 (deg3 10, deg4 0) isolated=0
  span 41/57 = 71.9%  height 37  detours 2
  scans toned8=true toned3=true bw8=true bw3=true  headroom=2
  mask 3 flipSeed 0 flips 22 configs 30/32
  PASS components <= 2 = 2
  PASS isolated == 0 = 0
  PASS line satisfaction == 100% = 100.00%
  PASS headroom >= 2 codewords = 2
  PASS jsQR toned@8 + toned@3 + bw@8 + bw@3 = {"toned8":true,"toned3":true,"bw8":true,"bw3":true}

geometry     {"hex":{"cr":28,"cc":28,"W":22,"A":13,"H":18,"d":9,"tipStyle":"in","R":22},"word":{"top":32,"bot":42,"h":11,"mid":37,"cH":15,"wH":6,"cE":23,"wE":6,"cX":31,"wX":11,"gap1":2,"gap2":2,"joinStyle":"base"}}
bbox         rows 10-46, cols 8-48
detour       trimmed 11 ideal cells between (24,48) and (32,48), inserted 11
detour       trimmed 11 ideal cells between (32,8) and (24,8), inserted 11
solver       mask 3, flipSeed 0, 1063 exact pins, 22 flips, freeDim 961
decoded      HTtPS://hexXygon.cOM

  blk0: 7/9 used (2 headroom)
  blk1: 0/9 used (9 headroom)
  blk2: 0/9 used (9 headroom)
  blk3: 0/9 used (9 headroom)
```

## Did the stretch survive?

**Yes, twice — and the hero version is built on the lobed hexagon.**

`out/hexword-in-hexagon-hero.png` puts HEX inside the 93%-span lobed
hexagon; `out/hexword-in-hexagon.png` keeps the earlier chamfered version.
Both are TWO components, deliberately: the spec offered a single travel
segment from the word to the hexagon, but that would put a degree-3 branch
on the one figure whose entire claim is 0 endpoints and 0 branches. The
hexagon component is asserted at 0/0 on its own; the word component
carries all 8 endpoints and all 10 branches.

The route generator returns null if any letter cell is within Chebyshev 1
of any hexagon cell, so a >=1-module white gap between the two figures is
structural rather than eyeballed. That diagonal-touch rule is what bounds
the word, and it is stricter than it looks: a letter corner one cell
diagonally from a slant cell already reads as touching.

### Placement: what was tried

The centre jewel owns rows 25-31, so the word band must sit entirely above
row 25 or below row 31 — it cannot be centred, in either hexagon. Both
halves were built and compared:

| band | result |
|---|---|
| rows 14-24 (above) | word pinned under the top flat, jewel floating in the middle, whole bottom half empty. Shifting it down to rows 13-22 for balance makes the X's top-right corner touch the upper slant diagonally. |
| rows 32-42 (below, the old size) | 11 rows tall but jammed: exactly one clear row between the jewel and the word's top, and the word's halo merged into the bottom flat's. |
| **rows 33-42 (below, 10 rows) — SHIPPED** | 2 clear rows above the word, 3 below it. The jewel reads as a gem set above a label instead of a blob crammed onto it. |

### Size: what the bigger hexagon bought

Less than hoped, and the reason is worth recording. The lobes widen the
figure at rows 24-32, but a word band's binding constraint is its FAR row —
the row nearest a flat, where the slants have closed in. At row 42 the
lobed hexagon's interior is still only cols 14-42, exactly as the chamfered
one is, so the horizontal budget stays at 27 columns either way.

What the lobed shape did buy is VERTICAL room at the bottom of the band,
which is what lets the word move off the jewel: 10 rows at 33-42 with
clearance on both sides, instead of 11 rows at 32-42 with none above. So
the word is one row shorter and considerably better placed, and the gap
between H and E went from 2 columns to 3 (the E-to-X gap stays at 2 —
the X's diagonal falls away from the E immediately, so it reads wider than
it measures). Letters are 6 / 6 / 10 columns; the X is 10x10 so its arms
stay exact 45-degree staircases.

### Halo: 2, not 3

Halo 3 was built and looked at (`7/32` solver configs, still scanning). It
floods: the hexagon's entire lower interior becomes a solid white panel,
the interior texture that makes this piece read as a drawing on noise
disappears, and the composition goes bottom-heavy. At halo 2 the letters
are already unambiguous — checked at 8x and downsampled to 50% — because
the hexagon's own halo contributes to the letters' field. Legibility did
not have to be traded, so it was not.

## Deviations from the spec

1. **Hexagon slants are 63.4 degrees (slope 2), not 60.** A true 60 degree
   edge cannot be a uniform staircase at this scale; the spec's "edges
   must be uniform" and "regular hexagon" are in tension and uniformity
   won. Aspect 0.90 vs a regular hexagon's 0.866.
2. **The v10 hexagon's side vertices are not clean points.** The hero
   encloses each side alignment pattern in a lobe (93.0% span); the purist
   variant chamfers inward with a mirrored 2-column notch (71.9%). A clean
   vertex caps out at 64.9%, below the gate. Derivation above.
3. **v6 hexagon span is 61.0%, below the 70% gate.** Geometry-capped by
   the timing column; every larger v6 hexagon was visibly damaged.
4. **HEX is not vertically centred** (rows 32-46 at v10, not 18-38). The
   centre alignment jewel makes a centred three-letter word impossible.
5. **8 endpoints, not 2.** 11 intrinsic stroke ends minus the 3 consumed
   by the two specified travel segments.
6. **10 branch cells, not ~4.** The extra 6 are the X's crossing, which is
   a 2x3 overlap rather than a point in a 4-connected grid.
7. **Halo widened to 2 (hexagon) / 3 (word)** from piece 12's 1, spent
   directly on legibility. Still >= 2 codewords of headroom everywhere.
8. **Both combos are 2 components**, by choice, to protect the hexagon's
   branch-free gate.
9. **The hero combo uses halo 2 and a 3/2 column gap pair**, not the
   standalone word's 3 and 3/3. Halo 3 floods the hexagon interior; the
   E-to-X gap of 2 reads wider than it measures because the X's diagonal
   immediately falls away from the E. Legibility verified at both 8x and
   50% regardless.

## Deliverables

* `out/hexagon-hero.png` / `.svg` / `-bw.png` / `-route.png`
* `out/hexagon-v10.png` / `.svg` / `-bw.png` / `-route.png`
* `out/hexagon-v6.png` / `.svg` / `-bw.png` / `-route.png`
* `out/hexword-v10.png` / `.svg` / `-bw.png` / `-route.png`
* `out/hexword-v6.png` / `.svg` / `-bw.png` / `-route.png`
* `out/hexword-in-hexagon-hero.png` / `.svg` / `-bw.png` / `-route.png`
* `out/hexword-in-hexagon.png` / `.svg` / `-bw.png` / `-route.png`
* `out/hexword-contact.png` — pre-solve target beside solved result, one row per design.

