# tools 🛠

[`goomba/`](./goomba/) is the Goomba Glider level-design bench — node QA
harnesses over the shared sim, plus the design guide (`DESIGNING.md`). It is
its own world with its own README; everything below is about the two browser
tools in this folder.

The bench's browser half, the **level editor**, is not here: it lives in
`apps/goomba-editor` and ships at `/editor/`. It imports the shared sim,
so it needs a build step and cannot be one dependency-free HTML file the way
these two are — the folder a thing lives in follows from whether it builds, not
from whether it is a tool.

Standalone browser tools — not games, not part of the multiplayer
architecture. Each is a single self-contained HTML file with zero
dependencies, zero build step, and no server, so it costs nothing to keep and
rides along on the same Vercel deploy as everything else.

| File | Serves at | What it does |
| --- | --- | --- |
| `qr-studio.html` | `/qr-studio/` | QR Art Studio — live QR pixel painter. Paint black/white/noise directly on a working code; a GF(2) solver honors your pixels in paint order (~4ms/solve), an error-correction budget absorbs stragglers, and a background pass retries every EC level × mask to keep more of your paint legal. Over-budget pixels are annotated, never blocked; the code always scans. Drawings save into the URL hash. Notes in [`qr-art-notes.md`](./qr-art-notes.md). |
| `reveal-lab.html` | `/reveal-lab/` | The tuning instrument for the night reveal wall's mice/word-legibility sim. The shipped wall is `apps/hex-clicker/src/wall.js`, ported from here; the lab is where the ramp gets eyeballed before it lands there. |

Both files land at their own pretty URL through `scripts/assemble.mjs`, which
copies a single-file surface to `<name>/index.html`. **That is why there are no
rewrites for these paths in `vercel.json`** — the URL is a real directory on
disk, so `/qr-studio/` is served by the filesystem the way `/hexxygon/` is. The
tools previously lived in a `hex/` folder deployed at `/solo-hex/` and needed a
rewrite pair each (slashed and unslashed) to reach them inside it; that folder
existed for the frozen single-player prototype, which is gone (see below), and
the rewrites went with it.

Neither file makes a single relative reference, so nothing here is sensitive to
the directory depth it is served at — the trailing-slash trap documented in the
root README does not apply to them.

## The prototype that used to live here

`hex/index.html` — the original 5,400-line single-file Hex Clicker prototype —
was deleted. It had been frozen since #88 while the shipped balance in
`packages/shared/src/hex/` moved on without it, and its job as the tuning bench
now belongs to the coop client's **`?debug`** mode, which runs the same shared
`HexSim` in-page with no server (`apps/hex-clicker/src/debug.ts`). Keeping a
second, stale copy of the rules around only invited tuning against balance that
no longer ships. Git history has it if the port ever needs checking against its
source.
