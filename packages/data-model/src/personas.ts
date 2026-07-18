import type { DatasetCore } from "@rdfjs/types";
import type { LendingResourceKind } from "./shacl.ts";
import { LEND } from "./vocab/lend.ts";
import {
  buildBankCashFlowCredential,
  buildCashFlowScoreCredential,
  buildCreditScoreCredential,
  buildDisbursementReceiptCredential,
  buildEmploymentIncomeCredential,
  buildIdentityCredential,
  buildLoanOfferCredential,
  buildRepaymentHistoryCredential,
  type CredentialEnvelopeInit,
  type DepositStreamInit,
  type PostalAddressInit,
} from "./wrappers/build.ts";
import type { LendingResource } from "./wrappers/resources.ts";
import { resourceToTurtle } from "./wrappers/serialize.ts";

/**
 * The demo persona fixture — Maya Torres, the walkthrough's single played
 * borrower (design §5; fictional, all data simulated, no real PII). KEEP IN
 * SYNC with `walkthrough.persona` in apps/tour/content/walkthrough.json and
 * seeds/persona.ts — the persona-card footnote states the pinning.
 *
 * ZK threshold pinning: the persona's values are pinned ABOVE the scene-2
 * proof thresholds (income >= $2,200/mo, cash-flow score >= 660, NSF90 = 0)
 * — test-enforced against {@link ZK_PREQUAL_THRESHOLDS}.
 *
 * Determinism: `personas()` never reads the clock — all validity windows
 * derive from the caller's `now` — and the same `now` + `seed` produce
 * byte-identical Turtle.
 */

export type PersonaId = "maya-torres";

/** Resource kinds present in a deterministic persona seed (receipts and anchors are minted by the vc-kit seed tooling, which owns signatures and operand_enc). */
export type PersonaResourceKind = Exclude<
  LendingResourceKind,
  "consent-receipt" | "zk-operand-anchor"
>;

/**
 * Pod-root-relative resource paths: credentials under the access-controlled
 * `/lending/credentials/` subtree; origination documents beside it.
 */
export const RESOURCE_POD_PATHS: Readonly<Record<PersonaResourceKind, string>> = {
  "identity-credential": "/lending/credentials/identity",
  "employment-income-credential": "/lending/credentials/income",
  "bank-cashflow-credential": "/lending/credentials/bank-cash-flow",
  "cashflow-score-credential": "/lending/credentials/cash-flow-score",
  "credit-score-credential": "/lending/credentials/credit-score",
  "loan-offer-credential": "/lending/offer",
  "disbursement-receipt-credential": "/lending/disbursement",
  "repayment-history-credential": "/lending/repayment-history",
};

/** The scene-2 ZK pre-qualification thresholds (design §5, pinned). */
export const ZK_PREQUAL_THRESHOLDS = {
  /** lend:netMonthlyIncomeUsd >= this (whole USD/month). */
  netMonthlyIncomeUsd: 2200,
  /** lend:cashFlowScoreValue >= this (score points). */
  cashFlowScoreValue: 660,
  /** lend:nsf90Count == this (events). */
  nsf90Count: 0,
} as const;

/** Issuer identity IRIs, overridable when seeding against deployed org pods. */
export interface PersonaIssuers {
  /** IDV seat (scene 1 identity VC). */
  identityVerifier: string;
  /** Income-verification seat (scene 1 employment+income VC). */
  incomeVerifier: string;
  /** Bank-data-provider seat (scene 1 cash-flow VC). */
  bankDataProvider: string;
  /** Cash-flow scorer seat (scene 1 score VC). */
  cashFlowScorer: string;
  /** Bureau seat (scene 1/3 traditional score VC). */
  creditBureau: string;
  /** Cash-flow-underwriting lender (scenes 3-5: offer, servicing, history). */
  fintechLender: string;
  /** Disbursement seat (scene 4 receipt). */
  disbursementNetwork: string;
}

const DEFAULT_ISSUERS: PersonaIssuers = {
  identityVerifier: "https://verifications.example/orgs/identity-verifier#id",
  incomeVerifier: "https://verifications.example/orgs/income-verifier#id",
  bankDataProvider: "https://verifications.example/orgs/bank-data-provider#id",
  cashFlowScorer: "https://verifications.example/orgs/cash-flow-scorer#id",
  creditBureau: "https://bureau.example/orgs/credit-bureau#id",
  fintechLender: "https://fintech-lender.example/orgs/installment-lending#id",
  disbursementNetwork: "https://disbursement.example/orgs/instant-payout#id",
};

export interface PersonaFactoryOptions {
  /**
   * The demo reference instant. REQUIRED: fixtures never read the clock —
   * credential windows are offsets from this value.
   */
  now: Date;
  /** Varies the incidental identifiers (status entries, last4). */
  seed?: string;
  /** Per-persona pod base IRI override (must end with `/`). */
  podBases?: Partial<Record<PersonaId, string>>;
  /**
   * Per-persona WebID override for identities NOT rooted in the pod (e.g. a
   * dev-issuer WebID in e2e). Defaults to `${podBase}profile/card#me`. Every
   * credential's `credentialSubject` follows it, so subject binding
   * (`credentialSubject == token WebID`) holds for issuer-hosted identities.
   */
  webIds?: Partial<Record<PersonaId, string>>;
  /** Issuer identity overrides for seeding against deployed org pods. */
  issuers?: Partial<PersonaIssuers>;
}

/** One seeded pod resource: dataset + validated deterministic Turtle. */
export interface PersonaResource {
  kind: PersonaResourceKind;
  /** Pod-root-relative path (RESOURCE_POD_PATHS). */
  path: string;
  /** Absolute resource IRI (podBase + path). */
  iri: string;
  /** Root node for `validate({ expect, focusNode })`. */
  focusNode: string;
  dataset: DatasetCore;
  /** Shape-validated, byte-deterministic Turtle. */
  turtle: string;
}

export interface Persona {
  id: PersonaId;
  displayName: string;
  webId: string;
  podBase: string;
  resources: readonly PersonaResource[];
  /** The same resources keyed by pod path (the seed-layer manifest). */
  byPath: ReadonlyMap<string, PersonaResource>;
}

/** The plain values the persona is built from (exported for test assertions). */
export interface PersonaValues {
  id: PersonaId;
  name: string;
  identifier: string;
  birthDate: string;
  homeAddress: PostalAddressInit;
  employerName: string;
  jobTitle: string;
  employmentStartDate: string;
  /** ZK d4 field; must clear the scene-2 $2,200 threshold. */
  netMonthlyIncomeUsd: number;
  bankName: string;
  depositStreams: readonly DepositStreamInit[];
  /** ZK d2 field; must equal the scene-2 NSF90 = 0 predicate. */
  nsf90Count: number;
  averageDailyBalanceUsd: number;
  observationMonths: number;
  /** ZK d3 field; must clear the scene-2 660 threshold. */
  cashFlowScoreValue: number;
  /** Bureau score — the thin-file "old rail" value (612: priced out). */
  creditScoreValue: number;
  tradelineCount: number;
  creditHistoryMonths: number;
  /** Scene-3 offer terms (fintech lender's cash-flow underwrite). */
  principalUsd: number;
  aprPercent: number;
  loanTermMonths: number;
  paymentAmountUsd: number;
  totalOfPaymentsUsd: number;
  financeChargeUsd: number;
  /** Scene-5 seeded servicing state. */
  onTimePaymentCount: number;
  latePaymentCount: number;
}

/**
 * Design §5 values, digit-budget-conforming and pinned above the scene-2
 * thresholds. The two deposit streams sum to the verified net monthly income
 * (test-enforced); the offer arithmetic satisfies the loan-offer shape's
 * SPARQL identity (total = 18 x 142.26; charge = total - principal).
 */
export const PERSONA_VALUES: readonly PersonaValues[] = [
  {
    id: "maya-torres",
    name: "Maya Torres",
    identifier: "MT-0001",
    birthDate: "1999-03-14",
    homeAddress: {
      streetAddress: "2540 Sable Creek Drive",
      addressLocality: "Columbus",
      addressRegion: "OH",
      postalCode: "43219",
    },
    employerName: "Brightline Staffing LLC",
    jobTitle: "Shift Supervisor",
    employmentStartDate: "2024-11-04",
    netMonthlyIncomeUsd: 2860,
    bankName: "Clearwater Community Bank",
    depositStreams: [
      { name: "Payroll — Brightline Staffing LLC", monthlyAmountUsd: 2210 },
      { name: "Weekend rideshare payouts", monthlyAmountUsd: 650 },
    ],
    nsf90Count: 0,
    averageDailyBalanceUsd: 940,
    observationMonths: 12,
    cashFlowScoreValue: 720,
    creditScoreValue: 612,
    tradelineCount: 2,
    creditHistoryMonths: 14,
    principalUsd: 2000,
    aprPercent: 32.9,
    loanTermMonths: 18,
    paymentAmountUsd: 142.26,
    totalOfPaymentsUsd: 2560.68,
    financeChargeUsd: 560.68,
    onTimePaymentCount: 1,
    latePaymentCount: 0,
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function daysFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

/** FNV-1a 32-bit: tiny, dependency-free deterministic hash for identifiers. */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function statusEntry(issuer: string, list: string, index: number): string {
  return `${new URL(issuer).origin}/status/${list}#${index}`;
}

async function personaResource(
  kind: PersonaResourceKind,
  podBase: string,
  focusNode: string,
  resource: LendingResource,
): Promise<PersonaResource> {
  const path = RESOURCE_POD_PATHS[kind];
  return {
    kind,
    path,
    iri: `${podBase}${path.slice(1)}`,
    focusNode,
    dataset: resource.dataset,
    turtle: await resourceToTurtle(resource),
  };
}

async function buildPersona(
  values: PersonaValues,
  options: PersonaFactoryOptions,
  issuers: PersonaIssuers,
): Promise<Persona> {
  const { now } = options;
  const seed = options.seed ?? "solid-lending-demo";
  const podStem = values.id.split("-")[0] ?? values.id;
  const podBase = options.podBases?.[values.id] ?? `https://${podStem}.pod.example/`;
  if (!podBase.endsWith("/")) {
    throw new RangeError(`podBase must end with "/": ${podBase}`);
  }
  const webId = options.webIds?.[values.id] ?? `${podBase}profile/card#me`;
  const resourceIri = (kind: PersonaResourceKind): string =>
    `${podBase}${RESOURCE_POD_PATHS[kind].slice(1)}`;
  const derived = (label: string, modulus: number): number =>
    fnv1a32(`${seed}:${values.id}:${label}`) % modulus;
  const envelope = (
    kind: PersonaResourceKind,
    issuer: string,
    list: string,
    validFromDays: number,
    validUntilDays?: number,
  ): CredentialEnvelopeInit => ({
    iri: resourceIri(kind),
    issuer,
    validFrom: daysFrom(now, validFromDays),
    ...(validUntilDays !== undefined ? { validUntil: daysFrom(now, validUntilDays) } : {}),
    credentialStatus: statusEntry(issuer, list, derived(list, 1024)),
    credentialSubject: webId,
  });

  // Funded-loan timeline: offer opened -40d with a 14-day acceptance window,
  // accepted and funded -38d (push-to-card settles in 22 minutes), first
  // monthly payment made on time, history furnished -2d.
  const fundedAt = daysFrom(now, -38);
  const settledAt = new Date(fundedAt.getTime() + 22 * MINUTE_MS);

  const identity = buildIdentityCredential({
    ...envelope("identity-credential", issuers.identityVerifier, "identity", -60, 305),
    name: values.name,
    birthDate: new Date(`${values.birthDate}T00:00:00Z`),
    address: values.homeAddress,
  });

  // Freshness beat: genuinely near-expiry, no fake clock.
  const employment = buildEmploymentIncomeCredential({
    ...envelope("employment-income-credential", issuers.incomeVerifier, "employment", -30, 14),
    employerName: values.employerName,
    jobTitle: values.jobTitle,
    startDate: new Date(`${values.employmentStartDate}T00:00:00Z`),
    netMonthlyIncomeUsd: values.netMonthlyIncomeUsd,
  });

  const cashFlow = buildBankCashFlowCredential({
    ...envelope("bank-cashflow-credential", issuers.bankDataProvider, "cash-flow", -3, 27),
    providerName: values.bankName,
    accountLast4: String(derived("accountLast4", 10000)).padStart(4, "0"),
    depositStreams: values.depositStreams,
    nsf90Count: values.nsf90Count,
    averageDailyBalanceUsd: values.averageDailyBalanceUsd,
    observationMonths: values.observationMonths,
  });

  const cashFlowScore = buildCashFlowScoreCredential({
    ...envelope("cashflow-score-credential", issuers.cashFlowScorer, "cash-flow-score", -3, 27),
    cashFlowScoreValue: values.cashFlowScoreValue,
    derivedFrom: resourceIri("bank-cashflow-credential"),
  });

  const creditScore = buildCreditScoreCredential({
    ...envelope("credit-score-credential", issuers.creditBureau, "credit", -10, 80),
    creditScoreValue: values.creditScoreValue,
    tradelineCount: values.tradelineCount,
    creditHistoryMonths: values.creditHistoryMonths,
  });

  const offer = buildLoanOfferCredential({
    ...envelope("loan-offer-credential", issuers.fintechLender, "offers", -40, -26),
    principalUsd: values.principalUsd,
    aprPercent: values.aprPercent,
    financeChargeUsd: values.financeChargeUsd,
    totalOfPaymentsUsd: values.totalOfPaymentsUsd,
    loanTermMonths: values.loanTermMonths,
    numberOfPayments: values.loanTermMonths,
    paymentAmountUsd: values.paymentAmountUsd,
    paymentsPerYear: 12,
  });

  const disbursement = buildDisbursementReceiptCredential({
    iri: resourceIri("disbursement-receipt-credential"),
    issuer: issuers.disbursementNetwork,
    validFrom: settledAt,
    credentialStatus: statusEntry(
      issuers.disbursementNetwork,
      "disbursements",
      derived("disbursements", 1024),
    ),
    credentialSubject: webId,
    amountUsd: values.principalUsd,
    initiatedAt: fundedAt,
    settledAt,
    cardLast4: String(derived("cardLast4", 10000)).padStart(4, "0"),
    fundsOffer: resourceIri("loan-offer-credential"),
  });

  const repayment = buildRepaymentHistoryCredential({
    ...envelope("repayment-history-credential", issuers.fintechLender, "repayment", -2, 28),
    servicedLoan: resourceIri("loan-offer-credential"),
    onTimePaymentCount: values.onTimePaymentCount,
    latePaymentCount: values.latePaymentCount,
    scheduledPaymentCount: values.loanTermMonths,
    periodStart: fundedAt,
    periodEnd: daysFrom(now, -2),
  });

  const resources = await Promise.all([
    personaResource("identity-credential", podBase, identity.value, identity),
    personaResource("employment-income-credential", podBase, employment.value, employment),
    personaResource("bank-cashflow-credential", podBase, cashFlow.value, cashFlow),
    personaResource("cashflow-score-credential", podBase, cashFlowScore.value, cashFlowScore),
    personaResource("credit-score-credential", podBase, creditScore.value, creditScore),
    personaResource("loan-offer-credential", podBase, offer.value, offer),
    personaResource("disbursement-receipt-credential", podBase, disbursement.value, disbursement),
    personaResource("repayment-history-credential", podBase, repayment.value, repayment),
  ]);

  return {
    id: values.id,
    displayName: values.name,
    webId,
    podBase,
    resources,
    byPath: new Map(resources.map((resource) => [resource.path, resource])),
  };
}

/**
 * Build the demo persona (Maya Torres) with all eight §6.2 pod resources
 * built through the typed wrappers, validated against their SHACL shapes,
 * and serialised to deterministic Turtle. Same `now` + `seed` =>
 * byte-identical output. These are the UNSIGNED wrapper documents; the
 * vc-kit seed tooling turns them into genuinely signed credentials.
 */
export async function personas(options: PersonaFactoryOptions): Promise<readonly Persona[]> {
  const issuers: PersonaIssuers = { ...DEFAULT_ISSUERS, ...options.issuers };
  return Promise.all(PERSONA_VALUES.map((values) => buildPersona(values, options, issuers)));
}

/** The lend: field values the persona's ZK anchors bind (design §5 pinning). */
export const PERSONA_ZK_FIELD_VALUES: Readonly<Record<string, number>> = {
  [LEND.netMonthlyIncomeUsd]: PERSONA_VALUES[0]?.netMonthlyIncomeUsd ?? 0,
  [LEND.cashFlowScoreValue]: PERSONA_VALUES[0]?.cashFlowScoreValue ?? 0,
  [LEND.nsf90Count]: PERSONA_VALUES[0]?.nsf90Count ?? 0,
};
