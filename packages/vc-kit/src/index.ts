/**
 * `@lending/vc-kit` — VC issue/verify, Bitstring status lists and re-issue
 * flows for the small-dollar lending walkthrough (design §6.2), built on the
 * pinned `@jeswr/solid-vc` primitive. The architecture decisions cited in
 * comments (0004/0005/0007/0012 etc.) are the mortgage showcase's decision
 * log, which this demo inherits wholesale (design §6.5 "carries over
 * unchanged").
 *
 * SECURITY-CRITICAL surface: every verification gate is fail-closed (an
 * unreachable status list, a malformed proof node, a shape violation or an
 * unresolvable key is a FAILURE, never a pass), and nothing here ever reads
 * the wall clock — `now` / validity windows are explicit parameters.
 *
 * The ZK round layers the Tier-A operand-anchor proof checks on top of these
 * exports (docs/zk-plan.md): issue `zk-operand-anchor` credentials via
 * {@link issueCredential}, verify them via {@link verifyCredential} with
 * `expectShape: "zk-operand-anchor"`, and read the anchored `operandEnc` off
 * the verified subject graph.
 */

// Key handling + shared types re-exported from the pinned @jeswr/solid-vc so
// consumers need only this package.
export {
  type BitstringStatusListEntry,
  type BitstringStatusListEntryInput,
  type CredentialStatusCheck,
  createWebIdKeyResolver,
  cryptosuiteForKeyType,
  type DataIntegrityProof,
  exportPrivateJwk,
  exportPublicJwk,
  generateKeyPairForSuite,
  importKeyPair,
  importPublicKey,
  type KeyPair,
  type PublishVerificationMethodInput,
  publishVerificationMethod,
  resolveWebIdKey,
  type SuiteKeyType,
  type WebIdKeyResolver,
} from "@jeswr/solid-vc";

export {
  assertAbsoluteIri,
  type BankCashFlowClaims,
  type CashFlowScoreClaims,
  ClaimInputError,
  type CredentialClaims,
  type CreditScoreClaims,
  type DepositStreamClaims,
  type DisbursementReceiptClaims,
  type EmploymentIncomeClaims,
  type IdentityClaims,
  type LoanOfferClaims,
  type OrganizationClaims,
  type PostalAddressClaims,
  type RepaymentHistoryClaims,
  type ZkOperandAnchorClaims,
} from "./claims.ts";
export { documentQuadsOf, ProofReadError, purposeIri, readProof } from "./credential.ts";
export {
  type FinishIssueOptions,
  finishIssue,
  type IssueCredentialOptions,
  type IssuedCredential,
  IssueRefusedError,
  issueCredential,
  type ValidityWindow,
} from "./issue.ts";
export {
  isFresh,
  ReissueError,
  type ReissueOptions,
  type ReissueResult,
  reissueCredential,
  type ValidityWindowInfo,
} from "./reissue.ts";
export {
  type DeriveStatusIndexOptions,
  deriveStatusIndex,
  MIN_STATUS_LIST_LENGTH,
  StatusIndexAllocator,
  StatusListClient,
  type StatusListClientOptions,
  StatusListError,
  type StatusListWriteOptions,
} from "./status.ts";
export {
  type CheckCredentialStatusOptions,
  checkCredentialStatus,
  type EmbeddedProofOptions,
  type VcKitErrorCode,
  type VcKitVerificationError,
  type VerifiedCredentialInfo,
  type VerifyCredentialOptions,
  type VerifyCredentialResult,
  verifyCredential,
  verifyEmbeddedProofs,
} from "./verify.ts";
export {
  asCredentialKind,
  type CredentialKind,
  credentialKindOfTypes,
  credentialSchemaIri,
  LSHAPE,
  targetClassOf,
} from "./vocab.ts";
