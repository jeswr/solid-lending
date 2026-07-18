/**
 * The pinned flow table: every flow signs claims matching its own kind
 * (never a cross-kind mismatch that `issueCredential` would refuse), every
 * anchored field fits its ZK digit budget and has a CAPTURED operand
 * encoding (never fabricated), and every flow's pod path is unique.
 */
import { fitsZkBudget } from "@lending/data-model";
import { expect, test } from "vitest";
import { ISSUER_FLOW_IDS } from "../lib/server/config";
import { capturedEncodingFor, ISSUER_FLOWS } from "../lib/server/flows";

const PLACEHOLDER_POD_BASE = "https://borrower.pod.example/";

test("every flow's claims.kind matches its own kind", () => {
  for (const id of ISSUER_FLOW_IDS) {
    const definition = ISSUER_FLOWS[id];
    const claims = definition.claims(PLACEHOLDER_POD_BASE);
    expect(claims.kind).toBe(definition.kind);
  }
});

test("every anchored field fits its ZK digit budget and has a captured encoding", () => {
  const anchored = ISSUER_FLOW_IDS.filter((id) => ISSUER_FLOWS[id].anchor !== undefined);
  expect(anchored).toEqual(["income", "cashflow", "score"]);
  for (const id of anchored) {
    const definition = ISSUER_FLOWS[id];
    expect(definition.anchor).toBeDefined();
    expect(definition.anchorValue).toBeDefined();
    expect(fitsZkBudget(definition.anchor?.field as string, definition.anchorValue as number)).toBe(
      true,
    );
    // Throws (never fabricates) if the value was never captured.
    expect(() => capturedEncodingFor(definition)).not.toThrow();
    expect(capturedEncodingFor(definition)).toMatch(/^0x[0-9a-f]+$/);
  }
});

test("the identity flow has no ZK anchor (not a ZK-provable field)", () => {
  expect(ISSUER_FLOWS.identity.anchor).toBeUndefined();
  expect(ISSUER_FLOWS.identity.anchorValue).toBeUndefined();
});

test("the score flow's derivedFrom points at the caller's bank cash-flow credential", () => {
  const claims = ISSUER_FLOWS.score.claims(PLACEHOLDER_POD_BASE);
  if (claims.kind !== "cashflow-score-credential") throw new Error("unreachable");
  expect(claims.derivedFrom).toBe(
    `${PLACEHOLDER_POD_BASE}${ISSUER_FLOWS.cashflow.credentialPath.slice(1)}`,
  );
});

test("every flow's credential pod path is unique", () => {
  const paths = ISSUER_FLOW_IDS.map((id) => ISSUER_FLOWS[id].credentialPath);
  expect(new Set(paths).size).toBe(paths.length);
});

test("every anchor's pod path is unique and distinct from every credential path", () => {
  const anchorPaths = ISSUER_FLOW_IDS.flatMap((id) => {
    const anchor = ISSUER_FLOWS[id].anchor;
    return anchor === undefined ? [] : [anchor.path];
  });
  const credentialPaths = ISSUER_FLOW_IDS.map((id) => ISSUER_FLOWS[id].credentialPath);
  expect(new Set(anchorPaths).size).toBe(anchorPaths.length);
  for (const path of anchorPaths) expect(credentialPaths).not.toContain(path);
});
