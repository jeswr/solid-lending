/**
 * DETERMINISTIC bureau-only underwriting rules (scene 3 — the demo's
 * signature CONTRAST, played from the bank's seat). Pure functions over the
 * parsed granted credit-score credential: no randomness, no clock — every
 * time-dependent signal (credential freshness) arrives as an explicit
 * pre-computed input, so the same file always produces byte-identical
 * findings.
 *
 * This is deliberately the ONLY rail the Personal Loan Desk runs: it never
 * reads income, bank cash-flow, or cash-flow-score evidence — those
 * credentials are the fintech-lender sibling's product, not this one's
 * (design's inclusion thesis: "the same borrower, the same data, decisioned
 * two ways"). `BUREAU_ONLY_THRESHOLDS` is the SAME conventional near-prime
 * bar the fintech-lender sibling's own bureau-only contrast rail uses
 * (docs/research/small-dollar-lending-design.md §6, §1) — two independent
 * lenders converging on the same industry-standard bureau floor, not a
 * shared import (each lender owns its own decisioning code).
 *
 * Evidence problems take precedence over pricing: a credit-score credential
 * that cannot be trusted is never underwritten — an unverified, tampered,
 * unbound, or stale credential downgrades the run to "refer", never
 * "decline" or "approve".
 */

export type EvidenceKind = "credit-score";

/** Pre-computed evidence verdict for the ONE credential this rail relies on (clock resolved upstream). */
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

/** The parsed bureau file the rule runs over — plain values, no RDF, no IO. */
export interface BureauLoanFile {
  readonly creditScoreValue: number;
  readonly tradelineCount: number;
  readonly creditHistoryMonths: number;
  readonly evidence: readonly EvidenceEntry[];
}

export type DecisionOutcome = "approve" | "decline" | "refer";

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

export interface BureauDecision {
  readonly outcome: DecisionOutcome;
  readonly evidenceFindings: readonly RailFinding[];
  /** Only present once the evidence gate passed (fail-closed: never priced on unverified data). */
  readonly findings?: readonly RailFinding[];
  /** ECOA/Reg B principal reasons for a decline (12 CFR §1002.9); empty otherwise. */
  readonly adverseActionReasons: readonly string[];
  readonly offer?: OfferTerms;
}

/** The bureau-only rail's thresholds — a conventional near-prime bar Maya's thin file misses. */
export const BUREAU_ONLY_THRESHOLDS = {
  minCreditHistoryMonths: 24,
  minCreditScore: 640,
  minTradelineCount: 3,
} as const;

/**
 * Illustrative APR pricing tiers keyed on the bureau score — this lender's
 * OWN conventional (bureau-only) pricing, distinct from the fintech
 * sibling's cash-flow tiering: without cash-flow evidence, the Personal Loan
 * Desk can only price off the disclosed bureau score, which is why its best
 * quote is worse than a cash-flow-underwriting lender's even when both
 * approve the same borrower. All figures illustrative/concept-demo, never a
 * real quote.
 */
const APR_TIERS: readonly { readonly minScore: number; readonly aprPercent: number }[] = [
  { aprPercent: 22.9, minScore: 750 },
  { aprPercent: 29.9, minScore: 700 },
  { aprPercent: 35.9, minScore: BUREAU_ONLY_THRESHOLDS.minCreditScore },
];

/** The lowest tier's APR — the ceiling every priced offer stays under (design §1: target < 36% APR). */
export const FLOOR_APR_PERCENT = APR_TIERS[APR_TIERS.length - 1]?.aprPercent ?? 35.9;

/** The demo's requested loan (design §5: $2,000 over 18 months — no application-amount input in this walkthrough). */
export const REQUESTED_PRINCIPAL_USD = 2000;
export const REQUESTED_TERM_MONTHS = 18;

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

function offerFor(scoreValue: number): OfferTerms | undefined {
  if (scoreValue < BUREAU_ONLY_THRESHOLDS.minCreditScore) return undefined;
  let aprPercent = FLOOR_APR_PERCENT;
  for (const tier of APR_TIERS) {
    if (scoreValue >= tier.minScore) {
      aprPercent = tier.aprPercent;
      break;
    }
  }
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

function evidenceFinding(entry: EvidenceEntry): RailFinding {
  const failures: string[] = [];
  if (!entry.verified) failures.push("failed fail-closed verification");
  if (!entry.subjectBound) failures.push("attests a different subject");
  if (!entry.fresh) failures.push("validity window lapsed");
  const pass = failures.length === 0;
  return {
    code: "EVIDENCE_CREDIT_SCORE",
    observed: pass
      ? "verified, subject-bound, and within its validity window"
      : failures.join("; "),
    pass,
    rule: "The credit-score credential must fully verify, attest the applicant, and be within its validity window",
    threshold: "verified AND subject-bound AND fresh",
  };
}

/**
 * Run the bureau-only decision over the ONE evidence-gated credit-score
 * credential. Evidence problems are evaluated FIRST: when the credential
 * cannot be relied on, the rail is never priced — the fail-closed "refer"
 * outcome, exactly as an unverifiable file would in production.
 */
export function runBureauOnlyDecision(file: BureauLoanFile): BureauDecision {
  const evidenceFindings = file.evidence.map(evidenceFinding);
  if (evidenceFindings.some((finding) => !finding.pass)) {
    return { adverseActionReasons: [], evidenceFindings, outcome: "refer" };
  }

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
  const outcome: DecisionOutcome = failed.length === 0 ? "approve" : "decline";

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
    evidenceFindings,
    findings,
    outcome,
    ...(outcome === "approve" ? { offer: offerFor(file.creditScoreValue) } : {}),
  };
}
