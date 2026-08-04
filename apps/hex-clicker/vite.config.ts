import { defineConfig } from "vite";

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
  server: { host: true },
});
