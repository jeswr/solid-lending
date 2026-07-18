import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // SHACL validation of all persona resources can exceed vitest's 5s default
    // on a cold CI runner (~8s observed) — a flaky timeout, not a real failure.
    testTimeout: 30_000,
  },
});
