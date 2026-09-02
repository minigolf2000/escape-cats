# Goomba Glider prop art — SVG exports

Design copies of the props for Figma and anything else that wants vectors:
`watering-can`, `spider-plant-thirsty`, `spider-plant-watered`, `goomba`,
`party-popper`, `bumper`, `cushion`.

**The game does not load these.** `src/render.js` draws every prop procedurally
on canvas and that is the only copy the game runs. `export-svg.mjs` mirrors that
canvas geometry by hand, so the two can drift: **retune the art in `render.js`,
then re-run the export and commit the result.**

```sh
cd apps/goomba-glider/art && node export-svg.mjs
```

Everything is frozen at t=0 (no sway, no drip phase) and emitted at 10 SVG
units per world unit in named `<g>` layers, which is the scale the Figma kit
uses. Goomba's `splash` phase is drawn black; this app loads no image asset.
