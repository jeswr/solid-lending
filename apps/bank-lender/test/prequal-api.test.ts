/**
 * Scene-2 pre-qualification route boundary, exercised end to end with a
 * REAL DPoP-bound Solid-OIDC session, a REAL UltraHonk ZK proof
 * (`provePreQualification`, via the demo-issuer route), and the REAL
 * fail-closed `verifyPreQualification` gate chain — never mocked. Proving is
 * expensive (~2s/leg plus WASM cold start), so this suite proves the bundle
 * ONCE and exercises the verify boundary (replay, tampering, malformed
 * input) without re-proving.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { BankLenderConfig } from "../lib/server/config";
import { createPrequalService, type PrequalService } from "../lib/server/prequal";
import { startDevUserIssuer } from "./dev-issuer";
import { serveHandler, type RouteServer } from "./route-server";

const PROVE_TIMEOUT = 180_000;

let caller: Awaited<ReturnType<typeof startDevUserIssuer>>;
let config: BankLenderConfig;
let service: PrequalService;
let route: RouteServer;

function apiUrl(path: string): string {
  return `${route.url}${path}`;
}

interface ChallengeResponse {
  readonly nonce: string;
}
interface DemoProofResponse {
  readonly proof: Record<string, unknown>;
  readonly anchors: Record<string, string>;
}
interface VerifyResponse {
  readonly qualified: boolean;
}

beforeAll(async () => {
  // Pre-qualification never touches a pod — a bare DPoP-bound identity is
  // enough to bind the ZK challenge/session, so no `@lending/test-kit` pod
  // harness is needed here (unlike `test/pod-auth.test.ts`).
  caller = await startDevUserIssuer({ storage: "https://storage.example/" });

  config = {
    allowedPodOrigins: [],
    allowInsecureLoopback: true,
    bankLenderWebId: "https://bank-lender.example/orgs/personal-loan-desk#id",
    podServiceClientId: undefined,
    podServiceClientSecret: undefined,
    podServiceIssuer: undefined,
    serviceWebId: undefined,
    trustedAnchorIssuers: [],
    trustedCredentialIssuers: [],
    trustedOidcIssuers: [caller.issuer],
    trustForwardedHeaders: false,
  };
  service = createPrequalService({ config });
  route = await serveHandler((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/prequal/challenge")) return service.challenge(request);
    if (url.pathname.endsWith("/prequal/demo-proof")) return service.demoProof(request);
    if (url.pathname.endsWith("/prequal/verify")) return service.verify(request);
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
}, 60_000);

afterAll(async () => {
  await route?.stop();
  await caller?.stop();
});

describe("boundary rejections", () => {
  test("anonymous callers get 401 + WWW-Authenticate", async () => {
    const response = await fetch(apiUrl("/prequal/challenge"), { method: "POST" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).not.toBeNull();
  });

  test("an unconfigured OIDC-issuer allowlist fails closed (503)", async () => {
    const unconfigured = createPrequalService({ config: { ...config, trustedOidcIssuers: [] } });
    const localRoute = await serveHandler((request) => unconfigured.challenge(request));
    try {
      const response = await fetch(`${localRoute.url}/prequal/challenge`, { method: "POST" });
      expect(response.status).toBe(503);
    } finally {
      await localRoute.stop();
    }
  });
});

describe("the real ZK round trip", () => {
  let nonce: string;
  let proofBundle: DemoProofResponse;

  test(
    "challenge -> demo-proof produces a genuine bundle over a live nonce",
    async () => {
      const challengeResponse = await caller.authFetch(apiUrl("/prequal/challenge"), {
        method: "POST",
      });
      expect(challengeResponse.status).toBe(200);
      ({ nonce } = (await challengeResponse.json()) as ChallengeResponse);
      expect(typeof nonce).toBe("string");

      const proofResponse = await caller.authFetch(apiUrl("/prequal/demo-proof"), {
        body: JSON.stringify({ nonce }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(proofResponse.status).toBe(200);
      proofBundle = (await proofResponse.json()) as DemoProofResponse;
      expect(Object.keys(proofBundle.proof).sort()).toEqual(
        ["cashFlowScoreValue", "netMonthlyIncomeUsd", "nsf90Count"].sort(),
      );
    },
    PROVE_TIMEOUT,
  );

  test(
    "verify: a genuine bundle over the live nonce is qualified",
    async () => {
      const response = await caller.authFetch(apiUrl("/prequal/verify"), {
        body: JSON.stringify({ anchors: proofBundle.anchors, nonce, proof: proofBundle.proof }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(response.status).toBe(200);
      const result = (await response.json()) as VerifyResponse;
      expect(result.qualified).toBe(true);
    },
    PROVE_TIMEOUT,
  );

  test("replaying the identical bundle rejects (nonce already burned)", async () => {
    const response = await caller.authFetch(apiUrl("/prequal/verify"), {
      body: JSON.stringify({ anchors: proofBundle.anchors, nonce, proof: proofBundle.proof }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(403);
    const result = (await response.json()) as VerifyResponse;
    expect(result.qualified).toBe(false);
  });

  test(
    "a proof beside a WRONG anchor (field mismatch) rejects that leg, overall qualified:false",
    async () => {
      const challengeResponse = await caller.authFetch(apiUrl("/prequal/challenge"), {
        method: "POST",
      });
      const { nonce: freshNonce } = (await challengeResponse.json()) as ChallengeResponse;
      const proofResponse = await caller.authFetch(apiUrl("/prequal/demo-proof"), {
        body: JSON.stringify({ nonce: freshNonce }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const fresh = (await proofResponse.json()) as DemoProofResponse;

      const response = await caller.authFetch(apiUrl("/prequal/verify"), {
        body: JSON.stringify({
          anchors: {
            ...fresh.anchors,
            // Swap in the income anchor for the score leg — a field mismatch.
            cashFlowScoreValue: fresh.anchors.netMonthlyIncomeUsd,
          },
          nonce: freshNonce,
          proof: fresh.proof,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(response.status).toBe(403);
      const body = (await response.json()) as {
        legs: {
          netMonthlyIncomeUsd: { verified: boolean };
          cashFlowScoreValue: { verified: boolean };
        };
      };
      expect(body.legs.netMonthlyIncomeUsd.verified).toBe(true);
      expect(body.legs.cashFlowScoreValue.verified).toBe(false);
    },
    PROVE_TIMEOUT,
  );

  test("a malformed body (missing a leg) is rejected 400 before any cryptographic work", async () => {
    const challengeResponse = await caller.authFetch(apiUrl("/prequal/challenge"), {
      method: "POST",
    });
    const { nonce: freshNonce } = (await challengeResponse.json()) as ChallengeResponse;
    const response = await caller.authFetch(apiUrl("/prequal/verify"), {
      body: JSON.stringify({ anchors: {}, nonce: freshNonce, proof: {} }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(400);
  });
});
