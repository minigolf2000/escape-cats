// Finger-slop trial for a draft's own solution: jitter every band end by up to
// `--slop` units and count how many of those runs still win. Not a grade —
// snap is the forgiveness (DESIGNING.md) and this only says whether it is
// reaching. Usage:
//   node draft/_slop.mjs [--draft goomba-word] [--slop 3] [--n 300]
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRun, stepRun, snapBand, SUB, RUN_MAX, initLevel } from "./_sim.mjs";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const HERE = dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(join(HERE, `${arg("--draft", "goomba-word")}.mjs`)).href);
const slop = Number(arg("--slop", 3)), n = Number(arg("--n", 300));

const L = initLevel(mod.buildLevel());
const sol = mod.buildLevel().solution;
const out = new Map();
for (let i = 0; i < n; i++) {
  const j = () => (Math.random() * 2 - 1) * slop;
  const bands = sol.map(([a, b]) =>
    snapBand(L, { ax: a[0] + j(), ay: a[1] + j(), bx: b[0] + j(), by: b[1] + j() }));
  const st = makeRun(L, bands);
  while (!st.result && st.t < RUN_MAX + 1) stepRun(st, SUB);
  const k = st.result ?? "timeout";
  out.set(k, (out.get(k) || 0) + 1);
}
console.log(`slop ±${slop} u over ${n} trials:`,
  [...out].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("  "));
