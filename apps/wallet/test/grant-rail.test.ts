/**
 * SECURITY-CRITICAL: the vault's Mode-2 grant/revoke rail (design §6.1/§6.2),
 * driven end-to-end against REAL fixtures — a real DPoP-bound Solid-OIDC
 * caller session (`./support/caller-issuer.ts`, the SAME pattern the sibling
 * `verifications` app's test suite uses), a REAL WAC-enforcing
 * `@jeswr/solid-server` pod seeded with genuinely signed lending credentials
 * (`@lending/seeds`), the route handlers reached over an ACTUAL HTTP round
 * trip (`./support/fetch-server.ts`) so every credential is transmitted, not
 * hand-assembled. NOTHING here mocks authentication, the pim:storage
 * binding, or WAC enforcement.
 *
 * Two DIFFERENT real Solid-OIDC identities are in play, deliberately:
 *   - `caller`/`unbound` — the BORROWER's session, verified by
 *     `@jeswr/solid-pod-guard` (L1 DPoP-bound auth, L2 pim:storage binding).
 *     `@jeswr/test-kit`'s bundled dev issuer cannot play this role: its
 *     WebID claims are `http:`, which `@jeswr/solid-api-auth` hard-rejects
 *     (no loopback exception) — see `./support/caller-issuer.ts`'s header.
 *   - `sparqOwner` (`pods.accounts[0]`) — the identity `@jeswr/solid-server`
 *     itself verifies for direct WAC reads/writes (real dereference of the
 *     WebID document, so it must be the SAME scheme the server listens on).
 *     It seeds the pod AND stands in for the engine's Mode-2 service
 *     identity (`createServicePodFetch`'s real client_credentials handshake
 *     is `@jeswr/solid-pod-guard`'s own tested surface, not re-derived here).
 *
 * Acceptance (mirrors the mortgage showcase's wallet `pod-auth.test.ts`,
 * adapted to this app's resource-scoped catalogue):
 *   - anonymous callers get 401 + WWW-Authenticate on every route;
 *   - `pod`/`webid` overrides (query or body) are 400;
 *   - a caller with no pim:storage binding is refused 403;
 *   - an unconfigured service identity fails closed 503;
 *   - an unknown/off-catalogue (party, resource) pair is refused 400 before
 *     any pod IO;
 *   - GRANT materialises a REAL WAC effect: the party's own authenticated
 *     read of the credential succeeds (200), a different party gains nothing;
 *   - REVOKE removes it: the party's authenticated read -> 401/403;
 *   - revocation is IMMUTABLE (re-grant after revoke -> 409, access stays off);
 *   - repeats are idempotent-in-effect 409 no-ops;
 *   - write-mode parties get real WAC write, read-only parties never do;
 *   - the ledger holds one receipt per transition, in order.
 */
import { createLendingIssuance, seedLendingPod } from "@lending/seeds";
import {
  profileCardFixture,
  seedPod,
  startSolidServer,
  type SolidTestAccount,
  type SolidTestServer,
} from "@lending/test-kit";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { resourceIri } from "../lib/grants/resources";
import type { WalletGrantConfig } from "../lib/server/config";
import {
  createWalletGrantService,
  type WalletGrantService,
} from "../lib/server/wallet-grant-service";
import { createTestCallerIssuer, type TestCallerIssuer } from "./support/caller-issuer";
import { startFetchServer, type FetchServer } from "./support/fetch-server";

const NOW = new Date("2026-07-15T12:00:00Z");

let pods: SolidTestServer;
let podBase = "";
let sparqOwner: SolidTestAccount;
let bankLender: SolidTestAccount;
let fintechLender: SolidTestAccount;
let disbursement: SolidTestAccount;
let caller: TestCallerIssuer;
let unbound: TestCallerIssuer;
let server: FetchServer;
let config: WalletGrantConfig;
let service: WalletGrantService;

function apiUrl(path: string): string {
  return `${server.origin}${path}`;
}

beforeAll(async () => {
  pods = await startSolidServer({ oidc: true });
  const primary = pods.accounts[0];
  if (primary === undefined) throw new Error("OIDC harness did not provision an owner");
  sparqOwner = primary;
  podBase = `${sparqOwner.baseUrl}/`;
  [bankLender, fintechLender, disbursement] = await Promise.all([
    pods.provisionAccount(),
    pods.provisionAccount(),
    pods.provisionAccount(),
  ]);
  [caller, unbound] = await Promise.all([createTestCallerIssuer(), createTestCallerIssuer()]);
  caller.setStorage(podBase);
  // `unbound` never calls setStorage — its profile genuinely claims no
  // pim:storage pod (the real 403 case, not a stub).

  // Seed the five REAL signed credentials (the grantable resource catalogue).
  const issuance = createLendingIssuance({ podOrigin: sparqOwner.baseUrl, now: NOW });
  await seedLendingPod({
    target: {
      webid: sparqOwner.webid,
      baseUrl: sparqOwner.baseUrl,
      authFetch: sparqOwner.authFetch,
    },
    issuance,
    now: NOW,
    mode: "create",
  });

  // Backward acknowledgment (L2.3): the pod's owner-only-writable profile
  // card names the CALLER (Maya's real-world identity) — publicly readable.
  await seedPod(
    sparqOwner.baseUrl,
    [profileCardFixture({ webid: caller.webid, name: "Maya Torres", storage: podBase })],
    { fetch: sparqOwner.authFetch, ownerWebid: sparqOwner.webid },
  );

  config = {
    guard: {
      trustedOidcIssuers: [caller.origin, unbound.origin],
      allowedPodOrigins: [pods.baseUrl],
      allowInsecureLoopback: true,
      trustForwardedHeaders: false,
    },
    serviceWebId: undefined,
    podServiceIssuer: undefined,
    podServiceClientId: undefined,
    podServiceClientSecret: undefined,
    partyWebIds: {
      "bank-lender": bankLender.webid,
      "fintech-lender": fintechLender.webid,
      disbursement: disbursement.webid,
    },
  };
  service = createWalletGrantService({
    config,
    // Real WAC IO through the pod's own native OIDC identity (module header:
    // the service-identity client_credentials handshake itself is
    // pod-guard's own tested seam — this injects its EFFECT).
    podFetch: sparqOwner.authFetch,
    serviceWebId: sparqOwner.webid,
    now: () => NOW,
  });

  server = await startFetchServer((request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/grants" && request.method === "GET") return service.grants(request);
    if (url.pathname === "/api/grants/change" && request.method === "POST") {
      return service.changeGrant(request);
    }
    if (url.pathname === "/api/ledger" && request.method === "GET") return service.ledger(request);
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
}, 120_000);

afterAll(async () => {
  await server?.stop();
  await caller?.close();
  await unbound?.close();
  await pods?.stop();
});

async function authed(
  issuer: TestCallerIssuer,
  method: string,
  path: string,
  options: { query?: string; body?: string } = {},
): Promise<Response> {
  const url = `${apiUrl(path)}${options.query ?? ""}`;
  return issuer.fetch(url, {
    method,
    ...(options.body !== undefined
      ? { body: options.body, headers: { "content-type": "application/json" } }
      : {}),
  });
}

describe("boundary rejections", () => {
  test("anonymous callers get 401 + WWW-Authenticate on every route", async () => {
    for (const [path, method] of [
      ["/api/grants", "GET"],
      ["/api/grants/change", "POST"],
      ["/api/ledger", "GET"],
    ] as const) {
      const response = await fetch(apiUrl(path), { method });
      expect(response.status, path).toBe(401);
      expect(response.headers.get("www-authenticate"), path).not.toBeNull();
    }
  });

  test("caller-supplied pod/webid are rejected 400 in query and body", async () => {
    const query = await authed(caller, "GET", "/api/grants", {
      query: `?pod=${encodeURIComponent(podBase)}`,
    });
    expect(query.status).toBe(400);

    const body = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({
        party: "bank-lender",
        resource: "identity",
        action: "grant",
        webid: caller.webid,
      }),
    });
    expect(body.status).toBe(400);
    expect(((await body.json()) as { error: string }).error).toBe("param_rejected");
  });

  test("a trusted caller with no pim:storage claim is refused 403", async () => {
    const response = await authed(unbound, "GET", "/api/grants");
    expect(response.status).toBe(403);
  });

  test("an unconfigured service identity fails closed 503 (never anonymous IO)", async () => {
    const unconfiguredServer = await startFetchServer((request) => {
      const unconfigured = createWalletGrantService({
        config: { ...config, serviceWebId: undefined, podServiceClientSecret: undefined },
      });
      return unconfigured.ledger(request);
    });
    try {
      const response = await caller.fetch(`${unconfiguredServer.origin}/x`, { method: "GET" });
      expect(response.status).toBe(503);
    } finally {
      await unconfiguredServer.stop();
    }
  });

  test("an unknown party, unknown resource, or off-catalogue pair is rejected before any pod IO", async () => {
    const unknownParty = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "mallory", resource: "identity", action: "grant" }),
    });
    expect(unknownParty.status).toBe(400);

    const unknownResource = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "bank-lender", resource: "nonsense", action: "grant" }),
    });
    expect(unknownResource.status).toBe(400);

    // bank-lender is bureau-only per the catalogue — it may never be granted
    // the cash-flow credential.
    const offCatalogue = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "bank-lender", resource: "bankCashFlow", action: "grant" }),
    });
    expect(offCatalogue.status).toBe(400);
  });
});

describe("the grant lifecycle (REAL WAC effects)", () => {
  test("grant -> real read; revoke -> real 401/403; immutable + idempotent; receipted", async () => {
    const identityIri = resourceIri(podBase, "identity");

    // Nothing to revoke yet.
    const early = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "bank-lender", resource: "identity", action: "revoke" }),
    });
    expect(early.status).toBe(409);

    // GRANT: a REAL WAC effect on the identity credential.
    const grant = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "bank-lender", resource: "identity", action: "grant" }),
    });
    expect(grant.status).toBe(200);
    const granted = (await grant.json()) as { receipt: { action: string; recipient: string } };
    expect(granted.receipt.action).toBe("grant");
    expect(granted.receipt.recipient).toBe(bankLender.webid);
    expect((await bankLender.authFetch(identityIri)).status).toBe(200);
    // A DIFFERENT party gained nothing.
    expect([401, 403]).toContain((await fintechLender.authFetch(identityIri)).status);
    // Anonymous still refused.
    expect([401, 403]).toContain((await fetch(identityIri)).status);

    // Repeat grant: recorded already -> 409, nothing changes.
    const regrant = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "bank-lender", resource: "identity", action: "grant" }),
    });
    expect(regrant.status).toBe(409);
    expect((await bankLender.authFetch(identityIri)).status).toBe(200);

    // The dashboard reflects live standing.
    const dashboard = await authed(caller, "GET", "/api/grants");
    expect(dashboard.status).toBe(200);
    const { standings, parties } = (await dashboard.json()) as {
      standings: readonly { agent: string; resource: string; granted: boolean; revoked: boolean }[];
      parties: readonly { id: string; webid: string }[];
    };
    expect(parties.map((party) => party.id).sort()).toEqual([
      "bank-lender",
      "disbursement",
      "fintech-lender",
    ]);
    expect(
      standings.find((entry) => entry.agent === bankLender.webid && entry.resource === "identity"),
    ).toMatchObject({ granted: true, revoked: false });

    // REVOKE: the WAC rule is gone.
    const revoke = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "bank-lender", resource: "identity", action: "revoke" }),
    });
    expect(revoke.status).toBe(200);
    expect([401, 403]).toContain((await bankLender.authFetch(identityIri)).status);

    // Repeat revoke: idempotent in effect.
    const rerevoke = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "bank-lender", resource: "identity", action: "revoke" }),
    });
    expect(rerevoke.status).toBe(409);
    expect([401, 403]).toContain((await bankLender.authFetch(identityIri)).status);

    // IMMUTABLE: the revoked party can never be re-granted this resource.
    const afterRevoke = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "bank-lender", resource: "identity", action: "grant" }),
    });
    expect(afterRevoke.status).toBe(409);
    expect([401, 403]).toContain((await bankLender.authFetch(identityIri)).status);

    // A DIFFERENT resource for the SAME party still grants fine.
    const incomeGrant = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "bank-lender", resource: "income", action: "grant" }),
    });
    expect(incomeGrant.status).toBe(200);
    expect((await bankLender.authFetch(resourceIri(podBase, "income"))).status).toBe(200);
    // The identity revocation is untouched by the unrelated resource's grant.
    expect([401, 403]).toContain((await bankLender.authFetch(identityIri)).status);

    // The ledger holds one receipt per transition, in order.
    const ledger = await authed(caller, "GET", "/api/ledger");
    expect(ledger.status).toBe(200);
    const { receipts } = (await ledger.json()) as {
      receipts: readonly { action: string; recipient: string; resource: string }[];
    };
    expect(receipts.map(({ action, recipient }) => [action, recipient])).toEqual([
      ["grant", bankLender.webid],
      ["revoke", bankLender.webid],
      ["grant", bankLender.webid],
    ]);
  }, 120_000);

  test("write-mode parties get real WAC write; read-only parties never do", async () => {
    // fintech-lender's catalogue entry for loanOffer is write:true.
    const grant = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "fintech-lender", resource: "loanOffer", action: "grant" }),
    });
    expect(grant.status).toBe(200);
    const loanOfferIri = resourceIri(podBase, "loanOffer");
    const write = await fintechLender.authFetch(loanOfferIri, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: "<#it> a <https://schema.org/Thing> .\n",
    });
    expect(write.ok).toBe(true);

    // bank-lender's catalogue entry for creditScore is read-only.
    const readOnlyGrant = await authed(caller, "POST", "/api/grants/change", {
      body: JSON.stringify({ party: "bank-lender", resource: "creditScore", action: "grant" }),
    });
    expect(readOnlyGrant.status).toBe(200);
    const creditScoreIri = resourceIri(podBase, "creditScore");
    expect((await bankLender.authFetch(creditScoreIri)).status).toBe(200);
    const forbiddenWrite = await bankLender.authFetch(creditScoreIri, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: "<#it> a <https://schema.org/Thing> .\n",
    });
    expect([401, 403]).toContain(forbiddenWrite.status);
  }, 120_000);
});
