import { defineConfig } from "vite";
// @ts-expect-error — a plain .mjs build plugin shared by both game clients.
import { netHints } from "../../scripts/vite-net-hints.mjs";

export default defineConfig({
  // Absolute, matching the dist/ subdirectory this app is assembled into. NOT
  // relative: Vercel normalises /hexxygon/ to /hexxygon, against which
  // "./assets/" resolves to /assets/ — the lobby's — and the script 404s.
  base: "/hexxygon/",
  // preconnect to the room server + modulepreload the partysocket chunk;
  // see scripts/vite-net-hints.mjs for what each one buys.
  plugins: [netHints({ preloadModules: ["/partysocket/"] })],
  server: { host: true },
});
