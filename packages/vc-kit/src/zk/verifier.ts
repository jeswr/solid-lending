/**
 * Tier A verification (docs/zk-plan.md; decision 0012 posture carried over
 * from the mortgage showcase - THE binding posture). A bare `filter_int`
 * proof is FULLY FORGEABLE: `operand_enc` is a deterministic, salt-free term
 * encoding anyone can compute for any value, so an adversary proves
 * `9999 >= 2200` honestly and presents it beside a genuine anchor for their
 * real, insufficient income. Every Tier A verification therefore runs ALL of
 * these gates, fail-closed - a Tier A surface without the anchor check must
 * never ship:
 *
 *  0. config      - a non-empty issuer allowlist and a valid `now` (caller-
 *                    contract guards that must not fail open);
 *  1. structural   - sanctioned flavour (`evm`, never `*-no-zk`), committed
 *                    member, 5 public inputs, member width within the field's
 *                    digit budget - all checkable WITHOUT touching the nonce
 *                    store, so a malformed presentation never burns a live
 *                    challenge;
 *  2. nonce        - single-use challenge burned via the injected
 *                    {@link TierANonceConsumer} seam ONLY once gates 0-1 pass
 *                    (a failed attempt from here on consumes the challenge
 *                    too - a presenter gets exactly one shot per nonce);
 *  3. challenge    - the proof's `challenge` public input equals the burned
 *                    nonce's field derivation (transcript-bound freshness);
 *  4. statement    - op / bound / expected public inputs are exactly the
 *                    advertised statement with a TRUE verdict;
 *  5. anchor VC    - verifies via {@link verifyCredential} with the
 *                    `zk-operand-anchor` shape: issuer signature, issuer
 *                    allowlist, validity window, Bitstring status (revoked /
 *                    unreachable both fail);
 *  6. subject      - anchor `credentialSubject` IRI === the DPoP-verified
 *                    presenter WebID (holder binding);
 *  7. field        - anchor `lend:field` === the advertised statement field;
 *  8. operand      - anchor `lend:operandEnc` === the proof's `operand_enc`
 *                    public input (constant-time) - the forgeability gate;
 *  9. cryptography - bb.js UltraHonk verify against the COMMITTED artifact.
 *
 * ANY failure rejects. Verification is server/route-side: the WebID and the
 * nonce store are the caller's own DPoP-verified session material - both
 * injected, never re-implemented here.
 *
 * {@link verifyPreQualification} composes THREE statement verifications (the
 * demo's `income >= 2200 ∧ score >= 660 ∧ NSF₉₀ = 0` conjunction) sharing ONE
 * nonce: gates 0-1 run for all three legs before anything touches the nonce
 * store, the shared challenge is burned exactly once, then gates 3-9 run per
 * leg.
 */

import { parseCredentialRdf } from "@jeswr/solid-vc";
import { LEND, zkBudgetFor } from "@lending/data-model";
import type { DatasetCore, Term } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import type { VerifyCredentialOptions, VerifyCredentialResult } from "../verify.ts";
import { verifyCredential } from "../verify.ts";
import {
  assertZkVerifierTarget,
  challengeFieldOf,
  fieldHexEquals,
  verifyProof,
  type ZkError,
} from "./backend.ts";
import { asCommittedMember, type FilterIntMember, memberDigits } from "./circuits/registry.ts";
import {
  OP_CODES,
  type PreQualificationField,
  type PreQualificationProof,
  PREQUALIFICATION_STATEMENTS,
  type TierAStatement,
} from "./prover.ts";

/** The rejection codes a Tier A verification can produce. */
export type TierAErrorCode =
  | "FORBIDDEN_FLAVOUR"
  | "UNKNOWN_MEMBER"
  | "MALFORMED_PROOF"
  | "UNKNOWN_FIELD"
  | "MEMBER_BUDGET_MISMATCH"
  | "NONCE_INVALID"
  | "CHALLENGE_MISMATCH"
  | "STATEMENT_MISMATCH"
  | "ANCHOR_INVALID"
  | "ANCHOR_SUBJECT_MISMATCH"
  | "ANCHOR_FIELD_MISMATCH"
  | "ANCHOR_OPERAND_MISMATCH"
  | "PROOF_INVALID";

export interface TierAVerificationError {
  readonly code: TierAErrorCode;
  readonly message: string;
}

/** The presented proof payload, as parsed by `tierAProofFromJson` (untrusted). */
export interface PresentedTierAProof {
  readonly member: string;
  readonly proof: Uint8Array;
  readonly publicInputs: readonly string[];
  readonly verifierTarget: string;
}

/** The single-use challenge seam - any nonce store satisfying this interface works. */
export interface TierANonceConsumer {
  /** `true` iff `nonce` is the live challenge for `sessionKey`; burns it. */
  consume(sessionKey: string, nonce: string): boolean;
}

/** Statement + anchor-verification options shared by every Tier A gate run. */
interface StatementVerifyOptions {
  readonly statement: TierAStatement;
  readonly anchorVc: string | DatasetCore;
  readonly webid: string;
  readonly nonce: string;
  readonly now: Date;
  readonly trustedIssuers: readonly string[];
  readonly contentType?: string;
  readonly resolveKey?: VerifyCredentialOptions["resolveKey"];
  readonly isControlledBy?: VerifyCredentialOptions["isControlledBy"];
  readonly webIdFetch?: VerifyCredentialOptions["webIdFetch"];
  readonly statusFetch?: VerifyCredentialOptions["statusFetch"];
  readonly trustedStatusIssuers?: VerifyCredentialOptions["trustedStatusIssuers"];
  readonly registry?: VerifyCredentialOptions["registry"];
}

/** Options for {@link verifyTierA}. */
export interface VerifyTierAOptions extends StatementVerifyOptions {
  /** The injected single-use nonce store. */
  readonly nonces: TierANonceConsumer;
  /** The nonce store session key the challenge was minted under. */
  readonly sessionKey: string;
}

/** Per-gate outcomes (observability; `verified` is their conjunction). */
export interface TierAChecks {
  readonly structural: boolean;
  readonly nonce: boolean;
  readonly challenge: boolean;
  readonly statement: boolean;
  readonly anchor: boolean;
  readonly subject: boolean;
  readonly field: boolean;
  readonly operandBinding: boolean;
  readonly proof: boolean;
}

export interface TierAVerifyResult {
  readonly verified: boolean;
  readonly checks: TierAChecks;
  readonly errors: readonly TierAVerificationError[];
  /** The anchor verification detail (present once the anchor gate ran). */
  readonly anchor?: VerifyCredentialResult;
}

const PUBLIC_INPUT_COUNT = 5;
const TRUE_FIELD = 1n;
/**
 * A generous upper bound on a presented Tier A proof (the `evm`-flavour
 * transcript is 8 384 B; the widest committed member stays well under this).
 * Rejecting oversized untrusted payloads before allocation/verify is cheap
 * defense-in-depth, not the security property itself.
 */
const MAX_PROOF_BYTES = 131_072;

/**
 * Typed reader over the anchor VC's credentialSubject node. Pod RDF is
 * untrusted input: every accessor requires EXACTLY one well-typed value and
 * returns `undefined` otherwise (the SHACL gate already enforced this - the
 * accessors are the defense-in-depth layer, term-by-term filtered).
 */
class AnchorSubjectNode extends TermWrapper {
  private single(predicateIri: string, termType: "NamedNode" | "Literal"): string | undefined {
    const values: string[] = [];
    const predicate = this.factory.namedNode(predicateIri);
    for (const quad of this.dataset.match(this as unknown as Term, predicate, null, null)) {
      if (quad.object.termType === termType) values.push(quad.object.value);
      else return undefined; // a wrongly-typed value is a failure, not noise
    }
    return values.length === 1 ? values[0] : undefined;
  }

  /** The anchored field IRI (`lend:field`), or undefined when not exactly one. */
  get fieldIri(): string | undefined {
    return this.single(LEND.field, "NamedNode");
  }

  /** The anchored term encoding (`lend:operandEnc`), or undefined likewise. */
  get operandEnc(): string | undefined {
    return this.single(LEND.operandEnc, "Literal");
  }
}

function reject(
  code: TierAErrorCode,
  message: string,
  checks: TierAChecks,
  anchor?: VerifyCredentialResult,
): TierAVerifyResult {
  return {
    verified: false,
    checks,
    errors: [{ code, message }],
    ...(anchor !== undefined ? { anchor } : {}),
  };
}

const NO_CHECKS: TierAChecks = {
  structural: false,
  nonce: false,
  challenge: false,
  statement: false,
  anchor: false,
  subject: false,
  field: false,
  operandBinding: false,
  proof: false,
};

/** Parse an untrusted 0x-hex public input to a bigint, or undefined. */
function publicInputBigInt(value: string | undefined): bigint | undefined {
  if (value === undefined || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

/** Gate 0: caller-contract guards, checked ONCE (shared by standalone + bundle callers). */
function checkCallerContract(
  trustedIssuers: readonly string[],
  now: Date,
): TierAVerifyResult | undefined {
  if (!Array.isArray(trustedIssuers) || trustedIssuers.length === 0) {
    return reject(
      "ANCHOR_INVALID",
      "trustedIssuers must be a non-empty allowlist (an omitted allowlist would accept any issuer)",
      NO_CHECKS,
    );
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return reject(
      "ANCHOR_INVALID",
      "now must be a valid Date (a NaN instant would bypass the validity window)",
      NO_CHECKS,
    );
  }
  return undefined;
}

/**
 * Gate 1: structural checks over the presented proof + advertised statement
 * ALONE - no I/O, no nonce store. Resolves the committed circuit member on
 * success so later gates never re-derive it.
 */
function checkStructural(
  presented: PresentedTierAProof,
  statement: TierAStatement,
): { readonly member: FilterIntMember } | TierAVerifyResult {
  try {
    assertZkVerifierTarget(presented.verifierTarget);
  } catch (error) {
    return reject("FORBIDDEN_FLAVOUR", (error as ZkError).message, NO_CHECKS);
  }
  const member = asCommittedMember(presented.member);
  if (member === undefined) {
    return reject(
      "UNKNOWN_MEMBER",
      `"${presented.member}" is not a committed circuit member`,
      NO_CHECKS,
    );
  }
  if (presented.publicInputs.length !== PUBLIC_INPUT_COUNT) {
    return reject(
      "MALFORMED_PROOF",
      `expected ${PUBLIC_INPUT_COUNT} public inputs, got ${presented.publicInputs.length}`,
      NO_CHECKS,
    );
  }
  if (
    !(presented.proof instanceof Uint8Array) ||
    presented.proof.length === 0 ||
    presented.proof.length > MAX_PROOF_BYTES
  ) {
    return reject("MALFORMED_PROOF", "proof bytes are empty or oversized", NO_CHECKS);
  }
  const budget = zkBudgetFor(statement.field);
  if (budget === undefined) {
    return reject(
      "UNKNOWN_FIELD",
      `statement field ${statement.field} is not a ZK-provable lending field`,
      NO_CHECKS,
    );
  }
  if (!Object.hasOwn(OP_CODES, statement.op)) {
    return reject("STATEMENT_MISMATCH", `unsupported operator ${statement.op}`, NO_CHECKS);
  }
  if (memberDigits(member) > budget.digits) {
    return reject(
      "MEMBER_BUDGET_MISMATCH",
      `${member} (${memberDigits(member)} digits) exceeds the ${budget.digits}-digit budget of ${budget.key}`,
      NO_CHECKS,
    );
  }
  return { member };
}

function isRejection(value: unknown): value is TierAVerifyResult {
  return typeof value === "object" && value !== null && "verified" in value;
}

/**
 * Gates 3-9, given the shared/standalone nonce has ALREADY been burned and
 * gate 1 has ALREADY resolved `member`. `checks` starts at
 * `{ structural: true, nonce: true, ...rest false }`.
 */
async function verifyPostNonceGates(
  presented: PresentedTierAProof,
  member: FilterIntMember,
  options: StatementVerifyOptions,
): Promise<TierAVerifyResult> {
  let checks: TierAChecks = { ...NO_CHECKS, structural: true, nonce: true };

  // Gate 3: the proof's challenge public input must be THIS nonce's field form.
  const expectedChallenge = await challengeFieldOf(options.nonce);
  const challengeInput = presented.publicInputs[0];
  if (
    challengeInput === undefined ||
    !fieldHexEquals(challengeInput, expectedChallenge, "challenge public input")
  ) {
    return reject(
      "CHALLENGE_MISMATCH",
      "proof was not produced for this session's challenge",
      checks,
    );
  }
  checks = { ...checks, challenge: true };

  // Gate 4: op / bound / expected are exactly the advertised statement, verdict TRUE.
  const op = publicInputBigInt(presented.publicInputs[2]);
  const bound = publicInputBigInt(presented.publicInputs[3]);
  const expected = publicInputBigInt(presented.publicInputs[4]);
  if (
    op !== BigInt(OP_CODES[options.statement.op]) ||
    bound !== BigInt(options.statement.bound) ||
    expected !== TRUE_FIELD
  ) {
    return reject(
      "STATEMENT_MISMATCH",
      "proof public inputs do not match the advertised statement with a true verdict",
      checks,
    );
  }
  checks = { ...checks, statement: true };

  // Gate 5: the anchor VC - signature, shape, window, status; all fail-closed.
  let dataset: DatasetCore;
  if (typeof options.anchorVc === "string") {
    try {
      dataset = await parseCredentialRdf(options.anchorVc, options.contentType ?? "text/turtle");
    } catch (error) {
      return reject(
        "ANCHOR_INVALID",
        `anchor document did not parse: ${(error as Error).message}`,
        checks,
      );
    }
  } else {
    dataset = options.anchorVc;
  }
  const anchor = await verifyCredential(dataset, {
    expectShape: "zk-operand-anchor",
    now: options.now,
    trustedIssuers: options.trustedIssuers,
    ...(options.resolveKey !== undefined ? { resolveKey: options.resolveKey } : {}),
    ...(options.isControlledBy !== undefined ? { isControlledBy: options.isControlledBy } : {}),
    ...(options.webIdFetch !== undefined ? { webIdFetch: options.webIdFetch } : {}),
    ...(options.statusFetch !== undefined ? { statusFetch: options.statusFetch } : {}),
    ...(options.trustedStatusIssuers !== undefined
      ? { trustedStatusIssuers: options.trustedStatusIssuers }
      : {}),
    ...(options.registry !== undefined ? { registry: options.registry } : {}),
  });
  if (!anchor.verified) {
    const detail = anchor.errors.map((error) => `${error.code}: ${error.message}`).join("; ");
    return reject("ANCHOR_INVALID", `operand-anchor VC did not verify: ${detail}`, checks, anchor);
  }
  checks = { ...checks, anchor: true };

  // Gate 6: holder binding - anchor subject === the DPoP-verified WebID.
  const subject = anchor.credential?.subject;
  if (
    typeof options.webid !== "string" ||
    options.webid.length === 0 ||
    subject === undefined ||
    subject !== options.webid
  ) {
    return reject(
      "ANCHOR_SUBJECT_MISMATCH",
      "anchor subject WebID is not the authenticated presenter",
      checks,
      anchor,
    );
  }
  checks = { ...checks, subject: true };

  // Gates 7+8: the anchored claims, via the typed accessor (untrusted RDF).
  const subjectNode = new AnchorSubjectNode(DataFactory.namedNode(subject), dataset, DataFactory);
  const anchoredField = subjectNode.fieldIri;
  if (anchoredField === undefined || anchoredField !== options.statement.field) {
    return reject(
      "ANCHOR_FIELD_MISMATCH",
      "anchor does not anchor the advertised statement's field",
      checks,
      anchor,
    );
  }
  checks = { ...checks, field: true };

  const anchoredEnc = subjectNode.operandEnc;
  const operandInput = presented.publicInputs[1];
  if (
    anchoredEnc === undefined ||
    operandInput === undefined ||
    !fieldHexEquals(anchoredEnc, operandInput, "operand_enc")
  ) {
    return reject(
      "ANCHOR_OPERAND_MISMATCH",
      "proof operand_enc is not the issuer-anchored encoding (decision 0012 posture: a bare proof is forgeable)",
      checks,
      anchor,
    );
  }
  checks = { ...checks, operandBinding: true };

  // Gate 9: the cryptographic verify, against the COMMITTED artifact only.
  let proofOk = false;
  try {
    proofOk = await verifyProof(member, {
      proof: presented.proof,
      publicInputs: presented.publicInputs,
    });
  } catch {
    proofOk = false;
  }
  if (!proofOk) {
    return reject("PROOF_INVALID", "UltraHonk proof did not verify", checks, anchor);
  }
  checks = { ...checks, proof: true };

  // `verified` is the CONJUNCTION of the gates - structural honesty.
  const verified = Object.values(checks).every((passed) => passed === true);
  return { verified, checks, errors: [], anchor };
}

/**
 * Verify a presented Tier A proof against its MANDATORY operand anchor. See
 * the module header for the nine fail-closed gates; ANY failure rejects.
 */
export async function verifyTierA(
  presented: PresentedTierAProof,
  options: VerifyTierAOptions,
): Promise<TierAVerifyResult> {
  // Gate 0.
  const configRejection = checkCallerContract(options.trustedIssuers, options.now);
  if (configRejection !== undefined) return configRejection;

  // Gate 1 - resolves `member`. Runs BEFORE the nonce is touched: a malformed
  // presentation must never burn a live challenge.
  const structural = checkStructural(presented, options.statement);
  if (isRejection(structural)) return structural;

  // Gate 2: burn the single-use challenge - a presentation that fails a
  // later gate must not leave its challenge alive for a second attempt.
  if (!options.nonces.consume(options.sessionKey, options.nonce)) {
    return reject(
      "NONCE_INVALID",
      "challenge is not the live, unexpired, unconsumed nonce for this session",
      { ...NO_CHECKS, structural: true },
    );
  }

  return verifyPostNonceGates(presented, structural.member, options);
}

// ── the demo's pre-qualification conjunction (design §6.2 scene 2) ─────────────────

/** Anchors for {@link verifyPreQualification}, one operand-anchor VC per field. */
export type PreQualificationAnchors = Readonly<Record<PreQualificationField, string | DatasetCore>>;

/** Options for {@link verifyPreQualification}. */
export interface VerifyPreQualificationOptions {
  readonly anchors: PreQualificationAnchors;
  readonly webid: string;
  /** The lender-minted single-use challenge, SHARED across all three legs. */
  readonly nonce: string;
  readonly nonces: TierANonceConsumer;
  readonly sessionKey: string;
  readonly now: Date;
  readonly trustedIssuers: readonly string[];
  readonly contentType?: string;
  readonly resolveKey?: VerifyCredentialOptions["resolveKey"];
  readonly isControlledBy?: VerifyCredentialOptions["isControlledBy"];
  readonly webIdFetch?: VerifyCredentialOptions["webIdFetch"];
  readonly statusFetch?: VerifyCredentialOptions["statusFetch"];
  readonly trustedStatusIssuers?: VerifyCredentialOptions["trustedStatusIssuers"];
  readonly registry?: VerifyCredentialOptions["registry"];
}

export interface PreQualificationVerifyResult {
  /** True IFF every leg verified AND the shared nonce burned exactly once. */
  readonly verified: boolean;
  readonly legs: Readonly<Record<PreQualificationField, TierAVerifyResult>>;
  /** Every leg's errors, flattened (empty when verified). */
  readonly errors: readonly TierAVerificationError[];
}

const PREQUALIFICATION_FIELDS: readonly PreQualificationField[] = [
  "netMonthlyIncomeUsd",
  "cashFlowScoreValue",
  "nsf90Count",
];

function allLegsRejected(result: TierAVerifyResult): PreQualificationVerifyResult {
  return {
    verified: false,
    legs: { netMonthlyIncomeUsd: result, cashFlowScoreValue: result, nsf90Count: result },
    errors: result.errors,
  };
}

/**
 * Verify the demo's full pre-qualification conjunction: `income >= 2200 ∧
 * cash-flow score >= 660 ∧ NSF₉₀ = 0`, ALL THREE bound to one lender-minted
 * challenge (one nonce burn for the whole presentation, not one per leg -
 * mirrors how {@link provePreQualification} produced the bundle).
 *
 * Ordering mirrors {@link verifyTierA}: gates 0-1 run for EVERY leg first
 * (config guards, then each leg's own proof-structural checks) - only once
 * ALL THREE legs are structurally sound does the shared nonce get burned;
 * gates 3-9 then run per leg. A structurally malformed bundle never touches
 * the nonce store, so a bad presentation cannot burn a legitimate challenge.
 *
 * `verified` is the conjunction over the three legs; a caller that needs the
 * reason for a partial failure has each leg's own {@link TierAVerifyResult}
 * in `legs`.
 */
export async function verifyPreQualification(
  proof: PreQualificationProof,
  options: VerifyPreQualificationOptions,
): Promise<PreQualificationVerifyResult> {
  // Gate 0 (once, shared).
  const configRejection = checkCallerContract(options.trustedIssuers, options.now);
  if (configRejection !== undefined) return allLegsRejected(configRejection);

  // Gate 1, per leg - resolves each leg's `member`. Runs BEFORE the shared
  // nonce is touched.
  const members = {} as Record<PreQualificationField, FilterIntMember>;
  for (const key of PREQUALIFICATION_FIELDS) {
    const structural = checkStructural(proof[key], PREQUALIFICATION_STATEMENTS[key]);
    if (isRejection(structural)) return allLegsRejected(structural);
    members[key] = structural.member;
  }

  // Gate 2: burn the ONE shared challenge for the whole bundle.
  if (!options.nonces.consume(options.sessionKey, options.nonce)) {
    return allLegsRejected(
      reject(
        "NONCE_INVALID",
        "challenge is not the live, unexpired, unconsumed nonce for this session",
        { ...NO_CHECKS, structural: true },
      ),
    );
  }

  const legs = {} as Record<PreQualificationField, TierAVerifyResult>;
  for (const key of PREQUALIFICATION_FIELDS) {
    legs[key] = await verifyPostNonceGates(proof[key], members[key], {
      statement: PREQUALIFICATION_STATEMENTS[key],
      anchorVc: options.anchors[key],
      webid: options.webid,
      nonce: options.nonce,
      now: options.now,
      trustedIssuers: options.trustedIssuers,
      ...(options.contentType !== undefined ? { contentType: options.contentType } : {}),
      ...(options.resolveKey !== undefined ? { resolveKey: options.resolveKey } : {}),
      ...(options.isControlledBy !== undefined ? { isControlledBy: options.isControlledBy } : {}),
      ...(options.webIdFetch !== undefined ? { webIdFetch: options.webIdFetch } : {}),
      ...(options.statusFetch !== undefined ? { statusFetch: options.statusFetch } : {}),
      ...(options.trustedStatusIssuers !== undefined
        ? { trustedStatusIssuers: options.trustedStatusIssuers }
        : {}),
      ...(options.registry !== undefined ? { registry: options.registry } : {}),
    });
  }
  const verified = PREQUALIFICATION_FIELDS.every((key) => legs[key]?.verified === true);
  const errors = PREQUALIFICATION_FIELDS.flatMap((key) => legs[key]?.errors ?? []);
  return { verified, legs, errors };
}
