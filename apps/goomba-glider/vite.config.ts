import { defineConfig } from "vite";
import { execSync } from "node:child_process";
// @ts-expect-error — a plain .mjs build plugin shared by both game clients.
import { netHints } from "../../scripts/vite-net-hints.mjs";

/** What build is this? — stamped in at build time and printed by `?pixels`.
 *
 * A phone hides the query string and caches the HTML shell, so "is the thing I
 * just deployed the thing on this screen?" was answered twice in one afternoon
 * by curling the deployed asset and diffing its hash by hand, and answered wrong
 * in between: two rounds of diagnosis were spent photographing a build that did
 * not have the instrument in it yet. The readout is the one surface that is
 * already being photographed, so the answer belongs on it.
 *
 * SHA first because it names the commit, time second because Vercel redeploys
 * the same commit and only the clock tells those apart. Falls back to `local`
 * outside a checkout, and never throws: a build must not fail because git is
 * missing. */
function buildId(): string {
  const env = process.env.VERCEL_GIT_COMMIT_SHA;
  let sha = env || "";
  if (!sha) {
    try {
      sha = execSync("git rev-parse HEAD", {
        stdio: ["ignore", "pipe", "ignore"],
      }).toString().trim();
    } catch { /* no checkout, no git — `local` says so */ }
  }
  const when = new Date().toISOString().slice(5, 16).replace("T", " ");
  return `${sha ? sha.slice(0, 7) : "local"} ${when}`;
}

export default defineConfig({
  // Absolute base matching the dist/ subdirectory this app is assembled into —
  // same rule as hex-clicker's config, and for the same trailing-slash reason
  // (see that file's comment, or the README's "Vanity domains" section).
  // /g00mBa's casing is load-bearing: URL paths are case-sensitive.
  base: "/g00mBa/",
  // preconnect to the room server + modulepreload the partysocket chunk;
  // see scripts/vite-net-hints.mjs for what each one buys.
  plugins: [netHints({ preloadModules: ["/partysocket/"] })],
  define: { __BUILD__: JSON.stringify(buildId()) },
  server: { host: true },
});
