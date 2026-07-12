import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@blackqueen/engine": path.resolve(__dirname, "packages/engine/src/index.ts"),
      "@blackqueen/protocol": path.resolve(__dirname, "packages/protocol/src/index.ts"),
    },
  },
  test: {
    globals: true,
    include: ["packages/*/test/**/*.test.ts"],
  },
});
