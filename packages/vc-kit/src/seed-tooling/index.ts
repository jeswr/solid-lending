/**
 * `@lending/vc-kit/seed-tooling` — NODE-ONLY seed-time tooling: native
 * dual-signing (eddsa-rdfc-2022 + Schnorr-BJJ over Poseidon2 commitments),
 * operand-anchor emission, and the `CredentialSeedPipeline` seam the seeder
 * consumes. The Tier-B ProofManifest capture arrives with the ZK round
 * (docs/zk-plan.md).
 *
 * NEVER import this from browser code — it spawns the sparq native helper.
 * The browser-safe surface stays under the package root export.
 */

export {
  type MintAnchorsOptions,
  type MintedAnchor,
  mintOperandAnchors,
  readHiddenFieldValues,
} from "./anchors.ts";
export {
  DAY_MS,
  DEMO_BACKDATED_VALIDITY,
  DEMO_CASH_FLOW_CREDENTIAL_ID,
  DEMO_HIDDEN_FIELDS,
  DEMO_INCOME_CREDENTIAL_ID,
  DEMO_ISSUER,
  DEMO_ISSUER_KEY_SET,
  DEMO_ISSUER_SEEDS,
  DEMO_NOW,
  DEMO_OPERAND_VALUES,
  DEMO_SCORE_CREDENTIAL_ID,
  DEMO_STATUS_LIST_URL,
  DEMO_SUBJECT,
  DEMO_ZK_REVOKED_DECOYS,
  DEMO_ZK_STATUS,
  DEMO_ZK_STATUS_LIST_SIZE,
  demoBankCashFlowClaims,
  demoCashFlowScoreClaims,
  demoCreditScoreClaims,
  demoEmploymentClaims,
  demoLoanOfferClaims,
} from "./demo.ts";
export {
  assertZkStatusEntry,
  type DualSignedCredential,
  type DualSignOptions,
  dualSignCredential,
  fixtureIndexBlindingHex,
  fixtureSaltHex,
  type ZkStatusEntry,
} from "./dual-sign.ts";
export {
  SeedToolingError,
  type SparqAttestation,
  type SparqCompositeContext,
  type SparqCompositeInput,
  type SparqCredentialInput,
  type SparqNativeBridge,
  SparqSeedHelper,
  type SparqSeedHelperOptions,
  type SparqSeedJob,
  type SparqSeedResult,
  type SparqSubRelation,
  type SparqZkStatusInput,
} from "./native.ts";
export {
  type CredentialSeedInput,
  type CredentialSeedPipeline,
  type CredentialSeedResult,
  type SeededAnchor,
  type SeedWitnessDocument,
  SparqCredentialSeedPipeline,
  type SparqCredentialSeedPipelineOptions,
  ZK_WITNESS_HONESTY_NOTE,
} from "./pipeline.ts";
export { claimGraphToNTriples, deriveFieldHex, randomFieldHex } from "./serialize.ts";
