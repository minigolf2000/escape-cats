# Goomba Glider prop art — SVG exports

Design copies of the props for Figma and anything else that wants vectors:
`watering-can`, `spider-plant-thirsty`, `spider-plant-watered`, `goomba`,
`party-popper`, `bumper`, `cushion`.

**The game does not load these.** `src/render.js` draws every prop procedurally
on canvas and that is the only copy the game runs. `export-svg.mjs` mirrors that
canvas geometry by hand, so the two can drift: **retune the art in `render.js`,
then re-run the export and commit the result.**

**One exception, and it does not live here: `../public/favicon.svg`**, the tab
icon, which the same run writes out of the same layers as `goomba.svg` — cropped
to her face by its viewBox, on the page's own `#150a2a`. It is generated for the
reason everything else here is: so the cat in the tab cannot become a third
hand-drawn copy that drifts. Don't edit it in place; re-run the export.

```sh
cd apps/goomba-glider/art && node export-svg.mjs
```

Everything is frozen at t=0 (no sway, no drip phase) and emitted at 10 SVG
units per world unit in named `<g>` layers, which is the scale the Figma kit
uses. The game's one image asset is the finale's picture,
`public/art/goomba-splash.webp` — a drop-in file (lossless WebP, portrait, like
hex's): the splash draws it whole and takes its backdrop off the picture's own
top and bottom rows, so replacing it needs no code change. Nothing else here is
loaded; every prop is drawn.
