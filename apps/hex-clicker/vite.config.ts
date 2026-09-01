import { defineConfig } from "vite";
// @ts-expect-error — a plain .mjs build plugin shared by both game clients.
import { netHints } from "../../scripts/vite-net-hints.mjs";

export default defineConfig({
  // Absolute base, matching the dist/ subdirectory this app is assembled into.
  //
  // It must NOT be relative. Vercel serves with trailingSlash:false, so
  // /hexxygon/ is normalised to /hexxygon -- and against that URL a "./assets/"
  // reference resolves to /assets/, which is the lobby's asset directory, not
  // this app's. The page loads and the script 404s: a white screen.
  //
  // A relative base was correct while the vanity domains REWROTE here and the
  // app could be served from a domain root. They redirect now (#99), so this
  // app only ever lives at /hexxygon/.
  base: "/hexxygon/",
  // preconnect to the room server + modulepreload the partysocket chunk;
  // see scripts/vite-net-hints.mjs for what each one buys.
  plugins: [netHints({ preloadModules: ["/partysocket/"] })],
  server: { host: true },
});
