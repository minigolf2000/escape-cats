# goomba-glider client — module map

The room server owns the bands, the level, the phase and the score. This client
renders snapshots and sends intents — the same seam hex-clicker has.

| file | owns |
| --- | --- |
| `main.js` | boot, the frame loop, and the snapshot→UI wiring |
| `state.js` | the snapshot mirror (`S`) + the local presentation hanging off it |
| `net.ts` | PartySocket transport, the lobby handshake, the pack message (typed) |
| `debug.ts` | `?solo` — the shared sim in-page, no server; `#hash` level adoption |
| `render.js` | the drawing surface and everything drawn on it |
| `selector.js` | the levels grid, which on a laptop is the level editor |
| `input.js` | three ways to lay a band, one way to take it back |
| `sheet.js` | the how-to-play pictures, which are also the join gate |
| `dom.js` | every element ref |
| `figma/` | reading a Figma frame off the clipboard (`clipboard`, `stitch`, `paste`) |

**`render.js` exports its surface as LIVE BINDINGS.** `ctx`, `W`, `H`, the camera
offset and the animation clock are `export let`, assigned only inside that file.
Every importer reads the current value, which is what lets `drawScene` point the
whole renderer at one of the sheet's 340px canvases and back without any draw
function growing a "which canvas?" parameter — the same trick the level cards
play. Anything an importer must WRITE lives on `S` in `state.js` instead, because
an `export let` is read-only to whoever imports it.

Game RULES live in `packages/shared/src/goomba/` (levels/physics/sim/codec) —
never here. A level is a Figma frame and a pack is a list of links; there are no
levels in this repo.

Debug: `window.__goomba` exposes the mirror + `send()`. `?solo` runs with no
server, `?debug` unlocks the selector on a real room, and `\` opens the grid with
editing on. `/proctor` + `?debug` is how to test a real room.
