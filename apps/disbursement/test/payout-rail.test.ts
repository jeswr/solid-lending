/**
 * Scene-4 authenticated-caller boundary + the REAL grant boundary, against a
 * real @jeswr/solid-server pod (`@lending/test-kit`), real DPoP-bound
 * Solid-OIDC tokens (loopback dev issuers), this rail's REAL client-
 * credentials service identity reading through a REAL borrower grant, and
 * REAL Ed25519-signed credentials verified by the real vc-kit verifier — no
 * mocked auth/verify/signing anywhere.
 *
 * Acceptance (the sm-qz3j.5 security bar):
 *   - anonymous callers are rejected (401 + WWW-Authenticate);
 *   - an unconfigured service identity / offer-trust list / receipt-signing
 *     identity each fail closed (503) — never anonymous IO, never an open
 *     signer;
 *   - a NON-granted reader is denied by the pod's WAC, never treated as "no
 *     offer";
 *   - no loan offer, an untrusted-issuer offer, a subject-mismatched offer,
 *     or an expired offer each refuse the payout outright — NO receipt is
 *     ever written;
 *   - the happy path reads the REAL granted offer, runs the deterministic
 *     payout, and signs + delivers a REAL, independently-verifiable
 *     Disbursement Receipt VC into the pod;
 *   - a repeat call against an already-funded loan is refused (409) — never
 *     a second payout;
 *   - revoking the grant genuinely shuts the read off (real WAC).
 */
import {
  DisbursementReceiptCredential,
  LEND,
  RESOURCE_POD_PATHS,
  validate,
} from "@lending/data-model";
import {
  generateKeyPairForSuite,
  issueCredential,
  type KeyPair,
  StatusListClient,
  verifyCredential,
} from "@lending/vc-kit";
import {
  profileCardFixture,
  seedPod,
  startSolidServer,
  type SolidTestAccount,
  type SolidTestServer,
} from "@lending/test-kit";
import { DataFactory, Parser, Store } from "n3";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { DisbursementConfig } from "../lib/server/config";
import { DEFAULT_DISBURSEMENT_WEBID } from "../lib/server/config";
import {
  createPayoutRailService,
  type PayoutRailService,
  type PayoutReport,
} from "../lib/server/payout-rail";
import { startDevServiceIssuer, startDevUserIssuer } from "./dev-issuer";
import { serveHandler, type RouteServer } from "./route-server";

const NOW = new Date("2026-07-16T14:02:00.000Z");
const CLIENT = { clientId: "disbursement-service", clientSecret: "test-disbursement-secret" };
const ROGUE_CLIENT = { clientId: "rogue-disbursement-service", clientSecret: "test-rogue-secret" };
const OWNER_SEAMS = { profileFetch: fetch };

const OFFER_WEBID = "https://fintech-lender.example/orgs/installment-lending#id";
const ROGUE_OFFER_WEBID = "https://rogue-lender.example/orgs/not-trusted#id";

/** In-memory GET/PUT host for a status list — nothing leaves the process. */
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

interface OfferIssuer {
  readonly webId: string;
  readonly key: KeyPair;
  readonly statusFetch: typeof fetch;
  issueOffer(options: {
    readonly subject: string;
    readonly credentialId: string;
    readonly validFrom: Date;
    readonly validUntil: Date;
    readonly principalUsd?: number;
  }): Promise<string>;
}

async function createOfferIssuer(webId: string): Promise<OfferIssuer> {
  const key = await generateKeyPairForSuite(`${new URL(webId).origin}#vc-key`, "Ed25519");
  const host = memoryStatusHost();
  const list = new StatusListClient({
    fetch: host.fetch,
    issuer: webId,
    key,
    url: `${new URL(webId).origin}/status/offers`,
  });
  let created: Promise<void> | undefined;
  let index = 0;
  return {
    key,
    statusFetch: host.fetch,
    webId,
    async issueOffer(options) {
      created ??= list.create({ now: NOW });
      await created;
      const i = index;
      index += 1;
      const principalUsd = options.principalUsd ?? 2000;
      const issued = await issueCredential({
        claims: {
          aprPercent: 32.9,
          financeChargeUsd: 560.68,
          kind: "loan-offer-credential",
          loanTermMonths: 18,
          numberOfPayments: 18,
          paymentAmountUsd: 142.26,
          paymentsPerYear: 12,
          principalUsd,
          totalOfPaymentsUsd: 2560.68,
        },
        credentialId: options.credentialId,
        issuer: webId,
        key,
        kind: "loan-offer-credential",
        status: list.entry(i),
        subject: options.subject,
        validity: { validFrom: options.validFrom, validUntil: options.validUntil },
      });
      return issued.body;
    },
  };
}

let pods: SolidTestServer;
let borrower: SolidTestAccount;
let presenter: Awaited<ReturnType<typeof startDevUserIssuer>>;
let podRoot: string;
let serviceIssuer: Awaited<ReturnType<typeof startDevServiceIssuer>>;
let rogueIssuer: Awaited<ReturnType<typeof startDevServiceIssuer>>;
let issuerPod: SolidTestAccount;
let receiptKey: KeyPair;
let offerIssuer: OfferIssuer;
let config: DisbursementConfig;
let service: PayoutRailService;
let route: RouteServer;

function offerUrl(): string {
  return `${podRoot}${RESOURCE_POD_PATHS["loan-offer-credential"]}`;
}

function receiptUrl(): string {
  return `${podRoot}${RESOURCE_POD_PATHS["disbursement-receipt-credential"]}`;
}

async function putOffer(body: string): Promise<void> {
  // Written by the raw pod owner (`borrower`, test-kit's blanket-Control
  // account identity) — mirrors "the fintech-lender already ran origination
  // and wrote the offer" for this test's purposes; the resource's OWN ACL
  // (below) is what actually governs who may read it afterwards.
  const response = await borrower.authFetch(offerUrl(), {
    body,
    headers: { "content-type": "text/turtle" },
    method: "PUT",
  });
  if (!response.ok) throw new Error(`offer PUT failed: ${response.status}`);
}

async function deleteOfferIfPresent(): Promise<void> {
  await borrower.authFetch(offerUrl(), { method: "DELETE" }).catch(() => undefined);
}

async function deleteReceiptIfPresent(): Promise<void> {
  await borrower.authFetch(receiptUrl(), { method: "DELETE" }).catch(() => undefined);
}

/**
 * The loan-offer resource's OWN ACL: both the raw pod owner (`borrower`) and
 * Maya's authenticated session (`presenter`) keep full control (so her own
 * session — and this test's own delete/recreate helpers — can always read
 * it back, exactly like "the pod itself still serves its owner" after a
 * revocation); `agentWebid`, when given, gets a single dedicated Read rule —
 * least-privilege, per-resource, matching the wallet's grant catalogue.
 */
function offerAclBody(agentWebid: string | undefined): string {
  const path = new URL(offerUrl()).pathname;
  const grant =
    agentWebid === undefined
      ? ""
      : `
<#grant>
    a acl:Authorization ;
    acl:accessTo <${path}> ;
    acl:agent <${agentWebid}> ;
    acl:mode acl:Read .
`;
  return `@prefix acl: <http://www.w3.org/ns/auth/acl#> .

<#owner>
    a acl:Authorization ;
    acl:accessTo <${path}> ;
    acl:agent <${borrower.webid}>, <${presenter.webId}> ;
    acl:mode acl:Read, acl:Write, acl:Control .
${grant}`;
}

/** Grant `agentWebid` Read on the loan-offer resource — least-privilege, per-resource. */
async function grantOfferRead(agentWebid: string): Promise<void> {
  const response = await borrower.authFetch(`${offerUrl()}.acl`, {
    body: offerAclBody(agentWebid),
    headers: { "content-type": "text/turtle" },
    method: "PUT",
  });
  if (!response.ok) throw new Error(`offer grant ACL PUT failed: ${response.status}`);
}

async function revokeOfferRead(): Promise<void> {
  const response = await borrower.authFetch(`${offerUrl()}.acl`, {
    body: offerAclBody(undefined),
    headers: { "content-type": "text/turtle" },
    method: "PUT",
  });
  if (!response.ok) throw new Error(`offer revoke ACL PUT failed: ${response.status}`);
}

/**
 * Grant `agentWebid` WRITE-only default access over `/lending/` — the
 * receipt resource does not exist yet, so its creation is authorized against
 * the nearest container's effective ACL (mirrors the sibling apps' identical
 * `grantContainerWrite`). READ stays scoped to the SPECIFIC resources this
 * app is actually granted (the loan offer, above) — never the whole
 * container — matching the wallet's least-privilege catalogue (disbursement:
 * identity read, loanOffer read, disbursementReceipt write).
 */
async function grantContainerCreate(agentWebid: string): Promise<void> {
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
    acl:mode acl:Write .
`,
    headers: { "content-type": "text/turtle" },
    method: "PUT",
  });
  if (!response.ok) throw new Error(`container create-grant ACL PUT failed: ${response.status}`);
}

function apiUrl(path: string): string {
  return `${route.url}${path}`;
}

function buildConfig(overrides: Partial<DisbursementConfig> = {}): DisbursementConfig {
  return {
    allowedPodOrigins: [podRoot],
    allowInsecureLoopback: true,
    disbursementWebId: DEFAULT_DISBURSEMENT_WEBID,
    issuerKeyJwk: undefined,
    issuerKeyVerificationMethod: undefined,
    podServiceClientId: CLIENT.clientId,
    podServiceClientSecret: CLIENT.clientSecret,
    podServiceIssuer: serviceIssuer.issuer,
    serviceWebId: serviceIssuer.webId,
    statusListUrl: `${issuerPod.baseUrl}/status/disbursement-receipts`,
    trustedOidcIssuers: [presenter.issuer],
    trustedOfferIssuers: [offerIssuer.webId],
    trustForwardedHeaders: false,
    ...overrides,
  };
}

const offerSeams = () => ({
  isControlledBy: (vm: string, issuer: string) =>
    vm === offerIssuer.key.verificationMethod && issuer === offerIssuer.webId,
  resolveKey: async (vm: string) =>
    vm === offerIssuer.key.verificationMethod ? offerIssuer.key.publicKey : undefined,
  statusFetch: offerIssuer.statusFetch,
});

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

  issuerPod = await pods.provisionAccount();
  offerIssuer = await createOfferIssuer(OFFER_WEBID);
  receiptKey = await generateKeyPairForSuite(
    `${new URL(DEFAULT_DISBURSEMENT_WEBID).origin}#vc-key`,
    "Ed25519",
  );

  [serviceIssuer, rogueIssuer] = await Promise.all([
    startDevServiceIssuer({ clients: [CLIENT] }),
    startDevServiceIssuer({ clients: [ROGUE_CLIENT] }),
  ]);

  // Establish the offer resource + its OWN ACL once; individual describe
  // blocks below freely delete/recreate the offer BODY (the ACL document is
  // independent and persists across that).
  await putOffer(
    await offerIssuer.issueOffer({
      credentialId: offerUrl(),
      subject: presenter.webId,
      validFrom: new Date(NOW.getTime() - 1000),
      validUntil: new Date(NOW.getTime() + 14 * 24 * 60 * 60 * 1000),
    }),
  );
  await grantOfferRead(serviceIssuer.webId);
  await grantContainerCreate(serviceIssuer.webId);

  config = buildConfig();
  service = createPayoutRailService({
    config,
    issuerKey: receiptKey,
    now: () => NOW,
    offerSeams: offerSeams(),
    ownerSeams: OWNER_SEAMS,
    // Hosting the receipt-issuer's OWN status list is this rail's OWN
    // infrastructure capability — never the borrower-grant-scoped service
    // fetch (which has no access to `issuerPod` at all).
    statusHostFetch: issuerPod.authFetch,
  });
  route = await serveHandler((request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/payout")) return service.payout(request);
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
    const response = await fetch(apiUrl("/payout"), { method: "POST" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).not.toBeNull();
  });

  test("an unconfigured pod service identity fails closed (503)", async () => {
    const unconfigured = createPayoutRailService({
      config: { ...config, podServiceClientSecret: undefined },
      issuerKey: receiptKey,
      now: () => NOW,
      offerSeams: offerSeams(),
      ownerSeams: OWNER_SEAMS,
    });
    const localRoute = await serveHandler((request) => unconfigured.payout(request));
    try {
      const response = await presenter.authFetch(`${localRoute.url}/payout`, { method: "POST" });
      expect(response.status).toBe(503);
    } finally {
      await localRoute.stop();
    }
  });

  test("an unconfigured offer-issuer trust list fails closed (503)", async () => {
    const unconfigured = createPayoutRailService({
      config: { ...config, trustedOfferIssuers: [] },
      issuerKey: receiptKey,
      now: () => NOW,
      offerSeams: offerSeams(),
      ownerSeams: OWNER_SEAMS,
    });
    const localRoute = await serveHandler((request) => unconfigured.payout(request));
    try {
      const response = await presenter.authFetch(`${localRoute.url}/payout`, { method: "POST" });
      expect(response.status).toBe(503);
    } finally {
      await localRoute.stop();
    }
  });

  test("an unconfigured receipt-signing identity fails closed (503) — no receipt written", async () => {
    await putOffer(
      await offerIssuer.issueOffer({
        credentialId: offerUrl(),
        subject: presenter.webId,
        validFrom: new Date(NOW.getTime() - 1000),
        validUntil: new Date(NOW.getTime() + 14 * 24 * 60 * 60 * 1000),
      }),
    );
    const unconfigured = createPayoutRailService({
      config: { ...config, issuerKeyJwk: undefined, statusListUrl: undefined },
      now: () => NOW,
      offerSeams: offerSeams(),
      ownerSeams: OWNER_SEAMS,
      // No issuerKey injected AND no env JWK — the runtime construction itself must fail closed.
    });
    const localRoute = await serveHandler((request) => unconfigured.payout(request));
    try {
      const response = await presenter.authFetch(`${localRoute.url}/payout`, { method: "POST" });
      expect(response.status).toBe(503);
      const receipt = await borrower.authFetch(receiptUrl());
      expect(receipt.status).toBe(404);
    } finally {
      await localRoute.stop();
      await deleteOfferIfPresent();
    }
  });
});

describe("the grant boundary is the pod's own WAC", () => {
  test("a service identity the grant does not name is denied by the pod — no payout", async () => {
    await putOffer(
      await offerIssuer.issueOffer({
        credentialId: offerUrl(),
        subject: presenter.webId,
        validFrom: new Date(NOW.getTime() - 1000),
        validUntil: new Date(NOW.getTime() + 14 * 24 * 60 * 60 * 1000),
      }),
    );
    const rogue = createPayoutRailService({
      config: {
        ...config,
        podServiceClientId: ROGUE_CLIENT.clientId,
        podServiceClientSecret: ROGUE_CLIENT.clientSecret,
        podServiceIssuer: rogueIssuer.issuer,
        serviceWebId: rogueIssuer.webId,
      },
      issuerKey: receiptKey,
      now: () => NOW,
      offerSeams: offerSeams(),
      ownerSeams: OWNER_SEAMS,
    });
    const localRoute = await serveHandler((request) => rogue.payout(request));
    try {
      const response = await presenter.authFetch(`${localRoute.url}/payout`, { method: "POST" });
      expect(response.ok).toBe(false);
      expect([401, 403]).toContain(response.status);
      const receipt = await borrower.authFetch(receiptUrl());
      expect(receipt.status).toBe(404);
    } finally {
      await localRoute.stop();
      await deleteOfferIfPresent();
    }
  }, 60_000);
});

describe("refusals: an unverifiable or missing offer never funds", () => {
  beforeEach(async () => {
    await deleteOfferIfPresent();
    await deleteReceiptIfPresent();
  });

  test("no loan offer at all -> 404, no receipt written", async () => {
    const response = await presenter.authFetch(apiUrl("/payout"), { method: "POST" });
    expect(response.status).toBe(404);
    const receipt = await borrower.authFetch(receiptUrl());
    expect(receipt.status).toBe(404);
  });

  test("an offer signed by an UNTRUSTED issuer -> refused, no receipt written", async () => {
    const rogueOfferIssuer = await createOfferIssuer(ROGUE_OFFER_WEBID);
    await putOffer(
      await rogueOfferIssuer.issueOffer({
        credentialId: offerUrl(),
        subject: presenter.webId,
        validFrom: new Date(NOW.getTime() - 1000),
        validUntil: new Date(NOW.getTime() + 14 * 24 * 60 * 60 * 1000),
      }),
    );
    const response = await presenter.authFetch(apiUrl("/payout"), { method: "POST" });
    expect(response.ok).toBe(false);
    expect(response.status).toBe(422);
    const receipt = await borrower.authFetch(receiptUrl());
    expect(receipt.status).toBe(404);
  });

  test("an offer bound to a DIFFERENT subject -> 403, no receipt written", async () => {
    await putOffer(
      await offerIssuer.issueOffer({
        credentialId: offerUrl(),
        subject: "https://someone-else.example/#me",
        validFrom: new Date(NOW.getTime() - 1000),
        validUntil: new Date(NOW.getTime() + 14 * 24 * 60 * 60 * 1000),
      }),
    );
    const response = await presenter.authFetch(apiUrl("/payout"), { method: "POST" });
    expect(response.status).toBe(403);
    const receipt = await borrower.authFetch(receiptUrl());
    expect(receipt.status).toBe(404);
  });

  test("an EXPIRED offer -> 410, no receipt written", async () => {
    await putOffer(
      await offerIssuer.issueOffer({
        credentialId: offerUrl(),
        subject: presenter.webId,
        validFrom: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000),
        validUntil: new Date(NOW.getTime() - 1000),
      }),
    );
    const response = await presenter.authFetch(apiUrl("/payout"), { method: "POST" });
    expect(response.status).toBe(410);
    const receipt = await borrower.authFetch(receiptUrl());
    expect(receipt.status).toBe(404);
  });
});

describe("the authenticated happy path — real grant read, real verification, real signed receipt", () => {
  beforeAll(async () => {
    await deleteOfferIfPresent();
    await deleteReceiptIfPresent();
    await putOffer(
      await offerIssuer.issueOffer({
        credentialId: offerUrl(),
        subject: presenter.webId,
        validFrom: new Date(NOW.getTime() - 1000),
        validUntil: new Date(NOW.getTime() + 14 * 24 * 60 * 60 * 1000),
      }),
    );
  });

  test("pays out: verifies the real granted offer, runs the deterministic payout, signs + delivers the receipt", async () => {
    const response = await presenter.authFetch(apiUrl("/payout"), { method: "POST" });
    expect(response.status, await response.clone().text()).toBe(200);
    const report = (await response.json()) as PayoutReport;

    expect(report.amountUsd).toBe(2000);
    expect(report.fundsOfferIri).toBe(offerUrl());
    expect(report.receiptIri).toBe(receiptUrl());
    expect(report.settlementMinutes).toBeGreaterThan(0);
    expect(report.settlementMinutes).toBeLessThanOrEqual(report.maxSettlementMinutes);
    expect(report.maxSettlementMinutes).toBe(30);
    expect(new Date(report.settledAt).getTime()).toBeGreaterThan(
      new Date(report.initiatedAt).getTime(),
    );

    // Real pod read-back, over real HTTP — not public.
    const anonymous = await fetch(receiptUrl());
    expect(anonymous.ok).toBe(false);
    const written = await borrower.authFetch(receiptUrl(), { headers: { accept: "text/turtle" } });
    expect(written.status).toBe(200);
    const turtle = await written.text();

    const shapeReport = await validate(turtle, {
      baseIRI: receiptUrl(),
      expect: "disbursement-receipt-credential",
      focusNode: receiptUrl(),
    });
    expect(shapeReport.conforms).toBe(true);

    const store = new Store(
      new Parser({ baseIRI: receiptUrl(), format: "text/turtle" }).parse(turtle),
    );
    const receipt = new DisbursementReceiptCredential(
      DataFactory.namedNode(receiptUrl()),
      store,
      DataFactory,
    );
    expect(receipt.credentialSubjectIri).toBe(presenter.webId);
    expect(receipt.derivedFromIri).toBe(offerUrl());
    const transfer = receipt.credentialSubject.disbursement;
    expect(transfer.amount.amountValue).toBe(2000);
    expect(transfer.paymentRail).toBe(LEND.PaymentRail_PushToCard);
    expect(transfer.cardLast4).toMatch(/^[0-9]{4}$/);
    expect(transfer.endTime.getTime()).toBeGreaterThan(transfer.startTime.getTime());

    // REAL, independent verifyCredential over the signed document — the
    // receipt is not just shape-valid, it cryptographically verifies.
    const outcome = await verifyCredential(turtle, {
      expectShape: "disbursement-receipt-credential",
      isControlledBy: (vm, issuer) =>
        vm === receiptKey.verificationMethod && issuer === DEFAULT_DISBURSEMENT_WEBID,
      now: NOW,
      resolveKey: async (vm) =>
        vm === receiptKey.verificationMethod ? receiptKey.publicKey : undefined,
      statusFetch: issuerPod.authFetch,
      trustedIssuers: [DEFAULT_DISBURSEMENT_WEBID],
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.verified).toBe(true);
    expect(outcome.credential?.subject).toBe(presenter.webId);
    expect(outcome.credential?.issuer).toBe(DEFAULT_DISBURSEMENT_WEBID);
  }, 60_000);

  test("a repeat call against the same funded loan is refused (409) — never a second payout", async () => {
    const response = await presenter.authFetch(apiUrl("/payout"), { method: "POST" });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("already_funded");
  });
});

describe("revocation genuinely shuts the read off (real WAC)", () => {
  test("after the borrower revokes the offer grant, the service identity is denied by the pod", async () => {
    await deleteReceiptIfPresent();
    await revokeOfferRead();
    try {
      const response = await presenter.authFetch(apiUrl("/payout"), { method: "POST" });
      expect(response.ok).toBe(false);
      expect([401, 403]).toContain(response.status);
      const receipt = await borrower.authFetch(receiptUrl());
      expect(receipt.status).toBe(404);

      // The pod itself still serves its owner (revocation removed one agent, not the data).
      const ownerRead = await presenter.authFetch(offerUrl());
      expect(ownerRead.status).toBe(200);
    } finally {
      await grantOfferRead(serviceIssuer.webId);
    }
  }, 60_000);
});
