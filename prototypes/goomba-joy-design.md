# Goomba's Joy — Design Notes

A third Escape Cats concept (after Hex Clicker and the reveal work): a
**deterministic side-view auto-climber puzzle**. Goomba the cat auto-walks and
climbs walls; the player never moves her directly — they **place items that bend
her path** so she collects enough JOY to fill a bar.

Playable prototype: [`goomba-joy.html`](./goomba-joy.html).

Everything here is **OPEN / exploratory** — this is a feel prototype to decide
whether the core loop is fun before committing anything. Nothing is locked.

_Last updated: 2026-07-08._

## The core loop

**Place → predict → commit → watch.** You drop items on the grid; a dashed
**ghost path** shows Goomba's entire predicted route and rings the joy she'll
collect; when the projection reads "full," you hit go and watch her run it. The
satisfaction is the same as The Incredible Machine / Opus Magnum: *set up the
board, press play, watch the machine work.*

## Locomotion (the deterministic rule)

Descends from the repo's **salad-cat** prototype (auto-run + wall-climb):

- She walks in her facing direction at constant speed.
- **Hits any wall → she climbs it**, tops out onto the ledge, and keeps walking.
- **Walks off a ledge → she falls** (with a little forward drift), then resumes.
- **Launched (spring/ramp) → ballistic arc**, then lands and resumes walking.
- Reaching the **top of the level** ends the run (she naps on the windowsill).
- No randomness: her path is a pure function of `(level, placements)`, so a
  ghost can predict it exactly and — crucially for coop — every phone shows the
  identical run with zero position traffic (same trick as the mouse reveal).

The whole point of choosing this rule: it's a **one-sentence, fully predictable**
movement model. Predictability is what makes a place-then-run puzzle fair.

## Item catalog (how each bends her path)

Shipped in the prototype:

| Item | Effect on Goomba | Teaches |
| --- | --- | --- |
| **Spring** | Launches her straight-ish up in an arc (the vertical tool) | Level 1 |
| **Sign** | Flips the direction she faces when she steps on it (redirect) | Level 2 |

Designed, not yet used in a level (the sim already supports them):

| Item | Effect on Goomba |
| --- | --- |
| **Ramp** | Launches her in a forward arc — clears gaps / lands on far ledges |
| **Block** | A solid tile you place — build steps, walls to climb, or bridges |

Candidate items for later (not built):

- **Catnip lure** — she deviates toward it, then it's consumed (soft steering).
- **Cushion** — a wall she *won't* climb; she turns instead (a soft blocker).
- **Fan / updraft** — sustained upward push through a column.
- **Cat door / tunnel** — teleports her across the grid (salad-cat had this).
- **Scratching post** — she pauses to scratch (grants joy, buys timing).

## Levels in the prototype

1. **First Steps** — teaches the spring. She gets two floor treats on her own;
   one spring bounces her to the third. (Verified: 2/3 default → 3/3 solved.)
2. **Switchbacks** — teaches the sign. A spring + a sign chain her back across
   the room: bounce for the mid treat, grab the right treat, flip left, climb
   the far wall to the high treat. (Verified: 2/4 default → 4/4 solved.)

Both were tuned headlessly (`scratchpad/sim.js` + a path-printing harness)
before any UI existed — hand-authored auto-mover levels never behave the way you
imagine until you simulate them.

## How it fits the series

- **Reuses the deterministic-sim spine.** Goomba's app is already server-
  authoritative; a grid/kinematic sim is far simpler than its Matter.js physics,
  and determinism gives free lockstep across four phones.
- **Coop via asymmetric tools.** Give each of the four players a different
  placeable (one holds springs, one signs, one ramps, one blocks) on a shared
  board — nobody can solve alone, so planning happens out loud. Same forced-
  discussion goal as Hex Clicker's golden mouse, native to the puzzle here.
- **No-fail.** A short run that doesn't fill the bar just invites a tweak-and-
  retry; instant reset. Consistent with Angry Goomba's "no failure, no limits."
- **The reveal.** TBD — the filled joy bar is the obvious place to hang the code
  word (e.g. the final level's solved path spells or unlocks it).

## Open questions

- **Movement model** is provisional — this is the heading-based climber. Worth
  A/B-ing against slide-until-wall or attract/repel before locking.
- **Reach-the-top vs pure joy-threshold** as the end condition (currently: run
  ends at the top OR a time cap; success = enough joy).
- **How much structure is fixed vs player-built** — these levels are sparse and
  lean on player placements; some may prefer denser fixed geometry.
- **Ghost transparency** — the ghost currently reveals the full route and the
  joy count. Cozy and fair, but removes suspense; a "path-only, hide the count"
  mode would make it more of a puzzle.
- **Item budget vs open sandbox** — scarcity (few items) is where the puzzle
  lives; too generous and it's a toy. Needs playtest tuning.
