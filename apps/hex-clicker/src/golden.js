// GOLDEN MOUSE — the fun spike. The SERVER owns when one exists and for how
// long (see HexSim); this module owns what it looks like on this phone.
// Catching it triggers team-wide ZOOMIES: everyone's pets ×mods.zoomMult.
//
// Position is deliberately per-phone: the spawn seed drives a deterministic
// placement, but each phone bounces the mouse inside its own layout (HUD and
// dock heights differ), so "where it is" can drift between devices. That's
// fine — the mechanic is "a golden mouse is up, somebody grab it", and ANY
// phone's tap catches it for the whole team.

import { mulberry32 } from "@escape-cats/shared";
import { stageEl, goldenEl, hudEl, dockEl } from "./dom.js";
import { mods, wallNow, nightActive } from "./state.js";
import { floatNum } from "./fx.js";
import { transport } from "./net";
import { mouseParts, MOUSE_BOX, MOUSE_KEYLINE_DAY, MOUSE_KEYLINE_NIGHT } from "./art.js";

const GOLD_MARGIN = 10; // px of stage edge the golden won't drift past

// The mouse, gilded. Same box as the click-pop, so it sits in the same art
// family at a glance — only the material differs. (Gold is a gradient rather
// than flat #ffd44d, which would read as "the yellow mouse".)
// Keyline follows the phase for the same reason the click-pop's does: a golden
// can be on screen in either one, and each phase has exactly one line color
// that survives its background.
const goldenMouseSVG = () =>
  `<svg viewBox="0 0 ${MOUSE_BOX.w} ${MOUSE_BOX.h}" xmlns="http://www.w3.org/2000/svg">
     <defs>
       <linearGradient id="gmBody" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0" stop-color="#fff6c4"/><stop offset=".45" stop-color="#ffd44d"/><stop offset="1" stop-color="#c98a12"/>
       </linearGradient>
     </defs>
     ${mouseParts("url(#gmBody)", nightActive() ? MOUSE_KEYLINE_NIGHT : MOUSE_KEYLINE_DAY)}
     <path d="M20 24 C22 20 26 17.5 31 16.5" fill="none" stroke="#fffbe6" stroke-width="1.7" stroke-linecap="round" opacity=".8"/>
   </svg>`;

// Live-golden state, exported for the cat (her eyes track it, ears swivel).
export const goldState = { active: false, id: 0, x: 0, y: 0 };
let vx = 0,
  vy = 0,
  bornAt = 0,
  lifeS = 0;

// The reachable box, in #stage-local px: #hud and #dock are fixed overlays ON
// TOP of the stage, so "inside the stage" is not the same as "tappable".
// Measured per call — the dock's height moves as the shop opens and collapses.
function goldBounds() {
  const sr = stageEl.getBoundingClientRect();
  const gw = goldenEl.offsetWidth || 62,
    gh = goldenEl.offsetHeight || 62;
  const occluderRect = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0)
      return null;
    return el.getBoundingClientRect();
  };
  let minY = GOLD_MARGIN,
    maxY = sr.height - gh - GOLD_MARGIN;
  const hr = occluderRect(hudEl);
  if (hr) minY = Math.max(minY, hr.bottom - sr.top + GOLD_MARGIN);
  const dr = occluderRect(dockEl);
  if (dr) maxY = Math.min(maxY, dr.top - sr.top - gh - GOLD_MARGIN);
  const minX = GOLD_MARGIN,
    maxX = Math.max(GOLD_MARGIN, sr.width - gw - GOLD_MARGIN);
  if (maxY < minY) {
    const mid = (minY + maxY) / 2;
    minY = maxY = mid;
  }
  return { minX, minY, maxX, maxY };
}

/** A snapshot said a golden is up: place it from its seed and show it. */
export function spawnGold(gold) {
  goldState.active = true;
  goldState.id = gold.id;
  bornAt = gold.bornAt;
  lifeS = gold.life;
  goldenEl.innerHTML = goldenMouseSVG();
  const rnd = mulberry32(gold.seed);
  const b = goldBounds();
  goldState.x = b.minX + rnd() * (b.maxX - b.minX);
  goldState.y = b.minY + rnd() * (b.maxY - b.minY);
  const ang = rnd() * Math.PI * 2,
    sp = 22 + rnd() * 18;
  vx = Math.cos(ang) * sp;
  vy = Math.sin(ang) * sp;
  goldenEl.style.left = goldState.x + "px";
  goldenEl.style.top = goldState.y + "px";
  goldenEl.style.opacity = "1";
  goldenEl.style.display = "grid";
}

export function despawnGold() {
  goldState.active = false;
  goldenEl.style.display = "none";
  goldenEl.style.opacity = "1";
}

/** Per-frame drift + bounce. Lifetime runs on the shared clock so every phone
 * sees the same escape moment even if the server's despawn broadcast lags. */
export function moveGold(dt) {
  if (!goldState.active) return;
  const leftS = bornAt + lifeS * 1000 - wallNow();
  if (leftS <= 0) {
    despawnGold();
    return;
  }
  goldState.x += vx * dt;
  goldState.y += vy * dt;
  const { minX, minY, maxX, maxY } = goldBounds();
  if (goldState.x < minX || goldState.x > maxX) {
    vx *= -1;
    goldState.x = Math.max(minX, Math.min(maxX, goldState.x));
  }
  if (goldState.y < minY || goldState.y > maxY) {
    vy *= -1;
    goldState.y = Math.max(minY, Math.min(maxY, goldState.y));
  }
  goldenEl.style.left = goldState.x + "px";
  goldenEl.style.top = goldState.y + "px";
  goldenEl.style.opacity =
    leftS < 2000 ? (leftS / 2000).toFixed(2) : "1";
}

export function initGoldenInput() {
  goldenEl.addEventListener(
    "pointerdown",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!goldState.active) return;
      const rect = stageEl.getBoundingClientRect();
      // Optimistic: hide it and float the buff callout now; the server's
      // snapshot delivers the actual team-wide Zoomies deadline.
      floatNum(
        goldState.x - rect.left + 30,
        goldState.y - rect.top + 20,
        "⚡ ×" + mods.zoomMult,
      );
      transport.send({ type: "catchGold", id: goldState.id });
      despawnGold();
    },
    { passive: false },
  );
}
