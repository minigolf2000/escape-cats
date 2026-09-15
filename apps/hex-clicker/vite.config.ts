import { defineConfig } from "vite";

export default defineConfig({
  // The app IS the site: hexxygon.com serves this at the root. It used to be
  // `/hexxygon/`, a subdirectory of one assembled origin, because four
  // surfaces shared an origin so they could share a player's localStorage.
  // Nothing is shared now, and a per-game origin is the honest shape — see
  // "Two sites" in CLAUDE.md.
  base: "/",
  server: { host: true },
});
