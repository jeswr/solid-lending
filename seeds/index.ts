/**
 * `@lending/seeds` — the deterministic demo-persona seeding library (sm-qz3j "seeder"
 * bead). Two layers:
 *
 * - the ORIGINAL scaffolder persona (`./persona.ts` + `./seed.config.ts`, driven by
 *   `@jeswr/synthetic-rdf` + `@jeswr/solid-seed`) — the walkthrough-narrative persona
 *   card, unchanged;
 * - the REAL signed-credential borrower vault (this barrel): Maya Torres's five §6.2
 *   lending credentials + three ZK operand anchors, genuinely issued through
 *   `@lending/vc-kit`, laid out with least-privilege access through `@jeswr/solid-seed`.
 *   Consumed by `scripts/dev-pod.ts`, `e2e/support/global-setup.ts`, and the wallet's
 *   dev-gated Mode-1 seed route.
 */
export { CAPTURED_OPERAND_ENC, capturedEncoding } from "./captured-operand-enc.ts";
export {
  ANCHOR_POD_PATHS,
  CREDENTIAL_POD_PATHS,
  ISSUER_ROLES,
  type LendingSeedIssuerRole,
  mayaTorres,
  anchorValidity,
  type ScriptedAnchorSeed,
  type ScriptedCredentialSeed,
  scriptedCredentialSeeds,
} from "./credentials.ts";
export {
  createLendingIssuance,
  type CreateLendingIssuanceOptions,
  type LendingCredentialIssuance,
  type LendingIssuanceContext,
  type SeedResourceBody,
  type SeededAnchorResource,
  type SeededCredentialGroup,
} from "./issuance.ts";
export {
  LENDING_OWNER_ONLY_ACCESS,
  LENDING_PUBLIC_READ_ACCESS,
  lendingPodLayout,
  type LendingPodLayoutOptions,
} from "./layout.ts";
export {
  lendingCredentialSeeds,
  seedLendingPod,
  type SeedLendingPodOptions,
  type SeededLendingPod,
} from "./lending-pod.ts";
export { normalizedPodBase } from "./pod-base.ts";
