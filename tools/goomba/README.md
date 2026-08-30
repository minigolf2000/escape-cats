# `tools/goomba/`

Three commands and a bridge, plus a reader in `figma/`. **None of them evaluate
a level** — that is what
playing it is for, and [`DESIGNING.md`](./DESIGNING.md) is the design guidance
that came out of doing so.

```sh
node seed.mjs --pull                   # what is this event running right now?
node seed.mjs --pull > pack.json       # …save it (gitignored; some tools read it)
node seed.mjs --push --file pack.json  # move a pack into another event
node test-codec.mjs                    # the save format: a link round-trips, old links still decode
node bands.mjs                         # the room hands out 4 bands and rations nobody
node figma/read-frame.mjs --nodes f.json  # a Figma frame in the units the physics uses
```

`lib.mjs` is the bridge the three share: it bundles
`packages/shared/src/goomba/` with esbuild on the fly, so nothing here carries a
second copy of the codec, the pack rules or the room sim.

`figma/` is the way IN — the design kit, the naming contract, the clipboard
reader's tests, `levels-to-svg.mjs`, which draws a pack as one artboard per
level, and `read-frame.mjs`, which goes the other way and prints a frame in
world units (a reader, not a grader). It has [its own README](./figma/README.md) and that is where a level
actually starts.

## Two things the deleted bench took with it

A simulation bench used to live here — `verify.mjs` (**THE GATE**, a PASS/FAIL
battery a level had to clear) and twelve other commands, plus the `gate.ts`
thresholds. All deleted, along with the **4-band rule** it enforced: four people
around a table found what mattered faster, and said *why*. Git history has it.

- **A level's `solution` is gone**, the field and the bytes both. It was the
  baked answer key the gate graded against. Removing it cost a codec version
  (fmt 2) because `nSolution` sat unconditionally in the MIDDLE of the layout —
  see the header of `codec.ts`. Old links still decode; a new link is ~10%
  shorter and an older bundle refuses it outright rather than misreading it.
- **`bands.mjs` is not part of that.** It tests SHIPPED code: that the room hands
  out exactly `MAX_BANDS` and puts no conditions on who lays or lifts them, which
  is a product decision ("A may lay all four while B, C and D watch") that should
  fail a test rather than surprise a party. It carries its own throwaway board.

## An `<idx>`, where one still appears

Only `figma/levels-to-svg.mjs` indexes levels now, and the index is a position
in the pack it loaded. There are no levels in this repo to index — a level's
source is its Figma frame, and an event's levels live in its lobby — so point it
at a pack: `--pack <file>`, `GOOMBA_PACK=<file>`, or a `pack.json` in this
directory, which is picked up with no flag at all. With no pack it says so and
exits 2.
