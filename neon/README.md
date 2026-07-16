# neon 🐭

Standalone deploy of the **Hex Clicker** single-player prototype, packaged so
it can sit at the root of its own domain.

`index.html` is a copy of [`../prototypes/hex-clicker.html`](../prototypes/hex-clicker.html) —
a single self-contained file with no build step, no dependencies, and no
server. To update the deployed game, re-copy that file over `index.html`.

## Deploying on Vercel

This folder is the deploy root, so the game serves at the domain root (`/`),
not `/neon/`:

1. Import the repo into Vercel (New Project → pick this repo).
2. **Root Directory** → `neon`
3. **Framework Preset** → Other (no build command, no output dir — it's
   static HTML served as-is).
4. Deploy, then add your domain under the project's **Domains** tab.

`vercel.json` sets `X-Robots-Tag: noindex, nofollow` on every path, so the
site stays out of search results while it's a private work in progress.
Remove that header block to allow indexing.
