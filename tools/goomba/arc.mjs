// Popper ballistics helper — poppers set velocity exactly, so each arc is deterministic.
// Usage: node arc.mjs px py deg spd [shelfY]
// `spd` here is the EXIT speed, which is the level's `spd × 0.82` (capped at
// MAX_SPEED) — a popper overwrites her velocity, so that is the only speed it
// ever fires at, whatever she arrived with.
// Prints apex and, for a shelf at shelfY, the x where she DESCENDS through it (land here).
const [px, py, deg, spd, shelfY] = process.argv.slice(2).map(Number);
const r = deg * Math.PI / 180, vx = spd * Math.cos(r), vy = spd * Math.sin(r);
const G2 = 70; // y = py + vy t + 70 t^2  (G/2, G=140)
const tApex = -vy / 140;
console.log(`popper (${px},${py}) ${deg}° @${spd}  →  v=(${vx.toFixed(1)}, ${vy.toFixed(1)})`);
console.log(`  apex: t=${tApex.toFixed(2)}s at (${(px + vx * tApex).toFixed(1)}, ${(py + vy * tApex).toFixed(1)})  rise=${(vy * vy / 280).toFixed(1)}`);
for (const yy of (shelfY ? [shelfY] : [py - 50, py - 40, py - 30, py - 20])) {
  // solve 70t^2 + vy t + (py - yy) = 0
  const disc = vy * vy - 4 * G2 * (py - yy);
  if (disc < 0) { console.log(`  y=${yy}: never reached`); continue; }
  const t1 = (-vy - Math.sqrt(disc)) / (2 * G2), t2 = (-vy + Math.sqrt(disc)) / (2 * G2);
  const up = px + vx * t1, down = px + vx * t2;
  console.log(`  y=${yy}: rising through x=${up.toFixed(1)} (t=${t1.toFixed(2)}), DESCENDING through x=${down.toFixed(1)} (t=${t2.toFixed(2)})`);
}
