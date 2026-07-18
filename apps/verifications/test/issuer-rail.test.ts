/**
 * The issuer rail's security bar, exercised through the REAL service against
 * a REAL @jeswr/solid-server pod (no mocked guard, no mocked verifier, no
 * mocked signing):
 *  - anonymous POST /api/issue is 401 before any pod IO;
 *  - a caller-supplied `webid` override is rejected 400;
 *  - an unconfigured flow fails closed 503 while configured flows keep
 *    working;
 *  - issuing signs a real eddsa-rdfc-2022 credential (+ its ZK operand
 *    anchor, where the flow has one) into the caller's REAL pod; reading it
 *    back over real HTTP and verifying with the REAL `verifyCredential`
 *    (shape + window + status + signature) succeeds for both documents;
 *  - re-issuing an already-issued flow is refused 409;
 *  - revoking the credential's status index — through the SAME issuer key
 *    and hosted list the route signed against — makes the SAME real verify
 *    call fail closed with STATUS_REVOKED.
 *
 * The caller's DPoP-bound Solid-OIDC session is a REAL local dev issuer
 * (below) rather than `@lending/test-kit`'s own — its bundled dev issuer
 * mints access tokens missing the `typ`/`sub` claims `@jeswr/solid-api-auth`
 * requires (a drift bug in a package outside this app's scope to fix; see
 * the PR description). Everything ELSE stays real: the pod is
 * `@lending/test-kit`'s live `@jeswr/solid-server`, and every credential/
 * anchor write and read-back runs over real HTTP against it.
 *
 * `authFetch`/the caller session perform REAL network calls per request, so
 * the route under test is served over a real loopback HTTP server (a
 * global-fetch stub would also redirect the verifier's OWN legitimate JWKS/
 * discovery calls).
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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
import { base64url, calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { IssuerFlowId } from "../lib/server/config";
import { ISSUER_FLOWS } from "../lib/server/flows";
import { createIssuerService, type IssuerService } from "../lib/server/issuer-rail";

const CONFIGURED_FLOWS = [
  "identity",
  "income",
  "cashflow",
] as const satisfies readonly IssuerFlowId[];
const UNCONFIGURED_FLOW: IssuerFlowId = "score";
const TOKEN_LIFETIME_SECONDS = 300;

interface RouteServer {
  readonly url: string;
  close(): Promise<void>;
}

/** Wrap a Fetch-API handler as a real loopback Node HTTP server. */
function serveRoute(handler: (request: Request) => Promise<Response>): Promise<RouteServer> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const address = server.address() as AddressInfo;
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value === undefined) continue;
          headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        const request = new Request(`http://127.0.0.1:${address.port}${req.url}`, {
          body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
          headers,
          method: req.method,
        });
        try {
          const response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          res.end(await response.text());
        } catch (error) {
          res.statusCode = 500;
          res.end(String(error));
        }
      })();
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        close: () => new Promise((res) => server.close(() => res())),
        url: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

interface TestCallerIssuer {
  readonly webid: string;
  readonly origin: string;
  /** The pod this WebID's profile claims via pim:storage — set once the pod boots. */
  setStorage(storage: string): void;
  /** An authenticated fetch minting a fresh DPoP-bound access token per call. */
  readonly fetch: typeof fetch;
  close(): Promise<void>;
}

/**
 * A REAL DPoP-bound Solid-OIDC dev issuer for the CALLER identity that hits
 * `/api/issue` — a real discovery doc + JWKS + WebID document (serving BOTH
 * `solid:oidcIssuer`, for the verifier's bidirectional check, and
 * `pim:storage`, for @jeswr/solid-pod-guard's L2 FORWARD claim — no
 * `ownerSeams` stub needed, this is genuinely dereferenced over loopback
 * HTTP) — plus real `at+jwt` access-token minting and per-request DPoP
 * proofs, mirroring RFC 9068/9449.
 */
async function createTestCallerIssuer(): Promise<TestCallerIssuer> {
  const issuerKeys = await generateKeyPair("ES256", { extractable: true });
  const issuerJwk = {
    ...(await exportJWK(issuerKeys.publicKey)),
    alg: "ES256",
    kid: "issuer-signing-key",
    use: "sig",
  };

  let issuer = "";
  let webid = "";
  let storage: string | undefined;

  const server = createServer((req, res) => {
    if (req.url === "/profile") {
      res.setHeader("content-type", "text/turtle");
      const lines = [`<${webid}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}> .`];
      if (storage !== undefined) {
        lines.push(`<${webid}> <http://www.w3.org/ns/pim/space#storage> <${storage}> .`);
      }
      res.end(`${lines.join("\n")}\n`);
      return;
    }
    if (req.url === "/.well-known/openid-configuration") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
      return;
    }
    if (req.url === "/jwks") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: [issuerJwk] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  issuer = `http://127.0.0.1:${address.port}`;
  // The `webid` claim itself must be `https:` (@jeswr/solid-api-auth has no
  // loopback exception for it — only for the issuer + the WebID FETCH, both
  // of which map an `https://<loopback>` URL back onto this same plain-HTTP
  // port under `allowInsecureLoopback`, mirroring
  // @jeswr/solid-pod-guard's owner.js `loopbackMappedFetch`).
  webid = `https://127.0.0.1:${address.port}/profile#me`;

  const dpopKeys = await generateKeyPair("ES256", { extractable: true });
  const dpopJwk = await exportJWK(dpopKeys.publicKey);
  const thumbprint = await calculateJwkThumbprint(dpopJwk);

  async function accessToken(): Promise<string> {
    const seconds = Math.floor(Date.now() / 1000);
    return new SignJWT({ client_id: "https://app.example/client", cnf: { jkt: thumbprint }, webid })
      .setProtectedHeader({ alg: "ES256", kid: issuerJwk.kid, typ: "at+jwt" })
      .setIssuer(issuer)
      .setSubject(webid)
      .setAudience("solid")
      .setIssuedAt(seconds)
      .setExpirationTime(seconds + TOKEN_LIFETIME_SECONDS)
      .sign(issuerKeys.privateKey);
  }

  const callerFetch: typeof fetch = async (input, init) => {
    const request = new Request(input instanceof Request ? input : String(input), init);
    const url = new URL(request.url);
    // RFC 9449: `htu` binds scheme/authority/path only.
    const htu = `${url.origin}${url.pathname}`;
    const token = await accessToken();
    const ath = base64url.encode(createHash("sha256").update(token, "ascii").digest());
    const proof = await new SignJWT({ ath, htm: request.method, htu, jti: randomUUID() })
      .setProtectedHeader({ alg: "ES256", jwk: dpopJwk, typ: "dpop+jwt" })
      .setIssuedAt()
      .sign(dpopKeys.privateKey);
    const headers = new Headers(request.headers);
    headers.set("authorization", `DPoP ${token}`);
    headers.set("dpop", proof);
    return fetch(new Request(request, { headers }));
  };

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    fetch: callerFetch,
    origin: issuer,
    setStorage(value: string) {
      storage = value;
    },
    webid,
  };
}

async function issuerKeyFor(flow: IssuerFlowId): Promise<KeyPair> {
  return generateKeyPairForSuite(`https://issuer.example/${flow}#key-1`, "Ed25519");
}

describe("the issuer rail", () => {
  let harness: SolidTestServer;
  let borrower: SolidTestAccount;
  let issuerPod: SolidTestAccount;
  let caller: TestCallerIssuer;
  let keys: Record<IssuerFlowId, KeyPair>;
  let issuerWebIds: Record<IssuerFlowId, string>;
  let statusListUrls: Record<IssuerFlowId, string>;
  let service: IssuerService;
  let route: RouteServer;
  const issuedIndex: Partial<Record<IssuerFlowId, string>> = {};

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
    borrower = primary;
    caller.setStorage(`${borrower.baseUrl}/`);
    issuerPod = await harness.provisionAccount();

    keys = {
      cashflow: await issuerKeyFor("cashflow"),
      identity: await issuerKeyFor("identity"),
      income: await issuerKeyFor("income"),
      score: await issuerKeyFor("score"),
    };
    issuerWebIds = {
      cashflow: "https://issuer.example/cashflow#id",
      identity: "https://issuer.example/identity#id",
      income: "https://issuer.example/income#id",
      score: "https://issuer.example/score#id",
    };
    statusListUrls = {
      cashflow: `${issuerPod.baseUrl}/status/cashflow`,
      identity: `${issuerPod.baseUrl}/status/identity`,
      income: `${issuerPod.baseUrl}/status/income`,
      score: `${issuerPod.baseUrl}/status/score`,
    };

    service = createIssuerService({
      guardConfig: {
        allowedPodOrigins: [borrower.baseUrl],
        allowInsecureLoopback: true,
        trustedOidcIssuers: [caller.origin],
      },
      issuers: {
        issuers: {
          cashflow: {
            keyJwk: undefined,
            keyVerificationMethod: undefined,
            statusListUrl: statusListUrls.cashflow,
            webid: issuerWebIds.cashflow,
          },
          identity: {
            keyJwk: undefined,
            keyVerificationMethod: undefined,
            statusListUrl: statusListUrls.identity,
            webid: issuerWebIds.identity,
          },
          income: {
            keyJwk: undefined,
            keyVerificationMethod: undefined,
            statusListUrl: statusListUrls.income,
            webid: issuerWebIds.income,
          },
          // Deliberately UNCONFIGURED (no webid / status-list URL): the 503 case.
          score: {
            keyJwk: undefined,
            keyVerificationMethod: undefined,
            statusListUrl: undefined,
            webid: undefined,
          },
        },
        podServiceClientId: undefined,
        podServiceClientSecret: undefined,
        podServiceIssuer: undefined,
        serviceWebId: undefined,
      },
      keys,
      podFetch: borrower.authFetch,
      // This test drives the service directly (no Next.js basePath-stripping
      // in front of it, unlike the real route) — the request URL IS the
      // public URL the caller signed its DPoP proof against.
      publicRequestUrl: (request) => request.url,
      statusHostFetch: issuerPod.authFetch,
    });

    route = await serveRoute((request) => service.issue(request));
  }, 60_000);

  afterAll(async () => {
    await route?.close();
    await caller?.close();
    await harness?.stop();
  });

  test("anonymous POST /api/issue is 401 before any pod IO", async () => {
    const response = await fetch(`${route.url}/`, {
      body: JSON.stringify({ flow: "identity" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBeTruthy();
  });

  test("a caller-supplied webid override is rejected 400 before any pod IO", async () => {
    const response = await caller.fetch(`${route.url}/`, {
      body: JSON.stringify({ flow: "identity", webid: "https://attacker.example/#me" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("param_rejected");
  });

  test("an unconfigured flow fails closed 503", async () => {
    const response = await caller.fetch(`${route.url}/`, {
      body: JSON.stringify({ flow: UNCONFIGURED_FLOW }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(503);
  });

  test("issuing each configured flow: real pod write, real read-back, real verify (+ its anchor)", async () => {
    for (const flow of CONFIGURED_FLOWS) {
      const definition = ISSUER_FLOWS[flow];
      const response = await caller.fetch(`${route.url}/`, {
        body: JSON.stringify({ flow }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const result = (await response.json()) as {
        credential: { id: string; statusListIndex: string };
        anchor: { id: string } | null;
      };
      issuedIndex[flow] = result.credential.statusListIndex;

      // Real pod read-back, over real HTTP.
      const stored = await borrower.authFetch(result.credential.id, {
        headers: { accept: "text/turtle" },
      });
      expect(stored.status).toBe(200);
      const body = await stored.text();

      const key = keys[flow];
      const issuerWebId = issuerWebIds[flow];
      const outcome = await verifyCredential(body, {
        expectShape: definition.kind,
        isControlledBy: (vm, issuer) => vm === key.verificationMethod && issuer === issuerWebId,
        now: new Date(),
        resolveKey: async (vm) => (vm === key.verificationMethod ? key.publicKey : undefined),
        statusFetch: issuerPod.authFetch,
        trustedIssuers: [issuerWebId],
      });
      expect(outcome.errors).toEqual([]);
      expect(outcome.verified).toBe(true);
      expect(outcome.credential?.subject).toBe(caller.webid);
      expect(outcome.credential?.issuer).toBe(issuerWebId);

      if (definition.anchor === undefined) {
        expect(result.anchor).toBeNull();
        continue;
      }
      expect(result.anchor).not.toBeNull();
      const anchorId = (result.anchor as { id: string }).id;
      const storedAnchor = await borrower.authFetch(anchorId, {
        headers: { accept: "text/turtle" },
      });
      expect(storedAnchor.status).toBe(200);
      const anchorOutcome = await verifyCredential(await storedAnchor.text(), {
        expectShape: "zk-operand-anchor",
        isControlledBy: (vm, issuer) => vm === key.verificationMethod && issuer === issuerWebId,
        now: new Date(),
        resolveKey: async (vm) => (vm === key.verificationMethod ? key.publicKey : undefined),
        statusFetch: issuerPod.authFetch,
        trustedIssuers: [issuerWebId],
      });
      expect(anchorOutcome.errors).toEqual([]);
      expect(anchorOutcome.verified).toBe(true);
    }
  });

  test("re-issuing an already-issued flow is refused 409", async () => {
    const response = await caller.fetch(`${route.url}/`, {
      body: JSON.stringify({ flow: "identity" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(409);
  });

  test("a revoked credential fails the REAL verifier's status gate", async () => {
    const definition = ISSUER_FLOWS.income;
    const key = keys.income;
    const issuerWebId = issuerWebIds.income;
    const index = issuedIndex.income;
    if (index === undefined) throw new Error("the income flow was not issued by an earlier test");

    // Revoke via a FRESH StatusListClient pointed at the SAME hosted list,
    // authenticated with the SAME issuer key the route signed the
    // credential's status entry with — an out-of-band issuer action, not a
    // capability this app's own route exposes this round.
    const revoker = new StatusListClient({
      fetch: issuerPod.authFetch,
      issuer: issuerWebId,
      key,
      url: statusListUrls.income,
    });
    await revoker.revoke(Number(index), { now: new Date() });

    const credentialIri = `${borrower.baseUrl}/${definition.credentialPath.slice(1)}`;
    const stored = await borrower.authFetch(credentialIri, { headers: { accept: "text/turtle" } });
    expect(stored.status).toBe(200);

    const outcome = await verifyCredential(await stored.text(), {
      expectShape: definition.kind,
      isControlledBy: (vm, issuer) => vm === key.verificationMethod && issuer === issuerWebId,
      now: new Date(),
      resolveKey: async (vm) => (vm === key.verificationMethod ? key.publicKey : undefined),
      statusFetch: issuerPod.authFetch,
      trustedIssuers: [issuerWebId],
    });
    expect(outcome.verified).toBe(false);
    expect(outcome.errors.map((error) => error.code)).toContain("STATUS_REVOKED");
  });
});
