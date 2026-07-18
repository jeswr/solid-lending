/**
 * Tier A live in-browser proving (docs/zk-plan.md; decisions 0005/0012
 * postures carried over from the mortgage showcase, design §6.2/§6.5).
 * Proves a threshold or equality statement over a HIDDEN lending field -
 * `lend:netMonthlyIncomeUsd >= T` (filter_int_d4), `lend:cashFlowScoreValue
 * >= T` (filter_int_d3), `lend:nsf90Count = 0` (filter_int_d1/d2) - with the
 * sparq `filter_int` circuit family, entirely client-side:
 *
 *   private witness:  the value's decimal digits (never leaves the device);
 *   public inputs:    challenge (lender nonce), operand_enc (the issuer-anchored
 *                     term encoding), op (>= or =), bound, expected (true).
 *
 * The circuit binds the hidden digits to `operand_enc` in-circuit, so the
 * proof is about EXACTLY the value whose encoding the issuer signed into the
 * operand-anchor VC (decision 0012 posture). A false verdict is UNSATISFIABLE
 * - the witness solve throws and no proof exists.
 *
 * HONESTY (surface {@link ZK_HONESTY} beside every ZK UI): research-grade
 * estate, external audit pending; the member choice leaks the value's digit
 * count; deterministic salt-free encodings are enumerable for low-entropy
 * values. "Not disclosed and not forgeable" - never "unknowable". ZK is
 * scoped to PRE-QUALIFICATION ONLY (decision 0005 posture): once a value
 * crosses into the priced-offer/application scenes it is disclosed via a
 * signed VC, never re-proved-without-disclosure downstream.
 */

import { fitsZkBudget, LEND, ZK_PREQUAL_THRESHOLDS, zkBudgetFor } from "@lending/data-model";
import {
  challengeFieldOf,
  generateProof,
  memberBackend,
  normalizeFieldHex,
  prewarm,
  ZK_VERIFIER_TARGET,
  ZkError,
  type ZkVerifierTarget,
} from "./backend.ts";
import { type FilterIntMember, memberForDigits } from "./circuits/registry.ts";

/** sparq `filter_int` comparison-operator codes (zk/compose ABI) this demo's statements use. */
export const OP_CODES = Object.freeze({ ge: 3, eq: 4 });

/** Bounds on an untrusted wire proof payload (the evm transcript is 8 384 B). */
const MAX_WIRE_PROOF_BYTES = 131_072;
const MAX_WIRE_PUBLIC_INPUTS = 4_096;

/** A Tier A threshold/equality statement over one lending ZK-provable field. */
export interface TierAStatement {
  /** The proved field's lend IRI - must be one of the demo's ZK budgets. */
  readonly field: string;
  /** The comparison operator (this demo ships `ge` and `eq`). */
  readonly op: keyof typeof OP_CODES;
  /** The public threshold, in the field's scaled unit. */
  readonly bound: number;
}

/** Options for {@link proveTierA}. */
export interface ProveTierAOptions {
  readonly statement: TierAStatement;
  /**
   * The HIDDEN value (from the borrower's own credential in their pod). Never
   * put in any output; it exists only as the private witness.
   */
  readonly value: number;
  /**
   * The issuer-anchored term encoding of `value` - `lend:operandEnc` from the
   * borrower's operand-anchor VC. The circuit is unsatisfiable unless this is
   * exactly the encoding of `value`, so a stale/foreign anchor fails here,
   * client-side, before anything is sent.
   */
  readonly operandEnc: string;
  /** The lender-minted single-use challenge nonce (decision 0012 posture, rail 1). */
  readonly nonce: string;
}

/** A produced Tier A proof - the wire payload for the VP-POST rail. */
export interface TierAProof {
  /** The committed circuit member the proof was produced against. */
  readonly member: FilterIntMember;
  /** The UltraHonk transcript (~8.4 kB, `evm` flavour, fully zero-knowledge). */
  readonly proof: Uint8Array;
  /** [challenge, operand_enc, op, bound, expected] as 32-byte 0x-hex. */
  readonly publicInputs: readonly string[];
  /** Always `"evm"` - the verifier re-checks and rejects anything else. */
  readonly verifierTarget: ZkVerifierTarget;
  /** Proving wall time, ms (diagnostics). */
  readonly proveMs: number;
  /** bb.js thread count used (1 unless cross-origin isolated). */
  readonly threads: number;
}

/** JSON codec of {@link TierAProof} (proof bytes as a number array, sparq-style). */
export interface TierAProofJson {
  readonly member: string;
  readonly proof: readonly number[];
  readonly publicInputs: readonly string[];
  readonly verifierTarget: string;
}

export function tierAProofToJson(proof: TierAProof): TierAProofJson {
  return {
    member: proof.member,
    proof: [...proof.proof],
    publicInputs: [...proof.publicInputs],
    verifierTarget: proof.verifierTarget,
  };
}

/**
 * Parse an UNTRUSTED wire payload into the verifier's input shape. Purely
 * structural (types/ranges) - every security check stays in `verifyTierA`.
 */
export function tierAProofFromJson(json: unknown): {
  member: string;
  proof: Uint8Array;
  publicInputs: readonly string[];
  verifierTarget: string;
} {
  if (typeof json !== "object" || json === null) {
    throw new ZkError("MALFORMED_PROOF", "proof payload is not an object");
  }
  const { member, proof, publicInputs, verifierTarget } = json as Record<string, unknown>;
  if (typeof member !== "string") {
    throw new ZkError("MALFORMED_PROOF", "proof payload has no member name");
  }
  if (typeof verifierTarget !== "string") {
    throw new ZkError("MALFORMED_PROOF", "proof payload has no verifierTarget");
  }
  if (
    !Array.isArray(proof) ||
    proof.length === 0 ||
    proof.length > MAX_WIRE_PROOF_BYTES ||
    !proof.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    throw new ZkError("MALFORMED_PROOF", "proof bytes must be a non-empty, bounded byte array");
  }
  if (
    !Array.isArray(publicInputs) ||
    publicInputs.length > MAX_WIRE_PUBLIC_INPUTS ||
    !publicInputs.every((entry) => typeof entry === "string")
  ) {
    throw new ZkError("MALFORMED_PROOF", "publicInputs must be a bounded array of hex strings");
  }
  return {
    member,
    proof: Uint8Array.from(proof as number[]),
    publicInputs: publicInputs as string[],
    verifierTarget,
  };
}

/**
 * Pre-warm the Tier A prover (dynamic imports + WASM instantiate + committed
 * artifacts) on route mount so the first "prove" click pays no cold start.
 * Shares the backend's single promise chain - safe to call repeatedly.
 */
export function prewarmProver(members?: readonly FilterIntMember[]): Promise<unknown> {
  return prewarm(members);
}

/**
 * Produce a Tier A proof. Fail-closed gates BEFORE any proving work:
 *
 *  1. the statement's field must be a ZK-provable lending field;
 *  2. `value` AND `bound` must fit that field's digit budget ({@link fitsZkBudget});
 *  3. the value's exact digit count must have a committed circuit member
 *     (sparq derivation discipline: exact-width match, out-of-family is a
 *     clean error, never a silently-wrong member);
 *  4. `operandEnc` must be field-shaped hex.
 *
 * A below-threshold (or unequal) value makes the circuit UNSATISFIABLE:
 * noir_js throws from the witness solve and this function rethrows a
 * `ZkError` with code `UNSATISFIABLE` - the honest "you cannot forge
 * eligibility" outcome.
 */
export async function proveTierA(options: ProveTierAOptions): Promise<TierAProof> {
  const { statement, value, nonce } = options;
  const budget = zkBudgetFor(statement.field);
  if (budget === undefined) {
    throw new ZkError(
      "UNKNOWN_FIELD",
      `field ${statement.field} is not a ZK-provable lending field`,
    );
  }
  if (!fitsZkBudget(statement.field, value)) {
    throw new ZkError(
      "BUDGET_VIOLATION",
      `hidden value does not fit the ${budget.digits}-digit budget [${budget.minInclusive}, ${budget.maxInclusive}] for ${budget.key}`,
    );
  }
  if (!fitsZkBudget(statement.field, statement.bound)) {
    throw new ZkError(
      "BUDGET_VIOLATION",
      `bound ${statement.bound} does not fit the budget [${budget.minInclusive}, ${budget.maxInclusive}] for ${budget.key}`,
    );
  }
  const digits = String(value);
  const member = memberForDigits(digits.length);
  if (member === undefined) {
    throw new ZkError(
      "NO_COMMITTED_MEMBER",
      `no committed filter_int member for a ${digits.length}-digit operand`,
    );
  }
  const operandEnc = normalizeFieldHex(options.operandEnc, "operandEnc");
  const challenge = await challengeFieldOf(nonce);

  const { noir, threads } = await memberBackend(member);
  const inputs = {
    challenge,
    operand_enc: operandEnc,
    op: String(OP_CODES[statement.op]),
    bound: String(statement.bound),
    expected: true,
    // PRIVATE - the exact hidden value, as ASCII digit bytes. Never disclosed.
    digits: [...digits].map((char) => String(char.charCodeAt(0))),
  };

  let witness: Uint8Array;
  try {
    ({ witness } = await noir.execute(inputs));
  } catch (error) {
    // Unsatisfiable (false verdict, or operandEnc not the encoding of value).
    throw new ZkError(
      "UNSATISFIABLE",
      `no witness exists for this statement (a false claim cannot be proved): ${(error as Error).message}`,
    );
  }

  const started = Date.now();
  const produced = await generateProof(member, witness);
  return {
    member,
    proof: produced.proof,
    publicInputs: [...produced.publicInputs],
    verifierTarget: ZK_VERIFIER_TARGET,
    proveMs: Date.now() - started,
    threads,
  };
}

// ── the demo's pre-qualification conjunction (design §6.2 scene 2) ─────────────────

/** The three fields this demo's pre-qualification predicate is over. */
export type PreQualificationField = "netMonthlyIncomeUsd" | "cashFlowScoreValue" | "nsf90Count";

/**
 * The demo's shipped statements - `income >= 2200 ∧ cash-flow score >= 660 ∧
 * NSF₉₀ = 0` (design §6.2 scene 2), pinned to {@link ZK_PREQUAL_THRESHOLDS} so
 * the statement bounds can never drift from the persona/shape fixtures.
 */
export const PREQUALIFICATION_STATEMENTS: Readonly<Record<PreQualificationField, TierAStatement>> =
  Object.freeze({
    netMonthlyIncomeUsd: {
      field: LEND.netMonthlyIncomeUsd,
      op: "ge",
      bound: ZK_PREQUAL_THRESHOLDS.netMonthlyIncomeUsd,
    },
    cashFlowScoreValue: {
      field: LEND.cashFlowScoreValue,
      op: "ge",
      bound: ZK_PREQUAL_THRESHOLDS.cashFlowScoreValue,
    },
    nsf90Count: {
      field: LEND.nsf90Count,
      op: "eq",
      bound: ZK_PREQUAL_THRESHOLDS.nsf90Count,
    },
  });

/** The hidden witness for one pre-qualification leg: value + its issuer-anchored encoding. */
export interface PreQualificationWitness {
  /** The HIDDEN value. Never leaves the device; witness-only. */
  readonly value: number;
  /** `lend:operandEnc` from the borrower's operand-anchor VC for this field. */
  readonly operandEnc: string;
}

/** Options for {@link provePreQualification}. */
export interface ProvePreQualificationOptions {
  readonly netMonthlyIncomeUsd: PreQualificationWitness;
  readonly cashFlowScoreValue: PreQualificationWitness;
  readonly nsf90Count: PreQualificationWitness;
  /** The lender-minted single-use challenge nonce, SHARED across all three legs. */
  readonly nonce: string;
}

/** A produced pre-qualification proof - one Tier A proof per field, one shared nonce. */
export type PreQualificationProof = Readonly<Record<PreQualificationField, TierAProof>>;

const PREQUALIFICATION_FIELDS: readonly PreQualificationField[] = [
  "netMonthlyIncomeUsd",
  "cashFlowScoreValue",
  "nsf90Count",
];

/**
 * Prove the demo's full pre-qualification conjunction: `income >= 2200 ∧
 * cash-flow score >= 660 ∧ NSF₉₀ = 0`. There is no single native circuit for
 * a three-field AND over three different hidden values in this pinned sparq
 * checkout - filter_int operates on ONE hidden column - so this proves THREE
 * independent Tier A statements, one per field, all bound to the SAME
 * verifier-minted nonce (one challenge for the whole presentation).
 *
 * Fail-closed AND semantics: a borrower who does not meet ALL three criteria
 * cannot honestly produce this bundle - the failing leg's witness solve is
 * UNSATISFIABLE (proveTierA's own gate), and this function lets that error
 * propagate (wrapped with which leg failed) rather than silently omitting a
 * leg. "You cannot forge eligibility" holds leg-by-leg AND for the bundle.
 */
export async function provePreQualification(
  options: ProvePreQualificationOptions,
): Promise<PreQualificationProof> {
  const proofs: Partial<Record<PreQualificationField, TierAProof>> = {};
  for (const key of PREQUALIFICATION_FIELDS) {
    const witness = options[key];
    try {
      proofs[key] = await proveTierA({
        statement: PREQUALIFICATION_STATEMENTS[key],
        value: witness.value,
        operandEnc: witness.operandEnc,
        nonce: options.nonce,
      });
    } catch (error) {
      if (error instanceof ZkError) {
        throw new ZkError(
          error.code,
          `pre-qualification leg "${key}" (${PREQUALIFICATION_STATEMENTS[key].field}) failed: ${error.message}`,
        );
      }
      throw error;
    }
  }
  return proofs as PreQualificationProof;
}
