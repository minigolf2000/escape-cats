# Escape Cats — working notes for Claude threads

Two coop 4-player party games (Hex Clicker, Goomba Glider) on one Cloudflare
Worker + one Vercel deploy. The [README](./README.md) is the full map; these
are the invariants that bite.

## Goomba Glider level design (most common task)

**Start at [`tools/goomba/DESIGNING.md`](./tools/goomba/DESIGNING.md).** It is
the whole loop, the physics cheat sheet, and the accumulated anti-shortcut
findings — do not design from intuition, the sim disproves it reliably.

- **The level editor** (`apps/goomba-editor`, served at `/editor/`,
  :5179 in dev) is the fast loop: drag geometry against the shipped sim, live
  verdicts on every edit, a background worker pool hunting for the ≤3-band win
  that would break the level. A level **saves by being a URL** — `encodeLevel`
  in `packages/shared/src/goomba/codec.ts` packs one into ~100–450 base64url
  chars, so designs travel as links and `node verify.mjs --hash <link>` gates
  one that was never committed. The codec lives in shared/ because the browser
  and the node bench must agree on it byte for byte; never fork it. Same for
  `goomba/gate.ts` — the thresholds that DEFINE a pass (jitter, hunt grid,
  legal-band lattice) are one copy that both graders import.
- Levels live in **`packages/shared/src/goomba/levels.ts`** — the ONLY copy
  (the prototype is deleted). Server scoring, phone animation, and the design
  tools all run this exact code.
- **The party rule is locked: every level must genuinely REQUIRE 4 bands**
  (4 players × 1). Not "allow" — require. Its other half is enforced in code:
  a player may hold at most **⌈4 / connected players⌉** bands at once
  (`bandQuota` in `goomba/sim.ts`), so four players is one each. Geometry that
  needs 4 bands + a cap of 1 each = nobody spectates. `node quota.mjs` is that
  half's gate; a lone tester is `n=1`, quota 4, so solo play still works.
- **The gate: `cd tools/goomba && node verify.mjs <levelIdx>`** must print
  PASS before a level ships. It runs the bare/solution checks, load-bearing +
  finger-slop robustness, the exhaustive/randomized minimum-band search, and
  a beam-search shortcut hunt. If verify finds a 1-band win, the level is
  broken no matter how clever the design felt.
- **Six levels ship.** The Skim, The Puzzle Box, Pillow Fort and Mind the Gap
  were cut, and the survivors renumbered 1–6 — a level's display number is
  its array index + 1, so removing one renumbers everything after it.
- Levels 1–4 need fewer than 4 bands — the standing debt. Re-measured with
  `minbands`/`solve`, not inherited: The Long Way Down (1) needs 3, Watering
  Can Slalom (2) needs 3, Piñata Alley (3) needs 2, and only Pop Goes Goomba
  (4) actually collapses to 1 (195/8738 one-band wins, exhaustive). The old
  blanket "these all collapse to 1 band" note was stale for 2 and 3 — if you
  are about to repeat a debt claim, re-run the tool first. Levels 2–4 predate
  the party rule; level 1 joined them on purpose, rebuilt to a hand sketch
  whose silhouette has no room for a 4th gate (DESIGNING.md has the
  reachability sweep that proves no can placement fixes it).
  Space Cadet (5) was rebuilt as a five-can machine: no ≤3-band win found
  (1-band exhaustive, 2–3 sampled), 4-band solution with every band
  load-bearing — but it fails the ±3u finger-slop check (0/30), so its debt
  is precision, not collapse (see its comment in `levels.ts`). Don't copy the
  1–4 structure; copy The Popper Grid (forced popper lanes), or the
  four-different-deaths chain the removed Four Ways to Help demonstrated —
  the level is gone, the pattern is written up in DESIGNING.md. The
  shelf-gated switchback that Mind the Gap demonstrated is still a good
  pattern and still written up there too — those levels are gone, their
  findings are not.
- Parallel level threads: work on your own branch — `levels.ts` is where
  every level thread edits, and sharing a branch collides.

## Repo invariants (violating these has burned us before)

- **Deploy order**: the Worker must go out BEFORE a Vercel deploy that depends
  on new protocol/DO classes. CI deploys it (`.github/workflows/deploy-worker.yml`,
  on push to main touching `server/**` or `packages/shared/**`), but that RACES
  Vercel's push build rather than ordering it — for a breaking change, run the
  workflow manually on the branch first, confirm it's live, then merge.
  `wrangler.jsonc` migrations are APPEND-ONLY (new class = new tag, never edit
  an old one). Renaming a Worker or DO class orphans its storage.
- **One origin**: vanity domains (hexxygon.com, g00.mba) REDIRECT to
  cat-games-tau.vercel.app — never turn them into rewrites; the localStorage
  pid (team identity) only follows players on one origin. No `?room=` params,
  ever — the lobby is the only way into a team.
- **Vite `base` is absolute** per app and must match its `dist/` subdirectory
  (`/hexxygon/`, `/g00mBa/` — casing is load-bearing). `npm run build:vercel`
  runs `check-routing.mjs`; keep its expectations current.
- **Two cursors in the games, ever**: `pointer` if a tap does something,
  `default` if it does not. These are phone games — almost nobody playing has a
  cursor, so a third value cannot be telling players anything, it can only be
  inconsistent (the shop shipped `not-allowed` for "too expensive" and `default`
  for "still locked", two disabled states telling two stories). `npm run
  build:vercel` runs `check-cursors.mjs`, which fails on anything else in
  apps/{hex-clicker,goomba-glider,lobby,chat}. `apps/proctor`,
  `apps/goomba-editor` and `tools/` are deliberately exempt: one operator, one
  laptop, and `grab`/`crosshair` are doing real work there.
- **Proctor box heights are fixed**: every stat line renders in every state
  (placeholders, never fewer lines) so boxes don't shift under a drag.
- **Goomba Glider's level selector is EARNED, and `?debug` only overrides that
  gate**: a room that has cleared every level (`goombaCleared` = `finishedAt`
  set, in `goomba/sim.ts`) unlocks the **levels** grid for all four phones on
  the same snapshot, and a proctor **reset** takes it back with the rest of the
  room state. The level dots top-left ARE its button: once unlocked the dot
  strip wears a plate and a ▦, and tapping it opens the grid — every level as a
  card with live bare/solution verdicts, and tapping a card jumps THE WHOLE
  ROOM to that level (a real wire intent; teammates follow). `?debug` puts one
  phone in the unlocked state without playing the game first — that is ALL it
  does now, so don't add features behind it that a cleared room doesn't get.
  `?solo` runs the same grid on the in-page sim with no server. Testing on
  prod: `/proctor`, assign yourself to a team, open the game with `?debug`. Hex
  keeps `?debug&speed=N` for balance work.
- **NEXT off the finale of a cleared room lands on the `splash` phase**, not a
  victory lap: a terminal, deliberately BLANK screen (`drawSplash` in
  `main.js`, where the artwork goes) whose only control is the level selector
  the clear just unlocked. Nothing places or plays from it; the ways out are a
  `goto` and a proctor reset. `nextLeadsToSplash` is the one predicate for that
  transition — the PLAY button's "FINISH ▸" label reads it too.

## Commands

```sh
npm run dev            # everything: server :1999, hex :5173, goomba :5178,
                       # proctor :5175, lobby :5176, chat :5177
npm run typecheck      # all workspaces
npm run build:vercel   # full build + assemble + routing & cursor checks
npm run check:cursors  # the two-cursor rule, on its own
cd tools/goomba && node verify.mjs <idx>   # the level-design gate
cd tools/goomba && node verify.mjs --hash <editor link>   # same gate, no diff
cd tools/goomba && node verify.mjs --file <file of links> # ...on a batch
cd tools/goomba && node quota.mjs          # the participation gate (room rule)
```
