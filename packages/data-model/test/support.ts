/**
 * Shared test rig for the data-model suite: a fixed instant (the library
 * never reads the clock, so the suite doesn't either) and canonical builder
 * inits derived from the persona values, so tests and fixtures cannot drift
 * from the walkthrough card.
 */
import { PERSONA_VALUES, type PersonaValues } from "../src/personas.ts";
import type {
  BankCashFlowCredentialInit,
  CashFlowScoreCredentialInit,
  CredentialEnvelopeInit,
  CreditScoreCredentialInit,
  DisbursementReceiptCredentialInit,
  EmploymentIncomeCredentialInit,
  IdentityCredentialInit,
  LoanOfferCredentialInit,
  RepaymentHistoryCredentialInit,
} from "../src/wrappers/build.ts";

export const NOW = new Date("2026-07-15T12:00:00Z");
export const DAY_MS = 24 * 60 * 60 * 1000;

export const WEBID = "https://maya.pod.example/profile/card#me";
export const ISSUER = "https://verifications.example/orgs/income-verifier#id";

export function maya(): PersonaValues {
  const values = PERSONA_VALUES[0];
  if (values === undefined) throw new Error("persona values missing");
  return values;
}

export function envelope(iri: string, overrides: Partial<CredentialEnvelopeInit> = {}) {
  return {
    iri,
    issuer: ISSUER,
    validFrom: new Date(NOW.getTime() - 30 * DAY_MS),
    validUntil: new Date(NOW.getTime() + 14 * DAY_MS),
    credentialStatus: "https://verifications.example/status/employment#42",
    credentialSubject: WEBID,
    ...overrides,
  } satisfies CredentialEnvelopeInit;
}

export function identityInit(): IdentityCredentialInit {
  const values = maya();
  return {
    ...envelope("https://maya.pod.example/lending/credentials/identity"),
    name: values.name,
    birthDate: new Date(`${values.birthDate}T00:00:00Z`),
    address: values.homeAddress,
  };
}

export function employmentInit(): EmploymentIncomeCredentialInit {
  const values = maya();
  return {
    ...envelope("https://maya.pod.example/lending/credentials/income"),
    employerName: values.employerName,
    jobTitle: values.jobTitle,
    startDate: new Date(`${values.employmentStartDate}T00:00:00Z`),
    netMonthlyIncomeUsd: values.netMonthlyIncomeUsd,
  };
}

export function cashFlowInit(): BankCashFlowCredentialInit {
  const values = maya();
  return {
    ...envelope("https://maya.pod.example/lending/credentials/bank-cash-flow"),
    providerName: values.bankName,
    accountLast4: "4821",
    depositStreams: values.depositStreams,
    nsf90Count: values.nsf90Count,
    averageDailyBalanceUsd: values.averageDailyBalanceUsd,
    observationMonths: values.observationMonths,
  };
}

export function cashFlowScoreInit(): CashFlowScoreCredentialInit {
  const values = maya();
  return {
    ...envelope("https://maya.pod.example/lending/credentials/cash-flow-score"),
    cashFlowScoreValue: values.cashFlowScoreValue,
    derivedFrom: "https://maya.pod.example/lending/credentials/bank-cash-flow",
  };
}

export function creditScoreInit(): CreditScoreCredentialInit {
  const values = maya();
  return {
    ...envelope("https://maya.pod.example/lending/credentials/credit-score"),
    creditScoreValue: values.creditScoreValue,
    tradelineCount: values.tradelineCount,
    creditHistoryMonths: values.creditHistoryMonths,
  };
}

export function loanOfferInit(): LoanOfferCredentialInit {
  const values = maya();
  return {
    ...envelope("https://maya.pod.example/lending/offer"),
    principalUsd: values.principalUsd,
    aprPercent: values.aprPercent,
    financeChargeUsd: values.financeChargeUsd,
    totalOfPaymentsUsd: values.totalOfPaymentsUsd,
    loanTermMonths: values.loanTermMonths,
    numberOfPayments: values.loanTermMonths,
    paymentAmountUsd: values.paymentAmountUsd,
    paymentsPerYear: 12,
  };
}

export function disbursementInit(): DisbursementReceiptCredentialInit {
  const values = maya();
  const initiated = new Date(NOW.getTime() - 38 * DAY_MS);
  return {
    ...envelope("https://maya.pod.example/lending/disbursement", { validUntil: undefined }),
    amountUsd: values.principalUsd,
    initiatedAt: initiated,
    settledAt: new Date(initiated.getTime() + 22 * 60 * 1000),
    cardLast4: "5390",
    fundsOffer: "https://maya.pod.example/lending/offer",
  };
}

export function repaymentInit(): RepaymentHistoryCredentialInit {
  const values = maya();
  return {
    ...envelope("https://maya.pod.example/lending/repayment-history"),
    servicedLoan: "https://maya.pod.example/lending/offer",
    onTimePaymentCount: values.onTimePaymentCount,
    latePaymentCount: values.latePaymentCount,
    scheduledPaymentCount: values.loanTermMonths,
    periodStart: new Date(NOW.getTime() - 38 * DAY_MS),
    periodEnd: new Date(NOW.getTime() - 2 * DAY_MS),
  };
}
