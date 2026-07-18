import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The dev-seed route's first import pulls in the full @lending/seeds -> vc-kit ->
    // data-model chain (SHACL shapes, jose, etc.) — generous headroom under load.
    testTimeout: 30_000,
  },
});
