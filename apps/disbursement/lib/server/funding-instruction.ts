/**
 * Read + verify the borrower's GRANTED loan-offer document as the scene-4
 * funding instruction (design §6.2 row 6/7, per the fintech-lender's own
 * origination module header: "That same document IS the scene-4 funding
 * instruction the disbursement app reads — principal amount + subject
 * WebID"). This module projects ONLY those two fields (plus the offer's own
 * IRI/issuer) off the verified document — never the APR, finance charge, or
 * payment schedule — matching the walkthrough's own framing (scene 4, step
 * "Authorize the payout"): "The rail sees the payment instruction — not her
 * application, her credentials, or her history."
 *
 * Access model (decision 0015 L4): the read runs over THIS APP's OWN service
 * identity fetch — the agent the borrower's grant names. The pod enforces
 * WAC against that identity; there is no anonymous fallback, so a missing or
 * revoked grant fails the run closed (`PodAccessError`) instead of silently
 * depending on an open pod.
 *
 * Trust model: pod RDF is untrusted input even under a grant. The document is
 * SHACL-validated before any value is read (typed wrappers only — house RDF
 * discipline), and it must ADDITIONALLY pass vc-kit's fail-closed
 * `verifyCredential` (signature + trusted issuer + validity window +
 * Bitstring status + shape) and attest the AUTHENTICATED borrower (subject
 * binding) — an unverifiable, tampered, unbound, expired, or MISSING offer
 * refuses the payout outright (no dual "refer" state: disbursement either
 * pays or it doesn't).
 */
import { LoanOfferCredential, RESOURCE_POD_PATHS, validate } from "@lending/data-model";
import { type VerifyCredentialOptions, verifyCredential } from "@lending/vc-kit";
import { PodAccessError } from "@jeswr/solid-pod-guard";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";
import type { DisbursementConfig } from "./config";
import { assertAllowedPodBase, readPodResource } from "./pod-io";

/** Verification seams `verifyCredential` consumes — injected in tests with in-process issuer fixtures. */
export type VerifySeams = Pick<
  VerifyCredentialOptions,
  "resolveKey" | "isControlledBy" | "webIdFetch" | "statusFetch" | "trustedStatusIssuers"
>;

export interface FundingInstructionOptions {
  /** The service identity's authenticated pod fetch (never anonymous). */
  readonly podFetch: typeof fetch;
  /** The evaluation instant (explicit — freshness is never wall-clock-implicit). */
  readonly now: Date;
  readonly seams?: VerifySeams;
}

/** The MINIMAL projection this rail ever reads off the loan offer — the payment instruction, not the application. */
export interface FundingInstruction {
  readonly offerIri: string;
  readonly issuer: string;
  readonly principalUsd: number;
}

async function assertShape(dataset: DatasetCore, iri: string): Promise<void> {
  const report = await validate(dataset, { expect: "loan-offer-credential", focusNode: iri });
  if (!report.conforms) {
    const first = report.violations[0]?.message ?? "unknown violation";
    throw new PodAccessError(502, `pod loan-offer document violates its shape: ${first}`);
  }
}

/**
 * Read + verify the borrower's granted loan offer, deriving the funding
 * instruction. `pod` and `webid` are DERIVED from the authenticated caller by
 * the route boundary — never from request parameters. Throws `PodAccessError`
 * (fail-closed) for every refusal reason:
 *  - 503 the offer-issuer trust list is unconfigured;
 *  - 404 no loan-offer document exists in the granted pod (a non-granted or
 *    revoked reader is denied by the pod itself and surfaces as a thrown
 *    fetch error the route boundary lowers to 401/403, never a silent "no
 *    offer");
 *  - 502 the document does not conform to the loan-offer shape;
 *  - 422 the document fails vc-kit's fail-closed `verifyCredential` gate
 *    (signature, trusted issuer, status);
 *  - 403 the offer does not attest the authenticated borrower;
 *  - 410 the offer's acceptance window has lapsed.
 */
export async function readVerifiedFundingInstruction(
  pod: string,
  webid: string,
  config: DisbursementConfig,
  options: FundingInstructionOptions,
): Promise<FundingInstruction> {
  if (config.trustedOfferIssuers.length === 0) {
    throw new PodAccessError(
      503,
      "LENDING_DISBURSEMENT_TRUSTED_OFFER_ISSUERS is unset — the payout rail fails closed",
    );
  }
  const base = assertAllowedPodBase(pod, config);
  const iri = `${base}${RESOURCE_POD_PATHS["loan-offer-credential"].slice(1)}`;

  const resource = await readPodResource(iri, base, options.podFetch);
  if (resource === undefined) {
    throw new PodAccessError(
      404,
      "no approved loan offer was found in the borrower's pod — payout refused",
    );
  }
  await assertShape(resource.dataset, iri);

  const seams: VerifySeams =
    options.seams ??
    (config.allowInsecureLoopback
      ? { statusFetch: fetch.bind(globalThis), webIdFetch: fetch.bind(globalThis) }
      : {});

  const verification = await verifyCredential(resource.dataset, {
    expectShape: "loan-offer-credential",
    now: options.now,
    trustedIssuers: config.trustedOfferIssuers,
    ...seams,
  });
  if (!verification.verified || verification.credential === undefined) {
    // vc-kit's OWN "window" gate already treats an expired/not-yet-valid
    // offer as a verification failure (codes `EXPIRED`/`NOT_YET_VALID`) — a
    // distinct, more specific refusal (410 Gone: the acceptance window
    // lapsed) than every other unverifiable-document case (422).
    const codes = verification.errors.map((error) => error.code);
    if (codes.some((code) => code === "EXPIRED" || code === "NOT_YET_VALID")) {
      throw new PodAccessError(
        410,
        "the loan offer's acceptance window has lapsed — payout refused",
      );
    }
    throw new PodAccessError(
      422,
      `the loan offer failed verification (${codes.join(", ") || "unknown"}) — payout refused`,
    );
  }
  if (verification.credential.subject !== webid) {
    throw new PodAccessError(
      403,
      "the loan offer does not attest the authenticated borrower — payout refused",
    );
  }

  const offer = new LoanOfferCredential(DataFactory.namedNode(iri), resource.dataset, DataFactory);
  return {
    issuer: offer.issuer,
    offerIri: iri,
    principalUsd: offer.credentialSubject.loanOffer.principalAmount.amountValue,
  };
}
