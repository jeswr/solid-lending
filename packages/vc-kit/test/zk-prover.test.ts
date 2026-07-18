/**
 * Tier A proving (docs/zk-plan.md) - GENUINE UltraHonk proofs over the real
 * committed circuits, proved live in Node (bb.js/noir_js run outside the
 * browser too - no headless-browser harness needed for this coverage; see
 * README for the browser-e2e note). Every "acceptance" case here produces a
 * transcript that {@link verifyTierA}/{@link verifyPreQualification} (see
 * zk-tier-a.test.ts / zk-prequalification.test.ts) independently accepts.
 * Every "unsatisfiable" case proves NOTHING was produced - the honest
 * "you cannot forge eligibility" outcome (a witness solve failure, not a
 * false proof).
 */

import { LEND } from "@lending/data-model";
import { describe, expect, it } from "vitest";
import { proveTierA, provePreQualification, ZkError } from "../src/index.ts";
import {
  encOf,
  INCOME_STATEMENT,
  MAYA_INCOME,
  MAYA_NSF,
  MAYA_SCORE,
  NONCE_INCOME,
  NONCE_NSF,
  NONCE_SCORE,
  NSF_STATEMENT,
  SCORE_STATEMENT,
  witnessOf,
} from "./zk-support.ts";

const PROVE_TIMEOUT = 180_000;

describe("proveTierA - genuine proofs over the committed filter_int family", () => {
  it(
    "proves income 2860 >= 2200 over filter_int_d4 (4-digit member)",
    async () => {
      const proof = await proveTierA({
        statement: INCOME_STATEMENT,
        value: MAYA_INCOME,
        operandEnc: encOf(MAYA_INCOME),
        nonce: NONCE_INCOME,
      });
      expect(proof.member).toBe("filter_int_d4");
      expect(proof.verifierTarget).toBe("evm");
      expect(proof.publicInputs).toHaveLength(5);
      expect(proof.proof.length).toBeGreaterThan(0);
      expect(proof.proof).toBeInstanceOf(Uint8Array);
    },
    PROVE_TIMEOUT,
  );

  it(
    "proves cash-flow score 720 >= 660 over filter_int_d3 (3-digit member)",
    async () => {
      const proof = await proveTierA({
        statement: SCORE_STATEMENT,
        value: MAYA_SCORE,
        operandEnc: encOf(MAYA_SCORE),
        nonce: NONCE_SCORE,
      });
      expect(proof.member).toBe("filter_int_d3");
    },
    PROVE_TIMEOUT,
  );

  it(
    "proves NSF₉₀ = 0 over filter_int_d1 (1-digit member - the canonical encoding of 0 is a single digit)",
    async () => {
      const proof = await proveTierA({
        statement: NSF_STATEMENT,
        value: MAYA_NSF,
        operandEnc: encOf(MAYA_NSF),
        nonce: NONCE_NSF,
      });
      expect(proof.member).toBe("filter_int_d1");
    },
    PROVE_TIMEOUT,
  );

  it(
    "UNSATISFIABLE: a below-threshold income cannot be proved >= 2200 (you cannot forge eligibility)",
    async () => {
      // Genuine operand_enc(99) - a real issuer-anchored value, just too low.
      await expect(
        proveTierA({
          statement: INCOME_STATEMENT,
          value: 99,
          operandEnc: encOf(99),
          nonce: "zk-test-nonce-income-99-unsat",
        }),
      ).rejects.toMatchObject({ code: "UNSATISFIABLE" });
    },
    PROVE_TIMEOUT,
  );

  it(
    "UNSATISFIABLE: a below-threshold cash-flow score cannot be proved >= 660",
    async () => {
      // 500 is a genuine in-budget (sh:minInclusive 300) score, just below
      // the 660 threshold - unlike 99, which is below the SCORE FIELD's own
      // minimum and would fail on BUDGET_VIOLATION before any witness solve.
      await expect(
        proveTierA({
          statement: SCORE_STATEMENT,
          value: 500,
          operandEnc: encOf(500),
          nonce: "zk-test-nonce-score-500-unsat",
        }),
      ).rejects.toMatchObject({ code: "UNSATISFIABLE" });
    },
    PROVE_TIMEOUT,
  );

  it(
    "UNSATISFIABLE: a non-zero NSF₉₀ count cannot be proved = 0",
    async () => {
      // Genuine operand_enc(99) standing in for "a non-zero NSF₉₀ count" - the
      // circuit's equality assertion fails regardless of which non-zero value.
      await expect(
        proveTierA({
          statement: NSF_STATEMENT,
          value: 99,
          operandEnc: encOf(99),
          nonce: "zk-test-nonce-nsf-99-unsat",
        }),
      ).rejects.toMatchObject({ code: "UNSATISFIABLE" });
    },
    PROVE_TIMEOUT,
  );

  it("BUDGET_VIOLATION rejects before any proving work (fail-closed gate, no witness solve)", async () => {
    await expect(
      proveTierA({
        statement: INCOME_STATEMENT,
        value: 10_000, // exceeds the 4-digit [0, 9999] budget
        operandEnc: encOf(9999),
        nonce: "zk-test-nonce-oob",
      }),
    ).rejects.toMatchObject({ code: "BUDGET_VIOLATION" });
  });

  it("UNKNOWN_FIELD rejects a non-ZK-provable field before any proving work", async () => {
    await expect(
      proveTierA({
        statement: { field: LEND.creditScoreValue, op: "ge", bound: 620 },
        value: 700,
        operandEnc: encOf(720),
        nonce: "zk-test-nonce-unknown-field",
      }),
    ).rejects.toMatchObject({ code: "UNKNOWN_FIELD" });
  });
});

describe("provePreQualification - the demo's income >= 2200 ∧ score >= 660 ∧ NSF₉₀ = 0 conjunction", () => {
  it(
    "produces one genuine Tier A proof per field, all bound to the SAME shared nonce",
    async () => {
      const nonce = "zk-test-nonce-prequal-fresh";
      const bundle = await provePreQualification({
        netMonthlyIncomeUsd: witnessOf(MAYA_INCOME),
        cashFlowScoreValue: witnessOf(MAYA_SCORE),
        nsf90Count: witnessOf(MAYA_NSF),
        nonce,
      });
      expect(bundle.netMonthlyIncomeUsd.member).toBe("filter_int_d4");
      expect(bundle.cashFlowScoreValue.member).toBe("filter_int_d3");
      expect(bundle.nsf90Count.member).toBe("filter_int_d1");
      // Every leg's public challenge input derives from the SAME nonce.
      const challenges = new Set(
        [bundle.netMonthlyIncomeUsd, bundle.cashFlowScoreValue, bundle.nsf90Count].map(
          (proof) => proof.publicInputs[0],
        ),
      );
      expect(challenges.size).toBe(1);
    },
    PROVE_TIMEOUT,
  );

  it(
    "UNSATISFIABLE: a bundle with one failing leg (score 500 < 660) cannot be produced, names the leg",
    async () => {
      let caught: unknown;
      try {
        await provePreQualification({
          netMonthlyIncomeUsd: witnessOf(MAYA_INCOME),
          cashFlowScoreValue: witnessOf(500),
          nsf90Count: witnessOf(MAYA_NSF),
          nonce: "zk-test-nonce-prequal-bad-score",
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ZkError);
      expect((caught as ZkError).code).toBe("UNSATISFIABLE");
      expect((caught as ZkError).message).toContain("cashFlowScoreValue");
    },
    PROVE_TIMEOUT,
  );
});
