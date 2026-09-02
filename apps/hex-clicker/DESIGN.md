# Hex Clicker — Design Decisions

What is **LOCKED** (don't relitigate without the team) versus **OPEN** (still
being tuned). Balance lives in `packages/shared/src/hex/`.

## 🔒 LOCKED

- **Theme — neon line-art on near-black.** Two-pass neon strokes (soft glow +
  bright core); single-theme by choice.
- **Currency — neon mice.** The number is a means to the reveal, not the goal.
- **Reveal — emergent mice on the wall.** Mice climb the back wall and their
  trails ink a hidden code word inside a line-art scene (yellow crews spell the
  word; four other colours draw a scene about it). `legibility = (word mice) ×
  (trail length)`; the formula shape is locked, the constants are open.
- **Reveal word & scene — `TO THE MOON`**: rocket, crescent moon, orbit swoosh,
  little green visitors. The only scene anywhere.
- **The whole cast walks from the first frame of night** (`WALL` in
  `shared/hex/rules.ts`). What the night buys is what the mice LOOK like
  (Counting Mice) and what they LEAVE BEHIND (the trail ladder), never whether
  they exist — a mouse with no trail is an anonymous dot and leaks nothing, and
  every visible change stays a purchase.
- **Clicking never goes vestigial.** Flat multipliers (the ×2 rungs) carry the
  early game; `clickShare` (+N% of mice/s per pet) keeps petting meaningful at
  endgame. The ladder is in the petting section of `shared/hex/data.ts`.
- **Golden mouse — the coordination mechanic.** One golden mouse is up for the
  whole room (server owns WHEN; each phone bounces it in its own layout) and
  **any phone's tap catches it for the whole team**, triggering Zoomies
  **×6 for 7s** (`ZOOM_MULT` / `ZOOM_S`). **Zoomies multiplies PETS, never
  mice/s** — a multiplier on idle income produces no behaviour; a multiplier on
  pet power turns every catch into a 7-second all-hands sprint, which is the
  reason the mechanic exists. The ×6 / 7s ceiling is the anchor; retune the ramp
  below it with it.
- **Player identity — a colour per roster slot.** A teammate's replayed taps pop
  in their slot's colour (`MOUSE_COLOR_LIST`). Yellow is reserved for the word.
- **No in-game end state.** The word is read off the wall to a human proctor,
  who presses **🏆 Mark won** (see "The win splash" in the root README). No
  guess box, no self-scored win, no timer.
- **10 minutes is the hard constraint**, reached through balance, not a clock.

## 🔓 OPEN

- **All economy constants** — `packages/shared/src/hex/data.ts`; its tuning
  notes carry what pins each number. Tune against the 10-minute target with
  `?debug&speed=N`. (Zoomies' ceiling is the exception, above.)
- **Era structure** — leaning 3 eras (Ground Control → Liftoff → To The Moon,
  ~3.3 min each, themed as the launch narrative); timings and gates pending a
  paced playtest. Each era should introduce a new verb, not just bigger numbers.
  The two transitions (an all-tap Ignition at ~3:00, a shared Escape Velocity
  meter at ~6:30) are the candidate signature group moments, likely soft-gated
  so no-failure holds.
- **Final upgrade set** — 10 minutes fits far fewer than a normal clicker;
  curation is the real work.
- **Zoomies ramp shape** below the ×6 ceiling: how much a partial catch is worth.
- **Extra coordination mechanics** beyond the golden mouse, all unproven:
  two-cat carry (heaviest buys need two players holding), purr-sync (taps on a
  shared beat stack a combo), spotlight cat (a rotating ×3 seat), colour
  ownership of scene pieces. No-failure venue: reward syncing, never punish
  desync.
- **Player-count scaling** — does pacing flex for 2 vs 6 players?
