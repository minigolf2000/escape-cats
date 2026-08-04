import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Absolute base — see apps/hex-clicker/vite.config.ts for why relative breaks.
  base: "/proctor/",
  plugins: [react()],
  server: { host: true },
});
