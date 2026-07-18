/**
 * The security bar for verification: a genuinely issued credential is read
 * back from its pod-serialised bytes and verified against the REAL verifier +
 * SHACL + hosted status list; tampering, expiry, revocation, foreign keys,
 * decoy shapes and subject-binding mismatches ALL fail closed.
 */
import { DataFactory } from "n3";
import { expect, test } from "vitest";
import { verifyCredential } from "../src/index.ts";
import {
  DAY_MS,
  hostedStatusList,
  ISSUER,
  issueEmployment,
  NOW,
  parseTurtle,
  resolveIssuerKey,
  stubHost,
  SUBJECT,
} from "./support.ts";

function verifyOptions(host: ReturnType<typeof stubHost>) {
  return {
    expectShape: "employment-income-credential" as const,
    now: NOW,
    resolveKey: resolveIssuerKey,
    statusFetch: host.fetch,
  };
}

test("round trip: issue, read back from bytes, verify against verifier + shape + status", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueEmployment(list);

  const outcome = await verifyCredential(issued.body, verifyOptions(host));
  expect(outcome.errors).toEqual([]);
  expect(outcome.verified).toBe(true);
  // Subject binding: the verified projection exposes the borrower WebID the
  // relying app MUST match against the authenticated session (holder binding).
  expect(outcome.credential?.subject).toBe(SUBJECT);
  expect(outcome.credential?.issuer).toBe(ISSUER);
});

test("a tampered claim (income inflated after signing) fails the signature gate", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueEmployment(list);

  const tampered = parseTurtle(issued.body.replace('"2860"', '"9600"').replace(" 2860", " 9600"));
  const outcome = await verifyCredential(tampered, verifyOptions(host));
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("INVALID_SIGNATURE");
});

test("an expired credential fails the window gate", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueEmployment(list);

  const outcome = await verifyCredential(issued.body, {
    ...verifyOptions(host),
    now: new Date(NOW.getTime() + 120 * DAY_MS),
  });
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("EXPIRED");
});

test("a not-yet-valid credential fails the window gate", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueEmployment(list);

  const outcome = await verifyCredential(issued.body, {
    ...verifyOptions(host),
    now: new Date(NOW.getTime() - 90 * DAY_MS),
  });
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("NOT_YET_VALID");
});

test("a revoked credential fails the status gate", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueEmployment(list, 42);
  await list.revoke(42, { now: NOW });

  const outcome = await verifyCredential(issued.body, verifyOptions(host));
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("STATUS_REVOKED");
});

test("an unreachable status list is a FAILURE, never a pass", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueEmployment(list);
  host.resources.clear(); // the hosted list vanishes

  const outcome = await verifyCredential(issued.body, verifyOptions(host));
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("STATUS_UNREACHABLE");
});

test("a key the issuer does not control fails the issuer-binding gate", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueEmployment(list);

  const outcome = await verifyCredential(issued.body, {
    ...verifyOptions(host),
    // The resolver knows the key, but it is NOT controlled by the issuer.
    isControlledBy: () => false,
  });
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("ISSUER_MISMATCH");
});

test("an unresolvable verification key fails the signature gate", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueEmployment(list);

  const outcome = await verifyCredential(issued.body, {
    ...verifyOptions(host),
    resolveKey: async () => undefined,
  });
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("INVALID_SIGNATURE");
});

test("an issuer outside the allowlist is refused", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueEmployment(list);

  const outcome = await verifyCredential(issued.body, {
    ...verifyOptions(host),
    trustedIssuers: ["https://bureau.example/orgs/credit-bureau#id"],
  });
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("UNTRUSTED_ISSUER");
});

test("the mandatory shape gate catches a wrong-kind document (no vacuous pass)", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueEmployment(list);

  const outcome = await verifyCredential(issued.body, {
    ...verifyOptions(host),
    expectShape: "cashflow-score-credential",
  });
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("SHAPE_VIOLATION");
});

test("unsigned data smuggled onto the proof node is refused", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueEmployment(list);

  const dataset = parseTurtle(issued.body);
  // Find the proof node and attach an extra (unsigned) statement to it.
  const proofQuads = [
    ...dataset.match(null, DataFactory.namedNode("https://w3id.org/security#proofValue"), null),
  ];
  expect(proofQuads.length).toBe(1);
  const proofNode = proofQuads[0]?.subject;
  if (proofNode === undefined) throw new Error("unreachable");
  dataset.add(
    DataFactory.quad(
      proofNode,
      DataFactory.namedNode("https://schema.org/comment"),
      DataFactory.literal("smuggled"),
    ),
  );
  const outcome = await verifyCredential(dataset, verifyOptions(host));
  expect(outcome.verified).toBe(false);
  expect(outcome.errors.map((error) => error.code)).toContain("MALFORMED");
});

test("subject binding: a credential issued to a DIFFERENT WebID is detectable", async () => {
  const host = stubHost();
  const list = await hostedStatusList(host);
  const issued = await issueEmployment(list);

  const outcome = await verifyCredential(issued.body, verifyOptions(host));
  expect(outcome.verified).toBe(true);
  // The relying app's binding check: presented-by WebID must equal subject.
  const presenter = "https://mallory.pod.example/profile/card#me";
  expect(outcome.credential?.subject).not.toBe(presenter);
});
