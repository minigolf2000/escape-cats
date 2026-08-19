// The bench view: camera maths and one draw call.
//
// This is NOT the game's art. Goomba Glider's canvas paints a gradient sky,
// ambient confetti and a cat on a board; the editor paints the level's DATA —
// the same schematic vocabulary the ride cards use (`tools/goomba/ridecards.mjs`),
// because the thing a designer is looking at here is geometry, and geometry
// reads better with its vertices showing. The two never disagree about the
// level because neither of them is the level: `levels.ts` is.
import { bandPoints } from "@escape-cats/shared";

const BAND_COLORS = ["#ff5db1", "#57e6c9", "#ffd166", "#b18bff"];
const TERRAIN = "#f3e9d6";
const CAN = "#57e6c9";
const POP = "#ffd166";
const HOT = "#ff5db1";
const CUSHION = "#ff9dce";

export const makeCam = () => ({ x: 55, y: 100, s: 3 });

/** Frame a level: fit its bounds with a little air, since a designer usually
 * wants to see what is just off the edge too. */
export function fitCam(cam, init, W, H) {
  const b = init.bounds;
  const s = Math.min(W / (b.x1 - b.x0 + 20), H / (b.y1 - b.y0 + 20));
  cam.x = (b.x0 + b.x1) / 2;
  cam.y = (b.y0 + b.y1) / 2;
  cam.s = Math.max(0.4, s);
  return cam;
}

const toScreen = (cam, W, H, x, y) => ({
  x: (x - cam.x) * cam.s + W / 2,
  y: (y - cam.y) * cam.s + H / 2,
});
export const toWorld = (cam, W, H, px, py) => ({
  x: (px - W / 2) / cam.s + cam.x,
  y: (py - H / 2) / cam.s + cam.y,
});

/** The band's sagging curve, from the SHIPPED physics (`bandPoints`) — so the
 * drawn curve is exactly the surface she will collide with, by construction
 * rather than by a copy kept in step. Takes an endpoint pair. */
const bandCurve = ([a, b]) => bandPoints({ ax: a[0], ay: a[1], bx: b[0], by: b[1] });

/** Where a popper's aim handle sits, in world units — the arm length tracks
 * launch speed. One copy: main.js grabs the same point this file draws, so the
 * dot you can see is always the dot you can click. */
export const popTip = (pp) => {
  const a = (pp.deg * Math.PI) / 180;
  const arm = 5 + pp.spd / 14;
  return [pp.x + Math.cos(a) * arm, pp.y + Math.sin(a) * arm];
};

export function draw(ctx, opts) {
  const { cam, W, H, level, trace, runner, cheat, hover, selection } = opts;
  const S = (x, y) => toScreen(cam, W, H, x, y);
  const path = (points) => {
    ctx.beginPath();
    points.forEach(([x, y], i) => {
      const p = S(x, y);
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    });
  };

  ctx.fillStyle = "#150a2a";
  ctx.fillRect(0, 0, W, H);

  // ---- grid. Ten-unit majors because that is the grid the shortcut hunt
  // enumerates on, so "on a major" is the resolution the gate actually sees.
  {
    const tl = toWorld(cam, W, H, 0, 0),
      br = toWorld(cam, W, H, W, H);
    const step = cam.s > 6 ? 5 : 10;
    ctx.lineWidth = 1;
    for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
      const p = S(x, 0);
      ctx.strokeStyle = x % 50 === 0 ? "rgba(201,189,240,.16)" : "rgba(201,189,240,.07)";
      ctx.beginPath();
      ctx.moveTo(p.x, 0);
      ctx.lineTo(p.x, H);
      ctx.stroke();
    }
    for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) {
      const p = S(0, y);
      ctx.strokeStyle = y % 50 === 0 ? "rgba(201,189,240,.16)" : "rgba(201,189,240,.07)";
      ctx.beginPath();
      ctx.moveTo(0, p.y);
      ctx.lineTo(W, p.y);
      ctx.stroke();
    }
  }

  // ---- terrain
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  level.terrain.forEach((poly, pi) => {
    if (poly.length < 2) {
      if (poly.length === 1) {
        const p = S(poly[0][0], poly[0][1]);
        ctx.fillStyle = TERRAIN;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, 6.283);
        ctx.fill();
      }
      return;
    }
    const picked = selection?.kind === "poly" && selection.i === pi;
    ctx.strokeStyle = picked ? "#fff" : TERRAIN;
    ctx.lineWidth = Math.max(1.5, 1.5 * cam.s);
    path(poly);
    ctx.stroke();
  });

  // ---- cushions: a soft pad she bounces off (restitution > 1)
  for (const c of level.cushions ?? []) {
    const p = S(c.x, c.y);
    ctx.fillStyle = CUSHION;
    const w = c.w * cam.s,
      h = Math.max(3, 3 * cam.s);
    ctx.beginPath();
    ctx.roundRect(p.x, p.y, w, h, Math.min(h / 2, 6));
    ctx.fill();
  }

  // ---- poppers: trigger radius, and the direction they fire
  for (const pp of level.pops ?? []) {
    const p = S(pp.x, pp.y);
    ctx.strokeStyle = "rgba(255,209,102,.55)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6 * cam.s, 0, 6.283);
    ctx.stroke();
    ctx.setLineDash([]);
    // Aim arm length tracks launch speed, so a row of poppers reads as a row
    // of different launches rather than a row of identical circles.
    const [tx, ty] = popTip(pp);
    const tip = S(tx, ty);
    ctx.strokeStyle = HOT;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.fillStyle = POP;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 4, 0, 6.283);
    ctx.fill();
  }

  // ---- bumpers
  for (const b of level.bumpers ?? []) {
    const p = S(b.x, b.y);
    ctx.fillStyle = HOT;
    ctx.strokeStyle = POP;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5.5 * cam.s, 0, 6.283);
    ctx.fill();
    ctx.stroke();
  }

  // ---- watering cans, drawn at their real pickup radius: the difference
  // between a can that gates a route and a can that chimes as she flies past
  // is entirely a question of where that circle sits.
  (level.cans ?? []).forEach((m) => {
    const p = S(m[0], m[1]);
    ctx.strokeStyle = "rgba(87,230,201,.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7.5 * cam.s, 0, 6.283);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = CAN;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3 * cam.s, 0, 6.283);
    ctx.stroke();
  });

  // ---- start and goal
  const st = S(level.start[0], level.start[1]);
  ctx.strokeStyle = "#c9bdf0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(st.x, st.y, 4 * cam.s, 0, 6.283);
  ctx.stroke();
  ctx.fillStyle = "#c9bdf0";
  ctx.font = `${Math.max(11, 2.4 * cam.s)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("start", st.x, st.y - 5 * cam.s);
  const gl = S(level.goal[0], level.goal[1]);
  ctx.font = `${Math.max(16, 6 * cam.s)}px system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText("🪴", gl.x, gl.y);
  ctx.textBaseline = "alphabetic";

  // ---- the traced ride. Bright where she is airborne, dim where she is
  // riding something: the shape of the bright parts IS the fun (duration ×
  // percent airborne is what predicted the fun ranking, twice).
  if (trace) {
    for (const air of [0, 1]) {
      ctx.strokeStyle = air ? "rgba(255,255,255,.9)" : "rgba(255,255,255,.28)";
      ctx.lineWidth = air ? 2.4 : 1.6;
      ctx.beginPath();
      let pen = false;
      for (const [px, py, g] of trace.path) {
        if ((g ? 0 : 1) !== air) {
          pen = false;
          continue;
        }
        const p = S(px, py);
        pen ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
        pen = true;
      }
      ctx.stroke();
    }
    for (const [kind, ex, ey] of trace.events) {
      const p = S(ex, ey);
      ctx.strokeStyle = kind === "pop" ? POP : kind === "bump" ? HOT : CAN;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, 6.283);
      ctx.stroke();
    }
  }

  // ---- the solution, one colour per player's band
  (level.solution ?? []).forEach((bd, i) => {
    const picked = selection?.kind === "band" && selection.i === i;
    ctx.strokeStyle = BAND_COLORS[i % 4];
    ctx.lineWidth = Math.max(2, 1.4 * cam.s);
    path(bandCurve(bd));
    ctx.stroke();
    for (const end of bd) {
      const p = S(end[0], end[1]);
      ctx.fillStyle = picked ? "#fff" : BAND_COLORS[i % 4];
      ctx.beginPath();
      ctx.arc(p.x, p.y, picked ? 6 : 4.5, 0, 6.283);
      ctx.fill();
    }
  });

  // ---- the cheat the hunter found, if it found one. Drawn on top, in red,
  // because this is the single most useful thing the editor ever shows: not
  // "your level is broken" but "here is the one band that beats it".
  if (cheat) {
    cheat.bands.forEach((bd) => {
      ctx.strokeStyle = "#ff4a4a";
      ctx.lineWidth = Math.max(2, 1.4 * cam.s);
      ctx.setLineDash([8, 6]);
      path(bandCurve(bd));
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  // ---- vertex handles, last, so they are always grabbable
  level.terrain.forEach((poly, pi) =>
    poly.forEach((v, vi) => {
      const p = S(v[0], v[1]);
      const picked = selection?.kind === "vertex" && selection.i === pi && selection.j === vi;
      const hot = hover?.kind === "vertex" && hover.i === pi && hover.j === vi;
      ctx.fillStyle = picked ? "#fff" : hot ? POP : "rgba(243,233,214,.75)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, picked || hot ? 5.5 : 3.5, 0, 6.283);
      ctx.fill();
    }),
  );

  // ---- Goomba herself, mid-playback
  if (runner) {
    const p = S(runner.x, runner.y);
    ctx.fillStyle = "#ffd166";
    ctx.strokeStyle = "#150a2a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(4, 2.2 * cam.s), 0, 6.283);
    ctx.fill();
    ctx.stroke();
  }
}
