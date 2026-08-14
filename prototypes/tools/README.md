# Goomba Rider level QA tools

Headless harnesses that drive the real game in Chromium and call `window.__gr.simulate`,
so they always test the shipped physics — no duplicated engine to drift out of sync.

```sh
cd prototypes/tools
node test.mjs          # every level: must FAIL bare, WIN with its solution
node robust.mjs        # drop-one-band test + ±3-unit finger-slop tolerance
node minbands.mjs [i]  # how many bands a level ACTUALLY needs (see below)
node searchall.mjs     # solution-space tightness: how many placements win, how many families
node search.mjs 2      # same, one level, with the winning families listed
node trace.mjs 4 '[[[10,20],[40,30]]]'   # dense trajectory dump, for placing geometry
node scan.mjs 9 v 34 60 '[fixed bands]'  # sweep ONE band across the level → win windows
node solve.mjs 9       # beam-search auto-solver: finds the shortcuts you didn't intend
node arc.mjs 94 200 -115 118 164          # popper ballistics: where the arc lands
node diag.mjs 3        # failure modes of jittered placements
node ridecards.mjs out/ [i...]            # PNG of a level with her traced ride
```

Designing a new level end-to-end (for humans and Claude threads alike) is walked
through in [`DESIGNING.md`](./DESIGNING.md): sketch in `LEVELS`, trace bare, `scan`
for the win windows, bake the solution, then test/robust/minbands/ridecards.

They import Playwright by absolute path (`/opt/node22/lib/node_modules/playwright`) —
adjust that line if your install lives elsewhere.

## Why `minbands.mjs` matters most

`test.mjs` only proves *your* solution works. It does **not** prove the level needs that
many bands. `minbands.mjs` brute-forces every legal single-band placement (exhaustive on
a 10-unit grid) and randomly samples 2- and 3-band sets, then reports the true minimum.

This caught a real bug: Grand Finale shipped as a "3-band" level and was solvable **380
different ways with one band** — a long fall plus one catch band near the goal bypassed
the whole zigzag. The drop-one-band test had passed, because each of *my* three bands was
load-bearing; that says nothing about a completely different lone band.

**The middle levels (2–9) all have a minimum of 1.** Their band budgets are therefore an allowance
("use up to N"), not a requirement. **The bookends are the exceptions**: Mind the Gap (level 1) provably needs its 2 bridge bands, and **The Popper Grid (level 10)**: no
0/1-band placement wins exhaustively, no 2/3-band sample wins in 50k tries, and the
4-band solution does — the first level where a 4-player team genuinely needs all four
hands. The trick is forced popper lanes that erase her state, so no band can help her
*travel* — only wall her into the lane below. See the design notes in
`../goomba-rider-levels.md`.
