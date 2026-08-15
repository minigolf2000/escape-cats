// Goomba Glider level verifier: every level must FAIL with no bands and WIN with its solution.
import { LEVELS, simulate } from "./lib.mjs";

let allOk = true;
LEVELS.forEach((L, i) => {
  const empty = simulate(i, []);
  const sol = simulate(i, L.solution);
  const lens = (L.solution ?? []).map(([a, b]) => +Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(1));
  const okEmpty = empty.result !== "win";
  const okSol = sol.result === "win";
  const okLen = lens.every((l) => l <= 58);
  if (!okEmpty || !okSol || !okLen) allOk = false;
  console.log(`L${i + 1}: no-bands=${empty.result}@${empty.t}s ${okEmpty ? "OK" : "!! should fail"} | solution=${sol.result}@${sol.t}s ${okSol ? "OK" : "!! should win"} | band lens=${lens.join(",")}`);
  if (!okSol || process.env.TRAJ) {
    const tr = sol.traj.filter((_, j) => j % 6 === 0).map((p) => p.join(",")).join(" ");
    console.log(`  sol traj: ${tr}`);
  }
  if (!okEmpty) {
    const tr = empty.traj.filter((_, j) => j % 6 === 0).map((p) => p.join(",")).join(" ");
    console.log(`  empty traj: ${tr}`);
  }
});
console.log(allOk ? "ALL LEVELS PASS" : "FAILURES ABOVE");
process.exit(allOk ? 0 : 1);
