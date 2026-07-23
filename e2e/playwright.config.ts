import { defineConfig } from "@playwright/test";

/**
 * The starter suite exercises only the TOUR shell (disclaimers + axe), so no zone app
 * talks to a pod in THIS suite. `globalSetup` (e2e/support/global-setup.ts) does boot one
 * pre-seeded Maya Torres borrower pod for the run (sm-qz3j seeder round) and exports its
 * coordinates via `LENDING_E2E_POD_ORIGIN`/`LENDING_E2E_POD_WEBID`/`LENDING_E2E_SEEDED_AT`
 * — a scene suite that needs real pod-backed apps reads those env vars rather than
 * re-seeding. Suites that need write isolation still boot their OWN local in-memory Solid
 * server + seeded accounts (the house pattern) rather than sharing this one.
 *
 * Browsers: `pnpm exec playwright install` once before `pnpm e2e`.
 */
export default defineConfig({
  testDir: ".",
  globalSetup: "./support/global-setup.ts",
  // The journey suite drives six real `next dev` cold starts: the FIRST hit
  // of any route pays a Turbopack compile (several seconds) on top of real
  // DPoP/crypto round trips — comfortably over the 5s Playwright default.
  // Individual assertions still bump further where warranted (documented
  // inline in journey.spec.ts).
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
  },
  webServer:
    process.env.E2E_BASE_URL !== undefined
      ? undefined
      : {
          command: "pnpm --filter @lending/app-tour dev",
          reuseExistingServer: true,
          timeout: 120_000,
          url: "http://localhost:3000",
        },
});
