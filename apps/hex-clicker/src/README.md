# hex-clicker client — module map

The prototype (`hex/index.html`, since deleted — git history only) was one
5,400-line file. It is
split here so a change lands in one small file. Rendering is plain JS ported
verbatim where possible; the typed seams are TS.

| file        | owns                                                                  |
| ----------- | --------------------------------------------------------------------- |
| `main.js`   | boot, join gate, frame loop, and the snapshot→UI-beat wiring          |
| `state.js`  | the server-state mirror, snapshot EDGES, shared clock, optimistic pets |
| `net.ts`    | PartySocket transport + pet batching (typed)                          |
| `debug.ts`  | `?debug` mode — the shared HexSim running in-page, no server (typed)  |
| `shop.js`   | dock, building rows, upgrade rail, HUD, badge/seen, sold-out beat     |
| `wall.js`   | the night reveal: tracer, glyphs, moon scene, cast, canvas drawing    |
| `cat.js`    | Hex herself — blink, gaze, lean, purr, yawn, dream twitches, squash   |
| `golden.js` | the golden mouse (server decides WHEN; each phone decides WHERE)      |
| `pet.js`    | tap handling, streaks, night pokes                                    |
| `fx.js`     | "+N" floats and mouse-pop particles                                   |
| `phase.js`  | day/night projection, starfield, the night cutscene                   |
| `art.js`    | the one mouse silhouette + palette every renderer builds from         |
| `mouse-geom.js` | GENERATED — the mouse traced from the art file; art.js's input    |
| `format.js` | `fmt` — the one number formatter (night appends "M")                  |
| `dom.js`    | every element ref                                                     |

Art comes from the Figma file "Hexxxygon" (page Hex, node 22-3) and lands in two
shapes. Anything that has to be RECOLOURED or drawn to canvas is traced to
vector — the mouse (`mouse-geom.js`, consumed by `art.js`) and the shop icon
(inline in `index.html`) — because the mouse keeps the game's own five colours
and the night wall draws it with canvas path calls. Anything that only has to be
DISPLAYED ships as PNG in `public/art/`: the background and Hex's five head
poses. The heads are exported onto one shared 828x652 canvas registered by eye
position, with the eyes painted out, so `#hexCat` can swap them freely under a
single rigged pair of eyes.

That rigged pair is three nested transform channels, one job each, because a
blink, a glance and a dilation all happen at once and one transform can only say
one of them: `#eyeLeft/#eyeRight` are the lids (scaleY), the `.look` groups
inside them are the look (translate), `#pupilLeft/#pupilRight` inside those are
the dilation (scale). The socket itself does not move — it is the eye's outline
— and it clips the pupil, so the pupil can open right out and a glance presses
it against the rim instead of through it. (There are four `.look` groups, not
two: the sleeping lash arc drifts with the same look but is drawn wider than the
socket, so it has to sit outside the clip.)

Two socket drawings ship and `?eyes=` picks between them: `ring` (default) is
the hollow ring the artist drew, with the coat showing through and a yellow
pupil in it; `solid` fills the same outline edge to edge and inks the pupil in
the drawing's own line colour. They dilate to different sizes on purpose — the
ring's pupil is the same yellow as the ring around it and merges into a smear if
it grows, the solid's is dark on yellow and can open to a saucer. Same rig
otherwise; see the eye blocks in `index.html` and `cat.js`.

Game RULES live in `packages/shared/src/hex/` (data/rules/sim) — never here.
The markup + CSS are in `index.html`, ported verbatim from the prototype plus
the multiplayer shell (join gate, team strip, reconnect toast) at the bottom.

Debug: `window.__hex` exposes the mirror + `send()` for console/Playwright
driving. `?debug&speed=20` fast-forwards a debug run. The 🛠 panel's `spawn
golden` puts a golden mouse up immediately (day only — greyed out at night,
where a golden pays nothing), and its `eyes` row flips the socket variant in
place so the two can be judged against each other without a reload.
