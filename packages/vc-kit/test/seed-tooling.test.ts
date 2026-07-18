/**
 * Unit coverage of the seed-tooling plumbing over an INJECTED native bridge
 * (the real helper needs cargo + a local sparq checkout — see
 * seed-tooling-native.test.ts and `capture:fixtures`). The operand
 * encodings this suite asserts against are the GENUINE captured
 * `encode_int_literal` outputs in fixtures/operand-enc.json (see
 * fixtures/PROVENANCE.json for the sparq checkout commit) — never fabricated
 * — covering the three §6.2 ZK-anchorable fields this round mints anchors
 * for: net monthly income (2860), cash-flow score (720) and NSF₉₀ (0).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEND } from "@lending/data-model";
import { describe, expect, it } from "vitest";
import { verifyCredential } from "../src/index.ts";
import type {
  SeedWitnessDocument,
  SparqAttestation,
  SparqNativeBridge,
  SparqSeedJob,
  SparqSeedResult,
} from "../src/seed-tooling/index.ts";
import {
  claimGraphToNTriples,
  DEMO_CASH_FLOW_CREDENTIAL_ID,
  DEMO_SCORE_CREDENTIAL_ID,
  DEMO_ZK_STATUS,
  deriveFieldHex,
  fixtureIndexBlindingHex,
  fixtureSaltHex,
  mintOperandAnchors,
  readHiddenFieldValues,
  SeedToolingError,
  SparqCredentialSeedPipeline,
} from "../src/seed-tooling/index.ts";
import {
  BACKDATED_VALIDITY,
  bankCashFlowClaims,
  cashFlowScoreClaims,
  CREDENTIAL_ID,
  employmentClaims,
  hostedStatusList,
  ISSUER,
  issueCredentialAt,
  issueEmployment,
  issuerKey,
  NOW,
  resolveIssuerKey,
  SUBJECT,
  stubHost,
} from "./support.ts";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));

/**
 * PROVENANCE: genuine sparq term encodings of `"<value>"^^xsd:integer` from
 * `sparq_zk_compose::build::encode_int_literal`, captured by
 * `scripts/capture-fixtures.mjs` (see fixtures/PROVENANCE.json for the
 * checkout commit + toolchain). Production issuance computes these live
 * against the real toolchain (seed-tooling-native.test.ts); this fixture
 * lets the plumbing suite assert against REAL values without paying for a
 * cargo build per test run.
 */
const OPERAND_ENC = (fixture("operand-enc.json") as { encodings: Record<string, string> })
  .encodings;
function encOf(value: number): string {
  const enc = OPERAND_ENC[String(value)];
  if (enc === undefined) throw new Error(`no captured operand_enc fixture for ${value}`);
  return enc;
}

/** A canned bridge: real captured encodings; one canned attestation reused
 * for any credential name (attestation *content* correctness — as opposed
 * to plumbing — is exercised by the gated native integration test). */
function stubBridge(): { bridge: SparqNativeBridge; jobs: SparqSeedJob[] } {
  const attestation = (
    fixture("dual-sign-attestations.json") as {
      attestations: Record<string, SparqAttestation>;
    }
  ).attestations.employment;
  if (attestation === undefined) throw new Error("no canned employment attestation fixture");
  const jobs: SparqSeedJob[] = [];
  const bridge: SparqNativeBridge = {
    run(job: SparqSeedJob): Promise<SparqSeedResult> {
      jobs.push(job);
      const attestations: Record<string, SparqAttestation> = {};
      for (const credential of job.credentials ?? []) {
        attestations[credential.name] = attestation;
      }
      return Promise.resolve({
        encodings: Object.fromEntries(
          (job.encodeInts ?? []).map((value) => [String(value), encOf(value)]),
        ),
        attestations,
      });
    },
  };
  return { bridge, jobs };
}

describe("readHiddenFieldValues", () => {
  it("reads the exact wrapper-emitted integer literal (income, 2860)", async () => {
    const host = stubHost();
    const list = await hostedStatusList(host);
    const credential = await issueEmployment(list);
    const values = readHiddenFieldValues(credential, [LEND.netMonthlyIncomeUsd], SUBJECT);
    expect(values.get(LEND.netMonthlyIncomeUsd)).toBe(2860);
  });

  it("rejects fields outside the digit-budget table (design §4 rule 5)", async () => {
    const host = stubHost();
    const list = await hostedStatusList(host);
    const credential = await issueEmployment(list);
    // The bureau score is deliberately NOT ZK-anchorable in this demo.
    expect(() => readHiddenFieldValues(credential, [LEND.creditScoreValue], SUBJECT)).toThrow(
      SeedToolingError,
    );
  });

  it("rejects a subject with no such claim (fail-closed cardinality)", async () => {
    const host = stubHost();
    const list = await hostedStatusList(host);
    const credential = await issueEmployment(list);
    expect(() =>
      readHiddenFieldValues(
        credential,
        [LEND.netMonthlyIncomeUsd],
        "https://mallory.pod.example/profile/card#me",
      ),
    ).toThrow(/exactly one value/);
  });
});

describe("mintOperandAnchors — the three §6.2 ZK-anchorable fields", () => {
  it("mints an issuer-signed, SHACL-gated income anchor (netMonthlyIncomeUsd)", async () => {
    const host = stubHost();
    const list = await hostedStatusList(host);
    const credential = await issueEmployment(list);
    const { bridge } = stubBridge();
    const anchors = await mintOperandAnchors({
      credential,
      hiddenFields: [LEND.netMonthlyIncomeUsd],
      subject: SUBJECT,
      issuer: ISSUER,
      anchorIdFor: (field) => `${CREDENTIAL_ID}-anchor-${field.split("#")[1]}`,
      statusFor: () => list.entry(101),
      validity: BACKDATED_VALIDITY,
      key: await issuerKey(),
      native: bridge,
    });
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0];
    expect(anchor?.field).toBe(LEND.netMonthlyIncomeUsd);
    expect(anchor?.operandEnc).toBe(encOf(2860));
    const outcome = await verifyCredential(anchor?.credential.body ?? "", {
      expectShape: "zk-operand-anchor",
      now: NOW,
      resolveKey: resolveIssuerKey,
      statusFetch: host.fetch,
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.verified).toBe(true);
    expect(outcome.credential?.issuer).toBe(ISSUER);
    expect(outcome.credential?.subject).toBe(SUBJECT);
  });

  it("mints a genuine cash-flow-score anchor (cashFlowScoreValue, 720)", async () => {
    const host = stubHost();
    const list = await hostedStatusList(host);
    const credential = await issueCredentialAt(list, {
      kind: "cashflow-score-credential",
      credentialId: DEMO_SCORE_CREDENTIAL_ID,
      claims: cashFlowScoreClaims(),
      index: 19,
    });
    const { bridge } = stubBridge();
    const anchors = await mintOperandAnchors({
      credential,
      hiddenFields: [LEND.cashFlowScoreValue],
      subject: SUBJECT,
      issuer: ISSUER,
      anchorIdFor: () => `${DEMO_SCORE_CREDENTIAL_ID}-anchor`,
      statusFor: () => list.entry(102),
      validity: BACKDATED_VALIDITY,
      key: await issuerKey(),
      native: bridge,
    });
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.operandEnc).toBe(encOf(720));
    const outcome = await verifyCredential(anchors[0]?.credential.body ?? "", {
      expectShape: "zk-operand-anchor",
      now: NOW,
      resolveKey: resolveIssuerKey,
      statusFetch: host.fetch,
    });
    expect(outcome.verified).toBe(true);
  });

  it("mints a genuine NSF₉₀ anchor (nsf90Count, the equality-to-zero predicate)", async () => {
    const host = stubHost();
    const list = await hostedStatusList(host);
    const credential = await issueCredentialAt(list, {
      kind: "bank-cashflow-credential",
      credentialId: DEMO_CASH_FLOW_CREDENTIAL_ID,
      claims: bankCashFlowClaims(),
      index: 7,
    });
    const { bridge } = stubBridge();
    const anchors = await mintOperandAnchors({
      credential,
      hiddenFields: [LEND.nsf90Count],
      subject: SUBJECT,
      issuer: ISSUER,
      anchorIdFor: () => `${DEMO_CASH_FLOW_CREDENTIAL_ID}-anchor`,
      statusFor: () => list.entry(103),
      validity: BACKDATED_VALIDITY,
      key: await issuerKey(),
      native: bridge,
    });
    expect(anchors).toHaveLength(1);
    // Maya's NSF90 count is 0 — the equality-to-zero predicate this fixture
    // pins (design §6.5).
    expect(anchors[0]?.operandEnc).toBe(encOf(0));
    const outcome = await verifyCredential(anchors[0]?.credential.body ?? "", {
      expectShape: "zk-operand-anchor",
      now: NOW,
      resolveKey: resolveIssuerKey,
      statusFetch: host.fetch,
    });
    expect(outcome.verified).toBe(true);
  });
});

describe("SparqCredentialSeedPipeline.issue (seeder-design section 5.2 seam)", () => {
  async function rig() {
    const host = stubHost();
    const list = await hostedStatusList(host);
    const { bridge, jobs } = stubBridge();
    const pipeline = new SparqCredentialSeedPipeline({
      issuer: ISSUER,
      key: await issuerKey(),
      schnorrIssuerSeed: 5101,
      native: bridge,
    });
    return { host, list, bridge, jobs, pipeline };
  }

  it("ONE call materialises the VC + income anchor + borrower-only witness", async () => {
    const { host, list, pipeline } = await rig();
    const result = await pipeline.issue({
      kind: "employment-income-credential",
      credentialId: CREDENTIAL_ID,
      subjectWebid: SUBJECT,
      claims: employmentClaims(),
      validFrom: BACKDATED_VALIDITY.validFrom,
      validUntil: BACKDATED_VALIDITY.validUntil,
      status: list.entry(42),
      hiddenFields: [LEND.netMonthlyIncomeUsd],
      anchorIdFor: (field) => `${CREDENTIAL_ID}-anchor-${field.split("#")[1]}`,
      anchorStatusFor: () => list.entry(43),
      zkStatus: DEMO_ZK_STATUS.employment,
    });

    const outcome = await verifyCredential(result.vc, {
      expectShape: "employment-income-credential",
      now: NOW,
      resolveKey: resolveIssuerKey,
      statusFetch: host.fetch,
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.verified).toBe(true);
    expect(result.vcContentType).toBe("text/turtle");

    expect(result.anchors).toHaveLength(1);
    const anchor = result.anchors[0];
    expect(anchor?.field).toBe(LEND.netMonthlyIncomeUsd);
    expect(anchor?.operandEnc).toBe(encOf(2860));

    expect(result.witnessContentType).toBe("application/json");
    const witness = JSON.parse(result.witness ?? "{}") as SeedWitnessDocument;
    expect(witness.type).toBe("urn:sparq:zk:SeedWitness");
    expect(witness.attestation.cryptosuite).toBe("https://sparq.dev/ns/zk#poseidon2-schnorr-v1");
    expect(witness.attestation.commitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(witness.witness.zkStatus).toEqual(DEMO_ZK_STATUS.employment);
    expect(witness.witness.zkStatus.index).toBe(42);
    expect(witness.attestation.status.indexCommitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(witness.note).toContain("never publish");
  });

  it("refuses hidden fields without anchor wiring", async () => {
    const { list, pipeline } = await rig();
    await expect(
      pipeline.issue({
        kind: "employment-income-credential",
        credentialId: CREDENTIAL_ID,
        subjectWebid: SUBJECT,
        claims: employmentClaims(),
        validFrom: BACKDATED_VALIDITY.validFrom,
        validUntil: BACKDATED_VALIDITY.validUntil,
        status: list.entry(42),
        hiddenFields: [LEND.netMonthlyIncomeUsd],
        zkStatus: DEMO_ZK_STATUS.employment,
      }),
    ).rejects.toMatchObject({ code: "MISSING_ANCHOR_WIRING" });
  });

  it("refuses anchors without a dual-sign zkStatus (decision 0004)", async () => {
    const { list, pipeline } = await rig();
    await expect(
      pipeline.issue({
        kind: "employment-income-credential",
        credentialId: CREDENTIAL_ID,
        subjectWebid: SUBJECT,
        claims: employmentClaims(),
        validFrom: BACKDATED_VALIDITY.validFrom,
        validUntil: BACKDATED_VALIDITY.validUntil,
        status: list.entry(42),
        hiddenFields: [LEND.netMonthlyIncomeUsd],
        anchorIdFor: () => `${CREDENTIAL_ID}-anchor`,
        anchorStatusFor: () => list.entry(43),
      }),
    ).rejects.toMatchObject({ code: "MISSING_ZK_STATUS" });
  });

  it("uses fresh OS entropy for salts/blindings by DEFAULT (roborev 5557)", async () => {
    const { list, jobs, pipeline } = await rig();
    const input = () => ({
      kind: "employment-income-credential" as const,
      credentialId: CREDENTIAL_ID,
      subjectWebid: SUBJECT,
      claims: employmentClaims(),
      validFrom: BACKDATED_VALIDITY.validFrom,
      validUntil: BACKDATED_VALIDITY.validUntil,
      status: list.entry(42),
      zkStatus: DEMO_ZK_STATUS.employment,
    });
    await pipeline.issue(input());
    await pipeline.issue(input());
    const sent = jobs
      .filter((job) => (job.credentials ?? []).length > 0)
      .map((job) => job.credentials?.[0]);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.saltHex).not.toBe(sent[1]?.saltHex);
    expect(sent[0]?.status.indexBlindingHex).not.toBe(sent[1]?.status.indexBlindingHex);
    expect(sent[0]?.saltHex).not.toBe(fixtureSaltHex(CREDENTIAL_ID));
    expect(sent[0]?.status.indexBlindingHex).not.toBe(
      fixtureIndexBlindingHex(DEMO_ZK_STATUS.employment),
    );
  });

  it("deterministicFixtureMode is the EXPLICIT opt-in for byte-stable captures", async () => {
    const host = stubHost();
    const list = await hostedStatusList(host);
    const { bridge, jobs } = stubBridge();
    const pipeline = new SparqCredentialSeedPipeline({
      issuer: ISSUER,
      key: await issuerKey(),
      schnorrIssuerSeed: 5101,
      native: bridge,
      deterministicFixtureMode: true,
    });
    await pipeline.issue({
      kind: "employment-income-credential",
      credentialId: CREDENTIAL_ID,
      subjectWebid: SUBJECT,
      claims: employmentClaims(),
      validFrom: BACKDATED_VALIDITY.validFrom,
      validUntil: BACKDATED_VALIDITY.validUntil,
      status: list.entry(42),
      zkStatus: DEMO_ZK_STATUS.employment,
    });
    const sent = jobs.find((job) => (job.credentials ?? []).length > 0)?.credentials?.[0];
    expect(sent?.saltHex).toBe(fixtureSaltHex(CREDENTIAL_ID));
    expect(sent?.status.indexBlindingHex).toBe(fixtureIndexBlindingHex(DEMO_ZK_STATUS.employment));
  });

  it("rejects an invalid Schnorr seed at CONSTRUCTION (roborev 5560/5564)", async () => {
    const { bridge, jobs } = stubBridge();
    for (const bad of [-1, 1.5, Number.NaN, 1e100, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        () =>
          new SparqCredentialSeedPipeline({
            issuer: ISSUER,
            key: undefined as unknown as Awaited<ReturnType<typeof issuerKey>>,
            schnorrIssuerSeed: bad,
            native: bridge,
          }),
      ).toThrow(SeedToolingError);
    }
    expect(jobs).toHaveLength(0);
  });

  it("snapshots its configuration - post-construction mutation is inert", async () => {
    const host = stubHost();
    const list = await hostedStatusList(host);
    const { bridge, jobs } = stubBridge();
    const mutable = {
      issuer: ISSUER,
      key: await issuerKey(),
      schnorrIssuerSeed: 5101,
      native: bridge,
    };
    const pipeline = new SparqCredentialSeedPipeline(mutable);
    mutable.schnorrIssuerSeed = -999;
    await pipeline.issue({
      kind: "employment-income-credential",
      credentialId: CREDENTIAL_ID,
      subjectWebid: SUBJECT,
      claims: employmentClaims(),
      validFrom: BACKDATED_VALIDITY.validFrom,
      validUntil: BACKDATED_VALIDITY.validUntil,
      status: list.entry(42),
      zkStatus: DEMO_ZK_STATUS.employment,
    });
    const sent = jobs.find((job) => (job.credentials ?? []).length > 0)?.credentials?.[0];
    expect(sent?.issuerSeed).toBe(5101);
  });

  it("a two-faced seed getter cannot bypass construction validation (roborev 5568)", async () => {
    const host = stubHost();
    const list = await hostedStatusList(host);
    const { bridge, jobs } = stubBridge();
    let reads = 0;
    const twoFaced = {
      issuer: ISSUER,
      key: await issuerKey(),
      native: bridge,
      get schnorrIssuerSeed(): number {
        reads += 1;
        return reads === 1 ? 5101 : -1;
      },
    };
    const pipeline = new SparqCredentialSeedPipeline(twoFaced);
    await pipeline.issue({
      kind: "employment-income-credential",
      credentialId: CREDENTIAL_ID,
      subjectWebid: SUBJECT,
      claims: employmentClaims(),
      validFrom: BACKDATED_VALIDITY.validFrom,
      validUntil: BACKDATED_VALIDITY.validUntil,
      status: list.entry(42),
      zkStatus: DEMO_ZK_STATUS.employment,
    });
    const sent = jobs.find((job) => (job.credentials ?? []).length > 0)?.credentials?.[0];
    expect(sent?.issuerSeed).toBe(5101);
    let firstRead = true;
    expect(
      () =>
        new SparqCredentialSeedPipeline({
          issuer: ISSUER,
          key: undefined as unknown as Awaited<ReturnType<typeof issuerKey>>,
          native: bridge,
          get schnorrIssuerSeed(): number {
            const value = firstRead ? -1 : 5101;
            firstRead = false;
            return value;
          },
        }),
    ).toThrow(SeedToolingError);
  });

  it("rejects a half-configured call BEFORE issuing or signing anything", async () => {
    const { jobs, pipeline } = await rig();
    let statusCallbackHits = 0;
    await expect(
      pipeline.issue({
        kind: "employment-income-credential",
        credentialId: CREDENTIAL_ID,
        subjectWebid: SUBJECT,
        claims: employmentClaims(),
        validFrom: BACKDATED_VALIDITY.validFrom,
        validUntil: BACKDATED_VALIDITY.validUntil,
        hiddenFields: [LEND.netMonthlyIncomeUsd],
        anchorIdFor: () => `${CREDENTIAL_ID}-anchor`,
        anchorStatusFor: () => {
          statusCallbackHits += 1;
          throw new Error("must not be invoked on a rejected call");
        },
      }),
    ).rejects.toMatchObject({ code: "MISSING_ZK_STATUS" });
    expect(statusCallbackHits).toBe(0);
    expect(jobs).toHaveLength(0);
  });

  it("sends the claim graph to the native bridge as parseable N-Triples", async () => {
    const { list, jobs, pipeline } = await rig();
    await pipeline.issue({
      kind: "employment-income-credential",
      credentialId: CREDENTIAL_ID,
      subjectWebid: SUBJECT,
      claims: employmentClaims(),
      validFrom: BACKDATED_VALIDITY.validFrom,
      validUntil: BACKDATED_VALIDITY.validUntil,
      status: list.entry(42),
      zkStatus: DEMO_ZK_STATUS.employment,
    });
    const dualSignJob = jobs.find((job) => (job.credentials ?? []).length > 0);
    const ntriples = dualSignJob?.credentials?.[0]?.ntriples ?? "";
    expect(ntriples).toContain(`<${CREDENTIAL_ID}>`);
    expect(ntriples).toContain('"2860"^^<http://www.w3.org/2001/XMLSchema#integer>');
    for (const line of ntriples.split("\n").filter((entry) => entry.trim().length > 0)) {
      expect(line.endsWith(" .")).toBe(true);
    }
  });
});

describe("claimGraphToNTriples + deriveFieldHex", () => {
  it("rejects an empty claim graph", () => {
    expect(() => claimGraphToNTriples([])).toThrow(/empty claim graph/);
  });

  it("derives deterministic, field-shaped fixture values", () => {
    const first = deriveFieldHex("sm-qz3j.2 test label");
    expect(first).toMatch(/^0x[0-9a-f]{64}$/);
    expect(deriveFieldHex("sm-qz3j.2 test label")).toBe(first);
    expect(deriveFieldHex("another label")).not.toBe(first);
    expect(BigInt(first) < 2n ** 248n).toBe(true);
  });
});
