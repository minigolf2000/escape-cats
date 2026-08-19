// Export the two Goomba Glider props as standalone SVGs for design work.
//
// The GAME never loads these: main.js draws the can and the plant procedurally
// on canvas, and that is still the only copy the game runs. These are exports
// for Figma, and this script is the export — the geometry below mirrors
// `drawCan` and `drawGoalPlant` in ../src/main.js, so if you retune the art
// there, re-run `node export-svg.mjs` here and commit the result.
//
// Everything is emitted at u = 10 (one canvas unit = 10 SVG units) with named
// <g> layers, so the groups arrive in Figma as named frames you can pull apart.
import { writeFile } from "node:fs/promises";

const U = 10;
const u = (n) => +(n * U).toFixed(2);
const deg = (rad) => +((rad * 180) / Math.PI).toFixed(2);

/** Canvas roundRect → SVG rect. */
const rrect = (x, y, w, h, r, fill, name) =>
  `    <rect id="${name}" x="${u(x)}" y="${u(y)}" width="${u(w)}" height="${u(h)}" rx="${u(r)}" fill="${fill}"/>`;

// ---------- the watering can (drawCan) ----------
// Canvas arc(cx, cy, r, a0, a1) clockwise → one SVG arc segment.
function arcPath(cx, cy, r, a0, a1) {
  const p = (a) => `${u(cx + r * Math.cos(a))},${u(cy + r * Math.sin(a))}`;
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  return `M ${p(a0)} A ${u(r)},${u(r)} 0 ${large} 1 ${p(a1)}`;
}

function wateringCan() {
  // three drips off the rose, frozen at the phases the loop passes through
  const drips = [0.1, 0.44, 0.78].map((ph, i) =>
    `      <circle id="drip-${i + 1}" cx="${u(-3.5 - ph * 0.5)}" cy="${u(-0.8 + ph * 3.2)}" ` +
    `r="${u(0.34)}" fill="#ffd166" opacity="${(1 - ph).toFixed(2)}"/>`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-90 -70 165 130" width="165" height="130">
  <title>Watering can — Goomba Glider</title>
  <g id="watering-can" transform="rotate(${deg(-0.16)})">
    <circle id="glow" cx="0" cy="0" r="${u(4.6)}" fill="#57e6c9" opacity="0.13"/>
    <path id="handle" d="${arcPath(0.1, -1.1, 1.5, Math.PI * 1.05, Math.PI * 1.95)}"
          fill="none" stroke="#ffd166" stroke-width="${u(0.42)}" stroke-linecap="round"/>
    <path id="spout" d="M ${u(-1.2)},${u(0.4)} L ${u(-3.2)},${u(-1.1)}"
          fill="none" stroke="#ffd166" stroke-width="${u(0.75)}" stroke-linecap="round"/>
    <ellipse id="sprinkler-rose" cx="${u(-3.4)}" cy="${u(-1.25)}" rx="${u(0.8)}" ry="${u(0.5)}"
             fill="#ffd166" transform="rotate(${deg(-0.65)} ${u(-3.4)} ${u(-1.25)})"/>
${rrect(-1.5, -1.2, 3.4, 3.2, 0.7, "#ffd166", "body")}
${rrect(-1.1, 0.1, 2.6, 1.75, 0.5, "#57e6c9", "water")}
    <g id="drips">
${drips}
    </g>
  </g>
</svg>
`;
}

// ---------- the spider plant (drawGoalPlant) ----------
const SPIDER_BLADES = [
  [-1, 5.2, 2.4, 3.6, 0.7], [1, 5.4, 2.2, 3.9, 0.7],
  [-1, 4.4, 4.2, 1.7, 0.78], [1, 4.6, 4.0, 2.0, 0.78],
  [-1, 3.2, 6.0, -0.4, 0.85], [1, 3.4, 5.7, -0.2, 0.85],
  [-1, 1.6, 7.4, -3.4, 0.7], [1, 1.9, 7.0, -3.0, 0.7],
  [1, 0.5, 5.8, -5.4, 0.6],
];
const CROWN_Y = -3.4;
const BABY = [[-1.7, 0.4], [-1.1, 1.2], [0, 1.5], [1.1, 1.1], [1.7, 0.3]];

function spiderPlant(ready) {
  const leaf = ready ? "#57e6c9" : "#49a08f";
  // hex + *-opacity rather than rgba(): Figma's SVG importer reads the
  // attribute pair, and drops colours written as rgba() on the floor.
  const stripe = ready ? "#f0fff8" : "#d6ece4", stripeOp = ready ? 0.8 : 0.35;
  const lift = ready ? 1 : 0.62, sag = ready ? 0 : 1.6, spread = ready ? 1 : 0.88;
  const rx = 6.0, ry = ready ? -1.2 : 0.2;   // runner tip (t=0, so no swing)

  const blades = SPIDER_BLADES.map(([dir, reach, rise, drop, w], i) => {
    const tx = dir * reach * spread, ty = CROWN_Y + drop + sag;
    const cx = dir * reach * 0.42, cy = CROWN_Y - rise * lift, by = CROWN_Y;
    const len = Math.hypot(tx, ty - by) || 1;
    const nx = ((ty - by) / len) * w, ny = (-tx / len) * w;
    return `      <g id="blade-${i + 1}">
        <path d="M 0,${u(by)} Q ${u(cx + nx)},${u(cy + ny)} ${u(tx)},${u(ty)} Q ${u(cx - nx)},${u(cy - ny)} 0,${u(by)} Z"
              fill="${leaf}" stroke="#ffd166" stroke-opacity="0.7" stroke-width="${u(0.18)}" stroke-linejoin="round"/>
        <path d="M 0,${u(by)} Q ${u(cx)},${u(cy)} ${u(tx)},${u(ty)}"
              fill="none" stroke="${stripe}" stroke-opacity="${stripeOp}" stroke-width="${u(w * 0.22)}" stroke-linecap="round"/>
      </g>`;
  }).join("\n");

  const baby = BABY.map(([ax, ay], i) =>
    `        <path id="baby-leaf-${i + 1}" d="M ${u(rx)},${u(ry)} Q ${u(rx + ax * 0.65)},${u(ry + ay * 0.35)} ` +
    `${u(rx + ax)},${u(ry + ay)} Q ${u(rx + ax * 0.3)},${u(ry + ay * 0.7)} ${u(rx)},${u(ry)} Z" fill="${leaf}"/>`).join("\n");

  const state = ready ? "watered" : "thirsty";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-95 -125 195 180" width="195" height="180">
  <title>Spider plant, ${state} — Goomba Glider</title>
  <g id="spider-plant-${state}">
    <ellipse id="glow" cx="0" cy="${u(-3.5)}" rx="${u(8.8)}" ry="${u(7.5)}"
             fill="${ready ? "#57e6c9" : "#ffd166"}" opacity="${ready ? "0.2" : "0.12"}"/>
    <g id="pot">
      <ellipse id="saucer" cx="0" cy="${u(0.8)}" rx="${u(4.2)}" ry="${u(0.8)}" fill="#cfc4ec"/>
      <path id="body" d="M ${u(-3.1)},${u(-2.4)} L ${u(3.1)},${u(-2.4)} L ${u(2.3)},${u(0.8)} L ${u(-2.3)},${u(0.8)} Z" fill="#ff9dce"/>
${rrect(-3.5, -3.2, 7, 1.3, 0.6, "#ffd166", "rim")}
    </g>
    <g id="runner">
      <path id="stolon" d="M ${u(0.4)},${u(CROWN_Y)} Q ${u(3.4)},${u(CROWN_Y - 2.6)} ${u(rx)},${u(ry)}"
            fill="none" stroke="${ready ? "#8fe3c4" : "#5f8f7f"}" stroke-width="${u(0.22)}" stroke-linecap="round"/>
      <g id="plantlet">
${baby}
      </g>
    </g>
    <g id="blades">
${blades}
    </g>
  </g>
</svg>
`;
}

await writeFile(new URL("watering-can.svg", import.meta.url), wateringCan());
await writeFile(new URL("spider-plant-watered.svg", import.meta.url), spiderPlant(true));
await writeFile(new URL("spider-plant-thirsty.svg", import.meta.url), spiderPlant(false));
console.log("wrote watering-can.svg, spider-plant-watered.svg, spider-plant-thirsty.svg");
