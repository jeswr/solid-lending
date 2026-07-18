/**
 * Pure, deterministic coverage of the two-model decision engine — the
 * demo's signature beat. Verifies (a) Maya's exact pinned persona figures
 * reproduce the exact pinned offer ($2,000/18mo/32.9% APR/$142.26 payment),
 * (b) the bureau-only rail genuinely declines her on the SAME evidence,
 * (c) the evidence gate fails closed regardless of pricing, and (d) the
 * pricing ceiling never reaches the design's <36% APR target.
 */
import { PERSONA_VALUES, ZK_PREQUAL_THRESHOLDS } from "@lending/data-model";
import { describe, expect, it } from "vitest";
import {
  BUREAU_ONLY_THRESHOLDS,
  CASH_FLOW_THRESHOLDS,
  type CashFlowLoanFile,
  type EvidenceEntry,
  FLOOR_APR_PERCENT,
  monthlyPaymentUsd,
  runTwoModelDecision,
} from "../lib/server/underwriting";

function mayaPersona() {
  const persona = PERSONA_VALUES[0];
  if (persona === undefined) throw new Error("persona fixture missing");
  return persona;
}
const persona = mayaPersona();

function evidenceOf(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry[] {
  return (["identity", "income", "bank-cash-flow", "cash-flow-score", "credit-score"] as const).map(
    (kind) => ({
      fresh: true,
      kind,
      subjectBound: true,
      verified: true,
      verifyErrors: [],
      ...overrides,
    }),
  );
}

function mayaFile(overrides: Partial<CashFlowLoanFile> = {}): CashFlowLoanFile {
  return {
    cashFlowScoreValue: persona.cashFlowScoreValue,
    creditHistoryMonths: persona.creditHistoryMonths,
    creditScoreValue: persona.creditScoreValue,
    evidence: evidenceOf(),
    netMonthlyIncomeUsd: persona.netMonthlyIncomeUsd,
    nsf90Count: persona.nsf90Count,
    tradelineCount: persona.tradelineCount,
    ...overrides,
  };
}

describe("thresholds stay pinned to the scene-2 ZK predicate", () => {
  it("CASH_FLOW_THRESHOLDS is exactly ZK_PREQUAL_THRESHOLDS — shopping and underwriting never drift", () => {
    expect(CASH_FLOW_THRESHOLDS).toEqual(ZK_PREQUAL_THRESHOLDS);
  });
});

describe("the signature beat — one file, two decisions", () => {
  it("cash-flow-plus approves Maya at the exact persona-pinned offer", () => {
    const decision = runTwoModelDecision(mayaFile());
    expect(decision.outcome).toBe("approve");
    expect(decision.cashFlowPlus?.outcome).toBe("approve");
    const offer = decision.cashFlowPlus?.offer;
    expect(offer?.principalUsd).toBe(persona.principalUsd);
    expect(offer?.loanTermMonths).toBe(persona.loanTermMonths);
    expect(offer?.aprPercent).toBe(persona.aprPercent);
    expect(offer?.paymentAmountUsd).toBe(persona.paymentAmountUsd);
    expect(offer?.totalOfPaymentsUsd).toBe(persona.totalOfPaymentsUsd);
    expect(offer?.financeChargeUsd).toBe(persona.financeChargeUsd);
  });

  it("bureau-only declines the SAME borrower with the canon adverse-action reasons", () => {
    const decision = runTwoModelDecision(mayaFile());
    expect(decision.bureauOnly?.outcome).toBe("decline");
    expect(decision.bureauOnly?.adverseActionReasons).toContain("insufficient credit history");
    expect(decision.bureauOnly?.adverseActionReasons).toContain("limited tradelines");
    expect(decision.bureauOnly?.offer).toBeUndefined();
  });

  it("every priced offer, on either rail, stays under the 36% APR design ceiling", () => {
    expect(FLOOR_APR_PERCENT).toBeLessThan(36);
    const decision = runTwoModelDecision(mayaFile());
    expect(decision.cashFlowPlus?.offer?.aprPercent).toBeLessThan(36);
  });

  it("a borrower who clears BOTH bars is approved on both rails", () => {
    const decision = runTwoModelDecision(
      mayaFile({
        creditHistoryMonths: BUREAU_ONLY_THRESHOLDS.minCreditHistoryMonths,
        creditScoreValue: BUREAU_ONLY_THRESHOLDS.minCreditScore,
        tradelineCount: BUREAU_ONLY_THRESHOLDS.minTradelineCount,
      }),
    );
    expect(decision.bureauOnly?.outcome).toBe("approve");
    expect(decision.cashFlowPlus?.outcome).toBe("approve");
  });

  it("a borrower who clears the bureau bar but NOT the cash-flow bar is declined on cash-flow, approved on bureau", () => {
    const decision = runTwoModelDecision(
      mayaFile({
        creditHistoryMonths: BUREAU_ONLY_THRESHOLDS.minCreditHistoryMonths,
        creditScoreValue: BUREAU_ONLY_THRESHOLDS.minCreditScore,
        nsf90Count: 2,
        tradelineCount: BUREAU_ONLY_THRESHOLDS.minTradelineCount,
      }),
    );
    expect(decision.bureauOnly?.outcome).toBe("approve");
    expect(decision.cashFlowPlus?.outcome).toBe("decline");
    expect(decision.outcome).toBe("decline");
  });
});

describe("evidence problems take precedence over BOTH rails (fail-closed)", () => {
  it("an unverified credential downgrades the whole run to refer — no pricing on either rail", () => {
    const decision = runTwoModelDecision(
      mayaFile({
        evidence: evidenceOf().map((entry) =>
          entry.kind === "income"
            ? { ...entry, verified: false, verifyErrors: ["INVALID_SIGNATURE"] }
            : entry,
        ),
      }),
    );
    expect(decision.outcome).toBe("refer");
    expect(decision.bureauOnly).toBeUndefined();
    expect(decision.cashFlowPlus).toBeUndefined();
    const finding = decision.evidenceFindings.find((f) => f.code === "EVIDENCE_INCOME");
    expect(finding?.pass).toBe(false);
  });

  it("a subject-mismatched credential (attests a different borrower) refers, never approves", () => {
    const decision = runTwoModelDecision(
      mayaFile({
        evidence: evidenceOf().map((entry) =>
          entry.kind === "cash-flow-score" ? { ...entry, subjectBound: false } : entry,
        ),
      }),
    );
    expect(decision.outcome).toBe("refer");
  });

  it("a stale (validity-window-lapsed) credential refers, never approves", () => {
    const decision = runTwoModelDecision(
      mayaFile({
        evidence: evidenceOf().map((entry) =>
          entry.kind === "identity" ? { ...entry, fresh: false } : entry,
        ),
      }),
    );
    expect(decision.outcome).toBe("refer");
  });
});

describe("monthlyPaymentUsd — the shared amortization formula", () => {
  it("reproduces the persona-pinned figures exactly", () => {
    const payment = monthlyPaymentUsd(
      persona.principalUsd,
      persona.aprPercent,
      persona.loanTermMonths,
    );
    expect(payment).toBe(persona.paymentAmountUsd);
  });
});
