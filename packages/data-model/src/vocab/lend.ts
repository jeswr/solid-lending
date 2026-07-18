// Generated from vocab/lend.ttl by scripts/generate-vocab.mjs - DO NOT EDIT.
// Regenerate from packages/data-model: node scripts/generate-vocab.mjs

/** Identity of the lend residue vocabulary (RFC 6963 example URN - local, non-dereferenceable). */
export const LEND_ONTOLOGY_IRI = "urn:example:lend";

/** Namespace of the lend residue vocabulary. */
export const LEND_NAMESPACE = "urn:example:lend#";

/**
 * IRI constants for every term defined in vocab/lend.ttl
 * (hyphens in SKOS concept local names become underscores).
 */
export const LEND = {
  accountLast4: "urn:example:lend#accountLast4",
  BankCashFlowCredential: "urn:example:lend#BankCashFlowCredential",
  CashFlowScoreCredential: "urn:example:lend#CashFlowScoreCredential",
  cashFlowScoreValue: "urn:example:lend#cashFlowScoreValue",
  creditHistoryMonths: "urn:example:lend#creditHistoryMonths",
  CreditScoreCredential: "urn:example:lend#CreditScoreCredential",
  creditScoreValue: "urn:example:lend#creditScoreValue",
  DepositStream: "urn:example:lend#DepositStream",
  DisbursementReceiptCredential: "urn:example:lend#DisbursementReceiptCredential",
  EmploymentIncomeCredential: "urn:example:lend#EmploymentIncomeCredential",
  field: "urn:example:lend#field",
  hasAverageDailyBalance: "urn:example:lend#hasAverageDailyBalance",
  hasDepositStream: "urn:example:lend#hasDepositStream",
  hasDisbursement: "urn:example:lend#hasDisbursement",
  hasFinanceCharge: "urn:example:lend#hasFinanceCharge",
  hasLoanOffer: "urn:example:lend#hasLoanOffer",
  hasTotalOfPayments: "urn:example:lend#hasTotalOfPayments",
  IdentityCredential: "urn:example:lend#IdentityCredential",
  latePaymentCount: "urn:example:lend#latePaymentCount",
  LoanOfferCredential: "urn:example:lend#LoanOfferCredential",
  loanTermMonths: "urn:example:lend#loanTermMonths",
  netMonthlyIncomeUsd: "urn:example:lend#netMonthlyIncomeUsd",
  nsf90Count: "urn:example:lend#nsf90Count",
  observationMonths: "urn:example:lend#observationMonths",
  onTimePaymentCount: "urn:example:lend#onTimePaymentCount",
  operandEnc: "urn:example:lend#operandEnc",
  paymentRail: "urn:example:lend#paymentRail",
  PaymentRail_PushToCard: "urn:example:lend#PaymentRail-PushToCard",
  PaymentRailScheme: "urn:example:lend#PaymentRailScheme",
  RepaymentHistoryCredential: "urn:example:lend#RepaymentHistoryCredential",
  scheduledPaymentCount: "urn:example:lend#scheduledPaymentCount",
  scoreModel: "urn:example:lend#scoreModel",
  ScoreModel_BureauClassic: "urn:example:lend#ScoreModel-BureauClassic",
  ScoreModel_CashFlowV1: "urn:example:lend#ScoreModel-CashFlowV1",
  ScoreModelScheme: "urn:example:lend#ScoreModelScheme",
  servicedLoan: "urn:example:lend#servicedLoan",
  tradelineCount: "urn:example:lend#tradelineCount",
  ZkOperandAnchor: "urn:example:lend#ZkOperandAnchor",
} as const;

/** Constant keys of the lend vocabulary. */
export type LendTermKey = keyof typeof LEND;

/** Term IRIs of the lend vocabulary. */
export type LendTermIri = (typeof LEND)[LendTermKey];
