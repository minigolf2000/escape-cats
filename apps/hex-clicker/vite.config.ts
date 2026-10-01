import { defineConfig } from "vite";

/** Vercel's Web Analytics client config (where its script and endpoints
 * live), handed to the build as an env var once Analytics is enabled on the
 * project. Empty locally and that is fine — `inject` falls back to
 * `/_vercel/insights`. See src/analytics.js. */
const vaConf = JSON.stringify(process.env.VERCEL_OBSERVABILITY_CLIENT_CONFIG ?? "");

export default defineConfig({
  // The app IS the site: hexxygon.com serves this at the root. It used to be
  // `/hexxygon/`, a subdirectory of one assembled origin, because four
  // surfaces shared an origin so they could share a player's localStorage.
  // Nothing is shared now, and a per-game origin is the honest shape — see
  // "Two sites" in CLAUDE.md.
  base: "/",
  define: { __VA_CONF__: vaConf },
  server: { host: true },
});
