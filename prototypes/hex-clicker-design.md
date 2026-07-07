# Hex Clicker — Design Decisions

Living decision log for **Hex Clicker**, the cooperative cookie-clicker in the
Escape Cats series. Playable prototype: [`hex-clicker-neon.html`](./hex-clicker-neon.html).

This file exists so future work (human or Claude) knows what is **LOCKED** —
settled, don't relitigate without the team — versus **OPEN** — still being
tuned or brainstormed. When a decision moves from OPEN to LOCKED, move it up
and date it. When you build a LOCKED decision into real app code
(`apps/hex-clicker`, `packages/shared/balance.ts`, the server), leave a comment
pointing back here.

_Last updated: 2026-07-07._

---

## 🔒 LOCKED

- **Theme — neon line-art on near-black.** The whole game orbits a real neon
  mouse toy Hex the cat loves. Everything is drawn as two-pass neon strokes
  (soft glow + bright core); single-theme by choice (see `lineart-sketches.html`).

- **Currency — neon mice.** You pet Hex, she bats the neon mouse; you collect
  **neon mice**. The number is a means to the reveal, not the goal itself.

- **Reveal — emergent mice on the wall.** Mice climb onto the back wall and
  their glowing trails ink a hidden code word set inside a line-art scene
  (yellow crews spell the word; four other colors draw a scene _about_ it).
  Legibility is a pure function: **`legibility = (word mice) × (trail length)`**.
  The formula shape is locked; the constants are open.

- **Reveal word & scene — `TO THE MOON`.** This is _the_ code word and scene for
  Hex Clicker: rocket, crescent moon, orbit swoosh, little green visitors (see
  the moon panel in `lineart-sketches.html`). The **SIX SIDED** art is kept as a
  concept-art reference only (in `lineart-sketches.html` / `reveal-lab.html`) —
  it does not ship as a second scene. `reveal-lab.html` keeps both scenes because
  it's a tuning instrument, not the game.

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
  seats tapped: **×2 → ×3.5 → ×5 → ×7** for one → all four. You still benefit
  from a partial catch, but max requires everyone — so the pressure is "don't
  be the cat who missed it."

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
  `mouseBase`/`mouseR`, trail segment counts, golden-mouse cadence, zoomies
  duration. Everything in `BAL` in the prototype is a first guess; tune against
  the 10-minute target with the TUNE panel's time-scale.
- **Era structure & count** — see brainstorm below; not yet locked.
- **Final upgrade set** — which handful of upgrades actually ship (10 minutes
  fits far fewer than a normal clicker; curation is the real work).
- **Zoomies multiplier curve & duration.**
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

**Proposed 5-era skeleton (~2 min each) — not locked:**

| # | Era | ~time | New verb | Reveal state |
|---|-----|-------|----------|--------------|
| 1 | **Paws** | 0:00–1:30 | pure tapping; Ball of Yarn; Sharpened Claws | first few mice creep on |
| 2 | **Toys** | 1:30–3:30 | passive income (Catnip, Cat Tower); Whiskers; Comet Trails L1 — wall starts drawing | word faintly forming |
| 3 | **Contraptions** | 3:30–6:00 | machines (Roomba); golden mice ramp up — the coordination era; Trails L2–3 | big scene shapes appear |
| 4 | **Overdrive** | 6:00–8:30 | top tier (Laser Array); chained zoomies; Trails L4 | letters mostly inked |
| 5 | **Legible** | 8:30–10:00 | final trail level; last mice climb on; word snaps clear | read it → proctor |

**Upgrade menu to draw from (curate hard — maybe ~12 total ship):**
- _Passive (mps):_ Ball of Yarn → Catnip → Cat Tower → Roomba → Laser Array (current 5).
- _Click:_ Sharpened Claws (flat ×), Static Whiskers (% of mps). Candidates:
  Pounce (crit-chance pets), Hair-Trigger (auto-pet burst when zoomies start).
- _Trails (the reveal ink):_ Comet Trails L1–5. Possible branch — Long Tail
  (length) vs Afterimage (brightness/legibility per unit).
- _Coordination:_ Shiny Bait (golden mice appear more often), Nine Lives
  (zoomies last longer), Purr-Sync (bonus if all four tap within a shared beat).

Open question for the team: **5 eras or 4?** Four (~2.5 min each) gives each
era more room to breathe and is easier to balance to 10 minutes; five makes the
climb feel faster and busier. Leaning 4–5; not locking until a paced playtest.
