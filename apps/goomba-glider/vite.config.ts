import { defineConfig } from "vite";
import { execSync } from "node:child_process";

/** Build id, stamped in and printed by `?pixels` so a photographed readout says
 * which build it is. SHA first (names the commit), time second (Vercel
 * redeploys the same commit). Falls back to `local`; must never throw. */
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

/** Vercel's Web Analytics client config (where its script and endpoints
 * live), handed to the build as an env var once Analytics is enabled on the
 * project. Empty locally and that is fine — `inject` falls back to
 * `/_vercel/insights`. See src/analytics.js. */
const vaConf = JSON.stringify(process.env.VERCEL_OBSERVABILITY_CLIENT_CONFIG ?? "");

export default defineConfig({
  // The app IS the site: g00.mba serves this at the root. It used to be
  // `/g00mBa/` (casing load-bearing), a subdirectory of one assembled origin
  // shared with three other surfaces — see "Two sites" in CLAUDE.md.
  base: "/",
  define: { __BUILD__: JSON.stringify(buildId()), __VA_CONF__: vaConf },
  server: { host: true },
});
