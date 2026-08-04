import { defineConfig } from "vite";

export default defineConfig({
  // Relative base — see apps/hex-clicker/vite.config.ts. This app assembles to
  // the root of dist/ rather than a subdirectory, but keeping it relative means
  // it also works when previewed from a path.
  base: "./",
  server: { host: true },
});
