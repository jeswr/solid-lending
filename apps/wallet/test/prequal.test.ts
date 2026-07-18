/**
 * SECURITY-CRITICAL: scene-2 pre-qualification, exercised against a REAL
 * `@jeswr/solid-server` pod seeded with genuinely signed credentials +
 * operand anchors (`@lending/seeds`) — never a fixture stub. Reads run
 * through the FULL fail-closed `verifyCredential` chain
 * (`../lib/server/prequal-witness.ts`) before any value becomes a witness,
 * the proof is produced by the REAL sparq UltraHonk prover
 * (`provePreQualification`), and checked by the REAL verifier
 * (`verifyPreQualification`) — nothing mocked.
 *
 * Acceptance:
 *  - a genuine witness bundle (Maya Torres, pinned above every threshold)
 *    proves and verifies true, bound to the minted challenge;
 *  - a below-threshold income witness cannot be proved at all — the honest
 *    "you cannot forge eligibility" outcome (UNSATISFIABLE), not a false
 *    verdict that later fails verification;
 *  - the shared nonce is single-use: replaying the same (sessionKey, nonce)
 *    rejects.
 */
import { createLendingIssuance, seedLendingPod } from "@lending/seeds";
import { startSolidServer, type SolidTestAccount, type SolidTestServer } from "@lending/test-kit";
import { ZkError } from "@lending/vc-kit";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { issueChallenge, proveAndVerify } from "../lib/server/prequal-service";
import { readPreQualWitnesses } from "../lib/server/prequal-witness";

const PROVE_TIMEOUT = 180_000;
const NOW = new Date("2026-07-15T12:00:00Z");

let pods: SolidTestServer;
let account: SolidTestAccount;
let podBase = "";

beforeAll(async () => {
  pods = await startSolidServer({});
  const primary = pods.accounts[0];
  if (primary === undefined) throw new Error("harness booted with no primary account");
  account = primary;
  podBase = `${account.baseUrl}/`;

  const issuance = createLendingIssuance({ podOrigin: account.baseUrl, now: NOW });
  await seedLendingPod({
    target: { webid: account.webid, baseUrl: account.baseUrl, authFetch: account.authFetch },
    issuance,
    now: NOW,
    mode: "create",
  });
}, PROVE_TIMEOUT);

afterAll(async () => {
  await pods?.stop();
});

describe("pre-qualification — the real prove/verify round trip", () => {
  test(
    "Maya's genuine witnesses (pinned above every threshold) prove AND verify true",
    async () => {
      const { sessionKey, nonce } = issueChallenge();
      const result = await proveAndVerify({
        podBase,
        webid: account.webid,
        sessionKey,
        nonce,
        now: NOW,
      });
      expect(result.verification.errors).toEqual([]);
      expect(result.verification.verified).toBe(true);
      expect(result.verification.legs.netMonthlyIncomeUsd.verified).toBe(true);
      expect(result.verification.legs.cashFlowScoreValue.verified).toBe(true);
      expect(result.verification.legs.nsf90Count.verified).toBe(true);
    },
    PROVE_TIMEOUT,
  );

  test(
    "the shared nonce is single-use: replaying the same session rejects",
    async () => {
      const { sessionKey, nonce } = issueChallenge();
      const first = await proveAndVerify({
        podBase,
        webid: account.webid,
        sessionKey,
        nonce,
        now: NOW,
      });
      expect(first.verification.verified).toBe(true);

      // provePreQualification does not touch the nonce store — only the
      // VERIFY leg burns it — so a second verify attempt against the SAME
      // (sessionKey, nonce) must fail even with a freshly re-proved bundle.
      const witnesses = await readPreQualWitnesses({ podBase, now: NOW });
      const { provePreQualification, verifyPreQualification } = await import("@lending/vc-kit");
      const replayProof = await provePreQualification({
        netMonthlyIncomeUsd: witnesses.netMonthlyIncomeUsd,
        cashFlowScoreValue: witnesses.cashFlowScoreValue,
        nsf90Count: witnesses.nsf90Count,
        nonce,
      });
      const { nonceConsumer } = await import("../lib/server/prequal-nonces");
      const replay = await verifyPreQualification(replayProof, {
        anchors: {
          netMonthlyIncomeUsd: witnesses.netMonthlyIncomeUsd.anchorTurtle,
          cashFlowScoreValue: witnesses.cashFlowScoreValue.anchorTurtle,
          nsf90Count: witnesses.nsf90Count.anchorTurtle,
        },
        webid: account.webid,
        nonce,
        nonces: nonceConsumer,
        sessionKey,
        now: NOW,
        trustedIssuers: ["placeholder-never-reached"],
      });
      expect(replay.verified).toBe(false);
      expect(replay.errors[0]?.code).toBe("NONCE_INVALID");
    },
    PROVE_TIMEOUT,
  );
});

describe("pre-qualification — forgeability (decision 0012 posture)", () => {
  test(
    "a forged income value (a genuine-looking encoding that is not its own) cannot be proved — UNSATISFIABLE, never a false pass",
    async () => {
      const witnesses = await readPreQualWitnesses({ podBase, now: NOW });
      const { capturedEncoding } = await import("@lending/seeds");
      const { provePreQualification } = await import("@lending/vc-kit");
      await expect(
        provePreQualification({
          // An attacker claims $2,000/mo (below the $2,200 threshold) but
          // attaches the CAPTURED genuine encoding of $2,200 (a real,
          // non-fabricated value) hoping the circuit does not actually bind
          // the hidden digits to the operand — decision 0012's forgeability
          // gate: the circuit is UNSATISFIABLE, not merely a false verdict.
          netMonthlyIncomeUsd: { value: 2000, operandEnc: capturedEncoding(2200) },
          cashFlowScoreValue: witnesses.cashFlowScoreValue,
          nsf90Count: witnesses.nsf90Count,
          nonce: "unsatisfiable-attempt",
        }),
      ).rejects.toBeInstanceOf(ZkError);
    },
    PROVE_TIMEOUT,
  );
});
