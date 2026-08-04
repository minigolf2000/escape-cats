import { defineConfig } from "vite";

export default defineConfig({
  // Relative base is load-bearing for the single-project deploy: the same
  // build is served both at a vanity domain root (hexxygon.com/, which
  // redirects to /hexxygon/) and at a path (preview-url/hexxygon/). Only a
  // relative base resolves assets correctly in both. Safe because nothing here
  // routes on the path — the room comes from ?room= (see net.ts).
  base: "./",
  server: { host: true },
});
