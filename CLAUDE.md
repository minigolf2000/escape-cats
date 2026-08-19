# Escape Cats — working notes for Claude threads

Two coop 4-player party games (Hex Clicker, Goomba Glider) on one Cloudflare
Worker + one Vercel deploy. The [README](./README.md) is the full map; these
are the invariants that bite.

## Goomba Glider level design (most common task)

**Start at [`tools/goomba/DESIGNING.md`](./tools/goomba/DESIGNING.md).** It is
the whole loop, the physics cheat sheet, and the accumulated anti-shortcut
findings — do not design from intuition, the sim disproves it reliably.

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
- Levels 2–4 need fewer than 4 bands — the standing debt (they predate the
  party rule). Re-measured with `minbands`, not inherited: Watering Can
  Slalom (2) needs 3, Piñata Alley (3) needs 2, and only Pop Goes Goomba (4)
  actually collapses to 1 (195/8738 one-band wins, exhaustive). The old
  blanket "these all collapse to 1 band" note was stale for 2 and 3 — if you
  are about to repeat a debt claim, re-run the tool first.
  Space Cadet (5) was rebuilt as a five-can machine: no ≤3-band win found
  (1-band exhaustive, 2–3 sampled), 4-band solution with every band
  load-bearing — but it fails the ±3u finger-slop check (0/30), so its debt
  is precision, not collapse (see its comment in `levels.ts`). Don't copy the
  2–4 structure; copy Four Ways to Help (one gate per band, each with its own
  death) or The Popper Grid (forced popper lanes). The shelf-gated switchback
  that Mind the Gap demonstrated is still a good pattern and still written up
  in DESIGNING.md — the level is gone, the finding is not.
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
  apps/{hex-clicker,goomba-glider,lobby,chat}. `apps/proctor` and `tools/` are
  deliberately exempt: one operator, one laptop, and `grab`/`crosshair` are doing
  real work there.
- **Proctor box heights are fixed**: every stat line renders in every state
  (placeholders, never fewer lines) so boxes don't shift under a drag.
- **Goomba Glider's debug menu**: `?debug` joins your REAL room with the
  **levels** grid on top (the level dots top-left ARE its button: in debug
  the dot strip wears a plate and a ▦, and tapping it opens the grid) —
  every level as a card with live bare/solution verdicts, and tapping a card
  jumps THE WHOLE ROOM to that level (a real wire intent; teammates on plain
  URLs follow). `?solo` runs the same grid on the in-page sim with no server. Testing on prod: `/proctor`, assign
  yourself to a team, open the game with `?debug`. Hex keeps
  `?debug&speed=N` for balance work.

## Commands

```sh
npm run dev            # everything: server :1999, hex :5173, goomba :5178,
                       # proctor :5175, lobby :5176, chat :5177
npm run typecheck      # all workspaces
npm run build:vercel   # full build + assemble + routing & cursor checks
npm run check:cursors  # the two-cursor rule, on its own
cd tools/goomba && node verify.mjs <idx>   # the level-design gate
cd tools/goomba && node quota.mjs          # the participation gate (room rule)
```
