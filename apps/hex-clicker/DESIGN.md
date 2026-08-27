# Hex Clicker — Design Decisions

Living decision log for **Hex Clicker**. It records what is **LOCKED** — settled,
don't relitigate without the team — versus **OPEN**, still being tuned. When a
decision moves from OPEN to LOCKED, move it up and date it.

The game ships in this directory; its balance is `packages/shared/src/hex/`.

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

- **Mouse accumulator — superseded in the shipped game.** The wall's whole cast
  walks from the first frame of night (see `WALL` in `shared/hex/rules.ts`): the
  lifetime-earnings arrival ramp shipped and was then deleted, because a mouse
  with no trail behind it is an anonymous moving dot — a full cast leaks
  nothing — and it keeps the night's rule that every visible change is a
  purchase. What the night buys is what the mice LOOK like (Counting Mice) and
  what they LEAVE BEHIND (the trail ladder), never whether they exist.

- **Clicking never goes vestigial.** Two click-upgrade shapes: flat multipliers
  (the ×2 rungs — carry the early game) and a percent-of-income bonus
  (`clickShare`, +N% of mice/s per pet — keeps petting meaningful at endgame
  because it scales with the economy). The shipped ladder and its reasoning
  live in the petting section of `shared/hex/data.ts`.

- **Golden mouse — the coordination mechanic.** A golden mouse is up for the
  whole room at once (the server owns WHEN; each phone bounces it inside its own
  layout), and **any phone's tap catches it for the whole team** — the shipped
  simplification of the per-seat-slots scheme, which never left the concept
  phase. The catch triggers team-wide Zoomies **×6 for 7s**.

  **Zoomies multiplies PETS, never mice/s.** This is the load-bearing part. A
  multiplier on idle income pays out the same whether the four of them tap like
  mad or sit still, so it produces no behavior; a multiplier on pet power turns
  every catch into a 7-second all-hands tapping sprint — someone yells, everyone
  hammers their phone, it ends. That sprint is the reason the mechanic exists.

  The **×6 / 7s** ceiling is inherited from the single-player build (originally
  the deleted `hex/index.html`; now `ZOOM_MULT` / `ZOOM_S` in
  [`packages/shared/src/hex/data.ts`](../packages/shared/src/hex/data.ts)). Four-seat
  coop should feel like solo at its best, not like a different economy — so the
  ceiling is the anchor and the ramp below it is what coop adds. Retune together.

- **Player identity — a colour per roster slot.** A teammate's replayed taps
  pop in their slot's colour (`MOUSE_COLOR_LIST`), which is the one place hex
  draws identity; the concept-phase shape+colour badge scheme never shipped
  (with any-tap golden catches there is no slot to badge). Yellow stays
  reserved for the word on the wall.

- **No in-game end state.** The word is read off the wall and delivered to a
  human **proctor in person**. No guess box, no self-scored win, no timer. When
  the wall turns legible the game just keeps running (the "gentle one-time
  shimmer" is designed but unbuilt — see the note at the end of `wall.js`); the
  proctor witnesses the read-out and presses **🏆 Mark won**, which unlocks the
  win splash on every phone (see "The win splash" in the root README).

- **10 minutes is the hard constraint.** A completion target reached through
  balance, not a clock. This is the top constraint every other number bends to.

---

## 🔓 OPEN (tuning / brainstorming)

- **All economy constants** — building costs & mps, upgrade costs, trail
  budgets, golden-mouse cadence. They live in
  `packages/shared/src/hex/data.ts`, whose tuning comments carry the
  measurements; tune against the 10-minute target with `?debug&speed=N`.
  (Zoomies is the exception — its ceiling is pinned to the solo build, see
  below.)
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
penalties for tapping apart (consistent with Goomba Glider's "no failure, no
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
