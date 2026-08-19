// Turn the working level into the TypeScript that goes in `levels.ts`.
//
// The share link is how a level travels; this is how it SHIPS. A level's last
// mile is always a diff to `packages/shared/src/goomba/levels.ts`, reviewed
// like any other code, so the editor's job at the end is to hand over
// something that can be pasted into that array and read by a person — same
// shape, same key order, same one-decimal numbers as the levels already there.
//
// It deliberately does not emit the comment block. Every level in that file
// carries a paragraph explaining which shortcut each ugly bit of geometry
// exists to close, and a generator cannot know that — the designer writes it.

/** Match the file's numbers: integers stay bare, everything else keeps the one
 * decimal the save format stores. */
const n = (v) => {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};
const pt = (p) => `[${n(p[0])}, ${n(p[1])}]`;
const pts = (list) => list.map(pt).join(", ");

/** Single-quoted, with the quotes and backslashes a level name might contain
 * escaped — titles carry `·` and the occasional apostrophe. */
const str = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export function toTypeScript(L) {
  const lines = [];
  lines.push(`  { name: ${str(L.name || "untitled")}, budget: 4,`);
  if (typeof L.maxSpeed === "number") lines.push(`    maxSpeed: ${n(L.maxSpeed)},`);
  lines.push(`    start: ${pt(L.start)},`);
  lines.push(
    L.terrain.length
      ? `    terrain: [\n${L.terrain.map((poly) => `      [${pts(poly)}]`).join(",\n")} ],`
      : `    terrain: [],`,
  );
  lines.push(`    goal: ${pt(L.goal)},`);
  if (L.cans?.length) lines.push(`    cans: [${pts(L.cans)}],`);
  if (L.cushions?.length)
    lines.push(
      `    cushions: [${L.cushions.map((c) => `{ x: ${n(c.x)}, y: ${n(c.y)}, w: ${n(c.w)} }`).join(", ")}],`,
    );
  if (L.pops?.length)
    lines.push(
      `    pops: [\n${L.pops
        .map((p) => `      { x: ${n(p.x)}, y: ${n(p.y)}, deg: ${n(p.deg)}, spd: ${n(p.spd)} }`)
        .join(",\n")} ],`,
    );
  if (L.bumpers?.length)
    lines.push(
      `    bumpers: [${L.bumpers.map((b) => `{ x: ${n(b.x)}, y: ${n(b.y)} }`).join(", ")}],`,
    );
  const sol = L.solution ?? [];
  lines.push(
    sol.length
      ? `    solution: [ ${sol.map(([a, b]) => `[${pt(a)}, ${pt(b)}]`).join(",\n                ")} ] },`
      : `    solution: [] },`,
  );
  return lines.join("\n");
}
