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
 * It used to be ONE origin with the games in subdirectories and the vanity
 * domains 307-redirecting into them, because several surfaces shared a
 * player's per-origin localStorage. The games share nothing now, so an origin
 * each is the honest shape.
 *
 * Run: node scripts/assemble.mjs [hex|goomba]
 */
import { cp, mkdir, rm, access, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { pickSites } from "./sites.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exists = async (p) => access(p).then(() => true, () => false);

for (const [name, site] of pickSites(process.argv[2])) {
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
