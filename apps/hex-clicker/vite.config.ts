import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base is load-bearing for the single-project deploy: the same
  // build is served both at a vanity domain root (hex.example.com/, which
  // Vercel rewrites to /hex/) and at a path (preview-url/hex/). Only a
  // relative base resolves assets correctly in both. Safe because nothing
  // here routes on the path — the room comes from ?room= (see net.ts).
  base: "./",
  plugins: [react()],
  server: { host: true },
});
