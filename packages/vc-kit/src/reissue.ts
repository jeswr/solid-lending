/**
 * Freshness (decision-0007 pattern carried from the mortgage demo): freshness is demonstrated
 * by RE-ISSUANCE - a short `validUntil` plus a one-click re-issue - while the
 * status list signals revocation ONLY. `isFresh` implements the window check;
 * `reissueCredential` mints a same-claims credential with a fresh window and
 * revokes the old one's status index (scene 4).
 */

import { readValidCredential } from "@jeswr/solid-vc";
import type { DatasetCore, Quad, Term } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { assertAbsoluteIri } from "./claims.ts";
import { documentQuadsOf, isValidDateTimeLexical } from "./credential.ts";
import { finishIssue, type IssueCredentialOptions, type IssuedCredential } from "./issue.ts";
import type { StatusIndexAllocator, StatusListClient } from "./status.ts";
import { type EmbeddedProofOptions, verifyEmbeddedProofs } from "./verify.ts";
import {
  type CredentialKind,
  credentialKindOfTypes,
  SEC_PROOF,
  STATUS_LIST_CREDENTIAL,
  STATUS_LIST_INDEX,
  VC_CREDENTIAL_STATUS,
  VC_CREDENTIAL_SUBJECT,
  VC_VALID_FROM,
  VC_VALID_UNTIL,
} from "./vocab.ts";

/** The window a credential asserts (as read from its graph). */
export interface ValidityWindowInfo {
  readonly validFrom?: string;
  readonly validUntil?: string;
}

/**
 * Decision 0007 freshness semantics: fresh IFF the credential asserts a
 * COMPLETE validity window and `asOf` lies inside it. Fail-closed: a missing
 * or malformed `validFrom`/`validUntil` is NOT fresh (an unbounded credential
 * can never satisfy the 10-business-day re-verification rule this implements).
 * Revocation is deliberately NOT consulted here - status is a separate signal
 * (the scene-4 green tick is `verifyCredential` AND `isFresh`).
 */
export function isFresh(window: ValidityWindowInfo, asOf: Date): boolean {
  if (window.validFrom === undefined || window.validUntil === undefined) return false;
  // Strict, calendar-valid xsd:dateTime lexicals only - `Date.parse` alone is
  // lenient ("2026" parses; "2026-02-30" normalises), and this helper is
  // documented as consumable straight off a credential projection, so it must
  // not be softer than the verify gate.
  if (!isValidDateTimeLexical(window.validFrom) || !isValidDateTimeLexical(window.validUntil)) {
    return false;
  }
  const from = Date.parse(window.validFrom);
  const until = Date.parse(window.validUntil);
  if (Number.isNaN(from) || Number.isNaN(until)) return false;
  const at = asOf.getTime();
  return from <= at && at <= until;
}

/** A structured re-issue failure. */
export class ReissueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReissueError";
  }
}

export interface ReissueOptions {
  /** The issuer's signing key (must be the ORIGINAL issuer's - asserted). */
  readonly key: IssueCredentialOptions["key"];
  /** The re-issue instant: new proof `created` + revocation write timestamp. */
  readonly now: Date;
  /** The fresh validity window of the replacement credential. */
  readonly validity: IssueCredentialOptions["validity"];
  /** The issuer's hosted status list (revokes the old index, hosts the new). */
  readonly statusList: StatusListClient;
  /** Allocator for the replacement's index (keeps issuer occupancy honest). */
  readonly allocator: StatusIndexAllocator;
  /** The replacement credential IRI. Default: the old credential's IRI. */
  readonly credentialId?: string;
  /**
   * Key resolution for authenticating the OLD credential's signature before
   * its claims are carried over. Default: exactly `key` (the issuer re-signing
   * its own credential). For a credential signed with a ROTATED key, override
   * `resolveKey` AND `isControlledBy` TOGETHER - the default binding also
   * pins the old verification method to `key.verificationMethod`, so a
   * resolver-only override still fails closed.
   */
  readonly resolveKey?: EmbeddedProofOptions["resolveKey"];
  /**
   * Issuer binding for the old credential's proof. Default:
   * `vm === key.verificationMethod && issuer === statusList.issuer`. Must be
   * overridden together with `resolveKey` for rotated keys (see above).
   */
  readonly isControlledBy?: EmbeddedProofOptions["isControlledBy"];
}

export interface ReissueResult {
  readonly issued: IssuedCredential;
  /** The OLD credential's status index, now revoked. */
  readonly revokedIndex: number;
  /** The replacement credential's status index. */
  readonly newIndex: number;
}

/**
 * Re-issue a credential (scene 4): SAME claims (the old claim subgraph is
 * copied verbatim - the strongest form of "same claims"), fresh validity
 * window, fresh status index, and the OLD index revoked. Kind-agnostic: the
 * claim graph round-trips without a per-kind projection, and the lending shape
 * re-validates the rebuilt document before the new signature is produced.
 *
 * Fail-closed guards - re-issuance is a SIGNING ORACLE unless every one holds:
 *  - the old document must be a well-formed single-VC graph;
 *  - its issuer must match the status list's issuer;
 *  - its embedded proof MUST cryptographically verify against the issuer's
 *    key ({@link verifyEmbeddedProofs}) - the old document typically lives in
 *    the HOLDER's pod, so unauthenticated claims must never be re-signed
 *    (a holder could otherwise edit their income and have the tampered value
 *    re-issued as genuine). Expiry is deliberately tolerated (the flow exists
 *    to renew expired credentials); signature/binding failures are not;
 *  - its status entry must point at THIS status list and must NOT already be
 *    revoked (re-issuing a revoked credential is an explicit issuer decision,
 *    not a one-click renewal).
 */
export async function reissueCredential(
  oldDocument: DatasetCore,
  options: ReissueOptions,
): Promise<ReissueResult> {
  const structural = readValidCredential(oldDocument);
  if (!structural.valid) {
    throw new ReissueError(`old credential is not well-formed: ${structural.error}`);
  }
  const meta = structural.credential;
  const oldTerm = meta.node as unknown as Term;
  if (oldTerm.termType !== "NamedNode") {
    throw new ReissueError("old credential node must be an IRI");
  }
  if (meta.issuer !== options.statusList.issuer) {
    throw new ReissueError(
      `old credential issuer ${meta.issuer} does not match the status list issuer ${options.statusList.issuer}`,
    );
  }
  const kind = credentialKindOfTypes(meta.types);
  if (kind === undefined) {
    throw new ReissueError("old credential carries no known lend credential class");
  }

  // Authenticate the old claims BEFORE anything is carried over or signed.
  const resolveKey =
    options.resolveKey ??
    (async (verificationMethod: string) =>
      verificationMethod === options.key.verificationMethod ? options.key.publicKey : undefined);
  const isControlledBy =
    options.isControlledBy ??
    ((verificationMethod: string, issuer: string) =>
      verificationMethod === options.key.verificationMethod &&
      issuer === options.statusList.issuer);
  const proofErrors = await verifyEmbeddedProofs(oldDocument, meta.node, meta.issuer, {
    resolveKey,
    isControlledBy,
  });
  if (proofErrors.length > 0) {
    throw new ReissueError(
      `old credential failed proof verification (${proofErrors.map((error) => error.code).join(", ")}) - refusing to re-sign unauthenticated claims`,
    );
  }

  const oldIndex = readOwnStatusIndex(oldDocument, oldTerm, options.statusList);
  if (await options.statusList.readBit(oldIndex, { now: options.now })) {
    throw new ReissueError(
      `old credential's status index ${oldIndex} is already revoked - re-issuing a revoked credential requires an explicit issuer decision`,
    );
  }

  const newId = assertReissueIri(options.credentialId ?? meta.id);
  // Reserve the old index FIRST: a partially rehydrated allocator could
  // otherwise hand the replacement the very index the revoke below sets.
  options.allocator.reserve(oldIndex);
  const newIndex = options.allocator.allocate(
    newId === meta.id ? `${newId}#reissue-${options.now.toISOString()}` : newId,
  );
  if (newIndex === oldIndex) {
    throw new ReissueError("allocator returned the revoked index for the replacement");
  }

  const issued = await reissueSameClaims(oldDocument, oldTerm, kind, {
    credentialId: newId,
    issuer: meta.issuer,
    validity: options.validity,
    status: options.statusList.entry(newIndex),
    key: options.key,
    now: options.now,
  });

  await options.statusList.revoke(oldIndex, { now: options.now });
  return { issued, revokedIndex: oldIndex, newIndex };
}

/** IRI-guard the replacement id (caller-supplied ids bypass issueCredential's gate). */
function assertReissueIri(id: string): string {
  try {
    return assertAbsoluteIri(id, "replacement credentialId");
  } catch (error) {
    throw new ReissueError((error as Error).message);
  }
}

interface SameClaimsOptions {
  readonly credentialId: string;
  readonly issuer: string;
  readonly validity: IssueCredentialOptions["validity"];
  readonly status: ReturnType<StatusListClient["entry"]>;
  readonly key: IssueCredentialOptions["key"];
  readonly now: Date;
}

/**
 * Rebuild the credential with the old claim subgraph copied verbatim: every
 * quad except the old credential node's OWN volatile statements (validity,
 * status link + entry node, proof link + proof nodes) carries over; the
 * credential-node statements that are claims-adjacent (evidence links, types,
 * schema, subject link) are re-pointed at the new credential IRI.
 */
async function reissueSameClaims(
  oldDocument: DatasetCore,
  oldTerm: Term,
  kind: CredentialKind,
  options: SameClaimsOptions,
): Promise<IssuedCredential> {
  const factory = DataFactory;
  const claimQuads = documentQuadsOf(oldDocument, oldTerm);

  // Old volatile nodes to drop: the status entry node(s).
  const statusEntryTerms: Term[] = [];
  for (const quad of claimQuads) {
    if (quad.subject.equals(oldTerm) && quad.predicate.value === VC_CREDENTIAL_STATUS) {
      statusEntryTerms.push(quad.object);
    }
  }

  const DROPPED_CREDENTIAL_PREDICATES = new Set<string>([
    VC_VALID_FROM,
    VC_VALID_UNTIL,
    VC_CREDENTIAL_STATUS,
    SEC_PROOF,
  ]);

  const carried = new Store();
  const newTerm = factory.namedNode(options.credentialId);
  let subjectIri: string | undefined;
  for (const quad of claimQuads) {
    if (statusEntryTerms.some((entry) => quad.subject.equals(entry))) continue;
    if (quad.subject.equals(oldTerm)) {
      if (DROPPED_CREDENTIAL_PREDICATES.has(quad.predicate.value)) continue;
      if (quad.predicate.value === VC_CREDENTIAL_SUBJECT && quad.object.termType === "NamedNode") {
        subjectIri = quad.object.value;
      }
      carried.add(factory.quad(newTerm, quad.predicate, quad.object));
      continue;
    }
    carried.add(quad as Quad);
  }
  if (subjectIri === undefined) {
    throw new ReissueError("old credential has no IRI credentialSubject to carry over");
  }

  // Reuse the issuance tail: fresh validity + status entry, the lending shape
  // gate over the rebuilt document, sign, embed, serialise.
  return finishIssue(carried, newTerm, kind, {
    validity: options.validity,
    status: options.status,
    key: options.key,
    proofCreated: options.now,
  });
}

/** The old credential's index in THIS status list, strictly read. */
function readOwnStatusIndex(
  dataset: DatasetCore,
  credential: Term,
  statusList: StatusListClient,
): number {
  const entries: Term[] = [];
  for (const quad of dataset.match(credential)) {
    if (quad.predicate.value === VC_CREDENTIAL_STATUS) entries.push(quad.object);
  }
  if (entries.length !== 1) {
    throw new ReissueError(
      `old credential must carry exactly one credentialStatus entry (found ${entries.length})`,
    );
  }
  const entry = entries[0] as Term;
  let listUrl: string | undefined;
  let index: string | undefined;
  for (const quad of dataset.match(entry)) {
    if (quad.predicate.value === STATUS_LIST_CREDENTIAL) listUrl = quad.object.value;
    if (quad.predicate.value === STATUS_LIST_INDEX) index = quad.object.value;
  }
  const normalizedListUrl = listUrl === undefined ? undefined : URL.parse(listUrl)?.href;
  if (normalizedListUrl === undefined || normalizedListUrl !== statusList.url) {
    throw new ReissueError(
      `old credential's status list ${listUrl ?? "(none)"} is not the supplied list ${statusList.url}`,
    );
  }
  if (index === undefined || !/^(0|[1-9][0-9]*)$/.test(index)) {
    throw new ReissueError("old credential's statusListIndex is not a non-negative integer");
  }
  return Number(index);
}
