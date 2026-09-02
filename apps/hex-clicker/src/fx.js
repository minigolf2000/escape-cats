// Stage effects: the floating "+N" numbers and the mouse-pop particles that
// burst off a pet. Shared by petting (fx per tap) and the golden mouse (its
// catch floats "⚡ ×N").

import { stageEl } from "./dom.js";
import { nightActive } from "./state.js";
import { mouseSVG, MOUSE_COLOR_LIST, NIGHT_POP_SCALE, MOUSE_KEYLINE_DAY, MOUSE_KEYLINE_NIGHT } from "./art.js";

export function floatNum(x, y, text) {
  const f = document.createElement("div");
  f.className = "float";
  f.textContent = text;
  f.style.left = x + "px";
  f.style.top = y + "px";
  stageEl.appendChild(f);
  f.addEventListener("animationend", () => f.remove());
}

const pops = [];
const POP_MAX = 40; // hard cap so a Zoomies tap-storm can't flood the DOM on mobile
export function spawnMousePop(x, y, color) {
  if (pops.length >= POP_MAX) pops.shift().el.remove();
  const el = document.createElement("div");
  el.className = "mousePop";
  // Keyline follows the phase: day's dark line vanishes into the night sky,
  // night's white one blows out on the pink page. Same shape either way.
  el.innerHTML = mouseSVG(
    color ?? MOUSE_COLOR_LIST[(Math.random() * MOUSE_COLOR_LIST.length) | 0],
    nightActive() ? MOUSE_KEYLINE_NIGHT : MOUSE_KEYLINE_DAY,
  );
  stageEl.appendChild(el);
  const dir = Math.random() < 0.5 ? -1 : 1; // face the direction of travel
  pops.push({
    el,
    x,
    y,
    vx: dir * (30 + Math.random() * 100),
    vy: -(160 + Math.random() * 200),
    rot: (Math.random() - 0.5) * 40,
    vr: (Math.random() - 0.5) * 420,
    life: 0.9,
    flip: dir,
  });
}

export function updatePops(dt) {
  // Read once per frame, not per particle.
  const nightScale = nightActive() ? NIGHT_POP_SCALE : 1;
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i];
    p.life -= dt;
    if (p.life <= 0) {
      p.el.remove();
      pops.splice(i, 1);
      continue;
    }
    p.vy += 980 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    p.el.style.opacity = Math.min(1, p.life / 0.35);
    p.el.style.transform = `translate(${p.x - 18}px, ${p.y - 14}px) rotate(${p.rot}deg) scale(${p.flip * nightScale}, ${nightScale})`;
  }
}
