# Hex Clicker — Design Decisions

Living decision log for **Hex Clicker**, the cooperative cookie-clicker in the
Escape Cats series. Playable prototype: [`hex-clicker-neon.html`](./hex-clicker-neon.html).

This file exists so future work (human or Claude) knows what is **LOCKED** —
settled, don't relitigate without the team — versus **OPEN** — still being
tuned or brainstormed. When a decision moves from OPEN to LOCKED, move it up
and date it. When you build a LOCKED decision into real app code
(`apps/hex-clicker`, `packages/shared/balance.ts`, the server), leave a comment
pointing back here.

_Last updated: 2026-08-03._

---

## 🔒 LOCKED

- **Theme — neon line-art on near-black.** The whole game orbits a real neon
  mouse toy Hex the cat loves. Everything is drawn as two-pass neon strokes
  (soft glow + bright core); single-theme by choice.

- **Currency — neon mice.** You pet Hex, she bats the neon mouse; you collect
  **neon mice**. The number is a means to the reveal, not the goal itself.

- **Reveal — emergent mice on the wall.** Mice climb onto the back wall and
  their glowing trails ink a hidden code word set inside a line-art scene
  (yellow crews spell the word; four other colors draw a scene _about_ it).
  Legibility is a pure function: **`legibility = (word mice) × (trail length)`**.
  The formula shape is locked; the constants are open.

- **Reveal word & scene — `TO THE MOON`.** This is _the_ code word and scene for
  Hex Clicker: rocket, crescent moon, orbit swoosh, little green visitors. It is
  the only scene anywhere — `reveal-lab.html` narrowed to it in v6 (four word
  layouts, one scene) and the game inks nothing else. The early **SIX SIDED** and
  **ENIGMA** concept panels are retired; they live in git history only.

- **Mouse accumulator — lifetime neon mice.** Wall-mouse _k_ climbs on when
  cumulative neon mice ever earned crosses a geometric threshold
  (`mouseBase × mouseR^(k-1)`). Mice are **never purchased**. Monotonic on
  lifetime earnings, so spending never stalls the reveal and hoarding can't
  game it. Server-trivial: `onWall = f(lifetimeEarned)`.

- **Clicking never goes vestigial.** Two click-upgrade shapes: a flat
  multiplier (Sharpened Claws, ×2/level — carries the early game) and a
  percent-of-income bonus (Static Whiskers, +N% of mice/s per pet — keeps
  petting meaningful at endgame because it scales with the economy).

- **Golden mouse — the coordination mechanic.** A golden mouse crosses every
  phone at once (seeded from the room clock — free with the deterministic-
  animation architecture). It carries **one slot per player seat**; each player
  must tap their **own** slot. Team Zoomies multiplier scales with how many
  seats tapped: **×2 → ×3 → ×4 → ×6** for one → all four, lasting **7s**. You
  still benefit from a partial catch, but max requires everyone, and the
  all-four step is deliberately a cliff (+2 where the others are +1) — so the
  pressure is "don't be the cat who missed it."

  **Zoomies multiplies PETS, never mice/s.** This is the load-bearing part. A
  multiplier on idle income pays out the same whether the four of them tap like
  mad or sit still, so it produces no behavior; a multiplier on pet power turns
  every catch into a 7-second all-hands tapping sprint — someone yells, everyone
  hammers their phone, it ends. That sprint is the reason the mechanic exists.

  The **×6 / 7s** ceiling is inherited from the shipped solo build
  ([`../hex/index.html`](../hex/index.html), `ZOOM_MULT` / `ZOOM_MS`). Four-seat
  coop should feel like solo at its best, not like a different economy — so the
  ceiling is the anchor and the ramp below it is what coop adds. Retune together.

- **Player identity — shape + color.** Four seats, assigned across the whole
  Escape Cats series: **Triangle/blue, Square/pink, Circle/green,
  Diamond/purple**. Yellow is reserved for the word. Your shape shows in a
  persistent HUD badge and rides your golden-mouse slot (shape + color = double
  encoding, colorblind-safe).

- **No in-game end state.** The word is read off the wall and delivered to a
  human **proctor in person**. No guess box, no win screen, no timer. When the
  wall turns legible the game gives a gentle one-time shimmer + a nudge to tell
  the proctor, then just keeps running until the proctor resets the room.

- **10 minutes is the hard constraint.** A completion target reached through
  balance, not a clock. This is the top constraint every other number bends to.

---

## 🔓 OPEN (tuning / brainstorming)

- **All economy constants** — building costs & mps, upgrade costs, accumulator
  `mouseBase`/`mouseR`, trail segment counts, golden-mouse cadence. Everything
  in `BAL` in the prototype is a first guess; tune against the 10-minute target
  with the TUNE panel's time-scale. (Zoomies is the exception — its ceiling is
  pinned to the solo build, see below.)
- **Era structure & count** — leaning **3 eras** (launch narrative — see
  brainstorm below); exact timings/gates pending a paced playtest.
- **Final upgrade set** — which handful of upgrades actually ship (10 minutes
  fits far fewer than a normal clicker; curation is the real work).
- **Zoomies ramp shape** — the ×6 / 7s ceiling is settled (matches the solo
  build) and pets-not-mps is settled; what's open is the ×2 → ×3 → ×4 curve
  below it, i.e. how much a partial catch is worth and how steep the all-four
  cliff needs to be before it reads as unfair rather than motivating.
- **Extra coordination mechanics** beyond the golden mouse (hold-to-buy,
  purr-sync click windows, per-color ownership of the scene) — all unproven.
- **Player-count scaling** — does `unlockPoints`/pacing flex for 2 vs 6 players?

---

## Era brainstorm (OPEN)

The key product call of any clicker, made brutal by the 10-minute cap.

**What the 10-minute cap changes vs a normal clicker:**
- No prestige, no offline/idle earnings — every second is active play. Growth
  lives in a tight band; no multi-hour exponential runaway.
- With the standard ×1.15 per-copy cost curve, a building stays relevant for
  ~10–15 buys then gets outscaled. In 10 minutes you buy _dozens_, not
  hundreds — so **fewer tiers, each of which must matter**.
- The **reveal is the real progress bar**, not the score. Pace eras to the
  _reveal_ (mice-on-wall + trail level), and let the score be the thing that
  gates them.
- Rule of thumb: **each era should introduce a new verb**, not just bigger
  numbers — a new toy, a new decision, a new reason to look up from tapping.

**Direction: 3 eras (~3.3 min each), themed as the launch narrative.** The word
is TO THE MOON — use it. Three eras map cleanly onto the reveal's three states
(hidden → forming → legible) and the clicker's natural arc (manual → automated →
absurd). Fewer eras means each transition is a bigger, more memorable beat, and
the **two transitions become the signature group moments.**

_Design principle for this venue:_ no-failure means coordination **rewards**
syncing, never **punishes** desync — bonuses for tapping together, never
penalties for tapping apart (consistent with Angry Goomba's "no failure, no
limits").

| # | Era | ~time | Dominant verb | Unlocks | Reveal wall | Coordination hook |
|---|-----|-------|---------------|---------|-------------|-------------------|
| 1 | **Ground Control** | 0:00–3:00 | manual tapping | Ball of Yarn, Sharpened Claws | first mice creep on, no trails — word hidden | per-player contribution visible; first golden mouse appears late as a taste |
| 2 | **Liftoff** | 3:00–6:30 | build & automate | Catnip, Cat Tower, Roomba, Whiskers, Comet Trails L1–2 | scene shapes (rocket, orbit) light up — word forming | two-cat carry on big buys; golden mice regular |
| 3 | **To The Moon** | 6:30–10:00 | burst & sync | Laser Array, Comet Trails L3–5 | last mice on, trails max — word snaps legible | golden mice peak (all-tap ×6); zoomies chains |

**The two transition gates — the signature group moments:**
- **Ignition (~3:00):** a launch pad appears; all four tap it together (natural
  "3-2-1!") to light the engines → unlocks automation + a launch bonus. Ends Era 1.
- **Escape Velocity (~6:30):** a shared meter the whole team fills; crossing it
  triggers escape velocity → unlocks the top tier + a zoomies chain. Ends Era 2.

These gates are where physically-present players yell at each other — the whole
point of a coop escape room. Likely **soft-gated** (bonus for nailing the sync,
but progress still flows) to stay true to no-failure.

**Upgrade menu to draw from (curate hard — maybe ~12 total ship):**
- _Passive (mps):_ Ball of Yarn → Catnip → Cat Tower → Roomba → Laser Array (current 5).
- _Click:_ Sharpened Claws (flat ×), Static Whiskers (% of mps). Candidates:
  Pounce (crit-chance pets), Hair-Trigger (auto-pet burst when zoomies start).
- _Trails (the reveal ink):_ Comet Trails L1–5. Possible branch — Long Tail
  (length) vs Afterimage (brightness/legibility per unit).
- _Coordination:_ Shiny Bait (golden mice appear more often), Nine Lives
  (zoomies run longer than the 7s baseline), Purr-Sync (bonus if all four tap
  within a shared beat).

**Coordination mechanics bank (pick a few — golden mouse is locked):**
1. **Golden mouse** _(LOCKED)_ — one slot per seat, all-tap for ×6 zoomies (7s
   of pet power, not idle income — the sprint is the mechanic).
2. **Launch gates** — all-four-tap-together to advance an era (Ignition, Escape
   Velocity above). The loudest moments in the room.
3. **Two-cat carry** — the heaviest purchases (Cat Tower, Laser Array) need two
   players holding the buy button at once. "Someone help me lift this."
4. **Purr-sync** — Hex purrs on a beat; taps landing in the same window as a
   teammate's stack a combo multiplier. Rewards rhythmic group tapping.
5. **Spotlight cat** — a rotating ×3 bonus on one random seat's taps; that
   player's badge lights and the team yells at them to go.
6. **Color ownership** — each seat's color owns a piece of the moon scene; the
   mice you personally fund wear your color, so you're literally drawing your
   part of the reveal. Ties identity → the reveal.

**Open questions:**
- Which 2–3 coordination mechanics beyond the golden mouse make the cut?
- Hard-gate the era transitions (must complete to advance) or soft-gate (bonus
  for nailing it, progress flows anyway)? Soft-gate is safer for a no-fail venue.
- Do the two transition bonuses need a catch-up path for a slow group so the
  10-minute target holds?
