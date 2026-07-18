/**
 * `@lending/vc-kit`'s ZK layer (docs/zk-plan.md; decisions 0005/0012
 * postures carried over from the mortgage showcase, design §6.2/§6.5). Tier A
 * live prove/verify with MANDATORY operand-anchor binding, PLUS the demo's
 * pre-qualification conjunction (income/score/NSF) and the honesty-panel
 * content.
 */

export {
  challengeFieldOf,
  fieldHexEquals,
  normalizeFieldHex,
  type ProofData,
  ZK_VERIFIER_TARGET,
  ZkError,
  type ZkVerifierTarget,
} from "./backend.ts";
export {
  asCommittedMember,
  COMMITTED_MEMBERS,
  type CompiledCircuitArtifact,
  type FilterIntMember,
  loadCommittedCircuit,
  memberDigits,
  memberForDigits,
  PINNED_BB_JS_VERSION,
  PINNED_NARGO_VERSION,
  PINNED_NOIR_JS_VERSION,
} from "./circuits/registry.ts";
export { type HonestyItem, ZK_HONESTY, ZK_HONESTY_ITEMS, ZK_TOOLCHAIN } from "./honesty.ts";
export {
  OP_CODES,
  type PreQualificationField,
  type PreQualificationProof,
  PREQUALIFICATION_STATEMENTS,
  type PreQualificationWitness,
  provePreQualification,
  type ProvePreQualificationOptions,
  type ProveTierAOptions,
  prewarmProver,
  proveTierA,
  type TierAProof,
  type TierAProofJson,
  type TierAStatement,
  tierAProofFromJson,
  tierAProofToJson,
} from "./prover.ts";
export {
  type PreQualificationAnchors,
  type PreQualificationVerifyResult,
  type PresentedTierAProof,
  type TierAChecks,
  type TierAErrorCode,
  type TierANonceConsumer,
  type TierAVerificationError,
  type TierAVerifyResult,
  type VerifyPreQualificationOptions,
  verifyPreQualification,
  type VerifyTierAOptions,
  verifyTierA,
} from "./verifier.ts";
