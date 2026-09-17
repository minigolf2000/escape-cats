# tools 🛠

[`goomba/`](./goomba/) is the Goomba Glider design guide, the Figma bridge and
the level commands; it has its own README.

The two HTML files are **standalone browser tools**: single self-contained
files, no dependencies, no build, no server. `scripts/assemble.mjs` copies each
to `<name>/index.html` in `dist/`, so it is served by the filesystem with no
rewrite in `vercel.json`. Neither makes a relative reference, so the
trailing-slash trap in the root README does not apply.

| File | Serves at | What it does |
| --- | --- | --- |
| `qr-studio.html` | `/qr-studio/` | QR Art Studio: paint black/white/noise on a working code. A GF(2) solver honours pixels in paint order, an error-correction budget absorbs the rest, and a background pass retries every EC level × mask. The page's URL **is** the save file (run-length encoded, deflated, in the hash). Undo/redo on ⌃Z / ⇧⌃Z; **Shift** locks a stroke to H, V or 45°. Notes in [`qr-art-notes.md`](./qr-art-notes.md), source art in [`qr-art/`](./qr-art/). |
| `reveal-lab.html` | `/reveal-lab/` | The tuning instrument for hex's night reveal wall. The shipped wall is `apps/hex-clicker/src/wall.js`, ported from here. |

**The level editor is not here.** It is Goomba Glider's level selector, behind
`\` (`apps/goomba-glider/src/figma/`).
