/**
 * THE TWO SITES, one per game, each rooted at `/` on its own domain. The one
 * table `assemble.mjs` builds from and `check-routing.mjs` crawls — so a
 * renamed output directory cannot leave the check passing on the wrong tree.
 *
 * `surfaces` is what goes in ([source, dest-under-the-site-root, label]; `.` is
 * the root, a single file lands as <dest>/index.html). `entries` is what a
 * person can type.
 */
export const SITES = {
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
    entries: ["/", "/reveal-lab", "/qr-studio"],
  },
  goomba: {
    out: "dist/goomba",
    domain: "g00.mba",
    surfaces: [["apps/goomba-glider/dist", ".", "Goomba Glider"]],
    entries: ["/"],
  },
};

/** The site named on the command line, or every site. Exits on a typo rather
 * than silently building nothing. */
export function pickSites(name) {
  if (name && !SITES[name]) {
    console.error(`no site "${name}" — try ${Object.keys(SITES).join(" or ")}`);
    process.exit(1);
  }
  return Object.entries(SITES).filter(([n]) => !name || n === name);
}
