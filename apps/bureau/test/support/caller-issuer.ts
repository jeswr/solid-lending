/**
 * A REAL DPoP-bound Solid-OIDC dev issuer for the CALLER identity that hits
 * `@jeswr/solid-pod-guard`-fronted routes — mirrors the sibling
 * `verifications` app's own `createTestCallerIssuer` (same sm-qz3j seeder
 * round; kept consistent across the demo's test suites rather than
 * reinvented per app).
 *
 * `@lending/test-kit`'s OWN bundled OIDC dev issuer (`startSolidServer({oidc:
 * true})`) mints access tokens missing the `typ`/`sub` claims
 * `@jeswr/solid-api-auth`'s `DpopApiVerifier` requires (a drift bug in
 * shared test infrastructure, fixed narrowly upstream in
 * `packages/test-kit/src/harness.ts` — see that diff), AND its WebID claims
 * are `http:`, which `@jeswr/solid-api-auth` hard-rejects (no loopback
 * exception, unlike the pod-base check). Real Solid pods use `https:`
 * WebIDs; a caller that ALSO needs to satisfy `@jeswr/solid-server`'s own
 * direct-WAC verification (`@solid/access-token-verifier`, which genuinely
 * DEREFERENCES the WebID document and therefore needs a real,
 * same-scheme-listening endpoint) cannot be the SAME identity as one
 * claiming `https:` without a real TLS listener. This helper is therefore
 * used ONLY for the caller side of `@jeswr/solid-pod-guard` routes (L1
 * DPoP-bound auth + L2 pim:storage binding, both of which pod-guard's own
 * default loopback-mapped fetch — `owner.js`'s `loopbackMappedFetch` —
 * dereferences fine under `allowInsecureLoopback`); the ACTUAL pod IO
 * (seeding, the engine's Mode-2 podFetch) runs through
 * `@lending/test-kit`'s OWN native `http:`-webid OIDC account, which
 * `@jeswr/solid-server` verifies directly.
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { base64url, calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from "jose";

const TOKEN_LIFETIME_SECONDS = 300;

export interface TestCallerIssuer {
  readonly webid: string;
  readonly origin: string;
  /** The pod this WebID's profile claims via `pim:storage`. Unset = the
   * caller genuinely claims no storage (the "unbound" 403 case). */
  setStorage(storage: string): void;
  /** An authenticated fetch minting a fresh DPoP-bound access token per call. */
  readonly fetch: typeof fetch;
  close(): Promise<void>;
}

export async function createTestCallerIssuer(): Promise<TestCallerIssuer> {
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

  const server: Server = createServer((request, response) => {
    if (request.url === "/profile") {
      response.setHeader("content-type", "text/turtle");
      const lines = [`<${webid}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}> .`];
      if (storage !== undefined) {
        lines.push(`<${webid}> <http://www.w3.org/ns/pim/space#storage> <${storage}> .`);
      }
      response.end(`${lines.join("\n")}\n`);
      return;
    }
    if (request.url === "/.well-known/openid-configuration") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
      return;
    }
    if (request.url === "/jwks") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [issuerJwk] }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  issuer = `http://127.0.0.1:${address.port}`;
  // The `webid` claim itself must be `https:` (no loopback exception in
  // `@jeswr/solid-api-auth`) — the issuer string + the WebID fetch both map
  // this back onto the SAME plain-HTTP port under `allowInsecureLoopback`
  // (the issuer via `isLoopbackHttp`; the WebID dereference via pod-guard's
  // OWN default `loopbackMappedFetch` — no custom `ownerSeams` needed here).
  webid = `https://127.0.0.1:${address.port}/profile#me`;

  const dpopKeys = await generateKeyPair("ES256", { extractable: true });
  const dpopJwk = await exportJWK(dpopKeys.publicKey);
  const thumbprint = await calculateJwkThumbprint(dpopJwk);

  async function accessToken(): Promise<string> {
    const seconds = Math.floor(Date.now() / 1000);
    return new SignJWT({
      client_id: "https://app.example/client",
      cnf: { jkt: thumbprint },
      webid,
      sub: webid,
    })
      .setProtectedHeader({ alg: "ES256", kid: issuerJwk.kid, typ: "at+jwt" })
      .setIssuer(issuer)
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
