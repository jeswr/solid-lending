// Programmatic capture of the vc-kit ZK seed fixtures (the mortgage
// showcase's capture pattern, trimmed to this round's scope).
//
// Produces, from the sparq NATIVE toolchain:
//   test/fixtures/operand-enc.json            — encode_int_literal term encodings
//   test/fixtures/dual-sign-attestations.json — Schnorr-BJJ dual-sign attestations
//   test/fixtures/PROVENANCE.json             — toolchain + checkout provenance
//
// The Tier-A/B proof captures (compiled circuits, composite manifest) arrive
// with the ZK round — docs/zk-plan.md.
//
// Prereqs: a local jeswr/sparq checkout (SPARQ_CHECKOUT env var) and the Rust
// toolchain (cargo). Run via:
//
//   SPARQ_CHECKOUT=/path/to/sparq pnpm --filter @lending/vc-kit run capture:fixtures
//
// HONESTY: the sparq ZK estate is research-grade and NOT externally audited.
// Nothing here is fabricated — if the native toolchain cannot run, this
// script FAILS; it never fakes an operand_enc.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateKeyPairForSuite, issueCredential } from "../src/index.ts";
import {
  claimGraphToNTriples,
  DEMO_BACKDATED_VALIDITY,
  DEMO_CASH_FLOW_CREDENTIAL_ID,
  DEMO_INCOME_CREDENTIAL_ID,
  DEMO_ISSUER,
  DEMO_ISSUER_SEEDS,
  DEMO_OPERAND_VALUES,
  DEMO_SCORE_CREDENTIAL_ID,
  DEMO_STATUS_LIST_URL,
  DEMO_SUBJECT,
  DEMO_ZK_STATUS,
  demoBankCashFlowClaims,
  demoCashFlowScoreClaims,
  demoEmploymentClaims,
  fixtureIndexBlindingHex,
  fixtureSaltHex,
  SparqSeedHelper,
} from "../src/seed-tooling/index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixturesDir = join(here, "..", "test", "fixtures");

// The sparq car-hire age-gate cross-check vector (site/public/zk
// AGE_OPERAND_ENC[30]) — proves the encoding contract is unchanged. 30 is not
// a lending operand; it is captured solely as the cross-check.
const CAR_HIRE_OPERAND_ENC_30 =
  "0x132fa587351bf3f12fd3cbed64d5526f28791099d1d40870f94595873c78fa72";

async function main() {
  const sparqCheckout = process.env.SPARQ_CHECKOUT;
  if (!sparqCheckout) {
    throw new Error(
      "SPARQ_CHECKOUT is not set — point it at a local jeswr/sparq checkout. " +
        "operand_enc / attestations MUST come from the sparq native toolchain.",
    );
  }
  const helper = new SparqSeedHelper({ sparqCheckout });
  const sparqCommit = await helper.sparqCommit();
  console.log(`[capture-fixtures] sparq checkout at ${sparqCommit}`);

  // ── 1. Issue the ZK-participating demo credentials exactly as the test rig does ──
  const key = await generateKeyPairForSuite(`${DEMO_ISSUER}#key-1`, "Ed25519");
  const issue = (kind, credentialId, claims, statusListIndex) =>
    issueCredential({
      kind,
      credentialId,
      issuer: DEMO_ISSUER,
      subject: DEMO_SUBJECT,
      claims,
      validity: DEMO_BACKDATED_VALIDITY,
      status: {
        statusPurpose: "revocation",
        statusListIndex,
        statusListCredential: DEMO_STATUS_LIST_URL,
      },
      key,
    });
  const employment = await issue(
    "employment-income-credential",
    DEMO_INCOME_CREDENTIAL_ID,
    demoEmploymentClaims(),
    "42",
  );
  const cashFlow = await issue(
    "bank-cashflow-credential",
    DEMO_CASH_FLOW_CREDENTIAL_ID,
    demoBankCashFlowClaims(),
    "7",
  );
  const cashFlowScore = await issue(
    "cashflow-score-credential",
    DEMO_SCORE_CREDENTIAL_ID,
    demoCashFlowScoreClaims(),
    "19",
  );

  // ── 2. One native job: encodings + dual-sign attestations ────────────────────
  const credentialInput = (name, credential, issuerSeed, zkStatus) => ({
    name,
    ntriples: claimGraphToNTriples(credential.claimQuads),
    saltHex: fixtureSaltHex(credential.credentialId),
    issuerSeed,
    status: { ...zkStatus, indexBlindingHex: fixtureIndexBlindingHex(zkStatus) },
  });
  const result = await helper.run({
    encodeInts: [...DEMO_OPERAND_VALUES, 30],
    credentials: [
      credentialInput(
        "employment",
        employment,
        DEMO_ISSUER_SEEDS.incomeVerifier,
        DEMO_ZK_STATUS.employment,
      ),
      credentialInput(
        "cashFlow",
        cashFlow,
        DEMO_ISSUER_SEEDS.bankDataProvider,
        DEMO_ZK_STATUS.cashFlow,
      ),
      credentialInput(
        "cashFlowScore",
        cashFlowScore,
        DEMO_ISSUER_SEEDS.cashFlowScorer,
        DEMO_ZK_STATUS.cashFlowScore,
      ),
    ],
  });

  const enc30 = result.encodings["30"];
  if (enc30 !== CAR_HIRE_OPERAND_ENC_30) {
    throw new Error(
      `encode_int_literal(30) = ${enc30} does not match the sparq site's committed ` +
        `car-hire anchor ${CAR_HIRE_OPERAND_ENC_30} — sparq encoding contract changed; STOP`,
    );
  }
  const encodings = Object.fromEntries(
    DEMO_OPERAND_VALUES.map((value) => [String(value), result.encodings[String(value)]]),
  );
  for (const [value, enc] of Object.entries(encodings)) {
    if (typeof enc !== "string" || !/^0x[0-9a-f]{1,64}$/.test(enc)) {
      throw new Error(`no well-formed encoding for ${value}`);
    }
  }

  // ── 3. Write the fixtures ────────────────────────────────────────────────────
  const capturedAt = new Date().toISOString().slice(0, 10);
  const provenance = {
    generatedBy: "packages/vc-kit/scripts/capture-fixtures.mjs",
    regenerate:
      "SPARQ_CHECKOUT=<sparq checkout> pnpm --filter @lending/vc-kit run capture:fixtures",
    sparqRepository: "https://github.com/jeswr/sparq",
    sparqCommit,
    toolchain: { node: process.version },
    capturedAt,
    note:
      "All values are genuine sparq-native outputs (encode_int_literal, Poseidon2 " +
      "commitments, Schnorr-BJJ signatures). Research-grade; NOT externally audited. " +
      "Attestation fixtures use the PUBLIC-label deterministic salts/blindings " +
      "(fixture mode) — byte-stable for tests, never a production pattern.",
  };
  await mkdir(fixturesDir, { recursive: true });
  await writeFile(
    join(fixturesDir, "operand-enc.json"),
    `${JSON.stringify(
      {
        provenance: { see: "PROVENANCE.json", sparqCommit, capturedAt },
        crossCheck: { 30: enc30 },
        encodings,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(fixturesDir, "dual-sign-attestations.json"),
    `${JSON.stringify(
      {
        provenance: { see: "PROVENANCE.json", sparqCommit, capturedAt },
        attestations: result.attestations,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(fixturesDir, "PROVENANCE.json"), `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(
    `[capture-fixtures] wrote ${Object.keys(encodings).length} encodings + ` +
      `${Object.keys(result.attestations).length} attestations`,
  );
}

await main();
