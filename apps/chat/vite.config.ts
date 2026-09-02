import { defineConfig } from "vite";

export default defineConfig({
  // Absolute base matching the dist/ subdirectory — see
  // apps/hex-clicker/vite.config.ts for why relative breaks.
  base: "/chat/",
  server: { host: true },
});
