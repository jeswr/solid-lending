/**
 * The vault's grantable-resource catalogue (design §6.2). Every id below is a
 * SINGLE pod resource Maya's grant/revoke engine manages its OWN resource-level
 * WAC ACL for — `@jeswr/solid-seed` already writes each credential's ACL at
 * `${resourceIri}.acl` (owner-only at seed time; see `seeds/layout.ts`), so the
 * engine REBUILDS exactly that same document rather than inventing a container
 * scheme. "Grant a lender read access to specific credentials" (the brief) is
 * therefore literal: one grant/revoke transition touches ONE resource's ACL.
 *
 * Paths for the five seeded credentials + the three lender-authored documents
 * come straight from `@lending/data-model`'s `RESOURCE_POD_PATHS` (the SAME
 * constant the seeder and every future lender app read) — never re-typed here,
 * so the catalogue can never drift from what is actually seeded. The
 * repayment-authorization document is a WALLET-OWNED resource (an ODRL policy
 * this app itself writes, see `./odrl.ts`) with no data-model shape — it is
 * additional pod content the credential/data-model layer does not know about,
 * the same way the ACL documents it sits beside are not "lending resources".
 */
import { RESOURCE_POD_PATHS } from "@lending/data-model";

export const RESOURCE_IDS = [
  "identity",
  "income",
  "bankCashFlow",
  "cashFlowScore",
  "creditScore",
  "loanOffer",
  "disbursementReceipt",
  "repaymentHistory",
  "repaymentAuthorization",
] as const;

export type ResourceId = (typeof RESOURCE_IDS)[number];

export function isResourceId(value: string): value is ResourceId {
  return (RESOURCE_IDS as readonly string[]).includes(value);
}

/** The wallet-authored repayment-authorization document (not a data-model shape). */
export const REPAYMENT_AUTHORIZATION_PATH = "/lending/repayment-authorization";

export interface ResourceDefinition {
  readonly id: ResourceId;
  /** Pod-root-relative path (data-model canon for the eight seeded/lender-written docs). */
  readonly path: string;
  /** Scene-facing label for the grants dashboard + credential list. */
  readonly label: string;
  /** Whether this resource carries a `lend:*`/VC shape (false for the ODRL policy doc). */
  readonly isCredential: boolean;
}

export const RESOURCE_CATALOG: Readonly<Record<ResourceId, ResourceDefinition>> = {
  identity: {
    id: "identity",
    path: RESOURCE_POD_PATHS["identity-credential"],
    label: "Identity credential",
    isCredential: true,
  },
  income: {
    id: "income",
    path: RESOURCE_POD_PATHS["employment-income-credential"],
    label: "Employment + income credential",
    isCredential: true,
  },
  bankCashFlow: {
    id: "bankCashFlow",
    path: RESOURCE_POD_PATHS["bank-cashflow-credential"],
    label: "Bank cash-flow credential",
    isCredential: true,
  },
  cashFlowScore: {
    id: "cashFlowScore",
    path: RESOURCE_POD_PATHS["cashflow-score-credential"],
    label: "Cash-flow score credential",
    isCredential: true,
  },
  creditScore: {
    id: "creditScore",
    path: RESOURCE_POD_PATHS["credit-score-credential"],
    label: "Credit score credential (bureau)",
    isCredential: true,
  },
  loanOffer: {
    id: "loanOffer",
    path: RESOURCE_POD_PATHS["loan-offer-credential"],
    label: "Loan offer / Reg Z disclosure",
    isCredential: true,
  },
  disbursementReceipt: {
    id: "disbursementReceipt",
    path: RESOURCE_POD_PATHS["disbursement-receipt-credential"],
    label: "Disbursement receipt",
    isCredential: true,
  },
  repaymentHistory: {
    id: "repaymentHistory",
    path: RESOURCE_POD_PATHS["repayment-history-credential"],
    label: "Repayment-history credential",
    isCredential: true,
  },
  repaymentAuthorization: {
    id: "repaymentAuthorization",
    path: REPAYMENT_AUTHORIZATION_PATH,
    label: "Repayment authorization (ODRL, 12 CFR 1041 rails)",
    isCredential: false,
  },
};

/** The five VCs scene 1 fills — the vault's primary credential-list view. */
export const SEEDED_CREDENTIAL_IDS: readonly ResourceId[] = [
  "identity",
  "income",
  "bankCashFlow",
  "cashFlowScore",
  "creditScore",
];

export function resourceIri(podBase: string, id: ResourceId): string {
  return `${podBase}${RESOURCE_CATALOG[id].path.slice(1)}`;
}
