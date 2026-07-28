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
node arc.mjs 94 200 -115 118 164          # popper ballistics: where the arc lands
node diag.mjs 3        # failure modes of jittered placements
```

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

**Every level in the current set has a minimum of 1.** Band budgets are therefore an
allowance ("use up to N"), not a requirement. Forcing a level to need exactly 4 bands —
which the party version needs, so no player is benched — is an open design problem; see
the design notes in `../goomba-rider-levels.md`.
