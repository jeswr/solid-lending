/**
 * Graph-level credential plumbing shared by issue/verify/reissue:
 *
 * - the RDF form of an embedded Data Integrity proof (write + strict read);
 * - the document-quads extraction that recovers the SIGNED claim graph from a
 *   pod-resident credential document (everything except the proof subgraph).
 *
 * Rationale: the pinned `@jeswr/solid-vc` signs/verifies over claim QUADS via
 * its `DataIntegritySuite` proof-suite seam. vc-kit builds claim graphs with
 * typed accessors (so shape-required `xsd:date` literals are expressible; the
 * structured-JSON claim path cannot lower them) and drives the same suite over
 * the quads directly. The proof-node convention matches solid-vc's wrappers
 * (`cred --sec:proof--> proof node`), so `wrapVc`/`CredentialNode` read it.
 */

import type { DataIntegrityProof, ProofNode } from "@jeswr/solid-vc";
import type { DataFactory, DatasetCore, Quad, Quad_Subject, Term } from "@rdfjs/types";
import { LiteralFrom, NamedNodeFrom, RequiredAs, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { assertAbsoluteIri } from "./claims.ts";
import {
  DC_CREATED,
  RDF_TYPE,
  SEC_CRYPTOSUITE,
  SEC_DATA_INTEGRITY_PROOF,
  SEC_PROOF,
  SEC_PROOF_PURPOSE,
  SEC_PROOF_VALUE,
  SEC_VERIFICATION_METHOD,
  XSD_DATE_TIME,
} from "./vocab.ts";

/** The predicates an embedded proof node may carry - anything else is refused. */
const PROOF_PREDICATES: ReadonlySet<string> = new Set([
  RDF_TYPE,
  SEC_CRYPTOSUITE,
  SEC_VERIFICATION_METHOD,
  SEC_PROOF_PURPOSE,
  SEC_PROOF_VALUE,
  DC_CREATED,
]);

class ProofWriteNode extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, (term) => term.value, NamedNodeFrom.string);
  }

  writeProof(proof: DataIntegrityProof): void {
    this.types.add(SEC_DATA_INTEGRITY_PROOF);
    RequiredAs.object(this, SEC_CRYPTOSUITE, proof.cryptosuite, LiteralFrom.string);
    RequiredAs.object(
      this,
      SEC_VERIFICATION_METHOD,
      assertAbsoluteIri(proof.verificationMethod, "proof.verificationMethod"),
      NamedNodeFrom.string,
    );
    RequiredAs.object(
      this,
      SEC_PROOF_PURPOSE,
      assertAbsoluteIri(purposeIri(proof.proofPurpose), "proof.proofPurpose"),
      NamedNodeFrom.string,
    );
    if (proof.created !== undefined) {
      RequiredAs.object(
        this,
        DC_CREATED,
        [XSD_DATE_TIME, proof.created],
        LiteralFrom.datatypeTuple,
      );
    }
    RequiredAs.object(this, SEC_PROOF_VALUE, proof.proofValue, LiteralFrom.string);
  }
}

/** The IRI form of a proof purpose (mirrors solid-vc's `purposeIri`). */
export function purposeIri(purpose: string): string {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(purpose)
    ? purpose
    : `https://w3id.org/security#${purpose}`;
}

/**
 * Append `proof` to the credential's graph as an embedded Data Integrity proof
 * node (`cred --sec:proof--> _:proof`). Call ONLY after the claim quads are
 * final - the proof signs the claim graph as-is.
 */
export function appendProof(
  dataset: DatasetCore,
  factory: DataFactory,
  credential: Quad_Subject,
  proof: DataIntegrityProof,
): void {
  const node = factory.blankNode();
  dataset.add(factory.quad(credential, factory.namedNode(SEC_PROOF), node));
  new ProofWriteNode(node, dataset, factory).writeProof(proof);
}

/** One strict read failure while reconstructing an embedded proof. */
export class ProofReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofReadError";
  }
}

function exactlyOne(terms: ReadonlySet<Term>, what: string): Term {
  if (terms.size !== 1) {
    throw new ProofReadError(`proof node must carry exactly one ${what} (found ${terms.size})`);
  }
  const [term] = terms;
  return term as Term;
}

const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

/** A plain (xsd:string, no language) literal's value, else throw. */
function plainLiteral(term: Term, what: string): string {
  if (
    term.termType !== "Literal" ||
    term.language !== "" ||
    (term.datatype !== undefined && term.datatype.value !== XSD_STRING)
  ) {
    throw new ProofReadError(`${what} must be a plain string literal`);
  }
  return term.value;
}

/** Strict `xsd:dateTime` lexical (what the issuance path writes). */
export const DATE_TIME_LEXICAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const DATE_TIME_PARTS =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Strict + CALENDAR-valid `xsd:dateTime` lexical. The regex alone is not
 * enough: V8's `Date.parse` silently normalises an impossible day
 * (`2026-02-30` -> March 2nd), so the date components must round-trip, the
 * time components must be in range, and a zone offset is bounded to +-14:00
 * (the XSD limit).
 */
export function isValidDateTimeLexical(value: string): boolean {
  const match = DATE_TIME_PARTS.exec(value);
  if (match === null) return false;
  const [, year, month, day, hour, minute, second, , zone, , zoneHour, zoneMinute] = match;
  // setUTCFullYear (not the Date.UTC constructor) so four-digit years below
  // 0100 are not remapped to 19xx and wrongly rejected.
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
  ) {
    return false;
  }
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (zone !== "Z") {
    const offsetMinutes = Number(zoneHour) * 60 + Number(zoneMinute);
    if (Number(zoneMinute) > 59 || offsetMinutes > 14 * 60) return false;
  }
  return true;
}

/**
 * Reconstruct the structured {@link DataIntegrityProof} from a parsed proof
 * node, STRICT + fail-closed (throws {@link ProofReadError}):
 *
 *  - the node must be typed `sec:DataIntegrityProof`;
 *  - cryptosuite / verificationMethod / proofPurpose / proofValue must each be
 *    exactly one term of the right kind; `created` is optional but, when
 *    present, must be a single well-formed `xsd:dateTime` literal;
 *  - the node must carry NO predicate outside the proof vocabulary - unsigned
 *    data smuggled onto the proof node (which is excluded from the signed
 *    document quads) is refused rather than silently ignored.
 */
export function readProof(node: ProofNode): DataIntegrityProof {
  const wrapper = node as unknown as TermWrapper;
  for (const quad of wrapper.dataset.match(wrapper as Term)) {
    if (!PROOF_PREDICATES.has(quad.predicate.value)) {
      throw new ProofReadError(
        `proof node carries a non-proof predicate (unsigned data): <${quad.predicate.value}>`,
      );
    }
  }

  // Exactly ONE type, and it must be the sec:DataIntegrityProof IRI: extra
  // type quads live outside the signed document (proof subgraph), so
  // tolerating them would let unsigned data ride the proof node, and a
  // literal/blank type whose VALUE merely equals the IRI is not a type.
  const typeTerm = exactlyOne(node.types as unknown as ReadonlySet<Term>, "rdf:type");
  if (typeTerm.termType !== "NamedNode" || typeTerm.value !== SEC_DATA_INTEGRITY_PROOF) {
    throw new ProofReadError("proof node is not typed sec:DataIntegrityProof");
  }

  const cryptosuite = plainLiteral(
    exactlyOne(node.cryptosuites as ReadonlySet<Term>, "sec:cryptosuite"),
    "sec:cryptosuite",
  );
  const verificationMethod = exactlyOne(
    node.verificationMethods as ReadonlySet<Term>,
    "sec:verificationMethod",
  );
  if (verificationMethod.termType !== "NamedNode") {
    throw new ProofReadError("sec:verificationMethod must be an IRI");
  }
  const proofPurpose = exactlyOne(node.proofPurposes as ReadonlySet<Term>, "sec:proofPurpose");
  if (proofPurpose.termType !== "NamedNode") {
    throw new ProofReadError("sec:proofPurpose must be an IRI");
  }
  const proofValue = plainLiteral(
    exactlyOne(node.proofValues as ReadonlySet<Term>, "sec:proofValue"),
    "sec:proofValue",
  );

  const createds = node.createds as ReadonlySet<Term>;
  let created: string | undefined;
  if (createds.size > 0) {
    const term = exactlyOne(createds, "dcterms:created");
    if (
      term.termType !== "Literal" ||
      term.datatype?.value !== XSD_DATE_TIME ||
      !isValidDateTimeLexical(term.value)
    ) {
      throw new ProofReadError("dcterms:created must be a well-formed xsd:dateTime literal");
    }
    created = term.value;
  }

  return {
    type: "DataIntegrityProof",
    cryptosuite,
    verificationMethod: verificationMethod.value,
    proofPurpose: proofPurpose.value,
    ...(created !== undefined ? { created } : {}),
    proofValue,
  };
}

/**
 * The SIGNED document quads of a pod-resident credential document: every quad
 * except (a) the credential's `sec:proof` link quads and (b) quads whose
 * subject is one of those proof nodes. The exclusion is deliberately MINIMAL
 * and fail-closed: any other extra quad (a decoy node, a claim smuggled deeper
 * under the proof node, a second `sec:proof` triple on a foreign subject)
 * stays in the document and breaks the signature; extra predicates ON a proof
 * node are refused by {@link readProof}.
 */
export function documentQuadsOf(dataset: DatasetCore, credential: Term): Quad[] {
  const proofTerms: Term[] = [];
  for (const quad of dataset.match(credential)) {
    if (quad.predicate.value === SEC_PROOF) proofTerms.push(quad.object);
  }
  const quads: Quad[] = [];
  for (const quad of dataset) {
    if (quad.subject.equals(credential) && quad.predicate.value === SEC_PROOF) continue;
    if (proofTerms.some((proof) => quad.subject.equals(proof))) continue;
    quads.push(quad);
  }
  return quads;
}
