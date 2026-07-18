/**
 * The demo's full pre-qualification conjunction (design §6.2 scene 2):
 * `income >= 2200 ∧ cash-flow score >= 660 ∧ NSF₉₀ = 0`, proved as three
 * GENUINE Tier A proofs sharing ONE lender-minted nonce, verified as three
 * gate-runs sharing ONE nonce burn. SECURITY-CRITICAL: the shared-nonce
 * semantics get their own coverage here (a lender must not be able to be
 * tricked into burning the nonce three times, and a single bad leg must sink
 * the whole presentation).
 */

import { LEND } from "@lending/data-model";
import { beforeAll, describe, expect, it } from "vitest";
import type { PreQualificationProof } from "../src/index.ts";
import { issueCredential, proveTierA, verifyPreQualification } from "../src/index.ts";
import { ISSUER, issuerKey, NOW, resolveIssuerKey, stubHost, SUBJECT } from "./support.ts";
import {
  anchorTrio,
  encOf,
  NONCE_PREQUAL,
  oneShotNonce,
  prequalificationProof,
  SCORE_STATEMENT,
} from "./zk-support.ts";

const PROVE_TIMEOUT = 180_000;
const SESSION = "prequal-session-1";

let host: ReturnType<typeof stubHost>;
let anchors: Awaited<ReturnType<typeof anchorTrio>>;
let bundle: PreQualificationProof;

beforeAll(async () => {
  host = stubHost();
  anchors = await anchorTrio(host); // also creates + hosts the shared status list
  bundle = await prequalificationProof();
}, PROVE_TIMEOUT);

function baseAnchors() {
  return {
    netMonthlyIncomeUsd: anchors.netMonthlyIncomeUsd.body,
    cashFlowScoreValue: anchors.cashFlowScoreValue.body,
    nsf90Count: anchors.nsf90Count.body,
  };
}

function baseVerifyOptions(overrides: {
  nonces: { consume(sessionKey: string, nonce: string): boolean };
}) {
  return {
    anchors: baseAnchors(),
    webid: SUBJECT,
    nonce: NONCE_PREQUAL,
    sessionKey: SESSION,
    now: NOW,
    trustedIssuers: [ISSUER],
    resolveKey: resolveIssuerKey,
    statusFetch: host.fetch,
    ...overrides,
  };
}

describe("verifyPreQualification - acceptance", () => {
  it("accepts a genuine three-field bundle bound to the shared nonce, against all three anchors", async () => {
    const result = await verifyPreQualification(
      bundle,
      baseVerifyOptions({ nonces: oneShotNonce(SESSION, NONCE_PREQUAL) }),
    );
    expect(result.verified).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.legs.netMonthlyIncomeUsd.verified).toBe(true);
    expect(result.legs.cashFlowScoreValue.verified).toBe(true);
    expect(result.legs.nsf90Count.verified).toBe(true);
  });
});

describe("verifyPreQualification - shared-nonce semantics", () => {
  it("burns the shared nonce EXACTLY ONCE for the whole bundle, not once per leg", async () => {
    let calls = 0;
    const nonces = {
      consume(sessionKey: string, nonce: string): boolean {
        calls += 1;
        return sessionKey === SESSION && nonce === NONCE_PREQUAL;
      },
    };
    const result = await verifyPreQualification(bundle, baseVerifyOptions({ nonces }));
    expect(result.verified).toBe(true);
    expect(calls).toBe(1);
  });

  it("replaying the identical bundle on the same session rejects (nonce already burned)", async () => {
    const nonces = oneShotNonce(SESSION, NONCE_PREQUAL);
    const options = baseVerifyOptions({ nonces });
    const first = await verifyPreQualification(bundle, options);
    expect(first.verified).toBe(true);
    const replay = await verifyPreQualification(bundle, options);
    expect(replay.verified).toBe(false);
    expect(replay.errors[0]?.code).toBe("NONCE_INVALID");
    // Every leg reports the same nonce rejection - not a per-leg partial state.
    expect(replay.legs.netMonthlyIncomeUsd.errors[0]?.code).toBe("NONCE_INVALID");
    expect(replay.legs.cashFlowScoreValue.errors[0]?.code).toBe("NONCE_INVALID");
    expect(replay.legs.nsf90Count.errors[0]?.code).toBe("NONCE_INVALID");
  });

  it("a structurally malformed leg never touches the nonce store (gates 0-1 precede the shared burn)", async () => {
    const nonces = oneShotNonce(SESSION, NONCE_PREQUAL);
    const malformed: PreQualificationProof = {
      ...bundle,
      cashFlowScoreValue: { ...bundle.cashFlowScoreValue, proof: new Uint8Array(131_073) },
    };
    const rejected = await verifyPreQualification(malformed, baseVerifyOptions({ nonces }));
    expect(rejected.verified).toBe(false);
    expect(rejected.legs.cashFlowScoreValue.errors[0]?.code).toBe("MALFORMED_PROOF");
    // The nonce is still LIVE - the genuine bundle can still be presented.
    const retry = await verifyPreQualification(bundle, baseVerifyOptions({ nonces }));
    expect(retry.verified).toBe(true);
  });
});

describe("verifyPreQualification - one bad leg sinks the whole conjunction", () => {
  it("a genuine income proof beside a WRONG cash-flow-score anchor rejects overall, income leg still verifies alone", async () => {
    const wrongScoreAnchor = anchors.netMonthlyIncomeUsd.body; // income field, not score
    const result = await verifyPreQualification(
      bundle,
      baseVerifyOptions({ nonces: oneShotNonce(SESSION, NONCE_PREQUAL) }),
    );
    expect(result.verified).toBe(true); // sanity: the untouched bundle verifies

    const tampered = await verifyPreQualification(bundle, {
      ...baseVerifyOptions({ nonces: oneShotNonce(SESSION, NONCE_PREQUAL) }),
      anchors: { ...baseAnchors(), cashFlowScoreValue: wrongScoreAnchor },
    });
    expect(tampered.verified).toBe(false);
    expect(tampered.legs.netMonthlyIncomeUsd.verified).toBe(true);
    expect(tampered.legs.cashFlowScoreValue.verified).toBe(false);
    expect(tampered.legs.cashFlowScoreValue.errors[0]?.code).toBe("ANCHOR_FIELD_MISMATCH");
  });

  it(
    "FORGEABILITY: a genuine anchor for the real (too-low) score beside a proof of a self-minted higher score rejects, even beside two genuine legs",
    async () => {
      // The borrower's real score is 500 (< 660, but within the field's own
      // [300, 850] budget); a genuine anchor exists for it. They forge a
      // proof of `850 >= 660` (self-minted encoding of a value no issuer
      // ever attested for THEM) but the anchor still only attests 500 - the
      // operand-binding gate must catch this even though the OTHER two legs
      // of the bundle (income, NSF) are entirely genuine.
      const forgedScoreProof = await proveTierA({
        statement: SCORE_STATEMENT,
        value: 850,
        operandEnc: encOf(850),
        nonce: NONCE_PREQUAL,
      });
      const forgedBundle: PreQualificationProof = {
        ...bundle,
        cashFlowScoreValue: forgedScoreProof,
      };

      const genuineLowScoreAnchor = await issueCredential({
        kind: "zk-operand-anchor",
        credentialId: "https://maya.pod.example/lending/credentials/low-score-anchor",
        issuer: ISSUER,
        subject: SUBJECT,
        claims: {
          kind: "zk-operand-anchor",
          field: LEND.cashFlowScoreValue,
          operandEnc: encOf(500),
        },
        validity: {
          validFrom: new Date(NOW.getTime() - 1000),
          validUntil: new Date(NOW.getTime() + 1000),
        },
        status: anchors.list.entry(41),
        key: await issuerKey(),
      });

      const result = await verifyPreQualification(forgedBundle, {
        ...baseVerifyOptions({ nonces: oneShotNonce(SESSION, NONCE_PREQUAL) }),
        anchors: { ...baseAnchors(), cashFlowScoreValue: genuineLowScoreAnchor.body },
      });
      expect(result.verified).toBe(false);
      expect(result.legs.netMonthlyIncomeUsd.verified).toBe(true);
      expect(result.legs.nsf90Count.verified).toBe(true);
      expect(result.legs.cashFlowScoreValue.verified).toBe(false);
      expect(result.legs.cashFlowScoreValue.errors[0]?.code).toBe("ANCHOR_OPERAND_MISMATCH");
    },
    PROVE_TIMEOUT,
  );
});
