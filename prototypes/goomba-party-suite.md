# Goomba Rider party suite — 2/3/4-player puzzles, one mechanic at a time

The party suite is 45 levels: **5 nonstandard mechanics × 3 escalating
difficulty tiers × 2P/3P/4P variants**, every level using exactly ONE toy
(pillows, balloons, piñatas, poppers, or snake plants) plus terrain and
bands. Player count = band budget = bands *genuinely required*: the
verification harness proves no smaller band set wins, so nobody at the
table gets benched.

Play them: ⚙ → **🎉 party pack** in `goomba-rider.html` (loads
`goomba-party-levels.json`, browse in the 🔬 lab). Rebuild/verify with the
tools in `tools/` (see "Pipeline" below).

## How "min bands == players" was cracked

`goomba-rider-levels.md` called forcing a level to need exactly N bands an
open design problem. The answer that survived the harness is **velocity
normalization between stages**: every stage ends in a passage where a wall
kills her horizontal speed and a short drop (chute, duct, or jog kicker)
re-verticalizes her. Whatever the players did upstream, she enters the next
stage in the same state — so no band can do another band's job. The
two-chamber prototype has **zero** winning single-band placements out of
10,799 grid candidates; every shipped level passes the same exhaustive
check (plus randomized and beam-directed multi-band cheat hunts).

Three normalizers are used:
- **drop chute** — she flies through a floor gap, hits the far wall, falls
  clean (cushion, popper)
- **jog kicker** — a slab under the slot slides her to the outer wall
  before the next room (bumper, needle chambers). Kicker tips must end
  ≥ 6 units from walls: her diameter is 4.4 and she wedges in anything
  tighter (found the hard way)
- **sealed duct** — window → duct → kicker; no line of sight between
  stages at all (updraft)

## The families

| mechanic | tier 1 | tier 2 | tier 3 |
| --- | --- | --- | --- |
| cushion | **Bounce House** — tilt each boing out the floor gap | **Pillow Parkour** — a fin guards every gap; arc over it | **Needle Threader** — center slot, twin fins, stalactite overhead |
| updraft | **Balloon Bellows** — lay a rail; she skims its underside into a low window | **Organ Pipes** — taller rooms, meaner windows behind a sill lip | **Air Pockets** — dead-air gap mid-lift; she sags crossing it |
| bumper | **Piñata Practice** — ramp her in hard, ride the counterpunch over the fin | **Low Blow** — a ceiling curtain forces the kick back LOW | **Party Foul** — a second piñata squats in the return path |
| popper | **Confetti Relay** — reshape each cannon arc into the far gap | **Return to Sender** — hotter cannons, finned gaps, steep descents | **Grand Salute** — a fin hangs mid-arc; thread it, then still land it |
| plants | **Window Boxes** — dip into wall pockets on alternating sides | **Ivy Wall** — every pocket on ONE wall; swing out and back | **Jungle Gym** — guard fins over mouths, roofed cake pocket |

## Physics lessons the sim taught (gen 1 → gen 2)

Each of these killed a design or rescued one; they're encoded in
`tools/partygen.mjs`:

- **Lift rooms are one-shot.** In a room-filling updraft she rises once,
  monotonically, and pins to the ceiling forever. Bob oscillation is
  energy-conserving, so a window above her entry height is unreachable
  bare. Three designs died before the working one (side-by-side columns:
  over-the-roof skydives, lucky-lob window-to-window flights, entry sweeps
  through high windows). What works: windows LOW (where no bare sweep
  arrives) + the band as a flat rail she skims beneath the lift.
- **Piñata kicks are reversals.** The radial kick throws her back the way
  she came, with energy added (min exit 58). You cannot "nudge her onto
  the flank" — bands are rails, not nudgers. The working stage: ramp her
  ACROSS the room into the piñata, ride the counterpunch back over a tall
  fin. Gen 2 adds an awning over the slot after the fun judge caught the
  solver sneaking down a gutter without ever touching a piñata: the awning
  bounces low left-origin arcs back into the fail pocket, and doubles as a
  funnel — overshot kicks land on its top and roll in.
- **Cushions preserve vx**, so any drift survives bouncing forever —
  chambers must kill vx at the walls or she bounce-drifts across every
  floor gap for free. Vertical boing + snap detector = clean fast fail.
- **Cushion-to-cushion upward hops don't work.** Post-band speeds cap
  around ~90; +18 height over a 58-unit gap is the ballistic edge. The
  "Trampoline Tower" concept died to this; Needle Threader replaced it.
- **Dead floors must be dishes.** A shallow V lets her surf ~14s before
  the stuck detector fires; a deep 32-wide dish settles her in ~2s. Fails
  have to read fast at a party.
- **dishFloor shoulders must clamp to the walls** — an unclamped shoulder
  poking through the outer wall is a ramp that funnels out-of-bounds
  flights straight onto the cake (the updraft 1-band "solutions" of gen 1).
- **Popper stages need an anti-roll lip**: without one, the dead floor's
  slope rolls her into the exit gap for free.

## Pipeline

```sh
node tools/partygen.mjs            # emit the parametric suite (no solutions)
node tools/partybuild.mjs [fam]    # solve each level vs the real sim, bake JSON
node tools/partypolish.mjs [id]    # hill-climb solutions for finger-slop
node tools/partycheck.mjs [id]     # verify: bare fails, solution wins,
                                   #   min bands == players (exhaustive k=1 +
                                   #   sampled/beam cheat hunts), mechanic
                                   #   FIRES on the winning run, slop, cards
```

`partycheck --cards` renders a ride-card PNG per level into `party-cards/`
— the level with the winning run's traced path, the artifact everything is
judged on. `party-report.json` holds the verdicts + telemetry.

The solver (`partylib.solve`) is a beam search over band sets with
candidate types tuned by failure: rails (both endpoints near the
trajectory), connectors (trajectory → plant/piñata/popper/goal), end-biased
point sampling, plus score "lures" — proximity credit toward uncollected
plants and untouched piñatas — because a rail that ALMOST enters a pocket
must outrank one that ignores it or the beam random-walks. Stacked families
reuse the (N−1)-player solution minus its last band as a search prefix.

## The adversarial fun judge

Five hostile judge agents (one per mechanic) score every level 1–10 on
RIDE / OWNERSHIP / READABILITY / FAIL-FEEL from the ride cards + telemetry,
under a rubric built from the repo's own finding that `duration ×
%airborne` predicts fun and raw duration predicts nothing. Gen-1 verdicts
that drove gen 2:

- **"Zero mechanic events on all nine bumper cards"** — the winning lines
  never touched a piñata. Formal verification proved band-count honesty;
  only the judge noticed the mechanic was scenery. Fixed with the awning
  (geometry), an engagement lure (solver), and `events >= players` is now
  a hard acceptance test in partycheck.
- **"Difficulty is wired to the wrong knob"** — solution fragility ran
  with player count, not tier (several 4P levels at 0% jitter tolerance).
  Gen 2 sizes windows/gaps per tier and adds the polish pass, which
  hill-climbs each solution toward the fat part of its basin.
- **"Tier 2 is a reskin"** (updraft, popper) — gen 2 makes the tier
  furniture bigger and load-bearing: readable sills, taller gap fins,
  escalating dead-air gaps.
- Keepers, per the judges: popper's skeleton ("elite airborne numbers, no
  player can be carried"), updraft tier 3's sag, plants' pocket-dip
  identity, cushion 2-3P's one-arc-per-player readability.

Judge dossiers and prompts live in the session scratchpad; re-run the
round by giving any agent `judge-prompt.md` + a family dossier built from
`party-report.json`.

## Known gaps

- 5 of 45 variants still lack baked solutions (hardest 4P/3P finales:
  cushion-1-4p, cushion-3-4p, plants-2-4p, plants-3-3p, plants-3-4p) —
  the templates are proven at other player counts; the beam solver just
  hasn't landed them yet.
- Cushion bounce events aren't instrumented in `st.events`, so ride cards
  under-report the pillow family's mechanic engagement.
- Judges want a comic hazard at dish vertices so dead arcs resolve with a
  noise instead of a 2s wobble — needs a new toy, out of scope for a
  one-mechanic-per-level suite.
