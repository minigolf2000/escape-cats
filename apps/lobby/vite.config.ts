import { defineConfig } from "vite";

export default defineConfig({
  // This app assembles to the root of dist/, so its base is the root.
  base: "/",
  server: { host: true },
});
