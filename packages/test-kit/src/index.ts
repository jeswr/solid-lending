/**
 * `@lending/test-kit` — the dev/test Solid-server harness (`@jeswr/solid-server`, vendored)
 * and minimal pod-fixture seeding. Consumed by `scripts/dev-pod.ts`, `e2e/support/`, and
 * the `seeds/` integration suite — never by application/browser code.
 */
export {
  type SolidTestAccount,
  type SolidTestServer,
  type StartSolidServerOptions,
  startSolidServer,
} from "./harness.ts";
export {
  profileCardFixture,
  type ProfileCardFixtureOptions,
  publicReadAcl,
  type ResourceFixture,
  seedPod,
  type SeedPodOptions,
} from "./seed.ts";
