# Designing a Goomba Rider level (read this first)

This is the doc for anyone — human or Claude thread — asked something like *"design a
pachinko level with 3 snake plants and a popper in the middle"*. The game is
`../goomba-rider.html` (single file, no build); these tools drive the real shipped
physics headlessly. Two companion docs are required reading, they're short and they're
accumulated playtest truth:

1. [`../goomba-rider-levels.md`](../goomba-rider-levels.md) — physics cheat sheet +
   anti-shortcut design notes (what the sim taught us).
2. [`README.md`](./README.md) — what each QA tool proves, and why `minbands.mjs` matters.

## The party rule (non-negotiable)

**This is a 4-player game, locked. Every level must genuinely REQUIRE 4 bands** — not
merely allow them — or a player gets benched. (A 3-player team has someone place two;
anyone can place remainder bands. Either way, 4 bands go down.) `minbands.mjs` is the
judge: exhaustive at 0–1 bands, sampled at 2–3, plus your 4-band solution as the upper
bound. The structural trick that makes "requires 4" possible is **state erasure between
stages**: poppers and wall-drops reset her speed, so stages become independent and no
single band can shortcut across them. Off-path snake plants then gate the cake so every
stage must actually be ridden.

## The loop

1. **Sketch in data, not in your head.** Add the candidate straight into the `LEVELS`
   array in `goomba-rider.html` (its index = position in the array). Levels are plain
   data: `terrain` (polylines; walls are just steep segments), `start`, `goal`, and the
   toys — `plants` (collectibles that lock the cake), `pops` (poppers: forced re-launch,
   erases state), `cushions`, `bumpers`. World is portrait-leaning
   (~110 wide × 200 tall), y is DOWN. Leave `solution: []` until you find one.
2. **Trace the bare run**: `node trace.mjs <idx>` — the level must NOT win with no
   bands, and the failure should be legible (a smirk, not a shrug).
3. **Find where bands work**: `node scan.mjs <idx> v|h <spanLo> <spanHi> '[fixed]'`
   sweeps one band across the level and prints outcome windows — how you discover the
   win window for each intended band and its width (forgiveness). Aim for windows
   ≥ ~8 units. `node solve.mjs <idx> [budget]` (beam search) finds the solutions you
   did NOT intend — run it at budgets 1–3 to hunt shortcuts before a player does.
4. **Bake the solution** into the level's `solution` field, then verify:
   - `node test.mjs` — every level fails bare, wins with its solution.
   - `node robust.mjs` — every solution band load-bearing; survives ±3-unit finger slop.
   - `node minbands.mjs <idx>` — the honest minimum. It must be 4 (or the bracket
     verdict "no smaller set found + the 4-band solution wins").
5. **Look at the ride**: `node ridecards.mjs <outDir> <idx>` renders the level with her
   traced path — Read the PNG. Judge fun by `duration × %airborne`, not duration.
   Screenshot real play on a 390×844 viewport by driving the live game via
   `window.__gr`: `skipTitle() / goto(i) / place(bands) / play() / state()`.
6. **Update what the level makes stale**: level count + names in
   `../README.md`, design-note claims in `../goomba-rider-levels.md` and `README.md`,
   and give the level a `hint` and `hint2` (hint2 appears after 3 failed runs).

## Design vocabulary that already works (steal these)

- **Plants force routing**: one band can reach a place; it can't make her pass several
  scattered points. Put plants OFF the greedy path — a plant she'd hit anyway is a
  chime, not a constraint. A plant ~5 units under a bridge line is collected by riding
  the band but missed by any ballistic arc.
- **Poppers erase state** → stages become independent → one band per stage. Dense
  same-direction popper rows become one-way lanes (see The Popper Grid): the player's
  only verb is to WALL her so she rebounds and drops a lane. 16-unit spacing vs the
  ~8-unit trigger radius leaves no crossable seam.
- **Walls kill horizontal speed dead** — the other state-eraser, and the only robust
  direction-reverser (switchbacks: wall, drop, slope running the other way).
- **V-basins catch everything; roofed pockets refuse falling arrivals; ceilings cap
  speed-skips; a short flat shelf before a lip is a speed governor.**
- A band spans 6–58 units; ends within 5 units of terrain snap onto it (vertices win).
- Gaps: >45 unjumpable at typical speed, ≤58 bridgeable by one band. Two segments
  closer than ~4.4 units wedge her; keep wall bottoms well clear of floors.

## Sharing the result

Push the level in `LEVELS`, verified. If the user asked for an *idea* rather than code,
still build it — a traced ride card is worth more than prose — and show the PNG.
