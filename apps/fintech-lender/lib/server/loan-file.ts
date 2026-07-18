/**
 * Read + verify the GRANTED loan file from the borrower's pod (scene 3).
 *
 * Access model (decision 0015 L4): every read runs over THIS APP's OWN
 * service identity fetch — the agent the borrower's grant names. The POD
 * enforces WAC against that identity; there is no anonymous fallback, so a
 * missing or revoked grant fails the run closed (`PodAccessError`) instead of
 * silently depending on an open pod.
 *
 * Trust model: pod RDF is untrusted input even under a grant. Every document
 * is SHACL-validated before a value is read (typed wrappers only — house RDF
 * discipline), and every credential must ADDITIONALLY pass vc-kit's
 * fail-closed `verifyCredential` (signature + trusted issuer + validity
 * window + Bitstring status + shape) and attest the AUTHENTICATED borrower
 * (subject binding). Verification verdicts are carried into the
 * underwriting rules as explicit evidence inputs — an unverifiable,
 * tampered, or unbound credential downgrades the run to "refer", never
 * crashes it and never silently approves.
 */
import {
  BankCashFlowCredential,
  CreditScoreCredential,
  CashFlowScoreCredential,
  EmploymentIncomeCredential,
  IdentityCredential,
  type PersonaResourceKind,
  RESOURCE_POD_PATHS,
  validate,
} from "@lending/data-model";
import { isFresh, type VerifyCredentialOptions, verifyCredential } from "@lending/vc-kit";
import { PodAccessError } from "@jeswr/solid-pod-guard";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";
import type { FintechLenderConfig } from "./config";
import { assertAllowedPodBase, readPodResource } from "./pod-io";
import type { CashFlowLoanFile, EvidenceEntry, EvidenceKind } from "./underwriting";

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

const EVIDENCE_SHAPE: Readonly<Record<EvidenceKind, PersonaResourceKind>> = {
  "bank-cash-flow": "bank-cashflow-credential",
  "cash-flow-score": "cashflow-score-credential",
  "credit-score": "credit-score-credential",
  identity: "identity-credential",
  income: "employment-income-credential",
};

async function readRequired(
  base: string,
  kind: PersonaResourceKind,
  podFetch: typeof fetch,
): Promise<{ dataset: DatasetCore; iri: string }> {
  const iri = `${base}${RESOURCE_POD_PATHS[kind].slice(1)}`;
  const resource = await readPodResource(iri, base, podFetch);
  if (resource === undefined) {
    throw new PodAccessError(404, `the granted loan file has no ${kind} document`);
  }
  return { dataset: resource.dataset, iri };
}

async function assertShape(
  dataset: DatasetCore,
  kind: PersonaResourceKind,
  focusNode: string,
): Promise<void> {
  const report = await validate(dataset, { expect: kind, focusNode });
  if (!report.conforms) {
    const first = report.violations[0]?.message ?? "unknown violation";
    throw new PodAccessError(502, `pod ${kind} document violates its shape: ${first}`);
  }
}

interface VerifiedDocument {
  readonly dataset: DatasetCore;
  readonly iri: string;
  readonly evidence: EvidenceEntry;
}

async function readCredential(
  base: string,
  kind: EvidenceKind,
  webid: string,
  config: FintechLenderConfig,
  options: LoanFileOptions,
): Promise<VerifiedDocument> {
  const shape = EVIDENCE_SHAPE[kind];
  const { dataset, iri } = await readRequired(base, shape, options.podFetch);
  // Structural gate first: a document that does not even satisfy its shape is
  // hostile input, not scoreable evidence.
  await assertShape(dataset, shape, iri);

  const seams: VerifySeams =
    options.seams ??
    (config.allowInsecureLoopback
      ? { statusFetch: fetch.bind(globalThis), webIdFetch: fetch.bind(globalThis) }
      : {});

  // The authoritative gate: signature + trusted issuer + window + status + shape.
  const verification = await verifyCredential(dataset, {
    expectShape: shape,
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
  return {
    dataset,
    evidence: {
      fresh: isFresh(window, options.now),
      kind,
      subjectBound,
      verified: verification.verified,
      verifyErrors: [
        ...verification.errors.map((error) => error.code),
        ...(subjectBound ? [] : ["SUBJECT_MISMATCH"]),
      ],
    },
    iri,
  };
}

export interface GrantedLoanFile {
  readonly file: CashFlowLoanFile;
  readonly documentIris: Readonly<Record<EvidenceKind, string>>;
}

/**
 * Read the granted loan file. `pod` and `webid` are DERIVED from the
 * authenticated caller by the route boundary — never from request
 * parameters. `podFetch` is the SERVICE identity's own pod fetch; a
 * non-granted or revoked reader gets denied by the pod itself (401/403),
 * which `readPodResource` surfaces as a thrown fetch error the route
 * boundary lowers to a response, never a silent empty read.
 */
export async function readGrantedLoanFile(
  pod: string,
  webid: string,
  config: FintechLenderConfig,
  options: LoanFileOptions,
): Promise<GrantedLoanFile> {
  if (config.trustedCredentialIssuers.length === 0) {
    throw new PodAccessError(
      503,
      "LENDING_TRUSTED_CREDENTIAL_ISSUERS is unset — the origination rail fails closed",
    );
  }
  const base = assertAllowedPodBase(pod, config);

  const [identity, income, cashFlow, cashFlowScore, creditScore] = await Promise.all([
    readCredential(base, "identity", webid, config, options),
    readCredential(base, "income", webid, config, options),
    readCredential(base, "bank-cash-flow", webid, config, options),
    readCredential(base, "cash-flow-score", webid, config, options),
    readCredential(base, "credit-score", webid, config, options),
  ]);

  let file: CashFlowLoanFile;
  try {
    const incomeSubject = new EmploymentIncomeCredential(
      DataFactory.namedNode(income.iri),
      income.dataset,
      DataFactory,
    ).credentialSubject;
    const cashFlowSubject = new BankCashFlowCredential(
      DataFactory.namedNode(cashFlow.iri),
      cashFlow.dataset,
      DataFactory,
    ).credentialSubject;
    const cashFlowScoreSubject = new CashFlowScoreCredential(
      DataFactory.namedNode(cashFlowScore.iri),
      cashFlowScore.dataset,
      DataFactory,
    ).credentialSubject;
    const creditScoreSubject = new CreditScoreCredential(
      DataFactory.namedNode(creditScore.iri),
      creditScore.dataset,
      DataFactory,
    ).credentialSubject;
    // Identity is read (and evidence-gated) but this app's rules do not
    // consume a field from it directly — its presence + verification is
    // itself the KYC/CIP evidence gate.
    void new IdentityCredential(DataFactory.namedNode(identity.iri), identity.dataset, DataFactory)
      .credentialSubject;

    file = {
      cashFlowScoreValue: cashFlowScoreSubject.cashFlowScoreValue,
      creditHistoryMonths: creditScoreSubject.creditHistoryMonths,
      creditScoreValue: creditScoreSubject.creditScoreValue,
      evidence: [
        identity.evidence,
        income.evidence,
        cashFlow.evidence,
        cashFlowScore.evidence,
        creditScore.evidence,
      ],
      netMonthlyIncomeUsd: incomeSubject.netMonthlyIncomeUsd,
      nsf90Count: cashFlowSubject.nsf90Count,
      tradelineCount: creditScoreSubject.tradelineCount,
    };
  } catch (error) {
    if (error instanceof PodAccessError) throw error;
    throw new PodAccessError(
      502,
      `the granted loan file could not be read through its typed wrappers: ${(error as Error).message}`,
    );
  }

  return {
    documentIris: {
      "bank-cash-flow": cashFlow.iri,
      "cash-flow-score": cashFlowScore.iri,
      "credit-score": creditScore.iri,
      identity: identity.iri,
      income: income.iri,
    },
    file,
  };
}
