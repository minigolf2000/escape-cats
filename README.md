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

## Deploying (when ready)

- Server: `cd server && npx partykit deploy` (free PartyKit/Cloudflare
  account, one command; set real code words + proctor token as deploy vars).
- Clients: `npm run build` and host `apps/*/dist` on any static host
  (Cloudflare Pages / Netlify / Vercel), with `VITE_*` env vars pointed at
  the deployed PartyKit host.

## Next steps (deliberately not in the scaffold)

- The actual letter-stroke reveal in `packages/shared/src/seeded.ts`
  (`toyPathAt` is a seeded wanderer with a TODO where the word logic goes).
- Art, sound, and juice everywhere (everything is emoji-and-rectangles).
- Balance playtests (add a dev-only time-scale knob to the hex server).
- Per-session code words configured from the proctor dashboard.
- Goomba client-side prediction of your own projectile if launch latency
  ever feels bad (it shouldn't on venue wifi).
