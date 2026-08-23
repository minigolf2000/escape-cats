# Goomba Glider level QA tools

Node harnesses over the SHIPPED physics: `lib.mjs` bundles
`packages/shared/src/goomba/` (the sim the room server scores runs with and
every phone animates) and exposes `simulate`, so there is no second engine to
drift out of sync — and no browser in the loop, which makes these ~100× faster
than the Playwright rigs they replaced. Only `ridecards.mjs` launches Chromium,
and only to rasterise an SVG.

Designing a level end-to-end is walked through in
[`DESIGNING.md`](./DESIGNING.md) — start there.

There is also a browser half: the game's own **level selector**, reached with
`\` from inside Goomba Glider. It is where a Figma frame is pasted in, where the
event's pack is reordered and pruned, and where every level shows its cheap
verdict (bare must NOT win, the solution must) on a card. A level saves as a
URL, which is why `verify.mjs` grew `--hash`: a level can be finished, shared
and gated before it is ever a diff — and a PACK is just an ordered list of
those links, living in the lobby Durable Object rather than in this repo. Use
`node seed.mjs --pull` to fetch what an event is actually running.

```sh
cd tools/goomba
node verify.mjs 0      # THE GATE: full PASS/FAIL battery for one level (--quick to iterate)
node verify.mjs all    # verdict per level (levels predating the 4-band rule fail: known debt)
node verify.mjs --hash <editor link>   # same gate, on a level that is still just a URL
node verify.mjs --file team3.links     # same gate, on a file of them (the editor's tray)
node bands.mjs         # THE OTHER GATE: the room's band budget — 4, and no rule about whose
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

Every level is locked to 4 bands (see DESIGNING.md). Its room-side half —
4 bands for the room and no per-player quota, so anyone may lay or lift any of
them — is enforced in the shared sim and gated by `bands.mjs`. Only geometry can
make a level *need* four bands, so the level gate below does the load-bearing
work: with nobody rationed, a level that wins on one band is a level three
people watch.
Four levels ship. TWO pass the full gate — The Long Way Up (2) and Cat's
Cradle (3) — and the others are the standing rebalance debt: they win with
fewer than 4 bands. Freshly measured, not inherited: The Long Way Down (1)
needs 3.
Slalom was cut when `MAX_SPEED` became one game constant at 145: it was built
against the old 120, and at the faster cap `solve.mjs 2 4` finds no solution at
all. It was already debt (3 bands, short of the 4-band rule), so it was retired
rather than shipped dead.
Level 1 joined that list deliberately: it was rebuilt to a hand sketch whose
silhouette cannot carry a 4th gate (see DESIGNING.md on why no can placement
fixes it), replacing Four Ways to Help, which passed.
The Long Way Up (2) took Pop Goes Goomba's slot in the roster (the only level
that truly collapsed to a single band, 196/8738 exhaustive — now cut): a
concave-up slope she rides from the bottom-left to a launcher at the top right,
poppers shooting her along it, three long rough steps notched PERPENDICULAR
into it (the players chord across each one), then a bumper that mirrors her
into a flat run home across three cans and a wall at the end of that run to
drop her in the pot. Its band ends are the reason it survives fingers: every
one sits on a notch rim ~9 units clear of its neighbours, so snap eats the slop
(jitter 29/30 at ±3u) even though the flight itself is a chain of exact
ballistics. That is the general fix for a precision-fragile board, and it
outlived Space Cadet, which was cut before anyone applied it.
Cat's Cradle replaced The Popper Grid: four
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
There and Back Again (4) grew from a hand sketch over several rounds, finished by
hand in the editor. It is the closest thing here to a third passing level:
bare fails, all three bands load-bearing with three different deaths, every
band in-bounds and under BAND_MAX, and finger slop 22/30 against a threshold
of 18 — the best score any board here has managed with a bumper in the loop.
Its fourth can, at (13,54), is a toll booth on the ↙ popper's throw arc: the
only way to collect it is to be thrown by that popper, which is what stops a
winning line threading past it. It cost seven trials of slop (29/30 → 22/30)
to make that popper compulsory.
The only gate it fails is the 4-band rule, at 3 bands rather than 4; the two
stages that still carry themselves (the bare feed chain hands her the
far-right can, and the up-column self-chains) are where geometry would have to
go to force a fourth.

Its ↙ return popper is worth reading about in `levels.ts` before moving
anything: the same popper, at the same 135° aim, was a working return at one
position, a run-killer 20 units left of it, and a working return again once
the LANDING popper moved to meet the throw. What matters is whether an aim has
room downrange, which is not visible in the picture.
