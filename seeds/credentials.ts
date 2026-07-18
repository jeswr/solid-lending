/**
 * The SCRIPTED-CREDENTIAL layer of the lending seeder: the ONE source of Maya Torres's
 * pinned demo credential inputs every consumption point seeds (dev-pod script, e2e
 * global-setup, the wallet's dev-gated Mode-1 seed route) — so pod paths, issuer roles,
 * claim values and the ZK operand anchors can never drift between them.
 *
 * Value provenance: `PERSONA_VALUES[0]` (Maya Torres, `packages/data-model/src/personas.ts`
 * — "design §5, pinned above the scene-2 proof thresholds"). Pod paths for the five signed
 * credentials reuse `RESOURCE_POD_PATHS` from `@lending/data-model` verbatim, so any app
 * reading that constant finds the SAME resource this seeder writes.
 *
 * Browser-unsafe by convention only (this module itself is plain data + string
 * templating), but its issuance consumer (`./issuance.ts`) is Node-only — see that
 * module's header.
 */
import type {
  BankCashFlowClaims,
  CashFlowScoreClaims,
  CreditScoreClaims,
  CredentialClaims,
  CredentialKind,
  EmploymentIncomeClaims,
  IdentityClaims,
} from "@lending/vc-kit";
import { LEND, PERSONA_VALUES, type PersonaValues, RESOURCE_POD_PATHS } from "@lending/data-model";
import { capturedEncoding } from "./captured-operand-enc.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

/** Maya Torres — the walkthrough's single played borrower (design §5, fictional). */
export function mayaTorres(): PersonaValues {
  const values = PERSONA_VALUES[0];
  if (values === undefined || values.id !== "maya-torres") {
    throw new Error("packages/data-model PERSONA_VALUES is missing the maya-torres persona");
  }
  return values;
}

/** Pod paths of the five signed credentials this seeder issues (data-model canon). */
export const CREDENTIAL_POD_PATHS = {
  identity: RESOURCE_POD_PATHS["identity-credential"],
  income: RESOURCE_POD_PATHS["employment-income-credential"],
  bankCashFlow: RESOURCE_POD_PATHS["bank-cashflow-credential"],
  cashFlowScore: RESOURCE_POD_PATHS["cashflow-score-credential"],
  creditScore: RESOURCE_POD_PATHS["credit-score-credential"],
} as const;

/** Borrower-only ZK operand-anchor paths (the three §6.2 ZK-anchorable fields). */
export const ANCHOR_POD_PATHS = {
  income: "/lending/zk/anchor-income",
  score: "/lending/zk/anchor-cash-flow-score",
  nsf90: "/lending/zk/anchor-nsf90",
} as const;

/** The five demo issuer seats this seeder provisions (role-first labels, `.example`-free —
 * every issuer identity is hosted ON THE SEEDED POD so verify-on-read runs the full
 * fail-closed gate chain against pod-served documents, never an unresolvable `.example`
 * domain). */
export const ISSUER_ROLES = {
  identityVerifier: {
    docPath: "/lending/issuers/identity-verifier",
    statusPath: "/lending/status/identity",
    label: "identity verification seat",
  },
  incomeVerifier: {
    docPath: "/lending/issuers/income-verifier",
    statusPath: "/lending/status/income",
    label: "income verification seat",
  },
  bankDataProvider: {
    docPath: "/lending/issuers/bank-data-provider",
    statusPath: "/lending/status/bank-cash-flow",
    label: "bank data provider seat",
  },
  cashFlowScorer: {
    docPath: "/lending/issuers/cash-flow-scorer",
    statusPath: "/lending/status/cash-flow-score",
    label: "cash-flow scorer seat",
  },
  creditBureau: {
    docPath: "/lending/issuers/credit-bureau",
    statusPath: "/lending/status/credit-score",
    label: "credit bureau seat",
  },
} as const;

export type LendingSeedIssuerRole = keyof typeof ISSUER_ROLES;

/** One pinned operand anchor beside a scripted credential. */
export interface ScriptedAnchorSeed {
  /** Pod path of the issuer-signed `lend:ZkOperandAnchor` credential. */
  readonly path: string;
  /** The anchored hidden-field IRI (one of the three ZK-provable §6.2 fields). */
  readonly field: string;
  /** The pinned hidden value the credential claims. */
  readonly value: number;
  /** The CAPTURED genuine sparq term encoding of {@link value} (never fabricated). */
  readonly operandEnc: string;
  /** Bitstring status index of the anchor VC on its issuer's list. */
  readonly statusIndex: number;
}

/** One scripted credential of the seeded borrower pod. */
export interface ScriptedCredentialSeed {
  readonly id: keyof typeof CREDENTIAL_POD_PATHS;
  readonly kind: CredentialKind;
  readonly path: string;
  readonly issuerRole: LendingSeedIssuerRole;
  readonly statusIndex: number;
  readonly validFrom: Date;
  readonly validUntil: Date;
  readonly claims: CredentialClaims;
  readonly anchor?: ScriptedAnchorSeed;
}

/**
 * The five scripted credential seeds for Maya Torres, pinned to the demo canon. `now` is
 * the caller's clock — validity windows are offsets from it, matching
 * `packages/data-model/src/personas.ts`'s own envelope offsets so the signed VCs this
 * seeder issues share the same freshness story as the unsigned persona-resource fixtures.
 * `resolve` maps a pod-root-relative path to the absolute IRI it will live at on the
 * TARGET pod (the cash-flow score credential's `prov:wasDerivedFrom` edge points at the
 * bank cash-flow credential's actual resource IRI, which depends on the pod origin).
 */
export function scriptedCredentialSeeds(
  values: PersonaValues,
  now: Date,
  resolve: (path: string) => string,
): readonly ScriptedCredentialSeed[] {
  const window = (validFromDays: number, validUntilDays: number) => ({
    validFrom: daysFrom(now, validFromDays),
    validUntil: daysFrom(now, validUntilDays),
  });

  const identityClaims: IdentityClaims = {
    kind: "identity-credential",
    name: values.name,
    birthDate: values.birthDate,
    address: values.homeAddress,
  };

  const incomeClaims: EmploymentIncomeClaims = {
    kind: "employment-income-credential",
    employer: { name: values.employerName },
    jobTitle: values.jobTitle,
    startDate: values.employmentStartDate,
    netMonthlyIncomeUsd: values.netMonthlyIncomeUsd,
  };

  const bankCashFlowClaims: BankCashFlowClaims = {
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
  };

  const cashFlowScoreClaims: CashFlowScoreClaims = {
    kind: "cashflow-score-credential",
    cashFlowScoreValue: values.cashFlowScoreValue,
    derivedFrom: resolve(CREDENTIAL_POD_PATHS.bankCashFlow),
  };

  const creditScoreClaims: CreditScoreClaims = {
    kind: "credit-score-credential",
    creditScoreValue: values.creditScoreValue,
    tradelineCount: values.tradelineCount,
    creditHistoryMonths: values.creditHistoryMonths,
  };

  return [
    {
      id: "identity",
      kind: "identity-credential",
      path: CREDENTIAL_POD_PATHS.identity,
      issuerRole: "identityVerifier",
      statusIndex: 1,
      ...window(-60, 305),
      claims: identityClaims,
    },
    {
      id: "income",
      kind: "employment-income-credential",
      path: CREDENTIAL_POD_PATHS.income,
      issuerRole: "incomeVerifier",
      statusIndex: 42,
      // Freshness beat (design §5): genuinely near-expiry, no fake clock.
      ...window(-30, 14),
      claims: incomeClaims,
      anchor: {
        path: ANCHOR_POD_PATHS.income,
        field: LEND.netMonthlyIncomeUsd,
        value: values.netMonthlyIncomeUsd,
        operandEnc: capturedEncoding(values.netMonthlyIncomeUsd),
        statusIndex: 43,
      },
    },
    {
      id: "bankCashFlow",
      kind: "bank-cashflow-credential",
      path: CREDENTIAL_POD_PATHS.bankCashFlow,
      issuerRole: "bankDataProvider",
      statusIndex: 7,
      ...window(-3, 27),
      claims: bankCashFlowClaims,
      anchor: {
        path: ANCHOR_POD_PATHS.nsf90,
        field: LEND.nsf90Count,
        value: values.nsf90Count,
        operandEnc: capturedEncoding(values.nsf90Count),
        statusIndex: 8,
      },
    },
    {
      id: "cashFlowScore",
      kind: "cashflow-score-credential",
      path: CREDENTIAL_POD_PATHS.cashFlowScore,
      issuerRole: "cashFlowScorer",
      statusIndex: 19,
      ...window(-3, 27),
      claims: cashFlowScoreClaims,
      anchor: {
        path: ANCHOR_POD_PATHS.score,
        field: LEND.cashFlowScoreValue,
        value: values.cashFlowScoreValue,
        operandEnc: capturedEncoding(values.cashFlowScoreValue),
        statusIndex: 20,
      },
    },
    {
      id: "creditScore",
      kind: "credit-score-credential",
      path: CREDENTIAL_POD_PATHS.creditScore,
      issuerRole: "creditBureau",
      statusIndex: 11,
      // Bureau score is disclosed, never ZK-proved (claims.ts CreditScoreClaims) — no anchor.
      ...window(-10, 80),
      claims: creditScoreClaims,
    },
  ];
}

/** Validity window of every seeded operand anchor. */
export function anchorValidity(now: Date): { validFrom: Date; validUntil: Date } {
  return { validFrom: daysFrom(now, -1), validUntil: daysFrom(now, 14) };
}
