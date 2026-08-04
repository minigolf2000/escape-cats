/**
 * Assemble every deployable surface into a single dist/ tree.
 *
 * The whole repo ships as ONE Vercel project. Each surface lands in its own
 * subdirectory here; vercel.json then rewrites incoming hostnames onto those
 * subdirectories, so a vanity domain serves its app from the domain root
 * while preview deployments reach the same build by path.
 *
 * Two kinds of surface:
 *   - Vite apps  — built by `npm run build --workspaces`, dist/ copied here.
 *   - Static     — no build step, folder copied verbatim.
 */
import { cp, mkdir, rm, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = join(repoRoot, "dist");

/** [source, destination-under-dist, human label]. "." lands at the dist root —
 * the lobby is the landing page, so it owns / rather than a subdirectory. It
 * goes first so a later surface would visibly collide rather than be
 * silently overwritten by it. */
const SURFACES = [
  ["apps/lobby/dist", ".", "Team lobby (landing page)"],
  ["apps/hex-clicker/dist", "hex", "Hex Clicker (coop)"],
  ["apps/angry-goomba/dist", "goomba", "Angry Goomba (coop)"],
  ["apps/proctor/dist", "proctor", "Proctor dashboard"],
  ["hex", "solo-hex", "Hex Clicker (solo) + QR Studio"],
  ["prototypes", "prototypes", "Prototypes menu + Goomba Rider"],
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
  await cp(src, join(outRoot, to), { recursive: true });
  console.log(`  ${from}  ->  dist/${to}   (${label})`);
}

console.log(`\nAssembled ${SURFACES.length} surfaces into dist/`);
