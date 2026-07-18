/**
 * Issuance gates: every §6.2 credential kind issues as a REAL
 * eddsa-rdfc-2022-signed document; the SHACL shape gate refuses invalid
 * claims BEFORE any signature exists; structural guards refuse IRI injection
 * and mismatched kinds.
 */
import { expect, test } from "vitest";
import {
  ClaimInputError,
  type CredentialClaims,
  type CredentialKind,
  credentialSchemaIri,
  IssueRefusedError,
  issueCredential,
} from "../src/index.ts";
import {
  BACKDATED_VALIDITY,
  bankCashFlowClaims,
  cashFlowScoreClaims,
  creditScoreClaims,
  disbursementClaims,
  employmentClaims,
  hostedStatusList,
  identityClaims,
  ISSUER,
  issuerKey,
  loanOfferClaims,
  parseTurtle,
  repaymentClaims,
  anchorClaims,
  stubHost,
  SUBJECT,
} from "./support.ts";

const ALL_KINDS: readonly [CredentialKind, () => CredentialClaims][] = [
  ["identity-credential", identityClaims],
  ["employment-income-credential", employmentClaims],
  ["bank-cashflow-credential", bankCashFlowClaims],
  ["cashflow-score-credential", cashFlowScoreClaims],
  ["credit-score-credential", creditScoreClaims],
  ["loan-offer-credential", loanOfferClaims],
  ["disbursement-receipt-credential", disbursementClaims],
  ["repayment-history-credential", repaymentClaims],
  ["zk-operand-anchor", anchorClaims],
];

test("every credential kind issues a signed, schema-tagged Turtle document", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  for (const [kind, claims] of ALL_KINDS) {
    const issued = await issueCredential({
      kind,
      credentialId: `https://maya.pod.example/lending/test/${kind}`,
      issuer: ISSUER,
      subject: SUBJECT,
      claims: claims(),
      validity: BACKDATED_VALIDITY,
      status: list.entry(7),
      key: await issuerKey(),
    });
    expect(issued.kind).toBe(kind);
    expect(issued.contentType).toBe("text/turtle");
    // The proof exists and covers a strict subset of the document.
    expect(issued.proof.cryptosuite).toBe("eddsa-rdfc-2022");
    expect(issued.proof.proofValue.length).toBeGreaterThan(0);
    expect(issued.quads.length).toBeGreaterThan(issued.claimQuads.length);
    // The document parses and carries the credentialSchema tag for its kind.
    const parsed = parseTurtle(issued.body);
    expect(parsed.size).toBe(issued.quads.length);
    expect(issued.body).toContain(credentialSchemaIri(kind));
  }
});

test("claims.kind must match the requested kind (no cross-kind signing)", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  await expect(
    issueCredential({
      kind: "employment-income-credential",
      credentialId: "https://maya.pod.example/lending/test/mismatch",
      issuer: ISSUER,
      subject: SUBJECT,
      claims: creditScoreClaims(),
      validity: BACKDATED_VALIDITY,
      status: list.entry(7),
      key: await issuerKey(),
    }),
  ).rejects.toThrow(ClaimInputError);
});

test("the shape gate refuses an over-budget hidden value BEFORE signing", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  await expect(
    issueCredential({
      kind: "employment-income-credential",
      credentialId: "https://maya.pod.example/lending/test/over-budget",
      issuer: ISSUER,
      subject: SUBJECT,
      claims: employmentClaims({ netMonthlyIncomeUsd: 10_000 }),
      validity: BACKDATED_VALIDITY,
      status: list.entry(7),
      key: await issuerKey(),
    }),
  ).rejects.toThrow(IssueRefusedError);
});

test("the shape gate refuses broken Reg Z disclosure arithmetic", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  await expect(
    issueCredential({
      kind: "loan-offer-credential",
      credentialId: "https://maya.pod.example/lending/test/bad-offer",
      issuer: ISSUER,
      subject: SUBJECT,
      // Understates the cost of credit: total != payments x amount.
      claims: loanOfferClaims({ totalOfPaymentsUsd: 2400, financeChargeUsd: 400 }),
      validity: BACKDATED_VALIDITY,
      status: list.entry(7),
      key: await issuerKey(),
    }),
  ).rejects.toThrow(IssueRefusedError);
});

test("credentials whose shapes require a status entry refuse to issue without one", async () => {
  await expect(
    issueCredential({
      kind: "employment-income-credential",
      credentialId: "https://maya.pod.example/lending/test/no-status",
      issuer: ISSUER,
      subject: SUBJECT,
      claims: employmentClaims(),
      validity: BACKDATED_VALIDITY,
      key: await issuerKey(),
    }),
  ).rejects.toThrow(IssueRefusedError);
});

test("credentials whose shapes require validUntil refuse an open-ended window", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  await expect(
    issueCredential({
      kind: "employment-income-credential",
      credentialId: "https://maya.pod.example/lending/test/no-until",
      issuer: ISSUER,
      subject: SUBJECT,
      claims: employmentClaims(),
      validity: { validFrom: BACKDATED_VALIDITY.validFrom },
      status: list.entry(7),
      key: await issuerKey(),
    }),
  ).rejects.toThrow(IssueRefusedError);
});

test("IRI injection is refused at the door", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  await expect(
    issueCredential({
      kind: "employment-income-credential",
      credentialId: "https://maya.pod.example/lending/x> <urn:x:y> <urn:x:z> . #",
      issuer: ISSUER,
      subject: SUBJECT,
      claims: employmentClaims(),
      validity: BACKDATED_VALIDITY,
      status: list.entry(7),
      key: await issuerKey(),
    }),
  ).rejects.toThrow(ClaimInputError);
});

test("the anchor kind refuses non-anchorable fields at the shape gate", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  await expect(
    issueCredential({
      kind: "zk-operand-anchor",
      credentialId: "https://maya.pod.example/lending/test/bad-anchor",
      issuer: ISSUER,
      subject: SUBJECT,
      // The bureau score is deliberately NOT ZK-anchorable in this demo.
      claims: anchorClaims({ field: "urn:example:lend#creditScoreValue" }),
      validity: BACKDATED_VALIDITY,
      status: list.entry(7),
      key: await issuerKey(),
    }),
  ).rejects.toThrow(IssueRefusedError);
});
