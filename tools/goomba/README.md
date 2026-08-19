# Goomba Glider level QA tools

Node harnesses over the SHIPPED physics: `lib.mjs` bundles
`packages/shared/src/goomba/` (the sim the room server scores runs with and
every phone animates) and exposes `simulate`, so there is no second engine to
drift out of sync — and no browser in the loop, which makes these ~100× faster
than the Playwright rigs they replaced. Only `ridecards.mjs` launches Chromium,
and only to rasterise an SVG.

Designing a level end-to-end is walked through in
[`DESIGNING.md`](./DESIGNING.md) — start there.

There is also a browser bench: the **level editor** at `/editor/`
(`apps/goomba-editor`, :5179 in dev). It drags geometry against this same
shipped sim, grades the cheap half of the gate on every edit, hunts shortcuts in
background workers, and saves a level into its own URL. That last part is why
`verify.mjs` grew `--hash`: a level can be finished, shared and gated before it
is ever a diff.

```sh
cd tools/goomba
node verify.mjs 0      # THE GATE: full PASS/FAIL battery for one level (--quick to iterate)
node verify.mjs all    # verdict per level (levels predating the party rule fail: known debt)
node verify.mjs --hash <editor link>   # same gate, on a level that is still just a URL
node verify.mjs --file team3.links     # same gate, on a file of them (the editor's tray)
node quota.mjs         # THE OTHER GATE: the room's per-player band quota, ceil(4/n)
node test.mjs          # every level: must FAIL bare, WIN with its solution
node robust.mjs        # drop-one-band test + ±3-unit finger-slop tolerance
node minbands.mjs [i]  # how many bands a level ACTUALLY needs (see below)
node reach.mjs 0 3     # could ANY can placement force a 4th band? (often: no)
node searchall.mjs     # solution-space tightness: how many placements win, how many families
node search.mjs 2      # same, one level, with the winning families listed
node trace.mjs 4 '[[[10,20],[40,30]]]'   # dense trajectory dump, for placing geometry
node scan.mjs 7 v 34 60 '[fixed bands]'  # sweep ONE band across the level → win windows
node solve.mjs 7 3     # beam-search auto-solver: finds the shortcuts you didn't intend
node arc.mjs 94 200 -115 118 164          # popper ballistics: where the arc lands
node diag.mjs 3        # failure modes of jittered placements
node ridecards.mjs out/ [i...]            # PNG of a level with her traced ride
```

`ridecards.mjs` imports Playwright by absolute path
(`/opt/node22/lib/node_modules/playwright`) — adjust that line if your install
lives elsewhere. Everything else is dependency-free beyond the repo's own
`esbuild`.

## Why `minbands.mjs` matters most

`test.mjs` only proves *your* solution works. It does **not** prove the level
needs that many bands. `minbands.mjs` brute-forces every legal single-band
placement (exhaustive on a 10-unit grid) and randomly samples 2- and 3-band
sets, then brackets the true minimum with the intended solution as the upper
bound.

This caught a real bug: Grand Finale shipped as a "3-band" level and was
solvable **380 different ways with one band** — a long fall plus one catch band
near the goal bypassed the whole zigzag. The drop-one-band test had passed,
because each of *my* three bands was load-bearing; that says nothing about a
completely different lone band.

The party rule is locked at 4 players × 4 bands per level (see DESIGNING.md).
Its room-side half — nobody holds more than ⌈4/n⌉ bands, so a full team is one
each — is enforced in the shared sim and gated by `quota.mjs`; that cap stops
one player hoarding, but only geometry can make a level *need* four bands, so
the level gate below still does the load-bearing work.
Six levels ship. One passes the full gate — The Popper Grid (6) — and levels
1-4 are the standing rebalance debt: they win with fewer than 4 bands.
Freshly measured, not inherited: The Long Way Down (1) needs 3, Watering Can
Slalom (2) needs 3 (0/10325 at one band, exhaustive), Piñata Alley (3) needs
2, and only Pop Goes Goomba (4) truly collapses to 1 (195/8738, exhaustive).
Level 1 joined that list deliberately: it was rebuilt to a hand sketch whose
silhouette cannot carry a 4th gate (see DESIGNING.md on why no can placement
fixes it), replacing Four Ways to Help, which passed.
The blanket "levels 3-8 collapse to 1 band" this file used to carry was
stale for two of its members. (The Skim, The Puzzle Box and Pillow Fort were
cut, and Mind the Gap, which passed, was cut with them. Level numbers are
array index + 1, so those removals renumbered everything after them.)
Space Cadet (5) has been rebuilt as a pinball
machine with five cans: `minbands` finds no ≤3-band win (exhaustive at 1
band, 0/50000 sampled at 2-3), its 4-band solution wins with every band
load-bearing, and what keeps it out of the passing list is now the ±3u
finger-slop check (0/30) — five chained ballistic hand-offs, each tolerating
only a few units, with nothing re-centering her between stages. Its debt is
precision, not collapse; the suspected fix is funnel geometry between stages
(poppers erase speed, only V-basins erase position).
