# Hex Clicker — Design Decisions

What is **LOCKED** (don't relitigate without a reason) versus **OPEN** (still
being tuned). Balance lives in `packages/shared/src/hex/`.

> Hex Clicker was a four-player co-op game for a physical escape room, run from
> a proctor's dashboard over a room server. **All of that is deleted** (see the
> root README). It is one player, one tab, one `localStorage`. Where a decision
> below changed with that, the old shape is named as HISTORY — not as something
> to put back.

## 🔒 LOCKED

- **Theme — neon line-art on near-black.** Two-pass neon strokes (soft glow +
  bright core); single-theme by choice.
- **Currency — neon mice.** The number is a means to the reveal, not the goal.
- **Reveal — emergent mice on the wall.** Mice climb the back wall and their
  trails ink a hidden code word inside a line-art scene (yellow crews spell the
  word; four other colours draw a scene about it). `legibility = (word mice) ×
  (trail length)`; the formula shape is locked (`wallCoverage` in `rules.ts`),
  the constants are open.
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
- **Golden mouse — the fun spike.** One is up at a time. The SIM owns WHEN it
  exists and for how long (`HexGold`, `scheduleGold` in `hex/sim.ts`); the
  CLIENT owns where — `seed` drives a deterministic placement and it bounces
  inside this screen's own layout (`golden.js`). Catching it triggers Zoomies
  **×6 for 7s** (`ZOOM_MULT` / `ZOOM_S`). **Zoomies multiplies PETS, never
  mice/s** — a multiplier on idle income produces no behaviour; a multiplier on
  pet power turns every catch into a 7-second sprint, which is the reason the
  mechanic exists. That is also why goldens are DAY-ONLY (`tick`): pets mint
  nothing once Hex is asleep, so a night golden would be a tappable prop paying
  zero. History: this was the room's coordination mechanic — one golden up for
  everyone, any phone's tap catching it for the whole team. The ×6 / 7s ceiling
  is still the anchor; retune the ramp below it with it.
- **The mouse palette — five colours, one ROLE each.** `MOUSE_COLORS` in
  `src/art.js`: yellow spells the word, and `MOON_SCENE` (`wall.js`) hardcodes
  the other four one per scenery element. **Yellow is reserved for the word**
  (and equals `--gold`, the golden mouse). History: the list was a colour per
  roster slot, so a teammate's replayed taps popped in their slot's colour; the
  roster and `mates.js` went with the room, and `MOUSE_COLOR_LIST` now only
  picks a random body for the mouse-pop a pet throws (`fx.js`). Two invariants
  ride on the exact values — read `art.js` before repainting.
- **The win is the wall going LEGIBLE.** Coverage crossing `LEGIBLE_COV` latches
  `legibleAt` in the sim (`rules.ts`, `sim.ts`), asked through `hexWon()`; the
  `wonFlip` edge raises the splash on the beat it happens (`state.js`,
  `main.js`), and `#wonPill` flips between splash and game LOCALLY (`phase.js`)
  — the wall they read is what they earned, so the picture has a way back. The
  word on it is `HEX_CODEWORD` imported from shared, never typed into a client.
  History: the win used to be a proctor's press on a separate dashboard
  (`wonAt` / `setWon`, both deleted), because the code word left the game on a
  phone and came back as four humans saying it out loud — witnessed rather than
  scored. With one player there is nobody to say it to. **No guess box, no
  self-scored win, no timer** — still true, and still the point: reading the
  wall is the whole end state.
- **10 minutes is the hard constraint**, reached through balance, not a clock.
  Note what that number was fitted to: four players sharing one mouse pool.
  `data.ts` contemplates a solo run in places (the "slow solo run" click gates,
  the Cat Brush savings note) so it is not broken, but nobody has timed one.

## 🔓 OPEN

- **All economy constants** — `packages/shared/src/hex/data.ts`; its tuning
  notes carry what pins each number. Tune against the 10-minute target with
  `?debug&speed=N`. (Zoomies' ceiling is the exception, above.)
- **Solo pacing** — does a one-player run actually land inside 10 minutes? If it
  reads as a slog, `hex/data.ts` is the lever, and that is a balance change made
  deliberately, not a bug fix. `?debug&speed=N` plus the `presets.ts` story-beat
  jumps are the bench.
- **Era structure** — leaning 3 eras (Ground Control → Liftoff → To The Moon,
  ~3.3 min each, themed as the launch narrative); timings and gates pending a
  paced playtest. Each era should introduce a new verb, not just bigger numbers.
  The two candidate transitions (an all-tap Ignition at ~3:00, an Escape
  Velocity meter at ~6:30) were written as signature GROUP moments; both still
  read as solo beats — a tap burst, a meter to fill — but neither has been
  designed for one pair of hands. Likely soft-gated so no-failure holds.
- **Final upgrade set** — 10 minutes fits far fewer than a normal clicker;
  curation is the real work.
- **Zoomies ramp shape** below the ×6 ceiling: how much a partial catch is worth.
- **Extra verbs beyond the golden mouse**, all unproven. The old candidates were
  coordination and went with the room: two-cat carry, purr-sync, spotlight cat,
  colour ownership of scene pieces (that last one is settled now — colour is a
  fixed role, above). Only purr-sync has a solo reading, as a rhythm bonus on
  the pet streak `pet.js` already tracks. What replaces the rest is open.
  No-failure by design: reward rhythm, never punish a miss.
