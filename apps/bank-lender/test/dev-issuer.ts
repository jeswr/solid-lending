/**
 * Test-only dev OIDC issuer supporting the `client_credentials` grant
 * `@jeswr/solid-pod-guard`'s `createServicePodFetch` performs (RFC 9449 DPoP
 * + a `token_endpoint` returning a DPoP-bound `at+jwt`). `@lending/test-kit`'s
 * own harness only mints tokens for its "account" identities (an internal
 * helper, no HTTP `/token` endpoint) — this app's scene-3 service identity
 * needs the REAL client_credentials round trip `createServicePodFetch`
 * performs, so this fixture is scoped locally rather than reaching into
 * another package's internals.
 *
 * Mirrors `@lending/test-kit`'s `createDevIssuerIdentity` (discovery + JWKS +
 * WebID profile), adding the `/token` POST handler: verifies the presented
 * `client_id`/`client_secret` pair, reads the caller's DPoP proof's embedded
 * public key to bind `cnf.jkt`, and mints a fresh access token for the
 * service's OWN WebID (never the caller's) — exactly what a Solid service-
 * account issuer does.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  SignJWT,
} from "jose";

const TOKEN_LIFETIME_SECONDS = 300;
const TOKEN_REFRESH_MS = 60_000;

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function readBody(request: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export interface ClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface DevServiceIssuer {
  readonly issuer: string;
  readonly webId: string;
  stop(): Promise<void>;
}

/**
 * Start a dev OIDC issuer that (a) publishes discovery + JWKS + a WebID
 * profile (at `<issuer>/profile#id`) binding that WebID to this issuer, and
 * (b) accepts a `client_credentials` token request for the configured client
 * pair, minting a DPoP-bound `at+jwt` for that WebID. The WebID depends on
 * the dynamically-assigned port, so it is computed AFTER binding — read it
 * off the returned {@link DevServiceIssuer}.
 */
export async function startDevServiceIssuer(options: {
  clients: readonly ClientCredentials[];
}): Promise<DevServiceIssuer> {
  const issuerKeys = await generateKeyPair("ES256", { extractable: true });
  const issuerJwk = {
    ...(await exportJWK(issuerKeys.publicKey)),
    alg: "ES256",
    kid: "issuer-signing-key",
    use: "sig",
  };

  let issuer = "";
  let webId = "";
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://placeholder");
      if (url.pathname === "/profile" && request.method === "GET") {
        response.setHeader("content-type", "text/turtle");
        response.end(`<${webId}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}> .\n`);
        return;
      }
      if (url.pathname === "/.well-known/openid-configuration" && request.method === "GET") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks`, token_endpoint: `${issuer}/token` }),
        );
        return;
      }
      if (url.pathname === "/jwks" && request.method === "GET") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ keys: [issuerJwk] }));
        return;
      }
      if (url.pathname === "/token" && request.method === "POST") {
        const body = await readBody(request);
        const params = new URLSearchParams(body);
        const clientId = params.get("client_id");
        const clientSecret = params.get("client_secret");
        const grantType = params.get("grant_type");
        const matched = options.clients.find(
          (client) => client.clientId === clientId && client.clientSecret === clientSecret,
        );
        if (grantType !== "client_credentials" || matched === undefined) {
          response.statusCode = 401;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: "invalid_client" }));
          return;
        }
        const dpopHeader = request.headers.dpop;
        if (typeof dpopHeader !== "string") {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: "invalid_dpop_proof" }));
          return;
        }
        let jkt: string;
        try {
          const decoded = JSON.parse(
            Buffer.from(dpopHeader.split(".")[0] ?? "", "base64url").toString("utf8"),
          ) as { jwk?: JsonWebKey };
          if (decoded.jwk === undefined) throw new Error("dpop proof carries no embedded jwk");
          const publicKey = await importJWK(decoded.jwk, "ES256");
          // Verify the proof is genuinely signed by the embedded key (not just well-formed).
          await jwtVerify(dpopHeader, publicKey, { typ: "dpop+jwt" });
          jkt = await calculateJwkThumbprint(decoded.jwk);
        } catch {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: "invalid_dpop_proof" }));
          return;
        }
        const seconds = Math.floor(Date.now() / 1000);
        const accessToken = await new SignJWT({
          client_id: clientId,
          cnf: { jkt },
          webid: webId,
        })
          .setProtectedHeader({ alg: "ES256", kid: issuerJwk.kid, typ: "at+jwt" })
          .setIssuer(issuer)
          .setAudience("solid")
          .setIssuedAt(seconds)
          .setExpirationTime(seconds + TOKEN_LIFETIME_SECONDS)
          .sign(issuerKeys.privateKey);
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: accessToken,
            expires_in: TOKEN_LIFETIME_SECONDS,
            token_type: "DPoP",
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    })().catch((error: unknown) => {
      response.statusCode = 500;
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "localhost", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("dev service issuer failed to bind a TCP port");
  }
  issuer = `http://localhost:${address.port}`;
  webId = `${issuer}/profile#id`;

  return {
    issuer,
    stop: () => closeServer(server),
    webId,
  };
}

export interface DevUserIssuer {
  readonly issuer: string;
  readonly webId: string;
  /** A fetch that mints a fresh DPoP proof + presents the cached bearer token per call. */
  readonly authFetch: typeof fetch;
  stop(): Promise<void>;
}

let tlsVerificationRelaxed = false;
/**
 * Trust this process's self-signed dev certs for outbound fetches. Scoped to
 * the test process only (never production code): both Node's own `https`
 * client and `@jeswr/guarded-fetch`'s underlying dispatcher consult this
 * flag, and a self-signed loopback cert has no other way to be trusted
 * without a real CA.
 */
function relaxTlsVerificationForTests(): void {
  if (tlsVerificationRelaxed) return;
  tlsVerificationRelaxed = true;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

/** Generate a fresh self-signed loopback TLS cert via the system `openssl` (dev/test only). */
function generateSelfSignedCert(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), "bank-lender-dev-issuer-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-nodes",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ]);
  return { cert: readFileSync(certPath, "utf8"), key: readFileSync(keyPath, "utf8") };
}

/**
 * Start a dev OIDC issuer for a REGULAR (non-service) presenter — the
 * identity Maya's session presents to THIS APP's own routes AND to the pod
 * server directly (ACL fixture writes). `@lending/test-kit`'s own
 * `SolidTestAccount` mints `http:`-scheme WebIDs: accepted by NEITHER
 * `@jeswr/solid-api-auth`'s `DpopApiVerifier.extractWebId` (hard-requires
 * `https:`, no loopback exception) NOR the sparq pod server's own OIDC
 * verification (its bidirectional WebID<->issuer check fails closed on a
 * dereference failure, unlike solid-api-auth's lenient "warn" downgrade for
 * loopback issuers) — so a scheme-relabeling trick is not enough here; this
 * issuer runs a REAL HTTPS listener (a freshly generated self-signed
 * loopback cert) so every dereference of its WebID succeeds genuinely.
 * `relaxTlsVerificationForTests()` trusts that cert for outbound fetches in
 * THIS test process only.
 *
 * It ALSO serves `pim:storage <storage>` in its own profile document (the L2
 * forward claim `resolveAuthorizedPod` reads), which `@lending/test-kit`'s
 * harness does not — this presenter identity is decoupled from pod ownership
 * entirely: the POD is still owned (and read/written for seeding) by the
 * `@lending/test-kit` `SolidTestAccount`; this issuer only asserts WHO is
 * making the authenticated request, and where their granted pod lives.
 */
export async function startDevUserIssuer(options: { storage: string }): Promise<DevUserIssuer> {
  relaxTlsVerificationForTests();
  const issuerKeys = await generateKeyPair("ES256", { extractable: true });
  const issuerJwk = {
    ...(await exportJWK(issuerKeys.publicKey)),
    alg: "ES256",
    kid: "issuer-signing-key",
    use: "sig",
  };
  const dpopKeys = await generateKeyPair("ES256", { extractable: true });
  const dpopJwk = await exportJWK(dpopKeys.publicKey);
  const thumbprint = await calculateJwkThumbprint(dpopJwk);

  let issuer = "";
  let webId = "";
  const { key, cert } = generateSelfSignedCert();
  const server = createHttpsServer({ cert, key }, (request, response) => {
    if (request.url === "/profile" && request.method === "GET") {
      response.setHeader("content-type", "text/turtle");
      response.end(
        `<${webId}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}> ; ` +
          `<http://www.w3.org/ns/pim/space#storage> <${options.storage}> .\n`,
      );
      return;
    }
    if (request.url === "/.well-known/openid-configuration" && request.method === "GET") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
      return;
    }
    if (request.url === "/jwks" && request.method === "GET") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [issuerJwk] }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "localhost", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("dev user issuer failed to bind a TCP port");
  }
  issuer = `https://localhost:${address.port}`;
  webId = `${issuer}/profile#id`;

  let cachedToken: { value: string; mintedAt: number } | undefined;
  async function accessToken(): Promise<string> {
    const now = Date.now();
    if (cachedToken !== undefined && now - cachedToken.mintedAt < TOKEN_REFRESH_MS) {
      return cachedToken.value;
    }
    const seconds = Math.floor(now / 1000);
    const value = await new SignJWT({ cnf: { jkt: thumbprint }, webid: webId })
      .setProtectedHeader({ alg: "ES256", kid: issuerJwk.kid, typ: "at+jwt" })
      .setIssuer(issuer)
      .setSubject(webId)
      .setAudience("solid")
      .setIssuedAt(seconds)
      .setExpirationTime(seconds + TOKEN_LIFETIME_SECONDS)
      .sign(issuerKeys.privateKey);
    cachedToken = { value, mintedAt: now };
    return value;
  }

  const authFetch: typeof fetch = async (input, init) => {
    const request = new Request(input instanceof Request ? input : String(input), init);
    const url = new URL(request.url);
    const htu = `${url.origin}${url.pathname}`;
    const token = await accessToken();
    const ath = createHash("sha256").update(token, "ascii").digest("base64url");
    const proof = await new SignJWT({ ath, htm: request.method, htu, jti: randomUUID() })
      .setProtectedHeader({ alg: "ES256", jwk: dpopJwk, typ: "dpop+jwt" })
      .setIssuedAt()
      .sign(dpopKeys.privateKey);
    const headers = new Headers(request.headers);
    headers.set("authorization", `DPoP ${token}`);
    headers.set("dpop", proof);
    return fetch(new Request(request, { headers }));
  };

  return { authFetch, issuer, stop: () => closeServer(server), webId };
}
