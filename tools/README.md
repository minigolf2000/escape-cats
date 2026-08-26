# tools 🛠

[`goomba/`](./goomba/) is the Goomba Glider design guide (`DESIGNING.md`), the
Figma bridge, and three small commands. It has its own README.

Everything else here is a **standalone browser tool** — not a game, not part of
the multiplayer architecture. Each is a single self-contained HTML file with zero
dependencies, zero build step and no server, so it costs nothing to keep and
rides along on the same Vercel deploy.

| File | Serves at | What it does |
| --- | --- | --- |
| `qr-studio.html` | `/qr-studio/` | QR Art Studio — live QR pixel painter. Paint black/white/noise directly on a working code; a GF(2) solver honors your pixels in paint order (~4ms/solve), an error-correction budget absorbs stragglers, and a background pass retries every EC level × mask to keep more of your paint legal. Over-budget pixels are annotated, never blocked; the code always scans. Drawings save into the URL hash. Notes in [`qr-art-notes.md`](./qr-art-notes.md), source art in [`qr-art/`](./qr-art/). |
| `reveal-lab.html` | `/reveal-lab/` | The tuning instrument for the night reveal wall's mice/word-legibility sim. The shipped wall is `apps/hex-clicker/src/wall.js`, ported from here; the lab is where the ramp gets eyeballed before it lands there. |

Both land at their own pretty URL through `scripts/assemble.mjs`, which copies a
single-file surface to `<name>/index.html`. **That is why there are no rewrites
for these paths in `vercel.json`** — the URL is a real directory on disk, so
`/qr-studio/` is served by the filesystem the way `/hexxygon/` is.

Neither file makes a single relative reference, so the trailing-slash trap
documented in the root README does not apply to them.

**The level editor is not here.** It is the game's level selector, reached with
`\` from inside Goomba Glider (`apps/goomba-glider/src/figma/`) — the editor
never had a second renderer or a second sim worth keeping, only a second copy of
the same grid.
