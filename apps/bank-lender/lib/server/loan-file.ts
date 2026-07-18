/**
 * Read + verify the GRANTED credit-score credential from the borrower's pod
 * (scene 3). This is the ONLY credential the Personal Loan Desk ever reads —
 * deliberately bureau-only, never income, bank cash-flow, or cash-flow-score
 * (design's inclusion-thesis contrast; that evidence is the fintech-lender
 * sibling's product).
 *
 * Access model (decision 0015 L4): the read runs over THIS APP's OWN service
 * identity fetch — the agent the borrower's grant names. The POD enforces
 * WAC against that identity; there is no anonymous fallback, so a missing or
 * revoked grant fails the run closed (`PodAccessError`) instead of silently
 * depending on an open pod.
 *
 * Trust model: pod RDF is untrusted input even under a grant. The document is
 * SHACL-validated before a value is read (typed wrappers only — house RDF
 * discipline), and the credential must ADDITIONALLY pass vc-kit's fail-closed
 * `verifyCredential` (signature + trusted issuer + validity window + Bitstring
 * status + shape) and attest the AUTHENTICATED borrower (subject binding).
 * The verification verdict is carried into the underwriting rule as an
 * explicit evidence input — an unverifiable, tampered, or unbound credential
 * downgrades the run to "refer", never crashes it and never silently
 * declines or approves.
 */
import { CreditScoreCredential, RESOURCE_POD_PATHS, validate } from "@lending/data-model";
import { isFresh, type VerifyCredentialOptions, verifyCredential } from "@lending/vc-kit";
import { PodAccessError } from "@jeswr/solid-pod-guard";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";
import type { BankLenderConfig } from "./config";
import { assertAllowedPodBase, readPodResource } from "./pod-io";
import type { BureauLoanFile, EvidenceEntry } from "./underwriting";

/** Verification seams `verifyCredential` consumes — injected in tests with in-process issuer fixtures. */
export type VerifySeams = Pick<
  VerifyCredentialOptions,
  "resolveKey" | "isControlledBy" | "webIdFetch" | "statusFetch" | "trustedStatusIssuers"
>;

export interface LoanFileOptions {
  /** The service identity's authenticated pod fetch (never anonymous). */
  readonly podFetch: typeof fetch;
  /** The evaluation instant (explicit — freshness is never wall-clock-implicit). */
  readonly now: Date;
  readonly seams?: VerifySeams;
}

export interface GrantedBureauFile {
  readonly file: BureauLoanFile;
  /** The credit-score credential's pod IRI (the notice's `schema:object` reference). */
  readonly creditScoreIri: string;
  /** The credit-score credential's issuer (the bureau — the notice's `schema:provider` FCRA reference). */
  readonly creditScoreIssuerWebId: string;
}

/**
 * Read the granted credit-score credential. `pod` and `webid` are DERIVED
 * from the authenticated caller by the route boundary — never from request
 * parameters. `podFetch` is the SERVICE identity's own pod fetch; a
 * non-granted or revoked reader gets denied by the pod itself (401/403),
 * which `readPodResource` surfaces as a thrown fetch error the route
 * boundary lowers to a response, never a silent empty read.
 */
export async function readGrantedBureauFile(
  pod: string,
  webid: string,
  config: BankLenderConfig,
  options: LoanFileOptions,
): Promise<GrantedBureauFile> {
  if (config.trustedCredentialIssuers.length === 0) {
    throw new PodAccessError(
      503,
      "LENDING_TRUSTED_CREDENTIAL_ISSUERS is unset — the origination rail fails closed",
    );
  }
  const base = assertAllowedPodBase(pod, config);

  const iri = `${base}${RESOURCE_POD_PATHS["credit-score-credential"].slice(1)}`;
  const resource = await readPodResource(iri, base, options.podFetch);
  if (resource === undefined) {
    throw new PodAccessError(404, "the granted loan file has no credit-score-credential document");
  }
  const dataset: DatasetCore = resource.dataset;

  // Structural gate first: a document that does not even satisfy its shape is
  // hostile input, not scoreable evidence.
  const report = await validate(dataset, { expect: "credit-score-credential", focusNode: iri });
  if (!report.conforms) {
    const first = report.violations[0]?.message ?? "unknown violation";
    throw new PodAccessError(
      502,
      `pod credit-score-credential document violates its shape: ${first}`,
    );
  }

  const seams: VerifySeams =
    options.seams ??
    (config.allowInsecureLoopback
      ? { statusFetch: fetch.bind(globalThis), webIdFetch: fetch.bind(globalThis) }
      : {});

  // The authoritative gate: signature + trusted issuer + window + status + shape.
  const verification = await verifyCredential(dataset, {
    expectShape: "credit-score-credential",
    now: options.now,
    trustedIssuers: config.trustedCredentialIssuers,
    ...seams,
  });
  const subjectBound =
    verification.credential?.subject !== undefined && verification.credential.subject === webid;
  const window = {
    validFrom: verification.credential?.validFrom,
    validUntil: verification.credential?.validUntil,
  };
  const evidence: EvidenceEntry = {
    fresh: isFresh(window, options.now),
    kind: "credit-score",
    subjectBound,
    verified: verification.verified,
    verifyErrors: [
      ...verification.errors.map((error) => error.code),
      ...(subjectBound ? [] : ["SUBJECT_MISMATCH"]),
    ],
  };

  let file: BureauLoanFile;
  let creditScoreIssuerWebId: string;
  try {
    const wrapper = new CreditScoreCredential(DataFactory.namedNode(iri), dataset, DataFactory);
    creditScoreIssuerWebId = wrapper.issuer;
    file = {
      creditHistoryMonths: wrapper.credentialSubject.creditHistoryMonths,
      creditScoreValue: wrapper.credentialSubject.creditScoreValue,
      evidence: [evidence],
      tradelineCount: wrapper.credentialSubject.tradelineCount,
    };
  } catch (error) {
    if (error instanceof PodAccessError) throw error;
    throw new PodAccessError(
      502,
      `the granted credit-score credential could not be read through its typed wrapper: ${(error as Error).message}`,
    );
  }

  return { creditScoreIri: iri, creditScoreIssuerWebId, file };
}
