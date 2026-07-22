/**
 * sm-qz3j.8 — the cross-app Small-Dollar Lending journey: five scenes on
 * ONE seeded borrower pod, real cross-zone DPoP throughout, driven against
 * SIX real Next.js dev servers (never mocked/`route.fulfill`'d). Template:
 * the mortgage showcase's `e2e/journey.spec.ts` (sm-36); design:
 * `docs/research/small-dollar-lending-design.md` §5-§6.
 *
 * Scenes:
 *   1. fill-the-vault — verify-on-view over the five seeded credentials,
 *      then a REAL re-issue through the live `verifications` rail.
 *   2. ZK pre-qualification round trip at BOTH lenders (bank + fintech).
 *   3. THE beat — the wallet grants BOTH lenders access, fintech-lender
 *      APPROVES with a real signed Reg Z offer (cash-flow-plus
 *      underwriting); bank-lender DECLINES the SAME borrower on the
 *      bureau-only model (Reg B adverse action).
 *   4. disbursement verifies the REAL offer and writes a REAL signed
 *      receipt; a repeat payout is refused.
 *   5. the fintech->bureau furnishing loop is real (a signed
 *      Repayment-History VC, POSTed under the BORROWER's own session); the
 *      wallet revokes fintech-lender's access and the ledger shows it.
 *
 * Every zone surface is asserted for the ConceptDemoBanner + a clean axe
 * (WCAG 2.1 A/AA) pass at its OWN state — never a mocked/fulfilled response.
 */
import { createLendingIssuance, ISSUER_ROLES, seedLendingPod } from "@lending/seeds";
import { PERSONA_VALUES, RESOURCE_POD_PATHS } from "@lending/data-model";
import {
  profileCardFixture,
  seedPod,
  startSolidServer,
  type SolidTestServer,
} from "@lending/test-kit";
import { exportPrivateJwk, verifyCredential } from "@lending/vc-kit";
import { expect, test } from "@playwright/test";
import { AppRunner } from "./support/app-runner";
import { acknowledgeInterstitial, expectAxeClean, expectBannerVisible } from "./support/banners";
import {
  type BorrowerSession,
  type DevServiceIssuer,
  startDevServiceIssuer,
  startDevUserIssuer,
} from "./support/dev-issuers";
import { provisionPodHostedIssuer, type ProvisionedIssuer } from "./support/issuer-provisioning";

// Six real `next dev` cold starts + real cross-zone HTTP round trips per
// scene comfortably exceed Playwright's 30s default — both the beforeAll
// boot (`testInfo.setTimeout` below) and every scene's own budget.
test.describe.configure({ mode: "serial", timeout: 180_000 });

const runner = new AppRunner();
let borrower: BorrowerSession;
let pod: SolidTestServer;
let podOrigin = "";
let podBase = "";
let seededAt = new Date();

let bankService: DevServiceIssuer;
let fintechService: DevServiceIssuer;
let disbursementService: DevServiceIssuer;
let walletService: DevServiceIssuer;
let verificationsService: DevServiceIssuer;
let bureauService: DevServiceIssuer;

let fintechIssuer: ProvisionedIssuer;
let disbursementIssuer: ProvisionedIssuer;
let freshIdentityIssuer: ProvisionedIssuer;

const origins = {
  bankLender: "",
  bureau: "",
  disbursement: "",
  fintechLender: "",
  verifications: "",
  wallet: "",
};

/** Scene 3's fintech-lender offer IRI, read in scene 3 and reused by scenes 4/5. */
let offerIri = "";

if (PERSONA_VALUES.find((persona) => persona.id === "maya-torres") === undefined) {
  throw new Error("PERSONA_VALUES has no maya-torres entry — the seeded pod would be wrong");
}

function seededIssuerWebId(role: keyof typeof ISSUER_ROLES): string {
  return `${podOrigin}${ISSUER_ROLES[role].docPath}`;
}

/** GET one pod resource's body (fixed-owner-mode: unauthenticated = owner). */
async function podBody(path: string): Promise<string> {
  const relative = path.startsWith("/") ? path.slice(1) : path;
  const response = await fetch(`${podBase}${relative}`);
  expect(response.status, `GET ${relative}`).toBe(200);
  return response.text();
}

/** One WAC authorization block. `isDefault`: also inherits to container members. */
function authorizationBlock(
  id: string,
  target: string,
  agentWebId: string,
  modes: string,
  isDefault: boolean,
): string {
  return `<#${id}>
    a acl:Authorization ;
    acl:accessTo <${target}> ;${isDefault ? `\n    acl:default <${target}> ;` : ""}
    acl:agent <${agentWebId}> ;
    acl:mode ${modes} .
`;
}

/** PUT a full ACL document (fixed-owner-mode plain fetch — the seed-time owner acts unauthenticated). */
async function putAcl(resourceIri: string, authorizations: string): Promise<void> {
  const response = await fetch(`${resourceIri}.acl`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: `@prefix acl: <http://www.w3.org/ns/auth/acl#> .\n\n${authorizations}`,
  });
  if (!response.ok) {
    throw new Error(
      `ACL PUT failed for ${resourceIri}: ${response.status} ${await response.text()}`,
    );
  }
}

const podSeams = { statusFetch: fetch.bind(globalThis), webIdFetch: fetch.bind(globalThis) };

/** Grant `party` real access to `resource` through the wallet's OWN real grant rail. */
async function walletGrant(
  party: "bank-lender" | "fintech-lender" | "disbursement",
  resource: string,
  action: "grant" | "revoke",
): Promise<{ receipt: { action: string; recipient: string; resource: string } }> {
  const response = await borrower.authFetch(`${origins.wallet}/wallet/api/grants/change`, {
    body: JSON.stringify({ action, party, resource }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(response.status, `grant ${action} ${party}/${resource}`).toBe(200);
  return (await response.json()) as {
    receipt: { action: string; recipient: string; resource: string };
  };
}

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires object-destructuring the first (fixtures) param even when unused.
test.beforeAll(async ({}, testInfo) => {
  // Booting six real `next dev` servers is minutes, not seconds.
  testInfo.setTimeout(300_000);
  // 1. Maya's own presenter (WebID + OIDC issuer) — minted BEFORE the pod so
  //    `startSolidServer({ownerWebid})` can name her as owner.
  borrower = await startDevUserIssuer();

  // 2. A DEDICATED pod, fixed-owner mode, owned by Maya's real DPoP WebID —
  //    unauthenticated (seed-time) requests are auto-granted owner access;
  //    AUTHENTICATED (real DPoP) requests are WAC-evaluated normally against
  //    whatever ACL actually names them, so every subsequent grant in this
  //    journey is a REAL access-control transition, never a fixed-owner
  //    bypass in disguise.
  pod = await startSolidServer({ ownerWebid: borrower.webid });
  const primary = pod.accounts[0];
  if (primary === undefined) throw new Error("pod booted with no primary account");
  podOrigin = new URL(primary.baseUrl).origin;
  podBase = `${podOrigin}/`;
  borrower.setStorage(podBase);

  // 3. The pod's own backward-acknowledgement profile card (L2's bidirectional check).
  await seedPod(
    podBase,
    [
      profileCardFixture({
        name: "Maya Torres",
        oidcIssuer: borrower.issuer,
        storage: podBase,
        webid: borrower.webid,
      }),
    ],
    { fetch: primary.authFetch, ownerWebid: primary.webid },
  );

  // 4. The five seeded credentials + ZK operand anchors + issuer identities/status lists.
  seededAt = new Date();
  const issuance = createLendingIssuance({ now: seededAt, podOrigin });
  await seedLendingPod({
    issuance,
    mode: "create",
    now: seededAt,
    target: { authFetch: primary.authFetch, baseUrl: podOrigin, webid: borrower.webid },
  });

  // 5. Six per-app L4 service identities (client_credentials + DPoP).
  const bankClient = { clientId: "bank-lender-service", clientSecret: "e2e-bank-secret" };
  const fintechClient = { clientId: "fintech-lender-service", clientSecret: "e2e-fintech-secret" };
  const disbursementClient = {
    clientId: "disbursement-service",
    clientSecret: "e2e-disbursement-secret",
  };
  const walletClient = { clientId: "wallet-service", clientSecret: "e2e-wallet-secret" };
  const verificationsClient = {
    clientId: "verifications-service",
    clientSecret: "e2e-verifications-secret",
  };
  const bureauClient = { clientId: "bureau-service", clientSecret: "e2e-bureau-secret" };
  [
    bankService,
    fintechService,
    disbursementService,
    walletService,
    verificationsService,
    bureauService,
  ] = await Promise.all([
    startDevServiceIssuer({ clients: [bankClient] }),
    startDevServiceIssuer({ clients: [fintechClient] }),
    startDevServiceIssuer({ clients: [disbursementClient] }),
    startDevServiceIssuer({ clients: [walletClient] }),
    startDevServiceIssuer({ clients: [verificationsClient] }),
    startDevServiceIssuer({ clients: [bureauClient] }),
  ]);

  // 6. ACL provisioning: the WALLET's service identity is the SOLE ACL writer
  //    for every party grant/revoke transition (`apps/wallet/lib/grants/engine.ts`
  //    rebuilds each resource's OWN `.acl` on every grant) — it needs
  //    Read/Write/Control on the `/lending/` container (with `acl:default`,
  //    so it can create + lock not-yet-existing resources: the loan offer,
  //    disbursement receipt, repayment history). `verifications` and
  //    `bureau` are the CREATORS of the five seeded credential resources
  //    (their OWN issue/re-issue rails, never mediated by the wallet's grant
  //    catalogue) — each seeded credential's `@jeswr/solid-seed` ACL is
  //    explicit and owner-only (shadows any container default), so it is
  //    rewritten here to ALSO grant the wallet's Control (future grants) and
  //    the originating issuer's Read/Write (re-issue). Neither bank-lender,
  //    fintech-lender, nor disbursement is granted ANYTHING here — every
  //    byte of THEIR access comes from a REAL wallet grant call in scene 3/4.
  const lendingContainer = `${podBase}lending/`;
  await putAcl(
    lendingContainer,
    authorizationBlock(
      "owner",
      lendingContainer,
      borrower.webid,
      "acl:Read, acl:Write, acl:Control",
      true,
    ) +
      authorizationBlock(
        "wallet-service",
        lendingContainer,
        walletService.webId,
        "acl:Read, acl:Write, acl:Control",
        true,
      ) +
      authorizationBlock(
        "verifications-service",
        lendingContainer,
        verificationsService.webId,
        "acl:Read, acl:Write",
        true,
      ) +
      authorizationBlock(
        "bureau-service",
        lendingContainer,
        bureauService.webId,
        "acl:Read, acl:Write",
        true,
      ),
  );

  const seededCredentialAgents: Readonly<Record<string, readonly [string, string][]>> = {
    "bank-cashflow-credential": [[verificationsService.webId, "acl:Read, acl:Write"]],
    "cashflow-score-credential": [[verificationsService.webId, "acl:Read, acl:Write"]],
    "credit-score-credential": [[bureauService.webId, "acl:Read, acl:Write"]],
    "employment-income-credential": [[verificationsService.webId, "acl:Read, acl:Write"]],
    "identity-credential": [[verificationsService.webId, "acl:Read, acl:Write"]],
  };
  await Promise.all(
    Object.entries(seededCredentialAgents).map(async ([kind, extraAgents]) => {
      const path = RESOURCE_POD_PATHS[kind as keyof typeof RESOURCE_POD_PATHS];
      const iri = `${podBase}${path.slice(1)}`;
      const authorizations =
        authorizationBlock(
          "owner",
          iri,
          borrower.webid,
          "acl:Read, acl:Write, acl:Control",
          false,
        ) +
        authorizationBlock(
          "wallet-service",
          iri,
          walletService.webId,
          "acl:Read, acl:Write, acl:Control",
          false,
        ) +
        extraAgents
          .map(([agent, modes], index) =>
            authorizationBlock(`extra-${index}`, iri, agent, modes, false),
          )
          .join("");
      await putAcl(iri, authorizations);
    }),
  );

  // 7. Fresh pod-hosted issuer identities: fintech-lender's/disbursement's
  //    OWN Reg-Z/receipt signing keys (real, verifiable) plus a dedicated
  //    FRESH identity-verifier issuer for scene 1's re-issue (the seeded
  //    issuer's private key is internal to `@lending/seeds`, never exposed
  //    to app tests — a genuinely different, freshly-minted trusted issuer
  //    is the honest way to exercise "re-issue through the live rail").
  [fintechIssuer, disbursementIssuer, freshIdentityIssuer] = await Promise.all([
    provisionPodHostedIssuer({
      docPath: "/lending/issuers/e2e-fintech-lender",
      now: seededAt,
      ownerFetch: primary.authFetch,
      ownerWebId: borrower.webid,
      podOrigin,
      statusPath: "/lending/status/e2e-fintech-lender",
    }),
    provisionPodHostedIssuer({
      docPath: "/lending/issuers/e2e-disbursement",
      now: seededAt,
      ownerFetch: primary.authFetch,
      ownerWebId: borrower.webid,
      podOrigin,
      statusPath: "/lending/status/e2e-disbursement",
    }),
    provisionPodHostedIssuer({
      docPath: "/lending/issuers/e2e-fresh-identity",
      now: seededAt,
      ownerFetch: primary.authFetch,
      ownerWebId: borrower.webid,
      podOrigin,
      statusPath: "/lending/status/e2e-fresh-identity",
    }),
  ]);

  const [fintechIssuerKeyJwk, disbursementIssuerKeyJwk, freshIdentityKeyJwk] = await Promise.all([
    exportPrivateJwk(fintechIssuer.key),
    exportPrivateJwk(disbursementIssuer.key),
    exportPrivateJwk(freshIdentityIssuer.key),
  ]);

  const trustedCredentialIssuers = [
    seededIssuerWebId("identityVerifier"),
    seededIssuerWebId("incomeVerifier"),
    seededIssuerWebId("bankDataProvider"),
    seededIssuerWebId("cashFlowScorer"),
    seededIssuerWebId("creditBureau"),
    freshIdentityIssuer.webId,
  ].join(",");

  const shared = {
    LENDING_DEV_ALLOW_LOOPBACK: "1",
    LENDING_POD_ALLOWED_ORIGINS: podOrigin,
    LENDING_TRUST_FORWARDED_HEADERS: "1",
    LENDING_TRUSTED_OIDC_ISSUERS: borrower.issuer,
  };

  const [verifications, wallet, bankLender, fintechLender, bureau, disbursement] =
    await Promise.all([
      runner.start({
        basePath: "/verifications",
        env: {
          ...shared,
          LENDING_VERIFICATIONS_IDENTITY_ISSUER_KEY_JWK: JSON.stringify(freshIdentityKeyJwk),
          LENDING_VERIFICATIONS_IDENTITY_ISSUER_KEY_VM: freshIdentityIssuer.key.verificationMethod,
          LENDING_VERIFICATIONS_IDENTITY_ISSUER_WEBID: freshIdentityIssuer.webId,
          LENDING_VERIFICATIONS_IDENTITY_STATUS_LIST_URL: freshIdentityIssuer.status.url,
          LENDING_VERIFICATIONS_POD_SERVICE_CLIENT_ID: verificationsClient.clientId,
          LENDING_VERIFICATIONS_POD_SERVICE_CLIENT_SECRET: verificationsClient.clientSecret,
          LENDING_VERIFICATIONS_POD_SERVICE_ISSUER: verificationsService.issuer,
          LENDING_VERIFICATIONS_SERVICE_WEBID: verificationsService.webId,
        },
        packageName: "@lending/app-verifications",
      }),
      runner.start({
        basePath: "/wallet",
        env: {
          ...shared,
          LENDING_BANK_LENDER_SERVICE_WEBID: bankService.webId,
          LENDING_DISBURSEMENT_SERVICE_WEBID: disbursementService.webId,
          LENDING_FINTECH_LENDER_SERVICE_WEBID: fintechService.webId,
          LENDING_SEED_POD_URL: podOrigin,
          LENDING_SEED_WEBID: borrower.webid,
          LENDING_WALLET_POD_SERVICE_CLIENT_ID: walletClient.clientId,
          LENDING_WALLET_POD_SERVICE_CLIENT_SECRET: walletClient.clientSecret,
          LENDING_WALLET_POD_SERVICE_ISSUER: walletService.issuer,
          LENDING_WALLET_SERVICE_WEBID: walletService.webId,
        },
        packageName: "@lending/app-wallet",
      }),
      runner.start({
        basePath: "/bank-lender",
        env: {
          ...shared,
          LENDING_BANK_POD_SERVICE_CLIENT_ID: bankClient.clientId,
          LENDING_BANK_POD_SERVICE_CLIENT_SECRET: bankClient.clientSecret,
          LENDING_BANK_POD_SERVICE_ISSUER: bankService.issuer,
          LENDING_BANK_SERVICE_WEBID: bankService.webId,
          LENDING_TRUSTED_CREDENTIAL_ISSUERS: trustedCredentialIssuers,
        },
        packageName: "@lending/app-bank-lender",
      }),
      runner.start({
        basePath: "/fintech-lender",
        env: {
          ...shared,
          LENDING_FINTECH_ISSUER_KEY_JWK: JSON.stringify(fintechIssuerKeyJwk),
          LENDING_FINTECH_ISSUER_KEY_VM: fintechIssuer.key.verificationMethod,
          LENDING_FINTECH_LENDER_WEBID: fintechIssuer.webId,
          LENDING_FINTECH_POD_SERVICE_CLIENT_ID: fintechClient.clientId,
          LENDING_FINTECH_POD_SERVICE_CLIENT_SECRET: fintechClient.clientSecret,
          LENDING_FINTECH_POD_SERVICE_ISSUER: fintechService.issuer,
          LENDING_FINTECH_SERVICE_WEBID: fintechService.webId,
          LENDING_FINTECH_STATUS_LIST_URL: fintechIssuer.status.url,
          LENDING_TRUSTED_CREDENTIAL_ISSUERS: trustedCredentialIssuers,
        },
        packageName: "@lending/app-fintech-lender",
      }),
      runner.start({
        basePath: "/bureau",
        env: {
          ...shared,
          LENDING_BUREAU_POD_SERVICE_CLIENT_ID: bureauClient.clientId,
          LENDING_BUREAU_POD_SERVICE_CLIENT_SECRET: bureauClient.clientSecret,
          LENDING_BUREAU_POD_SERVICE_ISSUER: bureauService.issuer,
          LENDING_BUREAU_SERVICE_WEBID: bureauService.webId,
          LENDING_BUREAU_TRUSTED_FURNISHERS: fintechIssuer.webId,
        },
        packageName: "@lending/app-bureau",
      }),
      runner.start({
        basePath: "/disbursement",
        env: {
          ...shared,
          LENDING_DISBURSEMENT_ISSUER_KEY_JWK: JSON.stringify(disbursementIssuerKeyJwk),
          LENDING_DISBURSEMENT_ISSUER_KEY_VM: disbursementIssuer.key.verificationMethod,
          LENDING_DISBURSEMENT_POD_SERVICE_CLIENT_ID: disbursementClient.clientId,
          LENDING_DISBURSEMENT_POD_SERVICE_CLIENT_SECRET: disbursementClient.clientSecret,
          LENDING_DISBURSEMENT_POD_SERVICE_ISSUER: disbursementService.issuer,
          LENDING_DISBURSEMENT_SERVICE_WEBID: disbursementService.webId,
          LENDING_DISBURSEMENT_STATUS_LIST_URL: disbursementIssuer.status.url,
          LENDING_DISBURSEMENT_WEBID: disbursementIssuer.webId,
          LENDING_DISBURSEMENT_TRUSTED_OFFER_ISSUERS: fintechIssuer.webId,
        },
        packageName: "@lending/app-disbursement",
      }),
    ]);

  origins.verifications = verifications.origin;
  origins.wallet = wallet.origin;
  origins.bankLender = bankLender.origin;
  origins.fintechLender = fintechLender.origin;
  origins.bureau = bureau.origin;
  origins.disbursement = disbursement.origin;
});

test.afterAll(async () => {
  await runner.stopAll();
  await Promise.all([
    pod?.stop(),
    borrower?.stop(),
    bankService?.stop(),
    fintechService?.stop(),
    disbursementService?.stop(),
    walletService?.stop(),
    verificationsService?.stop(),
    bureauService?.stop(),
  ]);
});

test("scene 1: verify-on-view over the seeded vault, then a REAL re-issue through the live rail", async ({
  page,
}) => {
  // TEMP DEBUG
  page.on("console", (msg) => console.log("TEMP DEBUG console", msg.type(), msg.text()));
  // TEMP DEBUG
  page.on("response", (res) => {
    if (res.url().includes("/api/")) console.log("TEMP DEBUG response", res.status(), res.url());
  });
  // TEMP DEBUG
  page.on("requestfailed", (req) =>
    console.log("TEMP DEBUG requestfailed", req.url(), req.failure()?.errorText),
  );

  // Every zone surface visited carries the trust frame.
  await page.goto(`${origins.wallet}/wallet/credentials`);
  await acknowledgeInterstitial(page);
  await expectBannerVisible(page);

  await page.getByRole("button", { name: "Load + verify credentials" }).click();
  const cards = page.locator("[data-credential-card]");
  await expect(cards).toHaveCount(5);
  const statuses = await page.locator("[data-credential-status]").allTextContents();
  expect(statuses.length).toBe(5);
  for (let index = 0; index < 5; index += 1) {
    await expect(page.locator("[data-credential-status]").nth(index)).toHaveAttribute(
      "data-credential-status",
      "valid",
    );
  }
  await expectAxeClean(page);

  // A REAL issuance transition: DELETE the seeded identity slot (404
  // proven), then the branded flow re-fills it through the real rail —
  // driven from the UI with the borrower's real DPoP session.
  const identityIri = `${podBase}${RESOURCE_POD_PATHS["identity-credential"].slice(1)}`;
  const deleted = await fetch(identityIri, { method: "DELETE" });
  expect([200, 204, 205].includes(deleted.status), `DELETE identity: ${deleted.status}`).toBe(true);
  expect((await fetch(identityIri)).status).toBe(404);

  await borrower.authenticatePage(page, "**/verifications/api/**");
  await page.goto(`${origins.verifications}/verifications/identity`);
  await acknowledgeInterstitial(page);
  await expect(page.locator("[data-flow-page]")).toHaveAttribute("data-flow-page", "identity");
  await expectBannerVisible(page);
  await page.getByRole("button", { name: "Issue credential" }).click();
  const outcome = page.locator("[data-panel-outcome]");
  await expect(outcome).toHaveAttribute("data-panel-outcome", "ok", { timeout: 60_000 });
  await expectAxeClean(page);

  // The signed VC is REALLY back in the vault and passes the full
  // fail-closed chain against the FRESH issuer, subject-bound to Maya.
  const reissuedBody = await podBody(RESOURCE_POD_PATHS["identity-credential"]);
  const verification = await verifyCredential(reissuedBody, {
    expectShape: "identity-credential",
    now: new Date(),
    trustedIssuers: [freshIdentityIssuer.webId],
    ...podSeams,
  });
  expect(verification.verified, JSON.stringify(verification.errors)).toBe(true);
  expect(verification.credential?.subject).toBe(borrower.webid);
});

test("scene 2: REAL ZK pre-qualification round trip at BOTH lenders", async () => {
  interface ChallengeResponse {
    readonly nonce: string;
  }
  interface DemoProofResponse {
    readonly proof: Record<string, unknown>;
    readonly anchors: Record<string, string>;
  }
  interface VerifyResponse {
    readonly qualified: boolean;
    readonly legs: Record<string, { verified: boolean }>;
  }

  const prequalAt = async (origin: string, basePath: string) => {
    const anon = await fetch(`${origin}${basePath}/api/prequal/challenge`, { method: "POST" });
    expect(anon.status, `${basePath} anonymous challenge`).toBe(401);

    const challengeResponse = await borrower.authFetch(
      `${origin}${basePath}/api/prequal/challenge`,
      {
        method: "POST",
      },
    );
    expect(challengeResponse.status, `${basePath} challenge`).toBe(200);
    const { nonce } = (await challengeResponse.json()) as ChallengeResponse;

    // A REAL UltraHonk proof bundle + REAL signed operand-anchor VCs over
    // Maya's pinned witness values, bound to THIS lender's own nonce.
    const proofResponse = await borrower.authFetch(`${origin}${basePath}/api/prequal/demo-proof`, {
      body: JSON.stringify({ nonce }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(proofResponse.status, `${basePath} demo-proof`).toBe(200);
    const bundle = (await proofResponse.json()) as DemoProofResponse;
    expect(Object.keys(bundle.proof).sort()).toEqual(
      ["cashFlowScoreValue", "netMonthlyIncomeUsd", "nsf90Count"].sort(),
    );

    const verifyResponse = await borrower.authFetch(`${origin}${basePath}/api/prequal/verify`, {
      body: JSON.stringify({ anchors: bundle.anchors, nonce, proof: bundle.proof }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(verifyResponse.status, `${basePath} verify`).toBe(200);
    const verified = (await verifyResponse.json()) as VerifyResponse;
    expect(verified.qualified, JSON.stringify(verified.legs)).toBe(true);
    expect(Object.values(verified.legs).every((leg) => leg.verified)).toBe(true);

    // The nonce is single-use: a replay of the SAME bundle is refused.
    const replay = await borrower.authFetch(`${origin}${basePath}/api/prequal/verify`, {
      body: JSON.stringify({ anchors: bundle.anchors, nonce, proof: bundle.proof }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(replay.status, `${basePath} verify replay`).toBe(403);
  };

  await prequalAt(origins.bankLender, "/bank-lender");
  await prequalAt(origins.fintechLender, "/fintech-lender");
});

test("scene 3: cash-flow lender APPROVES with a real signed Reg Z offer; bureau-only DECLINES the same borrower", async ({
  page,
}) => {
  interface OriginationReport {
    readonly decision: {
      readonly outcome: string;
      readonly evidenceFindings: readonly { readonly pass: boolean }[];
      readonly bureauOnly?: { readonly outcome: string };
      readonly cashFlowPlus?: { readonly outcome: string };
    };
    readonly offerIri?: string;
    readonly adverseActionIri?: string;
  }

  // The wallet grants each lender EXACTLY the catalogue it is entitled to
  // (design §6 "two models" contrast: bank-lender never sees the cash-flow
  // fields). Every grant is a REAL WAC transition through the real rail.
  await walletGrant("fintech-lender", "identity", "grant");
  await walletGrant("fintech-lender", "income", "grant");
  await walletGrant("fintech-lender", "bankCashFlow", "grant");
  await walletGrant("fintech-lender", "cashFlowScore", "grant");
  await walletGrant("fintech-lender", "creditScore", "grant");
  await walletGrant("fintech-lender", "loanOffer", "grant");
  await walletGrant("fintech-lender", "repaymentHistory", "grant");

  await walletGrant("bank-lender", "identity", "grant");
  await walletGrant("bank-lender", "income", "grant");
  await walletGrant("bank-lender", "creditScore", "grant");

  // Before either lender is granted, an unauthenticated submit is refused.
  expect(
    (await fetch(`${origins.bankLender}/bank-lender/api/application/submit`, { method: "POST" }))
      .status,
  ).toBe(401);

  const fintechResponse = await borrower.authFetch(
    `${origins.fintechLender}/fintech-lender/api/application/submit`,
    { method: "POST" },
  );
  expect(fintechResponse.status, "fintech-lender submit").toBe(200);
  const fintechReport = (await fintechResponse.json()) as OriginationReport;
  expect(fintechReport.decision.outcome).toBe("approve");
  expect(fintechReport.decision.evidenceFindings.every((finding) => finding.pass)).toBe(true);
  expect(fintechReport.decision.cashFlowPlus?.outcome).toBe("approve");
  expect(fintechReport.decision.bureauOnly?.outcome).toBe("decline");
  expect(fintechReport.offerIri).toBeDefined();
  offerIri = fintechReport.offerIri as string;

  const offerBody = await podBody(RESOURCE_POD_PATHS["loan-offer-credential"]);
  const offerVerification = await verifyCredential(offerBody, {
    expectShape: "loan-offer-credential",
    now: new Date(),
    trustedIssuers: [fintechIssuer.webId],
    ...podSeams,
  });
  expect(offerVerification.verified, JSON.stringify(offerVerification.errors)).toBe(true);
  expect(offerVerification.credential?.subject).toBe(borrower.webid);

  const bankResponse = await borrower.authFetch(
    `${origins.bankLender}/bank-lender/api/application/submit`,
    {
      method: "POST",
    },
  );
  expect(bankResponse.status, "bank-lender submit").toBe(200);
  const bankReport = (await bankResponse.json()) as OriginationReport;
  expect(bankReport.decision.outcome).toBe("decline");
  expect(bankReport.decision.evidenceFindings.every((finding) => finding.pass)).toBe(true);
  expect(bankReport.adverseActionIri).toBeDefined();
  // The Reg B adverse-action notice is real pod content (unsigned by
  // design — a notification, not a presentable credential).
  await podBody("lending/adverse-action");

  // The illustrative application pages (static, never the live decision
  // driver — see each page's own HonestyPanel) still carry the trust frame.
  await page.goto(`${origins.fintechLender}/fintech-lender/application`);
  await acknowledgeInterstitial(page);
  await expectBannerVisible(page);
  await expectAxeClean(page);

  await page.goto(`${origins.bankLender}/bank-lender/application`);
  await acknowledgeInterstitial(page);
  await expectBannerVisible(page);
  await expectAxeClean(page);
});

test("scene 4: disbursement verifies the REAL offer and writes a REAL signed receipt; a repeat is refused", async ({
  page,
}) => {
  interface PayoutReport {
    readonly receiptIri: string;
    readonly fundsOfferIri: string;
    readonly amountUsd: number;
    readonly cardLast4: string;
  }

  await walletGrant("disbursement", "identity", "grant");
  await walletGrant("disbursement", "loanOffer", "grant");
  await walletGrant("disbursement", "disbursementReceipt", "grant");

  const anon = await fetch(`${origins.disbursement}/disbursement/api/payout`, { method: "POST" });
  expect(anon.status, "anonymous payout").toBe(401);

  const payoutResponse = await borrower.authFetch(
    `${origins.disbursement}/disbursement/api/payout`,
    {
      method: "POST",
    },
  );
  expect(payoutResponse.status, "payout").toBe(200);
  const payout = (await payoutResponse.json()) as PayoutReport;
  expect(payout.fundsOfferIri).toBe(offerIri);
  expect(payout.amountUsd).toBeGreaterThan(0);
  expect(payout.cardLast4).toMatch(/^\d{4}$/);

  const receiptBody = await podBody(RESOURCE_POD_PATHS["disbursement-receipt-credential"]);
  const receiptVerification = await verifyCredential(receiptBody, {
    expectShape: "disbursement-receipt-credential",
    now: new Date(),
    trustedIssuers: [disbursementIssuer.webId],
    ...podSeams,
  });
  expect(receiptVerification.verified, JSON.stringify(receiptVerification.errors)).toBe(true);
  expect(receiptVerification.credential?.subject).toBe(borrower.webid);

  const repeat = await borrower.authFetch(`${origins.disbursement}/disbursement/api/payout`, {
    method: "POST",
  });
  expect(repeat.status, "repeat payout").toBe(409);
  const repeatBody = (await repeat.json()) as { error: string };
  expect(repeatBody.error).toBe("already_funded");

  await page.goto(`${origins.disbursement}/disbursement`);
  await acknowledgeInterstitial(page);
  await expectBannerVisible(page);
  await expectAxeClean(page);
});

test("scene 5: the fintech->bureau furnishing loop is real; the wallet revokes access and the ledger shows it", async ({
  page,
}) => {
  interface FurnishHistoryReport {
    readonly historyIri: string;
    readonly servicedLoanIri: string;
    readonly credential: string;
  }
  interface FurnishResponse {
    readonly furnished: { readonly servicedLoan: string; readonly credentialId: string };
  }
  interface GrantStanding {
    readonly agent: string;
    readonly resource: string;
    readonly granted: boolean;
    readonly revoked: boolean;
  }
  interface GrantsResponse {
    readonly standings: readonly GrantStanding[];
  }
  interface LedgerResponse {
    readonly receipts: readonly {
      readonly action: string;
      readonly recipient: string;
      readonly resource: string;
    }[];
  }

  // The inspectable repayment view (1041 rails rendered as data).
  const grantView = await borrower.authFetch(
    `${origins.fintechLender}/fintech-lender/api/servicing/repayment-grant`,
    { method: "POST" },
  );
  expect(grantView.status, "repayment grant view").toBe(200);

  // Fintech-lender signs + delivers the repayment-history credential.
  const furnishHistory = await borrower.authFetch(
    `${origins.fintechLender}/fintech-lender/api/servicing/furnish-history`,
    { method: "POST" },
  );
  expect(furnishHistory.status, "furnish-history").toBe(200);
  const historyReport = (await furnishHistory.json()) as FurnishHistoryReport;
  expect(historyReport.servicedLoanIri).toBe(offerIri);

  const historyBody = await podBody(RESOURCE_POD_PATHS["repayment-history-credential"]);
  const historyVerification = await verifyCredential(historyBody, {
    expectShape: "repayment-history-credential",
    now: new Date(),
    trustedIssuers: [fintechIssuer.webId],
    ...podSeams,
  });
  expect(historyVerification.verified, JSON.stringify(historyVerification.errors)).toBe(true);

  // The BORROWER's OWN session furnishes the signed credential onward to
  // the bureau (never fintech-lender's service identity — bureau's L3
  // check requires `credentialSubject === caller.webid`).
  const furnishResponse = await borrower.authFetch(`${origins.bureau}/bureau/api/furnish`, {
    body: JSON.stringify({ credential: historyReport.credential }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(furnishResponse.status, "furnish").toBe(200);
  const furnished = (await furnishResponse.json()) as FurnishResponse;
  expect(furnished.furnished.servicedLoan).toBe(offerIri);

  const refurnish = await borrower.authFetch(`${origins.bureau}/bureau/api/furnish`, {
    body: JSON.stringify({ credential: historyReport.credential }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(refurnish.status, "repeat furnish").toBe(409);

  const furnishedList = await borrower.authFetch(`${origins.bureau}/bureau/api/furnished`);
  expect(furnishedList.status, "furnished list").toBe(200);
  const listed = (await furnishedList.json()) as {
    tradelines: readonly { servicedLoan: string }[];
  };
  expect(listed.tradelines.some((entry) => entry.servicedLoan === offerIri)).toBe(true);

  await page.goto(`${origins.bureau}/bureau`);
  await acknowledgeInterstitial(page);
  await expectBannerVisible(page);
  await expectAxeClean(page);

  // The wallet revokes fintech-lender's access to the loan-offer document.
  const revokeResponse = await walletGrant("fintech-lender", "loanOffer", "revoke");
  expect(revokeResponse.receipt.action).toBe("revoke");

  const standingsResponse = await borrower.authFetch(`${origins.wallet}/wallet/api/grants`);
  expect(standingsResponse.status, "grant standings").toBe(200);
  const standings = (await standingsResponse.json()) as GrantsResponse;
  const revoked = standings.standings.find(
    (entry) => entry.agent === fintechService.webId && entry.resource === "loanOffer",
  );
  expect(revoked?.granted).toBe(false);
  expect(revoked?.revoked).toBe(true);

  // The revoke has REAL effect at the WAC layer: fintech-lender's own
  // service identity can no longer read the loan offer it needs to render
  // the (now access-denied) repayment view.
  const postRevokeGrantView = await borrower.authFetch(
    `${origins.fintechLender}/fintech-lender/api/servicing/repayment-grant`,
    { method: "POST" },
  );
  expect(postRevokeGrantView.status, "post-revoke repayment view").toBe(403);

  const ledgerResponse = await borrower.authFetch(`${origins.wallet}/wallet/api/ledger`);
  expect(ledgerResponse.status, "ledger").toBe(200);
  const ledger = (await ledgerResponse.json()) as LedgerResponse;
  expect(
    ledger.receipts.some(
      (entry) =>
        entry.action === "revoke" &&
        entry.recipient === fintechService.webId &&
        entry.resource === offerIri,
    ),
  ).toBe(true);

  await borrower.authenticatePage(page, "**/wallet/api/**");
  await page.goto(`${origins.wallet}/wallet/ledger`);
  await acknowledgeInterstitial(page);
  await expectBannerVisible(page);
  await expectAxeClean(page);
});
