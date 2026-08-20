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
node route.mjs 3 drop  # the RIDE as a chain of poppers/cans/bands — and its four deaths
node slack.mjs 3       # per-band forgiveness: which band a real finger loses the run on
node scan.mjs 3 v 34 60 '[fixed]' --step 1   # sweep ONE band → win windows (2u by default)
node solve.mjs 3 3     # beam-search auto-solver: finds the shortcuts you didn't intend
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
Seven levels ship. TWO pass the full gate — The Long Way Up (2) and Cat's
Cradle (5) — and the others are the standing rebalance debt: they win with
fewer than 4 bands, or lose a real finger. Freshly measured, not inherited: The
Long Way Down (1) needs 3, Watering Can Slalom (3) needs 3 (0/10325 at one
band, exhaustive), and Piñata Alley (4) needs 2.
Level 1 joined that list deliberately: it was rebuilt to a hand sketch whose
silhouette cannot carry a 4th gate (see DESIGNING.md on why no can placement
fixes it), replacing Four Ways to Help, which passed.
The Long Way Up (2) took Pop Goes Goomba's slot in the roster (the only level
that truly collapsed to a single band, 196/8738 exhaustive — now cut): a
concave-up slope she rides from the bottom-left to a launcher at the top right,
poppers shooting her along it, three long rough steps notched PERPENDICULAR
into it (the players chord across each one), then a bumper that mirrors her
into a flat run home across three cans and a wall at the end of that run to
drop her in the pot. It also answers Space Cadet's open question — see below —
because every one of its band ends sits on a notch rim ~9 units clear of its
neighbours, so snap eats the finger slop (jitter 29/30 at ±3u) even though the
flight itself is a chain of exact ballistics.
Cat's Cradle took position 5 from The Popper Grid, which it replaced: four
DENSE lanes of six poppers 16 apart, an entry chute and a V-basin (git history
has the geometry). It keeps that level's structure and the finding behind it,
sparser and sketched from scratch — three poppers a lane, 24 apart so their
reaches never touch, lanes interlocked half a step, and no terrain at all. It
is the more robust of the two: finger slop 30/30 where the dense original
managed 21/30, and ~95% on three unrelated seeds.
The blanket "levels 3-8 collapse to 1 band" this file used to carry was
stale for two of its members. (The Skim, The Puzzle Box and Pillow Fort were
cut, and Mind the Gap, which passed, was cut with them. Level numbers are
array index + 1, so removals and insertions renumber everything after them.)
Space Cadet (6) has been rebuilt as a pinball
machine with five cans: `minbands` finds no ≤3-band win (exhaustive at 1
band, 0/50000 sampled at 2-3), its 4-band solution wins with every band
load-bearing, and what keeps it out of the passing list is now the ±3u
finger-slop check (0/30) — five chained ballistic hand-offs, each tolerating
only a few units, with nothing re-centering her between stages. Its debt is
precision, not collapse; the fix direction is now known — anchor every band
end on a terrain vertex the way level 2 does, so snap absorbs the slop before
the physics sees it — with funnel geometry between stages as the fallback
(poppers erase speed, only V-basins erase position). `node slack.mjs 5` now
names the culprits instead of leaving them as prose: band2, the 6-unit C-bend,
survives jitter 16% of the time inside a 2-unit window; bands 0 and 1 have
2- and 4-unit windows; and band3 sits 9 units off-centre in an 18-unit window,
which is free robustness nobody had measured.
Up the Middle (7) grew from a hand sketch over several rounds, finished by
hand in the editor. It is the closest thing here to a third passing level:
bare fails, all three bands load-bearing with three different deaths, every
band in-bounds and under BAND_MAX, and finger slop 29/30 against a threshold
of 18 — the best score any board here has managed with a bumper in the loop.
The only gate it fails is the party rule, at 3 bands rather than 4; the two
stages that still carry themselves (the bare feed chain hands her the
far-right can, and the up-column self-chains) are where geometry would have to
go to force a fourth.

Its ↙ return popper is worth reading about in `levels.ts` before moving
anything: the same popper, at the same 135° aim, was a working return at one
position, a run-killer 20 units left of it, and a working return again once
the LANDING popper moved to meet the throw. What matters is whether an aim has
room downrange, which is not visible in the picture.
