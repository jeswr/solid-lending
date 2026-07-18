/**
 * Credential issuance: typed claims -> claim graph (via `@rdfjs/wrapper`
 * accessors) -> SHACL validation against the matching lending shape
 * (fail-closed, BEFORE signing) -> `eddsa-rdfc-2022` Data Integrity proof
 * through `@jeswr/solid-vc`'s suite seam -> Turtle.
 *
 * Determinism contract: the library never reads the clock. `validity` and the
 * proof timestamp are explicit parameters, so backdated seeding (the
 * freshness beat's validFrom -30d / validUntil +14d) is just an input.
 */

import {
  type BitstringStatusListEntry,
  type BitstringStatusListEntryInput,
  bitstringStatusListEntry,
  type DataIntegrityProof,
  DataIntegritySuite,
  type KeyPair,
  serialize,
} from "@jeswr/solid-vc";
import { type ShaclViolation, validate } from "@lending/data-model";
import type { Quad, Quad_Subject } from "@rdfjs/types";
import {
  LiteralFrom,
  NamedNodeFrom,
  RequiredAs,
  SetFrom,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import {
  assertAbsoluteIri,
  ClaimInputError,
  type CredentialClaims,
  writeSubjectClaims,
} from "./claims.ts";
import { appendProof } from "./credential.ts";
import {
  type CredentialKind,
  credentialSchemaIri,
  RDF_TYPE,
  STATUS_BITSTRING_ENTRY,
  STATUS_LIST_CREDENTIAL,
  STATUS_LIST_INDEX,
  STATUS_PURPOSE,
  targetClassOf,
  VC_CREDENTIAL,
  VC_CREDENTIAL_SCHEMA,
  VC_CREDENTIAL_STATUS,
  VC_CREDENTIAL_SUBJECT,
  VC_ISSUER,
  VC_VALID_FROM,
  VC_VALID_UNTIL,
  XSD_DATE_TIME,
} from "./vocab.ts";

/** The explicit validity window of a credential (no clock reads — pass dates). */
export interface ValidityWindow {
  readonly validFrom: Date;
  /**
   * Optional at the type level, but most lending credential shapes REQUIRE
   * `cred:validUntil` — the shape gate refuses issuance without it for those.
   */
  readonly validUntil?: Date;
}

export interface IssueCredentialOptions {
  /** The credential kind — selects the lend class, subject shape and schema IRI. */
  readonly kind: CredentialKind;
  /** The credential IRI — use the pod resource URL the document will live at. */
  readonly credentialId: string;
  /** The issuing party's WebID. */
  readonly issuer: string;
  /** The subject WebID (the borrower; the holder-binding anchor). */
  readonly subject: string;
  /** The typed claims (must match `kind`). */
  readonly claims: CredentialClaims;
  /** Explicit validity window (supports backdated issuance). */
  readonly validity: ValidityWindow;
  /**
   * The Bitstring Status List entry for this credential (one list per issuer
   * app; status = revocation only — freshness is re-issuance). Validated
   * fail-closed via solid-vc's `bitstringStatusListEntry`. Most credential
   * shapes REQUIRE a status entry; omitting it fails the shape gate for those.
   */
  readonly status?: BitstringStatusListEntry | BitstringStatusListEntryInput;
  /** The issuer's signing key (`eddsa-rdfc-2022` — Ed25519). */
  readonly key: KeyPair;
  /** The proof `created` timestamp. Defaults to `validity.validFrom`. */
  readonly proofCreated?: Date;
}

/** Issuance refused: the claim graph failed its lending SHACL shape. */
export class IssueRefusedError extends Error {
  readonly violations: readonly ShaclViolation[];
  constructor(kind: CredentialKind, violations: readonly ShaclViolation[]) {
    const detail = violations
      .map(
        (violation) =>
          `- ${violation.message}${violation.path.length > 0 ? ` (path ${violation.path.join(" / ")})` : ""}`,
      )
      .join("\n");
    super(`refusing to sign a ${kind} that violates its shape:\n${detail}`);
    this.name = "IssueRefusedError";
    this.violations = violations;
  }
}

/** An issued (signed) credential, ready to store in a pod. */
export interface IssuedCredential {
  readonly credentialId: string;
  readonly kind: CredentialKind;
  /** The full signed document (claim graph + embedded proof). */
  readonly quads: readonly Quad[];
  /** The SIGNED subset (claim graph only) — what the proof covers. */
  readonly claimQuads: readonly Quad[];
  readonly proof: DataIntegrityProof;
  /** The document serialised for a pod `PUT`. */
  readonly body: string;
  readonly contentType: "text/turtle";
  /** The credential's status entry (present when `status` was supplied). */
  readonly status?: BitstringStatusListEntry;
}

class CredentialWriteNode extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, (term) => term.value, NamedNodeFrom.string);
  }
}

class StatusEntryWriteNode extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, (term) => term.value, NamedNodeFrom.string);
  }

  writeEntry(entry: BitstringStatusListEntry): void {
    this.types.add(STATUS_BITSTRING_ENTRY);
    RequiredAs.object(this, STATUS_PURPOSE, entry.statusPurpose, LiteralFrom.string);
    RequiredAs.object(this, STATUS_LIST_INDEX, entry.statusListIndex, LiteralFrom.string);
    RequiredAs.object(
      this,
      STATUS_LIST_CREDENTIAL,
      assertAbsoluteIri(entry.statusListCredential, "status.statusListCredential"),
      NamedNodeFrom.string,
    );
  }
}

function toStatusEntry(
  status: BitstringStatusListEntry | BitstringStatusListEntryInput,
): BitstringStatusListEntry {
  // Both shapes funnel through solid-vc's fail-closed validator (integer index,
  // known purpose, http(s) list URL) — a credential must never be signed over a
  // status entry its verifier cannot resolve.
  return bitstringStatusListEntry({
    statusPurpose: status.statusPurpose as "revocation" | "suspension",
    statusListIndex: status.statusListIndex,
    statusListCredential: status.statusListCredential,
    ...(status.id !== undefined ? { id: status.id } : {}),
  });
}

/**
 * Issue (sign) a lending credential. Fail-closed ordering: the claim graph is
 * SHACL-validated against its lending shape BEFORE any signature is produced —
 * an invalid payload throws {@link IssueRefusedError} and nothing is signed.
 */
export async function issueCredential(options: IssueCredentialOptions): Promise<IssuedCredential> {
  if (options.claims.kind !== options.kind) {
    throw new ClaimInputError(
      `claims.kind ${options.claims.kind} does not match kind ${options.kind}`,
    );
  }
  const factory = DataFactory;
  const store = new Store();
  const credentialIri = assertAbsoluteIri(options.credentialId, "credentialId");
  const credentialTerm = factory.namedNode(credentialIri);
  const credential = new CredentialWriteNode(credentialTerm, store, factory);

  credential.types.add(VC_CREDENTIAL);
  credential.types.add(targetClassOf(options.kind));
  RequiredAs.object(
    credential,
    VC_ISSUER,
    assertAbsoluteIri(options.issuer, "issuer"),
    NamedNodeFrom.string,
  );
  RequiredAs.object(
    credential,
    VC_CREDENTIAL_SCHEMA,
    credentialSchemaIri(options.kind),
    NamedNodeFrom.string,
  );
  RequiredAs.object(
    credential,
    VC_CREDENTIAL_SUBJECT,
    assertAbsoluteIri(options.subject, "subject WebID"),
    NamedNodeFrom.string,
  );
  writeSubjectClaims(credential, options.subject, options.claims);

  return finishIssue(store, credentialTerm, options.kind, {
    validity: options.validity,
    ...(options.status !== undefined ? { status: options.status } : {}),
    key: options.key,
    proofCreated: options.proofCreated ?? options.validity.validFrom,
  });
}

/** The graph-level tail of issuance, shared with re-issue. */
export interface FinishIssueOptions {
  readonly validity: ValidityWindow;
  readonly status?: BitstringStatusListEntry | BitstringStatusListEntryInput;
  readonly key: KeyPair;
  readonly proofCreated?: Date;
}

/**
 * Complete issuance over a PRE-BUILT claim graph (types, issuer, schema,
 * subject + claims already present): write the validity window + status entry,
 * run the lending shape gate bound to the credential root (fail-closed, BEFORE
 * signing), sign with `eddsa-rdfc-2022`, embed the proof, serialise.
 */
export async function finishIssue(
  store: Store,
  credentialTerm: Quad_Subject & { value: string },
  kind: CredentialKind,
  options: FinishIssueOptions,
): Promise<IssuedCredential> {
  const factory = DataFactory;
  const credential = new CredentialWriteNode(credentialTerm, store, factory);

  RequiredAs.object(
    credential,
    VC_VALID_FROM,
    [XSD_DATE_TIME, options.validity.validFrom.toISOString()],
    LiteralFrom.datatypeTuple,
  );
  if (options.validity.validUntil !== undefined) {
    RequiredAs.object(
      credential,
      VC_VALID_UNTIL,
      [XSD_DATE_TIME, options.validity.validUntil.toISOString()],
      LiteralFrom.datatypeTuple,
    );
  }

  let statusEntry: BitstringStatusListEntry | undefined;
  if (options.status !== undefined) {
    statusEntry = toStatusEntry(options.status);
    const entryNode = factory.blankNode();
    RequiredAs.object(credential, VC_CREDENTIAL_STATUS, entryNode, TermFrom.itself);
    new StatusEntryWriteNode(entryNode, store, factory).writeEntry(statusEntry);
  }

  // Shape gate BEFORE signing, bound to the credential root (decoy-proof).
  const report = await validate(store, { expect: kind, focusNode: credentialTerm.value });
  if (!report.conforms) {
    throw new IssueRefusedError(kind, report.violations);
  }

  const claimQuads = [...store] as Quad[];
  const suite = new DataIntegritySuite("eddsa-rdfc-2022");
  const proof = await suite.sign(claimQuads, {
    key: options.key,
    proofPurpose: "assertionMethod",
    created: options.proofCreated ?? options.validity.validFrom,
  });
  appendProof(store, factory, credentialTerm, proof);

  const quads = [...store] as Quad[];
  const body = await serialize(quads, "text/turtle");
  return {
    credentialId: credentialTerm.value,
    kind,
    quads,
    claimQuads,
    proof,
    body,
    contentType: "text/turtle",
    ...(statusEntry !== undefined ? { status: statusEntry } : {}),
  };
}
