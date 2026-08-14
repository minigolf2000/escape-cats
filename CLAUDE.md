# Escape Cats — working notes for Claude threads

Two coop 4-player party games (Hex Clicker, Goomba Rider) on one Cloudflare
Worker + one Vercel deploy. The [README](./README.md) is the full map; these
are the invariants that bite.

## Goomba Rider level design (most common task)

**Start at [`tools/goomba/DESIGNING.md`](./tools/goomba/DESIGNING.md).** It is
the whole loop, the physics cheat sheet, and the accumulated anti-shortcut
findings — do not design from intuition, the sim disproves it reliably.

- Levels live in **`packages/shared/src/goomba/levels.ts`** — the ONLY copy
  (the prototype is deleted). Server scoring, phone animation, and the design
  tools all run this exact code.
- **The party rule is locked: every level must genuinely REQUIRE 4 bands**
  (4 players × 1; anyone may place remainders). Not "allow" — require.
- **The gate: `cd tools/goomba && node verify.mjs <levelIdx>`** must print
  PASS before a level ships. It runs the bare/solution checks, load-bearing +
  finger-slop robustness, the exhaustive/randomized minimum-band search, and
  a beam-search shortcut hunt. If verify finds a 1-band win, the level is
  broken no matter how clever the design felt.
- Levels 2–7 predate the party rule and still collapse to 1 band — known
  debt. Don't copy their structure; copy Mind the Gap (shelf-gated
  switchback) or The Popper Grid (forced popper lanes).
- Parallel level threads: work on your own branch — `levels.ts` is where
  every level thread edits, and sharing a branch collides.

## Repo invariants (violating these has burned us before)

- **Deploy order**: the Worker (`npm run deploy:server`) must go out BEFORE a
  Vercel deploy that depends on new protocol/DO classes. Wrangler has no git
  integration; `wrangler.jsonc` migrations are APPEND-ONLY (new class = new
  tag, never edit an old one). Renaming a Worker or DO class orphans its
  storage.
- **One origin**: vanity domains (hexxygon.com, g00.mba) REDIRECT to
  cat-games-tau.vercel.app — never turn them into rewrites; the localStorage
  pid (team identity) only follows players on one origin. No `?room=` params,
  ever — the lobby is the only way into a team.
- **Vite `base` is absolute** per app and must match its `dist/` subdirectory
  (`/hexxygon/`, `/g00mBa/` — casing is load-bearing). `npm run build:vercel`
  runs `check-routing.mjs`; keep its expectations current.
- **Proctor box heights are fixed**: every stat line renders in every state
  (placeholders, never fewer lines) so boxes don't shift under a drag.
- **Goomba Rider's debug menu**: `?debug` joins your REAL room with the
  🔬 level lab on top — every level as a card with live bare/solution
  verdicts, and tapping a card jumps THE WHOLE ROOM to that level (a real
  wire intent; teammates on plain URLs follow). `?solo` runs the same lab on
  the in-page sim with no server. Testing on prod: `/proctor`, assign
  yourself to a team, open the game with `?debug`. Hex keeps
  `?debug&speed=N` for balance work.

## Commands

```sh
npm run dev            # everything: server :1999, hex :5173, goomba :5178,
                       # proctor :5175, lobby :5176, chat :5177
npm run typecheck      # all workspaces
npm run build:vercel   # full build + assemble + routing check
cd tools/goomba && node verify.mjs <idx>   # the level-design gate
```
