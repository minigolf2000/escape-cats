import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base is load-bearing — see apps/hex-clicker/vite.config.ts.
  base: "./",
  plugins: [react()],
  server: { host: true },
});
