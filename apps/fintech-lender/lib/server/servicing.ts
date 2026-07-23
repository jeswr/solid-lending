/**
 * Scene 5 — servicing: an inspectable repayment-authorization view (autopay
 * amount/schedule plus the 12 CFR 1041 payment-provision rails rendered as
 * data, not buried mandate copy) and furnishing the repayment-history
 * credential to the bureau. Both read the ALREADY-DELIVERED loan offer from
 * the pod (the granted read, same service identity, same fail-closed
 * boundary as origination) rather than re-deriving loan terms.
 */
import { LoanOfferCredential, RESOURCE_POD_PATHS, validate } from "@lending/data-model";
import { PodAccessError } from "@jeswr/solid-pod-guard";
import type { IssuedCredential } from "@lending/vc-kit";
import { issueCredential } from "@lending/vc-kit";
import { DataFactory } from "n3";
import type { FintechLenderConfig } from "./config";
import { ensureFintechStatusList, fintechIssuerRuntime } from "./issuer-runtime";
import { assertAllowedPodBase, readPodResource, writePodTurtle } from "./pod-io";

/** 12 CFR 1041 subpart C, quoted exactly — the scene-5 payment-provision anchor. */
export const PAYDAY_PAYMENT_PROVISIONS_RULE =
  "No third payment-withdrawal attempt after two consecutive failures without fresh authorization; advance notice of the first attempt (12 CFR 1041, subpart C).";

/** Reg E §1005.10(e) — credit may never be conditioned on preauthorized EFT repayment. */
export const REG_E_COMPULSORY_USE_RULE =
  "Credit may not be conditioned on repayment by preauthorized electronic fund transfer (Reg E, 12 CFR § 1005.10(e)).";

export interface RepaymentGrantView {
  readonly simulated: true;
  readonly offerIri: string;
  readonly principalUsd: number;
  readonly paymentAmountUsd: number;
  readonly loanTermMonths: number;
  readonly autopayOptional: true;
  readonly rails: {
    readonly paymentProvisions: string;
    readonly compulsoryUse: string;
  };
}

export interface ServicingIo {
  readonly podFetch: typeof fetch;
  /** Injected in tests: hosts this lender's own signed status list. Defaults to {@link podFetch}. */
  readonly statusHostFetch?: typeof fetch;
}

/** `xsd:date` lexical, `YYYY-MM-DD`, from a `Date` (UTC — no locale ambiguity). */
function dateLexical(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function readOffer(
  pod: string,
  config: FintechLenderConfig,
  podFetch: typeof fetch,
): Promise<{ iri: string; offer: LoanOfferCredential }> {
  const base = assertAllowedPodBase(pod, config);
  const iri = `${base}${RESOURCE_POD_PATHS["loan-offer-credential"].slice(1)}`;
  const resource = await readPodResource(iri, base, podFetch);
  if (resource === undefined) {
    throw new PodAccessError(
      404,
      "no loan offer has been delivered into the pod yet — apply first",
    );
  }
  const report = await validate(resource.dataset, {
    expect: "loan-offer-credential",
    focusNode: iri,
  });
  if (!report.conforms) {
    const first = report.violations[0]?.message ?? "unknown violation";
    throw new PodAccessError(
      502,
      `pod loan-offer-credential document violates its shape: ${first}`,
    );
  }
  return {
    iri,
    offer: new LoanOfferCredential(DataFactory.namedNode(iri), resource.dataset, DataFactory),
  };
}

/** Read the delivered offer and render the inspectable repayment grant (no write). */
export async function readRepaymentGrant(
  pod: string,
  config: FintechLenderConfig,
  io: ServicingIo,
): Promise<RepaymentGrantView> {
  const { iri, offer } = await readOffer(pod, config, io.podFetch);
  const terms = offer.credentialSubject.loanOffer;
  return {
    autopayOptional: true,
    loanTermMonths: terms.loanTermMonths,
    offerIri: iri,
    paymentAmountUsd: terms.repaymentSpecification.loanPaymentAmount.amountValue,
    principalUsd: terms.principalAmount.amountValue,
    rails: {
      compulsoryUse: REG_E_COMPULSORY_USE_RULE,
      paymentProvisions: PAYDAY_PAYMENT_PROVISIONS_RULE,
    },
    simulated: true,
  };
}

export interface FurnishHistoryOptions {
  readonly now: Date;
  /** On-time / late counts for the illustrative furnished period (design §5: 18 on-time, 0 late). */
  readonly onTimePaymentCount?: number;
  readonly latePaymentCount?: number;
}

export interface FurnishHistoryReport {
  readonly simulated: true;
  readonly historyIri: string;
  readonly servicedLoanIri: string;
  readonly onTimePaymentCount: number;
  readonly latePaymentCount: number;
  readonly scheduledPaymentCount: number;
  /**
   * The signed Turtle body of the just-written Repayment-History VC. The
   * bureau's `/api/furnish` intake requires `credentialSubject ==` the
   * AUTHENTICATED caller presenting it (never this lender's own service
   * identity) — so the borrower's OWN session furnishes this onward, not
   * this rail. Returned here for exactly that handoff.
   */
  readonly credential: string;
}

/**
 * Build + deliver the repayment-history credential (the graduation beat —
 * the thin file thickens). `pod`/`webid` are DERIVED from the authenticated
 * caller; the servicedLoan link points at the ALREADY-VERIFIED offer this
 * lender itself delivered, never a caller-supplied IRI.
 */
export async function furnishRepaymentHistory(
  pod: string,
  webid: string,
  config: FintechLenderConfig,
  io: ServicingIo,
  options: FurnishHistoryOptions,
): Promise<FurnishHistoryReport> {
  const { iri: offerIri, offer } = await readOffer(pod, config, io.podFetch);
  const scheduledPaymentCount = offer.credentialSubject.loanOffer.loanTermMonths;
  const onTimePaymentCount = options.onTimePaymentCount ?? scheduledPaymentCount;
  const latePaymentCount = options.latePaymentCount ?? 0;

  const base = assertAllowedPodBase(pod, config);
  const historyIri = `${base}${RESOURCE_POD_PATHS["repayment-history-credential"].slice(1)}`;
  const periodStart = offer.validFrom;
  // The furnished period covers the loan's full scheduled term (the demo's
  // "eighteen on-time payments" graduation beat collapses into one click) —
  // MUST be strictly after periodStart, never equal to it (the shape's own
  // arithmetic identity requires a positive period).
  const DAY_MS = 24 * 60 * 60 * 1000;
  const periodEnd = new Date(periodStart.getTime() + scheduledPaymentCount * 30 * DAY_MS);

  const statusHostFetch = io.statusHostFetch ?? io.podFetch;
  const runtime = await fintechIssuerRuntime(config, statusHostFetch);
  await ensureFintechStatusList(runtime, statusHostFetch, options.now);
  const statusIndex = runtime.allocator.allocate(historyIri);

  const issued: IssuedCredential = await issueCredential({
    claims: {
      kind: "repayment-history-credential",
      latePaymentCount,
      onTimePaymentCount,
      periodEnd: dateLexical(periodEnd),
      periodStart: dateLexical(periodStart),
      scheduledPaymentCount,
      servicedLoan: offerIri,
    },
    credentialId: historyIri,
    issuer: runtime.issuerWebId,
    key: runtime.key,
    kind: "repayment-history-credential",
    status: runtime.statusList.entry(statusIndex),
    subject: webid,
    validity: {
      validFrom: options.now,
      validUntil: new Date(options.now.getTime() + 28 * DAY_MS),
    },
  });

  const existing = await readPodResource(historyIri, base, io.podFetch);
  await writePodTurtle(historyIri, issued.body, { existing, podFetch: io.podFetch });

  return {
    credential: issued.body,
    historyIri,
    latePaymentCount,
    onTimePaymentCount,
    scheduledPaymentCount,
    servicedLoanIri: offerIri,
    simulated: true,
  };
}
