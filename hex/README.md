# hex 🐭

The **Hex Clicker** single-player prototype, packaged as its own deploy root so
it can sit at the root of a domain.

`index.html` is the game — a single self-contained file with no build step, no
dependencies, and no server. This is the game's canonical home (it used to live
at `prototypes/hex-clicker.html`); edit it here.

Also hosted from this root (each a self-contained, zero-dependency file, so
they cost nothing to keep here and ride along on the same deploy):

- `qr-studio.html` — the QR Art Studio tool, reachable at `/qr-studio`.
  Its companion notes are in `qr-art-notes.md`.
- `reveal-lab.html` — the standalone tuning instrument for the night reveal
  wall's mice/word-legibility sim, reachable at `/reveal-lab`. Moved here from
  `prototypes/`, same reasoning as the game itself.
- `hex-clicker-synergy-brief.md` — implementation notes for the game.

## Deploying on Vercel

This folder is the deploy root, so the game serves at the domain root (`/`),
not `/hex/`:

1. Import the repo into Vercel (New Project → pick this repo).
2. **Root Directory** → `hex`
3. **Framework Preset** → Other (no build command, no output dir — it's
   static HTML served as-is).
4. Deploy, then add your domain under the project's **Domains** tab.

`vercel.json` sets `X-Robots-Tag: noindex, nofollow` on every path, so the
site stays out of search results while it's a private work in progress. The
site is unlisted, not locked — every file in this folder is reachable by
anyone who guesses its URL. Remove that header block to allow indexing.

`vercel.json` also sets `cleanUrls: true`, so every `.html` file here is
reachable without its extension — `qr-studio.html` at `/qr-studio`,
`reveal-lab.html` at `/reveal-lab`. The `.html` URL still works too; it 308s
to the clean one.
