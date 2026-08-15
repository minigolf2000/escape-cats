import { defineConfig } from "vite";

export default defineConfig({
  // Absolute base matching the dist/ subdirectory this app is assembled into —
  // same rule as hex-clicker's config, and for the same trailing-slash reason
  // (see that file's comment, or the README's "Vanity domains" section).
  // /g00mBa's casing is load-bearing: URL paths are case-sensitive.
  base: "/g00mBa/",
  server: { host: true },
});
