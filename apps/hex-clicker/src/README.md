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

**Art** comes from the Figma file "Hexxxygon", page **Hex_v2** (node 52:2), in
two shapes. Anything RECOLOURED or drawn to canvas is traced to vector: the
mouse (`mouse-geom.js` → `art.js`) and the shop icon (inline in `index.html`).
Anything only DISPLAYED ships as lossless WebP in `public/art/`: the splash and
Hex's five head poses, on one shared 828×652 canvas registered by eye position
with the eyes painted out, so `#hexCat` swaps them under one rigged pair of
eyes. Only the DAY pose loads before first paint; the other files park their URL
in `data-href` and land one idle callback later (`warmPoseFrames` in `cat.js`).

Four things about that registration are worth knowing before touching the heads:

- **The v2 day and night heads are separate drawings, not one scaled twice.**
  Their coats are the same size (within 3%) but the night face's eyes sit 11%
  further apart. Registering by eye would have shrunk the night cat ~10%, so
  they are registered by COAT CENTRE and the shared socket sits at the DAY eye
  positions — about 13px, or 2% of face width, inboard of where the artist drew
  the night ones. Invisible, and it is why the eyes are painted out rather than
  covered: at that offset a baked night iris would peek past the socket.
- **The open socket does render on the night head**, for the length of one yawn:
  `.shut` is toggled by `asleep && !lidBusy`, so while the yawn owns the lids
  the night pose shows the open eye. That is the whole reason one socket has to
  work on both heads.
- **The three squash frames are v1 art recoloured**, not v2 drawings — the v2
  sheet has no squash poses. They are remapped from v1's three-colour palette
  (coat `#605858`, ink `#302828`, ear `#987068`) into v2's, and shifted onto the
  v2 eye registration. Replace them wholesale when a real v2 pose sheet lands.
- **Only the EAR TIPS are cut out of the day head**, and everything below them
  is the artist's file byte for byte. Masking the whole drawing by the ear
  opening instead cost her both whiskers — they are white, so they fall outside
  the coat mask the opening is built from — and left her outline lumpy. Where
  each tip sat the head keeps a collar of flat coat at the artist's own alpha,
  and each ear box is anchored just under its own cut, because the perk is a
  `scaleY` about that box's bottom edge: a deep base puts the join high above
  the anchor and swings it. A shipped composite should measure 712×630, the same
  ink box as the artist's frame — if it does not, something is being masked away.
- **Only the squash frames have a shadow layer.** v1 painted Hex's shading
  OUTSIDE her line, at full opacity, where it blocked the day sunburst — hence a
  separate layer at `.58`. The v2 heads carry their shading INSIDE the line, so
  `hex-day-shadow` is gone and `#catShadow` now only serves the squash poses.

**The eyes are three nested transform channels**, one job each: `#eyeLeft` /
`#eyeRight` are the lids (scaleY), the `.look` groups inside are the glance
(translate), `#pupilLeft` / `#pupilRight` inside those are dilation (scale). The
socket clips the pupil, so a glance presses it against the rim. There are four
`.look` groups, not two: the sleeping lash arc is wider than the socket and
sits outside the clip. The socket is filled edge to edge with a dark pupil;
don't reintroduce a hollow-ring variant. All four contours — socket, its clip,
pupil, shut lash — are traced off the v2 eye keyframes (node 53:104), the pupil
from the artist's own drawn pupil rather than derived from the socket, which is
what `PUPIL_SLIT`/`PUPIL_ROUND` then scale between.

The markup is in `index.html`; the CSS in `styles.css`. The roster is a column
of names riding the shop tray's measured top edge (`--dock-up`, written by
`main.js`) — see `#team` in `styles.css`.

**Debug**: `window.__hex` exposes the mirror + `send()`. `?debug&speed=20`
fast-forwards a run. The 🛠 panel's `spawn golden` puts a golden mouse up
immediately (day only).
