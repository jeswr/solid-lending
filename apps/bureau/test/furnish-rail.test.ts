/**
 * The bureau's FURNISHING intake security bar (design §6.1/§6.2 scene 5),
 * exercised through the REAL service against a REAL @jeswr/solid-server pod
 * (no mocked guard, no mocked verifier, no mocked signing) — the
 * "presenter-issuer" test pattern the sibling `verifications`/`wallet` apps'
 * suites use, extended with a SEPARATE furnisher identity: the caller
 * PRESENTING the credential (a real DPoP-bound borrower session,
 * `./support/caller-issuer.ts`) is a DIFFERENT identity from the credential's
 * ISSUER (a self-signed stand-in for the fintech lender) — exactly the
 * shape a real furnishing round trip has.
 *
 *  - anonymous POST /api/furnish and GET /api/furnished are 401;
 *  - a caller-supplied `webid` override is rejected 400;
 *  - an unconfigured trusted-furnisher allowlist fails closed 503;
 *  - a malformed body is rejected 400 before any cryptographic work;
 *  - a REAL fintech-lender-signed Repayment-History VC, subject-bound to the
 *    caller, is admitted (200) and shows up in the caller's OWN furnished
 *    view;
 *  - an UNTRUSTED issuer's otherwise-valid credential is refused (403),
 *    never recorded;
 *  - a TAMPERED credential (signature no longer reconstructs) is refused
 *    (403), never recorded;
 *  - a credential bound to a DIFFERENT subject is refused (403) even though
 *    it is genuinely signed by a trusted furnisher — never recorded;
 *  - furnishing the SAME credential twice is refused 409 (idempotent, not a
 *    silent duplicate);
 *  - a DIFFERENT borrower's furnished view never contains this caller's
 *    tradelines (isolation).
 */
import {
  generateKeyPairForSuite,
  issueCredential,
  type KeyPair,
  type RepaymentHistoryClaims,
  StatusListClient,
} from "@lending/vc-kit";
import {
  profileCardFixture,
  seedPod,
  startSolidServer,
  type SolidTestAccount,
  type SolidTestServer,
} from "@lending/test-kit";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createFurnishService, type FurnishService } from "../lib/server/furnish-rail";
import { createTestCallerIssuer, type TestCallerIssuer } from "./support/caller-issuer";
import { startFetchServer, type FetchServer } from "./support/fetch-server";

const NOW = new Date("2026-07-15T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const FINTECH_LENDER_WEBID = "https://fintech-lender.example/orgs/installment-lending#id";
const ROGUE_FURNISHER_WEBID = "https://rogue-furnisher.example/#id";

/** In-memory GET/PUT host for the demo furnishers' hosted status lists — nothing leaves the process (mirrors the sibling `fintech-lender` app's `demo-issuer.ts`). */
function memoryStatusHost(): { fetch: typeof fetch } {
  const resources = new Map<string, { body: string; contentType: string; version: number }>();
  const memoryFetch: typeof fetch = async (input, init) => {
    const request = new Request(input instanceof Request ? input : String(input), init);
    const key = new URL(request.url).href;
    const existing = resources.get(key);
    if (request.method === "PUT") {
      if (request.headers.get("if-none-match") === "*" && existing !== undefined) {
        return new Response(null, { status: 412 });
      }
      const body = await request.text();
      resources.set(key, {
        body,
        contentType: request.headers.get("content-type") ?? "application/octet-stream",
        version: (existing?.version ?? 0) + 1,
      });
      return new Response(null, { status: existing === undefined ? 201 : 204 });
    }
    if (existing === undefined) return new Response("not found", { status: 404 });
    return new Response(existing.body, {
      headers: { "content-type": existing.contentType, etag: `"v${existing.version}"` },
      status: 200,
    });
  };
  return { fetch: memoryFetch };
}

interface FurnisherIdentity {
  readonly webid: string;
  readonly key: KeyPair;
  readonly statusList: StatusListClient;
}

async function furnisherIdentity(
  webid: string,
  statusHost: { fetch: typeof fetch },
): Promise<FurnisherIdentity> {
  const key = await generateKeyPairForSuite(`${webid.split("#")[0]}#key-1`, "Ed25519");
  const statusList = new StatusListClient({
    fetch: statusHost.fetch,
    issuer: webid,
    key,
    url: `${new URL(webid).origin}/status/repayment`,
  });
  await statusList.create({ now: NOW, validUntil: new Date(NOW.getTime() + 180 * DAY_MS) });
  return { key, statusList, webid };
}

let nextIndex = 0;
let nextResourceId = 0;

/** Sign a fresh Repayment-History VC, subject-bound to `subjectWebid`. */
async function issueRepaymentVc(
  furnisher: FurnisherIdentity,
  subjectWebid: string,
): Promise<{ credentialId: string; turtle: string }> {
  nextIndex += 1;
  nextResourceId += 1;
  const credentialId = `${new URL(furnisher.webid).origin}/repayment/${nextResourceId}`;
  const claims: RepaymentHistoryClaims = {
    kind: "repayment-history-credential",
    latePaymentCount: 0,
    onTimePaymentCount: 18,
    periodEnd: "2026-06-15",
    periodStart: "2025-12-15",
    scheduledPaymentCount: 18,
    servicedLoan: `${new URL(furnisher.webid).origin}/offers/maya-1`,
  };
  const issued = await issueCredential({
    claims,
    credentialId,
    issuer: furnisher.webid,
    key: furnisher.key,
    kind: "repayment-history-credential",
    status: furnisher.statusList.entry(nextIndex),
    subject: subjectWebid,
    validity: {
      validFrom: new Date(NOW.getTime() - 60 * DAY_MS),
      validUntil: new Date(NOW.getTime() + 28 * DAY_MS),
    },
  });
  return { credentialId, turtle: issued.body };
}

describe("the bureau furnishing intake", () => {
  let harness: SolidTestServer;
  let caller: TestCallerIssuer;
  let otherCaller: TestCallerIssuer;
  let statusHost: { fetch: typeof fetch };
  let fintechLender: FurnisherIdentity;
  let rogueFurnisher: FurnisherIdentity;
  let service: FurnishService;
  let server: FetchServer;

  function apiUrl(path: string): string {
    return `${server.origin}${path}`;
  }

  beforeAll(async () => {
    caller = await createTestCallerIssuer();
    otherCaller = await createTestCallerIssuer();

    harness = await startSolidServer({
      oidc: true,
      seedFixtures: (account) => [
        profileCardFixture({
          name: "Maya Torres",
          storage: `${account.baseUrl}/`,
          webid: caller.webid,
        }),
      ],
    });
    const primary = harness.accounts[0];
    if (primary === undefined) throw new Error("harness produced no primary account");
    caller.setStorage(`${primary.baseUrl}/`);

    // A SECOND, fully independent borrower pod (isolation test below).
    const secondPod: SolidTestAccount = await harness.provisionAccount();
    await seedPod(
      secondPod.baseUrl,
      [
        profileCardFixture({
          name: "Second Borrower",
          storage: `${secondPod.baseUrl}/`,
          webid: otherCaller.webid,
        }),
      ],
      { fetch: secondPod.authFetch, ownerWebid: secondPod.webid },
    );
    otherCaller.setStorage(`${secondPod.baseUrl}/`);

    statusHost = memoryStatusHost();
    fintechLender = await furnisherIdentity(FINTECH_LENDER_WEBID, statusHost);
    rogueFurnisher = await furnisherIdentity(ROGUE_FURNISHER_WEBID, statusHost);

    service = createFurnishService({
      guardConfig: {
        // Each provisioned account boots on its OWN origin (test-kit: "one
        // server instance per identity") — both borrower pods must be
        // allowlisted.
        allowedPodOrigins: [harness.baseUrl, secondPod.baseUrl],
        allowInsecureLoopback: true,
        trustedOidcIssuers: [caller.origin, otherCaller.origin],
      },
      now: () => NOW,
      // This test drives the service directly (no Next.js basePath-stripping
      // in front of it, unlike the real route) — the request URL IS the
      // public URL the caller signed its DPoP proof against.
      publicRequestUrl: (request) => request.url,
      seams: {
        isControlledBy: (vm, issuer) =>
          (issuer === fintechLender.webid && vm === fintechLender.key.verificationMethod) ||
          (issuer === rogueFurnisher.webid && vm === rogueFurnisher.key.verificationMethod),
        resolveKey: async (vm) => {
          if (vm === fintechLender.key.verificationMethod) return fintechLender.key.publicKey;
          if (vm === rogueFurnisher.key.verificationMethod) return rogueFurnisher.key.publicKey;
          return undefined;
        },
        statusFetch: statusHost.fetch,
      },
      trustedFurnishers: [fintechLender.webid],
    });

    server = await startFetchServer((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/api/furnish" && request.method === "POST") {
        return service.furnish(request);
      }
      if (url.pathname === "/api/furnished" && request.method === "GET") {
        return service.furnished(request);
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
  }, 60_000);

  afterAll(async () => {
    await server?.stop();
    await caller?.close();
    await otherCaller?.close();
    await harness?.stop();
  });

  test("anonymous POST /api/furnish and GET /api/furnished are 401", async () => {
    const post = await fetch(apiUrl("/api/furnish"), {
      body: JSON.stringify({ credential: "x" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(post.status).toBe(401);
    expect(post.headers.get("www-authenticate")).toBeTruthy();

    const get = await fetch(apiUrl("/api/furnished"));
    expect(get.status).toBe(401);
  });

  test("a caller-supplied webid override is rejected 400 before any verification", async () => {
    const response = await caller.fetch(apiUrl("/api/furnish"), {
      body: JSON.stringify({ credential: "x", webid: "https://attacker.example/#me" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("param_rejected");
  });

  test("an unconfigured trusted-furnisher allowlist fails closed 503", async () => {
    const unconfigured = createFurnishService({
      guardConfig: {
        allowedPodOrigins: [harness.baseUrl],
        allowInsecureLoopback: true,
        trustedOidcIssuers: [caller.origin],
      },
      publicRequestUrl: (request) => request.url,
      trustedFurnishers: [],
    });
    const unconfiguredServer = await startFetchServer((request) => unconfigured.furnish(request));
    try {
      const response = await caller.fetch(unconfiguredServer.origin, {
        body: JSON.stringify({ credential: "x" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(response.status).toBe(503);
    } finally {
      await unconfiguredServer.stop();
    }
  });

  test("a malformed body is rejected 400 before any cryptographic work", async () => {
    const missing = await caller.fetch(apiUrl("/api/furnish"), {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(missing.status).toBe(400);

    const wrongType = await caller.fetch(apiUrl("/api/furnish"), {
      body: JSON.stringify({ credential: 42 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(wrongType.status).toBe(400);
  });

  let admittedCredentialId: string;

  test("a REAL fintech-lender-signed Repayment-History VC is admitted and appears in the caller's own view", async () => {
    const { credentialId, turtle } = await issueRepaymentVc(fintechLender, caller.webid);
    admittedCredentialId = credentialId;

    const response = await caller.fetch(apiUrl("/api/furnish"), {
      body: JSON.stringify({ credential: turtle }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const result = (await response.json()) as {
      furnished: { credentialId: string; onTimePaymentCount: number; latePaymentCount: number };
    };
    expect(result.furnished.credentialId).toBe(credentialId);
    expect(result.furnished.onTimePaymentCount).toBe(18);
    expect(result.furnished.latePaymentCount).toBe(0);

    const view = await caller.fetch(apiUrl("/api/furnished"));
    expect(view.status).toBe(200);
    const { tradelines } = (await view.json()) as {
      tradelines: readonly { credentialId: string }[];
    };
    expect(tradelines.map((entry) => entry.credentialId)).toContain(credentialId);
  });

  test("an UNTRUSTED issuer's otherwise-valid credential is refused and never recorded", async () => {
    const { turtle } = await issueRepaymentVc(rogueFurnisher, caller.webid);
    const response = await caller.fetch(apiUrl("/api/furnish"), {
      body: JSON.stringify({ credential: turtle }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(403);
    const result = (await response.json()) as { errors: string[] };
    expect(result.errors).toContain("UNTRUSTED_ISSUER");
  });

  test("a TAMPERED credential fails the real signature reconstruction and is never recorded", async () => {
    const { turtle } = await issueRepaymentVc(fintechLender, caller.webid);
    // The signed claim graph carries `lend:onTimePaymentCount 18` as a bare
    // Turtle integer literal — flip it post-signature so the reconstructed
    // document quads no longer match what was signed.
    const tampered = turtle.replace(
      "<urn:example:lend#onTimePaymentCount> 18;",
      "<urn:example:lend#onTimePaymentCount> 99;",
    );
    expect(tampered).not.toBe(turtle);
    const response = await caller.fetch(apiUrl("/api/furnish"), {
      body: JSON.stringify({ credential: tampered }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(403);
    const result = (await response.json()) as { errors: string[] };
    expect(result.errors).toContain("INVALID_SIGNATURE");
  });

  test("a credential bound to a DIFFERENT subject is refused even though genuinely signed by a trusted furnisher", async () => {
    const { turtle } = await issueRepaymentVc(fintechLender, otherCaller.webid);
    const response = await caller.fetch(apiUrl("/api/furnish"), {
      body: JSON.stringify({ credential: turtle }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(403);
    const result = (await response.json()) as {
      checks: { subjectBound: boolean };
      errors: string[];
    };
    expect(result.checks.subjectBound).toBe(false);
    expect(result.errors).toContain("SUBJECT_MISMATCH");
  });

  test("furnishing the SAME credential twice is refused 409", async () => {
    const stored = await caller.fetch(apiUrl("/api/furnished"));
    const { tradelines } = (await stored.json()) as {
      tradelines: readonly { credentialId: string }[];
    };
    expect(tradelines.map((entry) => entry.credentialId)).toContain(admittedCredentialId);

    const fresh = await issueRepaymentVc(fintechLender, caller.webid);
    const first = await caller.fetch(apiUrl("/api/furnish"), {
      body: JSON.stringify({ credential: fresh.turtle }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(first.status).toBe(200);
    const second = await caller.fetch(apiUrl("/api/furnish"), {
      body: JSON.stringify({ credential: fresh.turtle }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(second.status).toBe(409);
  });

  test("a DIFFERENT borrower's furnished view never contains this caller's tradelines (isolation)", async () => {
    const { credentialId, turtle } = await issueRepaymentVc(fintechLender, otherCaller.webid);
    const response = await otherCaller.fetch(apiUrl("/api/furnish"), {
      body: JSON.stringify({ credential: turtle }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(200);

    const otherView = await otherCaller.fetch(apiUrl("/api/furnished"));
    const { tradelines: otherTradelines } = (await otherView.json()) as {
      tradelines: readonly { credentialId: string }[];
    };
    expect(otherTradelines.map((entry) => entry.credentialId)).toEqual([credentialId]);

    const callerView = await caller.fetch(apiUrl("/api/furnished"));
    const { tradelines: callerTradelines } = (await callerView.json()) as {
      tradelines: readonly { credentialId: string }[];
    };
    expect(callerTradelines.map((entry) => entry.credentialId)).not.toContain(credentialId);
  });
});
