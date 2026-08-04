import { defineConfig } from "vite";

export default defineConfig({
  // Relative base is load-bearing — see apps/hex-clicker/vite.config.ts.
  base: "./",
  server: { host: true },
});
