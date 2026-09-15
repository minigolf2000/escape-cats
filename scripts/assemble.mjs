/**
 * Assemble TWO sites, one per game, each rooted at `/`:
 *
 *   dist/hex/      -> hexxygon.com    (plus the two standalone tool pages)
 *   dist/goomba/   -> g00.mba
 *
 * Two Vercel projects over one repo: each sets its own Build Command
 * (`npm run build:hex` / `npm run build:goomba`) and Output Directory, and
 * both read the one `vercel.json` at the root.
 *
 * It used to be ONE origin with the games in subdirectories (`/hexxygon/`,
 * `/g00mBa/`) and the vanity domains 307-redirecting into them. That existed
 * because five surfaces shared a player's per-origin localStorage — the pid
 * the lobby wrote was the pid the game read. The games share nothing now, so
 * an origin each is the honest shape, and the obscure paths have nothing left
 * to protect (they existed so a guessable URL could not walk a player into a
 * game before the proctor had sorted them).
 *
 * Run: node scripts/assemble.mjs [hex|goomba]
 */
import { cp, mkdir, rm, access, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** [source, dest-under-the-site-root, label]. `.` is the site root. A
 * single-file surface lands as <dest>/index.html, so it is reachable at a bare
 * directory path like a built app is. */
const SITES = {
  hex: {
    out: "dist/hex",
    domain: "hexxygon.com",
    surfaces: [
      ["apps/hex-clicker/dist", ".", "Hex Clicker"],
      // Kept at hexxygon.com/reveal-lab by request; qr-studio rides along
      // because this is the only site left to host it. Both are one HTML file
      // with no build and no dependency on either game.
      ["tools/reveal-lab.html", "reveal-lab", "Night reveal wall lab"],
      ["tools/qr-studio.html", "qr-studio", "QR Art Studio"],
    ],
  },
  goomba: {
    out: "dist/goomba",
    domain: "g00.mba",
    surfaces: [["apps/goomba-glider/dist", ".", "Goomba Glider"]],
  },
};

const exists = async (p) => access(p).then(() => true, () => false);

const which = process.argv[2];
if (which && !SITES[which]) {
  throw new Error(`assemble: no site "${which}" — try ${Object.keys(SITES).join(" or ")}`);
}

for (const [name, site] of Object.entries(SITES)) {
  if (which && which !== name) continue;
  const outRoot = join(repoRoot, site.out);
  await rm(outRoot, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });
  console.log(`\n${name}  (${site.domain})`);
  for (const [from, to, label] of site.surfaces) {
    const src = join(repoRoot, from);
    if (!(await exists(src))) {
      // A Vite app whose build never ran would silently ship an empty site.
      throw new Error(
        `assemble: missing ${from} — did \`npm run build --workspaces\` run first?`,
      );
    }
    const dest = (await stat(src)).isDirectory()
      ? join(outRoot, to)
      : join(outRoot, to, "index.html");
    await mkdir(dirname(dest), { recursive: true });
    await cp(src, dest, { recursive: true });
    console.log(`  ${from}  ->  ${site.out}/${to === "." ? "" : to}   (${label})`);
  }
}
