import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root),
      "server-only": path.resolve(root, "test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next", ".next-*", "e2e"],
    testTimeout: 30_000,
    // Several suites seed the whole demo school; under a full parallel run that can take a while.
    hookTimeout: 180_000,
  },
});
