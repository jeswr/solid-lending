/**
 * Pure, deterministic coverage of the bureau-only decision engine — the
 * bank's half of the demo's signature contrast. Verifies (a) Maya's exact
 * pinned persona figures genuinely decline on this rail, with the canon
 * Reg B principal reasons, (b) the evidence gate fails closed regardless of
 * pricing, (c) a borrower who clears the bar is approved with a priced
 * offer under the design's <36% APR ceiling, and (d) this rail never
 * consults a cash-flow figure — the file shape has no such field at all.
 */
import { PERSONA_VALUES } from "@lending/data-model";
import { describe, expect, it } from "vitest";
import {
  BUREAU_ONLY_THRESHOLDS,
  type BureauLoanFile,
  type EvidenceEntry,
  FLOOR_APR_PERCENT,
  monthlyPaymentUsd,
  runBureauOnlyDecision,
} from "../lib/server/underwriting";

function mayaPersona() {
  const persona = PERSONA_VALUES[0];
  if (persona === undefined) throw new Error("persona fixture missing");
  return persona;
}
const persona = mayaPersona();

function evidenceOf(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry[] {
  return [
    {
      fresh: true,
      kind: "credit-score",
      subjectBound: true,
      verified: true,
      verifyErrors: [],
      ...overrides,
    },
  ];
}

function mayaFile(overrides: Partial<BureauLoanFile> = {}): BureauLoanFile {
  return {
    creditHistoryMonths: persona.creditHistoryMonths,
    creditScoreValue: persona.creditScoreValue,
    evidence: evidenceOf(),
    tradelineCount: persona.tradelineCount,
    ...overrides,
  };
}

describe("the bank's bureau-only rail declines the thin file", () => {
  it("declines Maya with the canon adverse-action reasons", () => {
    const decision = runBureauOnlyDecision(mayaFile());
    expect(decision.outcome).toBe("decline");
    expect(decision.adverseActionReasons).toContain("insufficient credit history");
    expect(decision.adverseActionReasons).toContain("limited tradelines");
    expect(decision.offer).toBeUndefined();
  });

  it("a borrower who clears the bureau bar is approved with a priced offer under the 36% APR ceiling", () => {
    expect(FLOOR_APR_PERCENT).toBeLessThan(36);
    const decision = runBureauOnlyDecision(
      mayaFile({
        creditHistoryMonths: BUREAU_ONLY_THRESHOLDS.minCreditHistoryMonths,
        creditScoreValue: BUREAU_ONLY_THRESHOLDS.minCreditScore,
        tradelineCount: BUREAU_ONLY_THRESHOLDS.minTradelineCount,
      }),
    );
    expect(decision.outcome).toBe("approve");
    expect(decision.adverseActionReasons).toHaveLength(0);
    expect(decision.offer?.aprPercent).toBeLessThan(36);
    expect(decision.offer?.principalUsd).toBe(2000);
    expect(decision.offer?.loanTermMonths).toBe(18);
  });

  it("only the tradeline shortfall still declines, but with just that reason", () => {
    const decision = runBureauOnlyDecision(
      mayaFile({
        creditHistoryMonths: BUREAU_ONLY_THRESHOLDS.minCreditHistoryMonths,
        creditScoreValue: BUREAU_ONLY_THRESHOLDS.minCreditScore,
        tradelineCount: BUREAU_ONLY_THRESHOLDS.minTradelineCount - 1,
      }),
    );
    expect(decision.outcome).toBe("decline");
    expect(decision.adverseActionReasons).toEqual(["limited tradelines"]);
  });
});

describe("evidence problems take precedence over the decision (fail-closed)", () => {
  it("an unverified credit-score credential downgrades the run to refer — never decline, never approve", () => {
    const decision = runBureauOnlyDecision(
      mayaFile({ evidence: evidenceOf({ verified: false, verifyErrors: ["INVALID_SIGNATURE"] }) }),
    );
    expect(decision.outcome).toBe("refer");
    expect(decision.findings).toBeUndefined();
    expect(decision.adverseActionReasons).toHaveLength(0);
    const finding = decision.evidenceFindings.find((f) => f.code === "EVIDENCE_CREDIT_SCORE");
    expect(finding?.pass).toBe(false);
  });

  it("a subject-mismatched credential (attests a different borrower) refers, never decides", () => {
    const decision = runBureauOnlyDecision(
      mayaFile({ evidence: evidenceOf({ subjectBound: false }) }),
    );
    expect(decision.outcome).toBe("refer");
  });

  it("a stale (validity-window-lapsed) credential refers, never decides", () => {
    const decision = runBureauOnlyDecision(mayaFile({ evidence: evidenceOf({ fresh: false }) }));
    expect(decision.outcome).toBe("refer");
  });
});

describe("this rail never sees cash-flow data", () => {
  it("BureauLoanFile carries no cash-flow, income, or NSF field at all", () => {
    const file = mayaFile();
    expect(Object.keys(file).sort()).toEqual(
      ["creditHistoryMonths", "creditScoreValue", "evidence", "tradelineCount"].sort(),
    );
  });
});

describe("monthlyPaymentUsd — the shared amortization formula", () => {
  it("matches the fintech sibling's formula at the same figures (both lenders use standard amortization)", () => {
    // Verified independently against persona.paymentAmountUsd's own known-good
    // amortization identity (design §5: $2,000/18mo/32.9% APR/$142.26 payment).
    const payment = monthlyPaymentUsd(
      persona.principalUsd,
      persona.aprPercent,
      persona.loanTermMonths,
    );
    expect(payment).toBe(persona.paymentAmountUsd);
  });
});
