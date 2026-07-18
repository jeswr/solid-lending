/**
 * Operand-anchor emission (the mortgage demo's dual-rail anchor pattern, carried over).
 *
 * For each hidden field of a just-issued credential, this module reads the
 * EXACT `xsd:integer` literal the data-model wrappers wrote into the claim
 * graph (typed accessor over the claim quads - never a re-parsed string),
 * computes its deterministic sparq term encoding via the native
 * `encode_int_literal`, and mints the issuer-signed `lend:ZkOperandAnchor` VC
 * (field IRI + operandEnc + subject WebID + credentialStatus,
 * eddsa-rdfc-2022) through the ordinary vc-kit issuance gate - so anchors are
 * SHACL-validated against `lshape:ZkOperandAnchorShape` before signing.
 */

import type {
  BitstringStatusListEntry,
  BitstringStatusListEntryInput,
  KeyPair,
} from "@jeswr/solid-vc";
import { fitsZkBudget, zkBudgetFor } from "@lending/data-model";
import { TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import type { IssuedCredential, ValidityWindow } from "../issue.ts";
import { issueCredential } from "../issue.ts";
import type { SparqNativeBridge } from "./native.ts";
import { SeedToolingError } from "./native.ts";

const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";
/** Canonical xsd:integer lexical forms the ZK budgets admit (non-negative). */
const CANONICAL_NON_NEGATIVE_INTEGER = /^(0|[1-9][0-9]*)$/;

/** Typed read-side wrapper over a claim subject (RDF discipline: no bare walks). */
class ClaimSubjectNode extends TermWrapper {
  /**
   * The single `xsd:integer` object of `predicate`, as `{ value, lexical }`.
   * Fail-closed: missing, multiple, non-literal, wrong-datatype or
   * non-canonical-lexical objects all throw.
   */
  integerClaim(predicate: string): { value: number; lexical: string } {
    // A TermWrapper IS an RDF/JS term (it implements every Term member).
    const subject = this as unknown as import("@rdfjs/types").Quad_Subject;
    const objects = [...this.dataset.match(subject, this.factory.namedNode(predicate), null)];
    if (objects.length !== 1) {
      throw new SeedToolingError(
        "HIDDEN_FIELD_CARDINALITY",
        `expected exactly one value for hidden field ${predicate}, found ${objects.length}`,
      );
    }
    const term = objects[0]?.object;
    if (term?.termType !== "Literal" || term.datatype.value !== XSD_INTEGER) {
      throw new SeedToolingError(
        "HIDDEN_FIELD_NOT_INTEGER",
        `hidden field ${predicate} is not an xsd:integer literal - operand_enc must be computed from the exact wrapper-emitted literal`,
      );
    }
    const lexical = term.value;
    if (!CANONICAL_NON_NEGATIVE_INTEGER.test(lexical)) {
      throw new SeedToolingError(
        "HIDDEN_FIELD_NOT_CANONICAL",
        `hidden field ${predicate} lexical "${lexical}" is not a canonical non-negative integer - sparq's encode_int_literal binds the canonical token`,
      );
    }
    return { value: Number(lexical), lexical };
  }
}

export interface MintAnchorsOptions {
  /** The just-issued credential whose hidden fields need anchors. */
  readonly credential: IssuedCredential;
  /** The hidden field IRIs (ZK budget fields only). */
  readonly hiddenFields: readonly string[];
  /** The borrower WebID (must equal the credential's subject). */
  readonly subject: string;
  /** The anchor issuer WebID (normally the credential issuer). */
  readonly issuer: string;
  /** Anchor credential IRI per field (the pod resource URL it will live at). */
  readonly anchorIdFor: (field: string) => string;
  /** Status entry per anchor (anchors are revocable - decision 0012). */
  readonly statusFor: (field: string) => BitstringStatusListEntry | BitstringStatusListEntryInput;
  readonly validity: ValidityWindow;
  /** The issuer's eddsa-rdfc-2022 signing key. */
  readonly key: KeyPair;
  readonly native: SparqNativeBridge;
}

export interface MintedAnchor {
  readonly field: string;
  /** The issuer-anchored term encoding of the hidden value, 0x field hex. */
  readonly operandEnc: string;
  /** The signed `lend:ZkOperandAnchor` credential. */
  readonly credential: IssuedCredential;
}

/**
 * Extract each hidden field's integer literal from the claim graph and
 * fail-closed gate it against the digit budget BEFORE any native
 * call - a value outside its digit budget must never reach an anchor.
 */
export function readHiddenFieldValues(
  credential: IssuedCredential,
  hiddenFields: readonly string[],
  subject: string,
): ReadonlyMap<string, number> {
  const store = new Store([...credential.claimQuads]);
  const claims = new ClaimSubjectNode(DataFactory.namedNode(subject), store, DataFactory);
  const values = new Map<string, number>();
  for (const field of hiddenFields) {
    if (zkBudgetFor(field) === undefined) {
      throw new SeedToolingError(
        "NOT_A_ZK_FIELD",
        `${field} is not a ZK-provable field of this demo - no operand anchor can be minted for it`,
      );
    }
    const { value } = claims.integerClaim(field);
    if (!fitsZkBudget(field, value)) {
      throw new SeedToolingError(
        "BUDGET_VIOLATION",
        `hidden value for ${field} does not fit its digit budget`,
      );
    }
    values.set(field, value);
  }
  return values;
}

/** Mint one `lend:ZkOperandAnchor` VC per hidden field. */
export async function mintOperandAnchors(options: MintAnchorsOptions): Promise<MintedAnchor[]> {
  if (options.hiddenFields.length === 0) return [];
  const values = readHiddenFieldValues(options.credential, options.hiddenFields, options.subject);
  const { encodings } = await options.native.run({
    encodeInts: [...values.values()],
  });
  const anchors: MintedAnchor[] = [];
  for (const [field, value] of values) {
    const operandEnc = encodings[String(value)];
    if (operandEnc === undefined) {
      throw new SeedToolingError(
        "NO_ENCODING",
        `the native helper returned no encoding for ${value}`,
      );
    }
    const credential = await issueCredential({
      kind: "zk-operand-anchor",
      credentialId: options.anchorIdFor(field),
      issuer: options.issuer,
      subject: options.subject,
      claims: { kind: "zk-operand-anchor", field, operandEnc },
      validity: options.validity,
      status: options.statusFor(field),
      key: options.key,
    });
    anchors.push({ field, operandEnc, credential });
  }
  return anchors;
}
