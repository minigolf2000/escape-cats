# Escape Cats 🐾

Two cooperative 4-player mini games for a puzzle escape room, starring Hex
and Goomba. Players join by scanning a QR code, play together for ~10
minutes, and unlock a code word to give the proctor.

- **Hex Clicker** — a cooperative cookie-clicker. One shared point pool,
  shared upgrades. Every upgrade releases a mouse toy that wanders the
  screen; as toys accumulate, their paths gradually spell out the code word.
- **Angry Goomba** — cooperative Angry-Birds-style physics. No failure, no
  projectile limits; knock down five fortresses together to reveal the code
  word.

## Layout

```
apps/hex-clicker/    Player client: React + a canvas overlay for mouse toys
apps/angry-goomba/   Player client: Phaser 3 (renderer only — physics is server-side)
apps/proctor/        Hidden proctor dashboard: QR codes, live progress bars, reset
packages/shared/     Wire protocol, balance config, levels, seeded RNG
server/              PartyKit room server (both games, one deploy)
```

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
   balance. All economy/level tuning lives in `packages/shared/src/balance.ts`
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

### 1. PartyKit (do this first)

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
VITE_HEX_URL=https://hex.<domain>
VITE_GOOMBA_URL=https://goomba.<domain>
VITE_PROCTOR_TOKEN=<matches PROCTOR_TOKEN above>
```

### 3. Vanity domains

Attach the domain to the project in Vercel, then add a host rewrite in
`vercel.json` pointing it at the right subdirectory:

```json
{
  "source": "/(.*)",
  "has": [{ "type": "host", "value": "hex.example.com" }],
  "destination": "/hex/$1"
}
```

`g00.mba` is already wired this way, to Goomba Rider.

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

- The actual letter-stroke reveal in `packages/shared/src/seeded.ts`
  (`toyPathAt` is a seeded wanderer with a TODO where the word logic goes).
- Art, sound, and juice everywhere (everything is emoji-and-rectangles).
- Balance playtests (add a dev-only time-scale knob to the hex server).
- Per-session code words configured from the proctor dashboard.
- Goomba client-side prediction of your own projectile if launch latency
  ever feels bad (it shouldn't on venue wifi).
