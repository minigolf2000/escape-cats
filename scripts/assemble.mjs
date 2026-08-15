/**
 * Assemble every deployable surface into a single dist/ tree.
 *
 * The whole repo ships as ONE Vercel project. Each surface lands in its own
 * subdirectory here. The vanity domains REDIRECT into those subdirectories
 * rather than rewriting to them, so every surface is served from one origin --
 * which is what lets a player's localStorage pid, and therefore the team the
 * proctor put them on, follow them from the lobby into a game.
 *
 * Two kinds of surface:
 *   - Vite apps  — built by `npm run build --workspaces`, dist/ copied here.
 *   - Static     — no build step, folder copied verbatim.
 */
import { cp, mkdir, rm, access, stat } from "node:fs/promises";
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
  // The game paths are deliberately not /hex and /goomba: they are what the
  // vanity domains redirect to, and a player who guesses the path would walk
  // into a game without being sorted onto a team first. /g00mBa's casing is
  // load-bearing -- URL paths are case-sensitive, so /g00mba is a 404.
  ["apps/hex-clicker/dist", "hexxygon", "Hex Clicker (coop)"],
  ["apps/goomba-glider/dist", "g00mBa", "Goomba Glider (coop)"],
  ["apps/proctor/dist", "proctor", "Proctor dashboard"],
  // Chat must live on THIS origin, not behind a vanity domain: it reads the
  // same localStorage pid the lobby wrote, and localStorage is per-origin.
  ["apps/chat/dist", "chat", "Per-team chat"],
  // The two standalone tools. Each is one self-contained file with no relative
  // references, so landing it as <name>/index.html puts it at its own pretty
  // URL with no rewrite involved -- the path IS the file.
  ["tools/qr-studio.html", "qr-studio", "QR Art Studio"],
  ["tools/reveal-lab.html", "reveal-lab", "Night reveal wall lab"],
  // Its own surface so g00.mba/ar has somewhere short to land. The file also
  // ships inside prototypes/ below; duplication is the same deal Goomba Glider
  // already has, and is cheaper than a rewrite that would have to dodge the
  // vanity domain's catch-all.
  ["prototypes/scent-tracker.html", "ar", "Scent Tracker (AR prototype)"],
  ["prototypes", "prototypes", "Prototypes menu + Goomba Glider"],
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
