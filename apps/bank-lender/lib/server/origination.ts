/**
 * Scene-3 origination: read the granted credit-score credential, run the
 * BUREAU-ONLY decision, and deliver the outcome into the borrower's pod —
 * a Reg B adverse-action notice on decline (design's signature contrast
 * beat), or a closed-end (Reg Z) loan-offer credential on approve, at a
 * pod path distinct from the fintech-lender sibling's own `/lending/offer`
 * (two independent lenders' offers must never collide in the same pod).
 *
 * On "refer" (the evidence gate failed) NOTHING is written — an
 * unverifiable credit-score credential is never underwritten, on either
 * outcome.
 */
import { buildLoanOfferCredential, resourceToTurtle } from "@lending/data-model";
import {
  adverseActionNoticeToTurtle,
  buildAdverseActionNotice,
  REG_B_ADVERSE_ACTION_TIMING,
} from "./adverse-action";
import type { BankLenderConfig } from "./config";
import { readGrantedBureauFile, type VerifySeams } from "./loan-file";
import { readPodResource, writePodTurtle } from "./pod-io";
import { runBureauOnlyDecision, type BureauDecision } from "./underwriting";

/** This lender's own offer path — distinct from the fintech-lender sibling's `/lending/offer` (design §6.2). */
export const BANK_OFFER_POD_PATH = "/lending/bank-offer";
/** The Reg B adverse-action notice's pod path. */
export const ADVERSE_ACTION_POD_PATH = "/lending/adverse-action";

export interface OriginationOptions {
  /** The service identity's authenticated pod fetch (never anonymous). */
  readonly podFetch: typeof fetch;
  readonly serviceWebId: string;
  readonly now?: () => Date;
  readonly seams?: VerifySeams;
}

export interface OriginationReport {
  readonly simulated: true;
  readonly decision: BureauDecision;
  readonly adverseActionIri?: string;
  readonly offerIri?: string;
  readonly regBTiming: string;
  readonly evaluatedAt: string;
}

/**
 * Run the origination over the GRANTED pod data. `pod` and `webid` are
 * DERIVED from the authenticated caller by the route boundary — never from
 * request parameters.
 */
export async function runOrigination(
  pod: string,
  webid: string,
  config: BankLenderConfig,
  options: OriginationOptions,
): Promise<OriginationReport> {
  const now = (options.now ?? (() => new Date()))();
  const loanFile = await readGrantedBureauFile(pod, webid, config, {
    now,
    podFetch: options.podFetch,
    ...(options.seams !== undefined ? { seams: options.seams } : {}),
  });

  const decision = runBureauOnlyDecision(loanFile.file);
  const base = pod.endsWith("/") ? pod : `${pod}/`;

  if (decision.outcome === "decline") {
    const adverseActionIri = `${base}${ADVERSE_ACTION_POD_PATH.slice(1)}`;
    const notice = buildAdverseActionNotice({
      borrowerWebId: webid,
      decidedAt: now,
      iri: adverseActionIri,
      issuerWebId: config.bankLenderWebId,
      principalReasons: decision.adverseActionReasons,
      reliedOnCredentialIri: loanFile.creditScoreIri,
      reportProviderWebId: loanFile.creditScoreIssuerWebId,
    });
    const turtle = await adverseActionNoticeToTurtle(notice);
    const existing = await readPodResource(adverseActionIri, base, options.podFetch);
    await writePodTurtle(adverseActionIri, turtle, { existing, podFetch: options.podFetch });

    return {
      adverseActionIri,
      decision,
      evaluatedAt: now.toISOString(),
      regBTiming: REG_B_ADVERSE_ACTION_TIMING,
      simulated: true,
    };
  }

  if (decision.outcome === "approve" && decision.offer !== undefined) {
    const offer = decision.offer;
    const offerIri = `${base}${BANK_OFFER_POD_PATH.slice(1)}`;
    const statusListIri = `${new URL(config.bankLenderWebId).origin}/status/offers`;

    const built = buildLoanOfferCredential({
      aprPercent: offer.aprPercent,
      credentialStatus: `${statusListIri}#${webid.length}-${now.getTime() % 100000}`,
      credentialSubject: webid,
      financeChargeUsd: offer.financeChargeUsd,
      iri: offerIri,
      issuer: config.bankLenderWebId,
      loanTermMonths: offer.loanTermMonths,
      numberOfPayments: offer.loanTermMonths,
      paymentAmountUsd: offer.paymentAmountUsd,
      paymentsPerYear: 12,
      principalUsd: offer.principalUsd,
      totalOfPaymentsUsd: offer.totalOfPaymentsUsd,
      validFrom: now,
      validUntil: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
    });
    const turtle = await resourceToTurtle(built);
    const existing = await readPodResource(offerIri, base, options.podFetch);
    await writePodTurtle(offerIri, turtle, { existing, podFetch: options.podFetch });

    return {
      decision,
      evaluatedAt: now.toISOString(),
      offerIri,
      regBTiming: REG_B_ADVERSE_ACTION_TIMING,
      simulated: true,
    };
  }

  // "refer": the evidence gate failed — nothing is written.
  return {
    decision,
    evaluatedAt: now.toISOString(),
    regBTiming: REG_B_ADVERSE_ACTION_TIMING,
    simulated: true,
  };
}
