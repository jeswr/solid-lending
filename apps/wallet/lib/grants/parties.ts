/**
 * The vault's grantable parties (design §6.1/§6.2) and, per party, exactly
 * which resources (`./resources.ts`) it may be granted and in which mode.
 * Party WebIDs are OPERATOR-PINNED env config — never request-supplied
 * (decision-0015-style rail, carried over from the mortgage showcase's wallet).
 *
 * Scene mapping:
 *  - `bank-lender` (Fifth Third-modelled): bureau-only contrast decision —
 *    identity + income + the bureau credit-score credential. Never the
 *    cash-flow credentials — it deliberately never sees them (design §6
 *    scene-3 "two models" beat).
 *  - `fintech-lender` (Oportun-modelled): the winning cash-flow-underwriting
 *    lender — every credential for prefill, write access to write its Reg Z
 *    loan-offer and repayment-history documents back into the pod, plus the
 *    repayment-authorization ODRL policy (scene 5, 12 CFR 1041 rails).
 *  - `disbursement` (Mastercard Send-modelled): identity for the payout
 *    target, write access for its receipt document (scene 4).
 */
import type { ResourceId } from "./resources";

export const GRANT_PARTY_IDS = ["bank-lender", "fintech-lender", "disbursement"] as const;

export type GrantPartyId = (typeof GRANT_PARTY_IDS)[number];

export function isGrantPartyId(value: string): value is GrantPartyId {
  return (GRANT_PARTY_IDS as readonly string[]).includes(value);
}

export interface PartyResourceGrant {
  readonly resource: ResourceId;
  readonly write: boolean;
}

export interface GrantPartyDefinition {
  readonly id: GrantPartyId;
  /** Role-first display label (never "by {Org}") — mirrors the tour registry copy. */
  readonly label: string;
  /** The env var naming this party's service WebID (operator-pinned). */
  readonly envVar: string;
  /** The resources this party may be granted, in the mode it needs. */
  readonly resources: readonly PartyResourceGrant[];
}

export const GRANT_PARTIES: Readonly<Record<GrantPartyId, GrantPartyDefinition>> = {
  "bank-lender": {
    id: "bank-lender",
    label: "Bank installment lender — modelled on Fifth Third Bank",
    envVar: "LENDING_BANK_LENDER_SERVICE_WEBID",
    resources: [
      { resource: "identity", write: false },
      { resource: "income", write: false },
      { resource: "creditScore", write: false },
    ],
  },
  "fintech-lender": {
    id: "fintech-lender",
    label: "Cash-flow-underwriting lender — modelled on Oportun",
    envVar: "LENDING_FINTECH_LENDER_SERVICE_WEBID",
    resources: [
      { resource: "identity", write: false },
      { resource: "income", write: false },
      { resource: "bankCashFlow", write: false },
      { resource: "cashFlowScore", write: false },
      { resource: "creditScore", write: false },
      { resource: "loanOffer", write: true },
      { resource: "repaymentHistory", write: true },
      { resource: "repaymentAuthorization", write: false },
    ],
  },
  disbursement: {
    id: "disbursement",
    label: "Instant disbursement rail — modelled on Mastercard (Send)",
    envVar: "LENDING_DISBURSEMENT_SERVICE_WEBID",
    resources: [
      { resource: "identity", write: false },
      { resource: "disbursementReceipt", write: true },
    ],
  },
};

/** Whether `party` may ever be granted `resource` (the catalogue is closed — a
 * grant for an off-catalogue pair is refused before any pod IO). */
export function partyResourceModes(
  party: GrantPartyId,
  resource: ResourceId,
): PartyResourceGrant | undefined {
  return GRANT_PARTIES[party].resources.find((entry) => entry.resource === resource);
}
