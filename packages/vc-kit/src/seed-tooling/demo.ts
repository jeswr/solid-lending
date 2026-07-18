/**
 * The CANONICAL demo-persona seed inputs, shared by the test suite and
 * `scripts/capture-fixtures.mjs` so fixtures and tests can never drift (one
 * source of truth). Values come from the data-model persona (Maya Torres,
 * design §5) and respect the ZK digit budgets. No real PII — demo persona
 * only.
 */

import { LEND, PERSONA_VALUES, ZK_PREQUAL_THRESHOLDS } from "@lending/data-model";
import type {
  BankCashFlowClaims,
  CashFlowScoreClaims,
  CreditScoreClaims,
  EmploymentIncomeClaims,
  LoanOfferClaims,
} from "../claims.ts";
import type { ZkStatusEntry } from "./dual-sign.ts";

export const DAY_MS = 24 * 60 * 60 * 1000;
/** The suite's fixed "wall clock" — explicit everywhere, never ambient. */
export const DEMO_NOW = new Date("2026-07-15T12:00:00Z");
/** Freshness-beat backdated window: -30d .. +14d around now. */
export const DEMO_BACKDATED_VALIDITY = {
  validFrom: new Date(DEMO_NOW.getTime() - 30 * DAY_MS),
  validUntil: new Date(DEMO_NOW.getTime() + 14 * DAY_MS),
};

export const DEMO_ISSUER = "https://verifications.example/orgs/income-verifier#id";
export const DEMO_SUBJECT = "https://maya.pod.example/profile/card#me";
export const DEMO_INCOME_CREDENTIAL_ID = "https://maya.pod.example/lending/credentials/income";
export const DEMO_CASH_FLOW_CREDENTIAL_ID =
  "https://maya.pod.example/lending/credentials/bank-cash-flow";
export const DEMO_SCORE_CREDENTIAL_ID =
  "https://maya.pod.example/lending/credentials/cash-flow-score";
export const DEMO_STATUS_LIST_URL = "https://verifications.example/status/employment";

function maya() {
  const values = PERSONA_VALUES[0];
  if (values === undefined) throw new Error("persona values missing");
  return values;
}

/**
 * Deterministic DEMO Schnorr issuer seeds (sparq `SecretKey::from_seed` —
 * test/tooling keys, never production). The array order IS the hidden-issuer
 * key-set leaf order; the hidden-issuer relation admits <= 16 keys.
 */
export const DEMO_ISSUER_SEEDS = Object.freeze({
  identityVerifier: 5001,
  incomeVerifier: 5101,
  bankDataProvider: 5202,
  cashFlowScorer: 5303,
  creditBureau: 5404,
  fintechLender: 5505,
});
export const DEMO_ISSUER_KEY_SET: readonly number[] = Object.freeze([
  DEMO_ISSUER_SEEDS.identityVerifier,
  DEMO_ISSUER_SEEDS.incomeVerifier,
  DEMO_ISSUER_SEEDS.bankDataProvider,
  DEMO_ISSUER_SEEDS.cashFlowScorer,
  DEMO_ISSUER_SEEDS.creditBureau,
  DEMO_ISSUER_SEEDS.fintechLender,
]);

/** The ZK rail's own Schnorr-bound status entries (borrower-only witness). */
export const DEMO_ZK_STATUS = Object.freeze({
  employment: {
    listIri: "https://verifications.example/status/zk-employment",
    index: 42,
    version: 1,
  } satisfies ZkStatusEntry,
  cashFlow: {
    listIri: "https://verifications.example/status/zk-cash-flow",
    index: 7,
    version: 1,
  } satisfies ZkStatusEntry,
  cashFlowScore: {
    listIri: "https://verifications.example/status/zk-cash-flow-score",
    index: 19,
    version: 1,
  } satisfies ZkStatusEntry,
});
/** Snapshot shape for revoke_unset_d10 fixtures: 1024 bits, two revoked decoys. */
export const DEMO_ZK_STATUS_LIST_SIZE = 1024;
export const DEMO_ZK_REVOKED_DECOYS: readonly number[] = Object.freeze([3, 999]);

export function demoEmploymentClaims(
  overrides: Partial<EmploymentIncomeClaims> = {},
): EmploymentIncomeClaims {
  const values = maya();
  return {
    kind: "employment-income-credential",
    employer: { name: values.employerName },
    jobTitle: values.jobTitle,
    startDate: values.employmentStartDate,
    netMonthlyIncomeUsd: values.netMonthlyIncomeUsd,
    ...overrides,
  };
}

export function demoBankCashFlowClaims(
  overrides: Partial<BankCashFlowClaims> = {},
): BankCashFlowClaims {
  const values = maya();
  return {
    kind: "bank-cashflow-credential",
    provider: { name: values.bankName },
    accountLast4: "4821",
    depositStreams: values.depositStreams.map((stream) => ({
      name: stream.name,
      monthlyAmountUsd: stream.monthlyAmountUsd,
    })),
    nsf90Count: values.nsf90Count,
    averageDailyBalanceUsd: values.averageDailyBalanceUsd,
    observationMonths: values.observationMonths,
    ...overrides,
  };
}

export function demoCashFlowScoreClaims(
  overrides: Partial<CashFlowScoreClaims> = {},
): CashFlowScoreClaims {
  const values = maya();
  return {
    kind: "cashflow-score-credential",
    cashFlowScoreValue: values.cashFlowScoreValue,
    derivedFrom: DEMO_CASH_FLOW_CREDENTIAL_ID,
    ...overrides,
  };
}

export function demoCreditScoreClaims(
  overrides: Partial<CreditScoreClaims> = {},
): CreditScoreClaims {
  const values = maya();
  return {
    kind: "credit-score-credential",
    creditScoreValue: values.creditScoreValue,
    tradelineCount: values.tradelineCount,
    creditHistoryMonths: values.creditHistoryMonths,
    ...overrides,
  };
}

export function demoLoanOfferClaims(overrides: Partial<LoanOfferClaims> = {}): LoanOfferClaims {
  const values = maya();
  return {
    kind: "loan-offer-credential",
    principalUsd: values.principalUsd,
    aprPercent: values.aprPercent,
    financeChargeUsd: values.financeChargeUsd,
    totalOfPaymentsUsd: values.totalOfPaymentsUsd,
    loanTermMonths: values.loanTermMonths,
    numberOfPayments: values.loanTermMonths,
    paymentAmountUsd: values.paymentAmountUsd,
    paymentsPerYear: 12,
    ...overrides,
  };
}

/** The per-kind hidden fields the demo mints operand anchors for. */
export const DEMO_HIDDEN_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "employment-income-credential": [LEND.netMonthlyIncomeUsd],
  "bank-cashflow-credential": [LEND.nsf90Count],
  "cashflow-score-credential": [LEND.cashFlowScoreValue],
});

/**
 * Every integer whose sparq term encoding the fixture set captures: the
 * hidden demo values (income 2860, score 720, NSF 0), the scene-2 statement
 * operands (2200, 660, 0) and the budget bounds the zk tests will exercise.
 */
export const DEMO_OPERAND_VALUES: readonly number[] = Object.freeze(
  [
    ...new Set([
      0,
      99,
      ZK_PREQUAL_THRESHOLDS.cashFlowScoreValue,
      ZK_PREQUAL_THRESHOLDS.netMonthlyIncomeUsd,
      maya().nsf90Count,
      maya().cashFlowScoreValue,
      maya().netMonthlyIncomeUsd,
      850,
      9999,
    ]),
  ].sort((a, b) => a - b),
);
