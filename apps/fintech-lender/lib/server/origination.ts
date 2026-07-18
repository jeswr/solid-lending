/**
 * Scene-3 origination: read the granted loan file, run the two-model
 * decision, and — on approval — deliver the closed-end (Reg Z) disclosure
 * into the borrower's pod at `/lending/offer`. That same document IS the
 * scene-4 funding instruction the disbursement app reads (principal amount +
 * subject WebID) — no separate resource shape exists for it (design §6.2:
 * "Loan Offer / Reg Z Disclosure").
 *
 * TILA framing: APR, finance charge, amount financed, and payment schedule
 * are delivered together, before the loan is consummated (Reg Z §§1026.17-18).
 */
import {
  buildLoanOfferCredential,
  RESOURCE_POD_PATHS,
  resourceToTurtle,
} from "@lending/data-model";
import type { FintechLenderConfig } from "./config";
import { readGrantedLoanFile, type VerifySeams } from "./loan-file";
import { readPodResource, writePodTurtle } from "./pod-io";
import { runTwoModelDecision, type TwoModelDecision } from "./underwriting";

export const REG_Z_DISCLOSURE_TIMING =
  "APR, finance charge, amount financed, and payment schedule delivered before the loan is consummated (Reg Z §§1026.17-18)";

export interface OriginationOptions {
  /** The service identity's authenticated pod fetch (never anonymous). */
  readonly podFetch: typeof fetch;
  readonly serviceWebId: string;
  readonly now?: () => Date;
  readonly seams?: VerifySeams;
}

export interface OriginationReport {
  readonly simulated: true;
  readonly decision: TwoModelDecision;
  readonly offerIri?: string;
  readonly regZTiming: string;
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
  config: FintechLenderConfig,
  options: OriginationOptions,
): Promise<OriginationReport> {
  const now = (options.now ?? (() => new Date()))();
  const loanFile = await readGrantedLoanFile(pod, webid, config, {
    now,
    podFetch: options.podFetch,
    ...(options.seams !== undefined ? { seams: options.seams } : {}),
  });

  const decision = runTwoModelDecision(loanFile.file);

  if (decision.outcome !== "approve" || decision.cashFlowPlus?.offer === undefined) {
    return {
      decision,
      evaluatedAt: now.toISOString(),
      regZTiming: REG_Z_DISCLOSURE_TIMING,
      simulated: true,
    };
  }

  const offer = decision.cashFlowPlus.offer;
  const base = pod.endsWith("/") ? pod : `${pod}/`;
  const offerIri = `${base}${RESOURCE_POD_PATHS["loan-offer-credential"].slice(1)}`;
  const statusListIri = `${new URL(config.fintechLenderWebId).origin}/status/offers`;

  const built = buildLoanOfferCredential({
    aprPercent: offer.aprPercent,
    credentialStatus: `${statusListIri}#${webid.length}-${now.getTime() % 100000}`,
    credentialSubject: webid,
    financeChargeUsd: offer.financeChargeUsd,
    iri: offerIri,
    issuer: config.fintechLenderWebId,
    loanTermMonths: offer.loanTermMonths,
    numberOfPayments: offer.loanTermMonths,
    paymentAmountUsd: offer.paymentAmountUsd,
    paymentsPerYear: 12,
    principalUsd: offer.principalUsd,
    totalOfPaymentsUsd: offer.totalOfPaymentsUsd,
    validFrom: now,
    // The acceptance window: consistent with the persona's 14-day offer window (design §5).
    validUntil: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
  });
  const turtle = await resourceToTurtle(built);

  const existing = await readPodResource(offerIri, base, options.podFetch);
  await writePodTurtle(offerIri, turtle, { existing, podFetch: options.podFetch });

  return {
    decision,
    evaluatedAt: now.toISOString(),
    offerIri,
    regZTiming: REG_Z_DISCLOSURE_TIMING,
    simulated: true,
  };
}
