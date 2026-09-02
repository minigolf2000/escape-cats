import { defineConfig } from "vite";
import { execSync } from "node:child_process";
// @ts-expect-error — a plain .mjs build plugin shared by both game clients.
import { netHints } from "../../scripts/vite-net-hints.mjs";

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

export default defineConfig({
  // Absolute base matching the dist/ subdirectory (check-routing.mjs). The
  // casing is load-bearing: URL paths are case-sensitive.
  base: "/g00mBa/",
  // preconnect to the room server + modulepreload the partysocket chunk;
  // see scripts/vite-net-hints.mjs for what each one buys.
  plugins: [netHints({ preloadModules: ["/partysocket/"] })],
  define: { __BUILD__: JSON.stringify(buildId()) },
  server: { host: true },
});
