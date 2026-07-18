/**
 * The bureau's issuer rail security bar, exercised through the REAL service
 * against a REAL @jeswr/solid-server pod (no mocked guard, no mocked
 * verifier, no mocked signing) — mirrors the sibling `verifications` app's
 * own `issuer-rail.test.ts` (same sm-qz3j seeder round), trimmed to the
 * bureau's ONE flow:
 *
 *  - anonymous POST /api/issue is 401 before any pod IO;
 *  - a caller-supplied `webid` override is rejected 400;
 *  - an unconfigured bureau identity fails closed 503;
 *  - issuing signs a real eddsa-rdfc-2022 Credit Score VC into the caller's
 *    REAL pod; reading it back over real HTTP and verifying with the REAL
 *    `verifyCredential` (shape + window + status + signature) succeeds;
 *  - re-issuing is refused 409;
 *  - revoking the credential's status index — through the SAME issuer key
 *    and hosted list the route signed against — makes the SAME real verify
 *    call fail closed with STATUS_REVOKED.
 *
 * The caller's DPoP-bound Solid-OIDC session is `./support/caller-issuer.ts`
 * (the SAME pattern the sibling `verifications`/`wallet` apps' test suites
 * use — `@lending/test-kit`'s own bundled dev issuer cannot play this role,
 * see that module's header). Everything ELSE is real: the pod is
 * `@lending/test-kit`'s live `@jeswr/solid-server`, and every credential
 * write/read-back runs over real HTTP against it.
 */
import {
  generateKeyPairForSuite,
  type KeyPair,
  StatusListClient,
  verifyCredential,
} from "@lending/vc-kit";
import {
  profileCardFixture,
  startSolidServer,
  type SolidTestAccount,
  type SolidTestServer,
} from "@lending/test-kit";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { CREDIT_SCORE_CREDENTIAL_PATH } from "../lib/server/claims";
import type { BureauConfig } from "../lib/server/config";
import { createIssuerService, type IssuerService } from "../lib/server/issuer-rail";
import { createTestCallerIssuer, type TestCallerIssuer } from "./support/caller-issuer";
import { startFetchServer, type FetchServer } from "./support/fetch-server";

const ISSUER_WEBID = "https://issuer.example/credit-bureau#id";

function unconfiguredConfig(): BureauConfig {
  return {
    issuer: {
      keyJwk: undefined,
      keyVerificationMethod: undefined,
      statusListUrl: undefined,
      webid: undefined,
    },
    podServiceClientId: undefined,
    podServiceClientSecret: undefined,
    podServiceIssuer: undefined,
    serviceWebId: undefined,
    trustedFurnishers: [],
  };
}

describe("the bureau issuer rail", () => {
  let harness: SolidTestServer;
  let sparqOwner: SolidTestAccount;
  let issuerPod: SolidTestAccount;
  let caller: TestCallerIssuer;
  let key: KeyPair;
  let statusListUrl: string;
  let podBase: string;
  let service: IssuerService;
  let server: FetchServer;
  let issuedStatusIndex: string;

  beforeAll(async () => {
    caller = await createTestCallerIssuer();

    harness = await startSolidServer({
      oidc: true,
      seedFixtures: (account) => [
        // The BACKWARD acknowledgment @jeswr/solid-pod-guard reads over
        // real, unauthenticated HTTP — the pod names the caller as owner.
        profileCardFixture({
          name: "Maya Torres",
          storage: `${account.baseUrl}/`,
          webid: caller.webid,
        }),
      ],
    });
    const primary = harness.accounts[0];
    if (primary === undefined) throw new Error("harness produced no primary account");
    sparqOwner = primary;
    podBase = `${sparqOwner.baseUrl}/`;
    caller.setStorage(podBase);
    issuerPod = await harness.provisionAccount();

    key = await generateKeyPairForSuite(`${ISSUER_WEBID.split("#")[0]}#key-1`, "Ed25519");
    statusListUrl = `${issuerPod.baseUrl}/status/credit-score`;

    service = createIssuerService({
      config: {
        issuer: {
          keyJwk: undefined,
          keyVerificationMethod: undefined,
          statusListUrl,
          webid: ISSUER_WEBID,
        },
        podServiceClientId: undefined,
        podServiceClientSecret: undefined,
        podServiceIssuer: undefined,
        serviceWebId: undefined,
        trustedFurnishers: [],
      },
      guardConfig: {
        allowedPodOrigins: [harness.baseUrl],
        allowInsecureLoopback: true,
        trustedOidcIssuers: [caller.origin],
      },
      key,
      podFetch: sparqOwner.authFetch,
      // This test drives the service directly (no Next.js basePath-stripping
      // in front of it, unlike the real route) — the request URL IS the
      // public URL the caller signed its DPoP proof against.
      publicRequestUrl: (request) => request.url,
      statusHostFetch: issuerPod.authFetch,
    });

    server = await startFetchServer((request) => service.issue(request));
  }, 60_000);

  afterAll(async () => {
    await server?.stop();
    await caller?.close();
    await harness?.stop();
  });

  test("anonymous POST /api/issue is 401 before any pod IO", async () => {
    const response = await fetch(server.origin, {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBeTruthy();
  });

  test("a caller-supplied webid override is rejected 400 before any pod IO", async () => {
    const response = await caller.fetch(server.origin, {
      body: JSON.stringify({ webid: "https://attacker.example/#me" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("param_rejected");
  });

  test("an unconfigured bureau identity fails closed 503", async () => {
    const unconfigured = createIssuerService({
      config: unconfiguredConfig(),
      guardConfig: {
        allowedPodOrigins: [harness.baseUrl],
        allowInsecureLoopback: true,
        trustedOidcIssuers: [caller.origin],
      },
      podFetch: sparqOwner.authFetch,
      publicRequestUrl: (request) => request.url,
      statusHostFetch: issuerPod.authFetch,
    });
    const unconfiguredServer = await startFetchServer((request) => unconfigured.issue(request));
    try {
      const response = await caller.fetch(unconfiguredServer.origin, {
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(response.status).toBe(503);
    } finally {
      await unconfiguredServer.stop();
    }
  });

  test("issuing: real pod write, real read-back, real verify", async () => {
    const response = await caller.fetch(server.origin, {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const result = (await response.json()) as {
      credential: { id: string; statusListIndex: string };
    };
    issuedStatusIndex = result.credential.statusListIndex;

    const stored = await sparqOwner.authFetch(result.credential.id, {
      headers: { accept: "text/turtle" },
    });
    expect(stored.status).toBe(200);
    const body = await stored.text();

    const outcome = await verifyCredential(body, {
      expectShape: "credit-score-credential",
      isControlledBy: (vm, issuer) => vm === key.verificationMethod && issuer === ISSUER_WEBID,
      now: new Date(),
      resolveKey: async (vm) => (vm === key.verificationMethod ? key.publicKey : undefined),
      statusFetch: issuerPod.authFetch,
      trustedIssuers: [ISSUER_WEBID],
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.verified).toBe(true);
    expect(outcome.credential?.subject).toBe(caller.webid);
    expect(outcome.credential?.issuer).toBe(ISSUER_WEBID);
    expect(result.credential.id).toBe(`${podBase}${CREDIT_SCORE_CREDENTIAL_PATH.slice(1)}`);
  });

  test("re-issuing is refused 409", async () => {
    const response = await caller.fetch(server.origin, {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(409);
  });

  test("a revoked credential fails the REAL verifier's status gate", async () => {
    const credentialIri = `${podBase}${CREDIT_SCORE_CREDENTIAL_PATH.slice(1)}`;

    // Revoke via a FRESH StatusListClient pointed at the SAME hosted list,
    // authenticated with the SAME issuer key the route signed the
    // credential's status entry with — an out-of-band issuer action, not a
    // capability this app's own route exposes this round.
    const revoker = new StatusListClient({
      fetch: issuerPod.authFetch,
      issuer: ISSUER_WEBID,
      key,
      url: statusListUrl,
    });
    await revoker.revoke(Number(issuedStatusIndex), { now: new Date() });

    const stored = await sparqOwner.authFetch(credentialIri, {
      headers: { accept: "text/turtle" },
    });
    expect(stored.status).toBe(200);

    const outcome = await verifyCredential(await stored.text(), {
      expectShape: "credit-score-credential",
      isControlledBy: (vm, issuer) => vm === key.verificationMethod && issuer === ISSUER_WEBID,
      now: new Date(),
      resolveKey: async (vm) => (vm === key.verificationMethod ? key.publicKey : undefined),
      statusFetch: issuerPod.authFetch,
      trustedIssuers: [ISSUER_WEBID],
    });
    expect(outcome.verified).toBe(false);
    expect(outcome.errors.map((error) => error.code)).toContain("STATUS_REVOKED");
  });
});
