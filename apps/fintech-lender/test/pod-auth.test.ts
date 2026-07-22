/**
 * Scene-3 authenticated-caller boundary + the REAL grant boundary, against a
 * real @jeswr/solid-server pod (`@lending/test-kit`), real DPoP-bound
 * Solid-OIDC tokens (loopback dev issuers), the app's REAL client-credentials
 * service identity reading through a REAL borrower grant, and REAL
 * Ed25519-signed credentials verified by the real vc-kit verifier — no mocked
 * auth/verify/ZK anywhere.
 *
 * Acceptance (the sm-qz3j.5 security bar):
 *   - anonymous callers are rejected (401 + WWW-Authenticate);
 *   - an unconfigured service identity fails closed (503) — never anonymous IO;
 *   - a NON-granted reader is denied by the pod's WAC, never treated as "no data";
 *   - the happy path reads the REAL granted loan file, runs the two-model
 *     decision, and writes the shape-valid Reg Z offer into the pod;
 *   - a TAMPERED (wrongly-issued) credential downgrades the run to "refer",
 *     never "approve";
 *   - revoking the grant genuinely shuts the read off (real WAC).
 */
import { LoanOfferCredential, RESOURCE_POD_PATHS, validate } from "@lending/data-model";
import {
  CREDENTIAL_POD_PATHS,
  createLendingIssuance,
  ISSUER_ROLES,
  mayaTorres,
  seedLendingPod,
} from "@lending/seeds";
import {
  profileCardFixture,
  seedPod,
  startSolidServer,
  type SolidTestAccount,
  type SolidTestServer,
} from "@lending/test-kit";
import { exportPrivateJwk, generateKeyPairForSuite, issueCredential } from "@lending/vc-kit";
import { DataFactory, Parser, Store } from "n3";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { FintechLenderConfig } from "../lib/server/config";
import { createPodRailService, type PodRailService } from "../lib/server/pod-rail";
import type { OriginationReport } from "../lib/server/origination";
import type { FurnishHistoryReport, RepaymentGrantView } from "../lib/server/servicing";
import { startDevServiceIssuer, startDevUserIssuer } from "./dev-issuer";
import { resourceGrantAcl, ownerOnlyAcl } from "./grant-acl";
import { serveHandler, type RouteServer } from "./route-server";

const NOW = new Date();
const CLIENT = { clientId: "fintech-lender-service", clientSecret: "test-fintech-secret" };
const ROGUE_CLIENT = { clientId: "rogue-fintech-service", clientSecret: "test-rogue-secret" };
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
 * `@lending/test-kit`'s own OIDC accounts are `http:`-scheme (accepted fine
 * by the sparq POD SERVER's own token check, but not by this app's route
 * guard). See `./dev-issuer.ts`'s `startDevUserIssuer` header.
 */
let presenter: Awaited<ReturnType<typeof startDevUserIssuer>>;
let podRoot: string;
let serviceIssuer: Awaited<ReturnType<typeof startDevServiceIssuer>>;
let rogueIssuer: Awaited<ReturnType<typeof startDevServiceIssuer>>;
let config: FintechLenderConfig;
let service: PodRailService;
let route: RouteServer;

function credentialUrl(path: keyof typeof CREDENTIAL_POD_PATHS): string {
  return `${podRoot}${CREDENTIAL_POD_PATHS[path]}`;
}

function offerUrl(): string {
  return `${podRoot}${RESOURCE_POD_PATHS["loan-offer-credential"]}`;
}

function historyUrl(): string {
  return `${podRoot}${RESOURCE_POD_PATHS["repayment-history-credential"]}`;
}

/**
 * Grant `agentWebid` Read on every one of the five credential resources
 * (least-privilege, per-resource — matches the seeder's own per-resource ACL
 * model). Rewritten AS `presenter`: `@lending/seeds`' owner-only access spec
 * grants Control over each seeded resource to the SEED TARGET's WebID
 * (`presenter.webId`, since credentials assert her as subject) — not
 * `borrower.webid` (the pod's raw account identity), which therefore cannot
 * rewrite these specific ACLs even though it owns the pod overall.
 */
async function grantCredentials(agentWebid: string): Promise<void> {
  for (const path of Object.values(CREDENTIAL_POD_PATHS)) {
    const resourcePath = path;
    const response = await presenter.authFetch(`${podRoot}${resourcePath}.acl`, {
      body: resourceGrantAcl(resourcePath, { agentWebid, ownerWebid: presenter.webId }),
      headers: { "content-type": "text/turtle" },
      method: "PUT",
    });
    if (!response.ok)
      throw new Error(`grant ACL PUT failed for ${resourcePath}: ${response.status}`);
  }
}

async function revokeGrant(): Promise<void> {
  for (const path of Object.values(CREDENTIAL_POD_PATHS)) {
    const response = await presenter.authFetch(`${podRoot}${path}.acl`, {
      body: ownerOnlyAcl(path, presenter.webId),
      headers: { "content-type": "text/turtle" },
      method: "PUT",
    });
    if (!response.ok) throw new Error(`revoke ACL PUT failed for ${path}: ${response.status}`);
  }
}

/**
 * Grant `agentWebid` Read+Write over the WHOLE `/lending/` container via
 * `acl:default` inheritance — new-resource creation (the loan-offer and
 * repayment-history documents this app writes at runtime) is authorized
 * against the NEAREST container's effective ACL, since the target resource
 * does not exist yet and so carries no resource-level ACL of its own.
 * Resources that DO already carry their own resource-level ACL (the five
 * seeded credentials) are unaffected — a resource-level ACL always takes
 * precedence over an inherited container default.
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

beforeAll(async () => {
  pods = await startSolidServer({ oidc: true });
  const primary = pods.accounts[0];
  if (primary === undefined) throw new Error("OIDC harness did not provision an owner");
  borrower = primary;
  podRoot = new URL(borrower.baseUrl).origin;

  presenter = await startDevUserIssuer({ storage: `${podRoot}/` });

  // Backward acknowledgment (the pod's own owner-only-writable profile card
  // names `presenter` as this pod's authorized WebID) — the L2 binding
  // `resolveAuthorizedPod` requires, publicly readable (its own check reads
  // it anonymously) via `@lending/test-kit`'s `profileCardFixture`.
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

  await grantCredentials(serviceIssuer.webId);
  await grantContainerWrite(serviceIssuer.webId);

  const trustedCredentialIssuers = Object.values(ISSUER_ROLES).map(
    (role) => `${podRoot}${role.docPath}`,
  );

  const fintechLenderWebId = "https://fintech-lender.example/orgs/installment-lending#id";
  const lenderVerificationMethod = `${fintechLenderWebId.split("#")[0]}#vc-key`;
  const lenderKey = await generateKeyPairForSuite(lenderVerificationMethod, "Ed25519");
  const lenderKeyJwk = await exportPrivateJwk(lenderKey);

  config = {
    allowedPodOrigins: [podRoot],
    allowInsecureLoopback: true,
    fintechLenderWebId,
    issuerKeyJwk: JSON.stringify(lenderKeyJwk),
    issuerKeyVerificationMethod: lenderVerificationMethod,
    podServiceClientId: CLIENT.clientId,
    podServiceClientSecret: CLIENT.clientSecret,
    podServiceIssuer: serviceIssuer.issuer,
    statusListUrl: `${podRoot}/lending/status/fintech-repayment`,
    serviceWebId: serviceIssuer.webId,
    trustedAnchorIssuers: [],
    trustedCredentialIssuers,
    trustedOidcIssuers: [presenter.issuer],
    trustForwardedHeaders: false,
  };
  service = createPodRailService({ config, now: () => NOW, ownerSeams: OWNER_SEAMS });
  route = await serveHandler((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/application/submit")) return service.applicationSubmit(request);
    if (url.pathname.endsWith("/servicing/repayment-grant"))
      return service.servicingRepaymentGrant(request);
    if (url.pathname.endsWith("/servicing/furnish-history"))
      return service.servicingFurnishHistory(request);
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
  test("a service identity the grant does not name is denied by the pod — no offer written", async () => {
    const rogue = createPodRailService({
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
      const offerRead = await borrower.authFetch(offerUrl());
      expect(offerRead.status).toBe(404);
    } finally {
      await localRoute.stop();
    }
  }, 60_000);
});

describe("the authenticated happy path — real grant read, real verification, two-model decision", () => {
  test("submit: verifies the real credentials, approves via cash-flow, declines via bureau-only, delivers the Reg Z offer", async () => {
    const response = await presenter.authFetch(apiUrl("/application/submit"), { method: "POST" });
    expect(response.status).toBe(200);
    const report = (await response.json()) as OriginationReport;

    expect(report.decision.outcome).toBe("approve");
    expect(report.decision.evidenceFindings.every((finding) => finding.pass)).toBe(true);

    // The signature contrast: bureau-only declines Maya (612, 2 tradelines, 14mo);
    // bureau + cash-flow approves her at the persona-pinned $2,000/18mo/32.9% APR.
    expect(report.decision.bureauOnly?.outcome).toBe("decline");
    expect(report.decision.bureauOnly?.adverseActionReasons).toContain(
      "insufficient credit history",
    );
    expect(report.decision.bureauOnly?.adverseActionReasons).toContain("limited tradelines");
    expect(report.decision.cashFlowPlus?.outcome).toBe("approve");
    expect(report.decision.cashFlowPlus?.offer?.aprPercent).toBe(32.9);
    expect(report.decision.cashFlowPlus?.offer?.paymentAmountUsd).toBe(142.26);
    expect(report.decision.cashFlowPlus?.offer?.totalOfPaymentsUsd).toBe(2560.68);
    expect(report.decision.cashFlowPlus?.offer?.financeChargeUsd).toBe(560.68);
    expect((report.decision.cashFlowPlus?.offer?.aprPercent ?? 100) < 36).toBe(true);

    expect(report.offerIri).toBe(offerUrl());
    const written = await borrower.authFetch(offerUrl(), { headers: { accept: "text/turtle" } });
    expect(written.status).toBe(200);
    const turtle = await written.text();
    const shapeReport = await validate(turtle, {
      baseIRI: offerUrl(),
      expect: "loan-offer-credential",
      focusNode: offerUrl(),
    });
    expect(shapeReport.conforms).toBe(true);
    const store = new Store(
      new Parser({ baseIRI: offerUrl(), format: "text/turtle" }).parse(turtle),
    );
    const offer = new LoanOfferCredential(DataFactory.namedNode(offerUrl()), store, DataFactory);
    expect(offer.credentialSubjectIri).toBe(presenter.webId);
    expect(offer.credentialSubject.loanOffer.aprPercent).toBe(32.9);

    // Not public: only the granted service identity (and the owner) can read it.
    const anonymous = await fetch(offerUrl());
    expect(anonymous.ok).toBe(false);
  }, 120_000);
});

describe("scene 5 — servicing reads the delivered offer over the same grant", () => {
  test("repayment-grant view renders the delivered offer's terms + 1041 rails", async () => {
    const response = await presenter.authFetch(apiUrl("/servicing/repayment-grant"), {
      method: "POST",
    });
    expect(response.status).toBe(200);
    const view = (await response.json()) as RepaymentGrantView;
    expect(view.principalUsd).toBe(2000);
    expect(view.paymentAmountUsd).toBe(142.26);
    expect(view.autopayOptional).toBe(true);
    expect(view.rails.paymentProvisions).toContain("1041");
  });

  test("furnish-history writes a shape-valid repayment-history credential linked to the offer", async () => {
    const response = await presenter.authFetch(apiUrl("/servicing/furnish-history"), {
      method: "POST",
    });
    expect(response.status).toBe(200);
    const report = (await response.json()) as FurnishHistoryReport;
    expect(report.servicedLoanIri).toBe(offerUrl());
    expect(report.historyIri).toBe(historyUrl());

    const written = await borrower.authFetch(historyUrl(), { headers: { accept: "text/turtle" } });
    expect(written.status).toBe(200);
    const turtle = await written.text();
    const shapeReport = await validate(turtle, {
      baseIRI: historyUrl(),
      expect: "repayment-history-credential",
      focusNode: historyUrl(),
    });
    expect(shapeReport.conforms).toBe(true);
  });
});

describe("a tampered credential downgrades the run to refer, never approve", () => {
  test("an income credential signed by an UNTRUSTED issuer fails the evidence gate", async () => {
    const rogueKey = await generateKeyPairForSuite("https://rogue.example/issuer#key-1", "Ed25519");
    const persona = mayaTorres();
    const tampered = await issueCredential({
      claims: {
        employer: { name: persona.employerName },
        jobTitle: persona.jobTitle,
        kind: "employment-income-credential",
        netMonthlyIncomeUsd: persona.netMonthlyIncomeUsd,
        startDate: persona.employmentStartDate,
      },
      credentialId: credentialUrl("income"),
      issuer: "https://rogue.example/issuer#key-1",
      key: rogueKey,
      kind: "employment-income-credential",
      status: {
        statusListCredential: "https://rogue.example/status/income",
        statusListIndex: 1,
        statusPurpose: "revocation",
      },
      subject: presenter.webId,
      validity: {
        validFrom: new Date(NOW.getTime() - 1000),
        validUntil: new Date(NOW.getTime() + 60 * 24 * 60 * 60 * 1000),
      },
    });
    const put = await presenter.authFetch(credentialUrl("income"), {
      body: tampered.body,
      headers: { "content-type": "text/turtle" },
      method: "PUT",
    });
    expect(put.ok).toBe(true);

    const response = await presenter.authFetch(apiUrl("/application/submit"), { method: "POST" });
    expect(response.status).toBe(200);
    const report = (await response.json()) as OriginationReport;
    expect(report.decision.outcome).toBe("refer");
    expect(report.decision.bureauOnly).toBeUndefined();
    expect(report.decision.cashFlowPlus).toBeUndefined();
    const incomeFinding = report.decision.evidenceFindings.find(
      (finding) => finding.code === "EVIDENCE_INCOME",
    );
    expect(incomeFinding?.pass).toBe(false);
  }, 60_000);
});

describe("revocation genuinely shuts the read off (real WAC)", () => {
  test("after the borrower revokes the grant, the service identity is denied by the pod", async () => {
    await revokeGrant();
    const response = await presenter.authFetch(apiUrl("/application/submit"), { method: "POST" });
    expect(response.ok).toBe(false);
    expect([401, 403]).toContain(response.status);

    // The pod itself still serves its owner (revocation removed one agent, not the data).
    const ownerRead = await presenter.authFetch(credentialUrl("income"));
    expect(ownerRead.status).toBe(200);
  }, 60_000);
});
