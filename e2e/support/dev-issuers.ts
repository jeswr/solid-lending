/**
 * sm-qz3j.8 — the cross-app journey's DPoP-bound Solid-OIDC identities.
 * Ported from the per-app test fixtures every zone app's own vitest suite
 * already relies on — this is the SAME recipe, hoisted so ONE borrower
 * presenter and each service identity can be shared across every zone the
 * journey visits.
 *
 * Two identity shapes:
 *
 * - `startDevUserIssuer` — Maya's OWN presenter: the identity her session
 *   presents to every zone app's own routes AND — sm-qz3j.8's revoke finding
 *   — DIRECTLY TO THE POD ITSELF (ACL rewrites in `journey.spec.ts`'s
 *   `putAcl`/`podBody`). The journey's pod boots `oidc: true` (real
 *   Solid-OIDC + DPoP verification — see `journey.spec.ts`'s `beforeAll`);
 *   the pod's own native OIDC verifier (`@solid/access-token-verifier`) has
 *   NO loopback exception and hard-requires a GENUINE TLS dereference of the
 *   WebID document, unlike `@jeswr/solid-pod-guard`'s app-level owner-binding
 *   fetch (which rewrites a loopback `https:` WebID onto `http:` under
 *   `allowInsecureLoopback`). So this runs a REAL HTTPS listener (a freshly
 *   generated self-signed loopback cert via `openssl`,
 *   `relaxTlsVerificationForTests()` trusting it for outbound fetches in
 *   this process only) — exactly `apps/bank-lender/test/dev-issuer.ts`'s
 *   proven `startDevUserIssuer` recipe (its own 30-test suite's "revocation
 *   genuinely shuts the read off" acceptance test exercises this identical
 *   shape against `oidc: true`). A plain-HTTP loopback issuer (the previous
 *   shape here) satisfies `@jeswr/solid-api-auth`'s app-level "warn"
 *   bidirectional check but can NEVER satisfy the pod's own strict-mode
 *   verifier, so a revoke against such a pod can never be genuinely tested —
 *   the sm-qz3j.8 root cause.
 * - `startDevServiceIssuer` — a zone app's OWN L4 service identity: a plain
 *   HTTP dev issuer implementing the `client_credentials` grant
 *   `@jeswr/solid-pod-guard`'s `createServicePodFetch` performs (mirrors
 *   `apps/bank-lender/test/dev-issuer.ts` and siblings). Plain HTTP is fine
 *   here: this identity only ever presents to L1 app guards
 *   (`@jeswr/solid-api-auth`'s lenient loopback "warn" mode) and to the pod
 *   via each app's OWN `createServicePodFetch`, whose bearer token the pod
 *   verifies the SAME way regardless — never via a direct WebID dereference
 *   from this harness.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
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

let tlsVerificationRelaxed = false;
/**
 * Trust this process's self-signed dev certs for outbound fetches. Scoped to
 * the test process only (never production code): both Node's own `https`
 * client and `@jeswr/guarded-fetch`'s underlying dispatcher consult this
 * flag, and a self-signed loopback cert has no other way to be trusted
 * without a real CA. Mirrors `apps/bank-lender/test/dev-issuer.ts`'s
 * identical helper.
 */
function relaxTlsVerificationForTests(): void {
  if (tlsVerificationRelaxed) return;
  tlsVerificationRelaxed = true;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

/** Generate a fresh self-signed loopback TLS cert via the system `openssl` (dev/test only). */
function generateSelfSignedCert(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), "lending-e2e-dev-issuer-"));
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

function listenOnFreePort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo | null;
      if (address === null) {
        reject(new Error("dev issuer failed to bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

/**
 * Every zone app configures its own Next.js `basePath` (`/bank-lender`,
 * `/fintech-lender`, `/bureau`, `/disbursement`, `/wallet`, `/verifications`)
 * so it can be served under the shell's rewrite prefix. Next.js strips that
 * prefix BEFORE invoking a Route Handler, so `request.url` inside the
 * handler never carries it. Most zone routes (`@jeswr/solid-pod-guard`'s
 * `createPodRouteGuard`, e.g. `apps/verifications/lib/server/url.ts`'s
 * `publicRequestUrl`) already RE-ADD the basePath before checking the DPoP
 * `htu`, precisely so a real caller's proof — always minted against the
 * full public URL it actually fetched — verifies; those routes need the
 * FULL basePath'd URL here too.
 *
 * `bank-lender`/`fintech-lender`'s `/api/prequal/*` routes (ported verbatim
 * from the mortgage showcase, decisions 0005/0012 — see prequal.ts's module
 * header) call `@jeswr/solid-api-auth`'s `verifyNextRequest` DIRECTLY, with
 * no such re-add, so ITS `htu` check is against the basePath-STRIPPED
 * `request.url` — confirmed by instrumenting the route handler directly
 * (`request.url` inside bank-lender's `/api/prequal/challenge` handler is
 * `http://host:port/api/prequal/challenge`, no `/bank-lender` prefix). This
 * is a real asymmetry in the app code, not an e2e harness choice — flagged
 * for a follow-up to bring `prequal.ts` onto the same `publicRequestUrl`
 * convention as every other route; until then this harness mirrors BOTH
 * real behaviours rather than picking one and being vacuously wrong for
 * half the journey.
 */
const STRIPPED_HTU_PATH_PREFIXES = ["/bank-lender/api/prequal/", "/fintech-lender/api/prequal/"];

/** RFC 9449: `htu` binds scheme/authority/path only. */
function htuOf(url: string): string {
  const parsed = new URL(url);
  const strip = STRIPPED_HTU_PATH_PREFIXES.find((prefix) => parsed.pathname.startsWith(prefix));
  if (strip === undefined) {
    return `${parsed.origin}${parsed.pathname}`;
  }
  const pathname = parsed.pathname.slice(strip.indexOf("/api/"));
  return `${parsed.origin}${pathname}`;
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
 * pair, minting a DPoP-bound `at+jwt` for that WebID.
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
  const port = await listenOnFreePort(server);
  issuer = `http://127.0.0.1:${port}`;
  webId = `${issuer}/profile#id`;

  return {
    issuer,
    stop: () => closeServer(server),
    webId,
  };
}

export interface BorrowerSession {
  readonly issuer: string;
  readonly webid: string;
  /** An authenticated fetch minting a fresh DPoP proof + presenting the cached bearer token per call. */
  authFetch: typeof fetch;
  /** Intercept the browser page's own requests matching `pattern`, attaching the SAME real DPoP auth. */
  authenticatePage(page: Page, pattern: string): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Start Maya's presenter — the identity Maya's session presents to every
 * zone app's own routes AND directly to the pod server (real Solid-OIDC +
 * DPoP over a REAL HTTPS loopback listener — see the module header). `storage`
 * names her `pim:storage` claim (the L2 forward binding the apps'
 * `resolveAuthorizedPod` reads) — the pod's base URL, so call this AFTER the
 * pod boots (unlike the old fixed-owner-mode shape, the pod no longer needs
 * this WebID to exist before it can start, since it is not the pod's
 * bootstrap owner).
 */
export async function startDevUserIssuer(options: { storage: string }): Promise<BorrowerSession> {
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
        `<${webId}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}> .\n` +
          `<${webId}> <http://www.w3.org/ns/pim/space#storage> <${options.storage}> .\n`,
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
  // Bind via the "localhost" hostname (not the `listenOnFreePort` helper's
  // 127.0.0.1), matching the cert's `DNS:localhost` SAN entry exactly —
  // `apps/bank-lender/test/dev-issuer.ts`'s proven recipe.
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "localhost", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("dev user issuer failed to bind a TCP port");
  }
  // REAL HTTPS, same origin for issuer + WebID — see the module header for
  // why a genuine TLS dereference is required here (the pod's own OIDC
  // verifier has no loopback exception).
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

  async function authHeaders(
    method: string,
    url: string,
  ): Promise<{ authorization: string; dpop: string }> {
    const token = await accessToken();
    const ath = createHash("sha256").update(token, "ascii").digest("base64url");
    const proof = await new SignJWT({ ath, htm: method, htu: htuOf(url), jti: randomUUID() })
      .setProtectedHeader({ alg: "ES256", jwk: dpopJwk, typ: "dpop+jwt" })
      .setIssuedAt()
      .sign(dpopKeys.privateKey);
    return { authorization: `DPoP ${token}`, dpop: proof };
  }

  return {
    issuer,
    webid: webId,
    async authFetch(input, init = {}) {
      const request = new Request(input instanceof Request ? input : String(input), init);
      const target = new URL(request.url);
      const headers = new Headers(request.headers);
      const auth = await authHeaders(request.method, request.url);
      headers.set("authorization", auth.authorization);
      headers.set("dpop", auth.dpop);
      headers.set("x-forwarded-host", target.host);
      headers.set("x-forwarded-proto", target.protocol.replace(/:$/, ""));
      return fetch(new Request(request, { headers }));
    },
    async authenticatePage(page, pattern) {
      await page.route(pattern, async (route) => {
        const request = route.request();
        const target = new URL(request.url());
        const auth = await authHeaders(request.method(), request.url());
        await route.continue({
          headers: {
            ...request.headers(),
            ...auth,
            // Every zone app runs with LENDING_TRUST_FORWARDED_HEADERS=1
            // (the Vercel posture, exercised locally) — its own public-URL
            // reconstruction for the DPoP `htu` check reads these, exactly
            // like `authFetch`'s recipe; omitting them here left every
            // page-driven call 401ing even with a genuinely valid proof.
            "x-forwarded-host": target.host,
            "x-forwarded-proto": target.protocol.replace(/:$/, ""),
          },
        });
      });
    },
    stop: () => closeServer(server),
  };
}
