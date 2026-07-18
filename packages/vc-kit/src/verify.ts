/**
 * Credential verification (fail-closed gate conjunction). A conjunction of
 * independent fail-closed gates over the pod-resident credential DOCUMENT
 * (Turtle / JSON-LD / parsed dataset):
 *
 *  1. structural   - exactly one well-formed VC node (`readValidCredential`);
 *  2. shape        - the lending SHACL shape named by `expectShape`, bound to the
 *                    credential root (vacuous-conformance- and decoy-proof);
 *  3. window       - `validFrom`/`validUntil` against the EXPLICIT `now`;
 *  4. status       - Bitstring Status List via solid-vc's fail-closed resolver
 *                    (revoked / suspended / UNREACHABLE all fail - an
 *                    unconfirmable status is never a pass);
 *  5. proof        - every embedded `sec:proof` must strictly reconstruct and
 *                    cryptographically verify over the signed document quads;
 *                    the verification method must be controlled by the issuer.
 *
 * `verified` is true IFF every gate passed; `errors` lists every distinct
 * failure. The function never throws on hostile input.
 */

import {
  type CredentialNode,
  type CredentialStatusCheck,
  createBitstringStatusResolver,
  createWebIdKeyResolver,
  credentialStatusFromNode,
  defaultSuiteRegistry,
  parseCredentialRdf,
  readValidCredential,
  type SuiteRegistry,
  type VerifiableCredential,
  type VerificationErrorCode,
} from "@jeswr/solid-vc";
import { type LendingResourceKind, validate } from "@lending/data-model";
import type { DatasetCore, Term } from "@rdfjs/types";
import { DATE_TIME_LEXICAL, documentQuadsOf, purposeIri, readProof } from "./credential.ts";
import { VC_CREDENTIAL_STATUS } from "./vocab.ts";

/** solid-vc's error codes plus the vc-kit shape gate. */
export type VcKitErrorCode = VerificationErrorCode | "SHAPE_VIOLATION";

export interface VcKitVerificationError {
  readonly code: VcKitErrorCode;
  readonly message: string;
}

/** The verified credential's projection (populated when structurally valid). */
export interface VerifiedCredentialInfo {
  readonly id: string;
  readonly issuer: string;
  /** The single credentialSubject IRI - decision 0012's holder-binding anchor. */
  readonly subject?: string;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly types: readonly string[];
}

export interface VerifyCredentialResult {
  readonly verified: boolean;
  readonly errors: readonly VcKitVerificationError[];
  readonly credential?: VerifiedCredentialInfo;
}

export interface VerifyCredentialOptions {
  /**
   * The lending resource kind this document MUST contain - the shape gate is
   * mandatory (an unshaped verification would conform vacuously on hostile
   * input).
   */
  readonly expectShape: LendingResourceKind;
  /** The instant to evaluate validity at. EXPLICIT - vc-kit never reads the clock. */
  readonly now: Date;
  /**
   * Resolve a proof's `verificationMethod` IRI to its public key. Default: the
   * fail-closed WebID-document resolver (`createWebIdKeyResolver`) over
   * `webIdFetch` - the issuer's WebID document must list the key under
   * `sec:assertionMethod` and the key must bind back via `sec:controller`.
   */
  readonly resolveKey?: (verificationMethod: string) => Promise<CryptoKey | undefined>;
  /**
   * Whether `verificationMethod` is controlled by the issuer. Defaults to the
   * WebID-document check when `resolveKey` is defaulted, else to the
   * prefix heuristic (`vm === issuer` or `vm` starts with `issuer#`/`issuer/`).
   * NOTE the prefix heuristic cannot authorise `#me`-style WebIDs' keys - use
   * the WebID resolver (or pass this explicitly) for those.
   */
  readonly isControlledBy?: (
    verificationMethod: string,
    issuer: string,
  ) => boolean | Promise<boolean>;
  /**
   * Fetch for WebID/key documents when `resolveKey` is defaulted. Default:
   * solid-vc's SSRF-guarded fetch (DNS-pinned, redirects refused) - inject the
   * harness fetch in tests.
   */
  readonly webIdFetch?: typeof fetch;
  /**
   * Fetch for the Bitstring status list. Default: solid-vc's SSRF-guarded
   * fetch. Inject the harness fetch in tests.
   */
  readonly statusFetch?: typeof fetch;
  /** Issuer allowlist - when present, the issuer MUST be in it. */
  readonly trustedIssuers?: readonly string[];
  /** Issuers allowed to sign the status list. Default: the credential's issuer. */
  readonly trustedStatusIssuers?: readonly string[];
  /** The accepted proof suites. Default: eddsa-rdfc-2022 + ecdsa-rdfc-2019. */
  readonly registry?: SuiteRegistry;
  /** Content type when `input` is a string. Default `text/turtle`. */
  readonly contentType?: string;
}

function defaultControlledBy(verificationMethod: string, issuer: string): boolean {
  if (verificationMethod === issuer) return true;
  return verificationMethod.startsWith(`${issuer}#`) || verificationMethod.startsWith(`${issuer}/`);
}

/**
 * Verify a pod-resident lending credential document. Every gate is
 * fail-closed; see the module header for the gate list.
 */
export async function verifyCredential(
  input: string | DatasetCore,
  options: VerifyCredentialOptions,
): Promise<VerifyCredentialResult> {
  const errors: VcKitVerificationError[] = [];

  let dataset: DatasetCore;
  if (typeof input === "string") {
    try {
      dataset = await parseCredentialRdf(input, options.contentType ?? "text/turtle");
    } catch (error) {
      return {
        verified: false,
        errors: [
          {
            code: "MALFORMED",
            message: `credential document did not parse: ${(error as Error).message}`,
          },
        ],
      };
    }
  } else {
    dataset = input;
  }

  // Gate 1: structural (exactly one well-formed VC node; fail-closed reader).
  const structural = readValidCredential(dataset);
  if (!structural.valid) {
    return { verified: false, errors: [{ code: "MALFORMED", message: structural.error }] };
  }
  const meta = structural.credential;
  const node = meta.node;
  const credentialTerm = node as unknown as Term;
  if (credentialTerm.termType !== "NamedNode") {
    return {
      verified: false,
      errors: [{ code: "MALFORMED", message: "credential node must be an IRI (a pod resource)" }],
    };
  }

  const subjects = [...node.subjects];
  const subjectIri =
    subjects.length === 1 && (subjects[0] as unknown as Term).termType === "NamedNode"
      ? (subjects[0] as unknown as Term).value
      : undefined;
  const info: VerifiedCredentialInfo = {
    id: meta.id,
    issuer: meta.issuer,
    ...(subjectIri !== undefined ? { subject: subjectIri } : {}),
    ...(meta.validFrom !== undefined ? { validFrom: meta.validFrom } : {}),
    ...(meta.validUntil !== undefined ? { validUntil: meta.validUntil } : {}),
    types: meta.types,
  };

  // Gate 2: the lending shape, bound to the credential root.
  try {
    const report = await validate(dataset, {
      expect: options.expectShape,
      focusNode: meta.id,
    });
    for (const violation of report.violations) {
      errors.push({
        code: "SHAPE_VIOLATION",
        message: `${violation.message}${violation.focusNode !== undefined ? ` (focus ${violation.focusNode})` : ""}`,
      });
    }
  } catch (error) {
    errors.push({
      code: "SHAPE_VIOLATION",
      message: `shape validation could not run: ${(error as Error).message}`,
    });
  }

  // Gate 3: validity window against the explicit `now`.
  const nowMs = options.now.getTime();
  if (meta.validFrom !== undefined && nowMs < Date.parse(meta.validFrom)) {
    errors.push({
      code: "NOT_YET_VALID",
      message: `credential not valid before ${meta.validFrom}`,
    });
  }
  if (meta.validUntil !== undefined && nowMs > Date.parse(meta.validUntil)) {
    errors.push({ code: "EXPIRED", message: `credential expired at ${meta.validUntil}` });
  }

  // Issuer allowlist.
  if (options.trustedIssuers !== undefined && !options.trustedIssuers.includes(meta.issuer)) {
    errors.push({ code: "UNTRUSTED_ISSUER", message: `issuer ${meta.issuer} is not trusted` });
  }

  // Key resolution seams (shared by the proof gate and the status gate).
  const webIdResolver =
    options.resolveKey === undefined
      ? createWebIdKeyResolver(
          options.webIdFetch !== undefined ? { fetch: options.webIdFetch } : {},
        )
      : undefined;
  const resolveKey = options.resolveKey ?? webIdResolver?.resolveKey;
  const isControlledBy =
    options.isControlledBy ?? webIdResolver?.isControlledBy ?? defaultControlledBy;
  if (resolveKey === undefined) {
    // Unreachable by construction; kept as an explicit fail-closed guard.
    return {
      verified: false,
      errors: [{ code: "INVALID_SIGNATURE", message: "no key resolver available" }],
      credential: info,
    };
  }

  // Gate 4: Bitstring status, fail-closed (decision 0012; solid-vc resolver).
  errors.push(
    ...(await statusGate(dataset, node, meta.issuer, resolveKey, isControlledBy, options)),
  );

  // Gate 5: proofs. Strict reconstruction; EVERY proof must verify.
  errors.push(
    ...(await verifyEmbeddedProofs(dataset, node, meta.issuer, {
      resolveKey,
      isControlledBy,
      ...(options.registry !== undefined ? { registry: options.registry } : {}),
    })),
  );

  return errors.length === 0
    ? { verified: true, errors: [], credential: info }
    : { verified: false, errors, credential: info };
}

/** The key-resolution seams the proof gate consumes. */
export interface EmbeddedProofOptions {
  readonly resolveKey: (verificationMethod: string) => Promise<CryptoKey | undefined>;
  readonly isControlledBy?: (
    verificationMethod: string,
    issuer: string,
  ) => boolean | Promise<boolean>;
  readonly registry?: SuiteRegistry;
}

/**
 * The signature gate ALONE, over a parsed credential node: strict proof
 * reconstruction ({@link readProof}), at least one proof, and EVERY proof must
 * be purpose-correct, issuer-bound and cryptographically valid over the signed
 * document quads. Shared by `verifyCredential` (gate 5) and the re-issue
 * flow's authenticate-before-re-sign guard; composes with the other gates -
 * it does NOT check shape, window or status by itself.
 */
export async function verifyEmbeddedProofs(
  dataset: DatasetCore,
  node: CredentialNode,
  issuer: string,
  options: EmbeddedProofOptions,
): Promise<VcKitVerificationError[]> {
  const errors: VcKitVerificationError[] = [];
  const isControlledBy = options.isControlledBy ?? defaultControlledBy;
  const registry = options.registry ?? defaultSuiteRegistry();
  const credentialTerm = node as unknown as Term;
  const documentQuads = documentQuadsOf(dataset, credentialTerm);
  const proofs = [...node.proofs];
  if (proofs.length === 0) {
    errors.push({ code: "NO_PROOF", message: "credential carries no proof" });
  }
  for (const proofNode of proofs) {
    let proof: ReturnType<typeof readProof>;
    try {
      proof = readProof(proofNode);
    } catch (error) {
      errors.push({ code: "MALFORMED", message: (error as Error).message });
      continue;
    }
    const suite = registry.get(proof.cryptosuite);
    if (suite === undefined) {
      errors.push({
        code: "UNKNOWN_CRYPTOSUITE",
        message: `no registered suite for cryptosuite "${proof.cryptosuite}"`,
      });
      continue;
    }
    if (proof.proofPurpose !== purposeIri("assertionMethod")) {
      errors.push({
        code: "PROOF_PURPOSE_MISMATCH",
        message: `proofPurpose ${proof.proofPurpose} != expected assertionMethod`,
      });
    }
    if (proof.created !== undefined && !DATE_TIME_LEXICAL.test(proof.created)) {
      errors.push({
        code: "MALFORMED",
        message: "proof created is not a well-formed xsd:dateTime",
      });
      continue;
    }
    if (!(await controlledByFailClosed(isControlledBy, proof.verificationMethod, issuer))) {
      errors.push({
        code: "ISSUER_MISMATCH",
        message: `verificationMethod ${proof.verificationMethod} is not controlled by issuer ${issuer}`,
      });
    }
    let signatureOk = false;
    try {
      signatureOk = await suite.verify(documentQuads, proof, { resolveKey: options.resolveKey });
    } catch {
      signatureOk = false;
    }
    if (!signatureOk) {
      errors.push({
        code: "INVALID_SIGNATURE",
        message: `signature did not verify for proof (${proof.cryptosuite})`,
      });
    }
  }
  return errors;
}

async function controlledByFailClosed(
  isControlledBy: (vm: string, issuer: string) => boolean | Promise<boolean>,
  verificationMethod: string,
  issuer: string,
): Promise<boolean> {
  try {
    return await isControlledBy(verificationMethod, issuer);
  } catch {
    return false;
  }
}

/**
 * Resolve a parsed credential's Bitstring status and lower the outcome to
 * verification errors. Fail-closed guards beyond solid-vc's own resolver:
 * `credentialStatusFromNode` is a lenient READER that skips malformed entries,
 * so this gate first counts the raw `cred:credentialStatus` links - a present
 * entry that did not read back as well-formed is `STATUS_UNREACHABLE`, never a
 * silent "absent".
 */
async function statusGate(
  dataset: DatasetCore,
  node: CredentialNode,
  issuer: string,
  resolveKey: (verificationMethod: string) => Promise<CryptoKey | undefined>,
  isControlledBy: (vm: string, issuer: string) => boolean | Promise<boolean>,
  options: VerifyCredentialOptions,
): Promise<VcKitVerificationError[]> {
  const check = await resolveGraphStatus(
    dataset,
    node,
    issuer,
    resolveKey,
    isControlledBy,
    options,
  );
  switch (check.status) {
    case "absent":
    case "valid":
      return [];
    case "revoked":
      return [{ code: "STATUS_REVOKED", message: `credential is revoked: ${check.reason}` }];
    case "suspended":
      return [{ code: "STATUS_SUSPENDED", message: `credential is suspended: ${check.reason}` }];
    case "unreachable":
      return [
        {
          code: "STATUS_UNREACHABLE",
          message: `credential status could not be confirmed: ${check.reason}`,
        },
      ];
    default:
      return [
        {
          code: "STATUS_UNREACHABLE",
          message: "status resolver returned an unrecognised outcome - failing closed",
        },
      ];
  }
}

/** The status-resolution core shared by the verify gate and `checkCredentialStatus`. */
async function resolveGraphStatus(
  dataset: DatasetCore,
  node: CredentialNode,
  issuer: string,
  resolveKey: (verificationMethod: string) => Promise<CryptoKey | undefined>,
  isControlledBy: (vm: string, issuer: string) => boolean | Promise<boolean>,
  options: Pick<
    VerifyCredentialOptions,
    "now" | "trustedStatusIssuers" | "statusFetch" | "registry"
  >,
): Promise<CredentialStatusCheck> {
  const credentialTerm = node as unknown as Term;
  const rawLinks = countStatusLinks(dataset, credentialTerm);
  const entries = credentialStatusFromNode(node);
  if (entries.length !== rawLinks) {
    return {
      status: "unreachable",
      reason: `credential carries ${rawLinks} credentialStatus entr${rawLinks === 1 ? "y" : "ies"} but only ${entries.length} are well-formed Bitstring entries - failing closed`,
    };
  }
  if (entries.length === 0) return { status: "absent" };

  const resolver = createBitstringStatusResolver({
    resolveKey,
    isControlledBy,
    now: options.now,
    trustedStatusIssuers: options.trustedStatusIssuers ?? [issuer],
    ...(options.statusFetch !== undefined ? { fetch: options.statusFetch } : {}),
    ...(options.registry !== undefined ? { registry: options.registry } : {}),
  });
  // The resolver reads only `credentialStatus` + `issuer` from the credential;
  // the parsed graph is the authority for both, so a minimal projection is
  // passed rather than a full structured reconstruction.
  const vcLike = {
    issuer,
    credentialSubject: {},
    credentialStatus: entries,
  } as unknown as VerifiableCredential;

  try {
    return await resolver(vcLike);
  } catch (error) {
    return {
      status: "unreachable",
      reason: `credential status could not be resolved: ${(error as Error).message}`,
    };
  }
}

/** Options for {@link checkCredentialStatus}. */
export type CheckCredentialStatusOptions = Pick<
  VerifyCredentialOptions,
  | "now"
  | "resolveKey"
  | "isControlledBy"
  | "webIdFetch"
  | "statusFetch"
  | "trustedStatusIssuers"
  | "registry"
  | "contentType"
>;

/**
 * Resolve a pod-resident credential document's Bitstring status ALONE
 * (deliverable 3's `checkStatus`). Fail-closed exactly like the verify gate:
 * a document that is not a well-formed single credential, a malformed status
 * entry, or an unconfirmable list all come back `unreachable` - never `valid`.
 * NOTE this does NOT verify the credential's own signature; compose with
 * {@link verifyCredential} for the full gate set.
 */
export async function checkCredentialStatus(
  input: string | DatasetCore,
  options: CheckCredentialStatusOptions,
): Promise<CredentialStatusCheck> {
  let dataset: DatasetCore;
  if (typeof input === "string") {
    try {
      dataset = await parseCredentialRdf(input, options.contentType ?? "text/turtle");
    } catch (error) {
      return {
        status: "unreachable",
        reason: `credential document did not parse: ${(error as Error).message}`,
      };
    }
  } else {
    dataset = input;
  }
  const structural = readValidCredential(dataset);
  if (!structural.valid) {
    return { status: "unreachable", reason: structural.error };
  }
  const webIdResolver =
    options.resolveKey === undefined
      ? createWebIdKeyResolver(
          options.webIdFetch !== undefined ? { fetch: options.webIdFetch } : {},
        )
      : undefined;
  const resolveKey = options.resolveKey ?? webIdResolver?.resolveKey;
  const isControlledBy =
    options.isControlledBy ?? webIdResolver?.isControlledBy ?? defaultControlledBy;
  if (resolveKey === undefined) {
    return { status: "unreachable", reason: "no key resolver available" };
  }
  return resolveGraphStatus(
    dataset,
    structural.credential.node,
    structural.credential.issuer,
    resolveKey,
    isControlledBy,
    options,
  );
}

function countStatusLinks(dataset: DatasetCore, credential: Term): number {
  let count = 0;
  for (const quad of dataset.match(credential)) {
    if (quad.predicate.value === VC_CREDENTIAL_STATUS) count += 1;
  }
  return count;
}
