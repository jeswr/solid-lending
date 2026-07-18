/**
 * DETERMINISTIC cash-flow underwriting rules (scene 3 — the demo's THESIS).
 * Pure functions over the parsed granted loan file: no randomness, no clock —
 * every time-dependent signal (credential freshness) arrives as an explicit
 * pre-computed input, so the same loan file always produces byte-identical
 * findings. Transparent, threshold-based rules an examiner can read top to
 * bottom, standing in for a lender's proprietary scorecard (FinRegLab: cash-
 * flow variables are predictive of credit risk on their own and additive to
 * bureau data — docs/research/small-dollar-lending-design.md §1, §6).
 *
 * The signature beat: TWO independent decisions run over the SAME evidence —
 * `bureauOnly` (the old rail — bureau score + tradeline depth only) and
 * `cashFlowPlus` (this lender's actual product — net deposits, zero-NSF,
 * cash-flow score). Maya's persona is pinned so the first declines her and
 * the second approves her at 32.9% APR (design §5); the contrast is rendered
 * honestly, not scripted after the fact — the SAME threshold engine that
 * approves her would decline a borrower who does not clear the cash-flow
 * bar, and would approve a borrower who clears the bureau bar too.
 *
 * Evidence problems take precedence over pricing: numbers that cannot be
 * trusted are never underwritten, on EITHER rail — an unverified, tampered,
 * unbound, or stale credential downgrades the whole run to "refer", never
 * "approve".
 */
import { ZK_PREQUAL_THRESHOLDS } from "@lending/data-model";

export type EvidenceKind =
  | "identity"
  | "income"
  | "bank-cash-flow"
  | "cash-flow-score"
  | "credit-score";

/** Pre-computed evidence verdict for ONE credential (clock resolved upstream). */
export interface EvidenceEntry {
  readonly kind: EvidenceKind;
  /** Full fail-closed `verifyCredential` verdict (signature + issuer + window + status + shape). */
  readonly verified: boolean;
  /** `credentialSubject == authenticated borrower WebID`. */
  readonly subjectBound: boolean;
  /** Validity-window check at the evaluation instant. */
  readonly fresh: boolean;
  /** Distinct verifier failure codes (diagnostics; never secrets). */
  readonly verifyErrors: readonly string[];
}

/** The parsed loan file the rules run over — plain values, no RDF, no IO. */
export interface CashFlowLoanFile {
  readonly netMonthlyIncomeUsd: number;
  readonly nsf90Count: number;
  readonly cashFlowScoreValue: number;
  readonly creditScoreValue: number;
  readonly tradelineCount: number;
  readonly creditHistoryMonths: number;
  readonly evidence: readonly EvidenceEntry[];
}

export type RailOutcome = "approve" | "decline";

export interface RailFinding {
  readonly code: string;
  readonly rule: string;
  readonly pass: boolean;
  readonly observed: string;
  readonly threshold: string;
}

export interface OfferTerms {
  readonly principalUsd: number;
  readonly aprPercent: number;
  readonly loanTermMonths: number;
  readonly paymentAmountUsd: number;
  readonly totalOfPaymentsUsd: number;
  readonly financeChargeUsd: number;
}

export interface RailDecision {
  readonly outcome: RailOutcome;
  readonly findings: readonly RailFinding[];
  /** ECOA/Reg B principal reasons for a decline (§1002.9); empty on approve. */
  readonly adverseActionReasons: readonly string[];
  readonly offer?: OfferTerms;
}

export type DecisionOutcome = "approve" | "decline" | "refer";

export interface TwoModelDecision {
  readonly outcome: DecisionOutcome;
  readonly evidenceFindings: readonly RailFinding[];
  /** `undefined` when the evidence gate failed (fail-closed: never priced on unverified data). */
  readonly bureauOnly?: RailDecision;
  readonly cashFlowPlus?: RailDecision;
}

/** The bureau-only rail's thresholds — a conventional near-prime bar Maya's thin file misses. */
export const BUREAU_ONLY_THRESHOLDS = {
  minCreditHistoryMonths: 24,
  minCreditScore: 640,
  minTradelineCount: 3,
} as const;

/** The cash-flow rail's thresholds — identical to the scene-2 ZK pre-qual predicate (design §5/§6.2), so shopping and underwriting can never silently drift apart. */
export const CASH_FLOW_THRESHOLDS = ZK_PREQUAL_THRESHOLDS;

/**
 * Illustrative APR pricing tiers keyed on the cash-flow score (the rate a
 * cash-flow-underwriting lender can offer BECAUSE it sees more than the
 * bureau file — design §1: "+28% approvals at flat risk" is what this tiering
 * dramatizes). All figures illustrative/concept-demo, never a real quote.
 */
const APR_TIERS: readonly { readonly minScore: number; readonly aprPercent: number }[] = [
  { aprPercent: 24.9, minScore: 750 },
  { aprPercent: 32.9, minScore: 700 },
  { aprPercent: 35.9, minScore: BUREAU_ONLY_THRESHOLDS.minCreditScore },
];

/** The lowest tier's APR — the ceiling every priced offer on either rail stays under (design §1: target < 36% APR). */
export const FLOOR_APR_PERCENT = APR_TIERS[APR_TIERS.length - 1]?.aprPercent ?? 35.9;

function aprTierFor(scoreValue: number, floorScore: number): number | undefined {
  if (scoreValue < floorScore) return undefined;
  for (const tier of APR_TIERS) {
    if (scoreValue >= tier.minScore) return tier.aprPercent;
  }
  return FLOOR_APR_PERCENT;
}

/** Standard amortized monthly principal + interest, rounded to whole cents. */
export function monthlyPaymentUsd(
  principalUsd: number,
  annualRatePercent: number,
  termMonths: number,
): number {
  const r = annualRatePercent / 100 / 12;
  const factor = (1 + r) ** termMonths;
  return Math.round(((principalUsd * r * factor) / (factor - 1)) * 100) / 100;
}

/** The demo's requested loan (design §5: $2,000 over 18 months — no application-amount input in this walkthrough). */
export const REQUESTED_PRINCIPAL_USD = 2000;
export const REQUESTED_TERM_MONTHS = 18;

function offerFor(scoreValue: number, floorScore: number): OfferTerms | undefined {
  const aprPercent = aprTierFor(scoreValue, floorScore);
  if (aprPercent === undefined) return undefined;
  const paymentAmountUsd = monthlyPaymentUsd(
    REQUESTED_PRINCIPAL_USD,
    aprPercent,
    REQUESTED_TERM_MONTHS,
  );
  const totalOfPaymentsUsd = Math.round(paymentAmountUsd * REQUESTED_TERM_MONTHS * 100) / 100;
  return {
    aprPercent,
    financeChargeUsd: Math.round((totalOfPaymentsUsd - REQUESTED_PRINCIPAL_USD) * 100) / 100,
    loanTermMonths: REQUESTED_TERM_MONTHS,
    paymentAmountUsd,
    principalUsd: REQUESTED_PRINCIPAL_USD,
    totalOfPaymentsUsd,
  };
}

const EVIDENCE_LABELS: Readonly<Record<EvidenceKind, string>> = {
  "bank-cash-flow": "bank cash-flow credential",
  "cash-flow-score": "cash-flow score credential",
  "credit-score": "credit-score credential",
  identity: "identity credential",
  income: "employment + income credential",
};

const EVIDENCE_ORDER: readonly EvidenceKind[] = [
  "identity",
  "income",
  "bank-cash-flow",
  "cash-flow-score",
  "credit-score",
];

function evidenceFinding(entry: EvidenceEntry): RailFinding {
  const failures: string[] = [];
  if (!entry.verified) failures.push("failed fail-closed verification");
  if (!entry.subjectBound) failures.push("attests a different subject");
  if (!entry.fresh) failures.push("validity window lapsed");
  const pass = failures.length === 0;
  return {
    code: `EVIDENCE_${entry.kind.toUpperCase().replace(/-/g, "_")}`,
    observed: pass
      ? "verified, subject-bound, and within its validity window"
      : failures.join("; "),
    pass,
    rule: `The ${EVIDENCE_LABELS[entry.kind]} must fully verify, attest the applicant, and be within its validity window`,
    threshold: "verified AND subject-bound AND fresh",
  };
}

function runBureauOnly(file: CashFlowLoanFile): RailDecision {
  const t = BUREAU_ONLY_THRESHOLDS;
  const findings: RailFinding[] = [
    {
      code: "BUREAU_CREDIT_SCORE",
      observed: String(file.creditScoreValue),
      pass: file.creditScoreValue >= t.minCreditScore,
      rule: "Bureau credit score meets the near-prime approval floor",
      threshold: `>= ${t.minCreditScore}`,
    },
    {
      code: "BUREAU_TRADELINE_DEPTH",
      observed: String(file.tradelineCount),
      pass: file.tradelineCount >= t.minTradelineCount,
      rule: "Sufficient open tradelines to score the file",
      threshold: `>= ${t.minTradelineCount}`,
    },
    {
      code: "BUREAU_CREDIT_HISTORY",
      observed: `${file.creditHistoryMonths} months`,
      pass: file.creditHistoryMonths >= t.minCreditHistoryMonths,
      rule: "Minimum credit history length",
      threshold: `>= ${t.minCreditHistoryMonths} months`,
    },
  ];
  const failed = findings.filter((finding) => !finding.pass);
  const outcome: RailOutcome = failed.length === 0 ? "approve" : "decline";
  const adverseActionReasons: string[] = [];
  if (failed.some((finding) => finding.code === "BUREAU_TRADELINE_DEPTH")) {
    adverseActionReasons.push("limited tradelines");
  }
  if (
    failed.some(
      (finding) =>
        finding.code === "BUREAU_CREDIT_SCORE" || finding.code === "BUREAU_CREDIT_HISTORY",
    )
  ) {
    adverseActionReasons.push("insufficient credit history");
  }
  return {
    adverseActionReasons,
    findings,
    outcome,
    // Priced off the BUREAU score — a bureau-only rail never sees cash-flow data.
    ...(outcome === "approve"
      ? { offer: offerFor(file.creditScoreValue, BUREAU_ONLY_THRESHOLDS.minCreditScore) }
      : {}),
  };
}

function runCashFlowPlus(file: CashFlowLoanFile): RailDecision {
  const t = CASH_FLOW_THRESHOLDS;
  const findings: RailFinding[] = [
    {
      code: "CASHFLOW_NET_INCOME",
      observed: `$${file.netMonthlyIncomeUsd}/mo`,
      pass: file.netMonthlyIncomeUsd >= t.netMonthlyIncomeUsd,
      rule: "Net monthly deposits meet the cash-flow income floor",
      threshold: `>= $${t.netMonthlyIncomeUsd}/mo`,
    },
    {
      code: "CASHFLOW_NSF90",
      observed: `${file.nsf90Count} events`,
      pass: file.nsf90Count === t.nsf90Count,
      rule: "Zero NSF/overdraft events in the trailing 90 days",
      threshold: `= ${t.nsf90Count}`,
    },
    {
      code: "CASHFLOW_SCORE",
      observed: String(file.cashFlowScoreValue),
      pass: file.cashFlowScoreValue >= t.cashFlowScoreValue,
      rule: "Cash-flow score meets the underwriting floor",
      threshold: `>= ${t.cashFlowScoreValue}`,
    },
  ];
  const failed = findings.filter((finding) => !finding.pass);
  const outcome: RailOutcome = failed.length === 0 ? "approve" : "decline";
  return {
    adverseActionReasons: failed.map((finding) => finding.rule),
    findings,
    outcome,
    ...(outcome === "approve"
      ? { offer: offerFor(file.cashFlowScoreValue, CASH_FLOW_THRESHOLDS.cashFlowScoreValue) }
      : {}),
  };
}

/**
 * Run BOTH rails over one evidence-gated loan file. Evidence problems are
 * evaluated FIRST and take precedence over both rails: when any credential
 * cannot be relied on, NEITHER rail is priced — the fail-closed "refer"
 * outcome, exactly as an unverifiable file would in production.
 */
export function runTwoModelDecision(file: CashFlowLoanFile): TwoModelDecision {
  const byKind = new Map(file.evidence.map((entry) => [entry.kind, entry]));
  const evidenceFindings: RailFinding[] = EVIDENCE_ORDER.map((kind) => {
    const entry = byKind.get(kind);
    if (entry !== undefined) return evidenceFinding(entry);
    return {
      code: `EVIDENCE_${kind.toUpperCase().replace(/-/g, "_")}`,
      observed: "credential missing from the granted loan file",
      pass: false,
      rule: `The ${EVIDENCE_LABELS[kind]} must fully verify, attest the applicant, and be within its validity window`,
      threshold: "verified AND subject-bound AND fresh",
    };
  });

  if (evidenceFindings.some((finding) => !finding.pass)) {
    return { evidenceFindings, outcome: "refer" };
  }

  const bureauOnly = runBureauOnly(file);
  const cashFlowPlus = runCashFlowPlus(file);
  // The demo's headline outcome is the ACTUAL product decision (cash-flow
  // plus) — the bureau-only rail is rendered purely as the honest contrast.
  return { bureauOnly, cashFlowPlus, evidenceFindings, outcome: cashFlowPlus.outcome };
}
