/**
 * Assemble every surface into one dist/ tree: ONE Vercel project, one origin,
 * so a player's localStorage pid follows them from the lobby into a game.
 * Vite apps are copied from their dist/; static surfaces verbatim.
 */
import { cp, mkdir, rm, access, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = join(repoRoot, "dist");

/** [source, dest-under-dist, label]. The lobby owns "." (the landing page)
 * and goes first so a later collision is visible rather than silent. */
const SURFACES = [
  ["apps/lobby/dist", ".", "Team lobby (landing page)"],
  // Not /hex and /goomba: the vanity domains redirect here, and a guessable
  // path walks a player into a game unsorted. /g00mBa's casing is
  // load-bearing -- /g00mba is a 404.
  ["apps/hex-clicker/dist", "hexxygon", "Hex Clicker (coop)"],
  ["apps/goomba-glider/dist", "g00mBa", "Goomba Glider (coop)"],
  ["apps/proctor/dist", "proctor", "Proctor dashboard"],
  // Chat must be on THIS origin: it reads the lobby's localStorage pid.
  ["apps/chat/dist", "chat", "Per-team chat"],
  // Single-file tools land as <name>/index.html -- the path IS the file.
  ["tools/qr-studio.html", "qr-studio", "QR Art Studio"],
  ["tools/reveal-lab.html", "reveal-lab", "Night reveal wall lab"],
];

const exists = async (p) =>
  access(p).then(
    () => true,
    () => false,
  );

await rm(outRoot, { recursive: true, force: true });
await mkdir(outRoot, { recursive: true });

for (const [from, to, label] of SURFACES) {
  const src = join(repoRoot, from);
  if (!(await exists(src))) {
    // A Vite app whose build never ran would silently ship an empty route.
    throw new Error(
      `assemble: missing ${from} — did \`npm run build --workspaces\` run first?`,
    );
  }
  // A single-file surface becomes <dest>/index.html, so it is reachable at a
  // bare directory path like the built apps are.
  const dest = (await stat(src)).isDirectory()
    ? join(outRoot, to)
    : join(outRoot, to, "index.html");
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
  console.log(`  ${from}  ->  dist/${to}   (${label})`);
}

console.log(`\nAssembled ${SURFACES.length} surfaces into dist/`);
