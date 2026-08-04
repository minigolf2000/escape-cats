# Escape Cats 🐾

Two cooperative 4-player mini games for a puzzle escape room, starring Hex
and Goomba. Players join by scanning a QR code, play together for ~10
minutes, and unlock a code word to give the proctor.

- **Hex Clicker** — a cooperative cookie-clicker. One shared mouse pool,
  shared buildings and upgrades. Petting Hex mints mice; buying the twist
  puts her to sleep, and the night wall's drifting dream-mice gradually ink
  the code word — identically on every phone.
- **Angry Goomba** — cooperative Angry-Birds-style physics. No failure, no
  projectile limits; knock down five fortresses together to reveal the code
  word.

## Layout

```
apps/hex-clicker/    Player client: vanilla JS/TS, the prototype's rendering split
                     into modules (see its src/README.md for the map)
apps/angry-goomba/   Player client: Phaser 3 (renderer only — physics is server-side)
apps/proctor/        Hidden proctor dashboard: QR codes, live progress, reset,
                     rehearsal fast-forward
packages/shared/     Wire protocol, seeded RNG, goomba levels, and the WHOLE hex
                     game: balance tables (hex/data.ts), pure rules (hex/rules.ts)
                     and the authoritative simulation (hex/sim.ts)
server/              PartyKit room server (both games, one deploy)
hex/                 The original single-player prototype — FROZEN as reference
```

## Where things live (so a retune touches one file)

- **Balance** — buildings, upgrades, costs, click math, wall ramp:
  `packages/shared/src/hex/data.ts` (+ `rules.ts` for derived rules). The
  server, the phones, and the client's `?solo` practice mode all import it,
  so there is exactly one copy to edit.
- **Game logic** — what a pet/purchase/golden-catch does: `packages/shared/src/hex/sim.ts`
  (the PartyKit server is a thin websocket wrapper around it).
- **Art & rendering** — client-only, one module per system:
  `apps/hex-clicker/src/{wall,cat,art,fx,shop}.js`.
- **The prototype** (`hex/index.html`) is frozen. It was the tuning bench;
  that job moved to the multiplayer client's `?solo&speed=N` mode, which runs
  the same shared sim in-page. Don't retune the prototype — it no longer
  feeds anything.

## Architecture decisions (agreed up front)

1. **Monorepo** — the hard part (join/presence/reset/reveal plumbing) is
   shared; the games are apps on top of it.
2. **Mobile web, no install** — QR scan → URL → playing in seconds.
   Hex Clicker is portrait; Angry Goomba is landscape.
3. **Server-authoritative rooms** (PartyKit / Cloudflare). Clients send
   intents (clicks, purchases, launches); the server owns all game state.
   Goomba's Matter.js physics runs on the server at 30Hz and broadcasts
   snapshots at 15Hz; clients interpolate.
4. **Shared cooperative state** — one point pool in Hex Clicker,
   one shared world in Goomba, simultaneous free-fire.
5. **Deterministic synced toy animation** — toy positions are a pure
   function of (room seed, toy index, server-synced clock), so all four
   phones show the identical reveal pattern with zero position traffic.
6. **Code words stay server-side** until unlocked (see `server/partykit.json`
   vars; override per deployment).
7. **10 minutes is a completion target, not a timer** — achieved through
   balance. All economy/level tuning lives in `packages/shared/src/hex/data.ts`
   and `levels.ts`, never in game code.
8. **Seat reclaim** — each phone has a persistent player id in localStorage,
   so a locked phone or dropped wifi rejoins the same seat.

## Development

```sh
npm install
npm run dev
```

This starts everything:

| What          | URL                                        |
| ------------- | ------------------------------------------ |
| PartyKit dev  | 127.0.0.1:1999                             |
| Hex Clicker   | http://localhost:5173/?room=TEST           |
| Angry Goomba  | http://localhost:5174/?room=TEST           |
| Proctor       | http://localhost:5175 (token `dev-proctor`) |

Open the proctor page, start a session, and scan the QR codes with phones on
the same wifi (the vite servers listen on the LAN; point
`VITE_PARTYKIT_HOST` at your machine's LAN IP for phone testing — see
`.env` handling below).

Simulate 4 players locally with 4 browser tabs — but note the persistent
player id is per-browser-profile, so use different profiles/incognito
windows to appear as different players.

For balance work on Hex, `?solo` runs the shared sim in the page with no
server at all, and `?speed=N` fast-forwards it — so
`localhost:5173/?solo&speed=20` walks a whole run in about 20 seconds. This
replaces the frozen prototype's `?debug` panel; the proctor's ×1/×5/×20
buttons do the same thing to a real room. `window.__hex` exposes the state
mirror and a `send()` for driving the game from a console or a test.

## Configuration

Client env vars (Vite, set in `apps/*/.env.local`):

- `VITE_PARTYKIT_HOST` — host:port of the PartyKit server (default `127.0.0.1:1999`)
- `VITE_HEX_URL`, `VITE_GOOMBA_URL` — public game URLs the proctor QR codes
  point at (proctor app only)
- `VITE_PROCTOR_TOKEN` — must match the server's `PROCTOR_TOKEN`

Server vars (`server/partykit.json` for dev; `partykit deploy --var` or the
dashboard for prod): `HEX_CODEWORD`, `GOOMBA_CODEWORD`, `PROCTOR_TOKEN`.

## Deploying

Two deploys total: **one PartyKit worker** (both coop games) and **one Vercel
project** (every static surface). Vanity domains are routed inside
`vercel.json`, not by splitting into more projects — so adding a domain or
repointing one is a repo change, not dashboard clicking.

### 1. PartyKit

Can be done last if you just want the site up: the single-player surfaces
(`/solo-hex/`, `/prototypes/`) need no server, and the coop apps build and
deploy fine with a stub `VITE_PARTYKIT_HOST` — they render their join screen
and only fail at the point of joining a room.

```sh
npm run deploy -w server   # partykit deploy
```

One worker serves both games: `partykit.json` maps `main` → Hex and the
`goomba` party → Angry Goomba, which is why the clients differ only by the
`party` option (`apps/angry-goomba/src/net.ts`) and share one host. Set real
`HEX_CODEWORD` / `GOOMBA_CODEWORD` / `PROCTOR_TOKEN` as deploy vars. Note the
resulting hostname — every client build needs it.

### 2. Vercel — one project

Import the repo; leave **Root Directory** at the repo root. Build settings
come from `vercel.json`, so there is nothing to override in the dashboard.

`npm run build:vercel` builds the three Vite apps and then
`scripts/assemble.mjs` collects every surface into one `dist/`:

| Path in `dist/` | Source | What |
| --- | --- | --- |
| `/hex/` | `apps/hex-clicker` | Hex Clicker (coop) |
| `/goomba/` | `apps/angry-goomba` | Angry Goomba (coop) |
| `/proctor/` | `apps/proctor` | Proctor dashboard |
| `/solo-hex/` | `hex/` | Hex Clicker (solo) + QR Studio |
| `/prototypes/` | `prototypes/` | Prototypes menu + Goomba Rider |

Env vars (all in this one project — `VITE_PARTYKIT_HOST` is set once here, so
the two games cannot drift onto different servers):

```
VITE_PARTYKIT_HOST=escape-cats.<user>.partykit.dev
VITE_HEX_URL=https://hexxygon.com
VITE_GOOMBA_URL=https://g00.mba
VITE_PROCTOR_TOKEN=<matches PROCTOR_TOKEN above>
```

**Root Directory must be blank.** `vercel.json` overrides the dashboard's
framework, build command and output directory, but it cannot set the root
directory — it is read *from* it. A project pointed at `hex/` or `prototypes/`
never sees this file, so `build:vercel` never runs and the hostname rewrites
never apply.

### 3. Vanity domains

Attach the domain to the project in Vercel, then add **two** host rewrites in
`vercel.json` pointing it at the right subdirectory — one for the bare root,
one for everything below it:

```json
{
  "source": "/",
  "has": [{ "type": "host", "value": "hex.example.com" }],
  "destination": "/hex/index.html"
},
{
  "source": "/:path*",
  "has": [{ "type": "host", "value": "hex.example.com" }],
  "destination": "/hex/:path*"
}
```

The root rule must come first — Vercel takes the first matching rewrite.

Both rules are load-bearing, and each covers a case the other cannot:

- **The `/:path*` rule cannot serve the bare root.** With zero path segments
  the destination resolves to `/hex/`, a directory rather than a file. Rewrites
  run *after* the filesystem check, so the directory-index lookup that turns
  `/hex/` into `/hex/index.html` has already been passed — the rewrite
  destination is resolved as an exact output path, and 404s. `assemble.mjs`
  writes no `dist/index.html`, so nothing catches the request first. Symptom:
  every deep link works, the domain root alone 404s.
- **Use `:path*`, not `/(.*)` with `$1`.** Vercel only substitutes `$1` when
  the source is an explicitly anchored regex; an unanchored source is parsed as
  path-to-regexp, where `$1` is not a substitution token, so every request
  rewrites to a literal `/hex/$1` and 404s — including the root.

Conversely, do **not** fix the root by adding a `dist/index.html` landing page.
The filesystem check runs before rewrites, so a root index would win over the
`"source": "/"` rules and every vanity domain would serve the landing page
instead of its game.

Two are wired already, both to the coop games — so these are the domains the
proctor QR codes point at (`VITE_HEX_URL` / `VITE_GOOMBA_URL`):

| Domain | Serves |
| --- | --- |
| `hexxygon.com` | Hex Clicker (coop) — `/hex/` |
| `g00.mba` | Angry Goomba (coop) — `/goomba/` |

Both need PartyKit deployed to be playable. Until then the domains resolve
and serve the app, which shows its "scan the room QR code" screen; joining a
room is what needs the server.

The single-player builds stay on paths — `/solo-hex/` and `/prototypes/` —
and need no server at all.

**Do not change `base: "./"` in the vite configs.** It is what lets one build
serve both from a vanity domain root (rewritten to `/hex/`) and from a path
(`preview-url/hex/`). An absolute base breaks one of the two. It is safe only
because no app routes on the path — rooms come from `?room=` — so adding
path-based routing means revisiting this.

`hex/vercel.json` and `prototypes/vercel.json` are leftovers from when those
folders were their own Vercel projects. They are inert under the
single-project setup (only the root `vercel.json` is read); keep them only if
you intend to split those surfaces back out.

## Next steps (deliberately not in the scaffold)

- **Room state is not persisted.** The hex sim lives in the Durable Object's
  memory, so an eviction or a redeploy mid-session resets a team to zero. It
  wants a throttled write to `room.storage` plus a rehydrate in `onStart` that
  credits elapsed time (capped, or a room left open overnight hands the next
  team a fortune). This is the one gap that can spoil a live session.
- Art, sound, and juice for **Goomba** (still emoji-and-rectangles; hex has
  its own art).
- Per-session code words configured from the proctor dashboard.
- Deploying the PartyKit worker on push (there is no git integration, so
  `packages/shared` can ship to Vercel while the server still runs the old
  economy — see the Deploying note).
- Goomba client-side prediction of your own projectile if launch latency
  ever feels bad (it shouldn't on venue wifi).
