# Designing a Goomba Rider level (read this first)

This folder is the whole level-design bench. The game itself is the coop app in
`apps/goomba-rider/` on the shared sim in `packages/shared/src/goomba/`; the
single-player prototype it grew from is deleted (git history has it), so there
is exactly **one copy of the physics and one copy of the levels** —
`packages/shared/src/goomba/levels.ts`. Every tool here bundles that TypeScript
on the fly (`lib.mjs`) and drives the identical code the server scores runs
with. Design happens by editing `levels.ts` and running these tools; playtests
happen on the deployed game by assigning yourself to a team from `/proctor`.

## The party rule (non-negotiable)

**This is a 4-player game, locked. Every level must genuinely REQUIRE 4 bands**
— not merely allow them — or a player gets benched. (A 3-player team has
someone place two; anyone may place remainder bands. Either way, 4 bands go
down.) `minbands.mjs` is the judge: exhaustive at 0–1 bands, sampled at 2–3,
plus your 4-band solution as the upper bound. The structural trick that makes
"requires 4" possible is **state erasure between stages**: poppers and
wall-drops reset her speed, so stages become independent and no single band can
shortcut across them. Off-path snake plants then gate the cake so every stage
must actually be ridden.

## The loop

1. **Sketch in data, not in your head.** Add the candidate level to
   `packages/shared/src/goomba/levels.ts` (its index = position in the array).
   Levels are plain data: `terrain` (polylines; walls are just steep segments),
   `start`, `goal`, and the toys — `plants` (collectibles that lock the cake),
   `pops` (poppers: forced re-launch, erases state), `cushions`, `bumpers`.
   World is portrait-leaning (~110 wide × 200 tall), y is DOWN. Leave
   `solution: []` until you find one.
2. **Trace the bare run**: `node trace.mjs <idx>` — the level must NOT win with
   no bands, and the failure should be legible (a smirk, not a shrug).
3. **Find where bands work**: `node scan.mjs <idx> v|h <spanLo> <spanHi>
   '[fixed]'` sweeps one band across the level and prints outcome windows —
   how you discover the win window for each intended band and its width
   (forgiveness). Aim for windows ≥ ~8 units. `node solve.mjs <idx> [k]` (beam
   search) finds the solutions you did NOT intend — run it at k = 1–3 to hunt
   shortcuts before a player does.
4. **Bake the solution** into the level's `solution` field, then run THE GATE:
   `node verify.mjs <idx>` — one PASS/FAIL over the whole battery (bare fails,
   4-band solution wins, every band load-bearing, finger-slop, exhaustive
   0/1-band, sampled 2/3-band, beam-search shortcut hunt). `--quick` while
   iterating; the full gate before shipping. The individual tools (`test.mjs`,
   `robust.mjs`, `minbands.mjs`) remain for richer diagnostics when a check
   fails.
5. **Look at the ride**: `node ridecards.mjs <outDir> <idx>` renders the level
   with her traced path — Read the PNG. Judge fun by `duration × %airborne`,
   not duration. For live play, open the game with **`?solo`** — the LEVELS
   grid on the in-page sim (no server) — or with **`?debug`** in a real room,
   where tapping a level card jumps the whole room to that level (multiplayer
   playtesting). Scriptable via `window.__goomba`:
   `state() / send({type:'place',...}) / send({type:'play'}) /
   send({type:'goto',level:i})`.
6. **Update what the level makes stale**: the level-count claims in the root
   `README.md` and this folder's docs. A level carries a `name` and nothing
   else prose-wise — there are no hint/description fields, so the title is
   the only text players read; make it earn its place.

## Physics cheat sheet (world units)

- **One silly band stretches to 58 units max.** Ends within 5 units of terrain
  snap onto it (ledge lips/corners win), slightly buried so no tip-bonk.
- **Gravity pulls at 140 u/s²; speed caps at 120 u/s** (some levels raise it
  via `maxSpeed`). Max height anything can gain: ~51 units.
- **Poppers grab her to their center before firing**, set DIRECTION and carry
  arrival speed through (floor: `spd × 0.82`), so launches are exact — use
  them to reset sloppy trajectories mid-level. Trigger radius ~8.
- **Fast lips throw flat.** Off a lip at speed she travels far horizontally;
  don't put a floor 25–45 units below a fast lip unless you want her to land
  on it bare.
- **Steep catch bands** work when placed *below* the flight path; bands
  *starting at the lip* need slope ≲ 1 or she sails over.
- **Walls are bumpers**: hitting one kills horizontal speed dead (good for
  switchbacks — drop her onto a slope going back the other way).
- **V-basins catch everything** that falls into them — great for goals, fatal
  for "she must not land here" zones. The stuck detector fails a run that
  stops making progress (~4 s).

## Design notes: what the sim taught us

Findings from brute-forcing the solution space (`minbands.mjs`). These are
physics facts about this game, not opinions — each came from a level that
failed a check.

**The universal shortcut is "long fall + one catch band."** If the cake sits at
the bottom and the start at the top, gravity does all the work and a single
band near the goal wins. Grand Finale shipped as a 3-band level and had 380
one-band solutions. Anything that descends toward its goal has this problem.

**The second shortcut is "extend the start ramp."** A band laid along the
opening slope just buys speed, and speed clears gaps that were supposed to
need bridging. Any level where *more speed helps* can be trivialized this way.

**Poppers are the antidote, because they erase state.** A popper redirects at a
known speed, so nothing upstream changes what happens downstream. That makes
stages independent, which is precisely what forces one band per stage. Poppers
aren't decoration — they're the structural tool for multiplayer levels.

**But a popper must fire *away* from the band that feeds it.** Launch back
across the band she just rode and she immediately re-collides with it. Give the
popper ~12 units of drop below the feeding band's end, or aim it to continue
her direction.

**The zigzag problem, solved by making the players build the walls.** A one-way
popper staircase drifts too wide to stay portrait; a zigzag needs a reverser,
and the only robust reverser is a wall. The Popper Grid (the finale) lays four
horizontal lanes of forced poppers, aimed in alternation like a 2D line maze,
dense enough (16 units apart vs the ~8-unit trigger radius) that crossing a
lane always gets her grabbed and re-flung. Bands can't help her travel — the
players' only verb is to *wall* a lane: she rebounds off the band (band
restitution ≈ .32 kills most of her speed), drops one popper back, falls
through the gap into the lane below, which runs the other way. Each lane needs
its own wall — `minbands.mjs` confirms no 1/2/3-band set wins. Two tuning
facts that made it work: the entry chute needs a wall to kill her ramp speed or
she flies over the first lane, and a wall placed *before* a lane's plant
strands the run — that's what makes it a maze instead of four free choices.

**Judge the ride in airborne seconds, not duration.** Across two review rounds,
`duration × %airborne` predicted the fun ranking almost perfectly; raw duration
predicted nothing. Lengthening the boring part is metric-gaming.

**A collectible on the line she'd fly anyway is a chime, not a constraint.**
Plants only create routing pressure when they're *expensive* — off the greedy
path, costing speed or height or another plant. (An early draft hung plants a
few units under each bridge line — the beam search disproved it; see
shelf-gating below for why in-gap collectibles never survive scrutiny.)

**Collectibles beat geometry for forcing multi-band.** Scattered snake plants
make the cake a *routing* problem instead of a reachability one: one band can
drop her down a shaft, but it can't make her pass three separate points.

**Shelf-gating — the switchback pattern (Mind the Gap).** Floors alternating
direction, a band-sized gap in each, walls between floors erasing her speed.
What makes it honestly need one band per floor is WHERE the collectibles sit:
**on the far shelves between gap and wall, never hanging in the gaps**. A
plant in a gap can be grazed by anything flying through it — the beam search
found both a diagonal launcher band that overflew a whole floor through its
gap, and an under-floor band that dropped her down a column past a lower
plant. A shelf, by contrast, has solid floor directly above (no fall reaches
it) and sits 40+ units above the next corridor (beyond the ~34 units of rise
a speed-capped launch can buy — check this number when changing the pitch),
so the only way onto it is across its gap. Two supporting facts: floors
shallower than ~0.12 strand her (the idle pump fights the slope and she creeps
into a stall), and a short uphill shelf before each lip pins bare lip speed to
~24, which no 42-unit gap forgives.

**One deterministic launch is a spine (Pachinko Drop).** A popper's fire is
exact, so a whole level can hang off a single parabola: rows placed so the
BARE arc misses them by a few units, with a catch band whose only job is that
nudge. Hard-won mechanics from building it: an entry ledge even **+1 above**
the lip facing it is unjumpable (arcs only fall — check the fastest
band-ramp arrival still lands short), but the crossing band SAGS ~1 per 20
units, so the rider needs lip speed ≳ √(280·(rise+sag)) or she oscillates
trapped in the sag valley; a floor ending nearer than ~5 units to a wall
makes a wedge notch she stalls in (end floors ≥6 short of walls so she falls
through); and a feed band that delivers her straight under a vertical fire
gets smashed by it — angle the fire or end the feed outside the barrel line.

**Anti-shortcut devices that do work:**
- **Roofed pocket** — cake in a pocket with a ceiling, so falling arrivals are
  blocked and the only entry is horizontally through the mouth.
- **Ceiling over a run** — caps how high she can arc, so extra speed can't
  skip a gap.
- **Goal above the start** — falling can never reach it.
- **Speed governor** — a short gentle shelf just below a wall-drop; at ~15
  speed even a 20-unit gap is uncrossable.

**Useful numbers:** gaps wider than ~45 units aren't jumpable at typical speed,
and a band only spans 58 — so the "needs exactly one band" window is roughly
45–58 units, and it widens a lot if you slow her down first. Two segments
closer than ~4.4 units (2 × her radius) wedge her in a corner and stall the
run.

## Sharing the result

Ship the level in `levels.ts`, verified, and note that live rooms restore
saved state — `GoombaSim.restore` clamps a stale level index and re-sizes the
`completed` array, so a deploy that adds or removes levels is safe for rooms
mid-run. If the user asked for an *idea* rather than code, still build it — a
traced ride card is worth more than prose — and show the PNG.
