/**
 * Scene-3 authenticated-caller boundary + the REAL grant boundary, against a
 * real @jeswr/solid-server pod (`@lending/test-kit`), real DPoP-bound
 * Solid-OIDC tokens (loopback dev issuers), the app's REAL client-credentials
 * service identity reading through a REAL borrower grant, and REAL
 * Ed25519-signed credentials verified by the real vc-kit verifier — no mocked
 * auth/verify/ZK anywhere.
 *
 * Acceptance (the sm-qz3j.5 security bar, played from the bank's seat):
 *   - anonymous callers are rejected (401 + WWW-Authenticate);
 *   - an unconfigured service identity fails closed (503) — never anonymous IO;
 *   - a NON-granted reader is denied by the pod's WAC, never treated as "no data";
 *   - the happy path reads ONLY the REAL granted credit-score credential (no
 *     cash-flow evidence is ever touched), runs the BUREAU-ONLY decision, and
 *     writes the Reg B adverse-action notice into the pod for the thin-file
 *     persona — the demo's signature contrast with the fintech-lender sibling's
 *     cash-flow approval over the SAME borrower;
 *   - a borrower whose bureau file clears the bar is genuinely APPROVED and
 *     gets a real Reg-Z-shaped offer written instead;
 *   - a TAMPERED (untrusted-issuer) credential downgrades the run to "refer",
 *     never "decline" or "approve";
 *   - revoking the grant genuinely shuts the read off (real WAC).
 */
import { Buffer } from "node:buffer";
import { validate } from "@lending/data-model";
import {
  CREDENTIAL_POD_PATHS,
  createLendingIssuance,
  ISSUER_ROLES,
  mayaTorres,
  seedLendingPod,
} from "@lending/seeds";
import {
  profileCardFixture,
  publicReadAcl,
  seedPod,
  startSolidServer,
  type SolidTestAccount,
  type SolidTestServer,
} from "@lending/test-kit";
import {
  generateKeyPairForSuite,
  issueCredential,
  MIN_STATUS_LIST_LENGTH,
  publishVerificationMethod,
  StatusListClient,
} from "@lending/vc-kit";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { BankLenderConfig } from "../lib/server/config";
import { createPodRailService, type PodRailService } from "../lib/server/pod-rail";
import type { OriginationReport } from "../lib/server/origination";
import { startDevServiceIssuer, startDevUserIssuer } from "./dev-issuer";
import { resourceGrantAcl, ownerOnlyAcl } from "./grant-acl";
import { serveHandler, type RouteServer } from "./route-server";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date();
const CLIENT = { clientId: "bank-lender-service", clientSecret: "test-bank-secret" };
const ROGUE_CLIENT = { clientId: "rogue-bank-service", clientSecret: "test-rogue-secret" };
/**
 * `resolveAuthorizedPod`'s DEFAULT owner-binding fetch rewrites
 * `https://<loopback>` to `http://<loopback>` for dev issuers that only
 * speak plain HTTP — `presenter` (`./dev-issuer.ts`) runs a REAL HTTPS
 * loopback listener instead, so that rewrite must be skipped: a plain fetch
 * (TLS verification already relaxed process-wide for this self-signed dev
 * cert by `startDevUserIssuer`) resolves it correctly.
 */
const OWNER_SEAMS = { profileFetch: fetch };

let pods: SolidTestServer;
/** Owns + can read/write anything on the pod (raw seeding/ACL fixture writes only). */
let borrower: SolidTestAccount;
/**
 * The identity Maya's session presents to THIS APP's own routes — decoupled
 * from `borrower` because `@jeswr/solid-api-auth`'s `DpopApiVerifier` hard-
 * requires an `https:`-scheme WebID (no loopback exception), while
 * `@lending/test-kit`'s own OIDC accounts are `http:`-scheme.
 */
let presenter: Awaited<ReturnType<typeof startDevUserIssuer>>;
let podRoot: string;
let serviceIssuer: Awaited<ReturnType<typeof startDevServiceIssuer>>;
let rogueIssuer: Awaited<ReturnType<typeof startDevServiceIssuer>>;
let config: BankLenderConfig;
let service: PodRailService;
let route: RouteServer;

function creditScoreUrl(): string {
  return `${podRoot}${CREDENTIAL_POD_PATHS.creditScore}`;
}

function adverseActionUrl(): string {
  return `${podRoot}/lending/adverse-action`;
}

function bankOfferUrl(): string {
  return `${podRoot}/lending/bank-offer`;
}

/** Least-privilege grant: Read on the credit-score credential ONLY (design: bureau-only). */
async function grantCreditScore(agentWebid: string): Promise<void> {
  const response = await presenter.authFetch(`${creditScoreUrl()}.acl`, {
    body: resourceGrantAcl(CREDENTIAL_POD_PATHS.creditScore, {
      agentWebid,
      ownerWebid: presenter.webId,
    }),
    headers: { "content-type": "text/turtle" },
    method: "PUT",
  });
  if (!response.ok) throw new Error(`grant ACL PUT failed for credit-score: ${response.status}`);
}

async function revokeGrant(): Promise<void> {
  const response = await presenter.authFetch(`${creditScoreUrl()}.acl`, {
    body: ownerOnlyAcl(CREDENTIAL_POD_PATHS.creditScore, presenter.webId),
    headers: { "content-type": "text/turtle" },
    method: "PUT",
  });
  if (!response.ok) throw new Error(`revoke ACL PUT failed for credit-score: ${response.status}`);
}

/**
 * Grant `agentWebid` Read+Write over the WHOLE `/lending/` container via
 * `acl:default` inheritance — new-resource creation (the adverse-action
 * notice / bank-offer documents this app writes at runtime) is authorized
 * against the NEAREST container's effective ACL, since the target resource
 * does not exist yet and so carries no resource-level ACL of its own.
 */
async function grantContainerWrite(agentWebid: string): Promise<void> {
  const response = await borrower.authFetch(`${podRoot}/lending/.acl`, {
    body: `@prefix acl: <http://www.w3.org/ns/auth/acl#> .

<#owner>
    a acl:Authorization ;
    acl:accessTo </lending/> ;
    acl:default </lending/> ;
    acl:agent <${borrower.webid}> ;
    acl:mode acl:Read, acl:Write, acl:Control .

<#grant>
    a acl:Authorization ;
    acl:accessTo </lending/> ;
    acl:default </lending/> ;
    acl:agent <${agentWebid}> ;
    acl:mode acl:Read, acl:Write .
`,
    headers: { "content-type": "text/turtle" },
    method: "PUT",
  });
  if (!response.ok) throw new Error(`container write grant ACL PUT failed: ${response.status}`);
}

function apiUrl(path: string): string {
  return `${route.url}${path}`;
}

/**
 * Publish a FRESH, genuinely resolvable trusted issuer on the test pod — a
 * real WebID document (`publishVerificationMethod`) and a real hosted
 * Bitstring status list, both public-read, exactly like the seeder's own
 * issuer seats. Used by the approve-path and tamper tests to sign a REPLACEMENT
 * credit-score credential without touching the seeded issuer's private key
 * (internal to `@lending/seeds`, not exposed to app tests).
 */
async function publishTestIssuer(label: string): Promise<{
  webId: string;
  key: Awaited<ReturnType<typeof generateKeyPairForSuite>>;
  status: StatusListClient;
}> {
  const docPath = `/lending/issuers/test-${label}`;
  const webId = `${podRoot}${docPath}`;
  const key = await generateKeyPairForSuite(`${webId}#key-1`, "Ed25519");
  const published = await publishVerificationMethod({ controller: webId, key });
  const docPut = await borrower.authFetch(webId, {
    body: published.turtle,
    headers: { "content-type": "text/turtle" },
    method: "PUT",
  });
  if (!docPut.ok) throw new Error(`test issuer doc PUT failed: ${docPut.status}`);
  const docAcl = await borrower.authFetch(`${webId}.acl`, {
    body: publicReadAcl(docPath, borrower.webid),
    headers: { "content-type": "text/turtle" },
    method: "PUT",
  });
  if (!docAcl.ok) throw new Error(`test issuer doc ACL PUT failed: ${docAcl.status}`);

  const statusPath = `/lending/status/test-${label}`;
  const statusUrl = `${podRoot}${statusPath}`;
  const status = new StatusListClient({
    fetch: borrower.authFetch,
    issuer: webId,
    key,
    url: statusUrl,
  });
  await status.create({ bits: Buffer.alloc(MIN_STATUS_LIST_LENGTH / 8), now: NOW });
  const statusAcl = await borrower.authFetch(`${statusUrl}.acl`, {
    body: publicReadAcl(statusPath, borrower.webid),
    headers: { "content-type": "text/turtle" },
    method: "PUT",
  });
  if (!statusAcl.ok) throw new Error(`test issuer status ACL PUT failed: ${statusAcl.status}`);

  return { key, status, webId };
}

beforeAll(async () => {
  pods = await startSolidServer({ oidc: true });
  const primary = pods.accounts[0];
  if (primary === undefined) throw new Error("OIDC harness did not provision an owner");
  borrower = primary;
  podRoot = new URL(borrower.baseUrl).origin;

  presenter = await startDevUserIssuer({ storage: `${podRoot}/` });

  await seedPod(
    borrower.baseUrl,
    [
      profileCardFixture({
        name: "Maya Torres",
        oidcIssuer: presenter.issuer,
        storage: `${podRoot}/`,
        webid: presenter.webId,
      }),
    ],
    { fetch: borrower.authFetch, ownerWebid: borrower.webid },
  );

  const issuance = createLendingIssuance({ now: NOW, podOrigin: borrower.baseUrl });
  await seedLendingPod({
    issuance,
    mode: "create",
    now: NOW,
    target: { authFetch: borrower.authFetch, baseUrl: borrower.baseUrl, webid: presenter.webId },
  });

  [serviceIssuer, rogueIssuer] = await Promise.all([
    startDevServiceIssuer({ clients: [CLIENT] }),
    startDevServiceIssuer({ clients: [ROGUE_CLIENT] }),
  ]);

  // Least-privilege: grant Read on the credit-score credential ONLY — this
  // desk never asks for income, bank cash-flow, or cash-flow-score access.
  await grantCreditScore(serviceIssuer.webId);
  await grantContainerWrite(serviceIssuer.webId);

  config = {
    allowedPodOrigins: [podRoot],
    allowInsecureLoopback: true,
    bankLenderWebId: "https://bank-lender.example/orgs/personal-loan-desk#id",
    podServiceClientId: CLIENT.clientId,
    podServiceClientSecret: CLIENT.clientSecret,
    podServiceIssuer: serviceIssuer.issuer,
    serviceWebId: serviceIssuer.webId,
    // Bureau-only, deliberately: only the credit bureau's issuer is trusted —
    // this app never verifies (and therefore never trusts) the income/cash-flow
    // issuers the fintech-lender sibling relies on.
    trustedAnchorIssuers: [],
    trustedCredentialIssuers: [`${podRoot}${ISSUER_ROLES.creditBureau.docPath}`],
    trustedOidcIssuers: [presenter.issuer],
    trustForwardedHeaders: false,
  };
  service = createPodRailService({
    config,
    now: () => NOW,
    ownerSeams: OWNER_SEAMS,
    publicRequestUrl: (request) => request.url,
  });
  route = await serveHandler((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/application/submit")) return service.applicationSubmit(request);
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
}, 120_000);

afterAll(async () => {
  await route?.stop();
  await pods?.stop();
  await presenter?.stop();
  await serviceIssuer?.stop();
  await rogueIssuer?.stop();
});

describe("boundary rejections", () => {
  test("anonymous callers get 401 + WWW-Authenticate", async () => {
    const response = await fetch(apiUrl("/application/submit"), { method: "POST" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).not.toBeNull();
  });

  test("an unconfigured service identity fails closed (503) — never anonymous IO", async () => {
    const unconfigured = createPodRailService({
      publicRequestUrl: (request) => request.url,
      config: { ...config, podServiceClientSecret: undefined },
      now: () => NOW,
      ownerSeams: OWNER_SEAMS,
    });
    const localRoute = await serveHandler((request) => unconfigured.applicationSubmit(request));
    try {
      const response = await presenter.authFetch(`${localRoute.url}/application/submit`, {
        method: "POST",
      });
      expect(response.status).toBe(503);
    } finally {
      await localRoute.stop();
    }
  });
});

describe("the grant boundary is the pod's own WAC", () => {
  test("a service identity the grant does not name is denied by the pod — no notice written", async () => {
    const rogue = createPodRailService({
      publicRequestUrl: (request) => request.url,
      config: {
        ...config,
        podServiceClientId: ROGUE_CLIENT.clientId,
        podServiceClientSecret: ROGUE_CLIENT.clientSecret,
        podServiceIssuer: rogueIssuer.issuer,
        serviceWebId: rogueIssuer.webId,
      },
      now: () => NOW,
      ownerSeams: OWNER_SEAMS,
    });
    const localRoute = await serveHandler((request) => rogue.applicationSubmit(request));
    try {
      const response = await presenter.authFetch(`${localRoute.url}/application/submit`, {
        method: "POST",
      });
      expect(response.ok).toBe(false);
      expect([401, 403]).toContain(response.status);
      const noticeRead = await borrower.authFetch(adverseActionUrl());
      expect(noticeRead.status).toBe(404);
    } finally {
      await localRoute.stop();
    }
  }, 60_000);
});

describe("the authenticated happy path — real grant read, real verification, bureau-only decline", () => {
  test("submit: verifies the real credit-score credential, declines the thin file, delivers the Reg B notice", async () => {
    const response = await presenter.authFetch(apiUrl("/application/submit"), { method: "POST" });
    expect(response.status).toBe(200);
    const report = (await response.json()) as OriginationReport;

    expect(report.decision.outcome).toBe("decline");
    expect(report.decision.evidenceFindings.every((finding) => finding.pass)).toBe(true);
    expect(report.decision.adverseActionReasons).toContain("insufficient credit history");
    expect(report.decision.adverseActionReasons).toContain("limited tradelines");
    expect(report.decision.offer).toBeUndefined();
    expect(report.offerIri).toBeUndefined();

    expect(report.adverseActionIri).toBe(adverseActionUrl());
    const written = await borrower.authFetch(adverseActionUrl(), {
      headers: { accept: "text/turtle" },
    });
    expect(written.status).toBe(200);
    const turtle = await written.text();
    expect(turtle).toContain("schema:RejectAction");
    expect(turtle).toContain(presenter.webId);
    expect(turtle).toContain("insufficient credit history");
    expect(turtle).toContain("limited tradelines");
    expect(turtle).toContain("Regulation B");

    // Not public: only the granted service identity (and the owner) can read it.
    const anonymous = await fetch(adverseActionUrl());
    expect(anonymous.ok).toBe(false);
  }, 120_000);
});

describe("a borrower whose bureau file clears the bar is genuinely approved", () => {
  test("submit: a qualifying credit-score credential from a NEW trusted issuer approves and delivers an offer", async () => {
    const approveIssuer = await publishTestIssuer("bureau-approve");
    const approveCredential = await issueCredential({
      claims: {
        creditHistoryMonths: 36,
        creditScoreValue: 750,
        kind: "credit-score-credential",
        tradelineCount: 5,
      },
      credentialId: creditScoreUrl(),
      issuer: approveIssuer.webId,
      key: approveIssuer.key,
      kind: "credit-score-credential",
      status: approveIssuer.status.entry(0),
      subject: presenter.webId,
      validity: {
        validFrom: new Date(NOW.getTime() - 1000),
        validUntil: new Date(NOW.getTime() + 60 * DAY_MS),
      },
    });
    const put = await presenter.authFetch(creditScoreUrl(), {
      body: approveCredential.body,
      headers: { "content-type": "text/turtle" },
      method: "PUT",
    });
    expect(put.ok).toBe(true);

    const approveService = createPodRailService({
      publicRequestUrl: (request) => request.url,
      config: {
        ...config,
        trustedCredentialIssuers: [...config.trustedCredentialIssuers, approveIssuer.webId],
      },
      now: () => NOW,
      ownerSeams: OWNER_SEAMS,
    });
    const localRoute = await serveHandler((request) => approveService.applicationSubmit(request));
    try {
      const response = await presenter.authFetch(`${localRoute.url}/application/submit`, {
        method: "POST",
      });
      expect(response.status).toBe(200);
      const report = (await response.json()) as OriginationReport;
      expect(report.decision.outcome).toBe("approve");
      expect(report.decision.offer?.aprPercent).toBeLessThan(36);
      expect(report.offerIri).toBe(bankOfferUrl());
      expect(report.adverseActionIri).toBeUndefined();

      const written = await borrower.authFetch(bankOfferUrl(), {
        headers: { accept: "text/turtle" },
      });
      expect(written.status).toBe(200);
      const turtle = await written.text();
      const shapeReport = await validate(turtle, {
        baseIRI: bankOfferUrl(),
        expect: "loan-offer-credential",
        focusNode: bankOfferUrl(),
      });
      expect(shapeReport.conforms).toBe(true);
    } finally {
      await localRoute.stop();
    }
  }, 120_000);
});

describe("a tampered credential downgrades the run to refer, never decide", () => {
  test("a credit-score credential signed by an UNTRUSTED issuer fails the evidence gate", async () => {
    const rogueKey = await generateKeyPairForSuite("https://rogue.example/issuer#key-1", "Ed25519");
    const persona = mayaTorres();
    const tampered = await issueCredential({
      claims: {
        creditHistoryMonths: persona.creditHistoryMonths,
        creditScoreValue: persona.creditScoreValue,
        kind: "credit-score-credential",
        tradelineCount: persona.tradelineCount,
      },
      credentialId: creditScoreUrl(),
      issuer: "https://rogue.example/issuer#key-1",
      key: rogueKey,
      kind: "credit-score-credential",
      status: {
        statusListCredential: "https://rogue.example/status/credit-score",
        statusListIndex: 1,
        statusPurpose: "revocation",
      },
      subject: presenter.webId,
      validity: {
        validFrom: new Date(NOW.getTime() - 1000),
        validUntil: new Date(NOW.getTime() + 60 * DAY_MS),
      },
    });
    const put = await presenter.authFetch(creditScoreUrl(), {
      body: tampered.body,
      headers: { "content-type": "text/turtle" },
      method: "PUT",
    });
    expect(put.ok).toBe(true);

    const response = await presenter.authFetch(apiUrl("/application/submit"), { method: "POST" });
    expect(response.status).toBe(200);
    const report = (await response.json()) as OriginationReport;
    expect(report.decision.outcome).toBe("refer");
    expect(report.decision.findings).toBeUndefined();
    expect(report.adverseActionIri).toBeUndefined();
    expect(report.offerIri).toBeUndefined();
    const finding = report.decision.evidenceFindings.find(
      (finding) => finding.code === "EVIDENCE_CREDIT_SCORE",
    );
    expect(finding?.pass).toBe(false);
  }, 60_000);
});

describe("revocation genuinely shuts the read off (real WAC)", () => {
  test("after the borrower revokes the grant, the service identity is denied by the pod", async () => {
    await revokeGrant();
    const response = await presenter.authFetch(apiUrl("/application/submit"), { method: "POST" });
    expect(response.ok).toBe(false);
    expect([401, 403]).toContain(response.status);

    // The pod itself still serves its owner (revocation removed one agent, not the data).
    const ownerRead = await presenter.authFetch(creditScoreUrl());
    expect(ownerRead.status).toBe(200);
  }, 60_000);
});
