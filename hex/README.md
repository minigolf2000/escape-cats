# hex 🐭

The **Hex Clicker** single-player prototype, packaged as its own deploy root so
it can sit at the root of a domain.

`index.html` is the game — a single self-contained file with no build step, no
dependencies, and no server. This is the game's canonical home (it used to live
at `prototypes/hex-clicker.html`); edit it here.

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
site is unlisted, not locked — the URL (and this folder's only file) is
reachable by anyone who has it. Remove that header block to allow indexing.
