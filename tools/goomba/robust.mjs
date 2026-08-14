// Robustness: partial solutions must fail; jittered solutions should mostly still win.
import { LEVELS, simulate } from "./lib.mjs";

// deterministic pseudo-random jitter
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

LEVELS.forEach((L, i) => {
  const sol = L.solution ?? [];
  // partial solutions: drop each band in turn (only if >1 band)
  const partials = [];
  if (sol.length > 1)
    for (let k = 0; k < sol.length; k++)
      partials.push(simulate(i, sol.filter((_, j) => j !== k)).result);
  // jitter: 30 trials, each endpoint nudged up to ±3 units
  let wins = 0;
  const J = 3, N = 30;
  for (let t = 0; t < N; t++) {
    const jit = sol.map(([a, b]) => [
      [a[0] + (rnd() * 2 - 1) * J, a[1] + (rnd() * 2 - 1) * J],
      [b[0] + (rnd() * 2 - 1) * J, b[1] + (rnd() * 2 - 1) * J],
    ]);
    if (simulate(i, jit).result === "win") wins++;
  }
  const partOk = partials.every((p) => p !== "win");
  console.log(`L${i + 1}: partial-solutions=[${partials.join(", ") || "n/a"}] ${partOk ? "OK" : "!! a band is not needed"} | jitter ±3u: ${wins}/${N} win`);
});
