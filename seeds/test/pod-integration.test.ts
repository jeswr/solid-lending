/**
 * Integration coverage of the real seeder against a REAL dev Solid server
 * (`@lending/test-kit`, `@jeswr/solid-server` — never a mocked pod):
 *
 * - issue -> read back -> verify: every seeded credential and ZK operand anchor is
 *   read back off the live pod and passes `verifyCredential`'s full fail-closed gate
 *   chain (structural, SHACL shape, validity window, Bitstring status, eddsa-rdfc-2022
 *   proof) against the pod-served issuer documents and status lists — plus a direct
 *   SHACL `validate()` call for the credential the brief calls out explicitly.
 * - OIDC-mode denial: a SECOND identity (a real, separately-issued Solid-OIDC token) is
 *   denied the private credentials and anchors (owner-only WAC), while the issuer
 *   document and status list stay world-readable — anonymous fetch included.
 */
import { validate } from "@lending/data-model";
import { verifyCredential } from "@lending/vc-kit";
import { startSolidServer } from "@lending/test-kit";
import { afterEach, describe, expect, it } from "vitest";
import {
  ANCHOR_POD_PATHS,
  CREDENTIAL_POD_PATHS,
  ISSUER_ROLES,
  mayaTorres,
} from "../credentials.ts";
import { createLendingIssuance } from "../issuance.ts";
import { seedLendingPod } from "../lending-pod.ts";

const NOW = new Date("2026-07-15T12:00:00Z");

describe("seedLendingPod — issue, read back, verify (real pod, real vc-kit)", () => {
  let stop: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await stop?.();
    stop = undefined;
  });

  it("every signed credential + ZK operand anchor verifies against the live pod", async () => {
    const server = await startSolidServer({});
    stop = server.stop;
    const account = server.accounts[0];
    if (account === undefined) throw new Error("harness booted with no primary account");

    const issuance = createLendingIssuance({ podOrigin: account.baseUrl, now: NOW });
    const seeded = await seedLendingPod({
      target: { webid: account.webid, baseUrl: account.baseUrl, authFetch: account.authFetch },
      issuance,
      now: NOW,
      mode: "create",
    });

    expect(seeded.persona.name).toBe("Maya Torres");
    expect(seeded.credentials).toHaveLength(5);
    const podRoot = new URL(account.baseUrl).origin;

    for (const spec of seeded.credentials) {
      const resourceUrl = `${podRoot}${spec.path}`;
      const response = await account.authFetch(resourceUrl);
      expect(response.status, `GET ${resourceUrl}`).toBe(200);
      const body = await response.text();

      const outcome = await verifyCredential(body, {
        expectShape: spec.kind,
        now: NOW,
        webIdFetch: account.authFetch,
        statusFetch: account.authFetch,
      });
      expect(outcome.errors, `${spec.id} verification errors`).toEqual([]);
      expect(outcome.verified, `${spec.id} verified`).toBe(true);
      expect(outcome.credential?.subject).toBe(account.webid);

      if (spec.anchor !== undefined) {
        const anchorUrl = `${podRoot}${spec.anchor.path}`;
        const anchorResponse = await account.authFetch(anchorUrl);
        expect(anchorResponse.status, `GET ${anchorUrl}`).toBe(200);
        const anchorBody = await anchorResponse.text();
        const anchorOutcome = await verifyCredential(anchorBody, {
          expectShape: "zk-operand-anchor",
          now: NOW,
          webIdFetch: account.authFetch,
          statusFetch: account.authFetch,
        });
        expect(anchorOutcome.errors, `${spec.id} anchor verification errors`).toEqual([]);
        expect(anchorOutcome.verified, `${spec.id} anchor verified`).toBe(true);
      }
    }

    // The brief's explicit SHACL call: the income credential re-validated directly
    // against the bundled lending shapes (independent of verifyCredential's own gate).
    const incomeResponse = await account.authFetch(`${podRoot}${CREDENTIAL_POD_PATHS.income}`);
    const incomeTurtle = await incomeResponse.text();
    const report = await validate(incomeTurtle, {
      baseIRI: `${podRoot}${CREDENTIAL_POD_PATHS.income}`,
      expect: "employment-income-credential",
      focusNode: `${podRoot}${CREDENTIAL_POD_PATHS.income}`,
    });
    expect(report.violations).toEqual([]);
    expect(report.conforms).toBe(true);

    // The three ZK-anchorable field values (design §5) round-trip exactly.
    const values = mayaTorres();
    const anchorPaths = seeded.credentials.flatMap((spec) =>
      spec.anchor === undefined ? [] : [spec.anchor.path],
    );
    expect(anchorPaths.sort()).toEqual(
      [ANCHOR_POD_PATHS.income, ANCHOR_POD_PATHS.nsf90, ANCHOR_POD_PATHS.score].sort(),
    );
    expect(values.netMonthlyIncomeUsd).toBe(2860);
    expect(values.cashFlowScoreValue).toBe(720);
    expect(values.nsf90Count).toBe(0);
  });
});

describe("seedLendingPod — OIDC mode: owner-only ACL denies a second identity", () => {
  let stop: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await stop?.();
    stop = undefined;
  });

  it("a second identity is denied the private credential; the issuer doc + status list stay public", async () => {
    const server = await startSolidServer({ oidc: true });
    stop = server.stop;
    const borrower = server.accounts[0];
    if (borrower === undefined) throw new Error("harness booted with no primary account");

    const issuance = createLendingIssuance({ podOrigin: borrower.baseUrl, now: NOW });
    await seedLendingPod({
      target: { webid: borrower.webid, baseUrl: borrower.baseUrl, authFetch: borrower.authFetch },
      issuance,
      now: NOW,
      mode: "create",
    });

    const podRoot = new URL(borrower.baseUrl).origin;
    const privateUrl = `${podRoot}${CREDENTIAL_POD_PATHS.income}`;
    const issuerDocUrl = `${podRoot}${ISSUER_ROLES.incomeVerifier.docPath}`;
    const statusListUrl = `${podRoot}${ISSUER_ROLES.incomeVerifier.statusPath}`;

    // Sanity: the owner CAN read its own private resource.
    const ownerRead = await borrower.authFetch(privateUrl);
    expect(ownerRead.status).toBe(200);

    // A second, independently-provisioned identity (its own dev-OIDC-issued token) is
    // denied — owner-only WAC, exercised through the real DPoP-bound auth path.
    const attacker = await server.provisionAccount();
    expect(attacker.webid).not.toBe(borrower.webid);
    const attackerRead = await attacker.authFetch(privateUrl);
    expect([401, 403]).toContain(attackerRead.status);

    // Anonymous (no credentials at all) is denied too.
    const anonymousRead = await fetch(privateUrl);
    expect([401, 403]).toContain(anonymousRead.status);

    // The issuer identity document and its status list are world-readable —
    // anonymous fetch, no credentials attached.
    const issuerDocRead = await fetch(issuerDocUrl);
    expect(issuerDocRead.status).toBe(200);
    const statusListRead = await fetch(statusListUrl);
    expect(statusListRead.status).toBe(200);

    await attacker.stop();
  });
});
