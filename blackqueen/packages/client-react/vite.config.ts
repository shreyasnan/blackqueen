import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // UI_SPEC §14 binding: engine imports are TYPES + legalPlays only (enforced by review, not tooling)
      "@engine": path.resolve(__dirname, "../engine/src"),
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
