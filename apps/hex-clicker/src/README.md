# hex-clicker client — module map

Rendering is plain JS; the typed seams are TS. Game RULES live in
`packages/shared/src/hex/` (data/rules/sim) — never here.

| file        | owns                                                                  |
| ----------- | --------------------------------------------------------------------- |
| `main.js`   | boot, join gate, frame loop, and the snapshot→UI-beat wiring          |
| `state.js`  | the server-state mirror, snapshot EDGES, shared clock, optimistic pets |
| `net.ts`    | PartySocket transport + pet batching                                  |
| `debug.ts`  | `?debug` — the shared HexSim running in-page, no server               |
| `shop.js`   | dock, building rows, upgrade rail, HUD, badge/seen, sold-out beat     |
| `wall.js`   | the night reveal: tracer, glyphs, moon scene, cast, canvas drawing    |
| `cat.js`    | Hex herself — blink, gaze, lean, purr, yawn, dream twitches, squash   |
| `golden.js` | the golden mouse (server decides WHEN; each phone decides WHERE)      |
| `pet.js`    | tap handling, streaks, night pokes                                    |
| `mates.js`  | teammates' taps, replayed with their real rhythm and spot             |
| `fx.js`     | "+N" floats and mouse-pop particles                                   |
| `phase.js`  | day/night projection, starfield, the night cutscene                   |
| `art.js`    | the one mouse silhouette + palette every renderer builds from         |
| `mouse-geom.js` | GENERATED — the mouse traced from the art file; art.js's input    |
| `format.js` | `fmt` — the one number formatter (night appends "M")                  |
| `dom.js`    | every element ref                                                     |

**Art** comes from the Figma file "Hexxxygon" (page Hex, node 22-3), in two
shapes. Anything RECOLOURED or drawn to canvas is traced to vector: the mouse
(`mouse-geom.js` → `art.js`) and the shop icon (inline in `index.html`).
Anything only DISPLAYED ships as lossless WebP in `public/art/`: the background
and Hex's five head poses, on one shared 828×652 canvas registered by eye
position with the eyes painted out, so `#hexCat` swaps them under one rigged
pair of eyes. Only the DAY pose loads before first paint; the other files park
their URL in `data-href` and land one idle callback later (`warmPoseFrames` in
`cat.js`).

**The eyes are three nested transform channels**, one job each: `#eyeLeft` /
`#eyeRight` are the lids (scaleY), the `.look` groups inside are the glance
(translate), `#pupilLeft` / `#pupilRight` inside those are dilation (scale). The
socket clips the pupil, so a glance presses it against the rim. There are four
`.look` groups, not two: the sleeping lash arc is wider than the socket and
sits outside the clip. The socket is filled edge to edge with a dark pupil;
don't reintroduce a hollow-ring variant.

The markup is in `index.html`; the CSS in `styles.css`. The roster is a column
of names riding the shop tray's measured top edge (`--dock-up`, written by
`main.js`) — see `#team` in `styles.css`.

**Debug**: `window.__hex` exposes the mirror + `send()`. `?debug&speed=20`
fast-forwards a run. The 🛠 panel's `spawn golden` puts a golden mouse up
immediately (day only).
