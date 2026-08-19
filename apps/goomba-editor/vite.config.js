import { defineConfig } from "vite";

export default defineConfig({
  // Absolute base matching the dist/ subdirectory this app is assembled into —
  // same rule as every other app here (see apps/hex-clicker/vite.config.ts for
  // why relative breaks).
  //
  // Lowercase, unlike the game's /g00mBa/: this is the path a room full of
  // level designers types off a whiteboard, and the casing trap that makes
  // /g00mba 404 is not one to hand fifteen people on purpose.
  base: "/editor/",
  server: { host: true },
});
