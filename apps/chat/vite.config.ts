import { defineConfig } from "vite";

export default defineConfig({
  // Absolute base, matching the dist/ subdirectory this app is assembled into.
  // It must NOT be relative — see apps/hex-clicker/vite.config.ts for the
  // white-screen this causes when the served URL's directory depth differs from
  // what a "./assets/" reference assumes.
  base: "/chat/",
  server: { host: true },
});
